import { SizeGrid, StyleChips } from "@/components/visual-options";
import { useEffect, useState } from "react";
import { IconAlertTriangle as AlertTriangle, IconBan as Ban, IconCopy as Copy, IconMinus as Minus, IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Switch } from "@/components/ui/knowns/switch";
import { Select } from "@/components/ui/knowns/select";
import { Textarea } from "@/components/ui/knowns/textarea";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { ColorField } from "@/components/color-field";
import { Icon } from "@/components/icon";
import { ClockOptionsForm } from "@/components/clock-options";
import { AppPickerButton } from "@/components/app-picker";
import { QuotaOptionsForm } from "@/components/quota-options";
import { MetricOptionsForm } from "@/components/metric-options";
import { HotkeyField } from "@/components/hotkey-field";
import { MacroEditor } from "@/components/macro-editor";
import { AppVolumeFields, OutputDeviceFields } from "@/components/gaming-fields";
import { IconPicker } from "@/components/icon-picker";
import {
  ACTION_ICON, ACTION_SHORT, MEDIA_LABEL, MIC_LABEL, PROVIDER_LABEL, VOLUME_LABEL, WIDGET_LABEL, defaultAction,
} from "@/lib/layout";
import { cn } from "@/lib/utils";
import { shellExample, openExample, usePlatform } from "@/lib/platform";
import { t, useLanguage } from "@/lib/i18n";
import { VI } from "@/i18n/vi";
import { EntityPicker } from "@/components/entity-picker";
import { baseUrls, curlPush, useWebhook } from "@/lib/webhook";
import { api } from "@/api";
import { useHassServices } from "@/lib/hass";
import { Slider } from "@/components/ui/knowns/slider";
import { useSounds } from "@/lib/sounds";
import { ACTION_TYPES, AI_PROVIDERS, WIDGET_KINDS, METRIC_WIDGETS, type MetricWidget, type EntityOptions, type GeoPlace, type PushOptions, type WeatherOptions, type MacApp, type Action, type ActionType, type AiProvider, type Item, type Page, type WidgetKind } from "@/types";

