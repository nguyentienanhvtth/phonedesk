import { describe, expect, test } from "bun:test";
import { parseHotkey, buildCommand } from "../src/actions";
import * as K from "../src/platform/win32/keys";

const noScan: K.VkScan = () => null;
const vks = (es: K.KeyEvent[]) => es.map((e) => `0x${e.vk.toString(16)}${e.up ? "^" : "v"}`);

describe("hotkey parsing: the Windows key and the extra keys", () => {
  test("win / windows / super / start are the real Windows key; cmd / meta stay the portable Ctrl", () => {
    expect(parseHotkey("win+shift+s")).toEqual({ mods: ["win", "shift"], key: "s" });
    expect(parseHotkey("Windows+G")).toEqual({ mods: ["win"], key: "g" });
    expect(parseHotkey("super+d")).toEqual({ mods: ["win"], key: "d" });
    expect(parseHotkey("meta+c")).toEqual({ mods: ["cmd"], key: "c" });
    expect(parseHotkey("win+alt+g")).toEqual({ mods: ["win", "alt"], key: "g" });
  });
  test("F13-F24, numpad, lock and system keys, media stop, with aliases", () => {
    for (let i = 13; i <= 24; i++) expect(parseHotkey(`f${i}`).key).toBe(`f${i}`);
    for (let i = 0; i <= 9; i++) expect(parseHotkey(`ctrl+num${i}`).key).toBe(`num${i}`);
    expect(parseHotkey("numplus").key).toBe("numadd");
    expect(parseHotkey("numminus").key).toBe("numsubtract");
    expect(parseHotkey("numenter").key).toBe("numenter");
    expect(parseHotkey("ins").key).toBe("insert");
    expect(parseHotkey("prtsc").key).toBe("printscreen");
    expect(parseHotkey("break").key).toBe("pause");
    expect(parseHotkey("caps").key).toBe("capslock");
    expect(parseHotkey("scrlk").key).toBe("scrolllock");
    expect(parseHotkey("stop").key).toBe("mediastop");
    expect(() => parseHotkey("f25")).toThrow("unknown key");
    expect(() => parseHotkey("num10")).toThrow("unknown key");
  });
  test("macOS: win presses Command (once); keys macOS lacks are a clear error", () => {
    expect(buildCommand({ type: "hotkey", keys: "win+shift+s" }, "darwin")[2]).toBe('tell application "System Events" to keystroke "s" using {command down, shift down}');
    expect(buildCommand({ type: "hotkey", keys: "cmd+win+a" }, "darwin")[2]).toBe('tell application "System Events" to keystroke "a" using {command down}');
    expect(buildCommand({ type: "hotkey", keys: "f13" }, "darwin")[2]).toContain("key code 105");
    expect(buildCommand({ type: "hotkey", keys: "num5" }, "darwin")[2]).toContain("key code 87");
    expect(() => buildCommand({ type: "hotkey", keys: "printscreen" }, "darwin")).toThrow("not available on macOS");
  });
  test("Linux: win is Super; the new keys have xdotool names", () => {
    expect(buildCommand({ type: "hotkey", keys: "win+d" }, "linux")).toEqual(["xdotool", "key", "--", "super+d"]);
    expect(buildCommand({ type: "hotkey", keys: "num7" }, "linux")).toEqual(["xdotool", "key", "--", "KP_7"]);
    expect(buildCommand({ type: "hotkey", keys: "f24" }, "linux")).toEqual(["xdotool", "key", "--", "F24"]);
  });
});

