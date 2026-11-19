import { describe, expect, test } from "bun:test";
import { setLanguage } from "../web/manage/src/lib/i18n";
import { RULE_TEMPLATES, newWhen, ruleProblems, whenSummary } from "../web/manage/src/lib/rules";
import { actionSummary, defaultAction, WIDGET_LABEL, WIDGET_SIZE } from "../web/manage/src/lib/layout";
import { appChoices, normalizeAudioDevices, normalizeAudioSessions, normalizeRunningApps } from "../web/manage/src/lib/gaming";
import { STATIC_ENTRIES } from "../web/manage/src/lib/palette";
import { ACTION_TYPES as MANAGE_ACTIONS, APP_NAME_RE as MANAGE_APP_RE, WIDGET_KINDS as MANAGE_WIDGETS, type Page, type Rule } from "../web/manage/src/types";
import { ACTION_TYPES, WIDGET_KINDS, defaultLayout, validateLayout } from "../src/config";
import { APP_NAME_RE } from "../src/automation";

const pages: Page[] = [{ id: "gaming", name: "Gaming", columns: 4, rows: 2, items: [] } as unknown as Page];

describe("manage: gaming editors", () => {
  test("the manage page knows every action and widget the agent accepts, and the same program-name rule", () => {
    expect([...MANAGE_ACTIONS].sort()).toEqual([...ACTION_TYPES].sort());
    expect([...MANAGE_WIDGETS].sort()).toEqual([...WIDGET_KINDS].sort());
    expect(MANAGE_APP_RE.source).toBe(APP_NAME_RE.source);
    for (const w of MANAGE_WIDGETS) { expect(WIDGET_SIZE[w]).toBeDefined(); expect(WIDGET_LABEL[w]).toBeDefined(); }
  });

  test("app rules: empty or odd names are flagged, a process name is fine; summaries read well", () => {
    setLanguage("en");
    const rule = (app: string): Rule => ({ id: "r", name: "Game", enabled: true, when: { kind: "app-running", app }, then: [{ kind: "goto-page", pageId: "gaming" }] });
    expect(ruleProblems(rule(""), pages)).toContain("Type the program's process name (e.g. cs2.exe).");
    expect(ruleProblems(rule("cs2.exe; rm"), pages).length).toBe(1);
    expect(ruleProblems(rule("cs2.exe"), pages)).toEqual([]);
    expect(newWhen("app-foreground")).toEqual({ kind: "app-foreground", app: "" });
    expect(whenSummary({ kind: "app-running", app: "cs2.exe" })).toBe("cs2.exe is running");
    setLanguage("vi");
    expect(whenSummary({ kind: "app-foreground", app: "Discord.exe" })).toBe("Discord.exe đang ở trên cùng");
    setLanguage("en");
  });

  test("the game template makes a rule the agent accepts", () => {
    const tpl = RULE_TEMPLATES.find((r) => r.key === "game")!;
    const r = { id: "rule-game", ...tpl.make(pages) };
    const base = defaultLayout();
    const layout = { ...base, pages: [...base.pages, { id: "gaming", name: "Gaming", columns: 4, rows: 2, items: [] }], rules: [r] };
    const v = validateLayout(layout as never);
    expect(v.rules?.[0]?.when).toEqual({ kind: "app-running", app: "cs2.exe" });
  });

  test("new actions: defaults and summaries", () => {
    setLanguage("en");
    expect(defaultAction("app-volume")).toEqual({ type: "app-volume", app: "", command: "down", step: 10 });
    expect(defaultAction("output-device")).toEqual({ type: "output-device", devices: [] });
    expect(actionSummary({ type: "app-volume", app: "Spotify.exe", command: "set", level: 30 })).toBe("Spotify.exe volume 30%");
    expect(actionSummary({ type: "app-volume", app: "cs2.exe", command: "toggle-mute" })).toBe("cs2.exe: toggle mute");
    expect(actionSummary({ type: "output-device", devices: ["Headset"] })).toBe("Audio device: Headset");
    expect(actionSummary({ type: "output-device", devices: ["A", "B"] })).toBe("Cycle 2 audio devices");
    expect(actionSummary({ type: "hotkey", keys: "f13", hold: true })).toContain("Hold");
  });

  test("palette: push-to-talk is valid as is; the device and app tiles need a choice first", () => {
    const ptt = STATIC_ENTRIES.find((e) => e.key === "w-ptt")!.make() as Record<string, unknown>;
    expect(ptt.action).toEqual({ type: "hotkey", keys: "f13", hold: true });
    const base = defaultLayout();
    const withItem = (item: Record<string, unknown>) => ({ ...base, pages: [{ ...base.pages[0]!, columns: 8, rows: 4, items: [{ id: "t1", x: 7, y: 3, ...item }] }] });
    expect(() => validateLayout(withItem(ptt) as never)).not.toThrow();
    expect(() => validateLayout(withItem(STATIC_ENTRIES.find((e) => e.key === "w-outdev")!.make() as never) as never)).toThrow();
    expect(() => validateLayout(withItem({ ...(STATIC_ENTRIES.find((e) => e.key === "w-appvol")!.make() as object), action: { type: "app-volume", app: "cs2.exe", command: "down", step: 10 } }) as never)).not.toThrow();
    for (const k of ["w-cputemp", "w-gpu"]) expect(() => validateLayout(withItem(STATIC_ENTRIES.find((e) => e.key === k)!.make() as never) as never)).not.toThrow();
  });

  test("normalizers drop junk from the agent's answers", () => {
    expect(normalizeRunningApps({ running: ["b.exe", "a.exe", "a.exe", 3, ""], foreground: "a.exe" })).toEqual({ supported: true, running: ["a.exe", "b.exe"], foreground: "a.exe" });
    expect(normalizeRunningApps({ supported: false })).toEqual({ supported: false, running: [], foreground: null });
    expect(normalizeAudioSessions({ sessions: [{ pid: 1, app: "x.exe", level: 140.2, muted: true, active: true }, { app: 5 }] }).sessions).toEqual([{ pid: 1, app: "x.exe", level: 100, muted: true, active: true }]);
    expect(normalizeAudioDevices({ devices: [{ id: "{0.0.0.00000000}.{abc}", name: "Speakers", isDefault: true }, { name: "no id" }] }).devices).toEqual([{ id: "{0.0.0.00000000}.{abc}", name: "Speakers", isDefault: true }]);
    expect(appChoices(["Discord.exe"], ["discord.exe", "cs2.exe"])).toEqual(["Discord.exe", "cs2.exe"]);
  });
});
