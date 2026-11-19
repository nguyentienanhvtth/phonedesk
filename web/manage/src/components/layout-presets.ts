import type { Layout } from "@/types";
import { LAYOUT_PRESETS as SHARED } from "@shared/layout-presets";

export interface LayoutPreset {
  id: string;
  name: string;
  hint: string;
  platform: "win32" | "darwin" | "all";
  /** Template revision (bumped in web/shared/layout-presets.ts when the template changes). */
  rev: number;
  layout: Layout;
}

/**
 * Layout presets available from the manage UI. They come from web/shared/layout-presets.ts, the same module the
 * agent uses (src/layouts), so a template cannot drift between the two.
 */
export const LAYOUT_PRESETS: LayoutPreset[] = SHARED.map((p) => ({ id: p.id, name: p.name, hint: p.hint, platform: p.platform, rev: p.rev, layout: p.layout() as unknown as Layout }));

/** Returns presets that work on the given platform (or all platforms). */
export function presetsForPlatform(platform: string | undefined): LayoutPreset[] {
  return LAYOUT_PRESETS.filter((p) => p.platform === "all" || p.platform === platform);
}

const KEY = "pd.layoutTemplate";
type Applied = { id: string; rev: number; dismissed?: number };

function readApplied(): Applied | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && typeof v.id === "string" && typeof v.rev === "number" ? v : null;
  } catch {
    return null;
  }
}
function writeApplied(v: Applied): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

/** Remembers which template (and revision) was applied last, so a newer built-in revision can be offered. */
export function rememberTemplate(p: LayoutPreset): void {
  writeApplied({ id: p.id, rev: p.rev });
}

/** "Keep mine": do not offer this revision again. */
export function dismissTemplate(p: LayoutPreset): void {
  const a = readApplied();
  writeApplied({ id: p.id, rev: a && a.id === p.id ? a.rev : 0, dismissed: p.rev });
}

const pagesKey = (l: Pick<Layout, "pages">) => JSON.stringify(l.pages.map((pg) => ({ id: pg.id, columns: pg.columns, rows: pg.rows, items: pg.items })));

/**
 * The template whose built-in version is newer than what this layout was made from, if any:
 * - applied here with an older revision (remembered in localStorage), or
 * - applied before revisions were tracked: the layout has exactly the template's screens (same page ids) but different contents.
 * Not offered again once dismissed for that revision, nor when the layout already matches the template.
 */
export function staleTemplate(layout: Layout, presets: LayoutPreset[]): LayoutPreset | null {
  const a = readApplied();
  const ids = layout.pages.map((p) => p.id).join("|");
  for (const p of presets) {
    if (a?.id === p.id && (a.dismissed ?? 0) >= p.rev) continue;
    if (pagesKey(layout) === pagesKey(p.layout)) continue;
    if (a?.id === p.id && a.rev < p.rev) return p;
    if ((!a || a.id !== p.id) && ids === p.layout.pages.map((pg) => pg.id).join("|")) return p;
  }
  return null;
}
