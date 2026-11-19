import { describe, expect, test } from "bun:test";
import { gamingPcLayout } from "../src/layouts/gaming-pc";
import { validateLayout } from "../src/config";

describe("Gaming PC layout", () => {
  test("the layout is valid", () => {
    const layout = gamingPcLayout();
    expect(() => validateLayout(layout)).not.toThrow();
  });

  test("has three pages: gaming, stats, keys", () => {
    const layout = gamingPcLayout();
    expect(layout.pages).toHaveLength(3);
    expect(layout.pages.map((p) => p.id)).toEqual(["gaming", "stats", "keys"]);
    expect(layout.pages.map((p) => p.name)).toEqual(["Controls", "Stats", "Keys"]);
  });

  test("gaming page has CS2, Steam, Discord, Spotify buttons", () => {
    const layout = gamingPcLayout();
    const gaming = layout.pages.find((p) => p.id === "gaming")!;
    const labels = gaming.items.filter((i) => i.kind === "button").map((i: any) => i.label);
    expect(labels).toContain("CS2");
    expect(labels).toContain("Steam");
    expect(labels).toContain("Discord");
    expect(labels).toContain("Spotify");
  });

  test("gaming page has volume and mic slider widgets", () => {
    const layout = gamingPcLayout();
    const gaming = layout.pages.find((p) => p.id === "gaming")!;
    const widgets = gaming.items.filter((i) => i.kind === "widget").map((i: any) => i.widget);
    expect(widgets).toContain("volume");
    expect(widgets).toContain("mic");
  });

  test("gaming page has GPU, CPU, memory widgets", () => {
    const layout = gamingPcLayout();
    const gaming = layout.pages.find((p) => p.id === "gaming")!;
    const widgets = gaming.items.filter((i) => i.kind === "widget").map((i: any) => i.widget);
    expect(widgets).toContain("gpu");
    expect(widgets).toContain("cpu");
    expect(widgets).toContain("memory");
    expect(widgets).toContain("nowplaying");
  });

  test("stats page has expanded GPU stats", () => {
    const layout = gamingPcLayout();
    const stats = layout.pages.find((p) => p.id === "stats")!;
    const gpuWidget = stats.items.find((i) => i.kind === "widget" && (i as any).widget === "gpu");
    expect(gpuWidget).toBeDefined();
    expect(gpuWidget!.w).toBe(4);
    expect(gpuWidget!.h).toBe(2);
  });

  test("CS2 button opens steam://rungameid/730", () => {
    const layout = gamingPcLayout();
    const gaming = layout.pages.find((p) => p.id === "gaming")!;
    const cs2 = gaming.items.find((i) => i.kind === "button" && (i as any).label === "CS2");
    expect(cs2).toBeDefined();
    expect((cs2 as any).action).toEqual({ type: "open", target: "steam://rungameid/730" });
  });

  test("all pages navigate to each other", () => {
    const layout = gamingPcLayout();
    for (const page of layout.pages) {
      const pageButtons = page.items.filter(
        (i) => i.kind === "button" && (i as any).action?.type === "page"
      );
      const targets = pageButtons.map((b: any) => b.action.page);
      for (const otherPage of layout.pages) {
        if (otherPage.id !== page.id) {
          expect(targets).toContain(otherPage.id);
        }
      }
    }
  });

  test("uses Windows-style hotkeys (ctrl instead of cmd)", () => {
    const layout = gamingPcLayout();
    const keys = layout.pages.find((p) => p.id === "keys")!;
    const copyButton = keys.items.find(
      (i) => i.kind === "button" && (i as any).label === "Copy"
    );
    expect(copyButton).toBeDefined();
    expect((copyButton as any).action).toEqual({ type: "hotkey", keys: "ctrl+c" });
  });
});

describe("Gaming PC Keys page: real Windows shortcuts", () => {
  const { parseHotkey } = require("../src/platform/hotkey") as typeof import("../src/platform/hotkey");
  const catalog = JSON.parse(require("node:fs").readFileSync(require("node:path").join(import.meta.dir, "..", "web", "shared", "icon-catalog.json"), "utf8"));
  const keysPage = () => gamingPcLayout().pages.find((p) => p.id === "keys")!;
  const action = (id: string) => (keysPage().items.find((i) => i.id === id) as any).action;

  test("no hotkey uses cmd (that is Ctrl on Windows); every hotkey parses", () => {
    for (const p of gamingPcLayout().pages) for (const it of p.items as any[]) {
      if (it.action?.type !== "hotkey") continue;
      expect(it.action.keys).not.toMatch(/(^|\+)cmd(\+|$)/);
      expect(() => parseHotkey(it.action.keys)).not.toThrow();
    }
  });
  test("Windows-key shortcuts, Game Bar, clip, Task Manager, mic, and Lock through LockWorkStation", () => {
    expect(action("b-screenshot")).toEqual({ type: "hotkey", keys: "win+shift+s" });
    expect(action("b-taskview")).toEqual({ type: "hotkey", keys: "win+tab" });
    expect(action("b-desktop")).toEqual({ type: "hotkey", keys: "win+d" });
    expect(action("b-gamebar")).toEqual({ type: "hotkey", keys: "win+g" });
    expect(action("b-record")).toEqual({ type: "hotkey", keys: "win+alt+g" });
    expect(action("b-taskmgr")).toEqual({ type: "hotkey", keys: "ctrl+shift+escape" });
    expect(action("b-mic")).toEqual({ type: "mic", command: "toggle" });
    expect(action("b-lock")).toEqual({ type: "shell", command: "rundll32.exe user32.dll,LockWorkStation" });
  });
  test("every icon of the template exists in the icon catalog", () => {
    const names = new Set<string>(JSON.stringify(catalog).match(/"[a-z0-9-]+"/g)!.map((s: string) => s.slice(1, -1)));
    for (const p of gamingPcLayout().pages) for (const it of p.items as any[]) if (it.icon) expect(names.has(it.icon) ? it.icon : `missing ${it.icon}`).toBe(it.icon);
  });

  test("stats page shows the CPU temperature; the CS2 app rule ships switched off", () => {
    const layout = gamingPcLayout();
    const stats = layout.pages.find((p) => p.id === "stats")!;
    expect(stats.items.some((i: any) => i.widget === "cputemp")).toBe(true);
    const rules = (layout as any).rules as any[];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ enabled: false, when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: "gaming" }], revert: true });
    expect(validateLayout(layout).rules?.[0]?.enabled).toBe(false);
  });
});
