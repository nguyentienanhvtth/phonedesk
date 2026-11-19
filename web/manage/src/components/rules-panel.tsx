import { useState } from "react";
import { IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Card } from "@/components/ui/knowns/card";
import { Empty } from "@/components/ui/knowns/empty";
import { Field, Input } from "@/components/ui/knowns/input";
import { Popover } from "@/components/ui/knowns/popover";
import { Select } from "@/components/ui/knowns/select";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Switch } from "@/components/ui/knowns/switch";
import { EntityPicker } from "@/components/entity-picker";
import { ItemRefPicker } from "@/components/item-ref-picker";
import { AppNameField } from "@/components/gaming-fields";
import { DAY_LABEL, RULE_TEMPLATES, THEN_KINDS, THEN_LABEL, WHEN_KINDS, WHEN_LABEL, newThen, newWhen, ruleIdFor, ruleProblems, thenSummary, whenSummary } from "@/lib/rules";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RULES_MAX, type Layout, type Page, type Rule, type RuleThen, type RuleWhen } from "@/types";

/** "Automation" tab: "When … then …" rules. */
export function RulesPanel({ layout, update }: { layout: Layout; update: (fn: (l: Layout) => Layout) => void }) {
  const rules = layout.rules ?? [];
  const [sel, setSel] = useState<string | null>(rules[0]?.id ?? null);
  const [menu, setMenu] = useState(false);
  const rule = rules.find((r) => r.id === sel) ?? null;

  const setRules = (fn: (r: Rule[]) => Rule[]) => update((l) => {
    const next = fn(l.rules ?? []);
    const { rules: _drop, ...rest } = l;
    return next.length ? { ...rest, rules: next } : rest;
  });
  const patch = (id: string, p: Partial<Rule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = (r: Omit<Rule, "id">) => {
    const id = ruleIdFor(layout);
    setRules((rs) => [...rs, { id, ...r }]);
    setSel(id);
    setMenu(false);
  };
  const full = rules.length >= RULES_MAX;

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="kn-scroll-auto flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Rules · {n}/{max}", { n: rules.length, max: RULES_MAX })}</h2>
          <Popover open={menu} onOpenChange={setMenu} align="end" aria-label={t("Add rule")} className="w-[320px] p-1.5"
            trigger={<Button size="xs" variant="secondary" icon={<Plus />} disabled={full} onClick={() => setMenu((o) => !o)}>{t("Add")}</Button>}>
            <ul className="flex flex-col">
              {RULE_TEMPLATES.map((tpl) => (
                <li key={tpl.key}>
                  <button type="button" onClick={() => add(tpl.make(layout.pages))} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-muted">{t(tpl.label)}</button>
                </li>
              ))}
              <li className="mt-1 border-t pt-1">
                <button type="button" onClick={() => add({ name: t("New rule"), enabled: true, when: newWhen("idle"), then: [newThen("notify", layout.pages)] })} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-muted">{t("Empty rule…")}</button>
              </li>
            </ul>
          </Popover>
        </div>
        {rules.length === 0 ? (
          <Empty size="sm" title={t("No rules yet")} description={t("Click Add and pick a ready-made template, for example “AI needs you → AI page”.")} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rules.map((r) => {
              const bad = ruleProblems(r, layout.pages).length > 0;
              return (
                <li key={r.id} className={cn("flex items-center gap-2 rounded-xl border p-2", sel === r.id && "border-primary/60 bg-primary/5")}>
                  <button type="button" onClick={() => setSel(r.id)} className="min-w-0 flex-1 text-left">
                    <span className={cn("block truncate text-[13px] font-medium", !r.enabled && "text-muted-foreground")}>{r.name || t("(unnamed)")}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">{whenSummary(r.when)} → {r.then.map((th) => thenSummary(th, layout.pages)).join(", ")}</span>
                    {bad && <span className="block text-[11.5px] text-destructive">{t("Fix before saving")}</span>}
                  </button>
                  <Switch checked={r.enabled} onCheckedChange={(enabled) => patch(r.id, { enabled })} aria-label={t("Enable {name}", { name: r.name })} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="kn-scroll-auto min-h-0 overflow-y-auto p-4">
        {rule ? (
          <RuleEditor key={rule.id} rule={rule} pages={layout.pages} onChange={(p) => patch(rule.id, p)}
            onDelete={() => { setRules((rs) => rs.filter((r) => r.id !== rule.id)); setSel(rules.find((r) => r.id !== rule.id)?.id ?? null); }} />
        ) : (
          <Empty size="sm" title={t("Select a rule to edit")} description={t("A rule runs when its condition goes from false to true, then rests for 60 seconds.")} />
        )}
      </Card>
    </div>
  );
}

function RuleEditor({ rule, pages, onChange, onDelete }: { rule: Rule; pages: Page[]; onChange: (p: Partial<Rule>) => void; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  const problems = ruleProblems(rule, pages);
  const hasGoto = rule.then.some((th) => th.kind === "goto-page");
  const setThen = (i: number, th: RuleThen) => onChange({ then: rule.then.map((x, j) => (j === i ? th : x)) });
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1"><Field label={t("Rule name")} id="r-name"><Input id="r-name" value={rule.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} /></Field></div>
        <Button variant="destructive" icon={<Trash />} onClick={() => (armed ? onDelete() : setArmed(true))}>{armed ? t("Are you sure?") : t("Delete")}</Button>
      </div>
      {problems.length > 0 && <Alert tone="danger"><ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("When")}</h3>
        <Select aria-label={t("Condition")} value={rule.when.kind} onChange={(e) => onChange({ when: newWhen(e.target.value as RuleWhen["kind"]) })} options={WHEN_KINDS.map((k) => ({ value: k, label: t(WHEN_LABEL[k]) }))} />
        <WhenFields when={rule.when} onChange={(when) => onChange({ when })} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Then ({n}/5)", { n: rule.then.length })}</h3>
          <Button size="xs" variant="secondary" icon={<Plus />} disabled={rule.then.length >= 5} onClick={() => onChange({ then: [...rule.then, newThen("notify", pages)] })}>{t("Add action")}</Button>
        </div>
        {rule.then.map((th, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border p-2.5">
            <div className="flex gap-2">
              <Select size="sm" aria-label={t("Action {n}", { n: i + 1 })} value={th.kind} onChange={(e) => setThen(i, newThen(e.target.value as RuleThen["kind"], pages))} options={THEN_KINDS.map((k) => ({ value: k, label: t(THEN_LABEL[k]) }))} />
              <Button size="sm" variant="secondary" aria-label={t("Delete action")} icon={<Trash />} disabled={rule.then.length <= 1} onClick={() => onChange({ then: rule.then.filter((_, j) => j !== i) })} />
            </div>
            <ThenFields i={i} then={th} pages={pages} onChange={(n) => setThen(i, n)} />
          </div>
        ))}
      </section>

      <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
        <div>
          <label htmlFor="r-revert" className="text-[13px] font-medium">{t("Go back to the previous page when done")}</label>
          <p className="text-[11.5px] text-muted-foreground">{hasGoto ? t("When the condition is no longer true, the phone returns to the page it was showing before.") : t("Only works with the “Go to screen” action.")}</p>
        </div>
        <Switch id="r-revert" checked={!!rule.revert} disabled={!hasGoto} onCheckedChange={(revert) => onChange({ revert: revert || undefined })} aria-label={t("Go back to the previous page when done")} />
      </div>
    </div>
  );
}

const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v !== "" ? Number(v) : d);

function WhenFields({ when: w, onChange }: { when: RuleWhen; onChange: (w: RuleWhen) => void }) {
  switch (w.kind) {
    case "ai-waiting": return (
      <>
        <Field label={t("Tool")} id="rw-prov"><Select id="rw-prov" value={w.provider ?? ""} onChange={(e) => onChange({ ...w, provider: (e.target.value || undefined) as "claude" | "codex" | undefined })}
          options={[{ value: "", label: t("Any") }, { value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }]} /></Field>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label htmlFor="rw-prompts" className="text-[13px] font-medium">{t("Include questions and permission requests")}</label>
            <p className="text-[11.5px] text-muted-foreground">{t("Questions and permission requests already show on every page, so switching pages is usually not needed.")}</p>
          </div>
          <Switch id="rw-prompts" checked={!!w.includePrompts} onCheckedChange={(v) => onChange({ ...w, includePrompts: v || undefined })} aria-label={t("Include questions and permission requests")} />
        </div>
      </>
    );
    case "media-playing": case "media-stopped": return null;
    case "cpu-above": return (
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("CPU above (%)")} id="rw-cpu"><Input id="rw-cpu" type="number" min={1} max={100} value={w.percent} onChange={(e) => onChange({ ...w, percent: num(e.target.value, 90) })} /></Field>
        <Field label={t("Lasting (seconds)")} id="rw-cpu-s"><Input id="rw-cpu-s" type="number" min={0} max={3600} value={w.forSec ?? 0} onChange={(e) => onChange({ ...w, forSec: num(e.target.value, 0) })} /></Field>
      </div>
    );
    case "quota-above": return (
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Tool")} id="rw-q-p"><Select id="rw-q-p" value={w.provider} onChange={(e) => onChange({ ...w, provider: e.target.value as typeof w.provider })} options={[{ value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "antigravity", label: "Antigravity" }]} /></Field>
        <Field label={t("Used above (%)")} id="rw-q"><Input id="rw-q" type="number" min={1} max={100} value={w.percent} onChange={(e) => onChange({ ...w, percent: num(e.target.value, 80) })} /></Field>
      </div>
    );
    case "time-between": return (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("From")} id="rw-from"><Input id="rw-from" type="time" value={w.from} onChange={(e) => onChange({ ...w, from: e.target.value })} /></Field>
          <Field label={t("To")} id="rw-to"><Input id="rw-to" type="time" value={w.to} onChange={(e) => onChange({ ...w, to: e.target.value })} /></Field>
        </div>
        <Field label={t("Days of the week")} id="rw-days" hint={t("Leave empty for every day.")}>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABEL.map((d, i) => {
              const on = !!w.days?.includes(i);
              return <button key={d} type="button" aria-pressed={on} onClick={() => { const days = on ? w.days!.filter((x) => x !== i) : [...(w.days ?? []), i].sort(); onChange({ ...w, days: days.length ? days : undefined }); }}
                className={cn("h-8 w-10 rounded-lg border text-[12.5px]", on ? "border-primary/60 bg-primary/10" : "text-muted-foreground hover:bg-muted")}>{t(d)}</button>;
            })}
          </div>
        </Field>
      </>
    );
    case "push": return (
      <>
        <Field label={t("Pushed value key")} id="rw-key" hint={t("Key of the “Value” widget or of the /api/push/<key> command.")}><Input id="rw-key" value={w.key} onChange={(e) => onChange({ ...w, key: e.target.value.toLowerCase() })} placeholder="room-temperature" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Compare")} id="rw-op"><Select id="rw-op" value={w.op ?? "="} onChange={(e) => onChange({ ...w, op: e.target.value as "=" | "!=" | ">" | "<" })} options={[{ value: "=", label: t("equals") }, { value: "!=", label: t("differs") }, { value: ">", label: t("greater than") }, { value: "<", label: t("less than") }]} /></Field>
          <Field label={t("Value")} id="rw-val"><Input id="rw-val" value={String(w.value ?? "")} onChange={(e) => onChange({ ...w, value: e.target.value !== "" && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value })} /></Field>
        </div>
      </>
    );
    case "hass-state": return (
      <>
        <Field label={t("Entity")} id="rw-ent"><EntityPicker value={w.entityId} onChange={(entityId) => onChange({ ...w, entityId })} /></Field>
        <Field label={t("State")} id="rw-state" hint={t("For example: on, off, home, open.")}><Input id="rw-state" value={w.state} maxLength={60} onChange={(e) => onChange({ ...w, state: e.target.value })} /></Field>
      </>
    );
    case "idle": return <Field label={t("Nobody pressed for (minutes)")} id="rw-idle"><Input id="rw-idle" type="number" min={1} max={1440} value={w.minutes} onChange={(e) => onChange({ ...w, minutes: num(e.target.value, 10) })} /></Field>;
    case "app-running":
    case "app-foreground": return (
      <>
        <AppNameField id="rw-app" label={t("Program")} value={w.app} onChange={(app) => onChange({ ...w, app })} />
        <span className="text-xs text-muted-foreground">
          {w.kind === "app-running"
            ? t("Fires when the program starts; with “Go back to the previous page when done”, the phone returns when it quits. Checked every 3 seconds.")
            : t("Fires when the program's window comes to the front (Windows and macOS). Checked every 3 seconds.")}
        </span>
      </>
    );
  }
}

