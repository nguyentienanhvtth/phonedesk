import { isIconName } from "@shared/icons";
import { t } from "@/lib/i18n";
import type { Action, AiProvider, HassEntity, Item, MacApp, Sound, WidgetKind } from "@/types";

export type PaletteGroup = "widget" | "media" | "sound" | "home" | "app" | "keys" | "system";

export const GROUP_LABEL: Record<PaletteGroup, string> = {
  widget: "Widget",
  media: "Media / Volume",
  sound: "Sounds",
  home: "Home",
  app: "Apps",
  keys: "Shortcuts / Typing",
  system: "System / Shell",
};

/** What a palette entry creates, before it gets an id and a position. */
export type Blueprint = Omit<Item, "id" | "x" | "y"> | (Omit<Extract<Item, { kind: "widget" }>, "id" | "x" | "y">);

export interface PaletteEntry {
  key: string;
  group: PaletteGroup;
  /** English text for static entries (translated at render with `entryLabel`); the raw name for apps, sounds and entities. */
  label: string;
  hint?: string;
  /** Shared icon name (Tabler/brand), `app:<bundleId>` or emoji. */
  icon: string;
  size: [number, number];
  /** Sub-categories under the group, outermost first (Home: [area, kind]). Empty = directly in the group. */
  path?: string[];
  /** Home Assistant entity that is currently unavailable. */
  unavailable?: boolean;
  /** Extra words the search matches (English; the Vietnamese variant is looked up with t()). */
  tags?: string;
  make: () => Omit<Item, "id" | "x" | "y">;
}

const button = (label: string, icon: string, action: Action): Omit<Item, "id" | "x" | "y"> => ({ kind: "button", label, icon, action }) as Omit<Item, "id" | "x" | "y">;
const widget = (w: WidgetKind, extra: Record<string, unknown> = {}): Omit<Item, "id" | "x" | "y"> => ({ kind: "widget", widget: w, ...extra }) as Omit<Item, "id" | "x" | "y">;

/** Groups whose labels and hints are user data (app names, sounds, Home Assistant entities), never translated. */
const RAW_GROUPS = new Set<PaletteGroup>(["app", "sound", "home"]);
/** Label to show for an entry: static entries are translated, data-driven ones are shown as they are. */
export const entryLabel = (e: PaletteEntry): string => (RAW_GROUPS.has(e.group) && e.key !== "sound-stop" ? e.label : t(e.label));
export const entryHint = (e: PaletteEntry): string => (e.hint === undefined ? "" : e.group === "app" || e.group === "home" ? e.hint : t(e.hint));

const quota = (p: AiProvider, label: string, color?: string): PaletteEntry => ({
  key: `quota-${p}`, group: "widget", path: ["AI"], label: `Quota ${label}`, hint: "Remaining quota", icon: isIconName(p) ? p : "sparkles", size: [2, 2], tags: "quota usage limit ai",
  make: () => widget("quota", { provider: p, ...(color ? { color } : {}) }),
});