export function ItemForm({ item, page, pages, accent, onChange, onDuplicate, onDelete, onResize, onWidgetKind }: {
  item: Item;
  page: Page;
  pages: Page[];
  /** Theme accent: the swatch colour for items with no colour of their own. */
  accent?: string;
  onChange: (next: Item) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Applies a new span; returns an error message when it does not fit. */
  onResize: (w: number, h: number) => string | null;
  /** Changes the widget kind and applies its default size. */
  onWidgetKind: (kind: WidgetKind) => void;
}) {
  useLanguage();
  const [sizeError, setSizeError] = useState<string | null>(null);
  useEffect(() => setSizeError(null), [item.id]);
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [item.id]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const set = (patch: Record<string, unknown>) => onChange({ ...item, ...patch } as Item);
  const idTaken = page.items.some((o) => o.id === item.id && o !== item);

  const setKind = (kind: string) => {
    if (kind === item.kind) return;
    const base = { id: item.id, w: item.w, h: item.h, color: item.color };
    const next = kind === "widget"
      ? { ...base, kind: "widget", widget: "clock" }
      : { ...base, kind: "button", label: t("New button"), action: defaultAction("open") };
    onChange(JSON.parse(JSON.stringify(next)) as Item);
  };

  const w = item.w ?? 1;
  const h = item.h ?? 1;
  const resize = (nw: number, nh: number) => setSizeError(onResize(nw, nh));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5">
        <SegmentedControl
          size="sm"
          aria-label={t("Tile type")}
          value={item.kind}
          onValueChange={setKind}
          options={[{ value: "button", label: t("Button") }, { value: "widget", label: "Widget" }]}
        />
        <span className="flex-1 text-xs tabular-nums text-muted-foreground" title={t("Position on the grid (column, row)")}>{t("Tile")} ({(item.x ?? 0) + 1}, {(item.y ?? 0) + 1})</span>
        <Button size="sm" variant="secondary" icon={<Copy />} onClick={onDuplicate} aria-label={t("Duplicate")} title={t("Duplicate")} />
        <Button size="sm" variant="destructive" icon={<Trash />} onClick={() => (armed ? onDelete() : setArmed(true))}>{armed ? t("Sure?") : t("Delete")}</Button>
      </div>

      <Section title={t("Display")}>
        {item.kind === "widget" ? (
          <>
            <Field label="Widget" id="f-widget">
              <Select id="f-widget" value={item.widget} onChange={(e) => onWidgetKind(e.target.value as WidgetKind)}
                options={WIDGET_KINDS.filter((w) => w !== "entity" || item.widget === "entity").map((w) => ({ value: w, label: t(WIDGET_LABEL[w] ?? w) }))} />
            </Field>
            {item.widget === "clock" && <ClockOptionsForm value={item.clock} onChange={(clock) => set({ clock })} />}
            {(METRIC_WIDGETS as readonly string[]).includes(item.widget) && (
              <MetricOptionsForm widget={item.widget as MetricWidget} value={item.metric} onChange={(metric) => set({ metric })} />
            )}
            {item.widget === "weather" && <WeatherForm value={item.weather} onChange={(weather) => set({ weather })} />}
            {item.widget === "value" && <ValueForm value={item.push} onChange={(push) => set({ push })} />}
            {item.widget === "entity" && <EntityForm value={item.entity} onChange={(entity) => set({ entity })} />}
            {item.widget === "quota" && <QuotaOptionsForm provider={item.provider ?? "claude"} value={item.quota} onChange={(quota) => set({ quota })} />}
            {item.widget === "quota" && (
              <Field label={t("AI tool")} id="f-provider" hint={t("Which tool's quota this tile shows.")}>
                <Select id="f-provider" value={item.provider ?? "claude"} onChange={(e) => set({ provider: e.target.value as AiProvider, quota: item.quota ? { ...item.quota, account: undefined } : undefined })}
                  options={AI_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] ?? p }))} />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={t("Button name")} id="f-label">
              <Input id="f-label" value={item.label} placeholder={t("E.g. Screenshot")} onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <Field label={t("Icon")} id="f-icon">
              <IconPicker value={item.icon} onChange={(v) => set({ icon: v })} />
            </Field>
          </>
        )}
        <Field label={t("Color")} id="f-color">
          <ColorField value={item.color} onChange={(v) => set({ color: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Width (tiles)")} id="f-w">
            <Stepper id="f-w" value={w} min={1} max={page.columns} onChange={(v) => resize(v, h)} />
          </Field>
          <Field label={t("Height (tiles)")} id="f-h">
            <Stepper id="f-h" value={h} min={1} max={page.rows} onChange={(v) => resize(w, v)} />
          </Field>
        </div>
        <SizeGrid w={w} h={h} maxW={page.columns} maxH={page.rows} onPick={resize} />
        {sizeError && <p role="alert" className="-mt-1.5 text-xs text-destructive">{sizeError}</p>}
        <p className="-mt-1.5 text-xs text-muted-foreground">{t("Drag a tile corner on the phone to resize, drag the tile to move it.")}</p>
      </Section>

      <Section title={t("Tile style")}>
        <Field label={t("Fill style")} id="f-style" hint={t("Soft, Solid and Outline use the item colour (or the theme accent).")}>
          <StyleChips label={t("Fill style")} value={item.style ?? ""} onChange={(v) => set({ style: v || undefined })} color={item.color ?? accent ?? "#22d3ee"} />
        </Field>
        <Field label={t("Text color")} id="f-text-color">
          <ColorField id="f-text-color" value={item.textColor} onChange={(v) => set({ textColor: v })} noneLabel={t("Follow theme")} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="f-hide" className="text-[13px] font-medium">{t("Hide label")} <span className="font-normal text-muted-foreground">{t("(show icon only)")}</span></label>
          <Switch id="f-hide" checked={!!item.hideLabel} onCheckedChange={(v) => set({ hideLabel: v || undefined })} aria-label={t("Hide label")} />
        </div>
      </Section>

      {item.kind === "button" && (
        <Section title={t("On press")}>
          <ActionFields
            action={item.action}
            pages={pages}
            onChange={(a) => set({ action: a })}
            onPickApp={(app) => {
              const patch: Record<string, unknown> = { action: { type: "open", target: `bundle:${app.bundleId}` } };
              if (!item.icon) patch.icon = `app:${app.bundleId}`;
              if (!item.label.trim() || item.label === "New button" || item.label === VI["New button"]) patch.label = app.name;
              set(patch);
            }}
          />
        </Section>
      )}

      <Field label={t("Tile ID")} id="f-id" hint={t("The phone sends this ID when pressed. Only change it if needed.")}
        error={!item.id ? t("ID cannot be empty") : idTaken ? t("ID already used on this screen") : undefined}>
        <Input id="f-id" value={item.id} onChange={(e) => set({ id: e.target.value })} />
      </Field>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(title)}</h3>
      {children}
    </section>
  );
}

