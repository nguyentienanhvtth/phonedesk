import type { SessionTool } from "./ai/types";
import { appKey, type Rule, type RuleThen, type RuleWhen } from "./automation";

export const RULE_COOLDOWN_MS = 60_000;
/**
 * App rules follow what you do (start a game, alt-tab in and out): a 60 s rest would swallow the second alt-tab, so
 * they rest only briefly; the poll interval already debounces them.
 */
export const APP_RULE_COOLDOWN_MS = 5_000;
export const isAppRule = (w: RuleWhen) => w.kind === "app-running" || w.kind === "app-foreground";

/** Everything a rule condition can look at. Feeders update it; the engine re-evaluates. */
export interface RuleFacts {
  /** Providers with a session that finished its turn and waits for the user to type. */
  aiInput: Set<SessionTool>;
  /** Providers with a pending permission request or question (counted only by rules with includePrompts). */
  aiPrompt: Set<SessionTool>;
  mediaPlaying: boolean | undefined; // undefined until the first reading
  cpu: number | undefined;
  quota: Partial<Record<"claude" | "codex" | "antigravity" | "opencode", number>>; // highest used percent per provider
  push: Record<string, string | number | undefined>;
  hass: Record<string, string | undefined>;
  lastPress: number | undefined; // ms; undefined = never pressed since start
  /** Running programs (appKey names); undefined until the first successful poll (an unknown state never fires or ends a rule). */
  running: Set<string> | undefined;
  /** The program of the foreground window (appKey), null = none/unknown desktop, undefined = not polled yet. */
  foreground: string | null | undefined;
}

export interface RuleActions {
  gotoPage(pageId: string, o: { countdown: number; reason: string; ruleId: string; revert: boolean }): void;
  gotoRevert(ruleId: string): void;
  notify(text: string, level: "info" | "warn" | "alert", ruleId: string): void;
  themeMode(mode: "dark" | "light" | null, ruleId: string): void;
  runItem(pageId: string, itemId: string, ruleId: string): void | Promise<void>;
}

export interface RuleEngineOptions {
  rules: () => Rule[];
  actions: RuleActions;
  now?: () => number;
  cooldownMs?: number;
  startedAt?: number;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Is `d` inside the window (crossing midnight allowed; `days` apply to the day the window started on)? */
export function inTimeWindow(w: { from: string; to: string; days?: number[] }, d: Date): boolean {
  const cur = d.getHours() * 60 + d.getMinutes();
  const a = toMin(w.from), b = toMin(w.to);
  if (a === b) return false;
  const day = d.getDay();
  const ok = (dd: number) => !w.days || w.days.includes(dd);
  if (a < b) return cur >= a && cur < b && ok(day);
  if (cur >= a) return ok(day);
  if (cur < b) return ok((day + 6) % 7);
  return false;
}

function compare(op: "=" | "!=" | ">" | "<", actual: string | number | undefined, want: string | number | undefined): boolean {
  if (actual === undefined) return false;
  if (want === undefined) return op === "!=" ? false : true; // "has a value"
  const an = Number(actual), wn = Number(want);
  const numeric = typeof actual !== "boolean" && String(actual).trim() !== "" && Number.isFinite(an) && Number.isFinite(wn);
  switch (op) {
    case "=": return numeric ? an === wn : String(actual).toLowerCase() === String(want).toLowerCase();
    case "!=": return numeric ? an !== wn : String(actual).toLowerCase() !== String(want).toLowerCase();
    case ">": return numeric && an > wn;
    case "<": return numeric && an < wn;
  }
}

/**
 * Edge-triggered rules: a rule runs when its condition turns from false to true, then rests for 60 s.
 * When the condition ends, `revert` goes back to the page shown before, and a theme-mode override is dropped.
 */
export class RuleEngine {
  facts: RuleFacts = { aiInput: new Set(), aiPrompt: new Set(), mediaPlaying: undefined, cpu: undefined, quota: {}, push: {}, hass: {}, lastPress: undefined, running: undefined, foreground: undefined };
  private prev = new Map<string, boolean>();
  private lastFired = new Map<string, number>();
  private active = new Set<string>(); // rules whose effects (goto/theme) are currently applied
  private cpuSince: number | undefined;
  private startedAt: number;
  private now: () => number;

  constructor(private o: RuleEngineOptions) {
    this.now = o.now ?? Date.now;
    this.startedAt = o.startedAt ?? this.now();
  }

  private holds(w: RuleWhen): boolean {
    const f = this.facts, t = this.now();
    switch (w.kind) {
      case "ai-waiting": {
        // "needs you" = a finished turn waiting for input; pending prompts already open a sheet, so only includePrompts adds them
        const who = new Set(f.aiInput);
        if (w.includePrompts) for (const p of f.aiPrompt) who.add(p);
        return w.provider ? who.has(w.provider) : who.size > 0;
      }
      case "media-playing": return f.mediaPlaying === true;
      case "media-stopped": return f.mediaPlaying === false;
      case "cpu-above": {
        if (f.cpu === undefined || f.cpu <= w.percent) { return false; }
        return (w.forSec ?? 0) === 0 || (this.cpuSince !== undefined && t - this.cpuSince >= (w.forSec ?? 0) * 1000);
      }
      case "quota-above": { const q = f.quota[w.provider]; return q !== undefined && q > w.percent; }
      case "time-between": return inTimeWindow(w, new Date(t));
      case "push": return compare(w.op ?? "=", f.push[w.key], w.value);
      case "hass-state": return (f.hass[w.entityId] ?? "").toLowerCase() === w.state.toLowerCase();
      case "idle": return t - (f.lastPress ?? this.startedAt) >= w.minutes * 60_000;
      case "app-running": return !!f.running?.has(appKey(w.app));
      case "app-foreground": return !!f.foreground && f.foreground === appKey(w.app);
    }
  }

