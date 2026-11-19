// Built-in layout templates, shared by the agent (src/layouts) and the manage page (Layout templates).
// One source of truth: edit a template here and both sides get it. No imports: types are structural.
// Bump a template's `rev` when you change it so the manage page can offer to re-apply it.

/** Structural layout shape (the agent validates it with validateLayout, the manage page types it as Layout). */
export interface PresetLayout { version: 1; theme?: Record<string, unknown>; pages: { id: string; name: string; columns: number; rows: number; items: Record<string, unknown>[] }[]; rules?: Record<string, unknown>[] }

export interface LayoutPresetDef {
  id: string;
  name: string;
  hint: string;
  platform: "win32" | "darwin" | "all";
  /** Revision of the template; bump when the layout changes. */
  rev: number;
  layout: () => PresetLayout;
}

/** Gaming PC: volume/mic sliders + now playing, GPU/CPU/RAM stats, CS2/Steam/Discord/Spotify launchers. */
export function gamingPcLayout(): PresetLayout {
  return {
    version: 1,
    theme: { mode: "dark", orientation: "landscape", tileStyle: "ios", iconStroke: 2.25 },
    pages: [
      {
        id: "gaming",
        name: "Controls",
        columns: 8,
        rows: 3,
        items: [
          // Row 0: Volume/mic sliders + now playing
          { id: "w-volume", kind: "widget", widget: "volume", x: 0, y: 0, w: 2 },
          { id: "w-mic", kind: "widget", widget: "mic", x: 2, y: 0, w: 2 },
          { id: "w-media", kind: "widget", widget: "nowplaying", x: 4, y: 0, w: 4, h: 2 },
          // Row 1: Stats widgets
          { id: "w-gpu", kind: "widget", widget: "gpu", color: "#22c55e", x: 0, y: 1, w: 2 },
          { id: "w-cpu", kind: "widget", widget: "cpu", color: "#3b82f6", x: 2, y: 1, w: 2 },
          // Row 2: App launchers + navigation
          { id: "b-cs2", kind: "button", label: "CS2", icon: "device-gamepad-2", color: "#f97316", x: 0, y: 2, action: { type: "open", target: "steam://rungameid/730" } },
          { id: "b-steam", kind: "button", label: "Steam", icon: "brand-steam", color: "#1b2838", x: 1, y: 2, action: { type: "open", target: "steam:" } },
          { id: "b-discord", kind: "button", label: "Discord", icon: "brand-discord", color: "#5865f2", x: 2, y: 2, action: { type: "open", target: "Discord" } },
          { id: "b-spotify", kind: "button", label: "Spotify", icon: "brand-spotify", color: "#1db954", x: 3, y: 2, action: { type: "open", target: "spotify:" } },
          { id: "w-mem", kind: "widget", widget: "memory", color: "#8b5cf6", x: 4, y: 2, w: 2 },
          { id: "b-stats", kind: "button", label: "Stats", icon: "chart-line", color: "#0ea5e9", x: 6, y: 2, action: { type: "page", page: "stats" } },
          { id: "b-keys", kind: "button", label: "Keys", icon: "keyboard", color: "#6366f1", x: 7, y: 2, action: { type: "page", page: "keys" } },
        ],
      },
      {
        id: "stats",
        name: "Stats",
        columns: 8,
        rows: 3,
        items: [
          { id: "w-gpu2", kind: "widget", widget: "gpu", color: "#22c55e", x: 0, y: 0, w: 4, h: 2 },
          { id: "w-cpu2", kind: "widget", widget: "cpu", color: "#3b82f6", x: 4, y: 0, w: 2, h: 2 },
          { id: "w-mem2", kind: "widget", widget: "memory", color: "#8b5cf6", x: 6, y: 0, w: 2, h: 2 },
          { id: "w-net", kind: "widget", widget: "network", color: "#f59e0b", x: 0, y: 2, w: 2 },
          // Windows has no load average: the CPU temperature (LibreHardwareMonitor / ACPI) takes that slot
          { id: "w-cputemp", kind: "widget", widget: "cputemp", color: "#ec4899", x: 2, y: 2, w: 2 },
          { id: "w-clock", kind: "widget", widget: "clock", clock: { style: "digital" }, x: 4, y: 2, w: 2 },
          { id: "b-gaming", kind: "button", label: "Gaming", icon: "device-gamepad-2", color: "#f97316", x: 6, y: 2, action: { type: "page", page: "gaming" } },
          { id: "b-keys2", kind: "button", label: "Keys", icon: "keyboard", color: "#6366f1", x: 7, y: 2, action: { type: "page", page: "keys" } },
        ],
      },
      {
        id: "keys",
        name: "Keys",
        columns: 8,
        rows: 3,
        items: [
          { id: "b-prev", kind: "button", label: "Previous", icon: "player-skip-back", x: 0, y: 0, action: { type: "media", command: "previous" } },
          { id: "b-play", kind: "button", label: "Play / Pause", icon: "player-play", color: "#22d3ee", x: 1, y: 0, action: { type: "media", command: "playpause" } },
          { id: "b-next", kind: "button", label: "Next", icon: "player-skip-forward", x: 2, y: 0, action: { type: "media", command: "next" } },
          { id: "b-mute2", kind: "button", label: "Mute", icon: "volume-3", x: 3, y: 0, action: { type: "volume", command: "mute" } },
          { id: "w-clock2", kind: "widget", widget: "clock", clock: { style: "flip" }, x: 4, y: 0, w: 2 },
          { id: "w-cpu3", kind: "widget", widget: "cpu", x: 6, y: 0 },
          { id: "w-mem3", kind: "widget", widget: "memory", metric: { chart: "ring" }, x: 7, y: 0 },
          { id: "b-copy", kind: "button", label: "Copy", icon: "copy", x: 0, y: 1, action: { type: "hotkey", keys: "ctrl+c" } },
          { id: "b-paste", kind: "button", label: "Paste", icon: "clipboard", x: 1, y: 1, action: { type: "hotkey", keys: "ctrl+v" } },
          { id: "b-undo", kind: "button", label: "Undo", icon: "arrow-back-up", x: 2, y: 1, action: { type: "hotkey", keys: "ctrl+z" } },
          { id: "b-redo", kind: "button", label: "Redo", icon: "arrow-forward-up", x: 3, y: 1, action: { type: "hotkey", keys: "ctrl+y" } },
          { id: "b-taskmgr", kind: "button", label: "Task Manager", icon: "list-details", x: 4, y: 1, action: { type: "hotkey", keys: "ctrl+shift+escape" } },
          { id: "b-mic", kind: "button", label: "Mic", icon: "microphone", color: "#ef4444", x: 5, y: 1, action: { type: "mic", command: "toggle" } },
          { id: "b-voldown2", kind: "button", label: "Vol -", icon: "volume-2", x: 6, y: 1, action: { type: "volume", command: "down" } },
          { id: "b-volup2", kind: "button", label: "Vol +", icon: "volume", x: 7, y: 1, action: { type: "volume", command: "up" } },
          // Windows-key shortcuts; Win+L cannot be sent by a program (Windows reserves it), so Lock asks Windows directly
          { id: "b-lock", kind: "button", label: "Lock", icon: "lock", x: 0, y: 2, action: { type: "shell", command: "rundll32.exe user32.dll,LockWorkStation" } },
          { id: "b-screenshot", kind: "button", label: "Screenshot", icon: "camera", x: 1, y: 2, action: { type: "hotkey", keys: "win+shift+s" } },
          { id: "b-taskview", kind: "button", label: "Task View", icon: "layout-grid", x: 2, y: 2, action: { type: "hotkey", keys: "win+tab" } },
          { id: "b-desktop", kind: "button", label: "Desktop", icon: "desktop", x: 3, y: 2, action: { type: "hotkey", keys: "win+d" } },
          { id: "b-gamebar", kind: "button", label: "Game Bar", icon: "brand-xbox", color: "#107c10", x: 4, y: 2, action: { type: "hotkey", keys: "win+g" } },
          { id: "b-record", kind: "button", label: "Clip 30s", icon: "player-record", color: "#ef4444", x: 5, y: 2, action: { type: "hotkey", keys: "win+alt+g" } },
          { id: "b-gaming2", kind: "button", label: "Gaming", icon: "device-gamepad-2", color: "#f97316", x: 6, y: 2, action: { type: "page", page: "gaming" } },
          { id: "b-stats2", kind: "button", label: "Stats", icon: "chart-line", color: "#0ea5e9", x: 7, y: 2, action: { type: "page", page: "stats" } },
        ],
      },
    ],
    // An example app rule, off by default so nothing jumps around until you turn it on in Automation.
    rules: [
      { id: "rule-cs2", name: "CS2 running → Controls", enabled: false, when: { kind: "app-running", app: "cs2.exe" }, then: [{ kind: "goto-page", pageId: "gaming", countdown: 0 }], revert: true },
    ],
  };
}

/** Basic media/volume layout (cross-platform). */
export function basicMediaLayout(): PresetLayout {
  return {
    version: 1,
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
}

export const LAYOUT_PRESETS: LayoutPresetDef[] = [
  { id: "gaming-pc", name: "Gaming PC", hint: "CS2, Steam, Discord, Spotify, GPU/CPU stats, volume/mic sliders", platform: "win32", rev: 4, layout: gamingPcLayout },
  { id: "basic-media", name: "Media Remote", hint: "Now playing, volume controls, system stats", platform: "all", rev: 1, layout: basicMediaLayout },
];
