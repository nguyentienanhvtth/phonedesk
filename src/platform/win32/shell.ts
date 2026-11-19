/**
 * The `shell` action on Windows.
 *
 * - The command goes to cmd.exe VERBATIM as `cmd.exe /d /s /c "<command>"` (windowsVerbatimArguments): with /s cmd
 *   strips exactly the outer pair of quotes and runs the rest as typed, so `"C:\Program Files\App\app.exe" --flag`
 *   keeps its own quotes. (Bun's default quoting escapes inner quotes as \" which cmd does not understand.)
 * - Fire-and-forget after a short settle: a command that ends within SHELL_SETTLE_MS reports its exit code and stderr
 *   (a typo still shows an error on the phone); one still running then (a GUI app, a server, `timeout 30`) is left
 *   running, unref'd and drained, and the press counts as done instead of "timed out after 10s" + a killed program.
 */
export const SHELL_SETTLE_MS = 2_000;
const KEEP_OUTPUT = 4_000;

export function shellArgv(command: string): string[] {
  return ["cmd.exe", "/d", "/s", "/c", `"${command}"`];
}

export const SHELL_SPAWN_OPTIONS = { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true, windowsVerbatimArguments: true } as const;

export interface ShellProc {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null | undefined | number;
  stderr: ReadableStream<Uint8Array> | null | undefined | number;
  unref?: () => void;
}
export type ShellSpawn = (argv: string[], options: typeof SHELL_SPAWN_OPTIONS) => ShellProc;

const defaultSpawn: ShellSpawn = (argv, options) => Bun.spawn(argv, options as any) as unknown as ShellProc;

/** Reads a stream to the end (so the child never blocks on a full pipe), keeping only the last KEEP_OUTPUT chars. */
function drain(s: ShellProc["stdout"]): { text: () => string; done: Promise<void> } {
  let buf = "";
  if (!s || typeof s === "number") return { text: () => "", done: Promise.resolve() };
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for await (const chunk of s as any) {
        buf = (buf + dec.decode(chunk as Uint8Array, { stream: true })).slice(-KEEP_OUTPUT);
      }
    } catch { /* closed */ }
  })();
  return { text: () => buf, done };
}

export async function runShell(command: string, spawn: ShellSpawn = defaultSpawn, settleMs = SHELL_SETTLE_MS): Promise<void> {
  let proc: ShellProc;
  try {
    proc = spawn(shellArgv(command), SHELL_SPAWN_OPTIONS);
  } catch (err: any) {
    throw new Error(`cannot start cmd.exe: ${err?.message ?? err}`);
  }
  const out = drain(proc.stdout);
  const err = drain(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    proc.exited.then((code) => ({ code })),
    new Promise<null>((r) => { timer = setTimeout(() => r(null), settleMs); }),
  ]);
  clearTimeout(timer);
  if (settled === null) {
    // still running: leave it be (never kill a launched program); the agent must not wait for it either
    proc.unref?.();
    return;
  }
  // give the pipes a moment to flush, without hanging on a grandchild that kept them open
  await Promise.race([Promise.all([out.done, err.done]), new Promise((r) => setTimeout(r, 300))]);
  if (settled.code !== 0) {
    const msg = (err.text().trim() || out.text().trim()).split(/\r?\n/).slice(-3).join(" ").trim();
    throw new Error(msg || `command exited with code ${settled.code}`);
  }
}
