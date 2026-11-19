import "./_fetch";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetName, bare, cmpVersions, latestTag, runUpdate, UpdateChecker, upstreamUpdatesDisabled, REPO } from "../src/update";
import { explainBusyPort } from "../src/busy";
import { defaultLayout } from "../src/config";

const root = join(import.meta.dir, "..");
const win = process.platform === "win32";
const tmp = () => mkdtempSync(join(tmpdir(), "pd-upd-"));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

describe("versions", () => {
  test("cmpVersions", () => {
    expect(cmpVersions("0.1.2", "0.1.1")).toBe(1);
    expect(cmpVersions("v0.1.1", "0.1.1")).toBe(0);
    expect(cmpVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(cmpVersions("1.0.0-rc1", "1.0.0")).toBe(-1);
    expect(bare("v1.2.3")).toBe("1.2.3");
  });
});

describe("environment variables for fork control", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.PHONEDESK_ENABLE_UPDATE_CHECK = originalEnv.PHONEDESK_ENABLE_UPDATE_CHECK;
    process.env.PHONEDESK_REPO = originalEnv.PHONEDESK_REPO;
  });

  test("updates disabled by default in this fork (upstreamUpdatesDisabled returns true)", () => {
    delete process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
    expect(upstreamUpdatesDisabled()).toBe(true);
  });

  test("PHONEDESK_ENABLE_UPDATE_CHECK=1 enables update checks", async () => {
    process.env.PHONEDESK_ENABLE_UPDATE_CHECK = "1";
    expect(upstreamUpdatesDisabled()).toBe(false);
    let fetched = false;
    const checker = new UpdateChecker({ latest: async () => { fetched = true; return "v1.0.0"; } });
    const result = await checker.get(true);
    expect(fetched).toBe(true);
    expect(result.enabled).toBe(true);
  });

  test("REPO defaults to nguyentienanhvtth/phonedesk (this fork)", () => {
    expect(REPO).toBe("nguyentienanhvtth/phonedesk");
  });

  test("UpdateChecker returns disabled when updates are off (default)", async () => {
    delete process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
    const checker = new UpdateChecker();
    const result = await checker.get(true);
    expect(result.enabled).toBe(false);
    expect(result.error).toContain("update checks disabled in this fork");
  });
});

describe("latestTag: retries and the API fallback", () => {
  const nosleep = async () => {};
  const resp = (status: number, url = "https://github.com/x", body = "") => Object.defineProperty(new Response(body, { status }), "url", { value: url });
  test("the redirect fails with 5xx twice, then answers", async () => {
    let n = 0;
    const f = (async (u: any) => (String(u).includes("/releases/latest") && !String(u).includes("api.") && ++n > 2 ? resp(200, "https://github.com/o/r/releases/tag/v0.3.0") : resp(503))) as any;
    expect(await latestTag({ fetch: f, sleep: nosleep, retrySeconds: 0 })).toBe("v0.3.0");
  });
  test("the redirect never works: the API tag_name is used", async () => {
    const f = (async (u: any) => (String(u).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "v0.4.0" })) : resp(502))) as any;
    expect(await latestTag({ fetch: f, sleep: nosleep, retrySeconds: 0 })).toBe("v0.4.0");
  });
  test("both fail: says what failed and suggests --version", async () => {
    const logs: string[] = [];
    const f = (async () => resp(503)) as any;
    const e = await latestTag({ fetch: f, sleep: nosleep, retrySeconds: 0, log: (s) => logs.push(s) }).catch((x) => x);
    expect(String(e.message)).toContain("could not reach GitHub");
    expect(String(e.message)).toContain("503");
    expect(String(e.message)).toContain("--version");
    expect(logs.length).toBe(3); // 4 rounds, a message before each retry
  });
});