export const STATIC_ENTRIES: PaletteEntry[] = [
  { key: "w-clock", group: "widget", path: ["Time"], label: "Clock", icon: "clock", size: [2, 1], tags: "clock time", make: () => widget("clock") },
  { key: "w-cpu", group: "widget", path: ["System"], label: "CPU", icon: "cpu", size: [2, 1], tags: "cpu processor", make: () => widget("cpu") },
  { key: "w-mem", group: "widget", path: ["System"], label: "RAM", icon: "server", size: [2, 1], tags: "ram memory", make: () => widget("memory") },
  { key: "w-uptime", group: "widget", path: ["System"], label: "Uptime", icon: "clock", size: [2, 1], tags: "uptime", make: () => widget("uptime") },
  { key: "w-net", group: "widget", path: ["System"], label: "Network", icon: "wifi", size: [2, 1], tags: "network", make: () => widget("network") },
  { key: "w-load", group: "widget", path: ["System"], label: "System load", icon: "activity", size: [2, 1], tags: "load", make: () => widget("load") },
  { key: "w-cputemp", group: "widget", path: ["System"], label: "CPU temperature", hint: "Windows: run LibreHardwareMonitor", icon: "cpu", size: [2, 1], tags: "cpu temperature temp heat sensor librehardwaremonitor", make: () => widget("cputemp") },
  { key: "w-gpu", group: "widget", path: ["System"], label: "GPU", hint: "NVIDIA load, temperature, memory", icon: "gauge", size: [2, 1], tags: "gpu nvidia graphics vram temperature", make: () => widget("gpu") },
  { key: "w-np", group: "widget", path: ["Media"], label: "Now playing", icon: "music3", size: [4, 2], tags: "now playing music", make: () => widget("nowplaying") },

  quota("claude", "Claude", "#d97757"),
  quota("codex", "Codex"),
  quota("antigravity", "Antigravity", "#60a5fa"),
  quota("opencode", "OpenCode"),
  quota("grok", "Grok"),
  { key: "w-sessions", group: "widget", path: ["AI"], label: "AI sessions", hint: "Running sessions", icon: "sparkles", size: [2, 3], tags: "sessions", make: () => widget("sessions") },

  { key: "m-play", group: "media", label: "Play / Pause", icon: "play", size: [1, 1], make: () => button(t("Play / Stop"), "play", { type: "media", command: "playpause" }) },
  { key: "m-prev", group: "media", label: "Previous track", icon: "skip-prev", size: [1, 1], make: () => button(t("Previous track"), "skip-prev", { type: "media", command: "previous" }) },
  { key: "m-next", group: "media", label: "Next track", icon: "skip-next", size: [1, 1], make: () => button(t("Next track"), "skip-next", { type: "media", command: "next" }) },
  { key: "v-mute", group: "media", label: "Mute", icon: "volume-x", size: [1, 1], make: () => button(t("Mute"), "volume-x", { type: "volume", command: "mute" }) },
  { key: "v-up", group: "media", label: "Volume up", icon: "volume-high", size: [1, 1], make: () => button(t("Volume up"), "volume-high", { type: "volume", command: "up" }) },
  { key: "v-down", group: "media", label: "Volume down", icon: "volume-low", size: [1, 1], make: () => button(t("Volume down"), "volume-low", { type: "volume", command: "down" }) },

  { key: "m-mic", group: "media", label: "Microphone on / off", icon: "microphone", size: [1, 1], tags: "mic microphone mute unmute toggle", make: () => button(t("Mic"), "microphone", { type: "mic", command: "toggle" }) },
  { key: "v-set", group: "media", label: "Set volume to 50%", icon: "adjustments-horizontal", size: [1, 1], tags: "volume level percent set", make: () => button(t("Volume 50%"), "adjustments-horizontal", { type: "set-volume", level: 50 }) },

  { key: "sound-stop", group: "sound", label: "Stop all sounds", icon: "player-stop", size: [1, 1], tags: "stop sound", make: () => button(t("Stop sound"), "player-stop", { type: "sound-stop" }) },

  { key: "a-weather", group: "widget", path: ["Time"], label: "Weather", hint: "Now, hourly, 7 days", icon: "sun", size: [2, 2], tags: "weather rain sun temperature", make: () => widget("weather", { weather: { source: "auto" } }) },
  { key: "a-value", group: "widget", path: ["Other"], label: "Pushed value", hint: "A number from a webhook", icon: "activity", size: [2, 1], tags: "webhook push value curl", make: () => widget("value", { push: { key: "gia-tri" } }) },
  { key: "a-notify", group: "widget", path: ["Other"], label: "Notifications", hint: "Recent notifications", icon: "bell", size: [2, 2], tags: "notifications webhook", make: () => widget("notifications") },
  { key: "a-macro", group: "keys", path: ["Custom"], label: "Macro", hint: "Multi-step sequence", icon: "bolt", size: [1, 1], tags: "macro sequence", make: () => button(t("Macro"), "bolt", { type: "macro", steps: [{ kind: "hotkey", keys: "" }] }) },

  { key: "k-copy", group: "keys", path: ["Editing"], label: "Copy", icon: "copy", size: [1, 1], tags: "copy cmd+c", make: () => button(t("Copy"), "copy", { type: "hotkey", keys: "cmd+c" }) },
  { key: "k-paste", group: "keys", path: ["Editing"], label: "Paste", icon: "clipboard", size: [1, 1], tags: "paste cmd+v", make: () => button(t("Paste"), "clipboard", { type: "hotkey", keys: "cmd+v" }) },
  { key: "k-undo", group: "keys", path: ["Editing"], label: "Undo", icon: "undo", size: [1, 1], tags: "undo cmd+z", make: () => button(t("Undo"), "undo", { type: "hotkey", keys: "cmd+z" }) },
  { key: "k-redo", group: "keys", path: ["Editing"], label: "Redo", icon: "redo", size: [1, 1], tags: "redo cmd+shift+z", make: () => button(t("Redo"), "redo", { type: "hotkey", keys: "cmd+shift+z" }) },
  { key: "k-shot", group: "keys", path: ["System"], label: "Capture region", icon: "camera", size: [1, 1], tags: "screenshot capture", make: () => button(t("Capture region"), "camera", { type: "hotkey", keys: "cmd+shift+4" }) },
  { key: "k-lock", group: "keys", path: ["System"], label: "Lock Mac", icon: "lock", size: [1, 1], tags: "lock cmd+ctrl+q lock screen", make: () => button(t("Lock Mac"), "lock", { type: "hotkey", keys: "ctrl+cmd+q" }) },
  { key: "k-spot", group: "keys", path: ["System"], label: "Spotlight", icon: "search", size: [1, 1], tags: "spotlight search cmd+space", make: () => button("Spotlight", "search", { type: "hotkey", keys: "cmd+space" }) },
  // Windows: real Windows-key shortcuts (shown on Windows only, see WIN_ONLY_ENTRIES)
  { key: "w-shot", group: "keys", path: ["Windows"], label: "Snipping Tool", hint: "Win+Shift+S", icon: "camera", size: [1, 1], tags: "screenshot snip capture win+shift+s", make: () => button(t("Screenshot"), "camera", { type: "hotkey", keys: "win+shift+s" }) },
  { key: "w-lock", group: "keys", path: ["Windows"], label: "Lock PC", hint: "LockWorkStation", icon: "lock", size: [1, 1], tags: "lock screen win+l", make: () => button(t("Lock"), "lock", { type: "shell", command: "rundll32.exe user32.dll,LockWorkStation" }) },
  { key: "w-search", group: "keys", path: ["Windows"], label: "Windows Search", hint: "Win+S", icon: "search", size: [1, 1], tags: "search start win+s", make: () => button(t("Search"), "search", { type: "hotkey", keys: "win+s" }) },
  { key: "w-taskview", group: "keys", path: ["Windows"], label: "Task View", hint: "Win+Tab", icon: "layout-grid", size: [1, 1], tags: "task view windows win+tab", make: () => button(t("Task View"), "layout-grid", { type: "hotkey", keys: "win+tab" }) },
  { key: "w-desktop", group: "keys", path: ["Windows"], label: "Show desktop", hint: "Win+D", icon: "device-desktop", size: [1, 1], tags: "desktop minimize win+d", make: () => button(t("Desktop"), "device-desktop", { type: "hotkey", keys: "win+d" }) },
  { key: "w-clipboard", group: "keys", path: ["Windows"], label: "Clipboard history", hint: "Win+V", icon: "clipboard-paste", size: [1, 1], tags: "clipboard history win+v", make: () => button(t("Clipboard"), "clipboard-paste", { type: "hotkey", keys: "win+v" }) },
  { key: "w-taskmgr", group: "keys", path: ["Windows"], label: "Task Manager", hint: "Ctrl+Shift+Esc", icon: "activity", size: [1, 1], tags: "task manager processes ctrl+shift+esc", make: () => button(t("Task Manager"), "activity", { type: "hotkey", keys: "ctrl+shift+escape" }) },
  { key: "w-gamebar", group: "keys", path: ["Gaming"], label: "Xbox Game Bar", hint: "Win+G", icon: "device-gamepad-2", size: [1, 1], tags: "game bar xbox overlay win+g", make: () => button(t("Game Bar"), "device-gamepad-2", { type: "hotkey", keys: "win+g" }) },
  { key: "w-ptt", group: "keys", path: ["Gaming"], label: "Push-to-talk (hold)", hint: "Hold to keep the key down", icon: "microphone", size: [1, 1], tags: "push to talk ptt hold discord voice key", make: () => button(t("Talk"), "microphone", { type: "hotkey", keys: "f13", hold: true }) },
  { key: "w-appvol", group: "keys", path: ["Gaming"], label: "Game volume down", hint: "Per-app volume (Windows)", icon: "volume", size: [1, 1], tags: "app volume mixer per-app game discord spotify", make: () => button(t("Game vol −"), "volume", { type: "app-volume", app: "", command: "down", step: 10 }) },
  { key: "w-outdev", group: "keys", path: ["Gaming"], label: "Switch speakers / headset", hint: "Windows audio device", icon: "headphones", size: [1, 1], tags: "output device headset speakers switch audio default", make: () => button(t("Audio out"), "headphones", { type: "output-device", devices: [] }) },
  { key: "w-record", group: "keys", path: ["Gaming"], label: "Clip the last 30 s", hint: "Win+Alt+G", icon: "video", size: [1, 1], tags: "record clip capture game bar win+alt+g", make: () => button(t("Clip 30s"), "video", { type: "hotkey", keys: "win+alt+g" }) },

  { key: "k-custom", group: "keys", path: ["Custom"], label: "Custom shortcut", icon: "keyboard", size: [1, 1], tags: "hotkey", make: () => button(t("Shortcut"), "keyboard", { type: "hotkey", keys: "" }) },
  { key: "k-type", group: "keys", path: ["Custom"], label: "Type text", icon: "text", size: [1, 1], tags: "type text", make: () => button(t("Type text"), "text", { type: "type", text: "" }) },

  { key: "s-url", group: "system", label: "Open web address", icon: "globe", size: [1, 1], tags: "url link", make: () => button(t("Open web"), "globe", { type: "open", target: "https://" }) },
  { key: "s-shell", group: "system", label: "Run shell command", icon: "terminal-square", size: [1, 1], tags: "shell command terminal", make: () => button(t("Command"), "terminal-square", { type: "shell", command: "" }) },
  { key: "s-page", group: "system", label: "Switch page", icon: "layout", size: [1, 1], tags: "page", make: () => button(t("Page"), "layout", { type: "page", page: "" }) },
];

