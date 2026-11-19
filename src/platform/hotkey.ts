/**
 * Hotkey strings ("cmd+shift+4", "ctrl+alt+t", "win+shift+s", "f5", "return"): parsed once, mapped per OS.
 * `cmd` is the portable "main" modifier (Command on macOS, Ctrl on Windows); `win` is the real Windows/Super key
 * (on macOS it presses Command, on Linux Super).
 */

export interface ParsedHotkey {
  mods: Array<"cmd" | "ctrl" | "alt" | "shift" | "win">;
  key: string; // lower-case key name or single character
}

const MOD_ALIASES: Record<string, ParsedHotkey["mods"][number]> = {
  cmd: "cmd", command: "cmd", meta: "cmd",
  win: "win", windows: "win", super: "win", start: "win",
  ctrl: "ctrl", control: "ctrl",
  alt: "alt", option: "alt", opt: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  enter: "return", esc: "escape", backspace: "delete", del: "forwarddelete",
  spacebar: "space", plus: "+", pgup: "pageup", pgdn: "pagedown", pgdown: "pagedown",
  ins: "insert", prtsc: "printscreen", prtscr: "printscreen", printscr: "printscreen", print: "printscreen", snapshot: "printscreen",
  break: "pause", caps: "capslock", scrlk: "scrolllock", scroll: "scrolllock", numlk: "numlock",
  numplus: "numadd", numminus: "numsubtract", numstar: "nummultiply", numslash: "numdivide", numdot: "numdecimal", numdel: "numdecimal",
  stop: "mediastop",
};

/** Keys added beyond the original set (F13-F24, numpad, lock and system keys, media stop). */
export const EXTRA_KEYS = [
  ...Array.from({ length: 12 }, (_, i) => `f${i + 13}`),
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  "numadd", "numsubtract", "nummultiply", "numdivide", "numdecimal", "numenter", "numlock",
  "insert", "printscreen", "pause", "capslock", "scrolllock", "mediastop",
] as const;

const NAMED_KEYS = new Set([
  "return", "tab", "space", "delete", "forwarddelete", "escape",
  "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  ...EXTRA_KEYS,
]);

export function parseHotkey(keys: string): ParsedHotkey {
  const raw = keys.trim().toLowerCase();
  if (!raw) throw new Error("hotkey is empty");
  // "cmd++" means cmd and the plus key
  const parts = raw.endsWith("+") ? [...raw.slice(0, -1).split("+").filter(Boolean), "+"] : raw.split("+").map((p) => p.trim());
  if (parts.some((p) => !p)) throw new Error(`invalid hotkey "${keys}"`);
  const mods: ParsedHotkey["mods"] = [];
  let key: string | undefined;
  for (const part of parts) {
    const mod = MOD_ALIASES[part];
    if (mod) {
      if (!mods.includes(mod)) mods.push(mod);
      continue;
    }
    if (key !== undefined) throw new Error(`hotkey "${keys}" has more than one non-modifier key`);
    key = KEY_ALIASES[part] ?? part;
  }
  if (key === undefined) throw new Error(`hotkey "${keys}" has no key`);
  if (!NAMED_KEYS.has(key) && [...key].length !== 1) throw new Error(`unknown key "${key}" in hotkey "${keys}"`);
  return { mods, key };
}
