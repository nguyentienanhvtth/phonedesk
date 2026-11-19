import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CpuTempReading } from "./types";

/** Program names from `ps -axco comm=` / `ps -eo comm=` (one per line, duplicates dropped). */
export function parsePsNames(out: string): string[] {
  const seen = new Set<string>();
  for (const line of out.split("\n")) { const n = line.trim(); if (n) seen.add(n.replace(/^.*\//, "")); }
  return [...seen];
}

/** `lsappinfo info -only name <asn>` prints `"LSDisplayName"="Safari"` (or `"name"=...`): the quoted value. */
export function parseLsappinfoName(out: string): string | null {
  const m = /"[^"]*"\s*=\s*"([^"]+)"/.exec(out);
  return m ? m[1]! : null;
}

const CPU_HWMON = /^(k10temp|coretemp|zenpower|cpu_thermal|x86_pkg_temp)$/;

/** Linux: the CPU package sensor from hwmon (k10temp/coretemp) or the x86_pkg_temp thermal zone; millidegrees. */
export async function linuxCpuTemp(root = "/sys/class"): Promise<CpuTempReading> {
  const read = async (p: string) => (await readFile(p, "utf8")).trim();
  try {
    for (const h of await readdir(join(root, "hwmon"))) {
      const dir = join(root, "hwmon", h);
      const name = await read(join(dir, "name")).catch(() => "");
      if (!CPU_HWMON.test(name)) continue;
      const v = Number(await read(join(dir, "temp1_input")).catch(() => ""));
      if (Number.isFinite(v) && v > 0) return { celsius: Math.round(v / 100) / 10, source: "sysfs", sensor: name };
    }
  } catch { /* no hwmon */ }
  try {
    for (const z of await readdir(join(root, "thermal"))) {
      if (!z.startsWith("thermal_zone")) continue;
      const type = await read(join(root, "thermal", z, "type")).catch(() => "");
      if (!CPU_HWMON.test(type)) continue;
      const v = Number(await read(join(root, "thermal", z, "temp")).catch(() => ""));
      if (Number.isFinite(v) && v > 0) return { celsius: Math.round(v / 100) / 10, source: "sysfs", sensor: type };
    }
  } catch { /* no thermal zones */ }
  return { celsius: null, source: "none" };
}
