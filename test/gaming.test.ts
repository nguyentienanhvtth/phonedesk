import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawFetch } from "./_fetch";

const { validateLayout, defaultLayout } = await import("../src/config");
const { RuleEngine, APP_RULE_COOLDOWN_MS } = await import("../src/rules");
const { appKey } = await import("../src/automation");
const G = await import("../src/gaming");
const { hotkeyEvents, hotkeyHoldEvents } = await import("../src/platform/win32/keys");
const WG = await import("../src/platform/win32/gaming");
const U = await import("../src/platform/unix-gaming");
const W = await import("../src/platform/win32");
const { startServer } = await import("../src/server");
const { runMacro } = await import("../src/macro");

const btn = (id: string, action: any, label = id) => ({ id, kind: "button", label, action });
const lay = (items: any[], extra: any = {}) => ({ version: 1, pages: [{ id: "main", name: "Main", columns: 4, rows: 2, items }, { id: "game", name: "Game", columns: 4, rows: 2, items: [] }], ...extra });

describe("validation of the new config", () => {
  test("app-volume: program name, command, level for set, step for up/down", () => {
    const ok = validateLayout(lay([btn("a", { type: "app-volume", app: "Discord.exe", command: "set", level: 40 }), btn("b", { type: "app-volume", app: "cs2", command: "down", step: 5 }), btn("c", { type: "app-volume", app: "Spotify", command: "toggle-mute", level: 9 })]));
    expect(ok.pages[0]!.items.map((i: any) => i.action)).toEqual([
      { type: "app-volume", app: "Discord.exe", command: "set", level: 40 },
      { type: "app-volume", app: "cs2", command: "down", step: 5 },
      { type: "app-volume", app: "Spotify", command: "toggle-mute" },
    ]);
    expect(() => validateLayout(lay([btn("a", { type: "app-volume", app: "x;rm -rf", command: "set", level: 1 })]))).toThrow("program name");
    expect(() => validateLayout(lay([btn("a", { type: "app-volume", app: "x", command: "set" })]))).toThrow("level must be an integer 0-100");
    expect(() => validateLayout(lay([btn("a", { type: "app-volume", app: "x", command: "louder" })]))).toThrow("command must be one of");
  });

  test("output-device: 1-8 names, optional input flow", () => {
    const ok = validateLayout(lay([btn("a", { type: "output-device", devices: [" Headphones (Arctis) ", "Speakers"] }), btn("b", { type: "output-device", devices: ["Mic"], flow: "input" })]));
    expect((ok.pages[0]!.items[0] as any).action).toEqual({ type: "output-device", devices: ["Headphones (Arctis)", "Speakers"] });
    expect((ok.pages[0]!.items[1] as any).action.flow).toBe("input");
    expect(() => validateLayout(lay([btn("a", { type: "output-device", devices: [] })]))).toThrow("choose at least one device");
    expect(() => validateLayout(lay([btn("a", { type: "output-device", devices: Array(9).fill("x") })]))).toThrow("at most 8");
    expect(() => validateLayout(lay([btn("a", { type: "output-device", devices: ["x"], flow: "both" })]))).toThrow("output or input");
  });

  test("hotkey hold is a boolean; only true is kept", () => {
    const ok = validateLayout(lay([btn("a", { type: "hotkey", keys: "v", hold: true }), btn("b", { type: "hotkey", keys: "v", hold: false })]));
    expect((ok.pages[0]!.items[0] as any).action).toEqual({ type: "hotkey", keys: "v", hold: true });
    expect((ok.pages[0]!.items[1] as any).action).toEqual({ type: "hotkey", keys: "v" });
    expect(() => validateLayout(lay([btn("a", { type: "hotkey", keys: "v", hold: "yes" })]))).toThrow("hold must be true or false");
  });

  test("app rules and macro sound / page steps", () => {
    const ok = validateLayout(lay([btn("m", { type: "macro", steps: [{ kind: "sound", sound: "snd:0123456789abcdef", on: "both", volume: 50 }, { kind: "page", pageId: "game" }] })], {
      rules: [{ id: "r", name: "CS2", when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: "game" }], revert: true }, { id: "f", name: "F", when: { kind: "app-foreground", app: "Discord" }, then: [{ kind: "notify", text: "hi" }] }],
    }));
    expect((ok.pages[0]!.items[0] as any).action.steps).toEqual([{ kind: "sound", sound: "snd:0123456789abcdef", on: "both", volume: 50 }, { kind: "page", pageId: "game" }]);
    expect(ok.rules![0]!.when).toEqual({ kind: "app-running", app: "cs2.exe" });
    expect(() => validateLayout(lay([btn("m", { type: "macro", steps: [{ kind: "page", pageId: "nope" }] })]))).toThrow("macro step 1 goes to screen \"nope\", which does not exist");
    expect(() => validateLayout(lay([btn("m", { type: "macro", steps: [{ kind: "sound", sound: "" }] })]))).toThrow("no clip chosen yet");
    expect(() => validateLayout(lay([], { rules: [{ id: "r", name: "r", when: { kind: "app-running", app: "" }, then: [{ kind: "notify", text: "x" }] }] }))).toThrow("program name");
    expect(appKey(" CS2.EXE ")).toBe("cs2");
    expect(appKey("Google Chrome.app")).toBe("google chrome");
  });

  test("the cputemp widget is a known widget", () => {
    expect(() => validateLayout(lay([{ id: "t", kind: "widget", widget: "cputemp" }]))).not.toThrow();
  });
});

