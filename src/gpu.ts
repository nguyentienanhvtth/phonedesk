import { platform } from "./platform";

export interface GpuStats {
  name: string;
  loadPercent: number;
  tempC: number;
  memUsedMB: number;
  memTotalMB: number;
  powerW: number | null;
  clockMHz: number | null;
  memClockMHz: number | null;
}

export interface GpuReading {
  available: boolean;
  stats: GpuStats | null;
  error?: string;
}

const CSV_FIELDS = [
  "name",
  "utilization.gpu",
  "temperature.gpu",
  "memory.used",
  "memory.total",
  "power.draw",
  "clocks.current.graphics",
  "clocks.current.memory",
].join(",");

const NVIDIA_SMI_ARGS = [
  "--query-gpu=" + CSV_FIELDS,
  "--format=csv,noheader,nounits",
];

export function parseNvidiaSmiOutput(output: string): GpuStats | null {
  const line = output.trim().split("\n")[0];
  if (!line) return null;
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 5) return null;

  const name = parts[0] || "NVIDIA GPU";
  const loadPercent = parseInt(parts[1] || "0", 10);
  const tempC = parseInt(parts[2] || "0", 10);
  const memUsedMB = parseInt(parts[3] || "0", 10);
  const memTotalMB = parseInt(parts[4] || "0", 10);
  const powerW = parts[5] && parts[5] !== "[Not Supported]" ? parseFloat(parts[5]) : null;
  const clockMHz = parts[6] && parts[6] !== "[Not Supported]" ? parseInt(parts[6], 10) : null;
  const memClockMHz = parts[7] && parts[7] !== "[Not Supported]" ? parseInt(parts[7], 10) : null;

  if (!Number.isFinite(loadPercent) || !Number.isFinite(tempC)) return null;

  return {
    name,
    loadPercent: Math.max(0, Math.min(100, loadPercent)),
    tempC,
    memUsedMB: Math.max(0, memUsedMB),
    memTotalMB: Math.max(0, memTotalMB),
    powerW: powerW !== null && Number.isFinite(powerW) ? powerW : null,
    clockMHz: clockMHz !== null && Number.isFinite(clockMHz) ? clockMHz : null,
    memClockMHz: memClockMHz !== null && Number.isFinite(memClockMHz) ? memClockMHz : null,
  };
}

let cachedPath: string | null | undefined;
let lastRead: { at: number; stats: GpuStats | null } | undefined;
const CACHE_MS = 1500;

function findNvidiaSmi(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  if (platform.id === "win32") {
    const paths = [
      "C:\\Windows\\System32\\nvidia-smi.exe",
      "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
    ];
    for (const p of paths) {
      try {
        const stat = Bun.spawnSync(["cmd", "/c", "if exist", `"${p}"`, "echo", "1"], { stdout: "pipe" });
        if (stat.stdout.toString().includes("1")) {
          cachedPath = p;
          return p;
        }
      } catch { /* continue */ }
    }
    const which = Bun.which("nvidia-smi");
    cachedPath = which ?? null;
    return cachedPath;
  }
  const which = Bun.which("nvidia-smi");
  cachedPath = which ?? null;
  return cachedPath;
}

export async function readGpu(): Promise<GpuReading> {
  const now = Date.now();
  if (lastRead && now - lastRead.at < CACHE_MS) {
    return { available: true, stats: lastRead.stats };
  }

  const exe = findNvidiaSmi();
  if (!exe) {
    return { available: false, stats: null, error: "nvidia-smi not found" };
  }

  try {
    const proc = Bun.spawn([exe, ...NVIDIA_SMI_ARGS], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
      return { available: false, stats: null, error: `nvidia-smi exited with code ${code}` };
    }
    const stats = parseNvidiaSmiOutput(stdout);
    lastRead = { at: now, stats };
    return { available: true, stats };
  } catch (e: any) {
    return { available: false, stats: null, error: String(e?.message ?? e) };
  }
}

export function gpuAvailable(): boolean {
  return findNvidiaSmi() !== null;
}

export function resetGpuCache(): void {
  cachedPath = undefined;
  lastRead = undefined;
}
