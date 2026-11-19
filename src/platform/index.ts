import { createDarwin } from "./darwin";
import { createLinux } from "./linux";
import { createWin32 } from "./win32";
import type { Platform } from "./types";

export type { Platform, SecretStore, AppCatalog, MicState, MicChange } from "./types";

/** The implementation for an OS id (anything that is not macOS or Windows gets the Linux, best-effort one). */
export function createPlatform(id: NodeJS.Platform): Platform {
  if (id === "darwin") return createDarwin();
  if (id === "win32") return createWin32();
  return createLinux(id);
}

/**
 * The platform this process runs on. This is the only place that reads process.platform: every OS-specific call in
 * PhoneDesk goes through this object. Created lazily so importing a module never loads another OS's code paths.
 */
let current: Platform | undefined;
/** The OS id ("win32", "darwin", "linux") without creating the platform object: for defaults that differ per OS. */
export const osId = (): NodeJS.Platform => process.platform;
export const platform: Platform = new Proxy({} as Platform, {
  get(_t, key) {
    current ??= createPlatform(process.platform);
    const v = (current as any)[key];
    return typeof v === "function" ? v.bind(current) : v;
  },
});
