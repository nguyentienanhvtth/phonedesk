import "./_fetch";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PHONEDESK_HOME ??= mkdtempSync(join(tmpdir(), "pd-mic-"));
const { startServer } = await import("../src/server");
const { validateLayout, defaultLayout } = await import("../src/config");

const btn = (id: string, action: any, x: number) => ({ id, kind: "button", label: id, action, x, y: 0 });
const layoutWith = (actions: any[]) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 8, rows: 2, items: actions.map((a, i) => btn(`b${i}`, a, i)) }] });

describe("set-volume and mic actions: validation", () => {
  test("valid forms are kept (output is the default device)", () => {
    const l = validateLayout(layoutWith([
      { type: "set-volume", level: 40 },
      { type: "set-volume", level: 0, device: "mic" },
      { type: "set-volume", level: 100, device: "output" },
      { type: "mic", command: "toggle" },
      { type: "mic", command: "mute" },
      { type: "mic", command: "unmute" },
    ]));
    expect(l.pages[0]!.items.map((i: any) => i.action)).toEqual([
      { type: "set-volume", level: 40 },
      { type: "set-volume", level: 0, device: "mic" },
      { type: "set-volume", level: 100 },
      { type: "mic", command: "toggle" },
      { type: "mic", command: "mute" },
      { type: "mic", command: "unmute" },
    ]);
  });
  test("bad levels, devices and commands are refused", () => {
    expect(() => validateLayout(layoutWith([{ type: "set-volume", level: 101 }]))).toThrow("level must be an integer 0-100");
    expect(() => validateLayout(layoutWith([{ type: "set-volume", level: 12.5 }]))).toThrow("level must be an integer 0-100");
    expect(() => validateLayout(layoutWith([{ type: "set-volume", level: "50" }]))).toThrow("level must be an integer 0-100");
    expect(() => validateLayout(layoutWith([{ type: "set-volume", level: 5, device: "hdmi" }]))).toThrow("device must be output or mic");
    expect(() => validateLayout(layoutWith([{ type: "mic", command: "louder" }]))).toThrow("must be mute, unmute or toggle");
    expect(() => validateLayout(layoutWith([{ type: "mic" }]))).toThrow("must be mute, unmute or toggle");
  });
});

describe("set-volume and mic actions: the agent runs them", () => {
  const volumeCalls: any[] = [];
  const micCalls: any[] = [];
  const ran: any[] = [];
  let mic = { level: 70, muted: false };
  let app: Awaited<ReturnType<typeof startServer>>;
  let base: string;
  let token: string;
  const ACTIONS = [
    { type: "set-volume", level: 35 },
    { type: "set-volume", level: 80, device: "mic" },
    { type: "mic", command: "toggle" },
    { type: "mic", command: "mute" },
    { type: "mic", command: "unmute" },
  ];

  beforeAll(async () => {
    app = await startServer({
      port: 0, pin: "555555", hostName: async () => "pc",
      layoutHistoryDir: mkdtempSync(join(tmpdir(), "pd-mic-hist-")),
      deps: {
        runAction: async (a: any) => { ran.push(a); },
        startStats: () => () => {},
        setVolume: async (v: any) => { volumeCalls.push(v); },
        readVolume: async () => ({ level: 10, muted: false }),
        setMic: async (v: any) => { micCalls.push(v); if ("muted" in v) mic = { ...mic, muted: v.muted }; if ("level" in v) mic = { ...mic, level: v.level }; },
        readMic: async () => mic,
      },
      aiSources: { claude: async () => ({ id: "claude", windows: [] }), codex: async () => ({ id: "codex", windows: [] }), antigravity: async () => ({ id: "antigravity", windows: [] }), sessions: async () => [] } as any,
    } as any);
    base = `http://localhost:${app.port}`;
    expect((await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(layoutWith(ACTIONS)) })).status).toBe(200);
    token = ((await (await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ pin: "555555", name: "t" }) })).json()) as any).token;
  });
  afterAll(async () => {
    await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(defaultLayout()) });
    app.stop();
  });

  const press = async (itemId: string) => {
    const ws = new WebSocket(`ws://localhost:${app.port}/ws?token=${token}`);
    const result = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === "result" && m.reqId === 7) { clearTimeout(t); resolve(m); } };
    });
    await new Promise((r) => { ws.onopen = r; });
    ws.send(JSON.stringify({ type: "press", reqId: 7, pageId: "p", itemId }));
    const r = await result;
    ws.close();
    return r;
  };

  test("set-volume sets the output level, or the microphone level", async () => {
    expect((await press("b0")).ok).toBe(true);
    expect(volumeCalls.at(-1)).toEqual({ level: 35 });
    expect((await press("b1")).ok).toBe(true);
    expect(micCalls.at(-1)).toEqual({ level: 80 });
    expect(ran.filter((a) => a.type === "set-volume" || a.type === "mic")).toEqual([]); // never handed to the OS runner
  });
  test("mic toggle reads the state and flips it; mute / unmute set it", async () => {
    mic = { level: 70, muted: false };
    expect((await press("b2")).ok).toBe(true);
    expect(micCalls.at(-1)).toEqual({ muted: true });
    expect((await press("b2")).ok).toBe(true);
    expect(micCalls.at(-1)).toEqual({ muted: false });
    expect((await press("b3")).ok).toBe(true);
    expect(micCalls.at(-1)).toEqual({ muted: true });
    expect((await press("b4")).ok).toBe(true);
    expect(micCalls.at(-1)).toEqual({ muted: false });
  });
});
