import { t } from "./lib/i18n";
import { asPlatform, type Platform } from "./lib/platform";
import { AI_PROVIDERS, type IconCatalog, type MacApp, type Sound, type HassConfig, type HassEntity, type HassService, type GeoPlace, type WebhookInfo, type AiProvider, type DeviceInfo, type About, type UpdateInfo, type DoctorItem, type DoctorStatus, type Integration, type Layout, type Pairing } from "./types";

import { normalizeAudioDevices, normalizeAudioSessions, normalizeRunningApps } from "./lib/gaming";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  // Every mutating call carries X-PhoneDesk (the agent refuses cross-site requests without it) and, unless it uploads a file, a JSON content type.
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const headers = new Headers(init?.headers);
    headers.set("X-PhoneDesk", "1");
    if (!headers.has("content-type") && !(init?.body instanceof Blob)) headers.set("Content-Type", "application/json");
    init = { ...init, headers };
  }
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ApiError(t("The PhoneDesk agent did not answer in time"), 0);
    throw new ApiError(t("Cannot reach the PhoneDesk agent"), 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const NAMES: Record<AiProvider, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", opencode: "OpenCode", grok: "Grok" };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * The agent returns an object keyed by provider id ({claude:{installed, settingsPath, cli, quota:{ok, error?, windows, plan, updatedAt}}, ...}).
 * Older/alternative shapes are still read tolerantly: an array or {integrations|providers: [...]},
 * status as "ok"/"error" or via ok/error/quota fields, hook as {supported, installed|enabled, settingsPath|path}.
 */
const isoOf = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : typeof v === "string" ? v : undefined;

/** OpenCode installs a plugin, the others a hook. */
const hookUrl = (id: AiProvider) => `/api/integrations/${id}/${id === "opencode" ? "plugin" : "hook"}`;

export function normalizeIntegrations(raw: unknown): Integration[] {
  const r0 = rec(raw);
  const list = Array.isArray(raw)
    ? raw
    : r0.integrations ?? r0.providers ?? Object.entries(r0).map(([id, v]) => ({ id, ...rec(v) }));
  const out: Integration[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const e = rec(entry);
    const id = str(e.id) as AiProvider | undefined;
    if (!id || !AI_PROVIDERS.includes(id)) continue;
    const quota = rec(e.quota);
    const error = str(e.error) ?? str(quota.error);
    const st = str(e.status) ?? str(quota.status);
    const okFlag = typeof e.ok === "boolean" ? e.ok : typeof quota.ok === "boolean" ? quota.ok : undefined;
    const status: Integration["status"] = error || st === "error" || okFlag === false ? "error" : st === "ok" || okFlag === true || (Array.isArray(e.windows) && e.windows.length > 0) ? "ok" : "unknown";
    // OpenCode reports its plugin under "plugin", Grok its hooks file under "hook"; both are installed/path pairs.
    const hookRaw = id === "opencode" ? e.plugin : e.hook;
    const h = hookRaw === undefined || hookRaw === null ? undefined : rec(hookRaw);
    const settingsPath = str(h?.settingsPath) ?? str(h?.path) ?? str(e.settingsPath);
    const hook = h || settingsPath || e.hookSupported !== undefined
      ? {
          supported: typeof h?.supported === "boolean" ? h.supported : e.hookSupported !== false,
          enabled: !!(h?.installed ?? h?.enabled ?? e.hookInstalled ?? e.hookEnabled ?? e.installed),
          settingsPath,
        }
      : undefined;
    const rawWindows = Array.isArray(e.windows) ? e.windows : Array.isArray(quota.windows) ? quota.windows : [];
    const windows = rawWindows.flatMap((w: unknown, i: number) => {
      const r = rec(w);
      const used = Number(r.usedPercent);
      if (!Number.isFinite(used)) return [];
      const resets = r.resetsAt;
      return [{
        id: str(r.id) ?? String(i),
        label: str(r.label) ?? str(r.id) ?? t("Window {n}", { n: i + 1 }),
        usedPercent: Math.min(100, Math.max(0, used)),
        resetsAt: typeof resets === "number" ? new Date(resets < 1e12 ? resets * 1000 : resets).toISOString() : str(resets),
      }];
    });
    const ah = e.askHook === undefined || e.askHook === null ? undefined : rec(e.askHook);
    const askHook = ah ? { enabled: !!(ah.installed ?? ah.enabled), idleOnly: !!ah.idleOnly } : undefined;
    const srcRaw = e.source ?? quota.source;
    const source = typeof srcRaw === "string" && srcRaw ? (srcRaw as Integration["source"]) : undefined;
    const reason = str(e.reason) ?? str(quota.reason) ?? str(e.sourceNote);
    out.push({ windows, source, id, name: str(e.name) ?? NAMES[id], status, error, plan: str(e.plan) ?? str(quota.plan), updatedAt: isoOf(e.updatedAt) ?? isoOf(quota.updatedAt), hook, ...(reason ? { reason } : {}), ...(id === "opencode" || id === "grok" ? { cliInstalled: e.installed === true, version: str(e.version), line: typeof e.line === "number" ? e.line : undefined, sessions: typeof e.sessions === "number" ? e.sessions : undefined, quotaReason: str(e.quotaReason) } : {}), ...(askHook ? { askHook } : {}) });
  }
  return out;
}

function normalizeApps(raw: unknown): MacApp[] {
  const list = Array.isArray(raw) ? raw : rec(raw).apps;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const r = rec(x);
    // macOS: bundle id. Windows: the agent's opaque app id (sent as bundleId, or as id/appId).
    const bundleId = str(r.bundleId) ?? str(r.id) ?? str(r.appId);
    const name = str(r.name);
    return bundleId && name ? [{ name, bundleId, path: str(r.path), category: str(r.category) }] : [];
  });
}