describe("app rules: enter / leave edges", () => {
  const mk = (rules: any[]) => {
    let now = 1_000_000;
    const log: string[] = [];
    const e = new RuleEngine({
      rules: () => rules,
      now: () => now,
      actions: {
        gotoPage: (p) => log.push(`goto ${p}`), gotoRevert: (r) => log.push(`revert ${r}`), notify: (t) => log.push(`notify ${t}`),
        themeMode: () => {}, runItem: () => {},
      },
    });
    return { e, log, tick: (ms: number) => { now += ms; } };
  };
  const cs2 = { id: "cs2", name: "CS2", enabled: true, when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: "game", countdown: 0 }], revert: true };

  test("starting the game switches once; quitting goes back; unknown (no poll yet) never fires", () => {
    const { e, log } = mk([cs2]);
    e.evaluate();
    expect(log).toEqual([]);
    e.setApps(["explorer", "steam"], undefined);
    e.setApps(["explorer", "steam", "cs2"], undefined);
    e.setApps(["cs2", "steam"], undefined); // still running: no second goto
    expect(log).toEqual(["goto game"]);
    e.setApps(["steam"], undefined);
    expect(log).toEqual(["goto game", "revert cs2"]);
  });

  test("a failed poll (setApps(undefined)) keeps the last state", () => {
    const { e, log } = mk([cs2]);
    e.setApps(["CS2"], undefined);
    e.setApps(undefined, undefined);
    expect(log).toEqual(["goto game"]);
  });

  test("foreground: alt-tab out and in again fires again after the short rest, not after a minute", () => {
    const fg = { id: "fg", name: "fg", enabled: true, when: { kind: "app-foreground", app: "cs2" }, then: [{ kind: "goto-page", pageId: "game" }], revert: true };
    const { e, log, tick } = mk([fg]);
    e.setApps(undefined, "cs2");
    tick(1000); e.setApps(undefined, "Discord");
    tick(1000); e.setApps(undefined, "cs2"); // within the rest: waits
    expect(log).toEqual(["goto game", "revert fg"]);
    tick(APP_RULE_COOLDOWN_MS); e.setApps(undefined, "cs2"); // still in the game after the rest: fires
    expect(log).toEqual(["goto game", "revert fg", "goto game"]);
    e.setApps(undefined, null);
    expect(log.at(-1)).toBe("revert fg");
  });

  test("appNeeds asks only for what enabled rules use", () => {
    expect(mk([cs2]).e.appNeeds()).toEqual({ running: true, foreground: false });
    expect(mk([{ ...cs2, enabled: false }]).e.appNeeds()).toEqual({ running: false, foreground: false });
  });
});

