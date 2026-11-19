import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { IconChevronRight as Chevron, IconSearch as Search } from "@tabler/icons-react";
import { Input } from "@/components/ui/knowns/input";
import { Switch } from "@/components/ui/knowns/switch";
import { useHassEntities } from "@/lib/hass";
import { useSounds } from "@/lib/sounds";
import { useApps } from "@/components/app-picker";
import { ItemIcon } from "@/components/icon";
import { useLanguage, t } from "@/lib/i18n";
import { GROUP_LABEL, STATIC_ENTRIES, entryLabel, appEntry, entityEntry, soundEntry, type PaletteEntry, type PaletteGroup } from "@/lib/palette";
import { buildTree, highlight, matches, norm, type TreeNode } from "@/lib/palette-tree";
import { entryForPlatform, usePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";

const ORDER: PaletteGroup[] = ["widget", "home", "app", "keys", "media", "sound", "system"];
const DRAG_THRESHOLD = 5;
const OPEN_KEY = "pd.palette.open";

function readOpen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function writeOpen(s: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: the open state just is not remembered */
  }
}

export interface PaletteHandlers {
  /** Pointer position in client coordinates while dragging an entry. */
  onDragMove: (entry: PaletteEntry, cx: number, cy: number) => void;
  /** `cancelled` when Escape was pressed; otherwise the drop happens at (cx, cy). */
  onDragEnd: (entry: PaletteEntry, cx: number, cy: number, cancelled: boolean) => void;
  /** Double-click: add at the first free spot. */
  onAdd: (entry: PaletteEntry) => void;
}

