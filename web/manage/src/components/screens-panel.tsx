import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowDown as ArrowDown, IconArrowUp as ArrowUp, IconPointer as Cursor, IconMinus as Minus, IconPlus as Plus, IconTrash as Trash, IconTemplate as Template, IconCheck as Check } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Card } from "@/components/ui/knowns/card";
import { Field, Input } from "@/components/ui/knowns/input";
import { ItemForm } from "@/components/item-form";
import { ItemIcon } from "@/components/icon";
import { WidgetMenu } from "@/components/widget-menu";
import { PhonePreview, type DropGhost, type Orientation, type PreviewController } from "@/components/phone-preview";
import { PalettePanel } from "@/components/palette-panel";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { pagePlace } from "@shared/reflow";
import type { PaletteEntry } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { t, useLanguage } from "@/lib/i18n";
import { findFree, randomId, GRID_PRESETS, PROVIDER_LABEL, WIDGET_LABEL, actionSummary, duplicateItem, moveTile, newItem, repack, resizeGrid, resizeTile, setWidgetKind, uniquePageId, type GridResult } from "@/lib/layout";
import { presetsForPlatform, type LayoutPreset } from "@/components/layout-presets";
import { usePlatform } from "@/lib/platform";
import type { Item, Layout, Page, WidgetKind } from "@/types";

