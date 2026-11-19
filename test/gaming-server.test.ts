import { rawFetch } from "./_fetch";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { startServer } = await import("../src/server");
const { SoundLibrary } = await import("../src/sounds");

const holds: string[] = [];
const appVol: any[] = [];
let sessionsAfter: any[] = [{ pid: 7, app: "Discord", level: 40, muted: false, active: true }];
let devices = [{ id: "{0.0.0.00000000}.{a}", name: "Headphones (Arctis)", isDefault: true }, { id: "{0.0.0.00000000}.{b}", name: "Speakers (Realtek)", isDefault: false }];
const defaults: string[] = [];
let running = ["explorer"];
let statsCb: (s: any) => void = () => {};
let app: Awaited<ReturnType<typeof startServer>>;
let base: string;
let token: string;

function connect(tok: string) {
  const ws = new WebSocket(`ws://localhost:${app.port}/ws?token=${tok}`);
  const msgs: any[] = [];
  ws.onmessage = (e) => { msgs.push(JSON.parse(String(e.data))); };
  const next = async (pred: (m: any) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = msgs.findIndex(pred);
      if (i >= 0) return msgs.splice(i, 1)[0];
      await Bun.sleep(10);
    }
    throw new Error("timeout");
  };
  const open = new Promise<void>((r) => { ws.onopen = () => r(); });
  let n = 0;
  const req = async (body: any) => { const reqId = `q${++n}`; ws.send(JSON.stringify({ ...body, reqId })); return next((m) => m.type === "result" && m.reqId === reqId); };
  return { ws, next, open, req };
}

const btn = (id: string, action: any) => ({ id, kind: "button", label: id, action });
const layout = {
  version: 1,
  pages: [
    { id: "main", name: "Main", columns: 4, rows: 2, items: [
      btn("ptt", { type: "hotkey", keys: "ctrl+shift+m", hold: true }),
      btn("tap", { type: "hotkey", keys: "v" }),
      btn("disc", { type: "app-volume", app: "Discord", command: "down", step: 5 }),
      btn("dev", { type: "output-device", devices: ["Arctis", "Speakers"] }),
      btn("mac", { type: "macro", steps: [{ kind: "page", pageId: "game" }] }),
      { id: "temp", kind: "widget", widget: "cputemp" },
      { id: "gpu", kind: "widget", widget: "gpu" },
    ] },
    { id: "game", name: "Game", columns: 4, rows: 2, items: [] },
  ],
  rules: [{ id: "cs2", name: "CS2", enabled: true, when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: "game", countdown: 0 }], revert: true }],
};

beforeAll(async () => {
  app = await startServer({
    port: 0, pin: "222333", appPollMs: 40, sensorPollMs: 40, holdMaxMs: 5000,
    deps: {
      runAction: async () => {},
      startStats: (cb) => { statsCb = cb; return () => {}; },
      setVolume: async () => {}, readVolume: async () => null, readMedia: async () => null, fetchArtwork: async () => undefined, topProcesses: async () => [],
      holdKeys: async (k: string, d: boolean) => { holds.push(`${k}${d ? "v" : "^"}`); },
      setAppVolume: async (a: string, c: any) => { appVol.push([a, c]); return sessionsAfter; },
      audioSessions: async () => sessionsAfter,
      audioDevices: async () => devices,
      setDefaultAudioDevice: async (id: string) => { defaults.push(id); devices = devices.map((d) => ({ ...d, isDefault: d.id === id })); },
      runningApps: async () => running,
      foregroundApp: async () => "explorer",
      cpuTemp: async () => ({ celsius: 57.5, source: "librehardwaremonitor", sensor: "CPU Package" }),
      readGpu: async () => ({ available: true, stats: { name: "RTX", loadPercent: 30, tempC: 60, memUsedMB: 1, memTotalMB: 8, powerW: null, clockMHz: null, memClockMHz: null } }),
    } as any,
    aiSources: { claude: async () => ({ id: "claude", name: "c", windows: [], updatedAt: 1 }), codex: async () => ({ id: "codex", name: "c", windows: [], updatedAt: 1 }), antigravity: async () => ({ id: "antigravity", name: "a", windows: [], updatedAt: 1 }), sessions: async () => [] } as any,
    hookSecret: "s", hostName: async () => "pc",
    sounds: new SoundLibrary({ home: mkdtempSync(join(tmpdir(), "pd-gs-snd-")), run: async () => "" }),
    webhookKeyFile: join(mkdtempSync(join(tmpdir(), "pd-gs-")), "wk"),
  } as any);
  base = `http://localhost:${app.port}`;
  const put = await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(layout) });
  expect(put.status).toBe(200);
  token = ((await (await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ pin: "222333", name: "g" }) })).json()) as any).token;
});
afterAll(async () => {
  const { defaultLayout } = await import("../src/config");
  await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(defaultLayout()) });
  app.stop();
});

