import "./_fetch";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PHONEDESK_HOME = mkdtempSync(join(tmpdir(), "pd-save-"));

const { startServer } = await import("../src/server");
const { replaceFile } = await import("../src/config");
const { LAYOUT_PRESETS } = await import("../web/shared/layout-presets");
const { LAYOUT_PRESETS: MANAGE } = await import("../web/manage/src/components/layout-presets");

let app: Awaited<ReturnType<typeof startServer>>;
let base: string;

beforeAll(async () => {
  app = await startServer({
    port: 0,
    pin: "111111",
    deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => ({ level: 50, muted: false }), readMedia: async () => null },
    hostName: async () => "pc",
  } as any);
  base = `http://localhost:${app.port}`;
});
afterAll(() => app.stop());

describe("saving a layout template through the real API", () => {
  test("Gaming PC exactly as the manage page applies it (template pages + the current theme) saves and reads back", async () => {
    const current = await (await fetch(`${base}/api/layout`)).json();
    const preset = MANAGE.find((p) => p.id === "gaming-pc")!;
    const applied = { ...preset.layout, theme: current.theme };
    const r = await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(applied), headers: { origin: base } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const back = await (await fetch(`${base}/api/layout`)).json();
    const gaming = back.pages.find((p: any) => p.id === "gaming");
    expect(gaming.items.map((i: any) => i.widget).filter(Boolean)).toEqual(expect.arrayContaining(["volume", "mic"]));
    const onDisk = JSON.parse(readFileSync(join(process.env.PHONEDESK_HOME!, "layout.json"), "utf8"));
    expect(onDisk.pages.map((p: any) => p.id)).toEqual(["gaming", "stats", "keys"]);
  });

  test("every built-in template saves", async () => {
    for (const p of LAYOUT_PRESETS) {
      const r = await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(p.layout()) });
      expect(r.status).toBe(200);
    }
  });

  test("a rejected layout comes back as a JSON error the manage page can show", async () => {
    const r = await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify({ pages: [{ id: "a", columns: 2, items: [{ id: "x", kind: "widget", widget: "nope" }] }] }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("not supported");
  });
});

describe("a layout that cannot be written", () => {
  test("answers a JSON error with the reason instead of failing silently", async () => {
    const file = join(process.env.PHONEDESK_HOME!, "layout.json");
    rmSync(file, { force: true });
    mkdirSync(join(file, "blocker"), { recursive: true }); // rename onto a non-empty directory fails on every OS
    try {
      const r = await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(LAYOUT_PRESETS[0]!.layout()) });
      expect(r.status).toBe(500);
      expect((await r.json()).error).toContain("could not write the layout file");
    } finally {
      rmSync(file, { recursive: true, force: true });
    }
  });
});

describe("replaceFile (Windows-safe layout.json replace)", () => {
  test("retries a rename that fails with EPERM, then succeeds", async () => {
    let calls = 0;
    const ren = (async () => { calls++; if (calls < 3) throw Object.assign(new Error("busy"), { code: "EPERM" }); }) as any;
    await replaceFile("a.tmp", "a", { rename: ren, sleep: async () => {} });
    expect(calls).toBe(3);
  });

  test("falls back to copying over the target when the rename keeps failing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pd-rep-"));
    const tmp = join(dir, "l.json.tmp"), file = join(dir, "l.json");
    writeFileSync(file, "old");
    writeFileSync(tmp, "new");
    const ren = (async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }) as any;
    await replaceFile(tmp, file, { rename: ren, sleep: async () => {} });
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  test("other errors are not retried", async () => {
    let calls = 0;
    const ren = (async () => { calls++; throw Object.assign(new Error("gone"), { code: "ENOENT" }); }) as any;
    await expect(replaceFile("a.tmp", "a", { rename: ren, sleep: async () => {} })).rejects.toThrow("gone");
    expect(calls).toBe(1);
  });
});