describe("win32 SendInput events: Windows key, scan codes, extended flags", () => {
  test("win presses VK_LWIN (extended); cmd still presses Ctrl", () => {
    expect(vks(K.hotkeyEvents("win+shift+s", noScan))).toEqual(["0x5bv", "0x10v", "0x53v", "0x53^", "0x10^", "0x5b^"]);
    expect(vks(K.hotkeyEvents("win+alt+g", noScan))).toEqual(["0x5bv", "0x12v", "0x47v", "0x47^", "0x12^", "0x5b^"]);
    expect(vks(K.hotkeyEvents("cmd+win+d", noScan))).toEqual(["0x11v", "0x5bv", "0x44v", "0x44^", "0x5b^", "0x11^"]);
    const lwin = K.hotkeyEvents("win+d", noScan)[0]!;
    expect(lwin).toMatchObject({ vk: 0x5b, scan: 0x5b, ext: true });
  });
  test("every key carries its scan code (US table fallback)", () => {
    const [ctrl, , c] = K.hotkeyEvents("ctrl+shift+c", noScan);
    expect(ctrl).toMatchObject({ vk: 0x11, scan: 0x1d, ext: false });
    expect(c).toMatchObject({ vk: 0x43, scan: 0x2e, ext: false });
    expect(K.hotkeyEvents("a", noScan)[0]).toMatchObject({ scan: 0x1e });
    expect(K.hotkeyEvents("1", noScan)[0]).toMatchObject({ scan: 0x02 });
    expect(K.hotkeyEvents("f12", noScan)[0]).toMatchObject({ vk: 0x7b, scan: 0x58 });
    expect(K.hotkeyEvents("f13", noScan)[0]).toMatchObject({ vk: 0x7c, scan: 0x64 });
    expect(K.hotkeyEvents("f24", noScan)[0]).toMatchObject({ vk: 0x87, scan: 0x76 });
    expect(K.hotkeyEvents("num0", noScan)[0]).toMatchObject({ vk: 0x60, scan: 0x52, ext: false });
    expect(K.hotkeyEvents("num9", noScan)[0]).toMatchObject({ vk: 0x69, scan: 0x49, ext: false });
  });
  test("extended flags: navigation, keypad Enter / divide, Print Screen, Insert; not the main Enter or keypad digits", () => {
    expect(K.hotkeyEvents("insert", noScan)[0]).toMatchObject({ vk: 0x2d, scan: 0x52, ext: true });
    expect(K.hotkeyEvents("printscreen", noScan)[0]).toMatchObject({ vk: 0x2c, scan: 0x37, ext: true });
    expect(K.hotkeyEvents("numenter", noScan)[0]).toMatchObject({ vk: 0x0d, scan: 0x1c, ext: true });
    expect(K.hotkeyEvents("return", noScan)[0]).toMatchObject({ vk: 0x0d, scan: 0x1c, ext: false });
    expect(K.hotkeyEvents("numdivide", noScan)[0]).toMatchObject({ vk: 0x6f, scan: 0x35, ext: true });
    expect(K.hotkeyEvents("capslock", noScan)[0]).toMatchObject({ vk: 0x14, scan: 0x3a, ext: false });
    expect(K.hotkeyEvents("scrolllock", noScan)[0]).toMatchObject({ vk: 0x91, scan: 0x46 });
    expect(K.mediaEvents("stop")[0]).toMatchObject({ vk: 0xb2, scan: 0x24, ext: true });
  });
  test("Pause is sent as a virtual key only (its E1 scan code would read as Ctrl)", () => {
    expect(K.hotkeyEvents("pause", noScan)[0]).toMatchObject({ vk: 0x13, scan: 0 });
    expect(K.hotkeyEvents("pause", noScan, () => 0xe11d)[0]).toMatchObject({ vk: 0x13, scan: 0 });
  });
  test("the layout's own scan codes win (MapVirtualKeyW); E0 codes turn the extended flag on", () => {
    const azerty: K.VkToScan = (vk) => (vk === 0x41 ? 0x10 : vk === 0x5b ? 0xe05b : 0);
    expect(K.hotkeyEvents("a", noScan, azerty)[0]).toMatchObject({ vk: 0x41, scan: 0x10, ext: false });
    expect(K.hotkeyEvents("win+a", noScan, azerty)[0]).toMatchObject({ vk: 0x5b, scan: 0x5b, ext: true });
    // a failed lookup (0) falls back to the US table
    expect(K.hotkeyEvents("b", noScan, () => 0)[0]).toMatchObject({ scan: 0x30 });
  });
  test("packInputs writes wVk + wScan without KEYEVENTF_SCANCODE; extended keys get 0x1", () => {
    const buf = K.packInputs(K.hotkeyEvents("win+shift+s", noScan));
    expect(buf.readUInt16LE(8)).toBe(0x5b);
    expect(buf.readUInt16LE(10)).toBe(0x5b);
    expect(buf.readUInt32LE(12)).toBe(0x1); // extended, down
    expect(buf.readUInt16LE(40 + 8)).toBe(0x10);
    expect(buf.readUInt16LE(40 + 10)).toBe(0x2a);
    expect(buf.readUInt32LE(40 + 12)).toBe(0x0);
    expect(buf.readUInt16LE(80 + 10)).toBe(0x1f); // S
    expect(buf.readUInt32LE(5 * 40 + 12)).toBe(0x3); // LWIN up: extended + keyup
    for (let i = 0; i < 6; i++) expect(buf.readUInt32LE(i * 40 + 12) & 0x8).toBe(0); // never KEYEVENTF_SCANCODE
    const typed = K.packInputs(K.typeEvents("é"));
    expect(typed.readUInt16LE(10)).toBe(0xe9);
    expect(typed.readUInt32LE(12)).toBe(0x4);
  });
});
