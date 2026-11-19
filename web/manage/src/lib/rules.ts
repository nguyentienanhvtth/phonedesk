import { randomId } from "@/lib/layout";
import { t } from "@/lib/i18n";
import { APP_NAME_RE, type Layout, type Page, type Rule, type RuleThen, type RuleWhen } from "@/types";

export const WHEN_LABEL: Record<RuleWhen["kind"], string> = {
  "ai-waiting": "AI needs you",
  "media-playing": "Music starts playing",
  "media-stopped": "Music stops",
  "cpu-above": "High CPU",
  "quota-above": "High AI quota",
  "time-between": "During a time window",
  push: "A pushed value arrives (webhook)",
  "hass-state": "Home Assistant device changes state",
  idle: "Nobody is using it",
  "app-running": "A program is running",
  "app-foreground": "A program is in front",
};
export const THEN_LABEL: Record<RuleThen["kind"], string> = {
  "goto-page": "Go to screen",
  notify: "Show a notification",
  "theme-mode": "Switch light / dark theme",
  "run-item": "Press a button",
};
export const WHEN_KINDS = Object.keys(WHEN_LABEL) as RuleWhen["kind"][];
export const THEN_KINDS = Object.keys(THEN_LABEL) as RuleThen["kind"][];
export const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function newWhen(kind: RuleWhen["kind"]): RuleWhen {
  switch (kind) {
    case "ai-waiting": return { kind };
    case "media-playing": return { kind };
    case "media-stopped": return { kind };
    case "cpu-above": return { kind, percent: 90, forSec: 30 };
    case "quota-above": return { kind, provider: "claude", percent: 80 };
    case "time-between": return { kind, from: "22:00", to: "06:00" };
    case "push": return { kind, key: "", op: ">", value: 0 };
    case "hass-state": return { kind, entityId: "", state: "on" };
    case "idle": return { kind, minutes: 10 };
    case "app-running": return { kind, app: "" };
    case "app-foreground": return { kind, app: "" };
  }
}
export function newThen(kind: RuleThen["kind"], pages: Page[]): RuleThen {
  switch (kind) {
    case "goto-page": return { kind, pageId: pages[0]?.id ?? "", countdown: 3 };
    case "notify": return { kind, text: "", level: "info" };
    case "theme-mode": return { kind, mode: "dark" };
    case "run-item": return { kind, pageId: pages[0]?.id ?? "", itemId: "" };
  }
}

export function whenSummary(w: RuleWhen): string {
  switch (w.kind) {
    case "ai-waiting": return w.provider ? t("{name} needs you", { name: w.provider === "claude" ? "Claude" : "Codex" }) : t("An AI tool needs you");
    case "media-playing": return t("Music starts playing");
    case "media-stopped": return t("Music stops");
    case "cpu-above": return w.forSec ? t("CPU > {percent}% for {sec} seconds", { percent: w.percent, sec: w.forSec }) : t("CPU > {percent}%", { percent: w.percent });
    case "quota-above": return t("{provider} quota > {percent}%", { provider: w.provider, percent: w.percent });
    case "time-between": return t("{from} to {to}", { from: w.from, to: w.to });
    case "push": return t("Value “{key}” {op} {value}", { key: w.key || "…", op: w.op ?? "=", value: w.value ?? "…" });
    case "hass-state": return `${w.entityId || "…"} = ${w.state}`;
    case "idle": return t("Idle for {n} minutes", { n: w.minutes });
    case "app-running": return t("{app} is running", { app: w.app || "…" });
    case "app-foreground": return t("{app} is in front", { app: w.app || "…" });
  }
}
export function thenSummary(th: RuleThen, pages: Page[]): string {
  const name = (id: string) => pages.find((p) => p.id === id)?.name || id || "…";
  switch (th.kind) {
    case "goto-page": return t("Go to screen {name}", { name: name(th.pageId) });
    case "notify": return t("Notify “{text}”", { text: th.text || "…" });
    case "theme-mode": return th.mode === "dark" ? t("Dark theme") : t("Light theme");
    case "run-item": return t("Press a button");
  }
}

export interface RuleTemplate { key: string; label: string; make: (pages: Page[]) => Omit<Rule, "id"> }
const pick = (pages: Page[], ...ids: string[]) => ids.map((i) => pages.find((p) => p.id === i)?.id).find(Boolean) ?? pages[0]?.id ?? "";

