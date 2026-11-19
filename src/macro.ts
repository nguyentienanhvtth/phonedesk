import type { Action } from "./config";
import type { MacroStep } from "./automation";
import { t as tr } from "./i18n";

export const MACRO_MAX_DEPTH = 2;

export interface MacroCtx {
  /** Runs one plain action (open, hotkey, type, shell, media, volume, hass, sound...). A macro action comes back through runMacro. */
  exec(action: Action, depth: number): Promise<void>;
  /** The action of a button, or undefined when the page/item is gone or has none. */
  item(pageId: string, itemId: string): Action | undefined;
  notify(text: string): void;
  /** Switches the phone(s) to a screen (throws when it does not exist). */
  gotoPage?(pageId: string): void;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Aborted when the agent stops. */
  signal?: AbortSignal;
}

export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(tr("cancelled")));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error(tr("cancelled"))); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function toAction(st: MacroStep): Action | null {
  switch (st.kind) {
    case "hotkey": return { type: "hotkey", keys: st.keys };
    case "type": return { type: "type", text: st.text };
    case "open": return { type: "open", target: st.target };
    case "shell": return { type: "shell", command: st.command };
    case "media": return { type: "media", command: st.command };
    case "volume": return { type: "volume", command: st.command };
    case "hass": return { type: "hass", service: st.service, ...(st.entityId ? { entityId: st.entityId } : {}), ...(st.data ? { data: st.data } : {}) };
    case "sound": return { type: "sound", sound: st.sound, ...(st.on ? { on: st.on } : {}), ...(st.volume !== undefined ? { volume: st.volume } : {}), mode: "overlap" };
    default: return null;
  }
}

/** Runs the steps in order and stops at the first error (reported with the step number). `depth` counts nested item steps. */
export async function runMacro(steps: MacroStep[], ctx: MacroCtx, depth = 0): Promise<void> {
  for (const [i, st] of steps.entries()) {
    if (ctx.signal?.aborted) throw new Error(tr("cancelled"));
    try {
      if (st.kind === "wait") await ctx.sleep(st.ms, ctx.signal);
      else if (st.kind === "notify") ctx.notify(st.text);
      else if (st.kind === "page") {
        if (!ctx.gotoPage) throw new Error(tr("switching screens is not available here"));
        ctx.gotoPage(st.pageId);
      }
      else if (st.kind === "item") {
        const a = ctx.item(st.pageId, st.itemId);
        if (!a) throw new Error(tr("button {id} not found", { id: `${st.pageId}/${st.itemId}` }));
        if (a.type === "macro" && depth + 1 > MACRO_MAX_DEPTH) throw new Error(tr("macros nested deeper than {n} levels", { n: MACRO_MAX_DEPTH }));
        if (a.type !== "page") await ctx.exec(a, depth + 1);
      } else {
        await ctx.exec(toAction(st)!, depth);
      }
    } catch (e: any) {
      throw new Error(tr("step {n} ({kind}): {msg}", { n: i + 1, kind: st.kind, msg: e?.message ?? e }));
    }
  }
}