describe.skipIf(win)("phonedesk update against a fake release folder", () => {
  /** A release folder with the .gz + SHA256SUMS for THIS computer's asset; the "binary" is a script that prints its version. */
  function release(version: string, o: { badSum?: boolean; noGz?: boolean } = {}) {
    const dir = tmp();
    const body = `#!/bin/sh\necho "phonedesk ${version} (fake)"\n`;
    const asset = assetName();
    const lines = [`${o.badSum ? "0".repeat(64) : sha(body)}  ${asset}`];
    writeFileSync(join(dir, asset), body);
    if (!o.noGz) { const gz = gzipSync(body); writeFileSync(join(dir, `${asset}.gz`), gz); lines.push(`${sha(gz)}  ${asset}.gz`); }
    writeFileSync(join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
    return dir;
  }
  function installed(version = "0.1.1") {
    const dir = tmp();
    const f = join(dir, "phonedesk");
    writeFileSync(f, `#!/bin/sh\necho "phonedesk ${version} (old)"\n`);
    chmodSync(f, 0o755);
    return { dir, f };
  }
  const withBase = async <T>(base: string, fn: () => Promise<T>): Promise<T> => {
    const keep = process.env.PHONEDESK_RELEASE_BASE; process.env.PHONEDESK_RELEASE_BASE = base;
    try { return await fn(); } finally { if (keep === undefined) delete process.env.PHONEDESK_RELEASE_BASE; else process.env.PHONEDESK_RELEASE_BASE = keep; }
  };

  test("replaces its own program, writes .release, restarts the service and checks the agent; prints 'Updated a -> b'", async () => {
    const { dir, f } = installed();
    const lines: string[] = [];
    let restarted = 0;
    const r = await withBase(release("9.9.9"), () => runUpdate({
      version: "9.9.9", current: "0.1.1", target: f, out: (s) => lines.push(s),
      restartService: async () => { restarted++; return true; }, agentVersion: async () => "9.9.9", port: 7499, verifyMs: 2000,
    }));
    expect(r).toEqual({ status: "updated", current: "0.1.1", latest: "9.9.9" });
    expect(lines.join("\n")).toContain("Updated 0.1.1 -> 9.9.9");
    expect(lines.join("\n")).toContain(".gz");
    expect(restarted).toBe(1);
    expect(readFileSync(f, "utf8")).toContain("9.9.9");
    expect(statOk(f)).toBe(true);
    expect(existsSync(join(dir, ".phonedesk.update"))).toBe(false);
    const marker = readFileSync(join(dir, ".release"), "utf8");
    expect(marker).toMatch(/^raw=[0-9a-f]{64} installed=[0-9a-f]{64}/);
  });
  test("an older release without a .gz falls back to the plain binary", async () => {
    const { f } = installed();
    const lines: string[] = [];
    await withBase(release("9.9.8", { noGz: true }), () => runUpdate({ version: "9.9.8", current: "0.1.1", target: f, out: (s) => lines.push(s) }));
    expect(readFileSync(f, "utf8")).toContain("9.9.8");
    expect(lines.join("\n")).not.toContain(".gz");
  });
  test("a wrong checksum changes nothing", async () => {
    const { dir, f } = installed();
    const before = readFileSync(f, "utf8");
    const e = await withBase(release("9.9.9", { badSum: true }), () => runUpdate({ version: "9.9.9", current: "0.1.1", target: f, out: () => {} })).catch((x) => x);
    expect(String(e.message)).toContain("does not match");
    expect(readFileSync(f, "utf8")).toBe(before);
    expect(existsSync(join(dir, ".phonedesk.update"))).toBe(false);
  });
  test("the agent keeps reporting the old version after the restart: an error, not a success message", async () => {
    const { f } = installed();
    const e = await withBase(release("9.9.9"), () => runUpdate({ version: "9.9.9", current: "0.1.1", target: f, out: () => {}, restartService: async () => true, agentVersion: async () => "0.1.1", verifyMs: 600 })).catch((x) => x);
    expect(String(e.message)).toContain("reports 0.1.1");
  });
  test("no service: says to restart; --check only reports; same version: 'Already up to date'", async () => {
    const { f } = installed();
    const lines: string[] = [];
    await withBase(release("9.9.9"), async () => {
      expect((await runUpdate({ version: "9.9.9", check: true, current: "0.1.1", target: f, out: (s) => lines.push(s) })).status).toBe("available");
      expect(readFileSync(f, "utf8")).toContain("0.1.1 (old)"); // untouched
      expect((await runUpdate({ version: "0.1.1", current: "0.1.1", target: f, out: (s) => lines.push(s) })).status).toBe("up-to-date");
      await runUpdate({ version: "9.9.9", current: "0.1.1", target: f, out: (s) => lines.push(s) });
    });
    const t = lines.join("\n");
    expect(t).toContain("version 9.9.9 is available");
    expect(t).toContain("Already up to date (0.1.1)");
    expect(t).toContain("Restart PhoneDesk");
  });
  test("a copy that runs from source refuses", async () => {
    const e = await withBase(release("9.9.9"), () => runUpdate({ version: "9.9.9", current: "0.1.1", target: "/x/bun", out: () => {} })).catch((x) => x);
    expect(String(e.message)).toContain("runs from source");
  });
  test("the latest release is looked up when no --version is given", async () => {
    const { f } = installed();
    const gh = createServer((req, res) => {
      if (req.url === "/howznguyen/phonedesk/releases/latest") { res.writeHead(302, { location: "/howznguyen/phonedesk/releases/tag/v9.9.7" }).end(); return; }
      res.writeHead(200).end("page");
    });
    await new Promise<void>((ok) => gh.listen(0, "127.0.0.1", ok));
    const keep = process.env.PHONEDESK_GITHUB_URL; process.env.PHONEDESK_GITHUB_URL = `http://127.0.0.1:${(gh.address() as any).port}`;
    try {
      const r = await withBase(release("9.9.7"), () => runUpdate({ current: "0.1.1", target: f, out: () => {} }));
      expect(r).toMatchObject({ status: "updated", latest: "9.9.7" });
    } finally { gh.close(); if (keep === undefined) delete process.env.PHONEDESK_GITHUB_URL; else process.env.PHONEDESK_GITHUB_URL = keep; }
  });
});
const statOk = (f: string) => (require("node:fs").statSync(f).mode & 0o111) !== 0;

describe("UpdateChecker", () => {
  const savedEnv = process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
  beforeAll(() => { process.env.PHONEDESK_ENABLE_UPDATE_CHECK = "1"; });
  afterAll(() => {
    if (savedEnv === undefined) delete process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
    else process.env.PHONEDESK_ENABLE_UPDATE_CHECK = savedEnv;
  });

  test("one lookup a day (failures too), off means no lookup, refresh forces", async () => {
    let n = 0, t = 1_000_000, fail = false;
    const c = new UpdateChecker({ latest: async () => { n++; if (fail) throw new Error("offline"); return "v0.2.0"; }, now: () => t, current: () => "0.1.1" });
    expect(await c.get(false)).toEqual({ current: "0.1.1", latest: null, available: false, checkedAt: null, enabled: false });
    expect(n).toBe(0);
    expect(await c.get(true)).toEqual({ current: "0.1.1", latest: "0.2.0", available: true, checkedAt: 1_000_000, enabled: true });
    await c.get(true); expect(n).toBe(1);
    t += 23 * 3600_000; await c.get(true); expect(n).toBe(1);
    t += 2 * 3600_000; fail = true;
    const after = await c.get(true);
    expect(n).toBe(2);
    expect(after).toMatchObject({ latest: "0.2.0", available: true, error: "offline" }); // keeps the last known answer
    await c.get(true, true); expect(n).toBe(3);
    const same = new UpdateChecker({ latest: async () => "0.1.1", current: () => "0.1.1" });
    expect((await same.get(true)).available).toBe(false);
  });
});

describe("GET /api/update", () => {
  let app: Awaited<ReturnType<typeof import("../src/server").startServer>>;
  let base: string, looked = 0;
  const dir = tmp();
  const savedEnv = process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
  beforeAll(async () => {
    process.env.PHONEDESK_ENABLE_UPDATE_CHECK = "1";
    const { startServer } = await import("../src/server");
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    app = await startServer({
      port: 0, pin: "777777", hostName: async () => "h", hookSecret: "sec", webhookKeyFile: join(dir, "wk"), layoutHistoryDir: join(dir, "hist"),
      updateChecker: new UpdateChecker({ latest: async () => { looked++; return "v99.0.0"; } }),
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null },
      aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
    } as any);
    base = `http://localhost:${app.port}`;
  });
  afterAll(() => {
    app?.stop();
    if (savedEnv === undefined) delete process.env.PHONEDESK_ENABLE_UPDATE_CHECK;
    else process.env.PHONEDESK_ENABLE_UPDATE_CHECK = savedEnv;
  });
  test("shape; cached; switched off by theme.updateCheck=false (no lookup)", async () => {
    const j = (await (await fetch(base + "/api/update")).json()) as any;
    expect(j).toMatchObject({ latest: "99.0.0", available: true, enabled: true });
    expect(typeof j.current).toBe("string");
    expect(typeof j.checkedAt).toBe("number");
    await fetch(base + "/api/update"); expect(looked).toBe(1);
    const layout = { ...defaultLayout(), theme: { ...(defaultLayout().theme ?? {}), updateCheck: false } };
    expect((await fetch(`${base}/api/layout`, { method: "PUT", body: JSON.stringify(layout) })).status).toBe(200);
    expect(await (await fetch(base + "/api/update")).json()).toMatchObject({ latest: null, available: false, checkedAt: null, enabled: false });
    expect(looked).toBe(1);
  });
});

