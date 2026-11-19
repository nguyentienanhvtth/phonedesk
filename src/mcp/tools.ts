import { ACTION_TYPES, WIDGET_KINDS, type Layout } from "../config";
import { layoutGrid } from "./ascii";
import { OPERATIONS, THEME_KEYS, WIDGET_SIZE } from "./ops";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The running agent's localhost REST API. */
export class AgentApi {
  constructor(private port: number, private fetchFn: Fetch = fetch) {}

  private async call(path: string, init?: RequestInit): Promise<any> {
    let res: Response;
    try {
      // the agent rejects mutating requests without the CSRF header and a JSON content type
      const headers = { "x-phonedesk": "1", ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers as Record<string, string> | undefined) };
      res = await this.fetchFn(`http://127.0.0.1:${this.port}${path}`, { ...init, headers });
    } catch {
      throw new Error(`PhoneDesk agent is not reachable on port ${this.port}. Start it with "phonedesk" (or pass --port to the mcp command).`);
    }
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) throw new Error(`agent answered ${res.status}: ${body?.error ?? text}`);
    return body;
  }
  getLayout(): Promise<Layout> { return this.call("/api/layout"); }
  putLayout(l: Layout) { return this.call("/api/layout", { method: "PUT", body: JSON.stringify(l) }); }
  apps(): Promise<{ name: string; bundleId?: string }[]> { return this.call("/api/apps"); }
  catalog(): Promise<any> { return this.call("/api/icons/catalog"); }
  history() { return this.call("/api/layout/history"); }
  undo(): Promise<{ ok: boolean; layout: Layout }> { return this.call("/api/layout/undo", { method: "POST", body: "{}" }); }
}

export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown> }
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const page = { type: "string", description: "Page id or name" };
const id = { type: "string", description: "Item id (see get_layout)" };

export const TOOLS: ToolDef[] = [
  { name: "get_layout", description: "Current deck layout: an ASCII grid per page plus the legend (item ids, kinds, positions, sizes) and, with json:true, the raw JSON. Always call this first.", inputSchema: obj({ pageId: { type: "string", description: "Only this page (id or name); all pages when omitted" }, page: { type: "string", description: "Alias of pageId" }, json: { type: "boolean", description: "Also return the raw JSON (of the requested page only when one is given)" } }) },
  { name: "list_widgets", description: `Widget kinds and their default sizes (columns x rows): ${WIDGET_KINDS.map((k) => `${k} ${WIDGET_SIZE[k].join("x")}`).join(", ")}. Action types for buttons: ${ACTION_TYPES.join(", ")}.`, inputSchema: obj({}) },
  { name: "search_icons", description: "Search the Tabler icon catalog and lobe: brand marks by name or keyword. Use the returned name as the item icon (brands as lobe:<name>). Installed apps can use app:<bundleId> (see list_apps).", inputSchema: obj({ query: { type: "string" }, limit: { type: "integer", description: "Default 20" } }, ["query"]) },
  { name: "list_apps", description: "Installed apps with their ids (the bundle id on macOS, the AppUserModelID on Windows). A button icon app:<id> shows the app's own icon; an open action can use bundle:<id>.", inputSchema: obj({ query: { type: "string", description: "Filter by name" } }) },
  { name: "add_item", description: "Add a button (kind button: label, icon, color, action) or widget (kind widget: widget, plus provider/clock/metric/quota options) to a page. Without x/y it takes the first free spot; with x/y tiles in the way are pushed aside. Widgets default to their preferred size and shrink on crowded pages.", inputSchema: obj({ page, kind: { enum: ["button", "widget"] }, id: { type: "string", description: "Optional custom id" }, label: { type: "string" }, icon: { type: "string" }, color: { type: "string", description: "CSS colour, e.g. #ff6b35" }, action: { type: "object", description: `{type: one of ${ACTION_TYPES.join("|")}, ...fields}` }, widget: { enum: [...WIDGET_KINDS] }, provider: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } }, ["page", "kind"]) },
  { name: "update_item", description: "Change fields of an item (label, icon, color, action, style, textColor, hideLabel, widget options). Set a field to null to remove it. Position and size: use move_item / resize_item.", inputSchema: obj({ page, id, changes: { type: "object" } }, ["page", "id", "changes"]) },
  { name: "move_item", description: "Move an item to cell x,y (0-based), optionally onto another page with toPage. Tiles in the way are pushed to the nearest free spot; rejected when nothing fits.", inputSchema: obj({ page, id, x: { type: "integer" }, y: { type: "integer" }, toPage: page }, ["page", "id", "x", "y"]) },
  { name: "resize_item", description: "Resize an item to w x h cells.", inputSchema: obj({ page, id, w: { type: "integer" }, h: { type: "integer" } }, ["page", "id", "w", "h"]) },
  { name: "remove_item", description: "Remove an item from a page.", inputSchema: obj({ page, id }, ["page", "id"]) },
  { name: "add_page", description: "Add a page (default 8 columns x 3 rows).", inputSchema: obj({ name: { type: "string" }, id: { type: "string" }, columns: { type: "integer" }, rows: { type: "integer" } }, ["name"]) },
  { name: "update_page", description: "Rename a page or change its grid size (refused when items would fall outside).", inputSchema: obj({ page, name: { type: "string" }, columns: { type: "integer" }, rows: { type: "integer" } }, ["page"]) },
  { name: "remove_page", description: "Remove a page (not the last one, and not one that buttons switch to).", inputSchema: obj({ page }, ["page"]) },
  { name: "set_theme", description: `Merge theme fields (${THEME_KEYS.join(", ")}). null removes a field; replace:true starts from an empty theme.`, inputSchema: obj({ theme: { type: "object" }, replace: { type: "boolean" } }, ["theme"]) },
  { name: "preview_changes", description: "Dry run: apply one or more operations to the current layout WITHOUT saving and show the resulting ASCII grid. Call it before saving anything non-trivial.", inputSchema: obj({ operations: { type: "array", description: "[{tool: 'add_item'|'move_item'|..., args: {...}}]", items: { type: "object" } } }, ["operations"]) },
  { name: "undo", description: "Revert the last saved layout change (up to 50 are kept). Phones update immediately.", inputSchema: obj({}) },
];

