import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { arch } from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { platform } from "./platform";
import pkg from "../package.json" with { type: "json" };

/**
 * The GitHub repository for release lookups. Override with PHONEDESK_REPO to point to a fork.
 * Set PHONEDESK_NO_UPSTREAM_UPDATE=1 to disable all automatic update checks from upstream.
 */
export const REPO = process.env.PHONEDESK_REPO ?? "howznguyen/phonedesk";

/** True when upstream updates are disabled (for forks that build their own releases). */
export const upstreamUpdatesDisabled = (): boolean => process.env.PHONEDESK_NO_UPSTREAM_UPDATE === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "v0.1.2" -> "0.1.2" */
export const bare = (tag: string): string => tag.replace(/^v/i, "");

/** Compares dotted numeric versions: negative when a < b. A pre-release suffix sorts before the plain release. */
export function cmpVersions(a: string, b: string): number {
  const split = (v: string) => { const [core, pre] = bare(v).split("-", 2); return { n: (core ?? "").split(".").map((x) => Number.parseInt(x, 10) || 0), pre }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) { const d = (x.n[i] ?? 0) - (y.n[i] ?? 0); if (d) return d < 0 ? -1 : 1; }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return 0;
}

export const currentVersion = (): string => pkg.version;

export interface LookupOptions { fetch?: typeof fetch; githubUrl?: string; apiUrl?: string; retrySeconds?: number; log?: (s: string) => void; sleep?: (ms: number) => Promise<void> }

/**
 * The latest release tag. GitHub answers 5xx now and then, so: up to 4 rounds with a growing pause, each trying the
 * /releases/latest redirect first and then api.github.com's tag_name (same as setup.sh). Throws with what failed.
 */
