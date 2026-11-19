import { homedir } from "node:os";
import type { Action } from "./config.ts";
import { platform } from "./platform";

/**
 * OS actions.
 *
 * Contract:
 * - `buildCommand(action, platform)` is pure and always returns ONE argv (`string[]`).
 *   For macOS media the returned argv is the preferred one (`nowplaying-cli`); the
 *   Spotify/Music AppleScript fallback is `buildMacMediaFallback()`, chosen by
 *   `runAction` at runtime. `page` actions have no command and make buildCommand throw.
 * - `runAction(action)` resolves on exit code 0 and throws an Error otherwise
 *   (stderr trimmed, or "timed out" after 10 s). `page` resolves immediately.
 *
 * Hotkey format: "cmd+shift+4", "ctrl+alt+t", "f5", "return", "space", "up".
 * On Windows, cmd/command/meta map to Ctrl (portable layouts); win/super is the real Windows key (SendInput).
 */

export { ACTION_TIMEOUT_MS } from "./platform/exec";

export { parseHotkey, type ParsedHotkey } from "./platform/hotkey";
import { parseHotkey, type ParsedHotkey } from "./platform/hotkey";

// ---------- macOS ----------

const MAC_KEY_CODES: Record<string, number> = {
  return: 36, tab: 48, space: 49, delete: 51, escape: 53, forwarddelete: 117,
  left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
  num0: 82, num1: 83, num2: 84, num3: 85, num4: 86, num5: 87, num6: 88, num7: 89, num8: 91, num9: 92,
  numdecimal: 65, nummultiply: 67, numadd: 69, numlock: 71, numdivide: 75, numenter: 76, numsubtract: 78,
  insert: 114, capslock: 57,
};

const MAC_MODS: Record<ParsedHotkey["mods"][number], string> = {
  cmd: "command down", ctrl: "control down", alt: "option down", shift: "shift down", win: "command down",
};

/** Escapes text for inside an AppleScript double-quoted string, turning control chars into expressions. */
export function escapeAppleScript(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '" & return & "')
    .replace(/\t/g, '" & tab & "');
}

function macHotkeyScript(keys: string): string {
  const { mods, key } = parseHotkey(keys);
  const names = [...new Set(mods.map((m) => MAC_MODS[m]))];
  const using = names.length ? ` using {${names.join(", ")}}` : "";
  const code = MAC_KEY_CODES[key];
  if (code === undefined && [...key].length > 1) throw new Error(`the key "${key}" is not available on macOS`);
  const body = code !== undefined ? `key code ${code}` : `keystroke "${escapeAppleScript(key)}"`;
  return `tell application "System Events" to ${body}${using}`;
}

/**
 * AppleScript fallback for macOS media keys: acts on the app that is playing, else on a running Spotify,
 * else on a running Music. Never launches an app (every tell is guarded by `is running`).
 */
export function buildMacMediaFallback(command: "playpause" | "next" | "previous"): string[] {
  const verb = command === "playpause" ? "playpause" : command === "next" ? "next track" : "previous track";
  const lines = [
    `set target to ""`,
    `if application "Spotify" is running then`,
    `tell application "Spotify" to if player state is playing then set target to "Spotify"`,
    `end if`,
    `if target is "" and application "Music" is running then`,
    `tell application "Music" to if player state is playing then set target to "Music"`,
    `end if`,
    `if target is "" then`,
    `if application "Spotify" is running then`,
    `set target to "Spotify"`,
    `else if application "Music" is running then`,
    `set target to "Music"`,
    `end if`,
    `end if`,
    `if target is "Spotify" then`,
    `tell application "Spotify" to ${verb}`,
    `else if target is "Music" then`,
    `tell application "Music" to ${verb}`,
    `else`,
    `error "no running media player (Spotify or Music)"`,
    `end if`,
  ];
  return ["osascript", ...lines.flatMap((l) => ["-e", l])];
}

function looksLikeUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || /^(mailto|tel|sms|facetime|slack|spotify):/i.test(target);
}

function looksLikePath(target: string): boolean {
  return /^(\/|~|\.{1,2}\/)/.test(target) || /^[a-z]:[\\/]/i.test(target);
}

function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

// ---------- Windows ----------

const WIN_NAMED: Record<string, string> = {
  return: "{ENTER}", tab: "{TAB}", space: " ", delete: "{BACKSPACE}", forwarddelete: "{DELETE}", escape: "{ESC}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}",
  pageup: "{PGUP}", pagedown: "{PGDN}",
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i + 1}`, `{F${i + 1}}`])),
  insert: "{INSERT}", printscreen: "{PRTSC}", pause: "{BREAK}", capslock: "{CAPSLOCK}", scrolllock: "{SCROLLLOCK}", numlock: "{NUMLOCK}",
  numadd: "{ADD}", numsubtract: "{SUBTRACT}", nummultiply: "{MULTIPLY}", numdivide: "{DIVIDE}", numenter: "{ENTER}", numdecimal: ".",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num${i}`, String(i)])),
};

