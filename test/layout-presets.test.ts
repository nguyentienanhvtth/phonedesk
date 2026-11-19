import { describe, expect, test } from "bun:test";
import { gamingPcLayout } from "../src/layouts/gaming-pc";
import { validateLayout } from "../src/config";
import { LAYOUT_PRESETS as SHARED, gamingPcLayout as sharedGamingPc } from "../web/shared/layout-presets";
import { LAYOUT_PRESETS as MANAGE } from "../web/manage/src/components/layout-presets";

describe("layout templates: one source of truth", () => {
  test("the agent's Gaming PC layout is the shared one", () => {
    expect(gamingPcLayout()).toEqual(sharedGamingPc() as any);
  });

  test("the manage page's templates are the shared ones (same ids, revisions and layouts)", () => {
    expect(MANAGE.map((p) => [p.id, p.rev])).toEqual(SHARED.map((p) => [p.id, p.rev]));
    for (const p of SHARED) expect(MANAGE.find((m) => m.id === p.id)!.layout).toEqual(p.layout() as any);
  });

  test("manage's Gaming PC template has the volume and mic sliders, not the old Vol+/Vol- buttons", () => {
    const g = MANAGE.find((p) => p.id === "gaming-pc")!.layout.pages.find((p) => p.id === "gaming")!;
    const widgets = g.items.filter((i) => i.kind === "widget").map((i: any) => i.widget);
    expect(widgets).toContain("volume");
    expect(widgets).toContain("mic");
    expect(g.items.some((i: any) => i.label === "Vol +" || i.label === "Mic Mute")).toBe(false);
  });

  test("every template passes the agent's layout validation", () => {
    for (const p of SHARED) expect(() => validateLayout(p.layout())).not.toThrow();
  });

  test("each call returns a fresh copy (applying a template cannot mutate it)", () => {
    const a = sharedGamingPc();
    a.pages[0]!.items.length = 0;
    expect(sharedGamingPc().pages[0]!.items.length).toBeGreaterThan(0);
  });
});

describe("offer to re-apply a changed built-in template", () => {
  const { staleTemplate } = require("../web/manage/src/components/layout-presets");
  const gaming = MANAGE.find((p) => p.id === "gaming-pc")!;
  test("a layout made from an older Gaming PC (same screens, different tiles) is offered the new one", () => {
    const old = structuredClone(gaming.layout);
    old.pages[0]!.items = old.pages[0]!.items.filter((i: any) => i.widget !== "volume" && i.widget !== "mic");
    expect(staleTemplate(old, MANAGE)?.id).toBe("gaming-pc");
  });
  test("the current template, or an unrelated layout, is not", () => {
    expect(staleTemplate(structuredClone(gaming.layout), MANAGE)).toBeNull();
    expect(staleTemplate({ version: 1, pages: [{ id: "main", name: "Main", columns: 4, rows: 2, items: [] }] }, MANAGE)).toBeNull();
  });
});
