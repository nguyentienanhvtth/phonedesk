import { describe, expect, test } from "bun:test";
import { SHELL_SPAWN_OPTIONS, runShell, shellArgv, shellSpawnOptions, type ShellProc } from "../src/platform/win32/shell";

const stream = (text: string) => new Response(text).body!;
function fake(opts: { code?: number; after?: number; out?: string; err?: string } = {}) {
  const calls: { argv: string[]; options: any }[] = [];
  let unrefs = 0;
  const spawn = (argv: string[], options: any): ShellProc => {
    calls.push({ argv, options });
    return {
      exited: opts.after === undefined ? Promise.resolve(opts.code ?? 0) : new Promise((r) => setTimeout(() => r(opts.code ?? 0), opts.after)),
      stdout: stream(opts.out ?? ""),
      stderr: stream(opts.err ?? ""),
      unref: () => { unrefs++; },
    };
  };
  return { spawn, calls, unrefs: () => unrefs };
}

describe("Windows shell action", () => {
  test("argv: cmd.exe /d /s /c with the command wrapped in ONE outer pair of quotes, passed verbatim", () => {
    expect(shellArgv("echo hi")).toEqual(["cmd.exe", "/d", "/s", "/c", '"echo hi"']);
    // the user's own quotes survive: cmd /s strips only the outer pair
    expect(shellArgv('"C:\\Program Files\\App\\app.exe" --x "a b"')).toEqual(["cmd.exe", "/d", "/s", "/c", '""C:\\Program Files\\App\\app.exe" --x "a b""']);
    expect(SHELL_SPAWN_OPTIONS.windowsVerbatimArguments).toBe(true);
  });

  test("GUI apps stay visible: cmd.exe is not hidden when the agent has a console (it shares that console, no new window)", () => {
    // libuv's windowsHide = CREATE_NO_WINDOW + SW_HIDE, and cmd passes SW_HIDE down to the programs it starts
    expect(shellSpawnOptions(true)).toEqual({ stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: false, windowsVerbatimArguments: true });
    // no console (or cannot tell): hiding is the only way to avoid a console window popping up
    expect(shellSpawnOptions(false).windowsHide).toBe(true);
    expect(shellSpawnOptions(null).windowsHide).toBe(true);
  });

  test("runShell asks for the console once per spawn and passes the matching options", async () => {
    const a = fake();
    await runShell("calc", a.spawn, 200, () => true);
    expect(a.calls[0]!.options.windowsHide).toBe(false);
    const b = fake();
    await runShell("calc", b.spawn, 200, () => null);
    expect(b.calls[0]!.options.windowsHide).toBe(true);
    expect(b.calls[0]!.argv).toEqual(["cmd.exe", "/d", "/s", "/c", '"calc"']);
  });

  test("a short command that succeeds resolves; its spawn gets the verbatim options", async () => {
    const f = fake({ out: "ok" });
    await runShell("dir", f.spawn, 500);
    expect(f.calls[0]!.argv).toEqual(["cmd.exe", "/d", "/s", "/c", '"dir"']);
    expect(f.calls[0]!.options.windowsVerbatimArguments).toBe(true);
  });

  test("a short command that fails reports its stderr (last lines) or the exit code", async () => {
    await expect(runShell("nope", fake({ code: 1, err: "'nope' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n" }).spawn, 500)).rejects.toThrow(/not recognized/);
    await expect(runShell("exit 3", fake({ code: 3 }).spawn, 500)).rejects.toThrow("command exited with code 3");
  });

  test("a long-running command (GUI app, server) is left running and counts as done: no timeout, no kill", async () => {
    const f = fake({ after: 5_000 });
    const t0 = Date.now();
    await runShell("notepad", f.spawn, 50);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(f.unrefs()).toBe(1);
  });

  test("a spawn failure is a clear error", async () => {
    await expect(runShell("x", () => { throw new Error("ENOENT"); }, 50)).rejects.toThrow("cannot start cmd.exe: ENOENT");
  });
});