/** Escapes one literal character for SendKeys (+^%~(){}[] are special). */
export function escapeSendKeysChar(ch: string): string {
  if (ch === "\n" || ch === "\r") return "{ENTER}";
  if (ch === "\t") return "{TAB}";
  return "+^%~(){}[]".includes(ch) ? `{${ch}}` : ch;
}

export function escapeSendKeys(text: string): string {
  return text.replace(/\r\n/g, "\n").split("").map(escapeSendKeysChar).join("");
}

/** Escapes for a PowerShell single-quoted string (also doubles the typographic quotes PowerShell treats as quotes). */
export function escapePowerShell(text: string): string {
  return text.replace(/['‘’‚‛]/g, (c) => c + c);
}

function winSendKeysHotkey(keys: string): string {
  const { mods, key } = parseHotkey(keys);
  let prefix = "";
  // SendKeys (legacy builder only; the agent uses SendInput) has no Windows key: win falls back to Ctrl here
  if (mods.includes("cmd") || mods.includes("ctrl") || mods.includes("win")) prefix += "^";
  if (mods.includes("alt")) prefix += "%";
  if (mods.includes("shift")) prefix += "+";
  const named = WIN_NAMED[key];
  if (named === undefined && [...key].length > 1) throw new Error(`the key "${key}" cannot be sent with SendKeys`);
  const k = named ?? escapeSendKeysChar(key);
  return prefix + k;
}

function ps(script: string): string[] {
  return ["powershell", "-NoProfile", "-NonInteractive", "-Command", script];
}

const WIN_MEDIA: Record<string, number> = { playpause: 179, next: 176, previous: 177 };
const WIN_VOLUME: Record<string, number> = { mute: 173, down: 174, up: 175 };

// ---------- Linux ----------

const XDO_MODS: Record<ParsedHotkey["mods"][number], string> = { cmd: "super", ctrl: "ctrl", alt: "alt", shift: "shift", win: "super" };
const XDO_KEYS: Record<string, string> = {
  return: "Return", tab: "Tab", space: "space", delete: "BackSpace", forwarddelete: "Delete", escape: "Escape",
  up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End", pageup: "Prior", pagedown: "Next",
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
  insert: "Insert", printscreen: "Print", pause: "Pause", capslock: "Caps_Lock", scrolllock: "Scroll_Lock", numlock: "Num_Lock",
  numadd: "KP_Add", numsubtract: "KP_Subtract", nummultiply: "KP_Multiply", numdivide: "KP_Divide", numdecimal: "KP_Decimal", numenter: "KP_Enter",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num${i}`, `KP_${i}`])),
  mediastop: "XF86AudioStop",
};

export function xdotoolKey(keys: string): string {
  const { mods, key } = parseHotkey(keys);
  return [...new Set(mods.map((m) => XDO_MODS[m]))].concat(XDO_KEYS[key] ?? key).join("+");
}

// ---------- buildCommand ----------

export function buildCommand(a: Action, platform: NodeJS.Platform): string[] {
  if (a.type === "page") throw new Error("page actions do not run OS commands");
  // The soundboard is played by the server (afplay with its own process tracking) and/or the phone, not from here.
  if (a.type === "sound" || a.type === "sound-stop") throw new Error("sound actions are handled by the sound player");
  if (a.type === "hass") throw new Error("Home Assistant actions are handled by the HA client");
  if (a.type === "macro") throw new Error("macros are run step by step by the macro runner");
  if (a.type === "set-volume" || a.type === "mic" || a.type === "app-volume" || a.type === "output-device") throw new Error("volume, microphone and audio device changes are made by the agent, not a command");

  const isWin = platform === "win32";
  const isMac = platform === "darwin";
  if (!isWin && !isMac && platform !== "linux") throw new Error(`unsupported platform: ${platform}`);

  switch (a.type) {
    case "shell":
      return isWin ? ["cmd", "/c", a.command] : ["sh", "-c", a.command];

    case "open": {
      const target = a.target.trim();
      if (!target) throw new Error("open target is empty");
      if (target.startsWith("bundle:")) {
        const id = target.slice(7);
        if (!/^[A-Za-z0-9][A-Za-z0-9.\-]{0,127}$/.test(id)) throw new Error("invalid bundle id");
        if (!isMac) throw new Error("bundle: targets are only supported on macOS");
        return ["open", "-b", id];
      }
      if (isMac) {
        if (looksLikeUrl(target)) return ["open", target];
        if (looksLikePath(target)) return ["open", expandHome(target)];
        return ["open", "-a", target];
      }
      if (isWin) return ps(`Start-Process -FilePath '${escapePowerShell(target)}'`);
      return ["xdg-open", looksLikePath(target) ? expandHome(target) : target];
    }

    case "hotkey":
      if (isMac) return ["osascript", "-e", macHotkeyScript(a.keys)];
      if (isWin) return ps(`(New-Object -ComObject WScript.Shell).SendKeys('${escapePowerShell(winSendKeysHotkey(a.keys))}')`);
      return ["xdotool", "key", "--", xdotoolKey(a.keys)];

    case "type":
      if (isMac) return ["osascript", "-e", `tell application "System Events" to keystroke "${escapeAppleScript(a.text)}"`];
      if (isWin) return ps(`(New-Object -ComObject WScript.Shell).SendKeys('${escapePowerShell(escapeSendKeys(a.text))}')`);
      return ["xdotool", "type", "--delay", "12", "--", a.text];

    case "media":
      if (isMac) return ["nowplaying-cli", a.command === "playpause" ? "togglePlayPause" : a.command];
      if (isWin) return ps(`(New-Object -ComObject WScript.Shell).SendKeys([char]${WIN_MEDIA[a.command]})`);
      return ["playerctl", a.command === "playpause" ? "play-pause" : a.command];

    case "volume":
      if (isMac) {
        if (a.command === "mute") return ["osascript", "-e", "set volume output muted (not (output muted of (get volume settings)))"];
        const delta = a.command === "up" ? "+ 6" : "- 6";
        const clamp = a.command === "up" ? "if v > 100 then set v to 100" : "if v < 0 then set v to 0";
        return [
          "osascript",
          "-e", `set v to (output volume of (get volume settings)) ${delta}`,
          "-e", clamp,
          "-e", "set volume output volume v",
        ];
      }
      if (isWin) {
        const code = WIN_VOLUME[a.command];
        const times = a.command === "mute" ? 1 : 3;
        return ps(`$w = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $w.SendKeys([char]${code}) }`);
      }
      if (a.command === "mute") return ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"];
      return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", a.command === "up" ? "+5%" : "-5%"];
  }
}

// ---------- volume ----------

export type VolumeChange = { level: number } | { muted: boolean };
export interface VolumeState { level: number; muted: boolean }

/** Pure: argv that sets an absolute volume (0-100) or the mute state. */
export function buildVolumeCommand(v: VolumeChange, platform: NodeJS.Platform): string[] {
  if ("level" in v) {
    if (!Number.isInteger(v.level) || v.level < 0 || v.level > 100) throw new Error("volume level must be an integer 0-100");
    if (platform === "darwin") return ["osascript", "-e", `set volume output volume ${v.level}`];
    if (platform === "linux") return ["pactl", "set-sink-volume", "@DEFAULT_SINK@", `${v.level}%`];
    if (platform === "win32") {
      // Best effort: each volume key step is 2%. Go to 0, then step up.
      return ps(`$w = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $w.SendKeys([char]174) }; 1..${Math.round(v.level / 2)} | ForEach-Object { $w.SendKeys([char]175) }`);
    }
  } else {
    if (typeof v.muted !== "boolean") throw new Error("muted must be a boolean");
    if (platform === "darwin") return ["osascript", "-e", `set volume output muted ${v.muted}`];
    if (platform === "linux") return ["pactl", "set-sink-mute", "@DEFAULT_SINK@", v.muted ? "1" : "0"];
    if (platform === "win32") throw new Error("setting mute state is not supported on Windows");
  }
  throw new Error(`unsupported platform: ${platform}`);
}

export async function setVolume(v: VolumeChange): Promise<void> {
  await platform.setVolume(v);
  volumeCache = undefined;
}

/** Parses `osascript -e "get volume settings"` output. Null when the device has no software volume. */
export function parseMacVolumeSettings(out: string): VolumeState | null {
  const level = /output volume:\s*(\d+)/.exec(out)?.[1];
  if (level === undefined) return null;
  return { level: Math.min(100, Number(level)), muted: /output muted:\s*true/.test(out) };
}

/** Parses `pactl get-sink-volume` and `pactl get-sink-mute` output. */
export function parsePactlVolume(volumeOut: string, muteOut: string): VolumeState | null {
  const pct = /(\d+)%/.exec(volumeOut)?.[1];
  if (pct === undefined) return null;
  return { level: Math.min(100, Number(pct)), muted: /yes/i.test(muteOut) };
}

let volumeCache: { value: VolumeState | null; at: number } | undefined;
let volumeInflight: Promise<VolumeState | null> | undefined;
export const VOLUME_REFRESH_MS = 2000;

async function readVolumeNow(): Promise<VolumeState | null> {
  try {
    return await platform.readVolume();
  } catch {
    return null; // no audio tooling: report unknown volume
  }
}

/** Fresh volume read (used right after a change). */
export function readVolume(): Promise<VolumeState | null> {
  volumeInflight ??= readVolumeNow()
    .then((value) => {
      volumeCache = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      volumeInflight = undefined;
    });
  return volumeInflight;
}

/** Never blocks: returns the last known volume and refreshes in the background at most every 2 s. */
export function getVolumeCached(): VolumeState | null {
  if (!volumeCache || Date.now() - volumeCache.at >= VOLUME_REFRESH_MS) void readVolume();
  return volumeCache?.value ?? null;
}

// ---------- runAction ----------

export { runCapture } from "./platform/exec";
import { runCapture } from "./platform/exec";

async function exec(argv: string[]): Promise<void> {
  await runCapture(argv);
}

export async function runAction(a: Action): Promise<void> {
  if (a.type === "page") return;
  return platform.runAction(a);
}