describe("a busy port and unknown commands", () => {
  const e = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH!, PHONEDESK_HOME: join(tmp(), "home"), HOME: tmp(), ...extra });
  const cli = (args: string[], env: Record<string, string>) => Bun.spawnSync([process.execPath, join(root, "src", "index.ts"), ...args], { env, stdout: "pipe", stderr: "pipe" }); // PHONEDESK_HOME is in env
  test("an unknown command exits 2 and never starts the agent", () => {
    const r = cli(["update-now"], e());
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain('unknown command "update-now"');
    expect(r.stderr.toString()).toContain("--help");
    expect(r.stdout.toString()).not.toContain("running on port");
  });
  test("the port is held by something else: friendly message, exit 1, no stack trace", () => {
    const holder = Bun.listen({ hostname: "0.0.0.0", port: 0, socket: { data() {} } });
    try {
      const r = cli(["--port", String(holder.port)], e());
      const err = r.stderr.toString();
      expect(r.exitCode).toBe(1);
      expect(err).toContain(`port ${holder.port} is already in use`);
      expect(err).toContain(`--port ${holder.port + 1}`);
      expect(err).not.toContain("at ");
      expect(err).not.toContain("EADDRINUSE");
    } finally { holder.stop(true); }
  });
  test("the port is held by PhoneDesk: says so, with the version and what to do", async () => {
    const { startServer } = await import("../src/server");
    const dir = tmp();
    const q = (id: string) => ({ id, name: id, windows: [], updatedAt: 1 });
    const app = await startServer({
      port: 0, pin: "777777", hostName: async () => "h", hookSecret: "sec", webhookKeyFile: join(dir, "wk"), layoutHistoryDir: join(dir, "hist"),
      deps: { runAction: async () => {}, startStats: () => () => {}, setVolume: async () => {}, readVolume: async () => null },
      aiSources: { claude: async () => q("claude"), codex: async () => q("codex"), antigravity: async () => q("antigravity"), sessions: async () => [] } as any,
    } as any);
    try {
      const msg = await explainBusyPort(app.port, { service: async () => true });
      expect(msg).toMatch(new RegExp(`^PhoneDesk \\S+ is already running on port ${app.port} \\(background service\\)`));
      expect(msg).toContain(`http://localhost:${app.port}/manage/`);
      expect(msg).toContain("phonedesk service restart");
      // async spawn: the agent lives in this process and must keep answering while the CLI asks it
      const p = Bun.spawn([process.execPath, join(root, "src", "index.ts"), "--port", String(app.port)], { env: e(), stdout: "pipe", stderr: "pipe" }); // PHONEDESK_HOME is in e()
      const err = await new Response(p.stderr).text();
      expect(await p.exited).toBe(1);
      expect(err).toContain("is already running on port");
      expect(err).not.toContain("at ");
    } finally { app.stop(); }
  });
});
