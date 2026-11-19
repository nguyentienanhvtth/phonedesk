import { osId, platform } from "./platform";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { claudeDir } from "./ai/claude";
import { codexDir } from "./ai/codex";

export type HookTool = "claude" | "codex";
export const HOOK_MARKER = "phonedesk hook";
export const HOOK_EVENT = "PermissionRequest";
export const HOOK_TIMEOUT_S = 60;

export function hookConfigPath(tool: HookTool): string {
  return tool === "claude" ? join(claudeDir(), "settings.json") : join(codexDir(), "hooks.json");
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** PowerShell single quotes: a quote inside is doubled. */
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Absolute command for the hook. Compiled binary: `'<exe>' hook <tool>`; source mode: `'<bun>' '<abs>/src/index.ts' hook <tool>`.
 * A trailing shell comment carries the "phonedesk hook" marker used to find our entry again.
 */
export function hookCommand(
  tool: HookTool,
  opts: { execPath?: string; indexPath?: string; port?: number; home?: string; defaultHome?: string; os?: string } = {},
): string {
  const exe = platform.hookPath(opts.execPath ?? process.execPath);
  const isBun = /^bun(\.exe)?$/i.test(basename(exe));
  const index = platform.hookPath(opts.indexPath ?? join(import.meta.dir, "index.ts"));
  // Claude Code runs hooks with bash everywhere (Git Bash on Windows). Codex on Windows runs them in PowerShell, where a
  // quoted program name needs the call operator and quotes are escaped by doubling; `#` is a comment in both shells.
  const ps = tool === "codex" && (opts.os ?? osId()) === "win32";
  const q = ps ? psq : shq;
  const base = (ps ? "& " : "") + (isBun ? `${q(exe)} ${q(index)}` : q(exe));
  // Point the hook at the agent that installed it: without these it would call the default port with the
  // default secret, and an agent on another port or PHONEDESK_HOME would never see the request.
  let args = "";
  if (opts.port !== undefined && opts.port !== 7420) args += ` --port ${opts.port}`;
  if (opts.home && opts.home !== (opts.defaultHome ?? join(homedir(), ".phonedesk"))) args += ` --home ${q(platform.hookPath(opts.home))}`;
  return `${base} hook ${tool}${args} # ${HOOK_MARKER}`;
}

const isOurs = (h: any) => typeof h?.command === "string" && h.command.includes(HOOK_MARKER);

async function readConfig(file: string): Promise<{ data: any; existed: boolean }> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return { data: {}, existed: false };
    throw err;
  }
  if (!text.trim()) return { data: {}, existed: true };
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON; refusing to modify it`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} must contain a JSON object`);
  return { data, existed: true };
}