function ActionFields({ action, pages, onChange, onPickApp }: { action: Action | undefined; pages: Page[]; onChange: (a: Action | undefined) => void; onPickApp: (app: MacApp) => void }) {
  useLanguage();
  const platform = usePlatform();
  const a = action;
  const patch = (p: Record<string, string>) => onChange({ ...a, ...p } as Action);
  return (
    <>
      <div role="radiogroup" aria-label={t("Action type")} className="grid grid-cols-4 gap-1.5">
        <ActionChip label={t("None")} selected={!a} onClick={() => onChange(undefined)} icon={<Ban className="size-[18px]" />} />
        {ACTION_TYPES.map((at: ActionType) => (
          <ActionChip key={at} label={t(ACTION_SHORT[at])} selected={a?.type === at} onClick={() => a?.type !== at && onChange(defaultAction(at, pages[0]?.id))} icon={<Icon name={ACTION_ICON[at]} size={18} />} />
        ))}
      </div>

      {a?.type === "open" && (
        <>
          <Field label={t("App")} id="f-app" hint={t("Pick an app installed on the computer.")}>
            <AppPickerButton target={a.target} onPick={onPickApp} />
          </Field>
          <Field label={t("Open what?")} id="f-open" hint={t("A web address, a file/folder path or an app name.")}>
            <Input id="f-open" value={a.target} placeholder={t(openExample(platform))} onChange={(e) => patch({ target: e.target.value })} />
          </Field>
        </>
      )}
      {a?.type === "hotkey" && (
        <>
          <HotkeyField value={a.keys} onChange={(keys) => onChange({ ...a, keys })} />
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="f-hold" className="text-[13px] font-medium">{t("Hold to press")} <span className="font-normal text-muted-foreground">{t("(push-to-talk)")}</span></label>
            <Switch id="f-hold" checked={!!a.hold} onCheckedChange={(v) => onChange(v ? { ...a, hold: true } : { type: "hotkey", keys: a.keys })} aria-label={t("Hold to press")} />
          </div>
          {a.hold && <span className="text-xs text-muted-foreground">{t("The keys stay down while your finger is on the button and come up when you lift it. They are released anyway if the phone locks, disconnects or after 2 minutes.")}</span>}
        </>
      )}
      {a?.type === "type" && (
        <Field label={t("Text to type")} id="f-text" hint={t("Typed into the field currently focused on the computer.")}>
          <Input id="f-text" value={a.text} placeholder={t("Text to type")} onChange={(e) => patch({ text: e.target.value })} />
        </Field>
      )}
      {a?.type === "shell" && (
        <>
          <Field label={t("Command")} id="f-cmd">
            <Input id="f-cmd" value={a.command} placeholder={t(shellExample(platform))} onChange={(e) => patch({ command: e.target.value })} />
          </Field>
          <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>
            {t("The command runs directly on this computer, with your permissions. Only enter commands you trust.")}
          </Alert>
        </>
      )}
      {a?.type === "media" && (
        <Field label={t("Music control")} id="f-media">
          <SegmentedControl aria-label={t("Music control")} value={a.command} onValueChange={(v) => patch({ command: v })}
            options={[
              { value: "previous", label: t("Previous") },
              { value: "playpause", label: t("Play/Pause") },
              { value: "next", label: t("Next") },
            ]} />
          <span className="text-xs text-muted-foreground">{t(MEDIA_LABEL[a.command])}</span>
        </Field>
      )}
      {a?.type === "volume" && (
        <Field label={t("Volume")} id="f-vol">
          <SegmentedControl aria-label={t("Volume")} value={a.command} onValueChange={(v) => patch({ command: v })}
            options={[
              { value: "down", label: t("Down") },
              { value: "mute", label: t("Mute") },
              { value: "up", label: t("Up") },
            ]} />
          <span className="text-xs text-muted-foreground">{t(VOLUME_LABEL[a.command])}</span>
        </Field>
      )}
      {a?.type === "set-volume" && (
        <>
          <Field label={t("Device")} id="f-setvol-dev">
            <SegmentedControl size="sm" aria-label={t("Device")} value={a.device ?? "output"} onValueChange={(v) => onChange(v === "mic" ? { type: "set-volume", level: a.level, device: "mic" } : { type: "set-volume", level: a.level })}
              options={[{ value: "output", label: t("Speakers / headphones") }, { value: "mic", label: t("Microphone") }]} />
          </Field>
          <Slider label={t("Level")} aria-label={t("Level")} min={0} max={100} step={5} value={a.level} onValueChange={(v) => onChange({ ...a, level: Math.round(v) })} formatValue={(v) => `${v}%`} />
          <span className="text-xs text-muted-foreground">{t("Sets this exact level each time you tap.")}</span>
        </>
      )}
      {a?.type === "mic" && (
        <Field label={t("Microphone")} id="f-mic">
          <SegmentedControl aria-label={t("Microphone")} value={a.command} onValueChange={(v) => onChange({ type: "mic", command: v as "mute" | "unmute" | "toggle" })}
            options={[
              { value: "toggle", label: t("Toggle") },
              { value: "mute", label: t("Mute") },
              { value: "unmute", label: t("Unmute") },
            ]} />
          <span className="text-xs text-muted-foreground">{t(MIC_LABEL[a.command])}. {t("The default microphone of the computer; the button turns red on the phone while it is muted.")}</span>
        </Field>
      )}
      {a?.type === "app-volume" && <AppVolumeFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "output-device" && <OutputDeviceFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "sound" && <SoundFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "sound-stop" && <p className="text-xs text-muted-foreground">{t("Press this button to stop all playing sounds (on the computer and the phone).")}</p>}
      {a?.type === "macro" && <MacroEditor steps={a.steps} pages={pages} onChange={(steps) => onChange({ type: "macro", steps })} />}
      {a?.type === "hass" && <HassFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "page" && (
        <Field label={t("Go to screen")} id="f-page" error={pages.some((p) => p.id === a.page) ? undefined : t("This screen no longer exists")}>
          <Select id="f-page" value={a.page} onChange={(e) => patch({ page: e.target.value })}
            options={[
              ...pages.map((p) => ({ value: p.id, label: `${p.name || p.id} (${p.id})` })),
              ...(pages.some((p) => p.id === a.page) ? [] : [{ value: a.page, label: t("{id} (does not exist)", { id: a.page }) }]),
            ]} />
        </Field>
      )}
    </>
  );
}

