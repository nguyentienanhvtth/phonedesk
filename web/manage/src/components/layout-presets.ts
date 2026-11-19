import type { Layout } from "@/types";

export interface LayoutPreset {
  id: string;
  name: string;
  hint: string;
  platform: "win32" | "darwin" | "all";
  layout: Layout;
}

/** Gaming PC layout: CS2, Steam, Discord, Spotify, volume/mic controls, GPU/CPU/RAM widgets. */
const gamingPcLayout: Layout = {
  pages: [
    {
      id: "gaming",
      name: "Gaming",
      columns: 8,
      rows: 3,
      items: [
        { id: "b-cs2", kind: "button", label: "CS2", icon: "device-gamepad-2", color: "#f97316", x: 0, y: 0, action: { type: "open", target: "steam://rungameid/730" } },
        { id: "b-steam", kind: "button", label: "Steam", icon: "brand-steam", color: "#1b2838", x: 1, y: 0, action: { type: "open", target: "steam://" } },
        { id: "b-discord", kind: "button", label: "Discord", icon: "brand-discord", color: "#5865f2", x: 2, y: 0, action: { type: "open", target: "discord://" } },
        { id: "b-spotify", kind: "button", label: "Spotify", icon: "brand-spotify", color: "#1db954", x: 3, y: 0, action: { type: "open", target: "spotify:" } },
        { id: "w-gpu", kind: "widget", widget: "gpu", x: 4, y: 0, w: 2, h: 1 },
        { id: "w-cpu", kind: "widget", widget: "cpu", x: 6, y: 0, w: 2, h: 1 },
        { id: "b-volup", kind: "button", label: "Vol +", icon: "volume", x: 0, y: 1, action: { type: "volume", command: "up" } },
        { id: "b-voldown", kind: "button", label: "Vol -", icon: "volume-2", x: 1, y: 1, action: { type: "volume", command: "down" } },
        { id: "b-mute", kind: "button", label: "Mute", icon: "volume-off", x: 2, y: 1, action: { type: "volume", command: "mute" } },
        { id: "b-micmute", kind: "button", label: "Mic Mute", icon: "microphone-off", color: "#ef4444", x: 3, y: 1, action: { type: "hotkey", keys: "cmd+shift+m" } },
        { id: "w-mem", kind: "widget", widget: "memory", x: 4, y: 1, w: 2, h: 1 },
        { id: "w-net", kind: "widget", widget: "network", x: 6, y: 1, w: 2, h: 1 },
        { id: "w-np", kind: "widget", widget: "nowplaying", x: 0, y: 2, w: 4, h: 1 },
        { id: "b-prev", kind: "button", label: "Prev", icon: "player-skip-back", x: 4, y: 2, action: { type: "media", command: "previous" } },
        { id: "b-play", kind: "button", label: "Play", icon: "player-play", x: 5, y: 2, action: { type: "media", command: "playpause" } },
        { id: "b-next", kind: "button", label: "Next", icon: "player-skip-forward", x: 6, y: 2, action: { type: "media", command: "next" } },
        { id: "b-stats", kind: "button", label: "Stats", icon: "chart-bar", x: 7, y: 2, action: { type: "page", page: "stats" } },
      ],
    },
    {
      id: "stats",
      name: "Stats",
      columns: 8,
      rows: 3,
      items: [
        { id: "w-gpu2", kind: "widget", widget: "gpu", x: 0, y: 0, w: 4, h: 2, metric: { chart: "gauge" } },
        { id: "w-cpu2", kind: "widget", widget: "cpu", x: 4, y: 0, w: 2, h: 1 },
        { id: "w-mem2", kind: "widget", widget: "memory", x: 6, y: 0, w: 2, h: 1 },
        { id: "w-net2", kind: "widget", widget: "network", x: 4, y: 1, w: 2, h: 1 },
        { id: "w-load", kind: "widget", widget: "load", x: 6, y: 1, w: 2, h: 1 },
        { id: "w-clock", kind: "widget", widget: "clock", x: 0, y: 2, w: 4, h: 1 },
        { id: "b-gaming", kind: "button", label: "Gaming", icon: "device-gamepad-2", x: 4, y: 2, w: 2, h: 1, action: { type: "page", page: "gaming" } },
        { id: "b-keys", kind: "button", label: "Keys", icon: "keyboard", x: 6, y: 2, w: 2, h: 1, action: { type: "page", page: "keys" } },
      ],
    },
    {
      id: "keys",
      name: "Keys",
      columns: 8,
      rows: 3,
      items: [
        { id: "b-prev2", kind: "button", label: "Prev", icon: "player-skip-back", x: 0, y: 0, action: { type: "media", command: "previous" } },
        { id: "b-play2", kind: "button", label: "Play", icon: "player-play", x: 1, y: 0, action: { type: "media", command: "playpause" } },
        { id: "b-next2", kind: "button", label: "Next", icon: "player-skip-forward", x: 2, y: 0, action: { type: "media", command: "next" } },
        { id: "b-volup2", kind: "button", label: "Vol +", icon: "volume", x: 3, y: 0, action: { type: "volume", command: "up" } },
        { id: "b-voldown2", kind: "button", label: "Vol -", icon: "volume-2", x: 4, y: 0, action: { type: "volume", command: "down" } },
        { id: "b-mute2", kind: "button", label: "Mute", icon: "volume-off", x: 5, y: 0, action: { type: "volume", command: "mute" } },
        { id: "b-micmute2", kind: "button", label: "Mic", icon: "microphone-off", color: "#ef4444", x: 6, y: 0, action: { type: "hotkey", keys: "cmd+shift+m" } },
        { id: "b-esc", kind: "button", label: "Esc", icon: "x", x: 7, y: 0, action: { type: "hotkey", keys: "escape" } },
        { id: "b-copy", kind: "button", label: "Copy", icon: "copy", x: 0, y: 1, action: { type: "hotkey", keys: "cmd+c" } },
        { id: "b-paste", kind: "button", label: "Paste", icon: "clipboard", x: 1, y: 1, action: { type: "hotkey", keys: "cmd+v" } },
        { id: "b-cut", kind: "button", label: "Cut", icon: "cut", x: 2, y: 1, action: { type: "hotkey", keys: "cmd+x" } },
        { id: "b-undo", kind: "button", label: "Undo", icon: "arrow-back-up", x: 3, y: 1, action: { type: "hotkey", keys: "cmd+z" } },
        { id: "b-redo", kind: "button", label: "Redo", icon: "arrow-forward-up", x: 4, y: 1, action: { type: "hotkey", keys: "cmd+shift+z" } },
        { id: "b-selectall", kind: "button", label: "Sel All", icon: "select-all", x: 5, y: 1, action: { type: "hotkey", keys: "cmd+a" } },
        { id: "b-find", kind: "button", label: "Find", icon: "search", x: 6, y: 1, action: { type: "hotkey", keys: "cmd+f" } },
        { id: "b-save", kind: "button", label: "Save", icon: "device-floppy", x: 7, y: 1, action: { type: "hotkey", keys: "cmd+s" } },
        { id: "b-winkey", kind: "button", label: "Win", icon: "apps", x: 0, y: 2, action: { type: "hotkey", keys: "cmd" } },
        { id: "b-taskview", kind: "button", label: "Tasks", icon: "layout-cards", x: 1, y: 2, action: { type: "hotkey", keys: "cmd+tab" } },
        { id: "b-desktop", kind: "button", label: "Desktop", icon: "layout-bottombar", x: 2, y: 2, action: { type: "hotkey", keys: "cmd+d" } },
        { id: "b-lock", kind: "button", label: "Lock", icon: "lock", x: 3, y: 2, action: { type: "hotkey", keys: "cmd+l" } },
        { id: "b-screenshot", kind: "button", label: "Snip", icon: "screenshot", x: 4, y: 2, action: { type: "hotkey", keys: "cmd+shift+s" } },
        { id: "b-settings", kind: "button", label: "Settings", icon: "settings", x: 5, y: 2, action: { type: "open", target: "ms-settings:" } },
        { id: "b-gaming2", kind: "button", label: "Gaming", icon: "device-gamepad-2", x: 6, y: 2, w: 2, h: 1, action: { type: "page", page: "gaming" } },
      ],
    },
  ],
};

