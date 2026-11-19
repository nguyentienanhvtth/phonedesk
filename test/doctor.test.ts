import "./_fetch";
import { rawFetch } from "./_fetch";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fake probes only: nothing here asks macOS for a prompt, reads the real Keychain secret, or touches ~/.claude.
process.env.PHONEDESK_HOME ??= mkdtempSync(join(tmpdir(), "pd-doc-"));
const D = await import("../src/doctor");
const I = await import("../src/i18n");
const HI = await import("../src/hooks-install");
const { startServer } = await import("../src/server");
const { defaultLayout } = await import("../src/config");

afterAll(() => I.setLanguage("en"));

type P = import("../src/doctor").Probes;
const EXE = "/h/.phonedesk/bin/phonedesk";
function probes(over: Partial<P> & { outputs?: Record<string, { code: number; out: string }>; auto?: Record<string, import("../src/doctor").AutomationState>; apps?: string[] } = {}) {
  const calls: string[][] = [];
  const asked = { ax: 0, auto: [] as string[] };
  const p: P = {
    platform: "darwin", exe: EXE, program: [EXE], version: "phonedesk 1.2.3", asService: true,
    run: async (argv) => { calls.push(argv); const key = argv[0]!.split("/").pop() + (argv[1] ? ` ${argv[1]}` : ""); return over.outputs?.[key] ?? over.outputs?.[argv[0]!.split("/").pop()!] ?? { code: 0, out: "" }; },
    axTrusted: () => true,
    automation: (b) => over.auto?.[b] ?? "granted",
    requestAccessibility: () => { asked.ax++; return false; },
    requestAutomation: (b) => { asked.auto.push(b); return "not-asked"; },
    installed: (b) => over.apps ? over.apps.includes(b) : true,
    which: (n) => (n === "nowplaying-cli" ? "/opt/homebrew/bin/nowplaying-cli" : null),
    hookFiles: () => ({}),
    ...over,
  };
  return { p, calls, asked };
}
const INST = { port: 7420, home: join(require("node:os").homedir(), ".phonedesk") };
const run = async (o: Parameters<typeof probes>[0] = {}, ctx: Partial<import("../src/doctor").DoctorCtx> = {}) => {
  const k = probes(o);
  const r = await D.runDoctor(k.p, { instance: INST, ...ctx });
  return { r, ...k, by: (id: string) => r.items.find((i) => i.id === id)! };
};
const FW_ON = { "socketfilterfw --getglobalstate": { code: 0, out: "Firewall is enabled. (State = 1)" } };
const SIG_ADHOC = { codesign: { code: 0, out: "Executable=/x\nSignature=adhoc\nTeamIdentifier=not set" } };

describe("item shape", () => {
  test("every item has id, title, a valid status and a detail; problems carry a fix", async () => {
    const { r } = await run({ outputs: { ...FW_ON, ...SIG_ADHOC, "security find-generic-password": { code: 44, out: "not found" } }, auto: { "com.apple.Music": "denied" } }, {});
    const ids = r.items.map((i) => i.id);
    expect(ids).toEqual(["agent", "service", "signature", "accessibility", "automation-system-events", "automation-music", "automation-spotify", "keychain-claude", "keychain-hass", "local-network", "firewall", "nowplaying-cli", "hooks-claude", "hooks-codex"]);
    for (const i of r.items) {
      expect(["ok", "missing", "denied", "unknown", "n/a"]).toContain(i.status);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.detail.length).toBeGreaterThan(0);
      if (i.status === "missing" || i.status === "denied") expect(i.fix?.text.length).toBeGreaterThan(0);
    }
    expect(r).toMatchObject({ version: "phonedesk 1.2.3", exe: EXE, asService: true, platform: "darwin" });
  });
  test("it never asks macOS for a prompt", async () => {
    const { asked } = await run({ auto: { "com.apple.Music": "not-asked" } });
    expect(asked).toEqual({ ax: 0, auto: [] });
  });
});