function ActionChip({ label, icon, selected, onClick }: { label: string; icon: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        selected && "border-primary/60 bg-primary/10 text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button size="md" variant="secondary" icon={<Minus />} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Decrease")} />
      <Input id={id} type="number" min={min} max={max} value={value} className="text-center"
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }} />
      <Button size="md" variant="secondary" icon={<Plus />} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("Increase")} />
    </div>
  );
}

function SoundFields({ action, onChange }: { action: Extract<Action, { type: "sound" }>; onChange: (a: Action) => void }) {
  useLanguage();
  const { sounds, error } = useSounds();
  const set = (p: Partial<Extract<Action, { type: "sound" }>>) => onChange({ ...action, ...p });
  const known = !action.sound || (sounds ?? []).some((s) => s.id === action.sound);
  return (
    <>
      <Field label={t("Sound clip")} id="f-snd" hint={error ? t("Could not load the sound library from the agent.") : t("Upload clips in the Sounds tab.")}
        error={sounds && !known ? t("This clip is no longer in the library") : sounds && sounds.length > 0 && !action.sound ? t("Choose a clip: the button cannot be saved without one.") : undefined}>
        <Select id="f-snd" value={action.sound} onChange={(e) => set({ sound: e.target.value })}
          options={[
            { value: "", label: sounds ? t("Choose a clip...") : t("Loading...") },
            ...(sounds ?? []).map((s) => ({ value: s.id, label: s.name })),
            ...(sounds && !known ? [{ value: action.sound, label: t("{id} (does not exist)", { id: action.sound }) }] : []),
          ]} />
      </Field>
      <Field label={t("Play on")} id="f-snd-on">
        <SegmentedControl size="sm" aria-label={t("Play on")} value={action.on ?? "mac"} onValueChange={(v) => set({ on: v as "mac" | "phone" | "both" })}
          options={[{ value: "mac", label: t("Computer") }, { value: "phone", label: t("Phone") }, { value: "both", label: t("Both") }]} />
      </Field>
      <Slider label={t("Volume")} aria-label={t("Clip volume")} min={0} max={100} step={5} value={action.volume ?? 100} onValueChange={(v) => set({ volume: v })} formatValue={(v) => `${v}%`} />
      <Field label={t("When pressed again")} id="f-snd-mode">
        <SegmentedControl size="sm" aria-label={t("When pressed again")} value={action.mode ?? "restart"} onValueChange={(v) => set({ mode: v as "overlap" | "restart" | "toggle" })}
          options={[{ value: "restart", label: t("Restart") }, { value: "overlap", label: t("Overlap") }, { value: "toggle", label: t("Stop") }]} />
      </Field>
    </>
  );
}

