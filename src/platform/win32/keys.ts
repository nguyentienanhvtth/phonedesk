import { parseHotkey } from "../hotkey";

/** Pure builders for Win32 SendInput: which key events a hotkey / text / media key needs, and the INPUT array bytes. */

export const VK = {
  back: 0x08, tab: 0x09, return: 0x0d, shift: 0x10, control: 0x11, menu: 0x12, pause: 0x13, capital: 0x14, escape: 0x1b, space: 0x20,
  pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  snapshot: 0x2c, insert: 0x2d, delete: 0x2e, lwin: 0x5b, apps: 0x5d,
  numpad0: 0x60, multiply: 0x6a, add: 0x6b, subtract: 0x6d, decimal: 0x6e, divide: 0x6f,
  f1: 0x70, f13: 0x7c, numlock: 0x90, scroll: 0x91,
  volumeMute: 0xad, volumeDown: 0xae, volumeUp: 0xaf, mediaNext: 0xb0, mediaPrev: 0xb1, mediaStop: 0xb2, mediaPlayPause: 0xb3,
} as const;

/** A key as SendInput wants it: the virtual key, and whether it is an extended (E0-prefixed) key. */
interface KeyDef { vk: number; ext?: boolean }

const NAMED: Record<string, KeyDef> = {
  return: { vk: VK.return }, tab: { vk: VK.tab }, space: { vk: VK.space }, delete: { vk: VK.back }, forwarddelete: { vk: VK.delete }, escape: { vk: VK.escape },
  up: { vk: VK.up }, down: { vk: VK.down }, left: { vk: VK.left }, right: { vk: VK.right }, home: { vk: VK.home }, end: { vk: VK.end }, pageup: { vk: VK.pageup }, pagedown: { vk: VK.pagedown },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, { vk: VK.f1 + i }])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 13}`, { vk: VK.f13 + i }])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num${i}`, { vk: VK.numpad0 + i }])),
  numadd: { vk: VK.add }, numsubtract: { vk: VK.subtract }, nummultiply: { vk: VK.multiply }, numdivide: { vk: VK.divide }, numdecimal: { vk: VK.decimal },
  numenter: { vk: VK.return, ext: true }, // the keypad Enter is Return with the extended flag
  numlock: { vk: VK.numlock }, insert: { vk: VK.insert }, printscreen: { vk: VK.snapshot }, pause: { vk: VK.pause },
  capslock: { vk: VK.capital }, scrolllock: { vk: VK.scroll }, mediastop: { vk: VK.mediaStop },
};

/** Keys that need the extended-key flag (navigation block, Win, keypad divide, Num Lock, Print Screen, media/volume keys). */
const EXTENDED = new Set<number>([
  VK.pageup, VK.pagedown, VK.end, VK.home, VK.left, VK.up, VK.right, VK.down, VK.insert, VK.delete,
  VK.lwin, VK.apps, VK.divide, VK.numlock, VK.snapshot,
  VK.volumeMute, VK.volumeDown, VK.volumeUp, VK.mediaNext, VK.mediaPrev, VK.mediaStop, VK.mediaPlayPause,
]);

/**
 * Set-1 scan codes of a US keyboard, used when MapVirtualKeyW is not available (tests, or a failed lookup).
 * Games read the scan code (raw input / DirectInput / SDL), so every key event carries one; 0xE0xx = extended.
 */
