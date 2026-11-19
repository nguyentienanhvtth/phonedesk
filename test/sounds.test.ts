import { describe, expect, test } from "bun:test";
import { WIN, MODE600, MODE644 } from "./_os";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PHONEDESK_HOME ??= mkdtempSync(join(tmpdir(), "pd-snd-"));
const { SoundLibrary, SoundPlayer, soundKind, parseAfinfo, playCommand, MAX_CONCURRENT, SOUND_MAX, playableExts, soundRefs, missingSoundError } = await import("../src/sounds");
const { soundFormatProblem } = await import("../web/manage/src/lib/sounds");

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
export const MP3 = bytes("ID3", [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const M4A = bytes([0, 0, 0, 24], "ftypM4A ", [0, 0, 0, 0, 0, 0, 0, 0]);
export const WAV = bytes("RIFF", [0, 0, 0, 0], "WAVEfmt ");
export const OGG = bytes("OggS", [0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
export const AAC = bytes([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP3_SYNC = bytes([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);

const tmp = () => mkdtempSync(join(tmpdir(), "pd-sndhome-"));

describe("soundKind", () => {
  test("by file header, never by name", () => {
    expect(soundKind(MP3)).toBe("mp3");
    expect(soundKind(MP3_SYNC)).toBe("mp3");
    expect(soundKind(M4A)).toBe("m4a");
    expect(soundKind(WAV)).toBe("wav");
    expect(soundKind(OGG)).toBe("ogg");
    expect(soundKind(AAC)).toBe("aac");
    expect(soundKind(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(soundKind(bytes("GIF89a", [0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(soundKind(new Uint8Array(4))).toBeNull();
  });
  test("parseAfinfo", () => {
    expect(parseAfinfo("File:  x\nestimated duration: 3.141592 sec\n")).toBe(3142);
    expect(parseAfinfo("nothing")).toBeUndefined();
  });
});

describe("SoundLibrary", () => {
  const fakeRun = async (argv: string[]) => { expect(argv[0]).toBe("afinfo"); return "estimated duration: 2.5 sec"; };

  test("add stores <hex>.<ext> at 0600 with name, size and duration; list, rename, remove", async () => {
    const home = tmp();
    const lib = new SoundLibrary({ home, run: fakeRun, now: () => 1000 });
    const a = await lib.add(MP3, "Airhorn.mp3");
    expect(a).toMatchObject({ name: "Airhorn", ext: "mp3", size: MP3.length, durationMs: 2500, createdAt: 1000 });
    expect(a.id).toMatch(/^snd:[0-9a-f]{16}$/);
    const hex = a.id.slice(4);
    const file = join(home, "sounds", `${hex}.mp3`);
    expect(statSync(file).mode & 0o777).toBe(MODE600);
    expect(JSON.parse(readFileSync(join(home, "sounds.json"), "utf8"))[hex].name).toBe("Airhorn");
    expect(statSync(join(home, "sounds.json")).mode & 0o777).toBe(MODE600);

    const b = await lib.add(WAV);
    expect(b.name).toBe("Sound");
    expect((await lib.list()).map((s) => s.id).sort()).toEqual([b.id, a.id].sort());
    expect((await lib.get(a.id))!.path).toBe(file);
    expect((await lib.get(hex))!.id).toBe(a.id); // bare id also works
    expect((await lib.rename(a.id, "  Horn  "))!.name).toBe("Horn");
    expect((await lib.rename(a.id, "   "))!.name).toBe("Horn"); // blank keeps the old name
    expect(await lib.rename("snd:0000000000000000", "x")).toBeNull();
    expect(await lib.remove(a.id)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(await lib.remove(a.id)).toBe(false);
    expect(await lib.get(a.id)).toBeNull();
    expect(await lib.get("../../etc/passwd")).toBeNull();
  });

  test("rejects non-audio, empty and oversized; a missing afinfo is fine", async () => {
    const lib = new SoundLibrary({ home: tmp(), os: "darwin", run: async () => { throw new Error("no afinfo"); } });
    await expect(lib.add(bytes("<svg/> padding padding"))).rejects.toThrow("mp3, m4a, wav");
    await expect(lib.add(new Uint8Array())).rejects.toThrow("empty");
    await expect(lib.add(new Uint8Array(SOUND_MAX + 1).fill(1))).rejects.toThrow("5 MB");
    const ok = await lib.add(OGG, "x".repeat(200) + ".ogg");
    expect(ok.durationMs).toBeUndefined();
    expect(ok.name.length).toBe(80);
  });
  test("concurrent adds all land in sounds.json", async () => {
    const lib = new SoundLibrary({ home: tmp(), os: "linux", run: fakeRun });
    await Promise.all([MP3, M4A, WAV, OGG, AAC].map((b) => lib.add(b)));
    expect((await lib.list()).length).toBe(5);
  });
});

describe("playCommand and SoundPlayer", () => {
  test("afplay with volume/100 on macOS, paplay/aplay on Linux, error elsewhere", () => {
    expect(playCommand("/s/a.mp3", 50, "darwin")).toEqual(["afplay", "-v", "0.5", "/s/a.mp3"]);
    expect(playCommand("/s/a.mp3", 100, "darwin")).toEqual(["afplay", "-v", "1", "/s/a.mp3"]);
    expect(playCommand("/s/a.mp3", 50, "linux", (n) => (n === "paplay" ? "/usr/bin/paplay" : null))).toEqual(["paplay", "--volume=32768", "/s/a.mp3"]);
    expect(playCommand("/s/a.mp3", 50, "linux", (n) => (n === "aplay" ? "/usr/bin/aplay" : null))).toEqual(["aplay", "-q", "/s/a.mp3"]);
    expect(() => playCommand("/s/a.mp3", 50, "linux", () => null)).toThrow("not installed");
    expect(playCommand("/s/a.mp3", 50, "win32")[0]).toBe("powershell.exe");
  });

  function rig() {
    const started: { argv: string[]; killed: boolean; finish: () => void }[] = [];
    const changes: string[][] = [];
    const player = new SoundPlayer({
      platform: "darwin",
      spawn: (argv) => {
        let finish!: () => void;
        const exited = new Promise<void>((r) => { finish = r; });
        const rec = { argv, killed: false, finish };
        started.push(rec);
        return { kill: () => { rec.killed = true; finish(); }, exited };
      },
      onChange: (ids) => changes.push([...ids]),
    });
    return { player, started, changes };
  }
  const A = "snd:aaaaaaaaaaaaaaaa", B = "snd:bbbbbbbbbbbbbbbb";

  test("restart kills the previous instance of the same sound; others keep playing", () => {
    const { player, started, changes } = rig();
    expect(player.play(A, "/a", 80, "restart")).toBe("started");
    expect(started[0]!.argv).toEqual(["afplay", "-v", "0.8", "/a"]);
    player.play(B, "/b", 100, "restart");
    player.play(A, "/a", 80, "restart");
    expect(started.map((s) => s.killed)).toEqual([true, false, false]);
    expect(player.playing().sort()).toEqual([A, B]);
    expect(changes[0]).toEqual([A]);
  });

  test("toggle stops a playing sound and does not start it again; starts it when idle", () => {
    const { player, started } = rig();
    expect(player.play(A, "/a", 100, "toggle")).toBe("started");
    expect(player.play(A, "/a", 100, "toggle")).toBe("stopped");
    expect(started.length).toBe(1);
    expect(started[0]!.killed).toBe(true);
    expect(player.playing()).toEqual([]);
    expect(player.play(A, "/a", 100, "toggle")).toBe("started");
  });

  test("overlap allows several instances up to 8", () => {
    const { player, started } = rig();
    for (let i = 0; i < MAX_CONCURRENT; i++) player.play(A, "/a", 100, "overlap");
    expect(started.length).toBe(MAX_CONCURRENT);
    expect(started.some((s) => s.killed)).toBe(false);
    expect(() => player.play(A, "/a", 100, "overlap")).toThrow("already 8");
    expect(() => player.play(B, "/b", 100, "restart")).toThrow("already 8");
  });

  test("a finished clip leaves the set and notifies; stopAll kills everything", async () => {
    const { player, started, changes } = rig();
    player.play(A, "/a");
    player.play(B, "/b");
    started[0]!.finish();
    await Bun.sleep(5);
    expect(player.playing()).toEqual([B]);
    expect(changes.at(-1)).toEqual([B]);
    player.stopAll();
    expect(started[1]!.killed).toBe(true);
    expect(player.playing()).toEqual([]);
    expect(changes.at(-1)).toEqual([]);
    player.stopAll(); // nothing changed: no extra notification
    expect(changes.filter((c) => c.length === 0).length).toBe(1);
  });
});

describe("sound formats per OS and sound references", () => {
  const tmp2 = () => mkdtempSync(join(tmpdir(), "pd-snd-os-"));
  test("Windows refuses ogg with a clear reason (its player has no Ogg decoder); other formats still go in", async () => {
    expect(playableExts("win32")).toEqual(["mp3", "m4a", "wav", "aac"]);
    expect(playableExts("darwin")).toContain("ogg");
    const lib = new SoundLibrary({ home: tmp2(), os: "win32", run: async () => "" });
    await expect(lib.add(OGG, "a.ogg")).rejects.toThrow("ogg audio cannot play on Windows: convert the clip to mp3, m4a or wav");
    await expect(lib.add(bytes("<svg/> padding padding"))).rejects.toThrow("only mp3, m4a, wav or aac audio is accepted");
    expect((await lib.add(MP3, "a")).ext).toBe("mp3");
    expect((await lib.list()).length).toBe(1); // the refused ogg left nothing behind
  });

  test("the manage page says why before uploading: flac/aiff everywhere, ogg on Windows", () => {
    expect(soundFormatProblem("a.flac", false)).toContain("not supported");
    expect(soundFormatProblem("a.ogg", true)).toContain("Windows cannot play ogg");
    expect(soundFormatProblem("a.ogg", false)).toBeNull();
    expect(soundFormatProblem("a.mp3", true)).toBeNull();
  });

  test("soundRefs finds clips on buttons, inside macros and in rules, with the button label", () => {
    const layout = { version: 1, pages: [{ id: "p", name: "P", items: [
      { id: "a", label: "Horn", action: { type: "sound", sound: "snd:aaaaaaaaaaaaaaaa" } },
      { id: "m", label: "Combo", action: { type: "macro", steps: [{ action: { type: "sound", sound: "bbbbbbbbbbbbbbbb" } }] } },
    ] }], rules: [{ id: "r", name: "Rule", then: [{ type: "sound", sound: "snd:cccccccccccccccc" }] }] };
    expect(soundRefs(layout)).toEqual([
      { sound: "snd:aaaaaaaaaaaaaaaa", label: "Horn" },
      { sound: "snd:bbbbbbbbbbbbbbbb", label: "Combo" },
      { sound: "snd:cccccccccccccccc", label: "Rule" },
    ]);
    const lib = new Set(["snd:aaaaaaaaaaaaaaaa", "snd:bbbbbbbbbbbbbbbb"]);
    expect(missingSoundError(layout, {}, lib)).toContain("“Rule” plays a sound that is not in the library (snd:cccccccccccccccc)");
    // already on the saved layout (its clip was deleted later): still saveable
    expect(missingSoundError(layout, layout, lib)).toBeNull();
  });
});
