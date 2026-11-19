import { describe, expect, test } from "bun:test";
import * as W from "../src/platform/win32/doctor";

const probes = (exe: string, out: string, code = 0) => {
  const ran: string[][] = [];
  return { ran, p: { exe, run: async (argv: string[]) => { ran.push(argv); return { code, out }; } } as any };
};
const BUN = "C:\\Users\\finn\\.bun\\bin\\bun.exe";
const EXE = "C:\\Users\\finn\\AppData\\Local\\PhoneDesk\\phonedesk.exe";

describe("Windows doctor: firewall and the program it is about", () => {
  test("exeName / fromSource", () => {
    expect(W.exeName({ exe: EXE })).toBe("phonedesk.exe");
    expect(W.exeName({ exe: BUN })).toBe("bun.exe");
    expect(W.fromSource({ exe: BUN })).toBe(true);
    expect(W.fromSource({ exe: "/home/x/.bun/bin/bun" })).toBe(true);
    expect(W.fromSource({ exe: EXE })).toBe(false);
  });

  test("from source: the rules are looked up for bun.exe (process.execPath) and the wording says so", async () => {
    const k = probes(BUN, "profile=True\n");
    const r = await W.firewall(k.p);
    expect(k.ran[0]!.at(-1)).toContain(`-Program '${BUN}'`);
    expect(r.status).toBe("missing");
    expect(r.detail).toContain("no rule for bun.exe");
    expect(r.detail).toContain("running from source");
    expect(r.fix!.text).toContain(`program="${BUN}"`);
    expect(r.fix!.settingsUrl).toBe("windowsdefender://network");
  });

  test("an installed copy talks about phonedesk.exe, with no source note", async () => {
    const block = await W.firewall(probes(EXE, "profile=True\nrule=PhoneDesk;enabled=True;action=Block;dir=Inbound;profile=Any\n").p);
    expect(block.status).toBe("denied");
    expect(block.detail).toContain("BLOCK rule for phonedesk.exe");
    expect(block.detail).not.toContain("source");
    const allow = await W.firewall(probes(EXE, "profile=True\nrule=PhoneDesk;enabled=True;action=Allow;dir=Inbound;profile=Any\n").p);
    expect(allow).toMatchObject({ status: "ok", detail: "the firewall is on and allows incoming connections to phonedesk.exe" });
    const bunAllow = await W.firewall(probes(BUN, "profile=True\nrule=bun;enabled=True;action=Allow;dir=Inbound;profile=Private\n").p);
    expect(bunAllow.status).toBe("ok");
    expect(bunAllow.detail).toContain("bun.exe (running from source");
  });

  test("SmartScreen / signature wording names the real program", async () => {
    const mark = await W.smartscreen(probes(BUN, "motw=yes").p);
    expect(mark.detail).toContain("bun.exe carries");
    expect(mark.fix!.settingsUrl).toBe("windowsdefender://smartscreenpua");
    expect((await W.signature(probes(EXE, "status=NotSigned").p)).fix!.text).toContain("on phonedesk.exe");
  });

  test("every Windows pane is something POST /api/doctor/open accepts", async () => {
    const { OPENABLE_URL } = await import("../src/doctor");
    for (const url of [...Object.values(W.WIN_PANES), "ms-settings:network-status"]) expect(OPENABLE_URL.test(url)).toBe(true);
  });
});
