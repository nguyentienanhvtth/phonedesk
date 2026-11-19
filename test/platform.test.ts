import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Platform-neutral logic and the win32 builders/adapters with fakes: nothing here needs Windows (or touches the real OS).
const sandbox = mkdtempSync(join(tmpdir(), "pd-plat-"));
const { createPlatform, platform } = await import("../src/platform");
const K = await import("../src/platform/win32/keys");
const H = await import("../src/platform/win32/helper");
const W = await import("../src/platform/win32");
const WS = await import("../src/platform/win32/service");
const WD = await import("../src/platform/win32/doctor");
const S = await import("../src/service");
const D = await import("../src/doctor");
const I = await import("../src/i18n");
const HI = await import("../src/hooks-install");

afterAll(() => I.setLanguage("en"));

describe("the platform boundary", () => {
  test("only src/platform reads process.platform", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const f = join(dir, n);
        if (statSync(f).isDirectory()) { if (!/src[\\/]platform$/.test(f) && !f.includes("assets")) walk(f); continue; }
        if (!/\.ts$/.test(n) || n === "assets.gen.ts") continue;
        if (/process\.platform/.test(readFileSync(f, "utf8"))) bad.push(f);
      }
    };
    walk(join(import.meta.dir, "..", "src"));
    expect(bad).toEqual([]);
  });

  test("one implementation per OS, with the same interface", () => {
    const ids = { darwin: "macOS", win32: "Windows", linux: "Linux" } as const;
    for (const [id, label] of Object.entries(ids)) {
      const p = createPlatform(id as NodeJS.Platform);
      expect(p.id).toBe(id);
      expect(p.label).toBe(label);
      for (const fn of ["runAction", "readVolume", "setVolume", "readMedia", "fetchArtwork", "resumeMedia", "openMediaApp", "netCounters", "memUsed", "topProcesses", "lanName", "soundCommand", "soundDuration", "claudeCredentials", "idleSeconds", "openExternal", "hookPath", "dispose"]) {
        expect(typeof (p as any)[fn]).toBe("function");
      }
    }
    expect(createPlatform("freebsd").label).toBe("Linux"); // anything else is the best-effort Unix one
    expect(platform.id).toBe(process.platform);
  });

  test("key names per OS (layouts keep cmd / option)", () => {
    expect(createPlatform("darwin").keyNames).toEqual({ cmd: "Cmd", alt: "Option", ctrl: "Control" });
    expect(createPlatform("win32").keyNames).toEqual({ cmd: "Ctrl", alt: "Alt", ctrl: "Ctrl" });
  });

  test("hook command paths: forward slashes on Windows only", () => {
    expect(createPlatform("win32").hookPath("C:\\Users\\Me\\AppData\\Local\\PhoneDesk\\bin\\phonedesk.exe")).toBe("C:/Users/Me/AppData/Local/PhoneDesk/bin/phonedesk.exe");
    expect(createPlatform("darwin").hookPath("/a/b")).toBe("/a/b");
  });
});

const events = (es: Array<{ vk: number; up: boolean; unicode: boolean; scan: number }>) => es.map((e) => `${e.unicode ? "U+" + e.scan.toString(16) : "0x" + e.vk.toString(16)}${e.up ? "^" : "v"}`);
const noScan: import("../src/platform/win32/keys").VkScan = () => null;

