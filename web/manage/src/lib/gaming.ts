import { useEffect, useState } from "react";
import type { AudioDevice, AudioSession } from "@/types";

// Normalizers for the read-only gaming routes of the agent (GET /api/apps/running, /api/audio/sessions, /api/audio/devices).
// The agent answers {supported:false} on systems without the feature; the editor then lets you type the name by hand.

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200) : []);

export interface RunningApps { supported: boolean; running: string[]; foreground: string | null }
export function normalizeRunningApps(raw: unknown): RunningApps {
  const r = rec(raw);
  const running = Array.from(new Set(strs(r.running))).sort((a, b) => a.localeCompare(b));
  return { supported: r.supported !== false, running, foreground: typeof r.foreground === "string" && r.foreground ? r.foreground : null };
}

export function normalizeAudioSessions(raw: unknown): { supported: boolean; sessions: AudioSession[] } {
  const r = rec(raw);
  const sessions: AudioSession[] = [];
  for (const x of Array.isArray(r.sessions) ? r.sessions : []) {
    const s = rec(x);
    if (typeof s.app !== "string" || !s.app) continue;
    const level = typeof s.level === "number" && Number.isFinite(s.level) ? Math.max(0, Math.min(100, Math.round(s.level))) : 0;
    const row = { pid: typeof s.pid === "number" ? s.pid : 0, app: s.app, level, muted: s.muted === true, active: s.active === true };
    // one row per program (an older agent may still send one per Windows audio session)
    const k = s.app.toLowerCase().replace(/\.exe$/, "");
    const i = sessions.findIndex((x) => x.app.toLowerCase().replace(/\.exe$/, "") === k);
    if (i < 0) sessions.push(row);
    else if (row.active && !sessions[i]!.active) sessions[i] = { ...row, muted: row.muted && sessions[i]!.muted };
    else sessions[i] = { ...sessions[i]!, muted: sessions[i]!.muted && row.muted };
  }
  return { supported: r.supported !== false, sessions };
}

export function normalizeAudioDevices(raw: unknown): { supported: boolean; devices: AudioDevice[] } {
  const r = rec(raw);
  const devices: AudioDevice[] = [];
  for (const x of Array.isArray(r.devices) ? r.devices : []) {
    const d = rec(x);
    if (typeof d.id !== "string" || !d.id || typeof d.name !== "string") continue;
    devices.push({ id: d.id, name: d.name || d.id, isDefault: d.isDefault === true });
  }
  return { supported: r.supported !== false, devices };
}

/** Program names for a datalist: one per program (case-insensitive), sessions first. */
export function appChoices(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists) for (const n of l) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

/** Loads once on mount (and on reload()); errors leave data null with the message. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => { if (live) { setData(d); setError(null); } }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