export const appEntry = (a: MacApp): PaletteEntry => ({
  key: `app-${a.bundleId}`, group: "app", path: [appCategory(a.category)], label: a.name, hint: a.bundleId, icon: `app:${a.bundleId}`, size: [1, 1], tags: a.bundleId,
  make: () => button(a.name, `app:${a.bundleId}`, { type: "open", target: `bundle:${a.bundleId}` }),
});

export const soundEntry = (s: Sound): PaletteEntry => ({
  key: `snd-${s.id}`, group: "sound", label: s.name, hint: "Sound", icon: "volume", size: [1, 1], tags: "sound mp3 meme",
  make: () => button(s.name, "volume", { type: "sound", sound: s.id, on: "mac", volume: 100, mode: "restart" }),
});

/** Raw category -> English category label (also accepts the English labels themselves). */
const APP_CAT_EN: Record<string, string> = {
  Productivity: "Productivity", "Developer tools": "Developer tools", Social: "Social", Entertainment: "Entertainment", Music: "Music", "Photo & video": "Photo & video", Utilities: "Utilities", System: "System",
  productivity: "Productivity", business: "Productivity", finance: "Productivity", education: "Productivity", reference: "Productivity", news: "Productivity", "developer-tools": "Developer tools",
  "social-networking": "Social", entertainment: "Entertainment", games: "Entertainment", "action-games": "Entertainment", music: "Music", photography: "Photo & video", video: "Photo & video", "graphics-design": "Photo & video",
  utilities: "Utilities", lifestyle: "Utilities", healthcare: "Utilities", system: "System",
};
export const APP_CATEGORIES = ["Productivity", "Developer tools", "Social", "Entertainment", "Music", "Photo & video", "Utilities", "Other", "System"];
/** Maps whatever the agent sends (`public.app-category.productivity`, "productivity" or a category label) to one of APP_CATEGORIES. */
export function appCategory(raw: string | undefined): string {
  if (!raw) return "Other";
  const k = raw.replace(/^public\.app-category\./, "").replace(/^[a-z]+games$/, "games");
  return APP_CAT_EN[k] ?? APP_CAT_EN[k.toLowerCase()] ?? "Other";
}

