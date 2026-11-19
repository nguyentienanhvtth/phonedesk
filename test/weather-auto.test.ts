import "./_fetch";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PHONEDESK_HOME = mkdtempSync(join(tmpdir(), "pd-wxauto-"));
const { startServer } = await import("../src/server");
const { HassClient } = await import("../src/hass/client");
const { HassConfigStore } = await import("../src/hass/config");

// A HassClient that is "connected" when the test says so, with one weather entity; nothing touches the network.
class FakeHass extends HassClient {
  up = false;
  constructor() { super({ store: new HassConfigStore({ home: mkdtempSync(join(tmpdir(), "pd-wxauto-hass-")), platform: "linux" }) }); }
  override connected() { return this.up; }
  override async start() { /* no socket */ }
  override async weatherEntity() { return this.up ? "weather.forecast_home" : null; }
  override async weather(id: string) { return { state: "sunny", attributes: { friendly_name: id, temperature: 30 }, hourly: [], daily: [] }; }
  setUp(v: boolean) { this.up = v; (this as any).ready = v; (this as any).emitStatus(); } // status() reports `ready`
}

let app: any, base = "", token = "";
const hass = new FakeHass();

beforeAll(async () => {
  const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
  app = await startServer({
    port: 0, pin: "555555", hostName: async () => "my-mac", hass,
    webhookKeyFile: join(process.env.PHONEDESK_HOME!, "webhook-key"),
    layoutHistoryDir: mkdtempSync(join(tmpdir(), "pd-wxauto-hist-")),
    weatherFetch: async () => { throw new Error("no network in this test"); },
    deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null },
    aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
  } as any);
  base = `http://localhost:${app.port}`;
  const { defaultLayout } = await import("../src/config");
  const layout = { ...defaultLayout(), pages: [{ id: "p", name: "P", items: [{ id: "wx", kind: "widget", widget: "weather", weather: { source: "auto" }, x: 0, y: 0, w: 2, h: 2 }] }] };
  expect((await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(layout) })).status).toBe(200);
  token = ((await (await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ pin: "555555", name: "t" }) })).json()) as any).token;
});
afterAll(async () => {
  // config's HOME is shared by every test file in this process: put the default layout back for the others
  const { defaultLayout } = await import("../src/config");
  if (base) await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(defaultLayout()) }).catch(() => {});
  app?.stop();
});

test("a weather tile on auto starts working when Home Assistant connects after the agent started, and says what to do before", async () => {
  const ws = new WebSocket(`ws://localhost:${app.port}/ws?token=${token}`);
  const msgs: any[] = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
  const until = async (pred: (m: any) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const i = msgs.findIndex(pred); if (i >= 0) return msgs.splice(i, 1)[0]; await Bun.sleep(20); }
    throw new Error("timeout; got " + JSON.stringify(msgs.map((m) => [m.type, m.items])));
  };
  const first = await until((m) => m.type === "weather");
  expect(first.items.wx.error).toBe("Pick a city in Manage > Weather, or connect Home Assistant");
  hass.setUp(true); // HA connects later: the agent re-evaluates and pushes
  const second = await until((m) => m.type === "weather" && !m.items.wx.error);
  expect(second.items.wx).toMatchObject({ source: "hass", location: "weather.forecast_home" });
  hass.setUp(false); // and again when it goes away
  const third = await until((m) => m.type === "weather");
  expect(third.items.wx.error).toContain("Pick a city");
  ws.close();
});
