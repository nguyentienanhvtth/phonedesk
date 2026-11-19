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

/** A stable fingerprint of a preset's layout (pages only; the theme is kept on apply). */
export function presetFingerprint(p: LayoutPreset): string {
  return `${p.id}@${p.rev}`;
}
