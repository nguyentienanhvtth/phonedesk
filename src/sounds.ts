import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { runCapture } from "./actions";
import { createPlatform, platform as osPlatform } from "./platform";
import { createLinux } from "./platform/linux";
import { HOME, type SoundMode } from "./config";
import { t } from "./i18n";

export const SOUND_MAX = 5 * 1024 * 1024;
export const MAX_CONCURRENT = 8;
export const SOUND_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/aac", "audio/aacp", "audio/ogg", "application/ogg"];
export const SOUND_ID_HEX = /^[a-f0-9]{16}$/;

export type SoundExt = "mp3" | "m4a" | "wav" | "aac" | "ogg";
const MIME: Record<SoundExt, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg" };

/** Which audio format the bytes are, from the file header (never from the client's say-so). */
export function soundKind(b: Uint8Array): SoundExt | null {
  const at = (i: number, s: string) => s.split("").every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length < 12) return null;
  if (at(0, "ID3")) return "mp3";
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (at(0, "OggS")) return "ogg";
  if (at(4, "ftyp")) return "m4a";
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) {
    const layer = (b[1]! >> 1) & 3;
    if (layer === 0) return "aac"; // ADTS
    return "mp3";
  }
  return null;
}

export interface SoundMeta {
  name: string;
  ext: SoundExt;
  size: number;
  durationMs?: number;
  createdAt: number;
}
export interface SoundInfo extends SoundMeta { id: string }

export const bareId = (id: string): string => (id.startsWith("snd:") ? id.slice(4) : id);

/** estimated duration from `afinfo` output */
export function parseAfinfo(out: string): number | undefined {
  const m = /estimated duration:\s*([\d.]+)\s*sec/i.exec(out);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined;
}

/** Formats the agent's own player can play on this OS: Windows plays through WPF MediaPlayer, which has no Ogg decoder. */
export function playableExts(os: string = osPlatform.id): SoundExt[] {
  return os === "win32" ? ["mp3", "m4a", "wav", "aac"] : ["mp3", "m4a", "wav", "aac", "ogg"];
}

export interface LibraryOptions {
  home?: string;
  /** Which OS the clips play on (tests; default this one). */
  os?: string;
  run?: (argv: string[], timeoutMs?: number) => Promise<string>;
  now?: () => number;
}

/** ~/.phonedesk/sounds/<16hex>.<ext> plus names and sizes in sounds.json. */
export class SoundLibrary {
  private home: string;
  private run: NonNullable<LibraryOptions["run"]>;
  private now: () => number;
  private os: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: LibraryOptions = {}) {
    this.home = opts.home ?? HOME;
    this.run = opts.run ?? ((argv, t) => runCapture(argv, t));
    this.now = opts.now ?? Date.now;
    this.os = opts.os ?? osPlatform.id;
  }

  private get dir() { return join(this.home, "sounds"); }
  private get metaFile() { return join(this.home, "sounds.json"); }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async meta(): Promise<Record<string, SoundMeta>> {
    try { return JSON.parse(await readFile(this.metaFile, "utf8")) ?? {}; } catch { return {}; }
  }

  private async saveMeta(m: Record<string, SoundMeta>) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const tmp = `${this.metaFile}.tmp`;
    await writeFile(tmp, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.metaFile);
  }

  static cleanName(n: unknown, fallback = t("Sound")): string {
    const s = typeof n === "string" ? n.replace(/[\u0000-\u001f]/g, "").replace(/\.(mp3|m4a|wav|aac|ogg|mp4)$/i, "").trim().slice(0, 80) : "";
    return s || fallback;
  }

  async add(bytes: Uint8Array, name?: string): Promise<SoundInfo> {
    if (bytes.length === 0) throw new Error("empty file");
    if (bytes.length > SOUND_MAX) throw new Error("file is larger than 5 MB");
    const ext = soundKind(bytes);
    const ok = playableExts(this.os);
    if (!ext) throw new Error(`only ${ok.slice(0, -1).join(", ")} or ${ok.at(-1)} audio is accepted`);
    if (!ok.includes(ext)) throw new Error("ogg audio cannot play on Windows: convert the clip to mp3, m4a or wav");
    const id = randomBytes(8).toString("hex");
    const file = join(this.dir, `${id}.${ext}`);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
    await chmod(file, 0o600);
    let durationMs: number | undefined;
    if (this.run !== undefined) {
      try { durationMs = parseAfinfo(await this.run(["afinfo", file], 5000)); } catch { /* no afinfo */ }
    } else {
      durationMs = await osPlatform.soundDuration(file).catch(() => undefined);
    }
    const meta: SoundMeta = { name: SoundLibrary.cleanName(name), ext, size: bytes.length, ...(durationMs ? { durationMs } : {}), createdAt: this.now() };
    await this.lock(async () => { const m = await this.meta(); m[id] = meta; await this.saveMeta(m); });
    return { id: `snd:${id}`, ...meta };
  }

  async list(): Promise<SoundInfo[]> {
    const m = await this.lock(() => this.meta());
    return Object.entries(m).map(([id, v]) => ({ id: `snd:${id}`, ...v })).sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<(SoundInfo & { path: string }) | null> {
    const hex = bareId(id);
    if (!SOUND_ID_HEX.test(hex)) return null;
    const v = (await this.lock(() => this.meta()))[hex];
    return v ? { id: `snd:${hex}`, ...v, path: join(this.dir, `${hex}.${v.ext}`) } : null;
  }

  async rename(id: string, name: unknown): Promise<SoundInfo | null> {
    const hex = bareId(id);
    if (!SOUND_ID_HEX.test(hex)) return null;
    return this.lock(async () => {
      const m = await this.meta();
      if (!m[hex]) return null;
      m[hex] = { ...m[hex]!, name: SoundLibrary.cleanName(name, m[hex]!.name) };
      await this.saveMeta(m);
      return { id: `snd:${hex}`, ...m[hex]! };
    });
  }

  async remove(id: string): Promise<boolean> {
    const hex = bareId(id);
    if (!SOUND_ID_HEX.test(hex)) return false;
    return this.lock(async () => {
      const m = await this.meta();
      const v = m[hex];
      if (!v) return false;
      delete m[hex];
      await this.saveMeta(m);
      await rm(join(this.dir, `${hex}.${v.ext}`), { force: true });
      return true;
    });
  }

  mime(ext: SoundExt): string { return MIME[ext]; }
  async fileSize(path: string): Promise<number> { return (await stat(path)).size; }
}