const DETAIL_DOMAINS = new Set(["climate", "light", "fan", "cover", "vacuum"]);

function EntityForm({ value, onChange }: { value: EntityOptions | undefined; onChange: (e: EntityOptions) => void }) {
  useLanguage();
  const v: EntityOptions = value ?? { id: "" };
  const set = (p: Partial<EntityOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (k !== "id" && (next[k] === undefined || next[k] === "")) delete next[k];
    onChange({ ...next, id: String(next.id ?? "") } as EntityOptions);
  };
  return (
    <>
      <Field label={t("Home Assistant entity")} id="f-ent" hint={t("Lights, switches, sensors... taken from the connected Home Assistant.")}>
        <EntityPicker value={v.id} onChange={(id) => set({ id })} />
      </Field>
      <Field label={t("Display name")} id="f-ent-name" hint={t("Leave empty to use the name from Home Assistant.")}>
        <Input id="f-ent-name" value={v.name ?? ""} maxLength={60} placeholder={t("E.g. Kitchen light")} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label={t("Display")} id="f-ent-show">
        <Select id="f-ent-show" value={v.show ?? "auto"} onChange={(e) => set({ show: e.target.value === "auto" ? undefined : (e.target.value as EntityOptions["show"]) })}
          options={[{ value: "auto", label: t("Automatic") }, { value: "toggle", label: t("Switch") }, { value: "state", label: t("State") }, { value: "value", label: t("Value") }]} />
      </Field>
      {DETAIL_DOMAINS.has(v.id.split(".")[0] ?? "") && (
        <>
          <Field label={t("On press")} id="f-ent-tap" hint={t("The control panel has all the adjustments (temperature, brightness, speed...).")}>
            <SegmentedControl size="sm" aria-label={t("On press")} value={v.tap ?? "sheet"} onValueChange={(x) => set({ tap: x === "sheet" ? undefined : (x as "sheet" | "toggle") })}
              options={[{ value: "sheet", label: t("Open control panel") }, { value: "toggle", label: t("On / off") }]} />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="f-ent-inline" className="text-[13px]">{t("Show controls on the tile")}</label>
            <Switch id="f-ent-inline" checked={!!v.inlineControls} onCheckedChange={(inlineControls) => set({ inlineControls: inlineControls || undefined })} aria-label={t("Show controls on the tile")} />
          </div>
          <p className="-mt-2 text-[11.5px] text-muted-foreground">{t("Only shown when the tile is big enough (2×1 or larger).")}</p>
        </>
      )}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="f-ent-ro" className="text-[13px]">{t("View only (pressing does not control)")}</label>
        <Switch id="f-ent-ro" checked={!!v.readOnly} onCheckedChange={(readOnly) => set({ readOnly: readOnly || undefined })} aria-label={t("View only")} />
      </div>
    </>
  );
}