  private reason(r: Rule): string { return r.name || r.id; }

  /** Call after any fact changed, and on the 30 s tick (time and idle conditions). */
  evaluate(): void {
    const t = this.now();
    const rules = this.o.rules();
    // track how long the CPU has been above the lowest threshold in use
    if (this.facts.cpu === undefined || !rules.some((r) => r.when.kind === "cpu-above" && this.facts.cpu! > r.when.percent)) this.cpuSince = undefined;
    else if (this.cpuSince === undefined) this.cpuSince = t;
    const live = new Set(rules.map((r) => r.id));
    for (const id of [...this.prev.keys()]) if (!live.has(id)) { this.prev.delete(id); this.lastFired.delete(id); this.active.delete(id); }
    for (const r of rules) {
      if (!r.enabled) {
        if (this.active.has(r.id)) this.end(r);
        this.prev.set(r.id, false);
        continue;
      }
      const now = this.holds(r.when);
      const was = this.prev.get(r.id) ?? false;
      this.prev.set(r.id, now);
      if (now && !was) {
        const last = this.lastFired.get(r.id);
        const rest = isAppRule(r.when) ? Math.min(APP_RULE_COOLDOWN_MS, this.o.cooldownMs ?? APP_RULE_COOLDOWN_MS) : this.o.cooldownMs ?? RULE_COOLDOWN_MS;
        if (last !== undefined && t - last < rest) {
          // an app rule that comes back while resting (alt-tab out and in) fires once the rest is over, if still true
          if (isAppRule(r.when)) this.prev.set(r.id, false);
          continue;
        }
        this.lastFired.set(r.id, t);
        this.fire(r);
      } else if (!now && was && this.active.has(r.id)) this.end(r);
    }
  }

  private fire(r: Rule): void {
    const a = this.o.actions;
    for (const th of r.then) {
      try { this.apply(r, th, a); } catch (e) { console.error(`rule ${r.id}:`, e); }
    }
    if (r.then.some((x) => x.kind === "theme-mode" || (x.kind === "goto-page" && r.revert))) this.active.add(r.id);
  }

  private apply(r: Rule, th: RuleThen, a: RuleActions) {
    switch (th.kind) {
      case "goto-page": return a.gotoPage(th.pageId, { countdown: th.countdown ?? 0, reason: this.reason(r), ruleId: r.id, revert: !!r.revert });
      case "notify": return a.notify(th.text, th.level ?? "info", r.id);
      case "theme-mode": return a.themeMode(th.mode, r.id);
      case "run-item": return void Promise.resolve(a.runItem(th.pageId, th.itemId, r.id)).catch((e) => console.error(`rule ${r.id} run-item:`, e));
    }
  }

  private end(r: Rule): void {
    this.active.delete(r.id);
    if (r.revert && r.then.some((x) => x.kind === "goto-page")) this.o.actions.gotoRevert(r.id);
    if (r.then.some((x) => x.kind === "theme-mode")) this.o.actions.themeMode(null, r.id);
  }

  // ----- feeders -----
  setAiInput(providers: Iterable<SessionTool>) { this.facts.aiInput = new Set(providers); this.evaluate(); }
  setAiPrompts(providers: Iterable<SessionTool>) { this.facts.aiPrompt = new Set(providers); this.evaluate(); }
  setMedia(playing: boolean) { this.facts.mediaPlaying = playing; this.evaluate(); }
  setCpu(cpu: number) { this.facts.cpu = cpu; this.evaluate(); }
  setQuota(q: RuleFacts["quota"]) { this.facts.quota = q; this.evaluate(); }
  setPush(key: string, v: string | number | undefined) { this.facts.push[key] = v; this.evaluate(); }
  setHass(entityId: string, state: string | undefined) { this.facts.hass[entityId] = state; this.evaluate(); }
  pressed() { this.facts.lastPress = this.now(); this.evaluate(); }
  /** Feed a program poll: `running` names and the foreground program (either undefined when that part was not polled). */
  setApps(running: Iterable<string> | undefined, foreground: string | null | undefined) {
    if (running !== undefined) this.facts.running = new Set([...running].map(appKey));
    if (foreground !== undefined) this.facts.foreground = foreground === null ? null : appKey(foreground);
    this.evaluate();
  }
  /** Which program facts the enabled rules need (the poller asks only for those). */
  appNeeds(): { running: boolean; foreground: boolean } {
    const rs = this.o.rules().filter((r) => r.enabled);
    return { running: rs.some((r) => r.when.kind === "app-running"), foreground: rs.some((r) => r.when.kind === "app-foreground") };
  }
  tick() { this.evaluate(); }
}
