import { useRef, useState } from "react";
import { IconArrowDown as ArrowDown, IconArrowUp as ArrowUp, IconGripVertical as Grip, IconPlus as Plus, IconTrash as Trash, IconAlertTriangle as Warn } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Input } from "@/components/ui/knowns/input";
import { Popover } from "@/components/ui/knowns/popover";
import { Select } from "@/components/ui/knowns/select";
import { Textarea } from "@/components/ui/knowns/textarea";
import { EntityPicker } from "@/components/entity-picker";
import { HotkeyField } from "@/components/hotkey-field";
import { ItemRefPicker } from "@/components/item-ref-picker";
import { useHassServices } from "@/lib/hass";
import { useSounds } from "@/lib/sounds";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Slider } from "@/components/ui/knowns/slider";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MACRO_MAX_STEPS, MACRO_MAX_WAIT_MS, type MacroStep, type Page } from "@/types";

type Kind = MacroStep["kind"];
const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "hotkey", label: "Hotkey", hint: "Press a key combination" },
  { kind: "type", label: "Type text", hint: "Type a piece of text" },
  { kind: "wait", label: "Wait", hint: "Pause a moment, then continue" },
  { kind: "open", label: "Open", hint: "Web address, file or app" },
  { kind: "shell", label: "Shell command", hint: "Run a command on the computer" },
  { kind: "media", label: "Media", hint: "Play / pause, previous, next" },
  { kind: "volume", label: "Volume", hint: "Up, down, mute" },
  { kind: "hass", label: "Home Assistant", hint: "Call a Home Assistant service" },
  { kind: "item", label: "Press another button", hint: "Run the action of an existing button" },
  { kind: "notify", label: "Notification", hint: "Show a notification on the phone" },
  { kind: "sound", label: "Play sound", hint: "Play a clip from the Sounds tab" },
  { kind: "page", label: "Switch screen", hint: "Show another screen on the phone" },
];
const LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<Kind, string>;

export function newStep(kind: Kind, pages: Page[] = []): MacroStep {
  switch (kind) {
    case "hotkey": return { kind, keys: "" };
    case "type": return { kind, text: "" };
    case "wait": return { kind, ms: 500 };
    case "open": return { kind, target: "" };
    case "shell": return { kind, command: "" };
    case "media": return { kind, command: "playpause" };
    case "volume": return { kind, command: "up" };
    case "hass": return { kind, service: "" };
    case "item": return { kind, pageId: pages[0]?.id ?? "", itemId: "" };
    case "notify": return { kind, text: "" };
    case "sound": return { kind, sound: "", on: "mac", volume: 100 };
    case "page": return { kind, pageId: pages[0]?.id ?? "" };
  }
}

/** Problems with a step list, in the UI language; the agent enforces the same limits. */
export function macroProblems(steps: MacroStep[], pages?: Page[]): { general: string[]; byStep: Record<number, string> } {
  const general: string[] = [];
  const byStep: Record<number, string> = {};
  if (steps.length === 0) general.push(t("Macro needs at least one step."));
  if (steps.length > MACRO_MAX_STEPS) general.push(t("At most {max} steps (currently {n}).", { max: MACRO_MAX_STEPS, n: steps.length }));
  const wait = steps.reduce((t, s) => t + (s.kind === "wait" ? s.ms : 0), 0);
  if (wait > MACRO_MAX_WAIT_MS) general.push(t("Total wait time is at most 30 seconds (currently {sec} seconds).", { sec: (wait / 1000).toFixed(1) }));
  steps.forEach((s, i) => {
    if (s.kind === "wait" && (s.ms < 0 || s.ms > 10000)) byStep[i] = t("Each wait is at most 10 seconds.");
    else if (s.kind === "hotkey" && !s.keys.trim()) byStep[i] = t("No key combination selected.");
    else if (s.kind === "type" && !s.text) byStep[i] = t("No text to type.");
    else if (s.kind === "open" && !s.target.trim()) byStep[i] = t("Nothing to open entered.");
    else if (s.kind === "shell" && !s.command.trim()) byStep[i] = t("No command entered.");
    else if (s.kind === "hass" && !/^[a-z_]+\.[a-z0-9_]+$/.test(s.service)) byStep[i] = t("Service must look like domain.service.");
    else if (s.kind === "item" && (!s.pageId || !s.itemId)) byStep[i] = t("No button selected.");
    else if (s.kind === "notify" && !s.text.trim()) byStep[i] = t("No notification text entered.");
    else if (s.kind === "sound" && !/^snd:[0-9a-f]{16}$/.test(s.sound)) byStep[i] = t("No sound clip selected.");
    else if (s.kind === "page" && (!s.pageId || (pages && !pages.some((p) => p.id === s.pageId)))) byStep[i] = t("This screen no longer exists");
  });
  return { general, byStep };
}

