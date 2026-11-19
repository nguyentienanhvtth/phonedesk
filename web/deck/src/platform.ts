/**
 * Platform of the agent the deck talks to ("darwin" | "win32" | "linux"), taken from the `hello` message; macOS until told otherwise.
 * Used for keyboard glyphs and the few labels that are platform specific.
 */
let cur = 'darwin'

export const setPlatform = (p: unknown) => {
  if (typeof p === 'string' && p) cur = p
}
export const getPlatform = (): string => cur
export const isMac = (): boolean => cur === 'darwin'

const MAC: { [k: string]: string } = { cmd: '⌘', command: '⌘', meta: '⌘', win: '⌘', super: '⌘', ctrl: '⌃', control: '⌃', option: '⌥', alt: '⌥', shift: '⇧', enter: '↩', return: '↩', esc: '⎋', escape: '⎋', delete: '⌫', backspace: '⌫', tab: '⇥', space: 'Space' }
const WIN: { [k: string]: string } = { cmd: 'Ctrl', command: 'Ctrl', meta: 'Ctrl', win: 'Win', windows: 'Win', super: 'Win', start: 'Win', ctrl: 'Ctrl', control: 'Ctrl', option: 'Alt', alt: 'Alt', shift: 'Shift', enter: 'Enter', return: 'Enter', esc: 'Esc', escape: 'Esc', delete: 'Del', backspace: 'Backspace', tab: 'Tab', space: 'Space', insert: 'Ins', printscreen: 'PrtSc', capslock: 'Caps', scrolllock: 'ScrLk', numlock: 'NumLk', numenter: 'Num Enter', numadd: 'Num+', numsubtract: 'Num-', nummultiply: 'Num*', numdivide: 'Num/', numdecimal: 'Num.', mediastop: 'Stop' }

/** "cmd+shift+4" -> "⌘⇧4" on a Mac, "Ctrl+Shift+4" on Windows (layouts keep one notation: cmd maps to ctrl on Windows, option to alt). */
export function formatHotkey(keys: string, platform?: string): string {
  const mac = (platform || cur) === 'darwin'
  const map = mac ? MAC : WIN
  const parts = keys.split('+').map((k) => {
    const x = k.trim()
    return map[x.toLowerCase()] || (x.length === 1 ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))
  })
  return parts.join(mac ? '' : '+')
}

/** Returns true when running as a standalone PWA (added to home screen), not in the browser. */
export const isStandalone = (): boolean => {
  return !!(
    (window.navigator as any).standalone ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  )
}

/** Returns true when running on iOS Safari (not standalone). */
export const isIOSSafari = (): boolean => {
  const ua = navigator.userAgent || ''
  const ios = /iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua)
  return ios && safari && !isStandalone()
}