// ---------- playback on the Mac ----------

export interface Child { kill: () => void; exited: Promise<unknown> }
export type SpawnFn = (argv: string[]) => Child;

const realSpawn: SpawnFn = (argv) => {
  const p = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true } as any);
  return { kill: () => p.kill(), exited: p.exited };
};

/**
 * The command that plays `path` at volume 0-100 on this OS (afplay on macOS, a PowerShell MediaPlayer on Windows,
 * paplay/aplay best effort on Linux). `platform`/`which` are only passed by tests to pick another OS's builder.
 */
export function playCommand(path: string, volume: number, id: NodeJS.Platform = osPlatform.id, which: (n: string) => string | null = (n) => Bun.which(n)): string[] {
  if (id === "linux") return createLinux(id, which).soundCommand(path, volume);
  return (id === osPlatform.id ? osPlatform : createPlatform(id)).soundCommand(path, volume);
}

interface Running { id: string; child: Child; seq: number }

/** Tracks the player processes so a sound can be restarted, toggled off or all stopped. */
export class SoundPlayer {
  private running = new Set<Running>();
  private seq = 0;
  private last = "";

  constructor(private opts: { spawn?: SpawnFn; platform?: NodeJS.Platform; which?: (n: string) => string | null; onChange?: (ids: string[]) => void } = {}) {}

  /** Distinct sound ids playing now (snd:<hex>). */
  playing(): string[] {
    return [...new Set([...this.running].map((r) => r.id))];
  }

  private changed() {
    const now = this.playing().sort().join(",");
    if (now === this.last) return;
    this.last = now;
    this.opts.onChange?.(this.playing());
  }

  private killId(id: string) {
    for (const r of [...this.running]) if (r.id === id) { this.running.delete(r); try { r.child.kill(); } catch { /* gone */ } }
  }

  /** Returns "started", or "stopped" when toggle turned a playing sound off. Throws when it cannot play. */
  play(id: string, path: string, volume = 100, mode: SoundMode = "restart"): "started" | "stopped" {
    if (mode === "toggle" && this.playing().includes(id)) {
      this.killId(id);
      this.changed();
      return "stopped";
    }
    if (mode === "restart") this.killId(id);
    if (this.running.size >= MAX_CONCURRENT) throw new Error(`already ${MAX_CONCURRENT} sounds playing`);
    const argv = playCommand(path, Math.max(0, Math.min(100, volume)), this.opts.platform, this.opts.which);
    const child = (this.opts.spawn ?? realSpawn)(argv);
    const r: Running = { id, child, seq: this.seq++ };
    this.running.add(r);
    void child.exited.then(() => { if (this.running.delete(r)) this.changed(); }, () => { if (this.running.delete(r)) this.changed(); });
    this.changed();
    return "started";
  }

  stopAll() {
    for (const r of [...this.running]) { this.running.delete(r); try { r.child.kill(); } catch { /* gone */ } }
    this.changed();
  }

  stopId(id: string) {
    this.killId(id);
    this.changed();
  }
}

/**
 * Every sound clip a layout plays (buttons, macro steps, rules), with the label of the button that plays it.
 * Walks the JSON so a new place that holds actions is covered without touching this.
 */
export function soundRefs(layout: unknown): { sound: string; label: string }[] {
  const out: { sound: string; label: string }[] = [];
  const walk = (v: unknown, label: string) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, label));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const here = typeof o.label === "string" && o.label.trim() ? o.label.trim() : typeof o.name === "string" && o.name.trim() ? o.name.trim() : label;
    if (o.type === "sound" && typeof o.sound === "string") out.push({ sound: `snd:${bareId(o.sound)}`, label: here });
    for (const x of Object.values(o)) if (x && typeof x === "object") walk(x, here);
  };
  walk(layout, "");
  return out;
}

/**
 * The first clip `next` plays that is neither in the library nor already in `prev` (a clip deleted later keeps its
 * buttons saveable: the editor flags those), as an error message; null when every new reference exists.
 */
export function missingSoundError(next: unknown, prev: unknown, library: Set<string>): string | null {
  const before = new Set(soundRefs(prev).map((r) => r.sound));
  const bad = soundRefs(next).find((r) => !library.has(r.sound) && !before.has(r.sound));
  if (!bad) return null;
  return bad.label
    ? `“${bad.label}” plays a sound that is not in the library (${bad.sound}): upload it in the Sounds tab or pick another clip`
    : `a button plays a sound that is not in the library (${bad.sound}): upload it in the Sounds tab or pick another clip`;
}
