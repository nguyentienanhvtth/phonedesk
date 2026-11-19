import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { HOME } from "./config";
import { ASK_EVENT, ASK_MARKER, HOOK_EVENT, HOOK_MARKER, hookConfigPath, uninstallAskHook, uninstallHook, type HookTool } from "./hooks-install";
import { copyFile } from "node:fs/promises";
import { osId, platform } from "./platform";
import { runCode } from "./platform/exec";
import { winInstall, winRestart, winStatus, winUninstall, type WinServiceCtx } from "./platform/win32/service";

/** launchd label and plist name of the background service (macOS). */
export const SERVICE_LABEL = "dev.phonedesk.agent";

/** Where the plist goes. PHONEDESK_LAUNCH_AGENTS_DIR overrides it (tests, a relocated install). */
export const launchAgentsDir = (): string => process.env.PHONEDESK_LAUNCH_AGENTS_DIR ?? join(homedir(), "Library", "LaunchAgents");
export const plistPath = (): string => join(launchAgentsDir(), `${SERVICE_LABEL}.plist`);
export const logsDir = (): string => join(HOME, "logs");

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PlistOptions {
  /** The program and its arguments, e.g. ["/Users/me/.phonedesk/bin/phonedesk", "--port", "7420"]. */
  args: string[];
  /** Extra environment (PHONEDESK_HOME when not the default, ...). */
  env?: Record<string, string>;
  logDir?: string;
}

