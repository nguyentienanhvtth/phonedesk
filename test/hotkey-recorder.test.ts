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