export async function latestTag(o: LookupOptions = {}): Promise<string> {
  const f = o.fetch ?? fetch;
  const gh = (o.githubUrl ?? process.env.PHONEDESK_GITHUB_URL ?? "https://github.com").replace(/\/+$/, "");
  const api = (o.apiUrl ?? process.env.PHONEDESK_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
  const pause = o.retrySeconds ?? (process.env.PHONEDESK_RETRY_SECONDS ? Number(process.env.PHONEDESK_RETRY_SECONDS) : 2);
  const wait = o.sleep ?? sleep;
  let why = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await f(`${gh}/${REPO}/releases/latest`, { method: "HEAD", redirect: "follow", headers: { "user-agent": "phonedesk-update" }, signal: AbortSignal.timeout(15_000) });
      const tag = /\/tag\/([^/?#]+)/.exec(r.url)?.[1];
      if (r.ok && tag) return decodeURIComponent(tag);
      why = `github.com answered ${r.status}`;
    } catch (e: any) { why = `github.com: ${String(e?.message ?? e).slice(0, 80)}`; }
    try {
      const r = await f(`${api}/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "phonedesk-update" }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) { const tag = (await r.json() as any)?.tag_name; if (typeof tag === "string" && tag) return tag; why += "; the API had no tag_name"; }
      else why += `; api.github.com answered ${r.status}`;
    } catch (e: any) { why += `; api.github.com: ${String(e?.message ?? e).slice(0, 80)}`; }
    if (attempt < 4) { o.log?.(`GitHub did not answer (${why}), trying again...`); await wait(attempt * pause * 1000); }
  }
  throw new Error(`could not reach GitHub to find the latest release (${why}). Check your connection, or pick one with: phonedesk update --version <x.y.z>`);
}

/** The release asset for this computer. */
export function assetName(): string {
  const a = arch();
  if (platform.id === "darwin") return `phonedesk-darwin-${a === "arm64" ? "arm64" : "x64"}`;
  if (platform.id === "win32") return "phonedesk-windows-x64.exe";
  throw new Error(`there is no PhoneDesk release for ${platform.id} yet`);
}

export function sumFor(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
  return null;
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Reads a release file: an http(s) URL (GitHub) or a folder (tests). Retries 3 times, 2 s apart. */
async function readRelease(base: string, name: string, o: { fetch?: typeof fetch; progress?: (done: number, total: number) => void; sleep?: (ms: number) => Promise<void> }): Promise<Uint8Array> {
  if (!/^https?:\/\//.test(base)) {
    const b = await readFile(join(base, name)).catch(() => null);
    if (!b) throw new Error(`not found: ${join(base, name)}`);
    o.progress?.(b.length, b.length);
    return b;
  }
  const f = o.fetch ?? fetch;
  let last = "";
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await f(`${base}/${name}`, { headers: { "user-agent": "phonedesk-update" }, redirect: "follow" });
      if (r.status === 404) throw new Error(`not found: ${base}/${name}`);
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const total = Number(r.headers.get("content-length")) || 0;
      const chunks: Uint8Array[] = []; let done = 0;
      const reader = r.body.getReader();
      for (;;) { const { value, done: end } = await reader.read(); if (end) break; chunks.push(value); done += value.length; o.progress?.(done, total); }
      return Buffer.concat(chunks);
    } catch (e: any) {
      last = String(e?.message ?? e);
      if (/not found/.test(last) || i === 3) break;
      await (o.sleep ?? sleep)(2000);
    }
  }
  throw new Error(`could not download ${name} (${last})`);
}

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: out + err };
  } catch (e: any) { return { code: 127, out: String(e?.message ?? e) }; }
}

export type UpdateResult =
  | { status: "available"; current: string; latest: string }
  | { status: "up-to-date"; current: string; latest: string }
  | { status: "updated"; current: string; latest: string };

export interface UpdateOptions extends LookupOptions {
  check?: boolean;
  version?: string;
  /** The program to replace (default: this one). */
  target?: string;
  current?: string;
  port?: number;
  tty?: boolean;
  out?: (s: string) => void;
  /** Restarts the background service when there is one; resolves true when it did. */
  restartService?: () => Promise<boolean>;
  /** The version the agent on the port reports (null: not answering). */
  agentVersion?: (port: number) => Promise<string | null>;
  verifyMs?: number;
}

/**
 * `phonedesk update [--version X] [--check]`: finds the release, downloads the .gz for this computer (the plain binary for
 * older releases), checks SHA256SUMS for both files, replaces its own program atomically, restarts the service if there is
 * one and checks that the agent now reports the new version.
 */
export async function runUpdate(o: UpdateOptions = {}): Promise<UpdateResult> {
  const out = o.out ?? ((s: string) => console.log(s));
  const current = o.current ?? currentVersion();
  const tag = o.version ? `v${bare(o.version)}` : await latestTag({ ...o, log: o.log ?? out });
  const latest = bare(tag);
  const cmp = cmpVersions(latest, current);
  if (o.check) {
    out(cmp > 0 ? `PhoneDesk ${current}: version ${latest} is available. Run: phonedesk update` : `PhoneDesk ${current} is up to date (latest release: ${latest})`);
    return { status: cmp > 0 ? "available" : "up-to-date", current, latest };
  }
  if (cmp === 0 || (cmp < 0 && !o.version)) { out(`Already up to date (${current})`); return { status: "up-to-date", current, latest }; }

  const target = o.target ?? process.execPath;
  if (/^bun(\.exe)?$/i.test(basename(target))) throw new Error("this copy of PhoneDesk runs from source, so there is no installed program to replace (use git pull). Install it with setup.sh / setup.ps1.");
  const base = (process.env.PHONEDESK_RELEASE_BASE ?? `${(process.env.PHONEDESK_GITHUB_URL ?? "https://github.com").replace(/\/+$/, "")}/${REPO}/releases/download/${tag}`).replace(/[\\/]+$/, "");
  const asset = assetName();
  const sums = Buffer.from(await readRelease(base, "SHA256SUMS", o)).toString("utf8");
  const wantRaw = sumFor(sums, asset);
  if (!wantRaw) throw new Error(`${asset} is not listed in SHA256SUMS; refusing to install it`);
  const wantGz = sumFor(sums, `${asset}.gz`);

  let bar = 0;
  const progress = (done: number, total: number) => {
    if (!o.tty) return;
    const pct = total ? Math.floor((done / total) * 100) : 0;
    if (pct === bar && done !== total) return;
    bar = pct;
    const w = 24, fill = total ? Math.round((done / total) * w) : 0;
    process.stdout.write(`\r  [${"#".repeat(fill)}${"-".repeat(w - fill)}] ${total ? `${pct}%` : ""} ${(done / 1048576).toFixed(1)}${total ? `/${(total / 1048576).toFixed(1)}` : ""} MB `);
    if (done === total) process.stdout.write("\n");
  };
  let raw: Uint8Array | null = null;
  if (wantGz) {
    out(`Downloading ${asset}.gz (version ${latest})`);
    try {
      const gz = await readRelease(base, `${asset}.gz`, { ...o, progress });
      if (sha(gz) !== wantGz) throw new Error(`${asset}.gz does not match its SHA256SUMS entry. Nothing was changed.`);
      raw = gunzipSync(gz);
    } catch (e: any) {
      if (/does not match/.test(String(e?.message))) throw e;
      out(`the compressed download failed (${String(e?.message ?? e).slice(0, 80)}); trying the plain binary`);
    }
  }
  if (!raw) {
    out(`Downloading ${asset} (version ${latest})`);
    raw = await readRelease(base, asset, { ...o, progress });
  }
  if (sha(raw) !== wantRaw) throw new Error(`${asset} does not match its SHA256SUMS entry. Nothing was changed.`);

  // stage next to the program (same volume, so the final rename is atomic), check that it runs, then swap
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const staged = join(dir, platform.id === "win32" ? ".phonedesk.update.exe" : ".phonedesk.update");
  await writeFile(staged, raw);
  await chmod(staged, 0o755);
  try {
    if (platform.id === "darwin") {
      await run(["xattr", "-d", "com.apple.quarantine", staged]);
      const cs = await run(["codesign", "--force", "-s", "-", staged]);
      if (cs.code !== 0) out("could not sign the new program (codesign failed); it may not start");
    }
    const v = await run([staged, "--version"]);
    const reported = /^phonedesk (\S+)/m.exec(v.out)?.[1];
    if (v.code !== 0 || !reported) throw new Error("the downloaded program does not run on this computer");
    if (reported !== latest && !o.version) throw new Error(`the download reports version ${reported}, expected ${latest}`);
    if (platform.id === "win32") {
      // the running exe cannot be overwritten but it can be renamed; the .old file is removed the next time PhoneDesk starts
      const old = `${target}.old`;
      await rm(old, { force: true });
      if (existsSync(target)) await rename(target, old);
      try { await rename(staged, target); } catch (e) { await rename(old, target).catch(() => {}); throw e; }
    } else {
      await rename(staged, target);
    }
  } catch (e) {
    await rm(staged, { force: true });
    throw e;
  }

  // setup.sh / setup.ps1 read this to know the install is intact and which release it came from
  try {
    const marker = join(dir, ".release");
    const keep = (await readFile(marker, "utf8").catch(() => "")).split("\n").filter((l) => l.startsWith("svc="));
    const installed = sha(await readFile(target));
    await writeFile(marker, [`raw=${wantRaw} installed=${installed}`, ...keep].join("\n") + "\n");
  } catch { /* not fatal */ }

  let restarted = false;
  try { restarted = (await o.restartService?.()) ?? false; } catch (e: any) { out(`could not restart the background service (${String(e?.message ?? e).slice(0, 80)}); restart PhoneDesk yourself`); }
  if (restarted && o.agentVersion) {
    const deadline = Date.now() + (o.verifyMs ?? 20_000);
    let seen: string | null = null;
    while (Date.now() < deadline) { seen = await o.agentVersion(o.port ?? 7420); if (seen === bare(latest)) break; await sleep(500); }
    if (seen !== bare(latest)) throw new Error(`the program was replaced, but the agent on port ${o.port ?? 7420} reports ${seen ?? "nothing"} instead of ${latest}. Look at ~/.phonedesk/logs/agent.err.log, or run: phonedesk service restart`);
  }
  out(`Updated ${current} -> ${latest}${restarted ? "" : "\nRestart PhoneDesk to use the new version (a running agent keeps the old one until then)."}`);
  return { status: "updated", current, latest };
}

// ---------- GET /api/update: a cached, switch-off-able check ----------

export interface UpdateInfo { current: string; latest: string | null; available: boolean; checkedAt: number | null; enabled: boolean; error?: string }
export const UPDATE_TTL_MS = 24 * 3600_000;

/** One release lookup per day (also when it failed), never when switched off or when upstream updates are disabled. */
export class UpdateChecker {
  private cache: { at: number; latest: string | null; error?: string } | null = null;
  private inflight: Promise<void> | null = null;
  constructor(private o: { latest?: () => Promise<string>; now?: () => number; current?: () => string } = {}) {}
  async get(enabled: boolean, force = false): Promise<UpdateInfo> {
    const current = this.o.current?.() ?? currentVersion();
    const now = (this.o.now ?? Date.now)();
    if (!enabled || upstreamUpdatesDisabled()) {
      return { current, latest: null, available: false, checkedAt: null, enabled: false, ...(upstreamUpdatesDisabled() ? { error: "upstream updates disabled (PHONEDESK_NO_UPSTREAM_UPDATE=1)" } : {}) };
    }
    if (force || !this.cache || now - this.cache.at >= UPDATE_TTL_MS) {
      this.inflight ??= (async () => {
        try { this.cache = { at: now, latest: bare(await (this.o.latest ?? (() => latestTag({ retrySeconds: 1 })))()) }; }
        catch (e: any) { this.cache = { at: now, latest: this.cache?.latest ?? null, error: String(e?.message ?? e).slice(0, 120) }; }
      })().finally(() => { this.inflight = null; });
      await this.inflight;
    }
    const c = this.cache!;
    return { current, latest: c.latest, available: !!c.latest && cmpVersions(c.latest, current) > 0, checkedAt: c.at, enabled: true, ...(c.error ? { error: c.error } : {}) };
  }
}
