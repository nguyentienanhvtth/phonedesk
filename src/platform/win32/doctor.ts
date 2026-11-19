import type { DoctorCtx, DoctorItem, Probes } from "../../doctor";
import { t } from "../../i18n";

/** The Windows doctor checks. Each runs a fixed read-only command through `p.run` (never changes anything). */
export const PS = (script: string) => ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Authenticode status of the exe: Valid (signed) / NotSigned. */
export const signatureArgv = (exe: string) => PS(`$s = Get-AuthenticodeSignature -LiteralPath ${q(exe)}; "status=$($s.Status)"; "subject=$($s.SignerCertificate.Subject)"`);
/** Mark-of-the-Web: a Zone.Identifier stream on the exe (set by browsers) makes SmartScreen warn on every update. */
export const motwArgv = (exe: string) => PS(`$z = Get-Content -LiteralPath ${q(exe)} -Stream Zone.Identifier -ErrorAction SilentlyContinue; if ($z) { "motw=yes" } else { "motw=no" }`);
/** Windows Firewall: is the Private profile on, and which inbound rules name this program. */
export const firewallArgv = (exe: string) =>
  PS(`"profile=$((Get-NetFirewallProfile -Profile Private).Enabled)"; Get-NetFirewallApplicationFilter -Program ${q(exe)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | ForEach-Object { "rule=$($_.DisplayName);enabled=$($_.Enabled);action=$($_.Action);dir=$($_.Direction);profile=$($_.Profile)" }`);
/** The network profile of each active connection: Public networks block incoming connections whatever the rules say. */
export const networkArgv = () => PS(`Get-NetConnectionProfile | ForEach-Object { "net=$($_.Name);category=$($_.NetworkCategory)" }`);
export const taskArgv = () => ["schtasks", "/Query", "/TN", "PhoneDesk", "/FO", "LIST"];

export const WIN_PANES = {
  firewall: "windowsdefender://network",
  smartscreen: "windowsdefender://smartscreenpua",
  privacy: "ms-settings:privacy",
} as const;

const base = (exe: string) => exe.replace(/^.*[\\/]/, "");
/** The program the checks are about, as the user sees it: phonedesk.exe, or bun.exe when PhoneDesk runs from source. */
export const exeName = (p: Pick<Probes, "exe">) => base(p.exe) || "phonedesk.exe";
/** Running from source (`bun src/index.ts`): the firewall sees bun.exe, not phonedesk.exe. */
export const fromSource = (p: Pick<Probes, "exe">) => /^bun(\.exe)?$/i.test(base(p.exe));
const sourceNote = (p: Pick<Probes, "exe">) => (fromSource(p) ? t(" (running from source: the rules checked are the ones for {exe})", { exe: p.exe }) : "");

export function parseKv(out: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return m;
}

export async function signature(p: Probes): Promise<DoctorItem> {
  const title = t("Code signature");
  const r = await p.run(signatureArgv(p.exe));
  const kv = parseKv(r.out);
  if (kv.status === "Valid") return { id: "signature", title, status: "ok", detail: t("signed by {who}", { who: kv.subject || "?" }) };
  if (kv.status === "NotSigned") return { id: "signature", title, status: "ok", detail: t("not signed: Windows SmartScreen may warn the first time it runs"), fix: { text: t("If SmartScreen blocks it, choose More info > Run anyway, or run `Unblock-File` on {name} in PowerShell.", { name: exeName(p) }) } };
  return { id: "signature", title, status: "unknown", detail: t("not signed or unreadable ({exe})", { exe: p.exe }) };
}

export async function smartscreen(p: Probes): Promise<DoctorItem> {
  const title = t("SmartScreen (downloaded file mark)");
  const r = await p.run(motwArgv(p.exe));
  if (parseKv(r.out).motw === "yes") {
    return { id: "smartscreen", title, status: "missing", detail: t("{name} carries the downloaded-from-the-internet mark: Windows may warn each time it starts", { name: exeName(p) }), fix: { text: t("Run `Unblock-File` on {name} in PowerShell (the installer does this for you).", { name: exeName(p) }), settingsUrl: WIN_PANES.smartscreen } };
  }
  return { id: "smartscreen", title, status: "ok", detail: t("no downloaded-file mark on {name}", { name: exeName(p) }) };
}

export async function firewall(p: Probes): Promise<DoctorItem> {
  const title = t("Firewall");
  const r = await p.run(firewallArgv(p.exe));
  if (r.code !== 0 && !/profile=/.test(r.out)) return { id: "firewall", title, status: "unknown", detail: t("could not read the firewall state") };
  const kv = parseKv(r.out);
  if (/^false$/i.test(kv.profile ?? "")) return { id: "firewall", title, status: "ok", detail: t("the Windows firewall is off for private networks: phones can connect") };
  const rules = r.out.split(/\r?\n/).filter((l) => l.startsWith("rule=")).map((l) => parseKv(l.replace(/;/g, "\n").replace(/^rule=/, "rule=")));
  const inbound = rules.filter((x) => /inbound|^1$/i.test(x.dir ?? "") && /^true$/i.test(x.enabled ?? ""));
  if (inbound.some((x) => /block|^4$/i.test(x.action ?? ""))) {
    return { id: "firewall", title, status: "denied", detail: t("blocked by a firewall BLOCK rule for {name} (Windows creates it when its first-run popup is not answered): phones cannot connect", { name: exeName(p) }) + sourceNote(p), fix: { text: t("Run as administrator: netsh advfirewall firewall delete rule name=all program=\"{exe}\" & netsh advfirewall firewall add rule name=\"PhoneDesk\" dir=in action=allow program=\"{exe}\" profile=any remoteip=localsubnet", { exe: p.exe }), settingsUrl: WIN_PANES.firewall } };
  }
  if (inbound.some((x) => /allow|^2$/i.test(x.action ?? ""))) return { id: "firewall", title, status: "ok", detail: t("the firewall is on and allows incoming connections to {name}", { name: exeName(p) }) + sourceNote(p) };
  return {
    id: "firewall", title, status: "missing",
    detail: t("the firewall is on and has no rule for {name}: phones on your network cannot connect until it is allowed", { name: exeName(p) }) + sourceNote(p),
    fix: { text: t("Click Allow when Windows asks, or run as administrator: netsh advfirewall firewall add rule name=\"PhoneDesk\" dir=in action=allow program=\"{exe}\" profile=any remoteip=localsubnet", { exe: p.exe }), settingsUrl: WIN_PANES.firewall },
  };
}

