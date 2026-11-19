---
name: phonedesk-layout
description: Arrange the PhoneDesk phone deck (pages, buttons, widgets, icons, theme) through the phonedesk MCP server. Use when the user asks to organise, design, rearrange or restyle their PhoneDesk screen.
---

# Arranging a PhoneDesk deck

The `phonedesk` MCP server edits the layout of the running agent. Changes reach connected phones at once, and `undo` reverts the last 50 saves.

## Workflow

1. `get_layout` first. It shows an ASCII grid per page and a legend with item ids, positions (x,y, 0-based) and sizes (wxh).
2. Plan the whole page, then run `preview_changes` with all operations and read the resulting grid.
3. Apply the operations one by one (`add_item`, `move_item`, `resize_item`, `update_item`, `remove_item`, `add_page`, `set_theme`).
4. `get_layout` again to confirm. If the user dislikes it, call `undo`.

Placing on an occupied cell pushes the tiles in the way to the nearest free spot of the same page; if nothing fits the change is rejected with free spots listed. Never remove a user's item unless asked.

## Design rules

- Group by function: media together, system stats together, launchers together, one page per theme (for example Work, Media, AI, Smart home).
- Big widgets (clock, now playing, quota) go top-left; they are what the eye lands on first.
- The phone is held in landscape: put the most frequently pressed buttons in the bottom rows, where thumbs rest.
- Keep sizes consistent per row. Mixed 1x1 and 2x2 in one row looks messy; use one size per row and let widgets span whole rows.
- Brand colours: the default accent is cyan `#22d3ee` (deep `#155e75`). Green `#34d399` is reserved for live/connected status; do not use it as a decorative or accent colour, and violet is not a default anywhere (it is only a selectable preset).
- Use one or two accent colours per page. Colour means something (red for destructive or stop, green for go); do not rainbow.
- Launchers use `app:<bundleId>` icons from `list_apps`, so the real app icon shows. Brand marks: `lobe:<name>`. Generic actions: Tabler names from `search_icons`.
- Keep pages at most 80 percent full, so the user can add things later and tiles stay large enough to hit.
- Short labels (one or two words). Hide the label (`hideLabel`) when the icon is obvious, such as an app icon.
- Always `preview_changes` before saving a multi-step rearrangement.

## Reference

- Widgets: clock, cpu, memory, uptime, load, network, nowplaying, quota, sessions, entity (Home Assistant), weather, value, notifications, volume / mic (sliders), gpu (NVIDIA load, temperature, memory), cputemp (CPU temperature: on Windows from LibreHardwareMonitor or OpenHardwareMonitor running with its WMI provider, else the ACPI thermal zone; shows "–" with a hint when there is none; nothing is downloaded).
- Button actions: open, hotkey (`{keys, hold?: true}`; with hold the keys stay down while the finger is on the button, for push-to-talk, and are released on lift, phone lock/disconnect, a layout save or after 2 minutes), type, shell, media, volume, set-volume (`{level: 0-100, device?: "output" | "mic"}`), mic (`{command: "mute" | "unmute" | "toggle"}`), app-volume (Windows: `{app: "Spotify.exe", command: "set" | "up" | "down" | "mute" | "unmute" | "toggle-mute", level?: 0-100, step?: 1-50}` changes that program's slider in the volume mixer; the program must have played sound, see GET /api/audio/sessions), output-device (Windows: `{devices: [id or name, ...1-8], flow?: "output" | "input"}`; one device sets it as default, several cycle to the next on each press; ids and names from GET /api/audio/devices?flow=output), page, sound, sound-stop, hass, macro.
- Macro steps: hotkey, type, wait, open, shell, media, volume, hass, item, notify, sound (`{sound: "snd:…", on?: "mac" | "phone" | "both", volume?}`), page (`{pageId}`: the phone that pressed shows that screen).
- Rule triggers ("when"): ai-waiting, media-playing, media-stopped, cpu-above, quota-above, time-between, push, hass-state, idle, app-running and app-foreground (`{app: "cs2.exe"}`, the process name; case does not matter, ".exe" is optional; checked every 3 s only while such a rule is on; app-foreground works on Windows and macOS). With `revert: true` a goto-page rule returns to the previous screen when the program quits or loses focus.
- On Windows a `shell` command runs as `cmd.exe /d /s /c "<command>"` exactly as typed (quoted paths work); one still running after 2 s (a GUI app, a server) is left running and the press counts as done.
- A `sound` action must name a clip already in the library (`snd:<16 hex>`, see GET /api/sounds); Windows cannot play ogg clips (use mp3, m4a, wav or aac).
- Hotkeys: `cmd` is the portable main modifier (Command on macOS, Ctrl on Windows); `win` is the real Windows key (Command on macOS). Keys: letters, digits, return, tab, space, escape, arrows, home/end/pageup/pagedown, f1-f24, num0-num9, numadd/numsubtract/nummultiply/numdivide/numdecimal/numenter, insert, printscreen, pause, capslock, scrolllock, numlock, mediastop. Win+L cannot be sent: lock with the shell command `rundll32.exe user32.dll,LockWorkStation`.
- Theme fields: mode, accent, background, tile, radius, gap, fontScale, tileStyle (tint, solid, outline, ios), iconScale, iconStroke, showLabels, text, orientation.
