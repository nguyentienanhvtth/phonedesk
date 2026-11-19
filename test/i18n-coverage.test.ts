// Every user-facing string the manage page, the phone deck and the agent pass to t() has a Vietnamese entry.
// Fails with the list of missing keys, so a new English string cannot ship untranslated.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { VI as MANAGE_VI } from "../web/manage/src/i18n/vi";
import { VI as DECK_VI } from "../web/deck/src/i18n-vi";
import { translate } from "../src/i18n";
import * as L from "../web/manage/src/lib/layout";
import * as R from "../web/manage/src/lib/rules";
import * as P from "../web/manage/src/lib/palette";
import * as PF from "../web/manage/src/lib/platform";

const ROOT = join(import.meta.dir, "..");
/** Names, key combos and product words that read the same in Vietnamese. */
const SAME = new Set(["CPU", "RAM", "GPU", "AI", "PhoneDesk", "Spotlight", "Home Assistant", "LockWorkStation", "Ctrl+Shift+Esc", "JSON"]);
const keyCombo = (s: string) => /^(Win|Ctrl|Alt|Shift|Cmd)(\+[A-Za-z0-9]+)+$/.test(s);

/** Literal first arguments of t(...): "…", '…' and `…` without ${}. */
function tLiterals(glob: string, skip: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of new Glob(glob).scanSync(ROOT)) {
    if (skip.test(f)) continue;
    const s = readFileSync(join(ROOT, f), "utf8");
    for (const m of s.matchAll(/(?<![\w.$])t\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`$]*`)\s*[,)]/g)) {
      const q = m[1]!;
      const k = q[0] === "`" ? q.slice(1, -1) : q[0] === "'" ? JSON.parse(`"${q.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) : JSON.parse(q);
      out.set(k, f);
    }
  }
  return out;
}
const missing = (keys: Map<string, string> | string[], has: (k: string) => boolean) =>
  [...(Array.isArray(keys) ? keys.map((k) => [k, ""] as const) : keys)].filter(([k]) => !SAME.has(k) && !keyCombo(k) && !has(k)).map(([k, f]) => (f ? `${f}: ${k}` : k));

describe("Vietnamese coverage", () => {
  test("manage: every t() literal", () => {
    const keys = tLiterals("web/manage/src/**/*.{ts,tsx}", /i18n|\.gen\.|components\/ui\//);
    expect(keys.size).toBeGreaterThan(500);
    expect(missing(keys, (k) => k in MANAGE_VI)).toEqual([]);
  });
  test("manage: labels shown through t(table[x]) (actions, widgets, rules, palette, examples)", () => {
    const vals: string[] = [];
    for (const n of ["WIDGET_HINT", "WIDGET_LABEL", "ACTION_LABEL", "ACTION_SHORT", "MEDIA_LABEL", "VOLUME_LABEL", "MIC_LABEL", "APP_VOLUME_LABEL"]) vals.push(...(Object.values((L as Record<string, unknown>)[n] as object) as string[]));
    for (const n of ["WHEN_LABEL", "THEN_LABEL", "DAY_LABEL"]) vals.push(...(Object.values((R as Record<string, unknown>)[n] as object) as string[]));
    vals.push(...R.RULE_TEMPLATES.map((r) => r.label), ...Object.values(P.GROUP_LABEL));
    for (const e of P.STATIC_ENTRIES) vals.push(e.label, ...(e.hint ? [e.hint] : []), ...(e.path ?? []));
    for (const p of ["win32", "darwin", "linux"] as const) vals.push(PF.shellExample(p), PF.openExample(p));
    expect(missing(vals, (k) => k in MANAGE_VI)).toEqual([]);
  });
  test("deck: every t() literal and the label tables", () => {
    const keys = tLiterals("web/deck/src/**/*.{ts,tsx}", /i18n|\.gen\./);
    expect(keys.size).toBeGreaterThan(100);
    const tables: string[] = [];
    for (const [f, names] of [["widgets.tsx", ["LABEL", "LOAD_LABEL", "BAND_TEXT"]], ["sheets.tsx", ["RISK_LABEL"]], ["ai.tsx", ["STATE_TEXT"]], ["hass-controls.tsx", ["VAC_TEXT"]], ["automation.tsx", ["COND_TEXT"]]] as const) {
      const s = readFileSync(join(ROOT, "web/deck/src", f), "utf8");
      for (const n of names) {
        const m = new RegExp(`const ${n}\\b[^=]*=\\s*\\{([^}]*)\\}`).exec(s);
        expect(m ? n : `no table ${n} in ${f}`).toBe(n);
        for (const x of m![1]!.matchAll(/'([^']+)'/g)) tables.push(x[1]!);
      }
    }
    expect(missing(keys, (k) => k in DECK_VI)).toEqual([]);
    expect(missing(tables, (k) => k in DECK_VI)).toEqual([]);
  });
  test("agent: every t() literal", () => {
    const keys = tLiterals("src/**/*.ts", /i18n\.ts$|\.gen\./);
    expect(keys.size).toBeGreaterThan(150);
    expect(missing(keys, (k) => translate("vi", k) !== k)).toEqual([]);
  });
});

describe("no Mac wording on Windows", () => {
  // strings that only appear on macOS (permissions, Keychain, the macOS firewall) may say macOS
  const MAC_ONLY_FILES = /doctor\.ts$|platform\/darwin|permissions-panel\.tsx$|lib\/platform\.ts$/;
  test("shared strings say 'computer', not 'this Mac'", () => {
    const all = [
      ...tLiterals("web/manage/src/**/*.{ts,tsx}", /i18n|\.gen\.|components\/ui\//),
      ...tLiterals("web/deck/src/**/*.{ts,tsx}", /i18n|\.gen\./),
      ...tLiterals("src/**/*.ts", /i18n\.ts$|\.gen\./),
    ].filter(([k, f]) => !MAC_ONLY_FILES.test(f) && /\b(this|the) Mac\b|Mac's|⌘/.test(k) && k !== "Only reachable from this Mac");
    expect(all.map(([k, f]) => `${f}: ${k}`)).toEqual([]);
    for (const [f, re] of [["web/manage/src/components/integrations-panel.tsx", /on this Mac/], ["web/manage/src/lib/layout.ts", /the Mac has/], ["web/manage/src/components/devices-panel.tsx", /Mac's IP/], ["src/mcp/tools.ts", /Installed Mac apps/]] as const)
      expect(re.test(readFileSync(join(ROOT, f), "utf8")) ? `${f} still says Mac` : "ok").toBe("ok");
  });
  test("the manage header shows Ctrl shortcuts unless the agent runs on macOS", () => {
    const app = readFileSync(join(ROOT, "web/manage/src/App.tsx"), "utf8");
    expect(app).toContain(`platform === "darwin" ? "⌘S" : "Ctrl+S"`);
    expect(app).not.toContain(`t("Undo (⌘Z)")`);
  });
  test("examples follow the agent's OS", () => {
    expect(PF.shellExample("win32")).not.toContain("open -a");
    expect(PF.openExample("win32")).not.toContain("Safari");
    expect(PF.shellExample("darwin")).toContain("open -a");
  });
  test("Windows-only palette tiles are hidden on macOS; push-to-talk is not offered there", () => {
    for (const k of ["w-appvol", "w-outdev", "w-ptt"]) expect(PF.entryForPlatform(k, "darwin")).toBe(false);
    for (const k of ["w-appvol", "w-outdev", "w-ptt"]) expect(PF.entryForPlatform(k, "win32")).toBe(true);
    expect(PF.entryForPlatform("w-ptt", "linux")).toBe(true);
  });
});
