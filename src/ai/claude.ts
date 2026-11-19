import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { platform } from "../platform";
import { t } from "../i18n";
import { clampPercent, safeHome, type ProviderQuota, type QuotaWindow } from "./types";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/** English key; run through t() when shown. */
export const TOKEN_EXPIRED = "Claude Code token expired, open Claude Code to sign in again";
/** After a 401/403 the same token is not tried again for this long (Claude Code refreshes it itself). */
export const UNAUTHORIZED_BACKOFF_MS = 30 * 60_000;

/** 16-char sha256 fingerprint of a token: the only thing kept about it (never the token). */
export const tokenFingerprint = (token: string): string => createHash("sha256").update(token).digest("hex").slice(0, 16);

/** fingerprint -> ms until which that token is not tried. */
const blockedTokens = new Map<string, number>();
export const resetClaudeBackoff = () => blockedTokens.clear();

/** Claude Code config dir. Overridable for tests: PHONEDESK_CLAUDE_DIR, then CLAUDE_CONFIG_DIR. */
export function claudeDir(): string {
  return process.env.PHONEDESK_CLAUDE_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(safeHome(), ".claude");
}

export interface ClaudeCreds {
  accessToken: string;
  plan?: string;
  expiresAt?: number;
}

/** Parses the credentials JSON (file or Keychain) and returns the OAuth access token only. */
export function parseCredentials(text: string): ClaudeCreds | null {
  try {
    const o = JSON.parse(text)?.claudeAiOauth;
    if (!o || typeof o.accessToken !== "string" || !o.accessToken) return null;
    const plan = typeof o.subscriptionType === "string" && o.subscriptionType ? o.subscriptionType[0].toUpperCase() + o.subscriptionType.slice(1) : undefined;
    return { accessToken: o.accessToken, plan, expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : undefined };
  } catch {
    return null;
  }
}

export interface ClaudeDeps {
  readFile?: (path: string) => Promise<string>;
  readKeychain?: () => Promise<string>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  dir?: string;
  now?: () => number;
  platform?: NodeJS.Platform;
  /** Backoff store (tests); defaults to a module-level map. */
  blocked?: Map<string, number>;
}

/** Credentials file first, then (macOS) the Keychain entry. Never writes anything. */
export async function readClaudeToken(deps: ClaudeDeps = {}): Promise<ClaudeCreds | null> {
  const read = deps.readFile ?? ((p: string) => readFile(p, "utf8"));
  const file = join(deps.dir ?? claudeDir(), ".credentials.json");
  try {
    const c = parseCredentials(await read(file));
    if (c) return c;
  } catch {
    // no credentials file: try the Keychain
  }
  // an OS credential store (macOS Keychain), through the platform; tests pass a fake reader or another platform id
  if (deps.readKeychain || deps.platform) {
    if ((deps.platform ?? "darwin") !== "darwin") return null;
    try { return parseCredentials((await deps.readKeychain!()).trim()); } catch { return null; }
  }
  try {
    const raw = await platform.claudeCredentials();
    return raw ? parseCredentials(raw) : null;
  } catch {
    return null;
  }
}

const WINDOW_DEFS: Array<{ key: string; label: string; minutes: number }> = [
  { key: "five_hour", label: "5 hours", minutes: 300 },
  { key: "seven_day", label: "7 days", minutes: 10080 },
  { key: "seven_day_opus", label: "7 days · Opus", minutes: 10080 },
  { key: "seven_day_sonnet", label: "7 days · Sonnet", minutes: 10080 },
];

/** Maps the /api/oauth/usage response to windows. Entries that are null or not numeric are skipped. */
export function parseUsage(body: any): QuotaWindow[] {
  const out: QuotaWindow[] = [];
  if (!body || typeof body !== "object") return out;
  const seen = new Set<string>();
  const add = (key: string, label: string, minutes: number) => {
    const w = body[key];
    const used = w?.utilization ?? w?.used_percent;
    if (!w || typeof used !== "number" || !Number.isFinite(used)) return;
    seen.add(key);
    const reset = typeof w.resets_at === "string" ? Date.parse(w.resets_at) : typeof w.resets_at === "number" ? w.resets_at * (w.resets_at < 1e12 ? 1000 : 1) : NaN;
    out.push({ id: key, label, usedPercent: clampPercent(used), ...(Number.isFinite(reset) ? { resetsAt: reset } : {}), windowMinutes: minutes });
  };
  for (const d of WINDOW_DEFS) add(d.key, t(d.label), d.minutes);
  for (const key of Object.keys(body)) {
    if (!seen.has(key) && /^seven_day_/.test(key)) add(key, t("7 days · {name}", { name: key.slice(10) }), 10080);
  }
  return out;
}

/**
 * One usage read. Read-only: never refreshes or writes a token (Claude Code does that itself).
 * An expired token is skipped without a request; after a 401/403 the same token (by 16-char fingerprint) is left alone
 * for 30 minutes. On any failure the previous windows stay with the reason as the error. The token is never stored.
 */
export async function fetchClaudeQuota(deps: ClaudeDeps = {}, last?: ProviderQuota): Promise<ProviderQuota> {
  const now = (deps.now ?? Date.now)();
  const blocked = deps.blocked ?? blockedTokens;
  const keep = (error: string, plan?: string): ProviderQuota => ({
    id: "claude",
    name: "Claude",
    plan: plan ?? last?.plan,
    windows: last?.windows ?? [],
    error,
    updatedAt: now,
  });
  const creds = await readClaudeToken(deps);
  if (!creds) return keep(t("Sign in to Claude Code on this computer"));
  if (creds.expiresAt !== undefined && creds.expiresAt <= now) return keep(t(TOKEN_EXPIRED), creds.plan);
  const fp = tokenFingerprint(creds.accessToken);
  const until = blocked.get(fp);
  if (until !== undefined) {
    if (now < until) return keep(t(TOKEN_EXPIRED), creds.plan);
    blocked.delete(fp);
  }
  try {
    const res = await (deps.fetch ?? fetch)(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
        "User-Agent": "phonedesk",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      blocked.set(fp, now + UNAUTHORIZED_BACKOFF_MS);
      return keep(t(TOKEN_EXPIRED), creds.plan);
    }
    if (res.status === 429) return keep(t("Claude is rate limiting, will retry later"), creds.plan);
    if (!res.ok) return keep(t("Claude returned error {status}", { status: res.status }), creds.plan);
    const windows = parseUsage(await res.json());
    if (windows.length === 0) return keep(t("Could not read the Claude quota"), creds.plan);
    return { id: "claude", name: "Claude", plan: creds.plan, windows, updatedAt: now };
  } catch (err: any) {
    return keep(t("Could not reach Claude: {msg}", { msg: err?.message ?? err }), creds.plan);
  }
}