const WIDE_DOMAINS = new Set(["sensor", "climate", "weather", "binary_sensor", "water_heater", "humidifier"]);
/** Home Assistant domain -> English label (translated with t() when shown). */
export const DOMAIN_EN: Record<string, string> = {
  light: "Lights", switch: "Switches", sensor: "Sensors", binary_sensor: "Binary sensors", climate: "Air conditioning", cover: "Covers / blinds", fan: "Fans", vacuum: "Vacuums",
  scene: "Scenes", script: "Scripts", button: "Buttons", automation: "Automations", media_player: "Media", lock: "Locks", input_boolean: "Virtual switches", weather: "Weather",
  humidifier: "Humidifiers", water_heater: "Water heaters", camera: "Cameras", remote: "Remotes", siren: "Sirens", number: "Number entities", select: "Selects",
};
const MOTION = /motion|occupancy|presence|chuyen_dong|co_nguoi|pir/i;
export const SCENE_GROUP = "Scenes & scripts";
export const NO_AREA = "No area";
const SCENE_DOMAINS = new Set(["scene", "script", "button"]);

/** English label of the entity's kind; stored in the entry path, translated at render. */
export function entityKind(e: HassEntity): string {
  if (e.domain === "switch" && /outlet|plug|o_cam|socket/i.test(`${e.id} ${e.name}`)) return "Outlets";
  if (e.domain === "binary_sensor") return MOTION.test(`${e.id} ${e.name}`) ? "Presence / motion" : "Binary sensors";
  return DOMAIN_EN[e.domain] ?? e.domain;
}

export const entityEntry = (e: HassEntity): PaletteEntry => ({
  key: `ha-${e.id}`, group: "home", label: e.name, hint: e.id, icon: "home", size: WIDE_DOMAINS.has(e.domain) ? [2, 1] : [1, 1],
  path: SCENE_DOMAINS.has(e.domain) ? [SCENE_GROUP] : [e.area || NO_AREA, entityKind(e)],
  unavailable: e.state === "unavailable", tags: `${e.id} ${e.area ?? ""} ${e.domain} home assistant`,
  make: () => ({ kind: "widget", widget: "entity", entity: { id: e.id, ...(e.name && e.name !== e.id ? { name: e.name } : {}) } }) as Omit<Item, "id" | "x" | "y">,
});