export function ScreensPanel({ layout, pageIdx, itemId, setPageIdx, setItemId, update, orientation, onOrientation }: {
  layout: Layout;
  pageIdx: number;
  itemId: string | null;
  setPageIdx: (i: number) => void;
  setItemId: (id: string | null) => void;
  update: (fn: (l: Layout) => Layout) => void;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
}) {
  useLanguage();
  const platform = usePlatform();
  const page = layout.pages[pageIdx]!;
  const item = page.items.find((i) => i.id === itemId);
  const [cell, setCell] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"palette" | "items">("palette");
  const controller = useRef<PreviewController | null>(null);
  const [drag, setDrag] = useState<{ override: Layout | null; ghost: DropGhost | null } | null>(null);
  const latest = useRef({ layout, pageIdx });
  latest.current = { layout, pageIdx };
  const draft = useRef<{ key: string; item: Item } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const patchPage = (fn: (p: Page) => Page) =>
    update((l) => ({ ...l, pages: l.pages.map((p, i) => (i === pageIdx ? fn(p) : p)) }));
  const setItems = (items: Item[]) => patchPage((p) => ({ ...p, items }));

  const select = (id: string | null) => {
    setItemId(id);
    setCell(null);
  };

  const addPage = () => {
    const name = t("Screen {n}", { n: layout.pages.length + 1 });
    update((l) => ({ ...l, pages: [...l.pages, { id: uniquePageId(name, l.pages), name, columns: 8, rows: 3, items: [] }] }));
    setPageIdx(layout.pages.length);
    select(null);
  };

  const add = (kind: "button" | "widget", at?: { x: number; y: number }, widget?: WidgetKind) => {
    const it = newItem(kind, page, at, widget);
    if (!it) return setToast(t("The grid is full, no free cells left. Increase rows/columns or delete some tiles."));
    setItems([...page.items, it]);
    select(it.id);
  };

  const apply = (pageId: string, fn: (p: Page) => GridResult) => {
    const pi = layout.pages.findIndex((p) => p.id === pageId);
    if (pi < 0) return;
    const res = fn(layout.pages[pi]!);
    if (!res.ok) return setToast(res.error);
    update((l) => ({ ...l, pages: l.pages.map((p, i) => (i === pi ? res.page : p)) }));
  };

  /** The item a palette entry would create (same id for the whole drag so the preview does not flicker). */
  const draftFor = (entry: PaletteEntry, p: Page): Item => {
    if (draft.current?.key !== entry.key) {
      const bp = entry.make();
      const id = randomId(bp.kind === "widget" ? "w" : "b", new Set(p.items.map((i) => i.id)));
      draft.current = { key: entry.key, item: { ...bp, id, x: 0, y: 0, w: entry.size[0], h: entry.size[1] } as Item };
    }
    return draft.current.item;
  };

  /** Where (and whether) the entry would land with the pointer at (cx, cy). */
  const plan = (entry: PaletteEntry, cx: number, cy: number) => {
    const { layout: l, pageIdx: pi } = latest.current;
    const p = l.pages[pi]!;
    const cell = controller.current?.cellAt(cx, cy);
    if (!cell) return null;
    const [w, h] = entry.size;
    const x = Math.max(0, Math.min(cell.x, p.columns - w));
    const y = Math.max(0, Math.min(cell.y, p.rows - h));
    const item = draftFor(entry, p);
    const res = pagePlace(p, { ...item, w, h } as Item, x, y);
    return { p, pi, x, y, w, h, item, res };
  };

  const onDragMove = useCallback((entry: PaletteEntry, cx: number, cy: number) => {
    const pl = plan(entry, cx, cy);
    if (!pl) return setDrag(null);
    const ghost: DropGhost = { x: pl.x, y: pl.y, w: pl.w, h: pl.h, bad: !pl.res.ok };
    if (!pl.res.ok) return setDrag({ override: null, ghost });
    const { layout: l, pageIdx: pi } = latest.current;
    const items = pl.res.items;
    setDrag({ override: { ...l, pages: l.pages.map((p, i) => (i === pi ? { ...p, items } : p)) }, ghost });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragEnd = useCallback((entry: PaletteEntry, cx: number, cy: number, cancelled: boolean) => {
    setDrag(null);
    const pl = cancelled ? null : plan(entry, cx, cy);
    draft.current = null;
    if (!pl) return;
    if (!pl.res.ok) return setToast(pl.res.reason === "full" ? t("The page is full, cannot drop here. Delete some tiles or increase the grid size.") : t("This item does not fit there."));
    const items = pl.res.items;
    update((l) => ({ ...l, pages: l.pages.map((p, i) => (i === pl.pi ? { ...p, items } : p)) }));
    setItemId(pl.item.id);
    setCell(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, setItemId]);

  const addEntry = (entry: PaletteEntry) => {
    const [w, h] = entry.size;
    const at = findFree(page, w, h);
    if (!at) return setToast(t("No free space big enough on this page. Drag and drop so other tiles move aside, or delete some tiles."));
    const bp = entry.make();
    const item = { ...bp, id: randomId(bp.kind === "widget" ? "w" : "b", new Set(page.items.map((i) => i.id))), ...at, ...(w > 1 || h > 1 ? { w, h } : {}) } as Item;
    setItems([...page.items, item]);
    select(item.id);
  };

  const switchPage = (pageId: string) => {
    const pi = layout.pages.findIndex((p) => p.id === pageId);
    if (pi >= 0 && pi !== pageIdx) {
      setPageIdx(pi);
      select(null);
    }
  };

  const presets = presetsForPlatform(platform);
  const [showPresets, setShowPresets] = useState(false);
  const [presetConfirm, setPresetConfirm] = useState<LayoutPreset | null>(null);

  const applyPreset = (preset: LayoutPreset) => {
    const keepTheme = layout.theme;
    update(() => ({ ...preset.layout, theme: keepTheme }));
    setPageIdx(0);
    select(null);
    setPresetConfirm(null);
    setShowPresets(false);
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[290px_minmax(0,1fr)_360px]">
      {/* Left: screens + tile list */}
      <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <Card className="max-h-[38%] flex-none overflow-y-auto p-2 kn-scroll-auto">
          <PagesList layout={layout} pageIdx={pageIdx} setPageIdx={(i) => { setPageIdx(i); select(null); }} update={update} onAdd={addPage} />
          {presets.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span className="flex items-center gap-1.5"><Template className="size-3.5" />{t("Layout templates")}</span>
                <span className="text-[10px]">{showPresets ? "▼" : "▶"}</span>
              </button>
              {showPresets && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPresetConfirm(p)}
                      className="flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="text-[13px] font-medium">{t(p.name)}</span>
                      <span className="text-[11px] text-muted-foreground">{t(p.hint)}</span>
                    </button>
                  ))}
                </div>
              )}
              {presetConfirm && (
                <div className="mt-2 rounded-lg border border-warning bg-warning/10 p-2.5">
                  <p className="text-xs font-medium text-warning-foreground">{t("Replace entire layout with \"{name}\"?", { name: t(presetConfirm.name) })}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{t("This will replace all screens. Your theme is kept.")}</p>
                  <div className="mt-2 flex gap-1.5">
                    <Button size="xs" variant="secondary" onClick={() => setPresetConfirm(null)}>{t("Cancel")}</Button>
                    <Button size="xs" icon={<Check />} onClick={() => applyPreset(presetConfirm)}>{t("Apply")}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
        <Card className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <SegmentedControl
            size="sm"
            aria-label={t("Left panel")}
            value={leftTab}
            onValueChange={(v) => setLeftTab(v as "palette" | "items")}
            options={[{ value: "palette", label: t("Function palette") }, { value: "items", label: t("Tiles · {n}", { n: page.items.length }) }]}
            className="w-full"
          />
          {leftTab === "palette" ? (
            <PalettePanel onDragMove={onDragMove} onDragEnd={onDragEnd} onAdd={addEntry} />
          ) : (<>
          <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Tiles · {n}", { n: page.items.length })}</h2>
            <div className="flex gap-1">
              <Button size="xs" variant="secondary" icon={<Plus />} onClick={() => add("button")}>{t("Button")}</Button>
              <WidgetMenu align="end" onPick={(w) => add("widget", undefined, w)}
                trigger={(toggle) => <Button size="xs" variant="secondary" icon={<Plus />} onClick={toggle}>{t("Widget")}</Button>} />
            </div>
          </div>
          <div className="kn-scroll-auto min-h-0 flex-1 overflow-y-auto"><ItemsList page={page} itemId={itemId} onSelect={select} /></div>
          </>)}
        </Card>
      </div>

      {/* Middle: phone */}
      <div className="relative min-h-0 min-w-0">
        <PhonePreview
          layout={layout}
          override={drag?.override}
          ghost={drag?.ghost}
          controller={controller}
          pageId={page.id}
          selectedId={itemId}
          orientation={orientation}
          onOrientation={onOrientation}
          onEditGrid={() => { setItemId(null); setCell(null); window.setTimeout(() => { const el = document.getElementById("p-cols"); el?.scrollIntoView({ block: "center" }); el?.focus(); }, 80); }}
          onSelect={(pageId, id, c) => {
            switchPage(pageId);
            if (id) {
              setItemId(id);
              setCell(null);
            } else if (c) {
              setItemId(null);
              setCell(c);
            }
          }}
          onMove={(pageId, id, x, y) => apply(pageId, (p) => moveTile(p, id, x, y))}
          onResize={(pageId, id, w, h, x, y) => apply(pageId, (p) => resizeTile(p, id, w, h, x, y))}
          onPage={switchPage}
        />
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-10 mx-auto w-fit max-w-[min(520px,90%)]">
            <div className="pointer-events-auto"><Alert tone="danger" onDismiss={() => setToast(null)}>{toast}</Alert></div>
          </div>
        )}
      </div>

      {/* Right: inspector */}
      <Card className="kn-scroll-auto min-h-0 overflow-y-auto p-4">
        {item ? (
          <ItemForm
            item={item}
            page={page}
            pages={layout.pages}
            accent={layout.theme?.accent}
            onChange={(next) => {
              setItems(page.items.map((i) => (i.id === itemId ? next : i)));
              setItemId(next.id);
            }}
            onResize={(w, h) => {
              const res = resizeTile(page, item.id, w, h);
              if (!res.ok) return res.error;
              patchPage(() => res.page);
              return null;
            }}
            onWidgetKind={(kind) => patchPage((p) => setWidgetKind(p, item.id, kind))}
            onDuplicate={() => {
              const copy = duplicateItem(item, page);
              if (!copy) return setToast(t("The grid is full, no room to duplicate."));
              setItems([...page.items, copy]);
              select(copy.id);
            }}
            onDelete={() => {
              setItems(page.items.filter((i) => i.id !== item.id));
              select(null);
            }}
          />
        ) : cell ? (
          <EmptyCell cell={cell} onAdd={(kind, w) => add(kind, cell, w)} />
        ) : (
          <PageSettings page={page} patchPage={patchPage} />
        )}
      </Card>
    </div>
  );
}

