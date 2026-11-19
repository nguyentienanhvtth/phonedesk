import { describe, expect, test } from "bun:test";
import { defaultLayout, validateLayout } from "../src/config";
import { hookCommand, HOOK_MARKER } from "../src/hooks-install";
import { repointCommand, commandInstance } from "../src/service";
import { REPO_URL } from "../src/about";

describe("Windows defaults and hooks", () => {
  test("the first-run layout has Windows shortcuts on Windows and stays as it was elsewhere", () => {
    const items = (l: ReturnType<typeof defaultLayout>) => l.pages.flatMap((p) => p.items);
    const win = items(defaultLayout("win32"));
    const mac = items(defaultLayout("darwin"));
    expect((win.find((i) => i.id === "b-shot") as any).action).toEqual({ type: "hotkey", keys: "win+shift+s" });
    expect((win.find((i) => i.id === "b-lock") as any).action).toEqual({ type: "shell", command: "rundll32.exe user32.dll,LockWorkStation" });
    expect(win.some((i) => i.kind === "widget" && i.widget === "load")).toBe(false);
    expect(win.filter((i) => i.kind === "widget" && i.widget === "cputemp").length).toBe(2);
    expect((mac.find((i) => i.id === "b-shot") as any).action.keys).toBe("cmd+shift+4");
    expect(defaultLayout("linux")).toEqual(defaultLayout("darwin"));
    expect(() => validateLayout(defaultLayout("win32"))).not.toThrow();
  });
  test("Codex on Windows gets a PowerShell command (call operator, doubled quotes); Claude keeps the bash form", () => {
    const o = { execPath: "C:/Users/o'neil/.bun/bin/bun.exe", indexPath: "D:/phonedesk/src/index.ts", os: "win32", home: "C:/pd home", defaultHome: "C:/x" };
    expect(hookCommand("codex", o)).toBe(`& 'C:/Users/o''neil/.bun/bin/bun.exe' 'D:/phonedesk/src/index.ts' hook codex --home 'C:/pd home' # ${HOOK_MARKER}`);
    expect(hookCommand("claude", o)).toBe(`'C:/Users/o'\\''neil/.bun/bin/bun.exe' 'D:/phonedesk/src/index.ts' hook claude --home 'C:/pd home' # ${HOOK_MARKER}`);
    expect(hookCommand("codex", { ...o, os: "darwin" }).startsWith("& ")).toBe(false);
    expect(commandInstance(hookCommand("codex", o)).home).toContain("pd home");
  });
  test("repointing a Codex hook keeps the PowerShell form", () => {
    const old = `& 'C:/old/bun.exe' 'D:/old/src/index.ts' hook codex # ${HOOK_MARKER}`;
    expect(repointCommand(old, ["C:/new/phonedesk.exe"], "win32")).toBe(`& 'C:/new/phonedesk.exe' hook codex # ${HOOK_MARKER}`);
    expect(repointCommand(`'/old' hook codex # ${HOOK_MARKER}`, ["C:/new/phonedesk.exe"], "win32")).toBe(`& 'C:/new/phonedesk.exe' hook codex # ${HOOK_MARKER}`);
    expect(repointCommand(`'/old' hook claude # ${HOOK_MARKER}`, ["/new"], "win32")).toBe(`'/new' hook claude # ${HOOK_MARKER}`);
  });
  test("About points at this fork", () => {
    expect(REPO_URL).toBe("https://github.com/nguyentienanhvtth/phonedesk");
  });
});