/** Basic media/volume layout (cross-platform). */
const basicMediaLayout: Layout = {
  pages: [
    {
      id: "main",
      name: "Main",
      columns: 8,
      rows: 3,
      items: [
        { id: "w-np", kind: "widget", widget: "nowplaying", x: 0, y: 0, w: 4, h: 2 },
        { id: "w-clock", kind: "widget", widget: "clock", x: 4, y: 0, w: 4, h: 2 },
        { id: "b-prev", kind: "button", label: "Prev", icon: "player-skip-back", x: 0, y: 2, action: { type: "media", command: "previous" } },
        { id: "b-play", kind: "button", label: "Play", icon: "player-play", x: 1, y: 2, action: { type: "media", command: "playpause" } },
        { id: "b-next", kind: "button", label: "Next", icon: "player-skip-forward", x: 2, y: 2, action: { type: "media", command: "next" } },
        { id: "b-voldown", kind: "button", label: "Vol -", icon: "volume-2", x: 4, y: 2, action: { type: "volume", command: "down" } },
        { id: "b-volup", kind: "button", label: "Vol +", icon: "volume", x: 5, y: 2, action: { type: "volume", command: "up" } },
        { id: "b-mute", kind: "button", label: "Mute", icon: "volume-off", x: 6, y: 2, action: { type: "volume", command: "mute" } },
        { id: "b-spotify", kind: "button", label: "Spotify", icon: "brand-spotify", color: "#1db954", x: 3, y: 2, action: { type: "open", target: "spotify:" } },
        { id: "b-stats", kind: "button", label: "Stats", icon: "chart-bar", x: 7, y: 2, action: { type: "page", page: "stats" } },
      ],
    },
    {
      id: "stats",
      name: "Stats",
      columns: 8,
      rows: 3,
      items: [
        { id: "w-cpu", kind: "widget", widget: "cpu", x: 0, y: 0, w: 4, h: 1 },
        { id: "w-mem", kind: "widget", widget: "memory", x: 4, y: 0, w: 4, h: 1 },
        { id: "w-net", kind: "widget", widget: "network", x: 0, y: 1, w: 4, h: 1 },
        { id: "w-load", kind: "widget", widget: "load", x: 4, y: 1, w: 4, h: 1 },
        { id: "b-main", kind: "button", label: "Main", icon: "home", x: 0, y: 2, w: 2, h: 1, action: { type: "page", page: "main" } },
        { id: "w-uptime", kind: "widget", widget: "uptime", x: 2, y: 2, w: 4, h: 1 },
        { id: "w-clock2", kind: "widget", widget: "clock", clock: { showDate: true, showSeconds: false }, x: 6, y: 2, w: 2, h: 1 },
      ],
    },
  ],
};

/** Layout presets available from the manage UI. */
export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "gaming-pc",
    name: "Gaming PC",
    hint: "CS2, Steam, Discord, Spotify, GPU/CPU stats, volume/mic controls",
    platform: "win32",
    layout: gamingPcLayout,
  },
  {
    id: "basic-media",
    name: "Media Remote",
    hint: "Now playing, volume controls, system stats",
    platform: "all",
    layout: basicMediaLayout,
  },
];

/** Returns presets that work on the given platform (or all platforms). */
export function presetsForPlatform(platform: string | undefined): LayoutPreset[] {
  return LAYOUT_PRESETS.filter((p) => p.platform === "all" || p.platform === platform);
}