function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  return <>{highlight(text, q).map((p, i) => (p.hit ? <mark key={i} className="rounded-sm bg-primary/25 text-inherit">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}</>;
}

/** The feature palette: a collapsed tree of ready-made widgets and buttons that can be dragged onto the phone. */
export function PalettePanel({ onDragMove, onDragEnd, onAdd }: PaletteHandlers) {
  const lang = useLanguage();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(readOpen);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const { apps, error: appsError } = useApps();
  const { sounds } = useSounds();
  const { data: hass, missing: hassMissing } = useHassEntities();
  const [ghost, setGhost] = useState<{ entry: PaletteEntry; x: number; y: number } | null>(null);
  const session = useRef<{ entry: PaletteEntry; id: number; sx: number; sy: number; active: boolean; dead: boolean } | null>(null);

  const nq = norm(q.trim());
  const searching = nq.length > 0;

  const platform = usePlatform();
  const entries = useMemo(() => [...STATIC_ENTRIES.filter((e) => entryForPlatform(e.key, platform)), ...(sounds ?? []).map(soundEntry), ...(hass ?? []).map(entityEntry), ...(apps ?? []).map(appEntry)], [apps, sounds, hass, platform]);
  const hiddenUnavailable = useMemo(() => entries.filter((e) => e.unavailable).length, [entries]);
  const trees = useMemo(
    () => ORDER.map((g) => buildTree(g, t(GROUP_LABEL[g]), entries.filter((e) => e.group === g && (showUnavailable || !e.unavailable) && matches(e, nq, t(GROUP_LABEL[g]))))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, nq, showUnavailable, lang],
  );

  const toggle = (key: string) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    writeOpen(next);
    return next;
  });

  const onKey = useCallback((e: KeyboardEvent) => {
    const s = session.current;
    if (e.key === "Escape" && s?.active && !s.dead) {
      s.dead = true;
      setGhost(null);
      onDragEnd(s.entry, 0, 0, true);
    }
  }, [onDragEnd]);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const down = (entry: PaletteEntry, e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Capture keeps the pointer events coming here while the pointer is over the preview iframe.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic pointer): events still reach the button */
    }
    session.current = { entry, id: e.pointerId, sx: e.clientX, sy: e.clientY, active: false, dead: false };
  };
  const move = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = session.current;
    if (!s || s.dead || e.pointerId !== s.id) return;
    if (!s.active && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < DRAG_THRESHOLD) return;
    s.active = true;
    setGhost({ entry: s.entry, x: e.clientX, y: e.clientY });
    onDragMove(s.entry, e.clientX, e.clientY);
  };
  const up = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = session.current;
    session.current = null;
    if (!s || e.pointerId !== s.id) return;
    setGhost(null);
    if (s.active && !s.dead) onDragEnd(s.entry, e.clientX, e.clientY, false);
  };

  const note = (g: PaletteGroup): string | null => {
    if (g === "app" && !apps) return appsError ? t("Could not load the app list.") : t("Loading apps…");
    if (g === "home" && !hass) return hassMissing ? t("Home Assistant is not connected. Set it up in the AI integration tab.") : t("Loading home devices…");
    return null;
  };

  const renderEntries = (list: PaletteEntry[]) => (
    <div className="grid grid-cols-2 gap-1.5 pb-1.5">
      {list.map((e) => (
        <button
          key={e.key}
          type="button"
          title={`${entryLabel(e)} (${e.size[0]}×${e.size[1]})`}
          onPointerDown={(ev) => down(e, ev)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={() => onAdd(e)}
          className={cn("flex min-w-0 cursor-grab touch-none select-none items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted active:cursor-grabbing", ghost?.entry.key === e.key && "opacity-50", e.unavailable && "opacity-60")}
        >
          <span className="grid size-6 flex-none place-items-center"><ItemIcon icon={e.icon} size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium"><Hl text={entryLabel(e)} q={nq} /></span>
            <span className="block text-[10.5px] text-muted-foreground">{e.size[0]}×{e.size[1]}{e.unavailable ? ` · ${t("unavailable")}` : ""}</span>
          </span>
        </button>
      ))}
    </div>
  );

  const renderNode = (n: TreeNode, depth: number) => {
    const isOpen = searching || open.has(n.key);
    return (
      <div key={n.key}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => !searching && toggle(n.key)}
          className={cn(
            "flex w-full items-center gap-1.5 text-left transition-colors hover:text-foreground",
            depth === 0 ? "sticky top-0 z-10 bg-card py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" : "py-1 text-[12px] font-medium text-muted-foreground",
          )}
          style={depth > 0 ? { paddingLeft: depth * 10 } : undefined}
        >
          <Chevron className={cn("size-3.5 flex-none transition-transform", isOpen && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate"><Hl text={depth === 0 ? n.label : t(n.label)} q={depth === 0 ? "" : nq} /></span>
          <span className="rounded-full bg-muted px-1.5 text-[10.5px] font-normal tabular-nums normal-case tracking-normal">{n.count}</span>
        </button>
        {isOpen && (
          <div style={depth > 0 ? { paddingLeft: depth * 10 } : undefined}>
            {n.entries.length > 0 && renderEntries(n.entries)}
            {n.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const anyMatch = trees.some((tr) => tr.count > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input size="sm" icon={<Search />} placeholder={t("Search features…")} aria-label={t("Search features")} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="px-0.5 text-[11.5px] leading-snug text-muted-foreground">{t("Drag an item onto the phone, or double-click to add it to the first free spot.")}</p>
      {hiddenUnavailable > 0 || showUnavailable ? (
        <label className="flex items-center justify-between gap-2 px-0.5 text-[12px] text-muted-foreground">
          {t("Show unavailable devices too")}
          <Switch checked={showUnavailable} onCheckedChange={setShowUnavailable} aria-label={t("Show unavailable devices too")} />
        </label>
      ) : null}
      <div className="kn-scroll-auto flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
        {trees.map((tr, i) => {
          const g = ORDER[i]!;
          const msg = note(g);
          if (tr.count === 0 && (searching || !msg)) return null;
          if (tr.count > 0) return renderNode(tr, 0);
          // Nothing to list yet (still loading, or Home Assistant / the app list is unavailable): keep a header with the reason.
          const isOpen = open.has(g);
          return (
            <div key={g}>
              <button type="button" aria-expanded={isOpen} onClick={() => toggle(g)} className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-card py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Chevron className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} /><span className="flex-1">{tr.label}</span>
              </button>
              {isOpen && <p className="pb-2 pl-5 text-[12px] text-muted-foreground">{msg}</p>}
            </div>
          );
        })}
        {searching && !anyMatch && <p className="py-6 text-center text-[13px] text-muted-foreground">{t("No features match.")}</p>}
      </div>
      {ghost && (
        <div className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[12.5px] shadow-lg" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          <ItemIcon icon={ghost.entry.icon} size={16} />
          <span className="font-medium">{entryLabel(ghost.entry)}</span>
        </div>
      )}
    </div>
  );
}