function ThenFields({ i, then: th, pages, onChange }: { i: number; then: RuleThen; pages: Page[]; onChange: (t: RuleThen) => void }) {
  switch (th.kind) {
    case "goto-page": return (
      <div className="grid grid-cols-2 gap-2">
        <Select size="sm" aria-label={t("Screen")} invalid={!pages.some((p) => p.id === th.pageId)} value={th.pageId} onChange={(e) => onChange({ ...th, pageId: e.target.value })}
          options={[...pages.map((p) => ({ value: p.id, label: p.name || p.id })), ...(pages.some((p) => p.id === th.pageId) ? [] : [{ value: th.pageId, label: t("{id} (does not exist)", { id: th.pageId || t("(empty)") }) }])]} />
        <div className="flex items-center gap-2">
          <Input size="sm" type="number" aria-label={t("Countdown (seconds)")} min={0} max={60} value={th.countdown ?? 0} className="w-20" onChange={(e) => onChange({ ...th, countdown: num(e.target.value, 0) })} />
          <span className="text-xs text-muted-foreground">{t("seconds countdown (0 = switch now)")}</span>
        </div>
      </div>
    );
    case "notify": return (
      <>
        <Input size="sm" aria-label={t("Content")} value={th.text} maxLength={200} placeholder={t("Notification text")} onChange={(e) => onChange({ ...th, text: e.target.value })} />
        <SegmentedControl size="sm" aria-label={t("Level")} value={th.level ?? "info"} onValueChange={(v) => onChange({ ...th, level: v as "info" | "warn" | "alert" })} options={[{ value: "info", label: t("Info") }, { value: "warn", label: t("Warning") }, { value: "alert", label: t("Urgent") }]} />
      </>
    );
    case "theme-mode": return <SegmentedControl size="sm" aria-label={t("Theme")} value={th.mode} onValueChange={(v) => onChange({ ...th, mode: v as "dark" | "light" })} options={[{ value: "dark", label: t("Dark") }, { value: "light", label: t("Light") }]} />;
    case "run-item": return <ItemRefPicker pages={pages} pageId={th.pageId} itemId={th.itemId} idPrefix={`rt-${i}`} onChange={(pageId, itemId) => onChange({ ...th, pageId, itemId })} />;
  }
}
