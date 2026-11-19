import type { AudioDevice, AudioSession, CpuTempReading, CpuTempSource } from "../types";

/** Pure readers for the helper's gaming replies (audio sessions, devices, CPU temperature): only well-formed rows pass. */

export function parseSessions(rows: unknown): AudioSession[] {
  if (!Array.isArray(rows)) return [];
  const out: AudioSession[] = [];
  for (const r of rows as any[]) {
    if (!r || typeof r.app !== "string" || !r.app || !Number.isFinite(r.pid)) continue;
    out.push({ pid: Number(r.pid), app: r.app, level: Math.max(0, Math.min(100, Math.round(Number(r.level) || 0))), muted: !!r.muted, active: !!r.active });
  }
  return out;
}

export function parseDevices(rows: unknown): AudioDevice[] {
  if (!Array.isArray(rows)) return [];
  const out: AudioDevice[] = [];
  for (const r of rows as any[]) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    out.push({ id: r.id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id, isDefault: !!r.isDefault });
  }
  return out;
}

const SOURCES: CpuTempSource[] = ["librehardwaremonitor", "openhardwaremonitor", "acpi", "sysfs", "none"];
export function parseCpuTemp(v: unknown): CpuTempReading {
  const o = (v ?? {}) as any;
  const source: CpuTempSource = SOURCES.includes(o.source) ? o.source : "none";
  const c = Number(o.celsius);
  if (o.celsius === null || o.celsius === undefined || !Number.isFinite(c) || c <= 0 || c > 150) return { celsius: null, source: "none" };
  return { celsius: Math.round(c * 10) / 10, source, ...(typeof o.sensor === "string" && o.sensor ? { sensor: o.sensor.slice(0, 60) } : {}) };
}

/** Windows audio endpoint ids look like {0.0.0.00000000}.{guid}; anything else is never handed to the helper. */
export const WIN_DEVICE_ID_RE = /^\{[0-9.]+\}\.\{[0-9a-fA-F-]+\}$/;