describe("pure gaming helpers", () => {
  const devs = [{ id: "{0.0.0.00000000}.{a}", name: "Headphones (Arctis Nova)", isDefault: true }, { id: "{0.0.0.00000000}.{b}", name: "Speakers (Realtek)", isDefault: false }, { id: "{0.0.0.00000000}.{c}", name: "LG TV (NVIDIA High Definition Audio)", isDefault: false }];
  test("device names resolve by id, exact name, or a unique part of the name", () => {
    expect(G.resolveDevice(devs, "{0.0.0.00000000}.{b}")?.name).toBe("Speakers (Realtek)");
    expect(G.resolveDevice(devs, "speakers (realtek)")?.id).toBe("{0.0.0.00000000}.{b}");
    expect(G.resolveDevice(devs, "Arctis")?.id).toBe("{0.0.0.00000000}.{a}");
    expect(G.resolveDevice(devs, "(")).toBeUndefined(); // ambiguous
  });
  test("one device: that one; several: the next after the current default; missing ones are skipped", () => {
    expect(G.pickDevice(devs, ["Speakers"]).name).toBe("Speakers (Realtek)");
    expect(G.pickDevice(devs, ["Arctis", "Speakers"]).name).toBe("Speakers (Realtek)");
    expect(G.pickDevice(devs.map((d) => ({ ...d, isDefault: d.name.startsWith("Speakers") })), ["Arctis", "Speakers"]).name).toContain("Arctis");
    expect(G.pickDevice(devs, ["Unplugged", "LG TV"]).name).toContain("LG TV");
    expect(G.pickDevice(devs, ["LG TV", "Speakers"]).name).toContain("LG TV"); // default not in the list: the first
    expect(() => G.pickDevice(devs, ["Unplugged"])).toThrow("“Unplugged” is not connected");
    expect(() => G.pickDevice(devs, ["A1", "A2"])).toThrow("none of the chosen audio devices is connected");
  });
  test("app-volume commands map to changes", () => {
    expect(G.appVolumeChange({ type: "app-volume", app: "x", command: "set", level: 30 })).toEqual({ level: 30 });
    expect(G.appVolumeChange({ type: "app-volume", app: "x", command: "up" })).toEqual({ delta: 10 });
    expect(G.appVolumeChange({ type: "app-volume", app: "x", command: "down", step: 5 })).toEqual({ delta: -5 });
    expect(G.appVolumeChange({ type: "app-volume", app: "x", command: "toggle-mute" })).toEqual({ muted: "toggle" });
  });
  test("HoldTracker: down once, up releases, a phone's holds end when it goes, the timeout lets go", async () => {
    const calls: string[] = [];
    const h = new G.HoldTracker<string>({ hold: async (k, d) => { calls.push(`${k}${d ? "v" : "^"}`); }, maxMs: 30 });
    await h.down("p/a", "phone1", "v");
    await h.down("p/a", "phone1", "v");
    await h.down("p/b", "phone2", "b");
    expect(calls).toEqual(["vv", "bv"]);
    await h.release("phone1");
    expect(calls).toEqual(["vv", "bv", "v^"]);
    await h.up("p/a"); // nothing held there any more
    await Bun.sleep(60);
    expect(calls).toEqual(["vv", "bv", "v^", "b^"]);
    expect(h.size).toBe(0);
  });
  test("HoldTracker: a failing key down is not left as held", async () => {
    const h = new G.HoldTracker<string>({ hold: async () => { throw new Error("blocked"); } });
    await expect(h.down("k", "o", "v")).rejects.toThrow("blocked");
    expect(h.isHeld("k")).toBe(false);
  });
});

describe("Windows: held keys and the helper replies", () => {
  const scan = () => null;
  test("the hold halves are exactly the tap's events", () => {
    for (const keys of ["v", "ctrl+shift+m", "win+alt+g", "f13"]) {
      const all = hotkeyEvents(keys, scan as any);
      expect([...hotkeyHoldEvents(keys, "down", scan as any), ...hotkeyHoldEvents(keys, "up", scan as any)]).toEqual(all);
      expect(hotkeyHoldEvents(keys, "down", scan as any).every((e) => !e.up)).toBe(true);
      expect(hotkeyHoldEvents(keys, "up", scan as any).every((e) => e.up)).toBe(true);
    }
  });
  test("helper rows are checked", () => {
    expect(WG.parseSessions([{ pid: 4, app: "Discord", level: 140, muted: 1, active: true }, { pid: "x" }, null])).toEqual([{ pid: 4, app: "Discord", level: 100, muted: true, active: true }]);
    expect(WG.parseDevices([{ id: "{0.0.0.00000000}.{x}", name: " Speakers ", isDefault: true }, { name: "no id" }])).toEqual([{ id: "{0.0.0.00000000}.{x}", name: "Speakers", isDefault: true }]);
    expect(WG.parseCpuTemp({ celsius: 54.26, source: "librehardwaremonitor", sensor: "CPU Package" })).toEqual({ celsius: 54.3, source: "librehardwaremonitor", sensor: "CPU Package" });
    expect(WG.parseCpuTemp({ celsius: null, source: "none" })).toEqual({ celsius: null, source: "none" });
    expect(WG.parseCpuTemp({ celsius: -273, source: "acpi" })).toEqual({ celsius: null, source: "none" });
    expect(WG.WIN_DEVICE_ID_RE.test("{0.0.0.00000000}.{9d3f1c2a-1234-4abc-9def-0123456789ab}")).toBe(true);
    expect(WG.WIN_DEVICE_ID_RE.test("'; Remove-Item C:\\ #")).toBe(false);
  });
  test("createWin32: gaming calls go to the fixed helper commands with plain data", async () => {
    const calls: any[] = [];
    const sent: any[] = [];
    const answers: Record<string, any> = {
      "proc.names": ["cs2", "steam"], "window.foregroundapp": "cs2",
      "audio.session.set": [{ pid: 1, app: "Discord", level: 30, muted: false, active: true }],
      "audio.devices": [{ id: "{0.0.0.00000000}.{a}", name: "Speakers", isDefault: true }], "audio.default": true,
      "temp.cpu": { celsius: 61, source: "acpi", sensor: "ACPI thermal zone" },
    };
    const p = W.createWin32({ helper: { call: async (cmd: string, args: any) => { calls.push({ cmd, args }); return answers[cmd] ?? null; }, dispose: () => {} } as any, send: (e) => { sent.push(e); }, scan: () => null, run: async () => "" });
    expect(await p.runningApps!()).toEqual(["cs2", "steam"]);
    expect(await p.foregroundApp!()).toBe("cs2");
    expect((await p.setAppVolume!("Discord", { delta: -250, muted: "toggle" }))[0]!.level).toBe(30);
    expect(calls.find((c) => c.cmd === "audio.session.set").args).toEqual({ app: "Discord", delta: -100, muted: "toggle" });
    expect((await p.audioDevices!("output"))[0]!.name).toBe("Speakers");
    await p.setDefaultAudioDevice!("{0.0.0.00000000}.{a}");
    await expect(p.setDefaultAudioDevice!("x")).rejects.toThrow("not an audio device id");
    expect(await p.cpuTemp!()).toEqual({ celsius: 61, source: "acpi", sensor: "ACPI thermal zone" });
    await p.holdKeys!("ctrl+v", true);
    await p.holdKeys!("ctrl+v", false);
    expect(sent.map((e) => e.map((x: any) => (x.up ? "^" : "v") + x.vk.toString(16)))).toEqual([["v11", "v56"], ["^56", "^11"]]);
  });
});

