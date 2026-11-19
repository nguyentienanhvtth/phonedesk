import { buildCommand, buildVolumeCommand, parsePactlVolume, xdotoolKey } from "../actions";
import { linuxCpuTemp, parsePsNames } from "./unix-gaming";
import { parsePlayerctl, type RawMedia } from "../media";

const US = "\u001f"; // not imported from ../media: that module imports this one, and a const read during the cycle is still in its TDZ
import { parseProcNetDev } from "../stats";
import { parsePs, topProcessesFrom } from "../processes";
import { t } from "../i18n";
import { runCapture } from "./exec";
import type { Platform } from "./types";

const LINUX_FORMAT = ["{{playerName}}", "{{status}}", "{{title}}", "{{artist}}", "{{album}}", "{{position}}", "{{mpris:length}}", "{{mpris:artUrl}}"].join(US);

async function readLinux(): Promise<RawMedia | null> {
  if (!Bun.which("playerctl")) return null;
  try {
    return parsePlayerctl(await runCapture(["playerctl", "metadata", "--format", LINUX_FORMAT], 3000));
  } catch {
    return null; // "No players found" exits non-zero
  }
}

/** Best effort: Linux is not a supported target, but the code that worked keeps working. */
export function createLinux(id: NodeJS.Platform = "linux", which: (n: string) => string | null = (n) => Bun.which(n)): Platform {
  return {
    id,
    label: "Linux",
    keyNames: { cmd: "Super", alt: "Alt", ctrl: "Ctrl" },

    async runAction(a) { await runCapture(buildCommand(a, "linux")); },

    async readVolume() {
      try {
        const [v, m] = await Promise.all([
          runCapture(["pactl", "get-sink-volume", "@DEFAULT_SINK@"], 3000),
          runCapture(["pactl", "get-sink-mute", "@DEFAULT_SINK@"], 3000),
        ]);
        return parsePactlVolume(v, m);
      } catch { return null; }
    },
    async setVolume(v) { await runCapture(buildVolumeCommand(v, "linux")); },

    readMedia: readLinux,
    async fetchArtwork(raw) { return raw.artworkUrl && /^https?:/.test(raw.artworkUrl) ? raw.artworkUrl : undefined; },
    async resumeMedia() {
      if (which("playerctl")) { await runCapture(["playerctl", "play"], 3000); return; }
      throw new Error(t("Playing music is not supported on this operating system"));
    },
    async openMediaApp() { throw new Error(t("Opening the music app is not supported on this operating system")); },

    async netCounters() {
      try { return parseProcNetDev(await Bun.file("/proc/net/dev").text()); } catch { return undefined; }
    },
    async memUsed() { return undefined; },
    async topProcesses(sort, limit) {
      return topProcessesFrom(parsePs(await runCapture(["ps", "-Ao", "pid,pcpu,rss,comm"], 5000)), sort, limit);
    },
    async lanName() { return undefined; },

    async runningApps() { return parsePsNames(await runCapture(["ps", "-eo", "comm="], 5000)); },
    async holdKeys(keys, down) {
      if (!which("xdotool")) throw new Error(t("Holding keys needs xdotool"));
      await runCapture(["xdotool", down ? "keydown" : "keyup", "--", xdotoolKey(keys)], 3000);
    },
    cpuTemp: () => linuxCpuTemp(),

    apps: null,
    soundCommand(path, volume) {
      if (which("paplay")) return ["paplay", `--volume=${Math.round((volume / 100) * 65536)}`, path];
      if (which("aplay")) return ["aplay", "-q", path];
      throw new Error("paplay or aplay is not installed");
    },
    async soundDuration() { return undefined; },

    secrets: null,
    async claudeCredentials() { return null; },
    loadKind: "loadavg",
    async idleSeconds() { return null; },

    openExternal: async (url) => void (await runCapture(["xdg-open", url], 5000)),
    hookPath: (p) => p,
    dispose: () => {},
  };
}