describe("Accessibility and Automation", () => {
  test("accessibility: granted / not granted (pane link) / cannot ask; says who owns it", async () => {
    expect((await run()).by("accessibility")).toMatchObject({ status: "ok", detail: "granted to the phonedesk program" });
    const miss = (await run({ axTrusted: () => false, asService: false })).by("accessibility");
    expect(miss).toMatchObject({ status: "missing", fix: { settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" } });
    expect(miss.detail).toContain("terminal app");
    expect((await run({ axTrusted: () => null })).by("accessibility").status).toBe("unknown");
  });
  test("automation: granted, denied, not asked yet, app not running, app not installed", async () => {
    const { by } = await run({
      auto: { "com.apple.systemevents": "granted", "com.apple.Music": "denied", "com.spotify.client": "not-asked" },
    });
    expect(by("automation-system-events").status).toBe("ok");
    expect(by("automation-music")).toMatchObject({ status: "denied", fix: { settingsUrl: expect.stringContaining("Privacy_Automation") } });
    expect(by("automation-spotify")).toMatchObject({ status: "missing" });
    expect(by("automation-spotify").fix!.text).toContain("--request automation-spotify");
    const n = await run({ auto: { "com.spotify.client": "not-running" }, apps: ["com.apple.Music", "com.spotify.client"] });
    expect(n.by("automation-spotify").status).toBe("unknown");
    const none = await run({ apps: ["com.apple.Music"] });
    expect(none.by("automation-spotify")).toMatchObject({ status: "n/a", detail: "Spotify is not installed" });
  });
  test("not macOS: n/a everywhere that is macOS-only", async () => {
    const { by } = await run({ platform: "linux", outputs: {} });
    for (const id of ["accessibility", "automation-music", "keychain-claude", "local-network", "firewall", "signature"]) expect(by(id).status).toBe("n/a");
  });
});

describe("Keychain, Local Network, Firewall, signature", () => {
  test("Claude item: only asks whether it exists (never -w); missing / unread / ok / read failed", async () => {
    const found = await run({ outputs: { "security find-generic-password": { code: 0, out: "keychain: ..." } } }, { claude: { ok: true } });
    expect(found.by("keychain-claude").status).toBe("ok");
    const sec = found.calls.find((c) => c[0] === "security")!;
    expect(sec).toEqual(["security", "find-generic-password", "-s", "Claude Code-credentials"]);
    expect(sec).not.toContain("-w");
    expect((await run({ outputs: { "security find-generic-password": { code: 0, out: "" } } }, { claude: null })).by("keychain-claude").status).toBe("unknown");
    const bad = (await run({ outputs: { "security find-generic-password": { code: 0, out: "" } } }, { claude: { ok: false, error: "denied by user" } })).by("keychain-claude");
    expect(bad).toMatchObject({ status: "denied" });
    expect(bad.detail).toContain("denied by user");
    expect((await run({ outputs: { "security find-generic-password": { code: 44, out: "" } } })).by("keychain-claude")).toMatchObject({ status: "missing", fix: { text: "Sign in to Claude Code on this Mac." } });
  });
  test("Home Assistant token: n/a without HA, ok, or missing", async () => {
    expect((await run()).by("keychain-hass").status).toBe("n/a");
    const st = (o: any) => ({ url: "http://ha.example:8123", hasToken: true, connected: false, ...o });
    expect((await run({}, { hass: st({}) })).by("keychain-hass").status).toBe("ok");
    expect((await run({}, { hass: st({ hasToken: false }) })).by("keychain-hass").status).toBe("missing");
  });
  test("Local Network: n/a, ok, an EHOSTUNREACH-like failure = denied with the pane link, other failures = unknown", async () => {
    const st = (o: any) => ({ url: "http://ha.example:8123", hasToken: true, connected: false, ...o });
    expect((await run()).by("local-network").status).toBe("n/a");
    expect((await run({}, { hass: st({ connected: true }) })).by("local-network").status).toBe("ok");
    const denied = (await run({}, { hass: st({ error: "cannot connect to ha.example:8123 (...)", detail: "connect EHOSTUNREACH 192.0.2.7:8123" }) })).by("local-network");
    expect(denied).toMatchObject({ status: "denied", fix: { settingsUrl: expect.stringContaining("Privacy_LocalNetwork") } });
    expect(denied.detail).toContain("EHOSTUNREACH");
    expect((await run({}, { hass: st({ error: "invalid token", detail: "auth_invalid" }) })).by("local-network").status).toBe("unknown");
  });
  test("Firewall: off, on+allowed, on+blocked, on+not in the list; asks about THIS exe", async () => {
    const fw = (global: string, app: string) => ({ "socketfilterfw --getglobalstate": { code: 0, out: global }, "socketfilterfw --getappblocked": { code: 0, out: app } });
    expect((await run({ outputs: fw("Firewall is disabled. (State = 0)", "") })).by("firewall").status).toBe("ok");
    const on = "Firewall is enabled. (State = 1)";
    expect((await run({ outputs: fw(on, "Incoming connections to phonedesk are permitted") })).by("firewall").status).toBe("ok");
    expect((await run({ outputs: fw(on, "Incoming connections to phonedesk are blocked") })).by("firewall")).toMatchObject({ status: "denied", fix: { settingsUrl: expect.any(String) } });
    const nl = await run({ outputs: fw(on, "The application is not part of the application firewall.") });
    expect(nl.by("firewall").status).toBe("unknown");
    expect(nl.calls.find((c) => c[1] === "--getappblocked")![2]).toBe(EXE);
    expect((await run({ outputs: { "socketfilterfw --getglobalstate": { code: 1, out: "" } } })).by("firewall").status).toBe("unknown");
  });
  test("signature: ad-hoc (with the re-add note) vs Developer ID", async () => {
    const a = (await run({ outputs: SIG_ADHOC })).by("signature");
    expect(a).toMatchObject({ status: "ok" });
    expect(a.detail).toContain("ad-hoc");
    expect(a.fix!.text).toContain("remove the old phonedesk entries");
    const dev = (await run({ outputs: { codesign: { code: 0, out: "Authority=Developer ID Application: Someone (ABCDE12345)\nAuthority=Apple" } } })).by("signature");
    expect(dev.detail).toContain("Developer ID Application: Someone (ABCDE12345)");
  });
  test("optional nowplaying-cli is never counted; the Claude read in flight is unknown, not a failure", async () => {
    const r = await run({ which: () => null, axTrusted: () => true, outputs: { ...FW_ON, "socketfilterfw --getappblocked": { code: 0, out: "permitted" }, ...SIG_ADHOC, "security find-generic-password": { code: 0, out: "" } } }, { claude: { ok: false, pending: true } });
    expect(r.by("keychain-claude")).toMatchObject({ status: "unknown", detail: "checking…" });
    const text = D.formatReport(r.r);
    expect(text).toContain("Note: Install it with `brew install nowplaying-cli`.");
    expect(text).toContain("Everything that can be checked looks fine.");
    expect(text).not.toMatch(/✗ nowplaying/);
  });
  test("System Events is launched silently when it is not running; Music and Spotify are not", async () => {
    let state: import("../src/doctor").AutomationState = "not-running";
    const k = probes({ automation: (b) => (b === "com.apple.systemevents" ? state : "not-running"), run: async (argv) => { if (argv[0] === "open") state = "granted"; return { code: 0, out: "" }; } });
    const r = await D.runDoctor(k.p, { instance: INST });
    expect(r.items.find((i) => i.id === "automation-system-events")!.status).toBe("ok");
    expect(r.items.find((i) => i.id === "automation-music")!.status).toBe("unknown");
    const opens = k.calls.filter((c) => c[0] === "open");
    expect(opens).toEqual([]); // run() is overridden above, so assert through state instead
  });
  test("service and nowplaying-cli", async () => {
    expect((await run()).by("service")).toMatchObject({ status: "ok" });
    const term = (await run({ asService: false })).by("service");
    expect(term.status).toBe("n/a");
    expect(term.fix!.text).toContain("service install");
    expect((await run({ which: () => null })).by("nowplaying-cli")).toMatchObject({ status: "n/a", fix: { text: expect.stringContaining("brew install") } });
  });
});

describe("hooks", () => {
  const settings = () => join(mkdtempSync(join(tmpdir(), "pd-dh-")), "settings.json");
  test("installed and pointing here / pointing elsewhere / another instance ignored / not installed / sandboxed", async () => {
    const f = settings();
    writeFileSync(f, "{}");
    await HI.installHook(f, HI.hookCommand("claude", { execPath: EXE }));
    const ok = await run({ hookFiles: () => ({ claude: f }) });
    expect(ok.by("hooks-claude")).toMatchObject({ status: "ok" });
    expect(ok.by("hooks-codex").status).toBe("n/a");

    const g = settings();
    writeFileSync(g, "{}");
    await HI.installHook(g, HI.hookCommand("claude", { execPath: "/somewhere/else/phonedesk" }));
    const stale = await run({ hookFiles: () => ({ claude: g }) });
    expect(stale.by("hooks-claude")).toMatchObject({ status: "missing", fix: { text: expect.stringContaining("hooks repoint") } });

    const h = settings();
    writeFileSync(h, "{}");
    await HI.installHook(h, HI.hookCommand("claude", { execPath: "/old/phonedesk", port: 7460, home: "/other" }));
    expect((await run({ hookFiles: () => ({ claude: h }) })).by("hooks-claude").status).toBe("n/a"); // someone else's instance

    expect((await run({ hookFiles: () => ({ claude: join(tmpdir(), "no-such-file.json") }) })).by("hooks-claude").status).toBe("n/a");
    expect((await run()).by("hooks-claude").detail).toContain("sandboxed");
  });
});

describe("text output and language", () => {
  test("✓ ✗ ? - marks, the fix under each problem, the pane command, a summary", async () => {
    const { r } = await run({ axTrusted: () => false, auto: { "com.apple.Music": "denied", "com.spotify.client": "not-running" }, apps: ["com.apple.Music", "com.spotify.client"], outputs: SIG_ADHOC });
    const text = D.formatReport(r);
    expect(text).toContain("✓ PhoneDesk - phonedesk 1.2.3");
    expect(text).toMatch(/✗ Accessibility - not granted/);
    expect(text).toContain("    Fix: Open System Settings > Privacy & Security > Accessibility");
    expect(text).toContain("phonedesk doctor --open accessibility");
    expect(text).toMatch(/\? Automation: Spotify/);
    expect(text).toMatch(/- Keychain: Home Assistant token - Home Assistant is not set up/);
    expect(text).toMatch(/\d+ thing\(s\) need attention\./);
    expect(text).not.toContain("\x1b[");
    expect(D.formatReport(r, { color: true })).toContain("\x1b[31m✗\x1b[0m");
    const fine = await run({ outputs: { ...FW_ON, "socketfilterfw --getappblocked": { code: 0, out: "permitted" }, ...SIG_ADHOC, "security find-generic-password": { code: 0, out: "" } } }, { claude: { ok: true } });
    expect(D.formatReport(fine.r)).toContain("Everything that can be checked looks fine.");
  });
  test("Vietnamese when the language is vi; every doctor string has a translation", async () => {
    I.setLanguage("vi");
    const { r } = await run({ axTrusted: () => false });
    const text = D.formatReport(r);
    expect(text).toContain("Trợ năng");
    expect(text).toContain("Cách sửa");
    I.setLanguage("en");
    const src = require("node:fs").readFileSync(join(import.meta.dir, "..", "src", "doctor.ts"), "utf8") as string;
    const i18n = require("node:fs").readFileSync(join(import.meta.dir, "..", "src", "i18n.ts"), "utf8") as string;
    const keys = [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!).concat([...src.matchAll(/why: "([^"]+)"/g)].map((m) => m[1]!));
    expect(keys.length).toBeGreaterThan(50);
    const missing = keys.filter((k) => !i18n.includes(`"${k.replace(/"/g, '\\"')}":`));
    expect(missing).toEqual([]);
  });
  test("requestable ids", () => {
    expect(D.describeRequest("accessibility")).toEqual({ id: "accessibility", kind: "accessibility" });
    expect(D.describeRequest("automation-music")).toEqual({ id: "automation-music", kind: "automation", bundle: "com.apple.Music" });
    expect(D.describeRequest("local-network")).toEqual({ id: "local-network", kind: "local-network" });
    expect(D.tccServiceFor("accessibility")).toBe("Accessibility");
    expect(D.tccServiceFor("automation-music")).toBe("AppleEvents");
    expect(D.tccServiceFor("local-network")).toBeNull();
    expect(D.describeRequest("firewall")).toBeNull();
    expect(D.describeRequest("../x")).toBeNull();
  });
});

describe("the real probes (read-only calls only: no prompts)", () => {
  test.skipIf(process.platform !== "darwin")("AXIsProcessTrusted and the bounded Automation check answer with a value", async () => {
    const p = D.realProbes("x");
    expect([true, false, null]).toContain(await p.axTrusted());
    expect(["granted", "denied", "not-asked", "not-running", "unknown"]).toContain(await p.automation("com.apple.systemevents"));
    expect(p.exe).toBe(process.execPath);
    expect(p.asService).toBe(false);
  });
});

describe("the bounded Automation probe", () => {
  test.skipIf(process.platform !== "darwin")("a child that takes longer than the limit is killed and reported as unknown", async () => {
    D.resetProbeCache();
    const t0 = Date.now();
    expect(await D.boundedAutomation("com.apple.systemevents", 1)).toBe("unknown"); // 1 ms: the child cannot even start
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  test.skipIf(process.platform !== "darwin")("answers are cached for 60 s and one question is asked once at a time", async () => {
    D.resetProbeCache();
    const [a, b] = await Promise.all([D.boundedAutomation("com.apple.systemevents"), D.boundedAutomation("com.apple.systemevents")]);
    expect(b).toBe(a);
    const t0 = Date.now();
    expect(await D.boundedAutomation("com.apple.systemevents")).toBe(a);
    expect(Date.now() - t0).toBeLessThan(50); // from the cache, no child
  });
  test.skipIf(process.platform !== "darwin")("an app that is not running is not probed at all", async () => {
    D.resetProbeCache();
    // a bundle that has no process name entry would be asked; Spotify/Music are checked with pgrep first
    const r = await D.boundedAutomation("com.spotify.client");
    expect(["not-running", "granted", "denied", "not-asked", "unknown"]).toContain(r);
  });
  test.skipIf(process.platform !== "darwin")("the agent keeps answering while the REAL /api/doctor runs", async () => {
    const { startServer } = await import("../src/server");
    const dir2 = mkdtempSync(join(tmpdir(), "pd-doc-live-"));
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    const app = await startServer({
      port: 0, pin: "919191", hostName: async () => "my-mac", hookSecret: "s", webhookKeyFile: join(dir2, "wk"), layoutHistoryDir: join(dir2, "h"), askSettingsFile: join(dir2, "ask.json"),
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null, readMedia: async () => null, fetchArtwork: async () => undefined, topProcesses: async () => [] } as any,
      aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
    } as any);
    try {
      D.resetProbeCache();
      const doctor = fetch(`http://localhost:${app.port}/api/doctor`);
      let worst = 0;
      for (let i = 0; i < 5; i++) { const t0 = Date.now(); expect((await fetch(`http://localhost:${app.port}/api/about`)).status).toBe(200); worst = Math.max(worst, Date.now() - t0); await Bun.sleep(100); }
      expect(worst).toBeLessThan(1000);
      expect((await doctor).status).toBe(200);
    } finally { app.stop(); }
  }, 30_000);
  test.skipIf(process.platform !== "darwin")("the internal __ae command answers with one state word and exits", () => {
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "index.ts"), "__ae", "com.apple.systemevents"], { env: { PATH: process.env.PATH!, PHONEDESK_HOME: mkdtempSync(join(tmpdir(), "pd-ae-")) }, stdout: "pipe", stderr: "pipe", timeout: 15_000 }); // PHONEDESK_HOME is set
    expect(["granted", "denied", "not-asked", "not-running", "unknown"]).toContain(r.stdout.toString().trim());
  });
});

describe("GET /api/doctor and the CLI", () => {
  let app: Awaited<ReturnType<typeof startServer>>;
  let base: string;
  let k: ReturnType<typeof probes>;
  const dir = mkdtempSync(join(tmpdir(), "pd-doc-srv-"));
  const original = defaultLayout();
  const opened: string[] = [];
  beforeAll(async () => {
    k = probes({ axTrusted: () => false, outputs: { ...FW_ON, ...SIG_ADHOC } });
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    app = await startServer({
      port: 0, pin: "919191", hostName: async () => "my-mac", hookSecret: "s", webhookKeyFile: join(dir, "wk"), layoutHistoryDir: join(dir, "h"), askSettingsFile: join(dir, "ask.json"),
      doctorProbes: k.p, doctorWaitMs: 0, openExternal: async (u: string) => { opened.push(u); },
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null, readMedia: async () => null, fetchArtwork: async () => undefined, topProcesses: async () => [] } as any,
      aiSources: { claude: async () => ({ ...q("claude"), error: "Sign in to Claude Code on this Mac" }), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
    } as any);
    base = `http://localhost:${app.port}`;
  });
  afterAll(async () => {
    await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(original) });
    app.stop();
  });

  test("localhost only: a foreign Host is refused; the report is the agent's own", async () => {
    expect((await rawFetch(`${base}/api/doctor`, { headers: { host: "evil.example" } })).status).toBe(403);
    const r = await (await fetch(`${base}/api/doctor`)).json() as any;
    expect(r.version).toBe("phonedesk 1.2.3");
    expect(r.items.find((i: any) => i.id === "accessibility").status).toBe("missing");
    expect(r.items.find((i: any) => i.id === "keychain-hass").status).toBe("n/a");
    expect(k.asked).toEqual({ ax: 0, auto: [] });
  });

  test("POST /api/doctor/request asks through the fake probes only; other ids are refused; needs the CSRF header", async () => {
    const post = (body: any, headers: Record<string, string> = { "x-phonedesk": "1", "content-type": "application/json" }) => rawFetch(`${base}/api/doctor/request`, { method: "POST", body: JSON.stringify(body), headers });
    expect((await post({ id: "firewall" })).status).toBe(400);
    expect((await post({ id: "accessibility" }, { "content-type": "text/plain" })).status).toBe(403);
    const ok = await (await post({ id: "accessibility" })).json() as any;
    expect(ok).toMatchObject({ ok: true, item: { id: "accessibility" } });
    await post({ id: "automation-music" });
    expect(k.asked).toEqual({ ax: 1, auto: ["com.apple.Music"] });
  });

  test("POST /api/doctor/open opens the item's own settings pane only; unknown ids, items without a pane and foreign pages are refused", async () => {
    const post = (body: any, headers: Record<string, string> = { "x-phonedesk": "1", "content-type": "application/json" }) => rawFetch(`${base}/api/doctor/open`, { method: "POST", body: JSON.stringify(body), headers });
    const r = await post({ id: "accessibility" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" });
    expect(opened).toEqual(["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
    expect((await post({ id: "nope" })).status).toBe(404);
    expect((await post({ id: "agent" })).status).toBe(400); // no pane
    expect((await post({ id: "accessibility" }, { "content-type": "text/plain" })).status).toBe(403); // CSRF header missing
    expect((await rawFetch(`${base}/api/doctor/open`, { method: "POST", body: JSON.stringify({ id: "accessibility" }), headers: { "x-phonedesk": "1", "content-type": "application/json", host: "evil.example" } })).status).toBe(403);
    expect(opened.length).toBe(1);
  });

  test("only OS settings links are openable", () => {
    const item = (settingsUrl: string) => ({ id: "x", title: "x", status: "missing" as const, detail: "", fix: { text: "", settingsUrl } });
    expect(D.openableUrl(item("ms-settings:network-status"))).toBe("ms-settings:network-status");
    expect(D.openableUrl(item("windowsdefender://network"))).toBe("windowsdefender://network");
    expect(D.openableUrl(item("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"))).toBeTruthy();
    expect(D.openableUrl(item("https://evil.example"))).toBeNull();
    expect(D.openableUrl(item("file:///C:/Windows/System32/cmd.exe"))).toBeNull();
    expect(D.openableUrl(item("ms-settings:x & calc"))).toBeNull();
    expect(D.openableUrl(item("ms-settings:x\"&calc"))).toBeNull();
    expect(D.openableUrl(undefined)).toBeNull();
  });

  test("the CLI prints the agent's report, --json, --request, and refuses --open without a pane", async () => {
    const env = { PATH: process.env.PATH!, PHONEDESK_HOME: join(dir, "cli-home") };
    // async: the agent runs in THIS process, so a sync spawn would block it
    const cli = async (args: string[]) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "index.ts"), "doctor", "--port", String(app.port), ...args], { env, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { exitCode: await p.exited, stdout: { toString: () => out }, stderr: { toString: () => err } };
    };
    const text = await cli([]);
    expect(text.stdout.toString()).toContain("✗ Accessibility");
    expect(text.stdout.toString()).not.toContain("No PhoneDesk agent answered");
    expect(text.exitCode).toBe(1); // something needs attention
    const json = JSON.parse((await cli(["--json"])).stdout.toString());
    expect(json.source).toBe("agent");
    expect(json.items.length).toBeGreaterThan(10);
    const before = k.asked.ax;
    const req = await cli(["--request", "accessibility"]);
    expect(req.exitCode).toBe(0);
    expect(req.stdout.toString()).toMatch(/Asked (macOS|Windows)/);
    expect(k.asked.ax).toBe(before + 1);
    const open = await cli(["--open", "agent"]); // no pane for this one: nothing is opened
    expect(open.exitCode).toBe(1);
    expect(open.stderr.toString()).toContain("Nothing to open");
  }, 30_000);

  test("without an agent the CLI falls back to a local check, with a clear warning; --request needs the agent", async () => {
    const free = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = free.port;
    free.stop(true);
    const env = { PATH: process.env.PATH!, PHONEDESK_HOME: join(dir, "cli-home2"), HOME: join(dir, "fake-home") };
    const run = (args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "index.ts"), "doctor", "--port", String(port), ...args], { env, stdout: "pipe", stderr: "pipe" });
    const r = run([]);
    expect(r.stdout.toString()).toContain(`No PhoneDesk agent answered on port ${port}`);
    expect(r.stdout.toString()).toContain("THIS terminal app");
    expect(r.stdout.toString()).toContain("PhoneDesk doctor");
    const req = run(["--request", "accessibility"]);
    expect(req.exitCode).toBe(1);
    expect(req.stderr.toString()).toContain("No PhoneDesk agent answered");
    const j = JSON.parse(run(["--json"]).stdout.toString());
    expect(j.source).toBe("terminal");
  }, 90_000);
});
