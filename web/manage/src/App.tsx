import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconDeviceFloppy as Floppy, IconArrowForwardUp as Redo, IconRotate as RotateLeft, IconArrowBackUp as Undo } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { Kbd } from "@/components/ui/knowns/kbd";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Spinner } from "@/components/ui/knowns/spinner";
import { api } from "@/api";
import { DevicesPanel } from "@/components/devices-panel";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { JsonPanel } from "@/components/json-panel";
import { ScreensPanel } from "@/components/screens-panel";
import { usePreviewOrientation } from "@/components/phone-preview";
import { RulesPanel } from "@/components/rules-panel";
import { SoundsPanel } from "@/components/sounds-panel";
import { ThemePanel } from "@/components/theme-panel";
import { PermissionsPanel } from "@/components/permissions-panel";
import { AboutCard } from "@/components/about-card";
import { CustomizeHint } from "@/components/visual-options";
import { UpdateBanner } from "@/components/update-banner";
import { useAbout } from "@/lib/about";
import { setPlatform, usePlatform } from "@/lib/platform";
import { needsAttention, useDoctor } from "@/lib/doctor";
import { mergeLayouts } from "@/lib/layout-merge";
import { asLanguage, setLanguage, type Language, t, useLanguage } from "@/lib/i18n";
import type { Layout } from "@/types";

const REPO = "https://github.com/howznguyen/phonedesk";

type Tab = "screens" | "theme" | "sounds" | "rules" | "ai" | "permissions" | "json" | "devices";
const TABS: { value: Tab; label: string }[] = [
  { value: "screens", label: "Screens" },
  { value: "theme", label: "Theme" },
  { value: "rules", label: "Automation" },
  { value: "sounds", label: "Sounds" },
  { value: "ai", label: "AI integrations" },
  { value: "permissions", label: "Permissions" },
  { value: "json", label: "JSON" },
  { value: "devices", label: "Devices" },
];

type Status = { kind: "ok" | "error" | "info"; text: string } | null;

