import { useState } from "react";
import { IconRefresh as Refresh, IconRotateClockwise2 as Reset, IconSettings as Settings, IconShieldCheck as Shield } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Card, CardContent } from "@/components/ui/knowns/card";
import { Spinner } from "@/components/ui/knowns/spinner";
import { StatusDot, type StatusDotTone } from "@/components/ui/knowns/status-dot";
import { api } from "@/api";
import { t, useLanguage } from "@/lib/i18n";
import { usePlatform } from "@/lib/platform";
import type { DoctorItem, DoctorStatus } from "@/types";
import { OPENABLE_URL } from "@/lib/doctor";

/** English source text for known check ids; unknown ids show the agent's name or the id itself. */
const NAMES: Record<string, string> = {
  accessibility: "Accessibility (keyboard shortcuts, typing)",
  "screen-recording": "Screen recording",
  automation: "Automation (control other apps)",
  "input-monitoring": "Input monitoring",
  notifications: "Notifications",
  "local-network": "Local network",
  firewall: "Windows Firewall (phone connections)",
  smartscreen: "SmartScreen (downloaded app warning)",
  helper: "Media and sound helper",
  claude: "Claude Code",
  codex: "Codex",
};
const TONE: Record<DoctorStatus, StatusDotTone> = { ok: "success", missing: "warning", denied: "danger", unknown: "neutral", "n/a": "neutral" };
/** Rows that are real permissions: ok reads "Allowed". Info rows (versions, service, signature, helper...) read "OK". */
const PERMISSION_IDS = new Set(["firewall", "accessibility", "automation", "screen-recording", "input-monitoring", "notifications", "local-network"]);
const STATE: Record<DoctorStatus, string> = { ok: "OK", missing: "Not set up", denied: "Blocked", unknown: "Unknown", "n/a": "Not needed" };
const stateLabel = (i: DoctorItem) => t(i.status === "ok" && PERMISSION_IDS.has(i.id) ? "Allowed" : STATE[i.status]);
/** "Not signed" is a warning, never green, whatever status the agent gave. */
const toneOf = (i: DoctorItem): StatusDotTone => (/signature|signing/i.test(i.id) && (i.status !== "ok" || /not signed|unsigned|ad.?hoc/i.test(i.detail ?? "")) ? "warning" : TONE[i.status]);
/** Rows that only exist on macOS: hidden when the agent runs on Windows. */
const MAC_ONLY = new Set(["accessibility", "screen-recording", "automation", "input-monitoring"]);
/** Checks the agent can ask macOS to prompt for. */
const REQUESTABLE = new Set(["accessibility", "local-network"]);
/** Checks whose stale grant (from an older PhoneDesk build) can be cleared so macOS asks again. */
const RESETTABLE = new Set(["accessibility"]);

export function PermissionsPanel({ items, missing, error, reload }: { items: DoctorItem[] | null; missing: boolean; error: string | null; reload: () => Promise<void> }) {
  useLanguage();
  const platform = usePlatform();
  const win = platform === "win32";
  const shown = items?.filter((i) => i.status !== "n/a" && !(win && MAC_ONLY.has(i.id))) ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      if (done) setNote({ tone: "success", text: done });
      await reload();
    } catch (e) {
      setNote({ tone: "danger", text: t("Could not do that: {error}", { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          {win ? t("PhoneDesk checks that Windows lets phone connections and the helper through. Fix anything marked below, then check again.") : t("PhoneDesk needs a few macOS permissions to press keys, type text and control apps for you. Grant them in System Settings, then check again.")}
        </p>
        <Button size="sm" variant="secondary" icon={<Refresh />} loading={busy === "all"} onClick={() => void act("all", reload)}>{t("Check again")}</Button>
      </div>
      <Alert tone="info">{win ? t("Windows may show a SmartScreen warning for a downloaded app: choose More info, then Run anyway. The setup script adds a firewall rule for PhoneDesk on any network profile, limited to your local subnet, so phones on your network can connect.") : t("If you update PhoneDesk and the app is signed ad hoc, macOS may forget the permissions. Remove the old entry in System Settings, then grant it again.")}</Alert>
      {missing && <Alert tone="info">{t("This agent does not report permissions yet (/api/doctor returned 404). Update the agent and reload the page.")}</Alert>}
      {error && !missing && (!items || items.length === 0) && <Alert tone="danger" action={{ label: t("Retry"), onClick: () => void reload() }}>{error}</Alert>}
      {note && <Alert tone={note.tone} onDismiss={() => setNote(null)}>{note.text}</Alert>}
      {!shown && <Spinner label={t("Loading")} />}
      {shown && shown.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {shown.map((i) => {
                const name = NAMES[i.id] ? t(NAMES[i.id]!) : i.name ?? i.id;
                const bad = i.status === "missing" || i.status === "denied";
                // "unknown" Local Network (Home Assistant unreachable) still gets its Request button
                // the agent opens only OS settings links (System Settings, Windows Settings / Security): no link, no button
                const openable = !!i.fix?.settingsUrl && OPENABLE_URL.test(i.fix.settingsUrl);
                const actionable = bad || (i.status === "unknown" && (i.id === "local-network" || openable));
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <StatusDot tone={toneOf(i)} pulse={false} label={stateLabel(i)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{name} <span className="font-normal text-muted-foreground">· {stateLabel(i)}</span></p>
                      {i.detail && <p className="text-xs text-muted-foreground">{i.detail}</p>}
                      {bad && i.fix?.text && <p className="mt-0.5 text-xs">{i.fix.text}</p>}
                    </div>
                    {actionable && (
                      <div className="flex flex-none items-center gap-2">
                        {!win && RESETTABLE.has(i.id) && <Button size="xs" variant="secondary" icon={<Reset />} loading={busy === `reset-${i.id}`} title={t("Clears the old entry (left by an earlier PhoneDesk version) and asks macOS again. Turn phonedesk on when the prompt appears.")} onClick={() => void act(`reset-${i.id}`, () => api.requestDoctor(i.id, true), t("The old entry was cleared and macOS was asked again."))}>{t("Reset and ask again")}</Button>}
                        {!win && REQUESTABLE.has(i.id) && <Button size="xs" icon={<Shield />} loading={busy === `req-${i.id}`} onClick={() => void act(`req-${i.id}`, () => api.requestDoctor(i.id), t("macOS was asked to show its permission prompt."))}>{t("Request")}</Button>}
                        {openable && <Button size="xs" variant="secondary" icon={<Settings />} loading={busy === `open-${i.id}`} onClick={() => void act(`open-${i.id}`, () => api.openDoctorSettings(i.id))}>{win ? (i.fix?.settingsUrl?.startsWith("windowsdefender:") ? t("Open Windows Security") : t("Open Windows Settings")) : t("Open Settings")}</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
      {shown && shown.length === 0 && !missing && !error && <p className="text-sm text-muted-foreground">{t("Nothing to check.")}</p>}
    </div>
  );
}