describe("win32 key events", () => {
  test("cmd maps to ctrl and option to alt; modifiers are released in reverse", () => {
    expect(events(K.hotkeyEvents("cmd+c", noScan))).toEqual(["0x11v", "0x43v", "0x43^", "0x11^"]);
    expect(events(K.hotkeyEvents("ctrl+alt+t", noScan))).toEqual(["0x11v", "0x12v", "0x54v", "0x54^", "0x12^", "0x11^"]);
    expect(events(K.hotkeyEvents("option+shift+f5", noScan))).toEqual(["0x12v", "0x10v", "0x74v", "0x74^", "0x10^", "0x12^"]);
    expect(events(K.hotkeyEvents("cmd+ctrl+a", noScan))).toEqual(["0x11v", "0x41v", "0x41^", "0x11^"]); // one Ctrl
  });
  test("named keys, digits, and other characters through the layout", () => {
    expect(events(K.hotkeyEvents("return", noScan))).toEqual(["0xdv", "0xd^"]);
    expect(events(K.hotkeyEvents("cmd+4", noScan))).toEqual(["0x11v", "0x34v", "0x34^", "0x11^"]);
    expect(events(K.hotkeyEvents("up", noScan))).toEqual(["0x26v", "0x26^"]);
    expect(events(K.hotkeyEvents("cmd+/", (ch) => (ch === "/" ? { vk: 0xbf, shift: false, ctrl: false, alt: false } : null)))).toEqual(["0x11v", "0xbfv", "0xbf^", "0x11^"]);
    expect(events(K.hotkeyEvents("cmd+?", () => ({ vk: 0xbf, shift: true, ctrl: false, alt: false })))).toEqual(["0x11v", "0x10v", "0xbfv", "0xbf^", "0x10^", "0x11^"]);
    expect(() => K.hotkeyEvents("cmd+é", noScan)).toThrow("not on the current keyboard layout");
    expect(() => K.hotkeyEvents("", noScan)).toThrow("empty");
  });
  test("VkKeyScanW decoding", () => {
    expect(K.decodeVkScan(-1)).toBeNull();
    expect(K.decodeVkScan(0x01bf)).toEqual({ vk: 0xbf, shift: true, ctrl: false, alt: false });
    expect(K.decodeVkScan(0x0641)).toEqual({ vk: 0x41, shift: false, ctrl: true, alt: true });
  });
  test("typing is Unicode input: any layout, surrogate pairs, Enter and Tab", () => {
    expect(events(K.typeEvents("hi"))).toEqual(["U+68v", "U+68^", "U+69v", "U+69^"]);
    expect(events(K.typeEvents("a\r\nb\tc")).filter((e) => !e.startsWith("U+"))).toEqual(["0xdv", "0xd^", "0x9v", "0x9^"]);
    expect(K.typeEvents("😀").length).toBe(4); // two UTF-16 units, down and up each
    expect(events(K.typeEvents("é"))).toEqual(["U+e9v", "U+e9^"]);
  });
  test("media and volume keys", () => {
    expect(events(K.mediaEvents("playpause"))).toEqual(["0xb3v", "0xb3^"]);
    expect(events(K.mediaEvents("next"))).toEqual(["0xb0v", "0xb0^"]);
    expect(events(K.mediaEvents("previous"))).toEqual(["0xb1v", "0xb1^"]);
    expect(K.volumeKeyEvents("up").length).toBe(6); // 3 steps of 2 % = 6 %, like macOS
    expect(events(K.volumeKeyEvents("mute"))).toEqual(["0xadv", "0xad^"]);
  });
  test("INPUT array layout (40 bytes each, KEYBDINPUT at offset 8)", () => {
    const buf = K.packInputs([...K.hotkeyEvents("left", noScan), ...K.typeEvents("A")]);
    expect(buf.length).toBe(4 * K.INPUT_SIZE);
    expect(buf.readUInt32LE(0)).toBe(1); // INPUT_KEYBOARD
    expect(buf.readUInt16LE(8)).toBe(0x25); // VK_LEFT
    expect(buf.readUInt32LE(12)).toBe(0x1); // extended key, down
    expect(buf.readUInt32LE(40 + 12)).toBe(0x3); // extended key, up
    expect(buf.readUInt16LE(80 + 8)).toBe(0); // unicode: no vk
    expect(buf.readUInt16LE(80 + 10)).toBe(0x41); // the character
    expect(buf.readUInt32LE(80 + 12)).toBe(0x4); // KEYEVENTF_UNICODE
    expect(buf.readUInt32LE(120 + 12)).toBe(0x6); // unicode + keyup
  });
});

