import { useId } from "react";
import { IconArrowDown as ArrowDown, IconArrowUp as ArrowUp, IconRefresh as Refresh, IconX as X } from "@tabler/icons-react";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Select } from "@/components/ui/knowns/select";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Slider } from "@/components/ui/knowns/slider";
import { api } from "@/api";
import { appChoices, useLoad } from "@/lib/gaming";
import { APP_VOLUME_LABEL } from "@/lib/layout";
import { t, useLanguage } from "@/lib/i18n";
import { APP_NAME_RE, OUTPUT_DEVICES_MAX, type Action, type AppVolumeCommand } from "@/types";

/** Process-name input with suggestions from the programs running now (and the ones playing sound when `sessions`). */
export function AppNameField({ id, label, value, hint, sessions, onChange }: { id: string; label: string; value: string; hint?: string; sessions?: boolean; onChange: (v: string) => void }) {
  useLanguage();
  const listId = useId();
  const running = useLoad(() => api.getRunningApps());
  const audio = useLoad(() => (sessions ? api.getAudioSessions() : Promise.resolve({ supported: true, sessions: [] })), [sessions]);
  const names = appChoices(audio.data?.sessions.map((s) => s.app) ?? [], running.data?.foreground ? [running.data.foreground] : [], running.data?.running ?? []);
  const bad = value.trim() !== "" && !APP_NAME_RE.test(value.trim());
  return (
    <Field label={label} id={id} hint={hint ?? t("The process name, as in Task Manager → Details (e.g. cs2.exe, Discord.exe). Not case sensitive; .exe is optional.")}
      error={bad ? t("Only letters, digits, spaces and . _ ( ) + & ' - (at most 64).") : !value.trim() ? t("Type the program's process name (e.g. cs2.exe).") : undefined}>
      <div className="flex items-center gap-1.5">
        <Input id={id} list={listId} value={value} maxLength={64} placeholder="cs2.exe" onChange={(e) => onChange(e.target.value)} />
        <Button size="md" variant="secondary" icon={<Refresh />} aria-label={t("Refresh the program list")} onClick={() => { running.reload(); audio.reload(); }} />
      </div>
      <datalist id={listId}>{names.slice(0, 300).map((n) => <option key={n} value={n} />)}</datalist>
    </Field>
  );
}

type AppVolume = Extract<Action, { type: "app-volume" }>;
export function AppVolumeFields({ action: a, onChange }: { action: AppVolume; onChange: (a: Action) => void }) {
  useLanguage();
  const set = (p: Partial<AppVolume>) => {
    const next: AppVolume = { ...a, ...p };
    // keep only the field the command uses
    if (next.command === "set") { next.level ??= 50; delete next.step; }
    else if (next.command === "up" || next.command === "down") { next.step ??= 10; delete next.level; }
    else { delete next.level; delete next.step; }
    onChange(next);
  };
  const cmds: AppVolumeCommand[] = ["down", "up", "set", "mute", "unmute", "toggle-mute"];
  return (
    <>
      <AppNameField id="f-appvol-app" label={t("Program")} value={a.app} sessions onChange={(app) => set({ app })}
        hint={t("The program as it appears in the Windows volume mixer: start it and let it play sound, then pick it from the list.")} />
      <Field label={t("What to do")} id="f-appvol-cmd">
        <Select id="f-appvol-cmd" value={a.command} onChange={(e) => set({ command: e.target.value as AppVolumeCommand })}
          options={cmds.map((c) => ({ value: c, label: t(APP_VOLUME_LABEL[c] ?? c) }))} />
      </Field>
      {a.command === "set" && (
        <Slider label={t("Level")} aria-label={t("Level")} min={0} max={100} step={5} value={a.level ?? 50} onValueChange={(v) => set({ level: Math.round(v) })} formatValue={(v) => `${v}%`} />
      )}
      {(a.command === "up" || a.command === "down") && (
        <Slider label={t("Step")} aria-label={t("Step")} min={1} max={50} step={1} value={a.step ?? 10} onValueChange={(v) => set({ step: Math.round(v) })} formatValue={(v) => `${v}%`} />
      )}
      <span className="text-xs text-muted-foreground">{t("Windows only. Changes that program's own slider in the volume mixer, not the main volume.")}</span>
    </>
  );
}

type OutputDevice = Extract<Action, { type: "output-device" }>;
export function OutputDeviceFields({ action: a, onChange }: { action: OutputDevice; onChange: (a: Action) => void }) {
  useLanguage();
  const flow = a.flow ?? "output";
  const list = useLoad(() => api.getAudioDevices(flow), [flow]);
  const devices = list.data?.devices ?? [];
  const nameOf = (v: string) => devices.find((d) => d.id === v)?.name ?? v;
  const set = (devs: string[]) => onChange({ ...a, devices: devs });
  const move = (i: number, j: number) => {
    if (j < 0 || j >= a.devices.length) return;
    const n = a.devices.slice();
    const [x] = n.splice(i, 1);
    n.splice(j, 0, x!);
    set(n);
  };
  const free = devices.filter((d) => !a.devices.includes(d.id) && !a.devices.includes(d.name));
  return (
    <>
      <Field label={t("Device type")} id="f-outdev-flow">
        <SegmentedControl size="sm" aria-label={t("Device type")} value={flow} onValueChange={(v) => onChange(v === "input" ? { type: "output-device", devices: [], flow: "input" } : { type: "output-device", devices: [] })}
          options={[{ value: "output", label: t("Speakers / headphones") }, { value: "input", label: t("Microphone") }]} />
      </Field>
      <Field label={t("Devices ({n}/{max})", { n: a.devices.length, max: OUTPUT_DEVICES_MAX })} id="f-outdev-add"
        hint={list.data && !list.data.supported ? t("Only on Windows. This computer cannot switch audio devices.") : list.error ? t("Could not load the device list from the agent.") : t("One device: the button always switches to it. Several: each tap moves to the next one.")}
        error={a.devices.length === 0 ? t("Choose at least one device.") : undefined}>
        <div className="flex items-center gap-1.5">
          <Select id="f-outdev-add" value="" disabled={a.devices.length >= OUTPUT_DEVICES_MAX || free.length === 0}
            onChange={(e) => { if (e.target.value) set([...a.devices, e.target.value]); }}
            options={[{ value: "", label: list.data ? (free.length ? t("Add a device…") : t("No other devices")) : t("Loading...") }, ...free.map((d) => ({ value: d.id, label: d.name + (d.isDefault ? ` (${t("current")})` : "") }))]} />
          <Button size="md" variant="secondary" icon={<Refresh />} aria-label={t("Refresh the device list")} onClick={list.reload} />
        </div>
      </Field>
      {a.devices.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {a.devices.map((v, i) => (
            <li key={v} className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[13px]">
              <span className="text-[11px] tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="flex-1 truncate" title={v}>{nameOf(v)}{list.data && !devices.some((d) => d.id === v || d.name === v) ? ` · ${t("not connected")}` : ""}</span>
              <Button size="xs" variant="secondary" icon={<ArrowUp />} aria-label={t("Move up")} disabled={i === 0} onClick={() => move(i, i - 1)} />
              <Button size="xs" variant="secondary" icon={<ArrowDown />} aria-label={t("Move down")} disabled={i === a.devices.length - 1} onClick={() => move(i, i + 1)} />
              <Button size="xs" variant="secondary" icon={<X />} aria-label={t("Remove")} onClick={() => set(a.devices.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