/** Sortable list of macro steps (drag the handle, or use the arrows). */
export function MacroEditor({ steps, pages, onChange }: { steps: MacroStep[]; pages: Page[]; onChange: (s: MacroStep[]) => void }) {
  const [menu, setMenu] = useState(false);
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const grip = useRef(false);
  const { general, byStep } = macroProblems(steps, pages);
  const set = (i: number, s: MacroStep) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, j: number) => {
    if (j < 0 || j >= steps.length || i === j) return;
    const next = steps.slice();
    const [it] = next.splice(i, 1);
    next.splice(j, 0, it!);
    onChange(next);
  };
  const full = steps.length >= MACRO_MAX_STEPS;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{t("Steps ({n}/{max})", { n: steps.length, max: MACRO_MAX_STEPS })}</span>
        <Popover open={menu} onOpenChange={setMenu} align="end" aria-label={t("Add step")} className="w-[260px] p-1.5"
          trigger={<Button size="xs" variant="secondary" icon={<Plus />} disabled={full} onClick={() => setMenu((o) => !o)}>{t("Add step")}</Button>}>
          <ul className="flex flex-col">
            {KINDS.map((k) => (
              <li key={k.kind}>
                <button type="button" onClick={() => { setMenu(false); onChange([...steps, newStep(k.kind, pages)]); }} className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-muted">
                  <span className="text-[13px] font-medium">{t(k.label)}</span>
                  <span className="text-[11.5px] text-muted-foreground">{t(k.hint)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      </div>
      {general.map((g) => <Alert key={g} tone="danger">{g}</Alert>)}
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li
            key={i}
            draggable
            onDragStart={(e) => { if (!grip.current) return e.preventDefault(); e.dataTransfer.effectAllowed = "move"; setFrom(i); }}
            onDragOver={(e) => { if (from !== null) { e.preventDefault(); setOver(i); } }}
            onDrop={(e) => { e.preventDefault(); if (from !== null) move(from, i); setFrom(null); setOver(null); }}
            onDragEnd={() => { grip.current = false; setFrom(null); setOver(null); }}
            className={cn("rounded-xl border bg-card p-2.5", over === i && from !== i && "border-primary", from === i && "opacity-50", byStep[i] && "border-destructive/50")}
          >
            <div className="flex items-center gap-1.5">
              <span role="img" aria-label={t("Drag to reorder")} title={t("Drag to reorder")} onPointerDown={() => { grip.current = true; }} onPointerUp={() => { grip.current = false; }} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"><Grip className="size-4" /></span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="flex-1 text-[13px] font-medium">{t(LABEL[s.kind])}</span>
              <Button size="xs" variant="secondary" aria-label={t("Move up")} icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, i - 1)} />
              <Button size="xs" variant="secondary" aria-label={t("Move down")} icon={<ArrowDown />} disabled={i === steps.length - 1} onClick={() => move(i, i + 1)} />
              <Button size="xs" variant="secondary" aria-label={t("Delete step")} icon={<Trash />} onClick={() => onChange(steps.filter((_, j) => j !== i))} />
            </div>
            <div className="mt-2 flex flex-col gap-2"><StepFields i={i} step={s} pages={pages} onChange={(n) => set(i, n)} /></div>
            {byStep[i] && <p className="mt-1.5 text-[12px] text-destructive">{byStep[i]}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepFields({ i, step: s, pages, onChange }: { i: number; step: MacroStep; pages: Page[]; onChange: (s: MacroStep) => void }) {
  const { data: services } = useHassServices();
  switch (s.kind) {
    case "hotkey": return <HotkeyField id={`ms-${i}-keys`} label={t("Key combination")} value={s.keys} onChange={(keys) => onChange({ ...s, keys })} />;
    case "type": return <Textarea rows={2} aria-label={t("Text to type")} value={s.text} maxLength={2000} placeholder={t("Text content to type")} onChange={(e) => onChange({ ...s, text: e.target.value })} />;
    case "wait": return (
      <div className="flex items-center gap-2">
        <Input size="sm" type="number" aria-label={t("Wait time (seconds)")} min={0} max={10} step={0.1} value={s.ms / 1000} className="w-24"
          onChange={(e) => onChange({ ...s, ms: Math.round(Number(e.target.value) * 1000) || 0 })} />
        <span className="text-xs text-muted-foreground">{t("seconds (max 10, total max 30)")}</span>
      </div>
    );
    case "open": return <Input size="sm" aria-label={t("What to open")} value={s.target} placeholder={t("https://… or app name")} onChange={(e) => onChange({ ...s, target: e.target.value })} />;
    case "shell": return (
      <>
        <Input size="sm" aria-label={t("Shell command")} value={s.command} placeholder={t("e.g. open -a Calculator")} onChange={(e) => onChange({ ...s, command: e.target.value })} />
        <p className="flex items-center gap-1.5 text-[11.5px] text-amber-500"><Warn className="size-3.5" /> {t("Runs directly on this computer with your permissions.")}</p>
      </>
    );
    case "media": return <Select size="sm" aria-label={t("Media control")} value={s.command} onChange={(e) => onChange({ ...s, command: e.target.value as typeof s.command })} options={[{ value: "playpause", label: t("Play / Pause") }, { value: "next", label: t("Next track") }, { value: "previous", label: t("Previous track") }]} />;
    case "volume": return <Select size="sm" aria-label={t("Volume")} value={s.command} onChange={(e) => onChange({ ...s, command: e.target.value as typeof s.command })} options={[{ value: "up", label: t("Increase") }, { value: "down", label: t("Decrease") }, { value: "mute", label: t("Mute") }]} />;
    case "hass": return (
      <>
        {services && services.length > 0 ? (
          <Select size="sm" aria-label={t("Service")} value={s.service} onChange={(e) => onChange({ ...s, service: e.target.value })}
            options={[{ value: "", label: t("Choose a service…") }, ...services.map((x) => ({ value: x.id, label: x.id })), ...(s.service && !services.some((x) => x.id === s.service) ? [{ value: s.service, label: t("{id} (does not exist)", { id: s.service }) }] : [])]} />
        ) : (
          <Input size="sm" aria-label={t("Service")} value={s.service} placeholder="light.toggle" onChange={(e) => onChange({ ...s, service: e.target.value.trim() })} />
        )}
        <EntityPicker value={s.entityId ?? ""} onChange={(entityId) => onChange({ ...s, entityId })} />
      </>
    );
    case "item": return <ItemRefPicker pages={pages} pageId={s.pageId} itemId={s.itemId} idPrefix={`ms-${i}`} onChange={(pageId, itemId) => onChange({ ...s, pageId, itemId })} />;
    case "sound": return <SoundStep step={s} onChange={onChange} />;
    case "page": return (
      <Select size="sm" aria-label={t("Go to screen")} value={s.pageId} onChange={(e) => onChange({ ...s, pageId: e.target.value })}
        options={[...pages.map((p) => ({ value: p.id, label: `${p.name || p.id} (${p.id})` })), ...(pages.some((p) => p.id === s.pageId) ? [] : [{ value: s.pageId, label: t("{id} (does not exist)", { id: s.pageId || "…" }) }])]} />
    );
    case "notify": return <Input size="sm" aria-label={t("Notification text")} value={s.text} maxLength={200} placeholder={t("Notification text")} onChange={(e) => onChange({ ...s, text: e.target.value })} />;
  }
}

function SoundStep({ step: s, onChange }: { step: Extract<MacroStep, { kind: "sound" }>; onChange: (s: MacroStep) => void }) {
  const { sounds } = useSounds();
  const known = !s.sound || (sounds ?? []).some((x) => x.id === s.sound);
  return (
    <>
      <Select size="sm" aria-label={t("Sound clip")} value={s.sound} onChange={(e) => onChange({ ...s, sound: e.target.value })}
        options={[
          { value: "", label: sounds ? t("Choose a clip...") : t("Loading...") },
          ...(sounds ?? []).map((x) => ({ value: x.id, label: x.name })),
          ...(sounds && !known ? [{ value: s.sound, label: t("{id} (does not exist)", { id: s.sound }) }] : []),
        ]} />
      <SegmentedControl size="sm" aria-label={t("Play on")} value={s.on ?? "mac"} onValueChange={(v) => onChange({ ...s, on: v as "mac" | "phone" | "both" })}
        options={[{ value: "mac", label: t("Computer") }, { value: "phone", label: t("Phone") }, { value: "both", label: t("Both") }]} />
      <Slider label={t("Volume")} aria-label={t("Clip volume")} min={0} max={100} step={5} value={s.volume ?? 100} onValueChange={(v) => onChange({ ...s, volume: v })} formatValue={(v) => `${v}%`} />
    </>
  );
}