function HassFields({ action, onChange }: { action: Extract<Action, { type: "hass" }>; onChange: (a: Action) => void }) {
  useLanguage();
  const { data: services, missing } = useHassServices();
  const [raw, setRaw] = useState(() => (action.data ? JSON.stringify(action.data, null, 2) : ""));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const set = (p: Partial<Extract<Action, { type: "hass" }>>) => {
    const next = { ...action, ...p };
    if (!next.entityId) delete next.entityId;
    onChange(next);
  };
  const known = !action.service || !services || services.some((s) => s.id === action.service);
  const svc = services?.find((s) => s.id === action.service);
  const setData = (text: string) => {
    setRaw(text);
    if (!text.trim()) {
      setJsonErr(null);
      const { data: _d, ...rest } = action;
      return onChange(rest);
    }
    if (text.length > 2048) return setJsonErr(t("Data is larger than 2 KB."));
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setJsonErr(t("Must be a JSON object, for example {\"brightness\": 120}."));
      setJsonErr(null);
      set({ data: parsed as Record<string, unknown> });
    } catch {
      setJsonErr(t("Invalid JSON."));
    }
  };
  return (
    <>
      <Field label={t("Service")} id="f-svc" hint={svc?.description ?? (missing ? t("Home Assistant is not connected: type it as domain.service.") : t("Example: light.toggle, scene.turn_on"))}
        error={!known ? t("This service is not in Home Assistant") : undefined}>
        {services && services.length > 0 ? (
          <Select id="f-svc" value={action.service} onChange={(e) => set({ service: e.target.value })}
            options={[{ value: "", label: t("Choose a service...") }, ...services.map((s) => ({ value: s.id, label: s.name ? `${s.id} · ${s.name}` : s.id })), ...(known ? [] : [{ value: action.service, label: t("{id} (does not exist)", { id: action.service }) }])]} />
        ) : (
          <Input id="f-svc" value={action.service} placeholder="light.toggle" onChange={(e) => set({ service: e.target.value.trim() })} />
        )}
      </Field>
      <Field label={t("Entity (optional)")} id="f-svc-ent" hint={t("The entity the service acts on.")}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1"><EntityPicker value={action.entityId ?? ""} onChange={(entityId) => set({ entityId })} /></div>
          {action.entityId && <Button size="sm" variant="secondary" onClick={() => set({ entityId: undefined })}>{t("Clear")}</Button>}
        </div>
      </Field>
      <Field label={t("JSON data (optional)")} id="f-svc-data" hint={t("Extra parameters for the service, up to 2 KB.")} error={jsonErr ?? undefined}>
        <Textarea id="f-svc-data" rows={4} value={raw} placeholder={'{"brightness": 120}'} className="font-mono text-xs" onChange={(e) => setData(e.target.value)} />
      </Field>
    </>
  );
}

function WeatherForm({ value, onChange }: { value: WeatherOptions | undefined; onChange: (w: WeatherOptions) => void }) {
  useLanguage();
  const v = value ?? {};
  const set = (p: Partial<WeatherOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange(next as WeatherOptions);
  };
  const source = v.source ?? "auto";
  return (
    <>
      <Field label={t("Source")} id="f-w-src" hint={t("Automatic: uses Home Assistant when connected, otherwise Open-Meteo (no key needed).")}>
        <SegmentedControl size="sm" aria-label={t("Weather source")} value={source} onValueChange={(x) => set({ source: x as WeatherOptions["source"] })}
          options={[{ value: "auto", label: t("Automatic") }, { value: "hass", label: "Home Assistant" }, { value: "open-meteo", label: "Open-Meteo" }]} />
      </Field>
      {source !== "open-meteo" && (
        <Field label={t("Weather entity (Home Assistant)")} id="f-w-ent">
          <EntityPicker value={v.entity ?? ""} domain="weather" onChange={(entity) => set({ entity })} />
        </Field>
      )}
      {source !== "hass" && <CityField place={v.location} onChange={(location) => set({ location })} />}
      <Field label={t("Display")} id="f-w-show">
        <Select id="f-w-show" value={v.show ?? "auto"} onChange={(e) => set({ show: e.target.value as WeatherOptions["show"] })}
          options={[{ value: "auto", label: t("Automatic by tile size") }, { value: "now", label: t("Now") }, { value: "hourly", label: t("Hourly") }, { value: "daily", label: t("Daily") }]} />
      </Field>
      <Field label={t("Unit")} id="f-w-units">
        <Select id="f-w-units" value={v.units ?? ""} onChange={(e) => set({ units: (e.target.value || undefined) as WeatherOptions["units"] })}
          options={[{ value: "", label: t("Use the theme unit") }, { value: "metric", label: "°C, km/h" }, { value: "imperial", label: "°F, mph" }]} />
      </Field>
    </>
  );
}

