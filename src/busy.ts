import { platform } from "./platform";

/** Who listens on a TCP port on this machine: { pid, name } or null (also when lsof / netstat is not available). */
export async function portHolder(port: number): Promise<{ pid: number; name: string } | null> {
  const run = async (argv: string[]): Promise<string> => {
    try {
      const p = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore", windowsHide: true } as any);
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out;
    } catch { return ""; }
  };
  if (platform.id === "win32") {
    const out = await run(["netstat", "-ano", "-p", "TCP"]);
    for (const line of out.split(/\r?\n/)) {
      const m = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i").exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      const t = (await run(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"])).split(",")[0]?.replace(/"/g, "").trim();
      return { pid, name: t || `pid ${pid}` };
    }
    return null;
  }
  const out = await run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  const pid = /^p(\d+)/m.exec(out)?.[1];
  if (!pid) return null;
  return { pid: Number(pid), name: /^c(.+)$/m.exec(out)?.[1] ?? `pid ${pid}` };
}

/**
 * The agent could not listen on `port`. What to tell the user, without a stack trace: another PhoneDesk (most likely the
 * background service) answers there, or some other program holds the port.
 */
export async function explainBusyPort(port: number, o: { fetch?: typeof fetch; service?: () => Promise<boolean>; holder?: typeof portHolder } = {}): Promise<string> {
  const f = o.fetch ?? fetch;
  let about: any = null;
  try {
    const r = await f(`http://127.0.0.1:${port}/api/about`, { headers: { "x-phonedesk": "1" }, signal: AbortSignal.timeout(2500) });
    if (r.ok) about = await r.json();
  } catch { /* not PhoneDesk, or not answering */ }
  if (about?.name === "PhoneDesk") {
    let svc = false;
    try { svc = (await o.service?.()) ?? false; } catch { /* unknown */ }
    return `PhoneDesk ${about.version ?? ""} is already running on port ${port}${svc ? " (background service)" : ""}. Open http://localhost:${port}/manage/ or run: phonedesk service restart`.replace("PhoneDesk  ", "PhoneDesk ");
  }
  const h = await (o.holder ?? portHolder)(port);
  return `port ${port} is already in use${h ? ` by ${h.name} (pid ${h.pid})` : ""}. Stop it, or start PhoneDesk on another port: phonedesk --port ${port + 1}`;
}
