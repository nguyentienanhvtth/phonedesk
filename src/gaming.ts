import type { Action } from "./config";
import type { AppVolumeChange, AudioDevice, AudioSession } from "./platform/types";
import { appKey } from "./automation";
import { t } from "./i18n";

/** Pure helpers for the gaming actions (per-app volume, device switch, held keys). */

export const APP_VOLUME_STEP = 10;

export function appVolumeChange(a: Extract<Action, { type: "app-volume" }>): AppVolumeChange {
  switch (a.command) {
    case "set": return { level: a.level ?? 100 };
    case "up": return { delta: a.step ?? APP_VOLUME_STEP };
    case "down": return { delta: -(a.step ?? APP_VOLUME_STEP) };
    case "mute": return { muted: true };
    case "unmute": return { muted: false };
    case "toggle-mute": return { muted: "toggle" };
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** The device a saved entry means: its id, else the exact name, else the only device whose name contains it. */
export function resolveDevice(devices: AudioDevice[], wanted: string): AudioDevice | undefined {
  const w = norm(wanted);
  return devices.find((d) => d.id === wanted)
    ?? devices.find((d) => norm(d.name) === w)
    ?? (() => { const hits = devices.filter((d) => norm(d.name).includes(w)); return hits.length === 1 ? hits[0] : undefined; })();
}

/**
 * Which device a press switches to. One entry: that device. Several: the one after the current default in the list
 * (devices that are not connected are skipped), so a button cycles headset → speakers → headset.
 */
export function pickDevice(devices: AudioDevice[], wanted: string[]): AudioDevice {
  const list: AudioDevice[] = [];
  for (const w of wanted) { const d = resolveDevice(devices, w); if (d && !list.some((x) => x.id === d.id)) list.push(d); }
  if (!list.length) throw new Error(wanted.length === 1 ? t("“{name}” is not connected", { name: wanted[0]! }) : t("none of the chosen audio devices is connected"));
  if (list.length === 1) return list[0]!;
  const cur = list.findIndex((d) => d.isDefault);
  return list[cur < 0 ? 0 : (cur + 1) % list.length]!;
}

/**
 * Keys held down by phone buttons (push-to-talk). Every hold ends: on release, when its phone disconnects, when the
 * layout changes, when the agent stops, and at the latest after maxMs, so a lost "up" never leaves a key stuck.
 */
export class HoldTracker<Owner> {
  private held = new Map<string, { owner: Owner; keys: string; timer: ReturnType<typeof setTimeout> }>();
  constructor(private o: { hold: (keys: string, down: boolean) => Promise<void>; maxMs?: number; onError?: (e: unknown) => void }) {}

  get size() { return this.held.size; }
  isHeld(key: string) { return this.held.has(key); }

  async down(key: string, owner: Owner, keys: string): Promise<void> {
    if (this.held.has(key)) return; // a second finger / a repeated down: already held
    const timer = setTimeout(() => void this.up(key), this.o.maxMs ?? HOLD_MAX_MS);
    (timer as any).unref?.();
    this.held.set(key, { owner, keys, timer });
    try {
      await this.o.hold(keys, true);
    } catch (e) {
      clearTimeout(timer);
      this.held.delete(key);
      throw e;
    }
  }

  async up(key: string): Promise<void> {
    const h = this.held.get(key);
    if (!h) return;
    clearTimeout(h.timer);
    this.held.delete(key);
    await this.o.hold(h.keys, false);
  }

  /** Releases everything one phone holds (it disconnected), or everything (owner undefined). */
  async release(owner?: Owner): Promise<void> {
    const keys = [...this.held.entries()].filter(([, h]) => owner === undefined || h.owner === owner).map(([k]) => k);
    for (const k of keys) await this.up(k).catch((e) => this.o.onError?.(e));
  }
}

/** A held button lets go by itself after 2 minutes: long enough for push-to-talk, short enough for a lost release. */
export const HOLD_MAX_MS = 120_000;

/**
 * One row per program for the volume mixer list: Windows keeps a session per stream and per device (Steam shows up
 * three times with one pid). The app-volume action already changes every session of the program, so the picker only
 * needs the name. Level/mute come from an active session when there is one; muted only when every session is.
 */
export function mergeSessions(list: AudioSession[]): AudioSession[] {
  const by = new Map<string, AudioSession[]>();
  for (const s of list) {
    const k = appKey(s.app);
    if (!k) continue;
    const g = by.get(k);
    if (g) g.push(s);
    else by.set(k, [s]);
  }
  return [...by.values()].map((g) => {
    const lead = g.find((s) => s.active) ?? g[0]!;
    return { pid: lead.pid, app: lead.app, level: lead.level, muted: g.every((s) => s.muted), active: g.some((s) => s.active) };
  });
}
