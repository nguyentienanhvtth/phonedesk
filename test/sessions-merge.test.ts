import { describe, expect, test } from "bun:test";
import { mergeSessions } from "../src/gaming";
import { normalizeAudioSessions } from "../web/manage/src/lib/gaming";

describe("audio sessions: one row per program", () => {
  const raw = [
    { pid: 13608, app: "steam", level: 100, muted: false, active: false },
    { pid: 13608, app: "steam", level: 40, muted: true, active: true },
    { pid: 13608, app: "Steam", level: 100, muted: false, active: false },
    { pid: 900, app: "Discord", level: 70, muted: true, active: false },
    { pid: 901, app: "Discord.exe", level: 70, muted: true, active: false },
  ];
  test("the agent merges Windows' per-stream sessions (Steam came back three times on a real PC)", () => {
    expect(mergeSessions(raw)).toEqual([
      { pid: 13608, app: "steam", level: 40, muted: false, active: true },
      { pid: 900, app: "Discord", level: 70, muted: true, active: false },
    ]);
  });
  test("the manage page dedupes too, for an agent that still sends duplicates", () => {
    const n = normalizeAudioSessions({ supported: true, sessions: raw }).sessions;
    expect(n.map((s) => s.app)).toEqual(["steam", "Discord"]);
    expect(n[0]).toMatchObject({ level: 40, active: true, muted: false });
    expect(n[1]!.muted).toBe(true);
  });
});