describe("macOS / Linux readers", () => {
  test("ps names and lsappinfo", () => {
    expect(U.parsePsNames("launchd\n/usr/sbin/cfprefsd\nSafari\nSafari\n\n")).toEqual(["launchd", "cfprefsd", "Safari"]);
    expect(U.parseLsappinfoName('"LSDisplayName"="Google Chrome"\n')).toBe("Google Chrome");
    expect(U.parseLsappinfoName("")).toBeNull();
  });
  test("Linux CPU temperature from hwmon, then thermal zones", async () => {
    const root = mkdtempSync(join(tmpdir(), "pd-sys-"));
    mkdirSync(join(root, "hwmon", "hwmon0"), { recursive: true });
    writeFileSync(join(root, "hwmon", "hwmon0", "name"), "nvme\n");
    writeFileSync(join(root, "hwmon", "hwmon0", "temp1_input"), "40000\n");
    mkdirSync(join(root, "thermal", "thermal_zone1"), { recursive: true });
    writeFileSync(join(root, "thermal", "thermal_zone1", "type"), "x86_pkg_temp\n");
    writeFileSync(join(root, "thermal", "thermal_zone1", "temp"), "48500\n");
    expect(await U.linuxCpuTemp(root)).toEqual({ celsius: 48.5, source: "sysfs", sensor: "x86_pkg_temp" });
    mkdirSync(join(root, "hwmon", "hwmon1"));
    writeFileSync(join(root, "hwmon", "hwmon1", "name"), "k10temp\n");
    writeFileSync(join(root, "hwmon", "hwmon1", "temp1_input"), "61250\n");
    expect(await U.linuxCpuTemp(root)).toEqual({ celsius: 61.3, source: "sysfs", sensor: "k10temp" } as any);
    expect(await U.linuxCpuTemp(join(root, "none"))).toEqual({ celsius: null, source: "none" });
  });
});

describe("macro steps", () => {
  test("sound plays like a sound button (overlapping), page switches the phone", async () => {
    const ran: any[] = [];
    const pages: string[] = [];
    await runMacro([{ kind: "sound", sound: "snd:0123456789abcdef", on: "phone" }, { kind: "page", pageId: "game" }], {
      exec: async (a) => { ran.push(a); }, item: () => undefined, notify: () => {}, sleep: async () => {}, gotoPage: (p) => pages.push(p),
    });
    expect(ran).toEqual([{ type: "sound", sound: "snd:0123456789abcdef", on: "phone", mode: "overlap" }]);
    expect(pages).toEqual(["game"]);
    await expect(runMacro([{ kind: "page", pageId: "x" }], { exec: async () => {}, item: () => undefined, notify: () => {}, sleep: async () => {} })).rejects.toThrow("step 1 (page)");
  });
});
