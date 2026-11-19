import { useSyncExternalStore } from "react";

/** Platform of the machine the agent runs on (the management page is served from it). */
export type Platform = "darwin" | "win32" | "linux";

function guess(): Platform {
  try {
    const ua = `${navigator.userAgent} ${navigator.platform}`;
    if (/Win/i.test(ua)) return "win32";
    if (/Mac/i.test(ua)) return "darwin";
    if (/Linux|X11/i.test(ua)) return "linux";
  } catch {
    /* no navigator (tests) */
  }
  return "darwin";
}

let current: Platform = guess();
const listeners = new Set<() => void>();
export const getPlatform = (): Platform => current;
export function setPlatform(p: Platform): void {
  if (p === current) return;
  current = p;
  listeners.forEach((f) => f());
}
/** Accepts what the agent may call it: "win32"/"windows", "darwin"/"macos", "linux". */
export function asPlatform(v: unknown): Platform | undefined {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "win32" || s === "windows" || s === "win") return "win32";
  if (s === "darwin" || s === "macos" || s === "mac") return "darwin";
  if (s === "linux") return "linux";
  return undefined;
}
export function usePlatform(): Platform {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), () => current, () => "darwin");
}

const MAC: Record<string, string> = {
  cmd: "⌘", command: "⌘", meta: "⌘", win: "⌘", windows: "⌘", super: "⌘", start: "⌘", ctrl: "⌃", control: "⌃", alt: "⌥", option: "⌥", shift: "⇧",
  return: "↩", enter: "↩", delete: "⌫", forwarddelete: "⌦", escape: "⎋", esc: "⎋", tab: "⇥", space: "Space",
  up: "↑", down: "↓", left: "←", right: "→", pageup: "Page Up", pagedown: "Page Down",
};
/** On Windows the layout's canonical cmd/command/meta press Ctrl (see the agent's key table); win/super is the Windows key. */
const WIN: Record<string, string> = {
  cmd: "Ctrl", command: "Ctrl", meta: "Ctrl", win: "Win", windows: "Win", super: "Win", start: "Win", ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift",
  return: "Enter", enter: "Enter", delete: "Backspace", forwarddelete: "Del", escape: "Esc", esc: "Esc", tab: "Tab", space: "Space",
  up: "↑", down: "↓", left: "←", right: "→", pageup: "Page Up", pagedown: "Page Down",
};
/** The extra keys (F13-F24 go through the F-key rule): the same names everywhere. */
const EXTRA: Record<string, string> = {
  insert: "Ins", ins: "Ins", printscreen: "PrtSc", prtsc: "PrtSc", pause: "Pause", break: "Pause", capslock: "Caps Lock", caps: "Caps Lock",
  scrolllock: "Scroll Lock", numlock: "Num Lock", mediastop: "Stop", stop: "Stop",
  numadd: "Num +", numplus: "Num +", numsubtract: "Num −", numminus: "Num −", nummultiply: "Num ×", numdivide: "Num ÷", numdecimal: "Num .", numenter: "Num Enter",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num${i}`, `Num ${i}`])),
};

/** Key names to show for a canonical hotkey string ("cmd+shift+4"): ⌘ ⇧ 4 on macOS, Ctrl Shift 4 on Windows. Same-name modifiers collapse. */
export function hotkeyLabels(keys: string, platform: Platform = getPlatform()): string[] {
  const table = platform === "darwin" ? MAC : WIN;
  const out: string[] = [];
  for (const raw of keys.split("+").map((k) => k.trim()).filter(Boolean)) {
    const k = raw.toLowerCase();
    const label = table[k] ?? EXTRA[k] ?? (/^f\d{1,2}$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : raw);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}
/** One-line form: "⌘⇧4" on macOS, "Ctrl+Shift+4" on Windows. */
export function hotkeyText(keys: string, platform: Platform = getPlatform()): string {
  const l = hotkeyLabels(keys, platform);
  return platform === "darwin" ? l.map((x) => (x.length === 1 || /^[⌘⌃⌥⇧↩⌫⌦⎋⇥↑↓←→]$/.test(x) ? x : ` ${x} `)).join("").trim() : l.join("+");
}

/** Example text for the shell-command and open fields, in the agent's OS terms. */
export const shellExample = (p: Platform = getPlatform()): string => (p === "win32" ? "e.g. notepad or start ms-settings:" : p === "darwin" ? "e.g. open -a Calculator" : "e.g. xdg-open .");
export const openExample = (p: Platform = getPlatform()): string => (p === "win32" ? "https://... or an app name (Notepad)" : p === "darwin" ? "https://... or an app name (Safari)" : "https://... or an app name (firefox)");

/** Hotkeys that exist only on macOS (palette entries are hidden elsewhere). */
export const MAC_ONLY_ENTRIES = new Set(["k-lock", "k-spot", "k-shot"]);
/** Windows-only palette entries (Windows key shortcuts, Game Bar, lock): hidden on macOS and Linux. */
export const WIN_ONLY_ENTRIES = new Set(["w-lock", "w-search", "w-shot", "w-gamebar", "w-record", "w-taskmgr", "w-taskview", "w-desktop", "w-clipboard", "m-mic", "w-appvol", "w-outdev"]);
/** Entries macOS cannot do (the agent has no held keys there). */
export const NOT_MAC_ENTRIES = new Set(["w-ptt"]);

/** Whether a static palette entry is offered for the agent's OS. */
export const entryForPlatform = (key: string, platform: Platform): boolean =>
  platform === "darwin" ? !WIN_ONLY_ENTRIES.has(key) && !NOT_MAC_ENTRIES.has(key) : platform === "win32" ? !MAC_ONLY_ENTRIES.has(key) : !MAC_ONLY_ENTRIES.has(key) && !WIN_ONLY_ENTRIES.has(key);