export interface ToolResult { text: string; isError?: boolean }
const ok = (text: string): ToolResult => ({ text });
const err = (text: string): ToolResult => ({ text, isError: true });

export function applyOperation(layout: Layout, name: string, args: Record<string, any>) {
  const op = OPERATIONS[name];
  if (!op) return { ok: false as const, reason: `unknown operation "${name}" (known: ${Object.keys(OPERATIONS).join(", ")})` };
  return op(layout, args ?? {});
}

export async function callTool(api: AgentApi, name: string, args: Record<string, any> = {}): Promise<ToolResult> {
  try {
    if (name === "get_layout") {
      const layout = await api.getLayout();
      const ref = typeof args.pageId === "string" && args.pageId ? args.pageId : typeof args.page === "string" && args.page ? args.page : undefined;
      let pages = layout.pages;
      if (ref !== undefined) {
        pages = layout.pages.filter((p) => p.id === ref || p.name.toLowerCase() === ref.toLowerCase());
        if (!pages.length) return err(`no page "${ref}" (pages: ${layout.pages.map((p) => `${p.id} "${p.name}"`).join(", ")})`);
      }
      const grid = pages.map((p) => layoutGrid(layout, p.id)).join("\n\n");
      const theme = layout.theme ? `\nTheme: ${JSON.stringify(layout.theme)}` : "";
      const raw = ref !== undefined ? { ...layout, pages } : layout;
      return ok(grid + theme + (args.json ? `\n\n${JSON.stringify(raw, null, 2)}` : ""));
    }
    if (name === "list_widgets") return ok(TOOLS.find((t) => t.name === "list_widgets")!.description);
    if (name === "search_icons") {
      const q = String(args.query ?? "").toLowerCase().trim();
      if (!q) return err("query is required");
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 20));
      const cat = await api.catalog();
      const hits: { name: string; score: number; note: string }[] = [];
      for (const [n, v] of Object.entries<any>(cat.icons ?? {})) {
        const tags: string[] = Array.isArray(v.t) ? v.t : String(v.t ?? "").split(/[\s,]+/);
        const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : tags.some((t) => t === q) ? 3 : tags.some((t) => t.includes(q)) ? 4 : 99;
        if (score < 99) hits.push({ name: n, score, note: v.c ?? "" });
      }
      for (const n of Object.keys(cat.brands ?? {})) {
        const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 99;
        if (score < 99) hits.push({ name: `lobe:${n}`, score, note: "brand" });
      }
      hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
      return ok(hits.length ? hits.slice(0, limit).map((h) => `${h.name}  (${h.note})`).join("\n") : `no icon matches "${q}"`);
    }
    if (name === "list_apps") {
      const q = String(args.query ?? "").toLowerCase();
      const apps = (await api.apps()).filter((a) => !q || a.name.toLowerCase().includes(q));
      return ok(apps.length ? apps.slice(0, 200).map((a) => `${a.name}  app:${a.bundleId ?? "?"}`).join("\n") : "no apps found");
    }
    if (name === "undo") {
      const r = await api.undo();
      return ok(`Undone. Current layout:\n\n${layoutGrid(r.layout)}`);
    }
    if (name === "preview_changes") {
      const ops = args.operations;
      if (!Array.isArray(ops) || !ops.length) return err('"operations" must be a non-empty array of {tool, args}');
      let layout = await api.getLayout();
      const notes: string[] = [];
      for (const [i, o] of ops.entries()) {
        const r = applyOperation(layout, String(o?.tool), o?.args ?? {});
        if (!r.ok) return err(`operation ${i + 1} (${o?.tool}) failed: ${r.reason}`);
        layout = r.layout;
        notes.push(`${i + 1}. ${r.note}`);
      }
      return ok(`Preview only, nothing saved.\n${notes.join("\n")}\n\n${layoutGrid(layout)}`);
    }
    if (OPERATIONS[name]) {
      const r = applyOperation(await api.getLayout(), name, args);
      if (!r.ok) return err(r.reason);
      await api.putLayout(r.layout);
      const pageRef = typeof args.toPage === "string" ? args.toPage : typeof args.page === "string" ? args.page : undefined;
      return ok(`${r.note}. Saved; connected phones updated.\n\n${layoutGrid(r.layout, pageRef && r.layout.pages.some((p) => p.id === pageRef) ? pageRef : undefined)}`);
    }
    return err(`unknown tool "${name}"`);
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
}