async function writeConfig(file: string, data: any, existed: boolean) {
  if (existed) await copyFile(file, `${file}.phonedesk.bak`);
  else await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

export async function isHookInstalled(file: string): Promise<boolean> {
  try {
    const { data } = await readConfig(file);
    return (data.hooks?.[HOOK_EVENT] ?? []).some((g: any) => (g?.hooks ?? []).some(isOurs));
  } catch {
    return false;
  }
}

/** Merges our PermissionRequest hook into `file`, keeping everything else. Idempotent; backs up to `<file>.phonedesk.bak` before a change. */
export async function installHook(file: string, command: string): Promise<{ changed: boolean }> {
  const { data, existed } = await readConfig(file);
  const hooks = (data.hooks ??= {});
  if (typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${file}: "hooks" must be an object`);
  const groups: any[] = (hooks[HOOK_EVENT] ??= []);
  if (!Array.isArray(groups)) throw new Error(`${file}: hooks.${HOOK_EVENT} must be an array`);

  let found = false;
  let changed = false;
  for (const g of groups) {
    for (const h of g?.hooks ?? []) {
      if (!isOurs(h)) continue;
      found = true;
      if (h.command !== command || h.timeout !== HOOK_TIMEOUT_S) {
        h.command = command;
        h.timeout = HOOK_TIMEOUT_S;
        changed = true;
      }
    }
  }
  if (!found) {
    groups.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] });
    changed = true;
  }
  if (changed) await writeConfig(file, data, existed);
  return { changed };
}

/** Removes only our entries (and groups left empty). Other hooks are untouched. */
export async function uninstallHook(file: string): Promise<{ changed: boolean }> {
  const { data, existed } = await readConfig(file);
  const groups: any[] | undefined = data.hooks?.[HOOK_EVENT];
  if (!existed || !Array.isArray(groups)) return { changed: false };
  let changed = false;
  const kept: any[] = [];
  for (const g of groups) {
    const inner: any[] = Array.isArray(g?.hooks) ? g.hooks : [];
    const rest = inner.filter((h) => !isOurs(h));
    if (rest.length !== inner.length) changed = true;
    if (rest.length > 0 || inner.length === 0) kept.push(rest.length !== inner.length ? { ...g, hooks: rest } : g);
  }
  if (!changed) return { changed: false };
  if (kept.length) data.hooks[HOOK_EVENT] = kept;
  else delete data.hooks[HOOK_EVENT];
  await writeConfig(file, data, existed);
  return { changed };
}


// ---------- the AskUserQuestion hook: its own PreToolUse entry, separate from the permission hook ----------

export const ASK_MARKER = "phonedesk hook claude-ask";
export const ASK_EVENT = "PreToolUse";
export const ASK_MATCHER = "AskUserQuestion";
export const ASK_TIMEOUT_S = 600;

/** `<exe> hook claude-ask [--port N] [--home DIR] # phonedesk hook claude-ask` (same conventions as hookCommand). */
export function askHookCommand(opts: { execPath?: string; indexPath?: string; port?: number; home?: string; defaultHome?: string } = {}): string {
  return hookCommand("claude", opts).replace(/ hook claude/, " hook claude-ask").replace(`# ${HOOK_MARKER}`, `# ${ASK_MARKER}`);
}

const isAsk = (h: any) => typeof h?.command === "string" && h.command.includes(ASK_MARKER);

export async function isAskHookInstalled(file: string): Promise<boolean> {
  try {
    const { data } = await readConfig(file);
    return (data.hooks?.[ASK_EVENT] ?? []).some((g: any) => (g?.hooks ?? []).some(isAsk));
  } catch {
    return false;
  }
}

/** Merges our PreToolUse/AskUserQuestion entry into `file`, keeping everything else. Idempotent; backs up first. */
export async function installAskHook(file: string, command: string): Promise<{ changed: boolean }> {
  const { data, existed } = await readConfig(file);
  const hooks = (data.hooks ??= {});
  if (typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${file}: "hooks" must be an object`);
  const groups: any[] = (hooks[ASK_EVENT] ??= []);
  if (!Array.isArray(groups)) throw new Error(`${file}: hooks.${ASK_EVENT} must be an array`);
  let found = false, changed = false;
  for (const g of groups) {
    const inner: any[] = g?.hooks ?? [];
    for (const h of inner) {
      if (!isAsk(h)) continue;
      found = true;
      if (h.command !== command || h.timeout !== ASK_TIMEOUT_S) { h.command = command; h.timeout = ASK_TIMEOUT_S; changed = true; }
      if (inner.every(isAsk) && g.matcher !== ASK_MATCHER) { g.matcher = ASK_MATCHER; changed = true; }
    }
  }
  if (!found) { groups.push({ matcher: ASK_MATCHER, hooks: [{ type: "command", command, timeout: ASK_TIMEOUT_S }] }); changed = true; }
  if (changed) await writeConfig(file, data, existed);
  return { changed };
}

/** Removes only our entry (and a group left empty). */
export async function uninstallAskHook(file: string): Promise<{ changed: boolean }> {
  const { data, existed } = await readConfig(file);
  const groups: any[] | undefined = data.hooks?.[ASK_EVENT];
  if (!existed || !Array.isArray(groups)) return { changed: false };
  let changed = false;
  const kept: any[] = [];
  for (const g of groups) {
    const inner: any[] = Array.isArray(g?.hooks) ? g.hooks : [];
    const rest = inner.filter((h) => !isAsk(h));
    if (rest.length !== inner.length) changed = true;
    if (rest.length > 0 || inner.length === 0) kept.push(rest.length !== inner.length ? { ...g, hooks: rest } : g);
  }
  if (!changed) return { changed: false };
  if (kept.length) data.hooks[ASK_EVENT] = kept; else delete data.hooks[ASK_EVENT];
  await writeConfig(file, data, existed);
  return { changed };
}
