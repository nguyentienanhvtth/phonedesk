import { createHash } from "node:crypto";
import { escapePowerShell } from "../actions";
import { runCapture } from "./exec";
import { WinHelper } from "./win32/helper";
import { idleSeconds as realIdle, realCredApi, sendInput, vkScan, vkToScan, type CredApi } from "./win32/ffi";
import { hotkeyEvents, mediaEvents, typeEvents, volumeKeyEvents, type KeyEvent, type VkScan, type VkToScan } from "./win32/keys";
import type { AppCatalog, MicChange, MicState, Platform, SecretStore } from "./types";
import type { AppInfo } from "../icons";
import type { MediaApp, RawMedia } from "../media";
import type { NetCounters } from "../stats";
import type { ProcessInfo } from "../processes";

/** `Spotify.exe`, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, `Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic` -> a readable app name. */
/** Plain names that are not in the Start menu list under that name. */
const WELL_KNOWN: Record<string, string[]> = { terminal: ["wt.exe", "cmd.exe"], "command prompt": ["cmd.exe"], powershell: ["powershell.exe"], explorer: ["explorer.exe"], "file explorer": ["explorer.exe"], notepad: ["notepad.exe"], calculator: ["calc.exe"] };

export function friendlyAppName(aumid: string): string {
  const id = String(aumid ?? "").trim();
  if (!id) return "Media";
  if (/spotify/i.test(id)) return "Spotify";
  if (/zunemusic|mediaplayer/i.test(id)) return "Media Player";
  if (/applemusic|itunes/i.test(id)) return "Apple Music";
  const tail = id.includes("!") ? id.slice(id.lastIndexOf("!") + 1) : id;
  const base = tail.replace(/\.exe$/i, "").replace(/_[a-z0-9]{13}$/i, "");
  const last = base.split(".").pop() || base;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Stable, regex-safe id for a Start Menu app (the AppID has `!`, `\`, spaces): `win-` + 16 hex chars of its sha1. */
export const winAppId = (appId: string): string => "win-" + createHash("sha1").update(appId).digest("hex").slice(0, 16);

/** `file:///C:/Users/Me/a%20b.mp3` for a Windows path (written by hand so it is the same on every host OS). */
export function fileUri(path: string): string {
  const p = path.replace(/\\/g, "/");
  return /^[A-Za-z]:\//.test(p) ? "file:///" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F") : "file://" + encodeURI(p);
}

export const MEDIA_APP_URI: Record<MediaApp, string> = { Spotify: "spotify:", Music: "mswindowsmusic:" };

const ps = (script: string) => ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];

/** Plays a file once and exits when it ends (killing the process stops it). WPF MediaPlayer: mp3, m4a, wav, aac, ogg-less. */
export function soundArgv(path: string, volume: number): string[] {
  const uri = fileUri(path);
  const v = (Math.max(0, Math.min(100, volume)) / 100).toFixed(2);
  return [
    "powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command",
    `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${escapePowerShell(uri)}'); $p.Volume = ${v}; $p.Play(); ` +
      `$end = [DateTime]::UtcNow.AddSeconds(10); while (-not $p.NaturalDuration.HasTimeSpan -and [DateTime]::UtcNow -lt $end) { Start-Sleep -Milliseconds 40 }; ` +
      `if ($p.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds ([int]$p.NaturalDuration.TimeSpan.TotalMilliseconds + 300) }`,
  ];
}

export function credentialStore(api: CredApi = realCredApi): SecretStore {
  const target = (service: string, account: string) => `${service}/${account}`;
  return {
    get: async (s, a) => api.read(target(s, a)),
    set: async (s, a, v) => api.write(target(s, a), a, v),
    remove: async (s, a) => { api.remove(target(s, a)); },
  };
}

export interface Win32Deps {
  helper?: WinHelper;
  send?: (events: KeyEvent[]) => void;
  typeDelayMs?: number;
  scan?: VkScan;
  toScan?: VkToScan;
  cred?: CredApi;
  idle?: () => number | null;
  run?: (argv: string[]) => Promise<string>;
}

export function createWin32(d: Win32Deps = {}): Platform {
  const helper = d.helper ?? new WinHelper();
  const send = d.send ?? sendInput;
  /**
   * Typed text goes out one character (key down + up; a surrogate pair together) at a time with a short pause, not as one
   * block: modern apps such as the tabbed Notepad do not keep up with a long burst of injected characters.
   */
  const sendPaced = async (events: KeyEvent[]) => {
    for (let i = 0; i < events.length;) {
      const high = events[i]!.unicode && events[i]!.scan >= 0xd800 && events[i]!.scan <= 0xdbff;
      const n = Math.min(high ? 4 : 2, events.length - i);
      send(events.slice(i, i + n));
      i += n;
      if (i < events.length) await new Promise((r) => setTimeout(r, d.typeDelayMs ?? 4));
    }
  };
  const scan = d.scan ?? vkScan;
  // a fake `send` (tests) gets the static US scan table, never the real Win32 lookup
  const toScan = d.toScan ?? (d.send ? undefined : vkToScan);
  const run = d.run ?? ((argv: string[]) => runCapture(argv, 10_000));
  const ids = new Map<string, string>(); // win-<hash> -> AppID

  const apps: AppCatalog = {
    async list() {
      const rows = (await helper.call<Array<{ name: string; id: string }>>("apps.list", {}, 20_000)) ?? [];
      ids.clear();
      const out: AppInfo[] = [];
      for (const r of rows) {
        if (typeof r?.id !== "string" || typeof r?.name !== "string") continue;
        const id = winAppId(r.id);
        if (ids.has(id)) continue;
        ids.set(id, r.id);
        out.push({ name: r.name.trim(), bundleId: id, path: r.id, category: null });
      }
      return out;
    },
    async icon(id) {
      if (!ids.has(id)) await apps.list();
      const appId = ids.get(id);
      if (!appId) return null;
      try {
        const b64 = await helper.call<string>("apps.icon", { appId, px: 128 }, 15_000);
        return b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
      } catch { return null; }
    },
    async open(id) {
      if (!ids.has(id)) await apps.list();
      const appId = ids.get(id);
      if (!appId) throw new Error("unknown app");
      await helper.call("apps.open", { appId });
    },
    async resizeImage(bytes, _ext, max) {
      const b64 = await helper.call<string>("image.resize", { data: Buffer.from(bytes).toString("base64"), max }, 15_000);
      if (!b64) throw new Error("cannot read the image");
      return new Uint8Array(Buffer.from(b64, "base64"));
    },
  };

  /** What the new window is likely called, to find it again when the program reused an open one. */
  const hintFor = (target: string): string => target.startsWith("bundle:") ? "" : target.replace(/^.*[\\/]/, "").replace(/\.(exe|lnk)$/i, "");

  const launch = async (target: string) => {
    if (target.startsWith("bundle:")) return apps.open(target.slice(7));
    // a plain name ("Terminal", "Notepad"): an installed app with that display name first, then well-known programs
    if (!/[\\/:.]/.test(target)) {
      const want = target.toLowerCase();
      let list: { name: string; bundleId: string }[] = [];
      try { list = await apps.list(); } catch { /* helper down: fall through */ }
      const hit = list.find((a) => a.name.toLowerCase() === want)
        ?? list.find((a) => a.name.toLowerCase() === `windows ${want}`)
        ?? list.find((a) => a.name.toLowerCase().startsWith(want + " "));
      if (hit) { focusHint = hit.name; return apps.open(hit.bundleId); }
      for (const exe of WELL_KNOWN[want] ?? []) {
        try { await run(ps(`Start-Process -FilePath '${escapePowerShell(exe)}'`)); return; } catch { /* try the next */ }
      }
    }
    await run(ps(`Start-Process -FilePath '${escapePowerShell(target)}'`));
  };

  let focusHint = "";
  /**
   * Opens a program and then hands the keyboard focus to its window. A process started from the background (this agent)
   * does not get the foreground, and SendInput types into whatever has it: without this the next macro step typed into
   * nothing. URLs and documents handled by an already running browser create no window, so they are left alone.
   */
  const openTarget = async (target: string) => {
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || /^(mailto|tel|spotify|mswindowsmusic|ms-settings):/i.test(target);
    let before: number[] | null = null;
    if (!isUrl) { try { before = (await helper.call<{ hwnd: number }[]>("window.list", {}, 6000)).map((w) => w.hwnd); } catch { before = null; } }
    focusHint = hintFor(target);
    await launch(target);
    if (isUrl || before === null) return;
    try { await helper.call("window.focusnew", { before, hint: focusHint, ms: 5000 }, 12_000); } catch { /* best effort: the app is open */ }
  };

  const self: Platform = {
    id: "win32",
    label: "Windows",
    keyNames: { cmd: "Ctrl", alt: "Alt", ctrl: "Ctrl" },

    async runAction(a) {
      switch (a.type) {
        case "shell": await run(["cmd", "/c", a.command]); return;
        case "open": {
          const target = a.target.trim();
          if (!target) throw new Error("open target is empty");
          if (target.startsWith("bundle:") && !/^win-[0-9a-f]{16}$/.test(target.slice(7))) throw new Error("invalid app id");
          await openTarget(target);
          return;
        }
        case "hotkey": send(hotkeyEvents(a.keys, scan, toScan)); return;
        case "type": await sendPaced(typeEvents(a.text)); return;
        case "media": send(mediaEvents(a.command, toScan)); return;
        case "volume": send(volumeKeyEvents(a.command, undefined, toScan)); return;
        default: throw new Error(`${a.type} actions are not run as OS commands`);
      }
    },

    async readVolume() {
      try {
        const v = await helper.call<{ level: number; muted: boolean }>("volume.get", {}, 5000);
        return v && typeof v.level === "number" ? { level: Math.max(0, Math.min(100, Math.round(v.level))), muted: !!v.muted } : null;
      } catch { return null; }
    },
    async setVolume(v) {
      if ("level" in v) {
        if (!Number.isInteger(v.level) || v.level < 0 || v.level > 100) throw new Error("volume level must be an integer 0-100");
        await helper.call("volume.set", { level: v.level });
      } else {
        if (typeof v.muted !== "boolean") throw new Error("muted must be a boolean");
        await helper.call("volume.set", { muted: v.muted });
      }
    },

    async readMic(): Promise<MicState | null> {
      try {
        const v = await helper.call<{ level: number; muted: boolean }>("mic.get", {}, 5000);
        return v && typeof v.level === "number" ? { level: Math.max(0, Math.min(100, Math.round(v.level))), muted: !!v.muted } : null;
      } catch { return null; }
    },
    async setMic(v: MicChange) {
      if (v.level !== undefined) {
        if (!Number.isInteger(v.level) || v.level < 0 || v.level > 100) throw new Error("mic level must be an integer 0-100");
        await helper.call("mic.set", { level: v.level });
      }
      if (v.muted !== undefined) {
        if (typeof v.muted !== "boolean") throw new Error("mic muted must be a boolean");
        await helper.call("mic.set", { muted: v.muted });
      }
    },

    async readMedia() {
      try {
        const m = await helper.call<any>("media.read", {}, 6000);
        if (!m) return null;
        const raw: RawMedia = {
          app: friendlyAppName(m.app), title: String(m.title ?? ""), artist: String(m.artist ?? ""), album: String(m.album ?? ""),
          playing: !!m.playing, position: Number(m.position) || 0, duration: Number(m.duration) || 0,
        };
        return raw;
      } catch { return null; }
    },
    async fetchArtwork() {
      try { return (await helper.call<string | null>("media.artwork", { max: 300 }, 8000)) ?? undefined; } catch { return undefined; }
    },
    async resumeMedia(lastApp) {
      try { if (await helper.call<boolean>("media.control", { op: "play" })) return; } catch { /* no session: open an app */ }
      await self.openMediaApp(lastApp === "Music" ? "Music" : "Spotify");
    },
    async openMediaApp(app) {
      const uri = MEDIA_APP_URI[app];
      if (!uri) throw new Error("unknown media app");
      await run(ps(`Start-Process -FilePath '${uri}'`));
    },

    async netCounters() {
      try {
        const o = await helper.call<Record<string, { rx: number; tx: number }>>("net.counters", {}, 5000);
        const out: NetCounters = {};
        for (const [k, v] of Object.entries(o ?? {})) if (Number.isFinite(v?.rx) && Number.isFinite(v?.tx)) out[k] = { rx: v.rx, tx: v.tx };
        return out;
      } catch { return undefined; }
    },
    async memUsed() { return undefined; },
    async topProcesses(sort, limit) {
      const { topProcessesFrom } = await import("../processes");
      const rows = (await helper.call<Array<{ pid: number; name: string; cpu: number; mem: number }>>("proc.list", {}, 10_000)) ?? [];
      const all: ProcessInfo[] = rows.filter((r) => Number.isFinite(r?.pid)).map((r) => ({ pid: r.pid, name: String(r.name).replace(/#\d+$/, ""), cpu: Number(r.cpu) || 0, mem: Number(r.mem) || 0 }));
      return topProcessesFrom(all, sort, limit);
    },
    async lanName() { return undefined; },

    apps,
    soundCommand: (path, volume) => soundArgv(path, volume),
    async soundDuration(path) {
      try { const ms = await helper.call<number | null>("sound.duration", { path: fileUri(path) }, 5000); return ms && ms > 0 ? ms : undefined; } catch { return undefined; }
    },

    secrets: credentialStore(d.cred),
    async claudeCredentials() { return null; },
    loadKind: "estimate",
    async idleSeconds() { return (d.idle ?? realIdle)(); },

    openExternal: async (url) => { await run(ps(`Start-Process -FilePath '${escapePowerShell(url)}'`)); },
    hookPath: (p) => p.replace(/\\/g, "/"),
    dispose: () => helper.dispose(),
  };
  return self;
}