export const RULE_TEMPLATES: RuleTemplate[] = [
  { key: "ai", label: "Claude waiting for input → AI page", make: (p) => ({ name: t("Claude waiting for input"), enabled: true, when: { kind: "ai-waiting" }, then: [{ kind: "goto-page", pageId: pick(p, "ai"), countdown: 3 }], revert: true }) },
  { key: "music", label: "Music playing → Music page", make: (p) => ({ name: t("Open Music page when music plays"), enabled: true, when: { kind: "media-playing" }, then: [{ kind: "goto-page", pageId: pick(p, "music", "nhac", "media"), countdown: 3 }], revert: true }) },
  { key: "cpu", label: "CPU > 90% for 30 seconds → alert", make: () => ({ name: t("CPU too high"), enabled: true, when: { kind: "cpu-above", percent: 90, forSec: 30 }, then: [{ kind: "notify", text: t("CPU has been above 90% for over 30 seconds"), level: "alert" }] }) },
  { key: "quota", label: "Claude quota > 80% → alert", make: () => ({ name: t("Claude quota running out"), enabled: true, when: { kind: "quota-above", provider: "claude", percent: 80 }, then: [{ kind: "notify", text: t("Claude quota is over 80% used"), level: "warn" }] }) },
  { key: "night", label: "Night 22:00-06:00 → dark theme", make: () => ({ name: t("Dark theme at night"), enabled: true, when: { kind: "time-between", from: "22:00", to: "06:00" }, then: [{ kind: "theme-mode", mode: "dark" }] }) },
  { key: "kitchen", label: "Someone in the kitchen → Home page", make: (p) => ({ name: t("Someone in the kitchen"), enabled: true, when: { kind: "hass-state", entityId: "binary_sensor.kitchen_motion", state: "on" }, then: [{ kind: "goto-page", pageId: pick(p, "home", "nha"), countdown: 3 }], revert: true }) },
  { key: "game", label: "Game running → Gaming screen", make: (p) => ({ name: t("Gaming screen while the game runs"), enabled: true, when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: pick(p, "gaming", "game"), countdown: 0 }], revert: true }) },
  { key: "idle", label: "Idle 10 minutes → back to Overview", make: (p) => ({ name: t("Back to Overview when idle"), enabled: true, when: { kind: "idle", minutes: 10 }, then: [{ kind: "goto-page", pageId: pick(p, "overview"), countdown: 0 }] }) },
];

export function ruleIdFor(layout: Layout): string {
  return randomId("rule", new Set((layout.rules ?? []).map((r) => r.id)));
}

/** Inline problems for one rule (the agent enforces the same). */
export function ruleProblems(r: Rule, pages: Page[]): string[] {
  const out: string[] = [];
  const pid = new Set(pages.map((p) => p.id));
  if (!r.name.trim()) out.push(t("Rule has no name."));
  const w = r.when;
  if (w.kind === "push" && !/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(w.key)) out.push(t("Pushed value key is invalid."));
  if (w.kind === "hass-state" && !/^[a-z_]+\.[a-z0-9_]+$/.test(w.entityId)) out.push(t("No Home Assistant entity selected."));
  if (w.kind === "time-between" && !(/^([01]\d|2[0-3]):[0-5]\d$/.test(w.from) && /^([01]\d|2[0-3]):[0-5]\d$/.test(w.to))) out.push(t("Time must be in HH:MM format."));
  if ((w.kind === "app-running" || w.kind === "app-foreground") && !APP_NAME_RE.test(w.app.trim())) out.push(t("Type the program's process name (e.g. cs2.exe)."));
  if (r.then.length < 1 || r.then.length > 5) out.push(t("Needs 1 to 5 actions in the “Then” section."));
  r.then.forEach((th, i) => {
    if ((th.kind === "goto-page" || th.kind === "run-item") && !pid.has(th.pageId)) out.push(t("Action {n}: screen does not exist.", { n: i + 1 }));
    if (th.kind === "run-item" && !th.itemId) out.push(t("Action {n}: no button selected.", { n: i + 1 }));
    if (th.kind === "notify" && !th.text.trim()) out.push(t("Action {n}: no notification text.", { n: i + 1 }));
  });
  return out;
}
