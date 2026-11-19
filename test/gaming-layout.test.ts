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
    expect(layout.pages.map((p) => p.name)).toEqual(["Gaming", "Stats", "Keys"]);
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

  test("gaming page has volume controls and mic mute", () => {
    const layout = gamingPcLayout();
    const gaming = layout.pages.find((p) => p.id === "gaming")!;
    const labels = gaming.items.filter((i) => i.kind === "button").map((i: any) => i.label);
    expect(labels).toContain("Vol -");
    expect(labels).toContain("Vol +");
    expect(labels).toContain("Mute");
    expect(labels).toContain("Mic Mute");
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