export const STATIC_SCANS: Record<number, number> = {
  [VK.back]: 0x0e, [VK.tab]: 0x0f, [VK.return]: 0x1c, [VK.shift]: 0x2a, [VK.control]: 0x1d, [VK.menu]: 0x38, [VK.capital]: 0x3a,
  [VK.escape]: 0x01, [VK.space]: 0x39, [VK.pageup]: 0xe049, [VK.pagedown]: 0xe051, [VK.end]: 0xe04f, [VK.home]: 0xe047,
  [VK.left]: 0xe04b, [VK.up]: 0xe048, [VK.right]: 0xe04d, [VK.down]: 0xe050, [VK.snapshot]: 0xe037, [VK.insert]: 0xe052, [VK.delete]: 0xe053,
  [VK.lwin]: 0xe05b, [VK.apps]: 0xe05d, [VK.multiply]: 0x37, [VK.add]: 0x4e, [VK.subtract]: 0x4a, [VK.decimal]: 0x53, [VK.divide]: 0xe035,
  [VK.numlock]: 0x45, [VK.scroll]: 0x46,
  [VK.volumeMute]: 0xe020, [VK.volumeDown]: 0xe02e, [VK.volumeUp]: 0xe030, [VK.mediaNext]: 0xe019, [VK.mediaPrev]: 0xe010, [VK.mediaStop]: 0xe024, [VK.mediaPlayPause]: 0xe022,
  // F1-F10, F11, F12, F13-F23, F24
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [VK.f1 + i, 0x3b + i])), [VK.f1 + 10]: 0x57, [VK.f1 + 11]: 0x58,
  ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [VK.f13 + i, 0x64 + i])), [VK.f13 + 11]: 0x76,
  // keypad 0-9
  ...Object.fromEntries([0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49].map((sc, i) => [VK.numpad0 + i, sc])),
  // digits 1-9, 0 and letters (QWERTY positions)
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [0x31 + i, 0x02 + i])), [0x30]: 0x0b,
  ...Object.fromEntries([..."QWERTYUIOP"].map((c, i) => [c.charCodeAt(0), 0x10 + i])),
  ...Object.fromEntries([..."ASDFGHJKL"].map((c, i) => [c.charCodeAt(0), 0x1e + i])),
  ...Object.fromEntries([..."ZXCVBNM"].map((c, i) => [c.charCodeAt(0), 0x2c + i])),
};

/** Virtual key -> scan code (0xE0xx when extended, 0 when unknown). On Windows this is MapVirtualKeyW(MAPVK_VK_TO_VSC_EX). */
export type VkToScan = (vk: number) => number;
export const staticScan: VkToScan = (vk) => STATIC_SCANS[vk] ?? 0;

export interface KeyEvent {
  /** Virtual key code (0 for a unicode character). */
  vk: number;
  /** UTF-16 code unit when `unicode`; otherwise the hardware scan code (low byte; 0 = none). */
  scan: number;
  up: boolean;
  unicode: boolean;
  /** Extended key (KEYEVENTF_EXTENDEDKEY): the E0-prefixed keys. */
  ext?: boolean;
}

/** Key down or up with the scan code games need and the right extended flag. */
export function keyEvent(def: KeyDef | number, up: boolean, toScan: VkToScan = staticScan): KeyEvent {
  const { vk, ext } = typeof def === "number" ? { vk: def, ext: undefined } : def;
  // the keypad Enter shares VK_RETURN with the main Enter: its scan code is the same, the extended flag tells them apart
  let sc = (toScan(vk) || staticScan(vk)) >>> 0;
  // Pause is the E1-prefixed oddity (E1 1D 45): its low byte would read as Ctrl, so it goes out as a virtual key only
  if (vk === VK.pause || (sc & 0xff00) === 0xe100 || sc > 0xffff) sc = 0;
  const extended = ext ?? (EXTENDED.has(vk) || (sc & 0xff00) === 0xe000);
  return { vk, scan: sc & 0xff, up, unicode: false, ext: extended };
}

/** VkKeyScanW result for one character: the virtual key and the shift state it needs; null when the layout has no key for it. */
export type VkScan = (ch: string) => { vk: number; shift: boolean; ctrl: boolean; alt: boolean } | null;

/** Decodes the 16-bit VkKeyScanW value (low byte = vk, high byte = shift state), -1 = none. */
export function decodeVkScan(v: number): ReturnType<VkScan> {
  if (v === -1 || (v & 0xffff) === 0xffff) return null;
  const vk = v & 0xff;
  const st = (v >> 8) & 0xff;
  return { vk, shift: !!(st & 1), ctrl: !!(st & 2), alt: !!(st & 4) };
}

/**
 * Events for a hotkey. cmd and ctrl press Ctrl (layouts written on a Mac keep working), option/alt Alt, win the Windows key.
 * Letters and digits use their fixed virtual keys; other single characters go through the layout (`scan`).
 * Every event carries a scan code (`toScan`) so games that read scan codes (CS2 and other raw-input games) see the key.
 */