/** The launchd property list: starts at login, restarts only after a crash (a clean exit stays stopped), logs to ~/.phonedesk/logs. */
export function buildPlist(o: PlistOptions): string {
  const logs = o.logDir ?? logsDir();
  // launchd gives agents a minimal PATH; add the usual Homebrew locations so nowplaying-cli, playerctl and agy are found
  const env: Record<string, string> = { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", ...(o.env ?? {}) };
  const envXml = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${o.args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(join(logs, "agent.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logs, "agent.err.log"))}</string>
</dict>
</plist>
`;
}

export interface ServiceDeps {
  /** Runs launchctl (or PHONEDESK_LAUNCHCTL, e.g. `echo`) with these arguments. */
  launchctl: (args: string[]) => Promise<{ code: number; out: string }>;
  uid: number;
  platform: NodeJS.Platform;
  /** The program the service runs: the compiled binary, or [bun, index.ts] when run from source. */
  program: string[];
  log: (line: string) => void;
  /** Windows: runs schtasks / reg / powershell (tests pass a fake). */
  winRun?: (argv: string[]) => Promise<{ code: number; out: string }>;
  /** Windows: where launch.vbs lives (default %LOCALAPPDATA%\\PhoneDesk). */
  winDir?: string;
}

/** %LOCALAPPDATA%\PhoneDesk: the launcher script of the Windows service. PHONEDESK_WIN_DIR overrides it (tests). */
export const winServiceDir = (): string => process.env.PHONEDESK_WIN_DIR ?? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "PhoneDesk");

function winCtx(d: ServiceDeps, port?: number): WinServiceCtx {
  const env: Record<string, string> = {};
  if (process.env.PHONEDESK_HOME) env.PHONEDESK_HOME = process.env.PHONEDESK_HOME;
  return { run: d.winRun ?? ((argv) => runCode(argv, 15_000)), dir: d.winDir ?? winServiceDir(), logDir: logsDir(), program: d.program, env, port, selfPid: process.pid, log: d.log };
}

export async function runLaunchctl(args: string[]): Promise<{ code: number; out: string }> {
  const bin = process.env.PHONEDESK_LAUNCHCTL ?? "launchctl";
  try {
    const p = Bun.spawn([...bin.split(" ").filter(Boolean), ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: (out + err).trim() };
  } catch (e: any) {
    return { code: 127, out: String(e?.message ?? e) };
  }
}

/** The command the service runs: `phonedesk` itself, or `bun <index.ts>` when started from source. */
export function defaultProgram(): string[] {
  const exe = process.execPath;
  return /^bun(\.exe)?$/i.test(basename(exe)) ? [exe, join(import.meta.dir, "index.ts")] : [exe];
}

export const realServiceDeps = (log: (l: string) => void = (l) => console.log(l)): ServiceDeps => ({
  launchctl: runLaunchctl,
  uid: process.getuid?.() ?? 501,
  platform: platform.id,
  program: defaultProgram(),
  log,
});

const domain = (d: ServiceDeps) => `gui/${d.uid}`;
const target = (d: ServiceDeps) => `${domain(d)}/${SERVICE_LABEL}`;

function needMac(d: ServiceDeps) {
  if (d.platform !== "darwin" && d.platform !== "win32" && !process.env.PHONEDESK_LAUNCHCTL) throw new Error("The background service is only available on macOS and Windows. Run `phonedesk` in a terminal instead.");
}

/** Writes the plist and (re)loads it: launchctl bootout (ignored if not loaded), then bootstrap. The agent starts at once (RunAtLoad). */
export async function serviceInstall(d: ServiceDeps, opts: { port?: number } = {}): Promise<{ plist: string; loaded: boolean }> {
  needMac(d);
  if (d.platform === "win32") return { plist: (await winInstall(winCtx(d, opts.port))).launcher, loaded: true };
  const args = [...d.program];
  if (opts.port !== undefined && opts.port !== 7420) args.push("--port", String(opts.port));
  const env: Record<string, string> = {};
  if (process.env.PHONEDESK_HOME) env.PHONEDESK_HOME = process.env.PHONEDESK_HOME;
  const file = plistPath();
  await mkdir(dirname(file), { recursive: true });
  await mkdir(logsDir(), { recursive: true, mode: 0o700 });
  await writeFile(file, buildPlist({ args, env }), { mode: 0o644 });
  await chmod(file, 0o644);
  await d.launchctl(["bootout", target(d)]); // not loaded is fine
  const r = await d.launchctl(["bootstrap", domain(d), file]);
  if (r.code !== 0) throw new Error(`launchctl bootstrap failed (${r.code}): ${r.out || "no output"}`);
  d.log(`Service installed: ${file}`);
  return { plist: file, loaded: true };
}

export async function serviceUninstall(d: ServiceDeps): Promise<{ removed: boolean }> {
  needMac(d);
  if (d.platform === "win32") return winUninstall(winCtx(d));
  const file = plistPath();
  const had = await stat(file).then(() => true, () => false);
  await d.launchctl(["bootout", target(d)]);
  if (had) await rm(file, { force: true });
  d.log(had ? `Service removed: ${file}` : "Service was not installed.");
  return { removed: had };
}

export async function serviceRestart(d: ServiceDeps): Promise<void> {
  needMac(d);
  if (d.platform === "win32") return winRestart(winCtx(d));
  if (!(await stat(plistPath()).then(() => true, () => false))) throw new Error("The service is not installed. Run `phonedesk service install`.");
  const r = await d.launchctl(["kickstart", "-k", target(d)]);
  if (r.code !== 0) {
    // not loaded (for example after a reboot with it booted out): load it again
    const b = await d.launchctl(["bootstrap", domain(d), plistPath()]);
    if (b.code !== 0) throw new Error(`launchctl kickstart failed (${r.code}): ${r.out || "no output"}`);
  }
  d.log("Service restarted.");
}

export interface ServiceStatus { installed: boolean; running: boolean; pid?: number; plist: string; program?: string }

/** `launchctl print` output -> running state and pid. */
export function parsePrint(out: string): { running: boolean; pid?: number } {
  const pid = /^\s*pid = (\d+)/m.exec(out)?.[1];
  const state = /^\s*state = (\w+)/m.exec(out)?.[1];
  return { running: state === "running" || pid !== undefined, ...(pid ? { pid: Number(pid) } : {}) };
}

export async function serviceStatus(d: ServiceDeps): Promise<ServiceStatus> {
  needMac(d);
  if (d.platform === "win32") return winStatus(winCtx(d));
  const file = plistPath();
  const text = await readFile(file, "utf8").catch(() => null);
  const program = text ? /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(text)?.[1] : undefined;
  if (text === null) return { installed: false, running: false, plist: file };
  const r = await d.launchctl(["print", target(d)]);
  return { installed: true, ...(r.code === 0 ? parsePrint(r.out) : { running: false }), plist: file, ...(program ? { program } : {}) };
}

export function formatStatus(s: ServiceStatus): string {
  if (!s.installed) return "Service: not installed (run `phonedesk service install`)";
  return `Service: installed, ${s.running ? `running${s.pid ? ` (pid ${s.pid})` : ""}` : "not running"}\n${s.plist.endsWith(".vbs") ? "Launcher:" : "Plist:   "} ${s.plist}${s.program ? `\nProgram: ${s.program}` : ""}`;
}

// ---------- hooks that point at an older binary ----------

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** `'<exe>'` for the compiled binary, `'<bun>' '<index.ts>'` from source (same convention as hookCommand). */
const programWords = (program: string[], ps = false) =>
  (ps ? "& " : "") + program.map((p) => (ps ? `'${platform.hookPath(p).replace(/'/g, "''")}'` : shq(platform.hookPath(p)))).join(" ");

/**
 * Swaps the program part of one of our hook commands: `<old program> hook <tool>[args] # marker` keeps everything after `hook`.
 * Codex on Windows runs hooks in PowerShell, so its command keeps (or gets) the `& '<program>'` form hookCommand writes there.
 */
export function repointCommand(command: string, program: string[], os: string = osId()): string | null {
  const m = /^(.*?) hook (claude-ask|claude|codex)(.*)$/s.exec(command);
  if (!m) return null;
  const ps = m[1]!.startsWith("& ") || (m[2] === "codex" && os === "win32");
  const next = `${programWords(program, ps)} hook ${m[2]}${m[3]}`;
  return next === command ? null : next;
}

export interface Instance { port: number; home: string }

const DEFAULT_PORT = 7420;
const unq = (v: string) => (v.startsWith("'") ? v.slice(1, -1).replace(/'\\''/g, "'") : v);

/** The instance a hook command belongs to: its --port and --home, defaults included (what hookCommand leaves out). */
export function commandInstance(command: string, defaultHome: string = join(homedir(), ".phonedesk")): Instance {
  const port = /\s--port[ =](\d+)/.exec(command)?.[1];
  const home = /\s--home[ =]('(?:[^']|'\\'')*'|\S+)/.exec(command)?.[1];
  return { port: port ? Number(port) : DEFAULT_PORT, home: resolve(home ? unq(home) : defaultHome) };
}

export const sameInstance = (a: Instance, b: Instance): boolean => a.port === b.port && resolve(a.home) === resolve(b.home);

/** The instance this process serves: PHONEDESK_HOME (or ~/.phonedesk) and the given port (default 7420). */
export const currentInstance = (port?: number): Instance => ({ port: port ?? (Number(process.env.PHONEDESK_PORT) || DEFAULT_PORT), home: resolve(HOME) });

/**
 * Which hook files this process may touch. With a non-default PHONEDESK_HOME (a test or second instance) and no explicit
 * PHONEDESK_CLAUDE_DIR / PHONEDESK_CODEX_DIR, the real ~/.claude and ~/.codex are left alone and a note says so.
 */
export function hookTargets(files: Partial<Record<HookTool, string>> = {}): { files: Partial<Record<HookTool, string>>; skipped: string[]; notes: string[] } {
  const sandboxed = resolve(HOME) !== resolve(join(homedir(), ".phonedesk"));
  const out: Partial<Record<HookTool, string>> = {};
  const skipped: string[] = [];
  const notes: string[] = [];
  for (const [tool, envName] of [["claude", "PHONEDESK_CLAUDE_DIR"], ["codex", "PHONEDESK_CODEX_DIR"]] as const) {
    if (files[tool]) { out[tool] = files[tool]; continue; }
    if (sandboxed && !process.env[envName]) {
      skipped.push(tool);
      notes.push(`PHONEDESK_HOME is not the default and ${envName} is not set: leaving the ${tool} hooks (${hookConfigPath(tool)}) alone.`);
      continue;
    }
    out[tool] = hookConfigPath(tool);
  }
  return { files: out, skipped, notes };
}

/**
 * After an upgrade the binary may live somewhere else. Re-points our installed Claude/Codex hooks (found by their marker;
 * other hooks are never touched) at `program`, but ONLY hooks that belong to this instance: the same --port and --home
 * (defaults included). Hooks of another instance are left as they are. A backup `<file>.phonedesk.bak` is written first.
 */
export async function repointHooks(files: Partial<Record<HookTool, string>>, program: string[], instance: Instance = currentInstance()): Promise<Array<{ file: string; changed: number }>> {
  const out: Array<{ file: string; changed: number }> = [];
  for (const tool of ["claude", "codex"] as const) {
    const file = files[tool];
    if (!file) continue;
    let data: any;
    try { data = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
    let changed = 0;
    for (const [event, marker] of [[HOOK_EVENT, HOOK_MARKER], [ASK_EVENT, ASK_MARKER]] as const) {
      for (const g of Array.isArray(data?.hooks?.[event]) ? data.hooks[event] : []) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          if (typeof h?.command !== "string" || !h.command.includes(marker)) continue;
          if (!sameInstance(commandInstance(h.command), instance)) continue;
          const next = repointCommand(h.command, program);
          if (next) { h.command = next; changed++; }
        }
      }
    }
    if (changed) {
      await copyFile(file, `${file}.phonedesk.bak`);
      await writeFile(file, JSON.stringify(data, null, 2) + "\n");
    }
    out.push({ file, changed });
  }
  return out;
}

/** Removes every PhoneDesk hook entry (permission and question hooks) from the Claude and Codex configs, with a backup. */
export async function removeHooks(files: Partial<Record<HookTool, string>> = {}): Promise<Array<{ file: string; changed: boolean }>> {
  const t = hookTargets(files).files;
  const out: Array<{ file: string; changed: boolean }> = [];
  for (const [file, fns] of [[t.claude, [uninstallHook, uninstallAskHook]], [t.codex, [uninstallHook]]] as const) {
    if (!file) continue;
    let changed = false;
    for (const fn of fns) { try { changed = (await fn(file)).changed || changed; } catch { /* unreadable or not JSON: leave it alone */ } }
    out.push({ file, changed });
  }
  return out;
}