describe("gaming over the socket", () => {
  test("hold: key down on down, key up on up; a plain button cannot hold; a disconnect lets go", async () => {
    const c = connect(token);
    await c.open;
    expect((await c.req({ type: "hold", pageId: "main", itemId: "ptt", down: true })).ok).toBe(true);
    expect((await c.req({ type: "hold", pageId: "main", itemId: "ptt", down: false })).ok).toBe(true);
    expect(holds).toEqual(["ctrl+shift+mv", "ctrl+shift+m^"]);
    const bad = await c.req({ type: "hold", pageId: "main", itemId: "tap", down: true });
    expect(bad).toMatchObject({ ok: false, error: "this button does not hold keys" });
    expect((await c.req({ type: "hold", pageId: "main", itemId: "ptt", down: true })).ok).toBe(true);
    c.ws.close();
    for (let i = 0; i < 100 && holds.length < 4; i++) await Bun.sleep(10);
    expect(holds).toEqual(["ctrl+shift+mv", "ctrl+shift+m^", "ctrl+shift+mv", "ctrl+shift+m^"]);
  });

  test("app volume: the program's sessions change; no session is a readable error", async () => {
    const c = connect(token);
    await c.open;
    expect((await c.req({ type: "press", pageId: "main", itemId: "disc" })).ok).toBe(true);
    expect(appVol.at(-1)).toEqual(["Discord", { delta: -5 }]);
    sessionsAfter = [];
    const r = await c.req({ type: "press", pageId: "main", itemId: "disc" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Discord has no sound in the volume mixer right now");
    sessionsAfter = [{ pid: 7, app: "Discord", level: 40, muted: false, active: true }];
    c.ws.close();
  });

  test("output device: each press moves to the next device in the list", async () => {
    const c = connect(token);
    await c.open;
    await c.req({ type: "press", pageId: "main", itemId: "dev" });
    await c.req({ type: "press", pageId: "main", itemId: "dev" });
    expect(defaults).toEqual(["{0.0.0.00000000}.{b}", "{0.0.0.00000000}.{a}"]);
    c.ws.close();
  });

  test("macro page step: the phone that pressed switches", async () => {
    const c = connect(token);
    await c.open;
    expect((await c.req({ type: "press", pageId: "main", itemId: "mac" })).ok).toBe(true);
    expect(await c.next((m) => m.type === "goto")).toMatchObject({ pageId: "game", countdown: 0 });
    c.ws.close();
  });

  test("app rule: cs2 starts -> phones go to the game page; it quits -> back", async () => {
    const c = connect(token);
    await c.open;
    running = ["explorer", "cs2"];
    expect(await c.next((m) => m.type === "goto" && m.ruleId === "cs2")).toMatchObject({ pageId: "game", revert: true });
    running = ["explorer"];
    expect(await c.next((m) => m.type === "goto-revert")).toMatchObject({ ruleId: "cs2" });
    c.ws.close();
  });

  test("CPU temperature and GPU ride along in stats while a widget shows them", async () => {
    const c = connect(token);
    await c.open;
    statsCb({ cpu: 5, memUsed: 1, memTotal: 2, uptime: 1, load: [0, 0, 0], loadKind: "estimate", time: 1, host: "pc", net: { rx: 0, tx: 0 }, volume: null });
    const m = await c.next((x) => x.type === "stats" && x.stats.cpuTemp && x.stats.gpu);
    expect(m.stats.cpuTemp).toEqual({ celsius: 57.5, source: "librehardwaremonitor", sensor: "CPU Package" });
    expect(m.stats.gpu.name).toBe("RTX");
    c.ws.close();
  });
});

describe("gaming pickers for the management page", () => {
  test("running apps, audio sessions and devices: localhost only", async () => {
    expect((await rawFetch(`${base}/api/apps/running`, { headers: { host: "evil.example" } })).status).toBe(403);
    expect(await (await fetch(`${base}/api/apps/running`)).json()).toMatchObject({ running: ["explorer"], foreground: "explorer", supported: { running: true, foreground: true } });
    expect(await (await fetch(`${base}/api/audio/sessions`)).json()).toMatchObject({ supported: true, sessions: [{ app: "Discord" }] });
    const d = await (await fetch(`${base}/api/audio/devices?flow=output`)).json() as any;
    expect(d.devices.map((x: any) => x.name)).toEqual(["Headphones (Arctis)", "Speakers (Realtek)"]);
  });
});
