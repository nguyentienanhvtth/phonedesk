import { useEffect, useState } from "react";
import { api } from "@/api";
import type { Sound } from "@/types";

let cache: Sound[] | null = null;
let failed: string | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** (Re)loads GET /api/sounds and shares the list with every component. */
export function refreshSounds(): Promise<void> {
  pending ??= api
    .listSounds()
    .then((s) => {
      cache = s;
      failed = null;
    })
    .catch((e: unknown) => {
      failed = e instanceof Error ? e.message : String(e);
      cache ??= null;
    })
    .finally(() => {
      pending = null;
      emit();
    });
  return pending;
}

/** Applies a local change right away (after upload/rename/delete) so every list updates without a round trip. */
export function setSounds(fn: (s: Sound[]) => Sound[]) {
  cache = fn(cache ?? []);
  emit();
}

export function useSounds(): { sounds: Sound[] | null; error: string | null; reload: () => void } {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (!cache) void refreshSounds();
    return () => void listeners.delete(l);
  }, []);
  return { sounds: cache, error: cache ? null : failed, reload: () => void refreshSounds() };
}

/**
 * Why the agent will refuse this file, by its name (it checks the bytes too), as an i18n key with {name} and {formats};
 * null when the format is fine. flac/aiff are never accepted; ogg is refused on Windows (no Ogg decoder in its player).
 */
export function soundFormatProblem(fileName: string, windows: boolean): string | null {
  if (/\.(flac|aiff?)$/i.test(fileName)) return "“{name}”: this format is not supported. Use {formats}.";
  if (windows && /\.(ogg|oga|opus)$/i.test(fileName)) return "“{name}”: Windows cannot play ogg clips. Convert it to mp3, m4a or wav.";
  return null;
}