/** Ids of uploaded images from GET /api/icons: ["abc…"], [{id}] or {icons|images:[…]}. */
function normalizeUploads(raw: unknown): string[] {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : r.icons ?? r.images ?? r.items;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const id = typeof x === "string" ? x : str(rec(x).id);
    return id && /^[a-f0-9]{16}$/.test(id) ? [id] : [];
  });
}

const SND_HEX = /^(?:snd:)?([a-f0-9]{16})$/;
export function normalizeSounds(raw: unknown): Sound[] {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : r.sounds ?? r.items ?? r.clips;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const o = rec(x);
    const m = SND_HEX.exec(typeof x === "string" ? x : str(o.id) ?? "");
    if (!m) return [];
    const id = `snd:${m[1]}`;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return [{ id, name: str(o.name) ?? str(o.title) ?? str(o.filename) ?? m[1]!, size: num(o.size) ?? num(o.bytes), duration: num(o.duration), type: str(o.type) ?? str(o.mime) }];
  });
}
/** Playback URL of a clip (`snd:<hex>` or bare hex). */
export const soundUrl = (id: string) => `/sounds/${id.replace(/^snd:/, "")}`;
const asRec = rec;
export function normalizeHassEntities(raw: unknown): HassEntity[] {
  const list = Array.isArray(raw) ? raw : asRec(raw).entities;
  return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
    const o = asRec(x);
    const id = str(o.id) ?? str(o.entity_id);
    if (!id || !/^[a-z_]+\.[a-z0-9_]+$/.test(id)) return [];
    return [{ id, name: str(o.name) ?? id, domain: str(o.domain) ?? id.split(".")[0]!, area: str(o.area), state: o.state === undefined || o.state === null ? undefined : String(o.state), icon: str(o.icon) }];
  });
}
/** Accepts [{id|service, name?}], {"domain.service": {...}}, or HA's {domain: {service: {...}}}. */
export function normalizeHassServices(raw: unknown): HassService[] {
  const r = asRec(Array.isArray(raw) ? null : raw);
  const src = Array.isArray(raw) ? raw : r.services ?? raw;
  const out: HassService[] = [];
  if (Array.isArray(src)) {
    for (const x of src) {
      const o = asRec(x);
      const id = typeof x === "string" ? x : str(o.id) ?? str(o.service);
      if (id && /^[a-z_]+\.[a-z0-9_]+$/.test(id)) out.push({ id, name: str(o.name), description: str(o.description) });
    }
  } else {
    for (const [k, v] of Object.entries(asRec(src))) {
      if (/^[a-z_]+\.[a-z0-9_]+$/.test(k)) out.push({ id: k, name: str(asRec(v).name), description: str(asRec(v).description) });
      else for (const [s, d] of Object.entries(asRec(v))) out.push({ id: `${k}.${s}`, name: str(asRec(d).name), description: str(asRec(d).description) });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
export const appIconUrl = (bundleId: string) => `/api/apps/icon?bundleId=${encodeURIComponent(bundleId)}`;
export const uploadUrl = (id: string) => `/api/icons/img/${id}`;

export const api = {
  getCatalog: () => request<IconCatalog>("/api/icons/catalog"),
  getApps: async () => normalizeApps(await request<unknown>("/api/apps")),
  listUploads: async () => normalizeUploads(await request<unknown>("/api/icons")),
  /** Sends the raw PNG/JPEG bytes (Content-Type = the file's type). Returns the 16-hex id. */
  uploadIcon: async (file: File) => {
    const res = await request<unknown>("/api/icons", { method: "POST", headers: { "content-type": file.type }, body: file });
    const id = str(rec(res).id);
    if (!id) throw new ApiError(t("The agent did not return an image id"), 0);
    return id;
  },
  deleteUpload: (id: string) => request<unknown>(`/api/icons/img/${id}`, { method: "DELETE" }),
  listSounds: async () => normalizeSounds(await request<unknown>("/api/sounds")),
  /** Raw audio bytes (Content-Type = the file's type); the display name goes in ?name=. */
  uploadSound: async (file: File) => {
    const res = await request<unknown>(`/api/sounds?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    const s = normalizeSounds([res])[0];
    if (!s) throw new ApiError(t("The agent did not return a sound id"), 0);
    return s;
  },
  renameSound: (id: string, name: string) => request<unknown>(`/api/sounds/${id.replace(/^snd:/, "")}`, json("PATCH", { name })),
  deleteSound: (id: string) => request<unknown>(`/api/sounds/${id.replace(/^snd:/, "")}`, { method: "DELETE" }),
  getRunningApps: async () => normalizeRunningApps(await request<unknown>("/api/apps/running")),
  getAudioSessions: async () => normalizeAudioSessions(await request<unknown>("/api/audio/sessions")),
  getAudioDevices: async (flow: "output" | "input" = "output") => normalizeAudioDevices(await request<unknown>(`/api/audio/devices?flow=${flow}`)),
  getHass: () => request<HassConfig>("/api/hass/config"),
  putHassUrl: (url: string) => request<HassConfig>("/api/hass/config", json("PUT", { url })),
  /** The token is only ever sent, never read back. */
  putHassToken: (token: string) => request<unknown>("/api/hass/token", json("PUT", { token })),
  deleteHassToken: () => request<unknown>("/api/hass/token", { method: "DELETE" }),
  testHass: () => request<Partial<HassConfig> & { ok?: boolean }>("/api/hass/test", json("POST")),
  getHassEntities: async () => normalizeHassEntities(await request<unknown>("/api/hass/entities")),
  getHassServices: async () => normalizeHassServices(await request<unknown>("/api/hass/services")),
  geocode: async (q: string): Promise<GeoPlace[]> => {
    const raw = await request<unknown>(`/api/weather/geocode?q=${encodeURIComponent(q)}`);
    const list = Array.isArray(raw) ? raw : rec(raw).results ?? rec(raw).places ?? [];
    return (Array.isArray(list) ? list : []).flatMap((x: unknown) => {
      const o = rec(x);
      const lat = Number(o.lat ?? o.latitude), lon = Number(o.lon ?? o.longitude ?? o.lng);
      const name = str(o.name);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return [{ name, lat, lon, detail: [str(o.admin1) ?? str(o.region), str(o.country)].filter(Boolean).join(", ") || undefined }];
    });
  },
  getWebhook: async (): Promise<WebhookInfo> => {
    const o = rec(await request<unknown>("/api/webhooks"));
    const keyMasked = str(o.keyMasked);
    if (!keyMasked) throw new ApiError(t("The agent did not return a webhook key"), 0);
    return { keyMasked, examples: (Array.isArray(o.examples) ? o.examples : []).filter((x): x is string => typeof x === "string") };
  },
  /** The full key, only when the user asks to copy it. */
  revealWebhookKey: async () => str(rec(await request<unknown>("/api/webhooks?reveal=1")).key),
  rotateWebhook: async () => str(rec(await request<unknown>("/api/webhooks/key/rotate", json("POST"))).key),
  /** Resolves app/upload icons for the preview: {assets:{<icon value>: …}} (the deck reads layout.assets). */
  layoutAssets: async (layout: Layout): Promise<Record<string, unknown>> => {
    const raw = rec(await request<unknown>("/api/layout/assets", json("POST", { layout })));
    return rec(raw.assets ?? raw);
  },
  /** Platform of the agent's machine: GET /api/platform {id, label, keyNames}; undefined when the agent does not say. */
  getPlatform: async (): Promise<Platform | undefined> => {
    const o = rec(await request<unknown>("/api/platform"));
    return asPlatform(o.id ?? o.platform ?? o.os);
  },
  getAbout: async (): Promise<About> => {
    const o = rec(await request<unknown>("/api/about"));
    const version = str(o.version);
    if (!version) throw new ApiError(t("The agent did not report a version"), 0);
    const repo = (str(o.repo) ?? str(o.repository) ?? str(o.homepage) ?? "https://github.com/nguyentienanhvtth/phonedesk").replace(/(\.git)?\/*$/, "");
    const d = o.buildDate ?? o.builtAt ?? o.built;
    return { version: version.replace(/^v/, ""), commit: str(o.commit)?.replace(/-dirty$/, "").slice(0, 7), dirty: o.dirty === true || /dirty/.test(str(o.commit) ?? "") || undefined, buildDate: typeof d === "number" ? new Date(d < 1e12 ? d * 1000 : d).toISOString() : str(d), platform: str(o.platform), arch: str(o.arch), repo };
  },
  getUpdate: async (): Promise<UpdateInfo> => {
    const o = rec(await request<unknown>("/api/update"));
    return { current: str(o.current) ?? "", latest: str(o.latest) ?? null, available: o.available === true, checkedAt: typeof o.checkedAt === "number" ? o.checkedAt : null, enabled: o.enabled !== false, error: str(o.error) };
  },
  getDoctor: async (): Promise<DoctorItem[]> => {
    const raw = rec(await request<unknown>("/api/doctor"));
    const list = Array.isArray(raw.items) ? raw.items : [];
    return list.flatMap((x: unknown) => {
      const r = rec(x);
      const id = str(r.id);
      if (!id) return [];
      const st = r.status;
      const status: DoctorStatus = st === "ok" || st === "missing" || st === "denied" || st === "n/a" ? st : "unknown";
      const f = r.fix === undefined || r.fix === null ? undefined : rec(r.fix);
      const fixText = str(f?.text);
      return [{ id, status, name: str(r.name), detail: str(r.detail), ...(fixText || f?.settingsUrl ? { fix: { text: fixText ?? "", settingsUrl: str(f?.settingsUrl) } } : {}) }];
    });
  },
  openDoctorSettings: (id: string) => request<unknown>("/api/doctor/open", json("POST", { id })),
  requestDoctor: (id: string, reset = false) => request<unknown>("/api/doctor/request", json("POST", { id, reset })),
  getIntegrations: async () => {
    const raw = await request<unknown>("/api/integrations");
    // An old agent may still send an "openusage" block: it is ignored.
    return { integrations: normalizeIntegrations(raw) };
  },
  enableHook: (id: AiProvider) => request<unknown>(hookUrl(id), json("POST")),
  /** Installs (or updates) the AskUserQuestion hook; idleOnly = only when the user has been away for a minute. */
  enableAskHook: (idleOnly: boolean) => request<unknown>("/api/integrations/claude/ask-hook", json("POST", { idleOnly })),
  disableAskHook: () => request<unknown>("/api/integrations/claude/ask-hook", { method: "DELETE" }),
  disableHook: (id: AiProvider) => request<unknown>(hookUrl(id), { method: "DELETE" }),
  getLayout: () => request<Layout>("/api/layout"),
  // A save that hangs must not leave the page stuck on "Unsaved" with a spinning button: give up after 20 s and say so.
  putLayout: (layout: Layout) => request<unknown>("/api/layout", { ...json("PUT", layout), signal: AbortSignal.timeout(20_000) }),
  getDevices: () => request<DeviceInfo[]>("/api/devices"),
  /** Asks the deck on one device (or all, without deviceId) to reload. The reply may carry the number reached. */
  reloadDevices: (deviceId?: string) => request<unknown>("/api/devices/reload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deviceId ? { deviceId } : {}) }),
  revokeDevice: (id: string) => request<unknown>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPairing: () => request<Pairing>("/api/pairing"),
  regeneratePairing: () => request<Pairing>("/api/pairing/regenerate", json("POST")),
};