export default function App() {
  const lang = useLanguage();
  const platform = usePlatform();
  const about = useAbout();
  const doctor = useDoctor();
  const attention = needsAttention(doctor.items, platform);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [saved, setSaved] = useState("");
  const [tab, setTab] = useState<Tab>("screens");
  const [pageIdx, setPageIdx] = useState(0);
  const [itemId, setItemId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jsonKey, setJsonKey] = useState(0);
  const [armedReload, setArmedReload] = useState(false);
  const [orientation, setOrientation] = usePreviewOrientation(layout?.theme?.orientation);
  const [history, setHistory] = useState<{ past: Layout[]; future: Layout[] }>({ past: [], future: [] });
  const lastEdit = useRef(0);

  const dirty = layout !== null && JSON.stringify(layout) !== saved;

  const load = useCallback(async () => {
    try {
      const l = await api.getLayout();
      setLayout(l);
      setSaved(JSON.stringify(l));
      setPageIdx((i) => Math.min(i, l.pages.length - 1));
      setItemId(null);
      setLoadError(null);
      setSaveError(null);
      setStatus(null);
      setJsonKey((k) => k + 1);
      setHistory({ past: [], future: [] });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    api.getPlatform().then((p) => p && setPlatform(p), () => undefined); // else the browser's own platform is used
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back on this tab with nothing unsaved: pick up changes made elsewhere (another tab, MCP tools, a script).
  const focusDirty = useRef(false);
  focusDirty.current = dirty;
  useEffect(() => {
    const onFocus = () => {
      if (focusDirty.current) return;
      api.getLayout().then((l) => {
        if (!focusDirty.current && JSON.stringify(l) !== saved0.current) void load();
      }, () => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // The layout carries the language (theme.language); a missing value means English.
  const themeLang = layout?.theme?.language;
  useEffect(() => {
    if (layout) setLanguage(asLanguage(themeLang));
  }, [layout, themeLang]);

  // Every edit goes through here so it can be undone. Edits within 600 ms of each other (typing) share one undo step.
  const layoutRef = useRef<Layout | null>(null);
  layoutRef.current = layout;
  const update = useCallback((fn: (l: Layout) => Layout) => {
    const cur = layoutRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const now = Date.now();
    const coalesce = now - lastEdit.current < 600;
    lastEdit.current = now;
    setHistory((h) => ({ past: coalesce ? h.past : [...h.past.slice(-99), cur], future: [] }));
    layoutRef.current = next;
    setLayout(next);
    setStatus(null);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const prev = h.past[h.past.length - 1];
      const cur = layoutRef.current;
      if (!prev || !cur) return h;
      layoutRef.current = prev;
      setLayout(prev);
      setJsonKey((k) => k + 1);
      lastEdit.current = 0;
      return { past: h.past.slice(0, -1), future: [cur, ...h.future] };
    });
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => {
      const nxt = h.future[0];
      const cur = layoutRef.current;
      if (!nxt || !cur) return h;
      layoutRef.current = nxt;
      setLayout(nxt);
      setJsonKey((k) => k + 1);
      lastEdit.current = 0;
      return { past: [...h.past, cur], future: h.future.slice(1) };
    });
  }, []);

  /**
   * Saves `mine` on top of whatever the agent has now: fields changed elsewhere since this page loaded are kept
   * (three-way merge against the last loaded/saved layout). Returns the layout that was saved.
   */
  const saved0 = useRef("");
  saved0.current = saved;
  const saveMerged = useCallback(async (mine: Layout): Promise<Layout> => {
    let out = mine;
    try {
      const theirs = await api.getLayout();
      out = mergeLayouts(JSON.parse(saved0.current || JSON.stringify(theirs)) as Layout, mine, theirs);
    } catch {
      /* cannot read the agent's copy: save what we have */
    }
    await api.putLayout(out);
    if (JSON.stringify(out) !== JSON.stringify(mine)) {
      layoutRef.current = out;
      setLayout(out);
      setJsonKey((k) => k + 1);
    }
    setSaved(JSON.stringify(out));
    return out;
  }, []);

  // Header switch: the page changes at once (and remembers it); the layout carries theme.language so the phone follows.
  // With no other unsaved edits the new language is saved straight away, otherwise it goes out with the next Save.
  const switchLanguage = useCallback(async (l: Language) => {
    setLanguage(l);
    const cur = layoutRef.current;
    if (!cur) return;
    const wasDirty = JSON.stringify(cur) !== saved;
    const theme: Record<string, unknown> = { ...(cur.theme ?? {}) };
    if (l === "vi") theme.language = "vi";
    else delete theme.language;
    const next: Layout = { ...cur };
    delete next.theme;
    if (Object.keys(theme).length) next.theme = theme as Layout["theme"];
    update(() => next);
    if (wasDirty) {
      setStatus({ kind: "info", text: t("The phone follows the language when you save.") });
      return;
    }
    try {
      await saveMerged(next);
    } catch (e) {
      setStatus({ kind: "error", text: t("The agent rejected the layout: {error}", { error: e instanceof Error ? e.message : String(e) }) });
    }
  }, [saved, update]);

  const save = useCallback(async () => {
    if (!layout) return;
    if (jsonError) {
      setStatus({ kind: "error", text: t("Invalid JSON: {error}", { error: jsonError }) });
      return;
    }
    setSaving(true);
    try {
      await saveMerged(layout);
      setSaveError(null);
      setStatus({ kind: "ok", text: t("Saved. The phone gets the new layout right away.") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("save failed", e);
      setSaveError(msg);
      setStatus({ kind: "error", text: t("The agent rejected the layout: {error}", { error: msg }) });
    } finally {
      setSaving(false);
    }
  }, [layout, jsonError]);

  // Ctrl/Cmd+S and leave-page guard always see the latest state.
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        const t = e.target as HTMLElement | null;
        // Inside a text field the browser's own text undo wins.
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        if (e.shiftKey) undoRef.current.redo();
        else undoRef.current.undo();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const reload = () => {
    if (dirty && !armedReload) {
      setArmedReload(true);
      setTimeout(() => setArmedReload(false), 3000);
      return;
    }
    setArmedReload(false);
    void load();
  };

  const safePageIdx = useMemo(() => (layout ? Math.min(pageIdx, layout.pages.length - 1) : 0), [layout, pageIdx]);

  return (
    <div className="mx-auto flex h-screen max-w-[1500px] flex-col gap-3 overflow-hidden p-4">
      <header className="flex flex-wrap items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={36} height={36} className="size-9 flex-none" />
        <div className="mr-auto">
          <h1 className="text-lg font-semibold leading-tight">PhoneDesk <span className="font-normal text-muted-foreground">· {t("Manage your control screen")}</span></h1>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">{t(platform === "win32" ? "Only reachable from this PC" : platform === "darwin" ? "Only reachable from this Mac" : "Only reachable from this computer")}{about && (() => {
            const text = `v${about.version}${about.commit ? ` · ${about.commit}` : ""}${about.dirty ? "*" : ""}`;
            const cls = "rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted/70 hover:text-foreground";
            return about.commit && !about.dirty
              ? <a href={`${about.repo}/commit/${about.commit}`} target="_blank" rel="noopener noreferrer" title={t("Open this commit on GitHub")} className={cls}>{text}</a>
              : <button type="button" title={t("Open About")} className={cls} onClick={() => { setTab("devices"); window.setTimeout(() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>{text}</button>;
          })()}</p>
        </div>
        {dirty && saveError && <span title={saveError}><Badge tone="danger" dot>{t("Save failed: {error}", { error: saveError.length > 60 ? `${saveError.slice(0, 57)}…` : saveError })}</Badge></span>}
        {dirty && !saveError && <Badge tone="warning" dot>{t("Unsaved")}</Badge>}
        <a href={about?.repo ?? REPO} target="_blank" rel="noopener noreferrer" title={t("Source code on GitHub")} aria-label={t("Source code on GitHub")} className="grid size-9 place-items-center rounded-lg border bg-secondary text-secondary-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
        </a>
        <SegmentedControl size="sm" aria-label={t("Language")} value={lang} onValueChange={(v) => void switchLanguage(v === "vi" ? "vi" : "en")} options={[{ value: "en", label: "EN" }, { value: "vi", label: "VI" }]} />
        <Button variant="secondary" icon={<Undo />} disabled={history.past.length === 0} onClick={undo} aria-label={t("Undo")} title={t("Undo (⌘Z)")} />
        <Button variant="secondary" icon={<Redo />} disabled={history.future.length === 0} onClick={redo} aria-label={t("Redo")} title={t("Redo (⌘⇧Z)")} />
        <Button variant="secondary" icon={<RotateLeft />} onClick={reload}>{armedReload ? t("Discard changes?") : t("Reload")}</Button>
        <Button icon={<Floppy />} loading={saving} disabled={!layout || (!dirty && !jsonError)} onClick={() => void save()}>
          {t("Save")} <Kbd size="sm" tone="inverse">⌘S</Kbd>
        </Button>
      </header>

      <UpdateBanner repo={about?.repo ?? REPO} enabled={layout?.theme?.updateCheck !== false} />

      <SegmentedControl
        aria-label={t("Sections")}
        role="tablist"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="self-start"
        options={TABS.map((x) => ({ value: x.value, label: x.value === "permissions" && attention > 0 ? <span className="inline-flex items-center gap-1.5">{t(x.label)}<span className="grid min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-4 text-black" aria-label={t("Needs attention")}>{attention}</span></span> : t(x.label), id: `tab-${x.value}`, controls: `panel-${x.value}` }))}
      />

      {status && (
        <Alert tone={status.kind === "error" ? "danger" : status.kind === "ok" ? "success" : "info"} onDismiss={() => setStatus(null)}>
          {status.text}
        </Alert>
      )}

      {loadError && (
        <Alert tone="danger" title={t("Could not load the layout")} action={{ label: t("Retry"), onClick: () => void load() }}>{loadError}</Alert>
      )}

      {!layout && !loadError && <div className="grid flex-1 place-items-center"><Spinner label={t("Loading layout")} /></div>}

      {layout && (
        <main key={lang} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {(tab === "screens" || tab === "theme") && <div className="mb-3"><CustomizeHint /></div>}
          {tab === "screens" && (
            <ScreensPanel layout={layout} pageIdx={safePageIdx} itemId={itemId} setPageIdx={setPageIdx} setItemId={setItemId} update={update}
              orientation={orientation} onOrientation={setOrientation} />
          )}
          {tab === "theme" && (
            <ThemePanel layout={layout} pageId={layout.pages[safePageIdx]!.id} orientation={orientation} onOrientation={setOrientation}
              onChange={(theme) => update((l) => {
                const rest = { ...l };
                delete rest.theme;
                return theme ? { ...rest, theme } : rest;
              })} />
          )}
          {tab === "rules" && <RulesPanel layout={layout} update={update} />}
          {tab === "sounds" && <SoundsPanel />}
          {tab === "ai" && <IntegrationsPanel />}
          {tab === "permissions" && <PermissionsPanel {...doctor} />}
          {tab === "json" && <JsonPanel key={jsonKey} layout={layout} onChange={(l) => update(() => l)} onError={setJsonError} />}
          {tab === "devices" && <div className="flex flex-col gap-4"><DevicesPanel /><AboutCard about={about} /></div>}
        </main>
      )}
    </div>
  );
}