export function hotkeyEvents(keys: string, scan: VkScan, toScan: VkToScan = staticScan): KeyEvent[] {
  const { mods, key: k } = parseHotkey(keys);
  const down: number[] = [];
  const add = (vk: number) => { if (!down.includes(vk)) down.push(vk); };
  if (mods.includes("cmd") || mods.includes("ctrl")) add(VK.control);
  if (mods.includes("win")) add(VK.lwin);
  if (mods.includes("alt")) add(VK.menu);
  if (mods.includes("shift")) add(VK.shift);
  let def: KeyDef | undefined = NAMED[k];
  if (def === undefined) {
    if (/^[a-z]$/.test(k)) def = { vk: k.toUpperCase().charCodeAt(0) };
    else if (/^[0-9]$/.test(k)) def = { vk: k.charCodeAt(0) };
    else {
      const s = scan(k);
      if (!s) throw new Error(`the key "${k}" is not on the current keyboard layout`);
      def = { vk: s.vk };
      if (s.shift) add(VK.shift);
      if (s.ctrl) add(VK.control);
      if (s.alt) add(VK.menu);
    }
  }
  const ev = (d: KeyDef | number, up: boolean) => keyEvent(d, up, toScan);
  return [...down.map((m) => ev(m, false)), ev(def, false), ev(def, true), ...[...down].reverse().map((m) => ev(m, true))];
}

/**
 * One half of a hotkey for a held button: "down" = modifiers then the key pressed, "up" = the key then the modifiers
 * released, in the reverse order (the same events hotkeyEvents sends in one go).
 */
export function hotkeyHoldEvents(keys: string, phase: "down" | "up", scan: VkScan, toScan: VkToScan = staticScan): KeyEvent[] {
  const all = hotkeyEvents(keys, scan, toScan);
  const half = all.length / 2;
  return phase === "down" ? all.slice(0, half) : all.slice(half);
}

/** Types text as Unicode input (works for any layout and any character); newline = Enter, tab = Tab. */
export function typeEvents(text: string): KeyEvent[] {
  const out: KeyEvent[] = [];
  const t = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (t[i] === "\n" || t[i] === "\r") { out.push(keyEvent(VK.return, false), keyEvent(VK.return, true)); continue; }
    if (t[i] === "\t") { out.push(keyEvent(VK.tab, false), keyEvent(VK.tab, true)); continue; }
    out.push({ vk: 0, scan: code, up: false, unicode: true }, { vk: 0, scan: code, up: true, unicode: true });
  }
  return out;
}

export function mediaEvents(command: "playpause" | "next" | "previous" | "stop", toScan: VkToScan = staticScan): KeyEvent[] {
  const vk = command === "playpause" ? VK.mediaPlayPause : command === "next" ? VK.mediaNext : command === "stop" ? VK.mediaStop : VK.mediaPrev;
  return [keyEvent(vk, false, toScan), keyEvent(vk, true, toScan)];
}

/** One volume key press per step (Windows moves 2 % per press); `times` presses for up/down. */
export function volumeKeyEvents(command: "up" | "down" | "mute", times = command === "mute" ? 1 : 3, toScan: VkToScan = staticScan): KeyEvent[] {
  const vk = command === "up" ? VK.volumeUp : command === "down" ? VK.volumeDown : VK.volumeMute;
  return Array.from({ length: times }).flatMap(() => [keyEvent(vk, false, toScan), keyEvent(vk, true, toScan)]);
}

export const INPUT_SIZE = 40; // sizeof(INPUT) on x64

/**
 * The INPUT[] block SendInput wants: type=KEYBOARD, then KEYBDINPUT {wVk, wScan, dwFlags, time, dwExtraInfo} at offset 8.
 * Keys go out as virtual key AND scan code (no KEYEVENTF_SCANCODE): Windows keeps the virtual key (so the
 * character follows the user's layout) and passes the scan code on to raw input / DirectInput, which games read.
 */
export function packInputs(events: KeyEvent[]): Buffer {
  const buf = Buffer.alloc(INPUT_SIZE * events.length);
  events.forEach((e, i) => {
    const o = i * INPUT_SIZE;
    let flags = 0;
    if (e.up) flags |= 0x0002; // KEYEVENTF_KEYUP
    if (e.unicode) flags |= 0x0004; // KEYEVENTF_UNICODE
    else if (e.ext ?? EXTENDED.has(e.vk)) flags |= 0x0001; // KEYEVENTF_EXTENDEDKEY
    buf.writeUInt32LE(1, o); // INPUT_KEYBOARD
    buf.writeUInt16LE(e.unicode ? 0 : e.vk, o + 8);
    buf.writeUInt16LE(e.unicode ? e.scan : e.scan & 0xff, o + 10);
    buf.writeUInt32LE(flags, o + 12);
  });
  return buf;
}