export async function network(p: Probes): Promise<DoctorItem> {
  const title = t("Network profile");
  const r = await p.run(networkArgv());
  const nets = r.out.split(/\r?\n/).filter((l) => l.startsWith("net=")).map((l) => parseKv(l.replace(/;/g, "\n")));
  if (!nets.length) return { id: "network", title, status: "unknown", detail: t("no active network connection found") };
  const priv = nets.filter((n) => /private|domain/i.test(n.category ?? ""));
  if (priv.length) return { id: "network", title, status: "ok", detail: t("connected to a Private network ({name}): phones can reach this PC", { name: priv[0]!.net ?? "?" }) };
  const name = nets[0]!.net ?? "?";
  return {
    id: "network", title, status: "unknown", detail: t("{name} is a Public network: Windows may block incoming connections on it; if your phone cannot connect, switch it to Private", { name }),
    fix: { text: t("Open Settings > Network & internet, choose your Wi-Fi or Ethernet connection and set the network profile type to Private."), settingsUrl: "ms-settings:network-status" },
  };
}

/** SendInput only works in the signed-in desktop session (window station WinSta0): over SSH or as a service it cannot press keys. */
export function desktopSession(p: Probes): DoctorItem {
  const title = t("Desktop session");
  const { station, idle } = p.desktop();
  if (station === null && idle === null) return { id: "desktop-session", title, status: "unknown", detail: t("could not read the input state of this session") };
  if (station !== null && station !== "WinSta0") {
    return {
      id: "desktop-session", title, status: "missing", detail: t("not running on the signed-in desktop ({station}): key presses, typing, Now Playing and volume will not work", { station }),
      fix: { text: t("Start PhoneDesk from your own desktop session: `phonedesk service install` does that at logon.") },
    };
  }
  return { id: "desktop-session", title, status: "ok", detail: t("key presses and typing work (last input {n} s ago)", { n: Math.round(idle ?? 0) }) };
}

export async function helper(p: Probes): Promise<DoctorItem> {
  const title = t("PowerShell helper");
  const ok = await p.helperPing();
  return ok
    ? { id: "helper", title, status: "ok", detail: t("running: media, volume, app icons and the process list work") }
    : { id: "helper", title, status: "missing", detail: t("the helper did not answer: Now Playing, volume, app icons and processes will not work"), fix: { text: t("Check that Windows PowerShell 5.1 (powershell.exe) can run scripts for your user, then restart PhoneDesk.") } };
}

export async function startup(p: Probes): Promise<DoctorItem> {
  const title = t("Background service");
  if (p.asService) return { id: "service", title, status: "ok", detail: t("started by the PhoneDesk scheduled task at logon") };
  const r = await p.run(taskArgv());
  return /Status:/i.test(r.out) && r.code === 0
    ? { id: "service", title, status: "ok", detail: t("the PhoneDesk scheduled task exists (this copy was started by hand)") }
    : { id: "service", title, status: "n/a", detail: t("not set to start at logon"), fix: { text: t("Run `phonedesk service install` to start PhoneDesk at logon.") } };
}

export async function claudeSignIn(p: Probes, ctx: DoctorCtx): Promise<DoctorItem> {
  const title = t("Claude Code sign-in");
  const has = p.fileExists(p.claudeCredentialsFile());
  if (!has) return { id: "keychain-claude", title, status: "missing", detail: t("no Claude Code sign-in found (the quota tile stays empty)"), fix: { text: t("Sign in to Claude Code on this PC.") } };
  if (!ctx.claude) return { id: "keychain-claude", title, status: "unknown", detail: t("the item exists; not read yet") };
  if (ctx.claude.pending) return { id: "keychain-claude", title, status: "unknown", detail: t("checking…") };
  if (ctx.claude.ok) return { id: "keychain-claude", title, status: "ok", detail: t("the item exists and the last read worked") };
  return { id: "keychain-claude", title, status: "denied", detail: t("the item exists but the last read failed: {why}", { why: ctx.claude.error ?? "?" }), fix: { text: t("Sign in to Claude Code again.") } };
}

export function haToken(ctx: DoctorCtx): DoctorItem {
  const title = t("Credential Manager: Home Assistant token");
  const h = ctx.hass;
  if (!h || !h.url) return { id: "keychain-hass", title, status: "n/a", detail: t("Home Assistant is not set up") };
  if (h.hasToken) return { id: "keychain-hass", title, status: "ok", detail: t("the token is readable") };
  return { id: "keychain-hass", title, status: "missing", detail: t("a URL is set but the token cannot be read"), fix: { text: t("Enter the token again on the management page (Integrations > Home Assistant).") } };
}