describe("win32 platform adapter (fake helper, fake input, fake credentials)", () => {
  const fakeHelper = (answers: Record<string, any>) => {
    const calls: Array<{ cmd: string; args: any }> = [];
    return { calls, helper: { call: async (cmd: string, args: any = {}) => { calls.push({ cmd, args }); const a = answers[cmd]; if (a instanceof Error) throw a; return typeof a === "function" ? a(args) : a ?? null; }, dispose: () => { calls.push({ cmd: "dispose", args: {} }); } } as any };
  };
  const make = (answers: Record<string, any> = {}, extra: any = {}) => {
    const sent: any[][] = [];
    const ran: string[][] = [];
    const h = fakeHelper(answers);
    const p = W.createWin32({ helper: h.helper, send: (e) => { sent.push(e); }, scan: noScan, run: async (argv) => { ran.push(argv); return ""; }, ...extra });
    return { p, sent, ran, ...h };
  };

  test("hotkey / type / media / volume actions send input; nothing is run as a command", async () => {
    const { p, sent, ran } = make();
    await p.runAction({ type: "hotkey", keys: "cmd+v" });
    await p.runAction({ type: "type", text: "hello" });
    await p.runAction({ type: "media", command: "next" });
    await p.runAction({ type: "volume", command: "down" });
    expect(sent.length).toBe(8); // hotkey, 5 characters one at a time, media, volume
    expect(events(sent[0]!)).toEqual(["0x11v", "0x56v", "0x56^", "0x11^"]);
    expect(sent.slice(1, 6).every((e) => e.length === 2)).toBe(true);
    expect(sent.slice(1, 6).flat().length).toBe(10);
    expect(events(sent[6]!)).toEqual(["0xb0v", "0xb0^"]);
    expect(sent[7]!.length).toBe(6);
    expect(ran).toEqual([]);
    await expect(p.runAction({ type: "page", page: "x" } as any)).rejects.toThrow("not run as OS commands");
  });

  test("typing goes out one character at a time (a surrogate pair together), paced", async () => {
    const { p, sent } = make({}, { typeDelayMs: 0 });
    await p.runAction({ type: "type", text: "a\u{1F600}b\n" });
    expect(sent.map((e) => e.length)).toEqual([2, 4, 2, 2]);
    expect(sent[1]!.map((e: any) => e.scan)).toEqual([0xd83d, 0xd83d, 0xde00, 0xde00]);
  });

  test("open with a plain name: the app list by display name, then well-known programs, then Start-Process", async () => {
    const a = make({ "apps.list": [{ name: "Windows Terminal", id: "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App" }, { name: "Notes", id: "x!App" }], "apps.open": true });
    await a.p.runAction({ type: "open", target: "terminal" });
    expect(a.calls.map((c) => c.cmd)).toContain("apps.open");
    expect(a.ran).toEqual([]);
    const b = make({ "apps.list": [] });
    await b.p.runAction({ type: "open", target: "Terminal" });
    expect(b.ran[0]![b.ran[0]!.length - 1]).toBe("Start-Process -FilePath 'wt.exe'");
    const c = make({ "apps.list": [] });
    await c.p.runAction({ type: "open", target: "SomeTool" });
    expect(c.ran[0]![c.ran[0]!.length - 1]).toBe("Start-Process -FilePath 'SomeTool'");
  });

  test("open hands the focus to the new window (keys typed next must reach it); URLs are left alone", async () => {
    const a = make({ "window.list": [{ hwnd: 11, pid: 1, title: "a" }], "window.focusnew": { hwnd: 12, title: "b", focused: true } });
    await a.p.runAction({ type: "open", target: "notepad.exe" });
    const seq = a.calls.map((c) => c.cmd);
    expect(seq).toEqual(["window.list", "window.focusnew"]);
    expect(a.calls[1]!.args).toMatchObject({ before: [11], hint: "notepad" });
    const b = make({ "window.focusnew": { hwnd: 0 } });
    await b.p.runAction({ type: "open", target: "https://example.com" });
    expect(b.calls).toEqual([]);
    const c = make({ "window.list": new Error("helper down") });
    await c.p.runAction({ type: "open", target: "notepad.exe" }); // still opens
    expect(c.ran.length).toBe(1);
  });

  test("shell and open run through cmd / PowerShell (quoted), bundle: opens a catalog app", async () => {
    const { p, ran, calls } = make({ "apps.list": [{ name: "Calculator", id: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" }], "apps.open": true });
    await p.runAction({ type: "shell", command: "echo hi" });
    expect(ran[0]).toEqual(["cmd.exe", "/d", "/s", "/c", '"echo hi"']);
    await p.runAction({ type: "open", target: "https://example.com/it's" });
    expect(ran[1]![ran[1]!.length - 1]).toBe("Start-Process -FilePath 'https://example.com/it''s'");
    const apps = await p.apps!.list();
    expect(apps).toEqual([{ name: "Calculator", bundleId: W.winAppId("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), path: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", category: null }]);
    expect(apps[0]!.bundleId).toMatch(/^win-[0-9a-f]{16}$/);
    expect(/^[A-Za-z0-9][A-Za-z0-9.\-]{0,127}$/.test(apps[0]!.bundleId)).toBe(true);
    await p.runAction({ type: "open", target: `bundle:${apps[0]!.bundleId}` });
    expect(calls.find((c) => c.cmd === "apps.open")!.args).toEqual({ appId: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" });
    await expect(p.runAction({ type: "open", target: "bundle:../../x" })).rejects.toThrow("invalid app id");
    await expect(p.runAction({ type: "open", target: "  " })).rejects.toThrow("empty");
  });

  test("volume: read maps the helper's answer, set validates; mute goes through the helper", async () => {
    const { p, calls } = make({ "volume.get": { level: 57.6, muted: true }, "volume.set": true });
    expect(await p.readVolume()).toEqual({ level: 58, muted: true });
    await p.setVolume({ level: 30 });
    await p.setVolume({ muted: false });
    expect(calls.filter((c) => c.cmd === "volume.set").map((c) => c.args)).toEqual([{ level: 30 }, { muted: false }]);
    await expect(p.setVolume({ level: 101 })).rejects.toThrow("0-100");
    await expect(p.setVolume({ level: 1.5 })).rejects.toThrow("0-100");
    expect(await make({ "volume.get": new Error("x") }).p.readVolume()).toBeNull();
    expect(await make({ "volume.get": null }).p.readVolume()).toBeNull(); // no audio device
    await expect(make({ "volume.set": new Error("no audio device") }).p.setVolume({ level: 10 })).rejects.toThrow("no audio device");
  });

  test("microphone: read maps the helper's answer, set validates; mute toggles", async () => {
    const { p, calls } = make({ "mic.get": { level: 80, muted: false }, "mic.set": true });
    expect(await p.readMic!()).toEqual({ level: 80, muted: false });
    await p.setMic!({ level: 50 });
    await p.setMic!({ muted: true });
    expect(calls.filter((c) => c.cmd === "mic.set").map((c) => c.args)).toEqual([{ level: 50 }, { muted: true }]);
    await expect(p.setMic!({ level: 101 })).rejects.toThrow("0-100");
    await expect(p.setMic!({ level: 1.5 })).rejects.toThrow("0-100");
    expect(await make({ "mic.get": new Error("x") }).p.readMic!()).toBeNull();
    expect(await make({ "mic.get": null }).p.readMic!()).toBeNull();
    await expect(make({ "mic.set": new Error("no microphone") }).p.setMic!({ level: 10 })).rejects.toThrow("no microphone");
  });

  test("media: read maps to RawMedia with a readable app name; null and errors are 'nothing playing'", async () => {
    const m = { app: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", title: "T", artist: "A", album: "Al", playing: true, position: 12.5, duration: 200 };
    expect(await make({ "media.read": m }).p.readMedia()).toEqual({ app: "Spotify", title: "T", artist: "A", album: "Al", playing: true, position: 12.5, duration: 200 });
    expect(await make({ "media.read": null }).p.readMedia()).toBeNull();
    expect(await make({ "media.read": new Error("no session") }).p.readMedia()).toBeNull();
    expect(await make({ "media.artwork": "data:image/jpeg;base64,AAAA" }).p.fetchArtwork({} as any)).toBe("data:image/jpeg;base64,AAAA");
    expect(await make({ "media.artwork": new Error("x") }).p.fetchArtwork({} as any)).toBeUndefined();
  });

  test("resume plays the current session, else opens an app (Spotify unless the last track was Music)", async () => {
    const a = make({ "media.control": true });
    await a.p.resumeMedia();
    expect(a.ran).toEqual([]);
    const b = make({ "media.control": false });
    await b.p.resumeMedia();
    expect(b.ran[0]![b.ran[0]!.length - 1]).toBe("Start-Process -FilePath 'spotify:'");
    const c = make({ "media.control": new Error("none") });
    await c.p.resumeMedia("Music");
    expect(c.ran[0]![c.ran[0]!.length - 1]).toBe("Start-Process -FilePath 'mswindowsmusic:'");
  });

  test("net counters and processes", async () => {
    const { p } = make({
      "net.counters": { Ethernet: { rx: 10, tx: 20 }, Bad: { rx: "x", tx: 1 } },
      "proc.list": [{ pid: 1, name: "a", cpu: 5, mem: 100 }, { pid: 2, name: "b", cpu: 50, mem: 10 }, { pid: 3, name: "c", cpu: 1, mem: 900 }],
    });
    expect(await p.netCounters()).toEqual({ Ethernet: { rx: 10, tx: 20 } });
    expect((await p.topProcesses("cpu", 2)).map((x) => x.pid)).toEqual([2, 1]);
    expect((await p.topProcesses("mem", 1)).map((x) => x.pid)).toEqual([3]);
    expect(await make({ "net.counters": new Error("x") }).p.netCounters()).toBeUndefined();
  });

  test("icons and image resize go through the helper as base64", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { p, calls } = make({ "apps.list": [{ name: "X", id: "x!app" }], "apps.icon": png.toString("base64"), "image.resize": png.toString("base64") });
    const [app] = await p.apps!.list();
    expect([...(await p.apps!.icon(app!.bundleId))!]).toEqual([...png]);
    expect(calls.find((c) => c.cmd === "apps.icon")!.args).toEqual({ appId: "x!app", px: 128 });
    expect(await p.apps!.icon("win-0000000000000000")).toBeNull();
    expect([...(await p.apps!.resizeImage(new Uint8Array([1, 2]), "png", 128))]).toEqual([...png]);
    expect(calls.find((c) => c.cmd === "image.resize")!.args).toEqual({ data: "AQI=", max: 128 });
  });

  test("secrets use the Credential Manager target service/account; idle and claude credentials", async () => {
    const store = new Map<string, string>();
    const { p } = make({}, { cred: { read: (t: string) => store.get(t), write: (t: string, _u: string, v: string) => { store.set(t, v); return true; }, remove: (t: string) => { store.delete(t); } }, idle: () => 12.5 });
    expect(await p.secrets!.set("PhoneDesk-HASS", "token", "abc")).toBe(true);
    expect([...store.keys()]).toEqual(["PhoneDesk-HASS/token"]);
    expect(await p.secrets!.get("PhoneDesk-HASS", "token")).toBe("abc");
    await p.secrets!.remove("PhoneDesk-HASS", "token");
    expect(await p.secrets!.get("PhoneDesk-HASS", "token")).toBeUndefined();
    expect(await p.idleSeconds()).toBe(12.5);
    expect(await p.claudeCredentials()).toBeNull(); // Windows keeps them in ~/.claude/.credentials.json
  });

  test("sound argv: one PowerShell MediaPlayer process, volume 0-1, quoted file URI", () => {
    const argv = W.soundArgv("C:\\Users\\Me\\it's\\a b.mp3", 50);
    expect(argv.slice(0, 2)).toEqual(["powershell.exe", "-NoProfile"]);
    const script = argv[argv.length - 1]!;
    expect(script).toContain("file:///C:/Users/Me/it''s/a%20b.mp3");
    expect(W.fileUri("C:\\x\\a#b?.mp3")).toBe("file:///C:/x/a%23b%3F.mp3");
    expect(script).toContain("$p.Volume = 0.50");
    expect(W.soundArgv("C:\\a.mp3", 250)[W.soundArgv("C:\\a.mp3", 250).length - 1]).toContain("$p.Volume = 1.00");
  });

  test("app names", () => {
    expect(W.friendlyAppName("Spotify.exe")).toBe("Spotify");
    expect(W.friendlyAppName("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic")).toBe("Media Player");
    expect(W.friendlyAppName("chrome.exe")).toBe("Chrome");
    expect(W.friendlyAppName("")).toBe("Media");
  });

  test("dispose stops the helper", () => {
    const { p, calls } = make();
    p.dispose();
    expect(calls.map((c) => c.cmd)).toEqual(["dispose"]);
  });
});

describe("WinHelper (JSON lines over a fake process)", () => {
  function fake(onLine: (line: any, reply: (o: any) => void) => void) {
    let push!: (s: string) => void;
    let end!: () => void;
    const lines: any[] = [];
    let killed = 0;
    let exit!: (n: number) => void;
    const stdout = new ReadableStream<Uint8Array>({ start(c) { push = (s) => c.enqueue(new TextEncoder().encode(s)); end = () => c.close(); } });
    const exited = new Promise<number>((r) => { exit = r; });
    const reply = (o: any) => push(JSON.stringify(o) + "\n");
    const spawn: import("../src/platform/win32/helper").HelperSpawn = (argv) => {
      lines.push({ argv });
      queueMicrotask(() => reply({ id: 0, ok: true, result: "ready" }));
      return { write: (l) => { const m = JSON.parse(l); lines.push(m); onLine(m, reply); }, stdout, kill: () => { killed++; end(); exit(1); }, exited };
    };
    return { spawn, lines, killed: () => killed };
  }
  const dir = mkdtempSync(join(sandbox, "helper-"));

  test("round trip, errors, ids, ascii-only requests, and the script is written with a BOM next to the hash", async () => {
    const f = fake((m, reply) => { if (m.cmd === "boom") reply({ id: m.id, ok: false, error: "it broke\r\n" }); else reply({ id: m.id, ok: true, result: { echo: m.x } }); });
    const h = new H.WinHelper({ spawn: f.spawn, script: "# test", dir });
    expect(await h.call("echo", { x: "héllo 😀" })).toEqual({ echo: "héllo 😀" });
    await expect(h.call("boom")).rejects.toThrow("it broke");
    expect(f.lines[0].argv.slice(0, 7)).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File"]);
    const file = f.lines[0].argv[7] as string;
    expect(file).toBe(H.scriptPath("# test", dir));
    expect(readFileSync(file, "utf8")).toBe("\ufeff# test");
    expect(f.lines.slice(1).map((l) => l.id)).toEqual([1, 2]);
    expect(H.asciiJson({ a: "é😀" })).toBe('{"a":"\\u00e9\\ud83d\\ude00"}');
    h.dispose();
    expect(f.killed()).toBe(1);
  });

  test("a request argument can never replace the request id", async () => {
    const f = fake((m, reply) => reply({ id: m.id, ok: true, result: m.id }));
    const h = new H.WinHelper({ spawn: f.spawn, script: "# t0", dir });
    expect(await h.call("x", { id: 999, cmd: "evil" })).toBe(1);
    expect(f.lines[1]).toMatchObject({ id: 1, cmd: "x" });
    h.dispose();
  });

  test("a call that never answers times out and the helper is replaced on the next call", async () => {
    let n = 0;
    const f = fake((m, reply) => { if (m.cmd === "hang") return; reply({ id: m.id, ok: true, result: ++n }); });
    const h = new H.WinHelper({ spawn: f.spawn, script: "# t2", dir });
    await expect(h.call("hang", {}, 80)).rejects.toThrow("did not answer hang");
    expect(f.killed()).toBe(1);
    h.dispose();
  });

  test("a helper that never says ready fails the call", async () => {
    const h = new H.WinHelper({ spawn: () => ({ write() {}, stdout: new ReadableStream(), kill() {}, exited: new Promise<number>(() => {}) }), script: "# t3", dir, startTimeoutMs: 60 });
    await expect(h.call("ping")).rejects.toThrow("did not start");
  });

  test("the PowerShell helper script is plain ASCII and answers every command the adapter uses", () => {
    const ps = readFileSync(join(import.meta.dir, "..", "src", "platform", "win32", "helper.ps1"), "utf8");
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(ps)).toBe(true); // a BOM-less ANSI misread cannot garble it
    const src = readFileSync(join(import.meta.dir, "..", "src", "platform", "win32.ts"), "utf8");
    for (const cmd of [...src.matchAll(/call(?:<[^>]*>)?\("([a-z.]+)"/g)].map((m) => m[1]!)) expect(ps).toContain(`'${cmd}'`);
  });
});

describe("win32 service (Task Scheduler)", () => {
  const prog = ["C:\\Users\\Me\\AppData\\Local\\PhoneDesk\\bin\\phonedesk.exe"];

  test("the launcher is a hidden cmd with logs and the service marker; quoting survives spaces and quotes", () => {
    const vbs = WS.buildLauncher({ program: ["C:\\Program Files\\PhoneDesk\\phonedesk.exe"], env: { PHONEDESK_HOME: 'D:\\data "x"' }, logDir: "C:\\Users\\Me\\.phonedesk\\logs", port: 7500 });
    expect(vbs).toContain('sh.Environment("Process")("PHONEDESK_SERVICE") = "1"');
    expect(vbs).toContain('sh.Environment("Process")("PHONEDESK_HOME") = "D:\\data ""x"""');
    expect(vbs).toContain(', 0, False'); // window style 0 = hidden, do not wait
    expect(vbs).toContain('cmd /s /c ""');
    expect(vbs).toContain('""C:\\Program Files\\PhoneDesk\\phonedesk.exe"" --port 7500');
    expect(vbs).toContain('agent.out.log');
    expect(WS.buildLauncher({ program: prog, logDir: "L" })).not.toContain("--port");
    expect(vbs.endsWith("\r\n")).toBe(true);
  });

  test("the task: at logon, current user, least privilege, no battery limit, restarts, no time limit", () => {
    const xml = WS.buildTaskXml({ user: "PC\\Me", launcher: "C:\\L\\launch.vbs" });
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<UserId>PC\\Me</UserId>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Command>wscript.exe</Command>");
    expect(xml).toContain('<Arguments>//B //Nologo &quot;C:\\L\\launch.vbs&quot;</Arguments>');
    expect(xml).not.toContain("HighestAvailable");
  });

  test("schtasks / reg argument builders", () => {
    expect(WS.schtasksCreate("t.xml")).toEqual(["schtasks", "/Create", "/TN", "PhoneDesk", "/XML", "t.xml", "/F"]);
    expect(WS.schtasksRun()).toEqual(["schtasks", "/Run", "/TN", "PhoneDesk"]);
    expect(WS.schtasksDelete()).toEqual(["schtasks", "/Delete", "/TN", "PhoneDesk", "/F"]);
    expect(WS.regAddRun("C:\\L\\launch.vbs")).toEqual(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PhoneDesk", "/t", "REG_SZ", "/d", 'wscript.exe //B //Nologo "C:\\L\\launch.vbs"', "/f"]);
    expect(WS.parseQuery("TaskName: \\PhoneDesk\r\nStatus:                                Running\r\n")).toEqual({ running: true, state: "Running" });
    expect(WS.parseQuery("Status:   Ready")).toEqual({ running: false, state: "Ready" });
    const stop = WS.stopAgentArgv("C:\\a\\it's.exe", 42);
    expect(stop[stop.length - 1]).toContain("$_.Path -eq 'C:\\a\\it''s.exe' -and $_.Id -ne 42");
  });

  function ctx(over: Partial<import("../src/platform/win32/service").WinServiceCtx> & { fail?: (argv: string[]) => boolean } = {}) {
    const calls: string[][] = [];
    const log: string[] = [];
    const dir = mkdtempSync(join(sandbox, "svc-"));
    const c = {
      dir, logDir: join(dir, "logs"), program: prog, selfPid: 7, log: (l: string) => log.push(l),
      run: async (argv: string[]) => { calls.push(argv); if (over.fail?.(argv)) return { code: 1, out: "denied" }; if (argv[0] === "whoami") return { code: 0, out: "PC\\Me\r\n" }; if (argv[0] === "schtasks" && argv[1] === "/Query") return { code: 0, out: "Status: Running" }; return { code: 0, out: "" }; },
      ...over,
    } as any;
    return { c, calls, log, dir };
  }

  test("install writes the launcher, creates the task from XML, starts it; falls back to the Run key", async () => {
    const a = ctx();
    const r = await WS.winInstall(a.c);
    expect(r.method).toBe("task");
    expect(existsSync(r.launcher)).toBe(true);
    expect(readFileSync(r.launcher, "utf8")).toContain("PHONEDESK_SERVICE");
    expect(a.calls.map((c) => c.slice(0, 2).join(" "))).toEqual(expect.arrayContaining(["schtasks /End", "schtasks /Create", "schtasks /Run"]));
    const create = a.calls.find((c) => c[1] === "/Create")!;
    expect(create).toEqual(["schtasks", "/Create", "/TN", "PhoneDesk", "/XML", join(a.dir, "task.xml"), "/F"]);
    expect(existsSync(join(a.dir, "task.xml"))).toBe(false); // temp file removed
    const b = ctx({ fail: (argv) => argv[1] === "/Create" });
    expect((await WS.winInstall(b.c)).method).toBe("run-key");
    expect(b.calls.some((c) => c[0] === "reg" && c[1] === "add")).toBe(true);
    const c2 = ctx({ fail: (argv) => argv[1] === "/Create" || argv[0] === "reg" });
    await expect(WS.winInstall(c2.c)).rejects.toThrow("could not create the scheduled task");
  });

  test("never kills every bun: from source only the task is ended", async () => {
    const a = ctx({ program: ["C:\\Users\\Me\\.bun\\bin\\bun.exe", "C:\\src\\index.ts"] });
    await WS.winInstall(a.c);
    expect(a.calls.some((c) => c[0] === "powershell.exe")).toBe(false);
    const b = ctx();
    await WS.winInstall(b.c);
    expect(b.calls.some((c) => c[0] === "powershell.exe" && c[c.length - 1]!.includes("Stop-Process"))).toBe(true);
  });

  test("status, restart, uninstall", async () => {
    const a = ctx();
    expect(await WS.winStatus(a.c)).toMatchObject({ installed: false, running: false });
    await expect(WS.winRestart(a.c)).rejects.toThrow("not installed");
    await WS.winInstall(a.c);
    expect(await WS.winStatus(a.c)).toMatchObject({ installed: true, running: true, method: "scheduled task", program: prog[0] });
    await WS.winRestart(a.c);
    expect(a.log.at(-1)).toBe("Service restarted.");
    expect(await WS.winUninstall(a.c)).toEqual({ removed: true });
    expect(existsSync(WS.launcherPath(a.dir))).toBe(false);
    expect(a.calls.some((c) => c[1] === "/Delete")).toBe(true);
    expect(await WS.winUninstall(a.c)).toEqual({ removed: true }); // the fake task still "exists"
  });

  test("service.ts dispatches to it for win32 deps (and refuses other OSes)", async () => {
    const dir = mkdtempSync(join(sandbox, "svc2-"));
    const calls: string[][] = [];
    const deps: import("../src/service").ServiceDeps = {
      launchctl: async () => { throw new Error("launchctl must not run on Windows"); }, uid: 0, platform: "win32", program: prog, log: () => {}, winDir: dir,
      winRun: async (argv) => { calls.push(argv); return { code: 0, out: argv[0] === "whoami" ? "PC\\Me" : "Status: Ready" }; },
    };
    const r = await S.serviceInstall(deps, { port: 7421 });
    expect(r.plist).toBe(join(dir, "launch.vbs"));
    expect(readFileSync(r.plist, "utf8")).toContain("--port 7421");
    const st = await S.serviceStatus(deps);
    expect(st).toMatchObject({ installed: true, running: false, plist: r.plist });
    expect(S.formatStatus(st)).toContain("Launcher: ");
    await S.serviceUninstall(deps);
    await expect(S.serviceInstall({ ...deps, platform: "linux" })).rejects.toThrow("only available on macOS and Windows");
  });
});

describe("win32 doctor", () => {
  const EXE = "C:\\Users\\Me\\AppData\\Local\\PhoneDesk\\bin\\phonedesk.exe";
  function probes(out: Record<string, { code: number; out: string }> = {}, over: any = {}) {
    const calls: string[][] = [];
    const p: import("../src/doctor").Probes = {
      platform: "win32", exe: EXE, program: [EXE], version: "phonedesk 1.2.3", asService: true,
      run: async (argv) => { calls.push(argv); const key = argv[0] === "powershell.exe" ? (argv[argv.length - 1]!.match(/Get-AuthenticodeSignature|Zone\.Identifier|Get-NetFirewallProfile/)?.[0] ?? "ps") : `${argv[0]} ${argv[1]}`; return out[key] ?? { code: 0, out: "" }; },
      axTrusted: () => null, automation: () => "unknown", requestAccessibility: () => null, requestAutomation: () => "unknown", installed: () => false,
      which: () => null, hookFiles: () => ({}), desktop: () => ({ station: "WinSta0", idle: 3.2 }), helperPing: async () => true, fileExists: () => true, claudeCredentialsFile: () => "C:\\Users\\Me\\.claude\\.credentials.json",
      ...over,
    };
    return { p, calls };
  }
  const INST = { port: 7420, home: join(require("node:os").homedir(), ".phonedesk") };
  const run = async (o: any = {}, over: any = {}, ctx: any = {}) => { const k = probes(o, over); const r = await D.runDoctor(k.p, { instance: INST, ...ctx }); return { r, ...k, by: (id: string) => r.items.find((i) => i.id === id)! }; };

  test("the Windows item ids", async () => {
    const { r } = await run();
    expect(r.items.map((i) => i.id)).toEqual(["agent", "service", "signature", "smartscreen", "desktop-session", "helper", "keychain-claude", "keychain-hass", "network", "firewall", "hooks-claude", "hooks-codex"]);
    expect(r.platform).toBe("win32");
    for (const i of r.items) { expect(["ok", "missing", "denied", "unknown", "n/a"]).toContain(i.status); expect(i.detail.length).toBeGreaterThan(0); }
  });
  test("signature and SmartScreen (mark of the web)", async () => {
    expect((await run({ "Get-AuthenticodeSignature": { code: 0, out: "status=NotSigned\nsubject=" } })).by("signature").detail).toContain("not signed");
    expect((await run({ "Get-AuthenticodeSignature": { code: 0, out: "status=Valid\nsubject=CN=Someone" } })).by("signature").detail).toContain("CN=Someone");
    const bad = (await run({ "Zone.Identifier": { code: 0, out: "motw=yes" } })).by("smartscreen");
    expect(bad).toMatchObject({ status: "missing", fix: { text: expect.stringContaining("Unblock-File") } });
    expect((await run({ "Zone.Identifier": { code: 0, out: "motw=no" } })).by("smartscreen").status).toBe("ok");
  });
  test("desktop session and PowerShell helper", async () => {
    expect((await run()).by("desktop-session")).toMatchObject({ status: "ok" });
    expect((await run({}, { desktop: () => ({ station: null, idle: null }) })).by("desktop-session").status).toBe("unknown");
    const ssh = (await run({}, { desktop: () => ({ station: "Service-0x0-3e7$", idle: 99999 }) })).by("desktop-session");
    expect(ssh).toMatchObject({ status: "missing", fix: { text: expect.stringContaining("service install") } });
    expect(ssh.detail).toContain("Service-0x0-3e7$");
    expect((await run({}, { helperPing: async () => false })).by("helper")).toMatchObject({ status: "missing" });
  });
  test("firewall: off / allowed / blocked / no rule (with the netsh hint)", async () => {
    const fw = (out: string) => ({ "Get-NetFirewallProfile": { code: 0, out } });
    expect((await run(fw("profile=False"))).by("firewall").status).toBe("ok");
    expect((await run(fw("profile=True\nrule=Phone;enabled=True;action=Allow;dir=Inbound;profile=Private"))).by("firewall").status).toBe("ok");
    expect((await run(fw("profile=True\nrule=Phone;enabled=True;action=Block;dir=Inbound;profile=Any"))).by("firewall")).toMatchObject({ status: "denied", fix: { settingsUrl: expect.any(String) } });
    // Windows makes BLOCK rules when its popup is unanswered; they beat an allow rule
    const both = (await run(fw("profile=True\nrule=PhoneDesk;enabled=True;action=Allow;dir=Inbound;profile=Any\nrule=phonedesk.exe;enabled=True;action=Block;dir=Inbound;profile=Public"))).by("firewall");
    expect(both.status).toBe("denied");
    expect(both.fix!.text).toContain("delete rule name=all");
    const none = (await run(fw("profile=True"))).by("firewall");
    expect(none.status).toBe("missing");
    expect(none.fix!.text).toContain("netsh advfirewall firewall add rule");
    expect(none.fix!.text).toContain(EXE);
    expect((await run({ "Get-NetFirewallProfile": { code: 1, out: "" } })).by("firewall").status).toBe("unknown");
  });
  test("network profile: Private ok, Public needs switching", async () => {
    expect((await run({ ps: { code: 0, out: "net=Home Wi-Fi;category=Private" } })).by("network")).toMatchObject({ status: "ok" });
    const pub = (await run({ ps: { code: 0, out: "net=Cafe;category=Public" } })).by("network");
    expect(pub).toMatchObject({ status: "unknown", fix: { settingsUrl: "ms-settings:network-status" } });
    expect(pub.detail).toContain("Cafe is a Public network");
    expect((await run({ ps: { code: 0, out: "net=A;category=Public\nnet=B;category=Private" } })).by("network").status).toBe("ok");
    expect((await run({ ps: { code: 0, out: "" } })).by("network").status).toBe("unknown");
  });
  test("Claude sign-in (credentials file), HA token, service", async () => {
    expect((await run({}, { fileExists: () => false })).by("keychain-claude")).toMatchObject({ status: "missing" });
    expect((await run({}, {}, { claude: { ok: true } })).by("keychain-claude").status).toBe("ok");
    expect((await run({}, {}, { claude: { ok: false, pending: true } })).by("keychain-claude")).toMatchObject({ status: "unknown", detail: "checking…" });
    const st = (o: any) => ({ url: "http://ha:8123", hasToken: true, connected: false, ...o });
    expect((await run({}, {}, { hass: st({}) })).by("keychain-hass").detail).toBe("the token is readable");
    expect((await run({}, {}, { hass: st({ hasToken: false }) })).by("keychain-hass").status).toBe("missing");
    expect((await run({ "schtasks /Query": { code: 1, out: "ERROR" } }, { asService: false })).by("service").fix!.text).toContain("service install");
    expect((await run({ "schtasks /Query": { code: 0, out: "Status: Ready" } }, { asService: false })).by("service").status).toBe("ok");
  });
  test("every Windows doctor string has a Vietnamese translation", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "platform", "win32", "doctor.ts"), "utf8");
    const i18n = readFileSync(join(import.meta.dir, "..", "src", "i18n.ts"), "utf8");
    const keys = [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => !i18n.includes(`"${k}":`))).toEqual([]);
  });
});

describe("hook commands on Windows", () => {
  test("paths in the hook line use forward slashes through the platform (macOS is unchanged)", () => {
    expect(HI.hookCommand("claude", { execPath: "/h/.phonedesk/bin/phonedesk" })).toBe("'/h/.phonedesk/bin/phonedesk' hook claude # phonedesk hook");
    expect(createPlatform("win32").hookPath("C:\\Users\\Me\\phonedesk.exe")).toBe("C:/Users/Me/phonedesk.exe");
  });
});

// Only on Windows: the real thing, read-only (no keys, no volume change, no sound, nothing outside the temp dir).
describe.skipIf(process.platform !== "win32")("real Windows (read-only)", () => {
  test("the helper answers ping, volume, net counters, processes and the app list", async () => {
    const h = new H.WinHelper({ dir: sandbox });
    try {
      expect(await h.call("ping", {}, 30_000)).toBe("pong");
      const vol = await h.call<any>("volume.get"); // a machine without an audio device (a CI runner) answers null, never an error
      expect(vol === null || typeof vol.level === "number").toBe(true);
      expect(Object.keys(await h.call("net.counters")).length).toBeGreaterThan(0);
      expect((await h.call<any[]>("proc.list", {}, 20_000)).length).toBeGreaterThan(5);
      expect((await h.call<any[]>("apps.list", {}, 30_000)).length).toBeGreaterThan(3);
      const err = await h.call("nope", {}, 30_000).then(() => "", (e: any) => String(e.message)); // not expect().rejects: Bun on Windows never delivers the reply to it
      expect(err).toContain("unknown command");
    } finally { h.dispose(); }
  }, 90_000);
  test("credentials round trip in the Credential Manager under a test target", async () => {
    const { realCredApi } = await import("../src/platform/win32/ffi");
    const t = "PhoneDeskTest/" + Date.now();
    try {
      // a session without a loaded credential store (an SSH logon, error 1312) cannot write: nothing to test there
      if (!realCredApi.write(t, "tester", "s3cret-ü")) return;
      expect(realCredApi.read(t)).toBe("s3cret-ü");
    } finally { realCredApi.remove(t); }
    expect(realCredApi.read(t)).toBeUndefined();
  });
  test("idle time is a number", async () => {
    const { idleSeconds } = await import("../src/platform/win32/ffi");
    const v = idleSeconds();
    expect(v === null || v >= 0).toBe(true);
  });
});
