import { decodeVkScan, INPUT_SIZE, packInputs, staticScan, type KeyEvent, type VkScan, type VkToScan } from "./keys";

/**
 * The few Win32 calls PhoneDesk makes through bun:ffi: SendInput (keys), GetLastInputInfo (idle),
 * VkKeyScanW (layout lookup) and the Credential Manager (secrets). Loaded lazily, only on Windows.
 */
interface Win {
  user32: any;
  kernel32: any;
  advapi32: any;
  ffi: typeof import("bun:ffi");
}

let win: Win | null | undefined;
function load(): Win | null {
  if (win !== undefined) return win;
  try {
    const ffi = require("bun:ffi") as typeof import("bun:ffi");
    const T = ffi.FFIType;
    win = {
      ffi,
      user32: ffi.dlopen("user32.dll", {
        SendInput: { args: [T.u32, T.ptr, T.i32], returns: T.u32 },
        GetLastInputInfo: { args: [T.ptr], returns: T.bool },
        VkKeyScanW: { args: [T.u16], returns: T.i16 },
        MapVirtualKeyW: { args: [T.u32, T.u32], returns: T.u32 },
        GetProcessWindowStation: { args: [], returns: T.ptr },
        GetUserObjectInformationW: { args: [T.ptr, T.i32, T.ptr, T.u32, T.ptr], returns: T.bool },
      }).symbols,
      kernel32: ffi.dlopen("kernel32.dll", { GetTickCount: { args: [], returns: T.u32 } }).symbols,
      advapi32: ffi.dlopen("advapi32.dll", {
        CredReadW: { args: [T.ptr, T.u32, T.u32, T.ptr], returns: T.bool },
        CredWriteW: { args: [T.ptr, T.u32], returns: T.bool },
        CredDeleteW: { args: [T.ptr, T.u32, T.u32], returns: T.bool },
        CredFree: { args: [T.ptr], returns: T.void },
      }).symbols,
    };
  } catch {
    win = null;
  }
  return win;
}

const need = (): Win => {
  const w = load();
  if (!w) throw new Error("the Windows API is not available");
  return w;
};

export function sendInput(events: KeyEvent[]): void {
  if (!events.length) return;
  const w = need();
  const buf = packInputs(events);
  const sent = w.user32.SendInput(events.length, w.ffi.ptr(buf), INPUT_SIZE) as number;
  // SendInput returns 0 when another process holds the input (UIPI) or the session has no interactive desktop
  if (sent !== events.length) throw new Error(sent === 0 ? "Windows blocked the key presses (is a desktop session signed in, and is the focused window running as administrator?)" : `only ${sent} of ${events.length} key events were sent`);
}

export const vkScan: VkScan = (ch) => {
  const w = need();
  return decodeVkScan(w.user32.VkKeyScanW(ch.charCodeAt(0)) as number);
};

const MAPVK_VK_TO_VSC_EX = 4;
const scanCache = new Map<number, number>();
/** Virtual key -> scan code of the current layout (0xE0xx for extended keys); the US table when the call fails. */
export const vkToScan: VkToScan = (vk) => {
  const hit = scanCache.get(vk);
  if (hit !== undefined) return hit;
  let sc = 0;
  try { sc = (need().user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX) as number) >>> 0; } catch { sc = 0; }
  if (!sc) sc = staticScan(vk);
  scanCache.set(vk, sc);
  return sc;
};

/** Seconds since the last keyboard/mouse input of the signed-in session. */
export function idleSeconds(): number | null {
  const w = load();
  if (!w) return null;
  try {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(8, 0); // cbSize
    if (!w.user32.GetLastInputInfo(w.ffi.ptr(buf))) return null;
    const last = buf.readUInt32LE(4);
    const now = w.kernel32.GetTickCount() as number;
    return ((now - last) >>> 0) / 1000; // GetTickCount wraps every 49 days: unsigned subtraction
  } catch {
    return null;
  }
}

/**
 * The window station of this process: "WinSta0" is the interactive desktop (the only place SendInput reaches); an agent
 * started over SSH or as a service lives in another one and cannot press keys. Null when it cannot be read.
 */
export function windowStation(): string | null {
  const w = load();
  if (!w) return null;
  try {
    const h = w.user32.GetProcessWindowStation();
    if (!h) return null;
    const buf = Buffer.alloc(256);
    const need = Buffer.alloc(4);
    if (!w.user32.GetUserObjectInformationW(h, 2 /* UOI_NAME */, w.ffi.ptr(buf), buf.length, w.ffi.ptr(need))) return null;
    return buf.toString("utf16le").split("\0")[0] ?? null;
  } catch {
    return null;
  }
}

// ---------- Credential Manager ----------

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");
const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;

/** What the secret store needs from Windows; tests pass a fake. */
export interface CredApi {
  read(target: string): string | undefined;
  write(target: string, user: string, value: string): boolean;
  remove(target: string): void;
}

export const realCredApi: CredApi = {
  read(target) {
    const w = load();
    if (!w) return undefined;
    const out = Buffer.alloc(8);
    if (!w.advapi32.CredReadW(w.ffi.ptr(wide(target)), CRED_TYPE_GENERIC, 0, w.ffi.ptr(out))) return undefined;
    const cred = Number(out.readBigUInt64LE(0));
    try {
      const size = w.ffi.read.u32(cred as any, 32);
      const blob = w.ffi.read.ptr(cred as any, 40);
      if (!size || !blob) return undefined;
      return Buffer.from(w.ffi.toArrayBuffer(blob as any, 0, size)).toString("utf8");
    } finally {
      w.advapi32.CredFree(cred);
    }
  },
  write(target, user, value) {
    const w = load();
    if (!w) return false;
    const name = wide(target);
    const account = wide(user);
    const blob = Buffer.from(value, "utf8");
    const c = Buffer.alloc(80); // CREDENTIALW on x64
    c.writeUInt32LE(CRED_TYPE_GENERIC, 4);
    c.writeBigUInt64LE(BigInt(w.ffi.ptr(name)), 8); // TargetName
    c.writeUInt32LE(blob.length, 32); // CredentialBlobSize
    c.writeBigUInt64LE(BigInt(w.ffi.ptr(blob)), 40); // CredentialBlob
    c.writeUInt32LE(CRED_PERSIST_LOCAL_MACHINE, 48);
    c.writeBigUInt64LE(BigInt(w.ffi.ptr(account)), 72); // UserName
    return !!w.advapi32.CredWriteW(w.ffi.ptr(c), 0);
  },
  remove(target) {
    const w = load();
    if (!w) return;
    w.advapi32.CredDeleteW(w.ffi.ptr(wide(target)), CRED_TYPE_GENERIC, 0);
  },
};