function CityField({ place, onChange }: { place: WeatherOptions["location"]; onChange: (p: { name: string; lat: number; lon: number } | undefined) => void }) {
  useLanguage();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<GeoPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setFound(await api.geocode(q.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={t("City")} id="f-w-city" hint={place ? t("In use: {name} ({lat}, {lon}). Only the coordinates are sent to Open-Meteo.", { name: place.name, lat: place.lat.toFixed(2), lon: place.lon.toFixed(2) }) : t("Search for a city name to get its coordinates.")} error={err ?? undefined}>
      <div className="flex gap-2">
        <Input id="f-w-city" value={q} placeholder={t("London, Tokyo...")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
        <Button variant="secondary" loading={busy} onClick={() => void search()}>{t("Search")}</Button>
        {place && <Button variant="secondary" onClick={() => onChange(undefined)}>{t("Clear")}</Button>}
      </div>
      {found && (found.length === 0 ? <p className="text-xs text-muted-foreground">{t("No city found.")}</p> : (
        <ul className="flex flex-col rounded-lg border">
          {found.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button type="button" className="flex w-full flex-col px-2.5 py-1.5 text-left hover:bg-muted" onClick={() => { onChange({ name: p.name, lat: p.lat, lon: p.lon }); setFound(null); setQ(""); }}>
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="text-[11.5px] text-muted-foreground">{[p.detail, `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Field>
  );
}

function ValueForm({ value, onChange }: { value: PushOptions | undefined; onChange: (p: PushOptions) => void }) {
  const v: PushOptions = value ?? { key: "" };
  useLanguage();
  const { info } = useWebhook();
  const set = (p: Partial<PushOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (k !== "key" && (next[k] === undefined || next[k] === "")) delete next[k];
    onChange(next as unknown as PushOptions);
  };
  const keyOk = /^[a-z0-9][a-z0-9_.-]{0,47}$/.test(v.key);
  const cmd = curlPush(baseUrls(info)[0]!, keyOk ? v.key : t("<key>"));
  return (
    <>
      <Field label={t("Key")} id="f-push-key" hint={t("Lowercase letters, digits, _ . - (up to 48). This is the last part of the webhook path.")} error={keyOk ? undefined : t("Invalid key")}>
        <Input id="f-push-key" value={v.key} maxLength={48} placeholder={t("room-temperature")} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
      </Field>
      <Field label={t("Label")} id="f-push-label"><Input id="f-push-label" value={v.label ?? ""} maxLength={40} placeholder={t("Room temperature")} onChange={(e) => set({ label: e.target.value })} /></Field>
      <Field label={t("Unit")} id="f-push-unit"><Input id="f-push-unit" value={v.unit ?? ""} maxLength={12} placeholder="°C" onChange={(e) => set({ unit: e.target.value })} /></Field>
      <Field label={t("Test command (curl)")} id="f-push-curl" hint={t("Set WEBHOOK_KEY to the key from Integrations > Webhook.")}>
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-muted px-2.5 py-1.5 text-[11.5px]">{cmd}</code>
          <Button size="xs" variant="secondary" aria-label={t("Copy command")} icon={<Copy />} onClick={() => void navigator.clipboard?.writeText(cmd)} />
        </div>
      </Field>
    </>
  );
}
