import { join } from "node:path";
import { open, readdir, stat } from "node:fs/promises";
import { clampPercent, safeHome, windowLabel, type ProviderQuota, type QuotaWindow } from "./types";
import { t } from "../i18n";

/** Codex home. Overridable for tests: PHONEDESK_CODEX_DIR, then CODEX_HOME. */
export function codexDir(): string {
  return process.env.PHONEDESK_CODEX_DIR ?? process.env.CODEX_HOME ?? join(safeHome(), ".codex");
}

/** Reads the last `bytes` of a file as text (drops a possibly cut first line). */
export async function tailText(file: string, bytes = 256 * 1024): Promise<string> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await fh.close();
  }
}

export async function headText(file: string, bytes = 64 * 1024): Promise<string> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    await fh.close();
  }
}

const sortDesc = (names: string[]) => names.sort().reverse();

/** Newest session files: walks sessions/YYYY/MM/DD newest first and stops once `limit` files are found, plus recent archived ones. */
export async function recentCodexFiles(dir = codexDir(), limit = 8): Promise<Array<{ file: string; mtime: number }>> {
  const found: Array<{ file: string; mtime: number }> = [];
  const add = async (file: string) => {
    try {
      found.push({ file, mtime: (await stat(file)).mtimeMs });
    } catch {
      // vanished between readdir and stat
    }
  };
  const ls = async (p: string) => readdir(p).catch(() => [] as string[]);
  const root = join(dir, "sessions");
  outer: for (const y of sortDesc(await ls(root))) {
    for (const m of sortDesc(await ls(join(root, y)))) {
      for (const d of sortDesc(await ls(join(root, y, m)))) {
        const names = (await ls(join(root, y, m, d))).filter((n) => n.endsWith(".jsonl"));
        for (const n of names) await add(join(root, y, m, d, n));
        if (found.length >= limit) break outer;
      }
    }
  }
  const archived = join(dir, "archived_sessions");
  for (const n of sortDesc((await ls(archived)).filter((n) => n.endsWith(".jsonl"))).slice(0, 4)) await add(join(archived, n));
  return found.sort((a, b) => b.mtime - a.mtime);
}

export interface RateLimitEvent {
  at: number; // event timestamp, ms
  plan?: string;
  windows: Array<{ id: string; usedPercent: number; windowMinutes?: number; resetsAt?: number }>;
}

/** Newest `rate_limits` payload that has a primary window, scanning lines from the end. */
export function parseLatestRateLimits(text: string): RateLimitEvent | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"rate_limits"')) continue;
    try {
      const o = JSON.parse(line);
      const rl = o?.payload?.rate_limits;
      if (!rl || !rl.primary || typeof rl.primary.used_percent !== "number") continue;
      if (rl.limit_id && rl.limit_id !== "codex") continue;
      const at = Date.parse(o.timestamp);
      const windows: RateLimitEvent["windows"] = [];
      for (const id of ["primary", "secondary"] as const) {
        const w = rl[id];
        if (!w || typeof w.used_percent !== "number") continue;
        windows.push({
          id,
          usedPercent: w.used_percent,
          windowMinutes: typeof w.window_minutes === "number" ? w.window_minutes : undefined,
          resetsAt: typeof w.resets_at === "number" ? w.resets_at * 1000 : undefined,
        });
      }
      return { at: Number.isFinite(at) ? at : 0, plan: typeof rl.plan_type === "string" ? rl.plan_type : undefined, windows };
    } catch {
      continue;
    }
  }
  return null;
}

/** A window whose reset time has passed is stale data: show it as fresh (0%) rather than the old figure. */
export function toQuotaWindows(ev: RateLimitEvent, now: number): QuotaWindow[] {
  return ev.windows.map((w) => {
    const expired = w.resetsAt !== undefined && w.resetsAt <= now;
    return {
      id: w.id,
      label: w.windowMinutes ? windowLabel(w.windowMinutes) : w.id === "primary" ? t("Primary") : t("Secondary"),
      usedPercent: expired ? 0 : clampPercent(w.usedPercent),
      ...(w.resetsAt !== undefined && !expired ? { resetsAt: w.resetsAt } : {}),
      ...(w.windowMinutes ? { windowMinutes: w.windowMinutes } : {}),
    };
  });
}

export async function fetchCodexQuota(dir = codexDir(), now = Date.now()): Promise<ProviderQuota> {
  let best: RateLimitEvent | null = null;
  try {
    for (const { file } of await recentCodexFiles(dir, 6)) {
      const ev = parseLatestRateLimits(await tailText(file).catch(() => ""));
      if (ev && (!best || ev.at > best.at)) best = ev;
    }
  } catch {
    // unreadable: report below
  }
  if (!best) return { id: "codex", name: "Codex", windows: [], error: t("No Codex quota data yet (use Codex once on this computer)"), updatedAt: now };
  const plan = best.plan ? best.plan[0]!.toUpperCase() + best.plan.slice(1) : undefined;
  return { id: "codex", name: "Codex", plan, windows: toQuotaWindows(best, now), updatedAt: now };
}
