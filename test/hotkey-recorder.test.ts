import { describe, expect, test } from "bun:test";
import { hotkeyFromEvent } from "../web/manage/src/lib/layout";
import { hotkeyLabels, hotkeyText } from "../web/manage/src/lib/platform";

const ev = (o: Partial<KeyboardEvent>): KeyboardEvent => ({ key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;

describe("manage key recorder", () => {
  test("Windows: Ctrl is the portable cmd, the Windows key is win", () => {
    expect(hotkeyFromEvent(ev({ key: "s", code: "KeyS", ctrlKey: true, shiftKey: true }), "win32")).toBe("cmd+shift+s");
    expect(hotkeyFromEvent(ev({ key: "s", code: "KeyS", metaKey: true, shiftKey: true }), "win32")).toBe("win+shift+s");
    expect(hotkeyFromEvent(ev({ key: "d", code: "KeyD", ctrlKey: true, metaKey: true }), "win32")).toBe("cmd+win+d");
  });
  test("macOS keeps Command = cmd and Control = ctrl", () => {
    expect(hotkeyFromEvent(ev({ key: "4", code: "Digit4", metaKey: true, shiftKey: true }), "darwin")).toBe("cmd+shift+4");
    expect(hotkeyFromEvent(ev({ key: "t", code: "KeyT", ctrlKey: true, altKey: true }), "darwin")).toBe("ctrl+alt+t");
  });
  test("F13-F24, the keypad (by code, not the digit it types), lock and system keys", () => {
    expect(hotkeyFromEvent(ev({ key: "F13", code: "F13" }), "win32")).toBe("f13");
    expect(hotkeyFromEvent(ev({ key: "F24", code: "F24" }), "win32")).toBe("f24");
    expect(hotkeyFromEvent(ev({ key: "1", code: "Numpad1" }), "win32")).toBe("num1");
    expect(hotkeyFromEvent(ev({ key: "1", code: "Digit1" }), "win32")).toBe("1");
    expect(hotkeyFromEvent(ev({ key: "+", code: "NumpadAdd", ctrlKey: true }), "win32")).toBe("cmd+numadd");
    expect(hotkeyFromEvent(ev({ key: "Enter", code: "NumpadEnter" }), "win32")).toBe("numenter");
    expect(hotkeyFromEvent(ev({ key: "Enter", code: "Enter" }), "win32")).toBe("return");
    expect(hotkeyFromEvent(ev({ key: "Insert", code: "Insert" }), "win32")).toBe("insert");
    expect(hotkeyFromEvent(ev({ key: "PrintScreen", code: "PrintScreen" }), "win32")).toBe("printscreen");
    expect(hotkeyFromEvent(ev({ key: "Pause", code: "Pause" }), "win32")).toBe("pause");
    expect(hotkeyFromEvent(ev({ key: "CapsLock", code: "CapsLock" }), "win32")).toBe("capslock");
    expect(hotkeyFromEvent(ev({ key: "ScrollLock", code: "ScrollLock" }), "win32")).toBe("scrolllock");
    expect(hotkeyFromEvent(ev({ key: "Meta", code: "MetaLeft", metaKey: true }), "win32")).toBeUndefined();
  });
  test("labels: Win on Windows, ⌘ on macOS; the extra keys read well", () => {
    expect(hotkeyText("win+shift+s", "win32")).toBe("Win+Shift+S");
    expect(hotkeyText("cmd+shift+esc", "win32")).toBe("Ctrl+Shift+Esc");
    expect(hotkeyText("win+shift+s", "darwin")).toBe("⌘⇧S");
    expect(hotkeyLabels("ctrl+num5", "win32")).toEqual(["Ctrl", "Num 5"]);
    expect(hotkeyLabels("f13", "win32")).toEqual(["F13"]);
    expect(hotkeyLabels("printscreen", "win32")).toEqual(["PrtSc"]);
  });
});

describe("palette: Windows entries", async () => {
  const { STATIC_ENTRIES } = await import("../web/manage/src/lib/palette");
  const { entryForPlatform, WIN_ONLY_ENTRIES, MAC_ONLY_ENTRIES } = await import("../web/manage/src/lib/platform");
  const { parseHotkey } = await import("../src/platform/hotkey");
  const { validateLayout } = await import("../src/config");
  const keysOf = (p: "win32" | "darwin" | "linux") => STATIC_ENTRIES.filter((e) => entryForPlatform(e.key, p)).map((e) => e.key);

  test("Windows gets the Win-key shortcuts and the mic, not the macOS ones; macOS the reverse", () => {
    const win = keysOf("win32"), mac = keysOf("darwin"), linux = keysOf("linux");
    for (const k of ["w-shot", "w-lock", "w-gamebar", "w-record", "w-taskmgr", "m-mic"]) { expect(win).toContain(k); expect(mac).not.toContain(k); expect(linux).not.toContain(k); }
    for (const k of MAC_ONLY_ENTRIES) { expect(mac).toContain(k); expect(win).not.toContain(k); }
    expect(win).toContain("v-set");
    expect(mac).toContain("v-set");
  });
  test("every Windows entry makes a valid button whose hotkey parses", () => {
    const items = STATIC_ENTRIES.filter((e) => WIN_ONLY_ENTRIES.has(e.key) || e.key === "v-set").map((e, i) => ({ ...(e.make() as any), id: `x${i}`, x: i % 8, y: Math.floor(i / 8) }));
    expect(items.length).toBe(WIN_ONLY_ENTRIES.size + 1);
    expect(() => validateLayout({ version: 1, pages: [{ id: "p", name: "P", columns: 8, rows: 4, items }] })).not.toThrow();
    for (const it of items) if (it.action.type === "hotkey") expect(() => parseHotkey(it.action.keys)).not.toThrow();
  });
});