function EmptyCell({ cell, onAdd }: { cell: { x: number; y: number }; onAdd: (kind: "button" | "widget", widget?: WidgetKind) => void }) {
  useLanguage();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-lg border border-dashed text-muted-foreground"><Plus className="size-4" /></span>
        <div>
          <h2 className="text-sm font-semibold">{t("Empty cell ({x}, {y})", { x: cell.x + 1, y: cell.y + 1 })}</h2>
          <p className="text-xs text-muted-foreground">{t("Column {x}, row {y}", { x: cell.x + 1, y: cell.y + 1 })}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button icon={<Plus />} onClick={() => onAdd("button")}>{t("Add button to cell ({x},{y})", { x: cell.x + 1, y: cell.y + 1 })}</Button>
        <WidgetMenu onPick={(w) => onAdd("widget", w)}
          trigger={(toggle) => <Button variant="secondary" icon={<Plus />} onClick={toggle} className="w-full">{t("Add widget to cell ({x},{y})", { x: cell.x + 1, y: cell.y + 1 })}</Button>} />
      </div>
    </div>
  );
}

function PagesList({ layout, pageIdx, setPageIdx, update, onAdd }: {
  layout: Layout;
  pageIdx: number;
  setPageIdx: (i: number) => void;
  update: (fn: (l: Layout) => Layout) => void;
  onAdd: () => void;
}) {
  useLanguage();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
  }, [pageIdx]);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const move = (d: number) => {
    const j = pageIdx + d;
    if (j < 0 || j >= layout.pages.length) return;
    update((l) => {
      const pages = l.pages.slice();
      [pages[pageIdx], pages[j]] = [pages[j]!, pages[pageIdx]!];
      return { ...l, pages };
    });
    setPageIdx(j);
  };
  const del = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    update((l) => ({ ...l, pages: l.pages.filter((_, i) => i !== pageIdx) }));
    setPageIdx(Math.max(0, pageIdx - 1));
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1.5 pb-1 pt-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Screens · {n}", { n: layout.pages.length })}</h2>
        <Button size="xs" variant="secondary" icon={<Plus />} onClick={onAdd}>{t("Add")}</Button>
      </div>
      {layout.pages.map((p, i) => {
        const sel = i === pageIdx;
        return (
          <div
            key={p.id}
            className={cn("group flex items-center gap-1 rounded-lg pr-1 transition-colors", sel ? "bg-muted" : "hover:bg-muted/60")}
          >
            {sel ? (
              <input
                aria-label={t("Screen name")}
                value={p.name}
                placeholder={p.id}
                onChange={(e) => update((l) => ({ ...l, pages: l.pages.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) }))}
                className="min-w-0 flex-1 rounded-md bg-transparent px-2.5 py-2 text-sm font-medium outline-none focus-visible:bg-background/60 focus-visible:ring-1 focus-visible:ring-ring"
              />
            ) : (
              <button type="button" onClick={() => setPageIdx(i)} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left text-sm">
                <span className="truncate">{p.name || p.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.items.length}</span>
              </button>
            )}
            {sel && (
              <>
                <IconBtn label={t("Move up")} disabled={i === 0} onClick={() => move(-1)}><ArrowUp className="size-3.5" /></IconBtn>
                <IconBtn label={t("Move down")} disabled={i === layout.pages.length - 1} onClick={() => move(1)}><ArrowDown className="size-3.5" /></IconBtn>
                <IconBtn label={armed ? t("Click again to delete") : t("Delete screen")} disabled={layout.pages.length <= 1} danger={armed} onClick={del}>
                  <Trash className="size-3.5" />
                </IconBtn>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IconBtn({ label, disabled, danger, onClick, children }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
        danger && "bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function ItemsList({ page, itemId, onSelect }: { page: Page; itemId: string | null; onSelect: (id: string) => void }) {
  if (page.items.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("This screen has no tiles yet. Click an empty cell on the phone or use the Add button.")}</p>;
  }
  const sorted = page.items.slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const rows = new Map<number, Item[]>();
  for (const it of sorted) {
    const y = it.y ?? 0;
    rows.set(y, [...(rows.get(y) ?? []), it]);
  }
  return (
    <div className="flex flex-col gap-2">
      {[...rows.entries()].map(([y, items]) => (
        <section key={y}>
          <h3 className="px-1.5 pb-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/80">{t("Row {n}", { n: y + 1 })}</h3>
          <ul className="flex flex-col gap-0.5">
            {items.map((it) => {
              const sel = it.id === itemId;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(it.id)}
                    aria-pressed={sel}
                    className={cn("flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors", sel ? "bg-muted" : "hover:bg-muted/60")}
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card"
                      style={it.color ? { background: it.color, color: "#fff", borderColor: "transparent" } : undefined}
                    >
                      {it.kind === "button" ? <ItemIcon icon={it.icon} size={16} /> : <ItemIcon icon="gauge" size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-tight">
                        {it.kind === "widget"
                          ? `${t("Widget {name}", { name: t(WIDGET_LABEL[it.widget] ?? it.widget) })}${it.widget === "quota" && it.provider ? ` · ${PROVIDER_LABEL[it.provider] ?? it.provider}` : ""}`
                          : it.label || t("(unnamed)")}
                      </span>
                      <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">
                        {it.kind === "widget" ? t("Shows live data") : actionSummary(it.action)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{(it.x ?? 0) + 1},{(it.y ?? 0) + 1}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GridStepper({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  useLanguage();
  return (
    <Field label={label} id={id}>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" icon={<Minus />} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Decrease {name}", { name: label.toLowerCase() })} />
        <Input id={id} type="number" min={min} max={max} value={value} className="text-center"
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }} />
        <Button variant="secondary" icon={<Plus />} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("Increase {name}", { name: label.toLowerCase() })} />
      </div>
    </Field>
  );
}

function PageSettings({ page, patchPage }: { page: Page; patchPage: (fn: (p: Page) => Page) => void }) {
  useLanguage();
  const [error, setError] = useState<{ message: string; columns: number; rows: number } | null>(null);
  useEffect(() => setError(null), [page.id]);

  const setGrid = (columns: number, rows: number) => {
    const res = resizeGrid(page, columns, rows);
    if (res.ok) {
      setError(null);
      patchPage(() => res.page);
    } else setError({ message: res.error, columns, rows });
  };
  const autoPack = () => {
    if (!error) return;
    const res = repack(page, error.columns, error.rows);
    if (res.ok) {
      patchPage(() => res.page);
      setError(null);
    } else setError({ ...error, message: res.error });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{t("Screen settings")}</h2>
        <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Cursor className="mt-0.5 size-3.5 shrink-0" />
          {t("Click a tile on the phone or in the list to edit it.")}
        </p>
      </div>
      <Field label={t("Screen name")} id="p-name">
        <Input id="p-name" value={page.name} onChange={(e) => patchPage((p) => ({ ...p, name: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <GridStepper id="p-cols" label={t("Columns")} value={page.columns} min={1} max={12} onChange={(v) => setGrid(v, page.rows)} />
        <GridStepper id="p-rows" label={t("Rows")} value={page.rows} min={1} max={8} onChange={(v) => setGrid(page.columns, v)} />
      </div>
      <div>
        <p className="mb-1.5 text-[13px] font-medium">{t("Grid presets")}</p>
        <div className="flex flex-wrap gap-1.5">
          {GRID_PRESETS.map((g) => {
            const on = g.columns === page.columns && g.rows === page.rows;
            return (
              <button
                key={g.label}
                type="button"
                aria-pressed={on}
                onClick={() => setGrid(g.columns, g.rows)}
                className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors hover:bg-muted", on && "border-primary/60 bg-primary/10 font-medium")}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <Alert tone="warning" action={{ label: t("Auto arrange"), onClick: autoPack }} onDismiss={() => setError(null)}>{error.message}</Alert>
      )}
      <Field label={t("Screen ID")} id="p-id" hint={t("Used by the \"Switch screen\" action. Cannot be changed.")}>
        <Input id="p-id" value={page.id} readOnly className="font-mono" />
      </Field>
    </div>
  );
}
