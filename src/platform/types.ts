import type { Action } from "../config";
import type { VolumeChange, VolumeState } from "../actions";
import type { RawMedia, MediaApp } from "../media";
import type { NetCounters } from "../stats";
import type { ProcessInfo, ProcessSort } from "../processes";
import type { AppInfo } from "../icons";

export interface MicState {
  level: number;
  muted: boolean;
}

export interface MicChange {
  level?: number;
  muted?: boolean;
}

/** One program in the volume mixer (Windows audio session; a program with several sessions is listed once per session). */
export interface AudioSession {
  pid: number;
  /** Process name without .exe ("Discord", "cs2"). */
  app: string;
  level: number; // 0-100
  muted: boolean;
  /** Playing right now (AudioSessionStateActive). */
  active: boolean;
}
export interface AudioDevice { id: string; name: string; isDefault: boolean }
/** level: absolute 0-100; delta: relative; muted: on/off or flip. */
export interface AppVolumeChange { level?: number; delta?: number; muted?: boolean | "toggle" }
export type CpuTempSource = "librehardwaremonitor" | "openhardwaremonitor" | "acpi" | "sysfs" | "none";
export interface CpuTempReading { celsius: number | null; source: CpuTempSource; sensor?: string }

/** Keys and typing, OS actions: the operations that differ per OS. */
export interface Platform {
  readonly id: NodeJS.Platform;
  /** Human name of the OS ("macOS", "Windows", "Linux"). */
  readonly label: string;
  /** What the hotkey modifiers are called on this OS (layouts always store cmd/option; the management page shows these). */
  readonly keyNames: { cmd: string; alt: string; ctrl: string };

  /** Runs shell / open / hotkey / type / media / volume actions. Resolves on success, throws otherwise. */
  runAction(a: Action): Promise<void>;

  readVolume(): Promise<VolumeState | null>;
  setVolume(v: VolumeChange): Promise<void>;

  /** Microphone state (default capture device). Null when unavailable. */
  readMic?(): Promise<MicState | null>;
  /** Set microphone level (0-100) or mute state. */
  setMic?(v: MicChange): Promise<void>;

  readMedia(): Promise<RawMedia | null>;
  fetchArtwork(raw: RawMedia): Promise<string | undefined>;
  resumeMedia(lastApp?: string): Promise<void>;
  openMediaApp(app: MediaApp): Promise<void>;

  netCounters(): Promise<NetCounters | undefined>;
  /** Bytes in use when the OS has a better figure than total - free; undefined otherwise. */
  memUsed(): Promise<number | undefined>;
  topProcesses(sort: ProcessSort, limit: number): Promise<ProcessInfo[]>;
  /** The name other devices reach this machine by (macOS LocalHostName); undefined = use os.hostname(). */
  lanName(): Promise<string | undefined>;

  /** Installed apps and their icons, when the OS is not scanned by the built-in macOS bundle reader (icons.ts). */
  apps: AppCatalog | null;
  /** Argv that plays `path` at 0-100 volume; throws when no player exists. */
  soundCommand(path: string, volume: number): string[];
  /** Duration of an audio file when the OS can tell cheaply. */
  soundDuration(path: string): Promise<number | undefined>;

  /** The OS secret store (macOS Keychain, Windows Credential Manager); null when there is none. */
  secrets: SecretStore | null;
  /** Claude Code's credentials JSON from an OS store (macOS Keychain); null elsewhere (the file is read by the caller). */
  claudeCredentials(): Promise<string | null>;
  /** Seconds since the last keyboard/mouse input, or null when unknown. */
  /** Where the "system load" figure comes from: the OS load average, or an estimate from CPU use (Windows has none). */
  loadKind: "loadavg" | "estimate";
  idleSeconds(): Promise<number | null>;

  // ----- gaming (optional: undefined = this OS cannot) -----
  /** Names of the running programs (as the OS lists them). */
  runningApps?(): Promise<string[]>;
  /** The program of the foreground window, null when none. */
  foregroundApp?(): Promise<string | null>;
  /** Per-app volume: the mixer's sessions. */
  audioSessions?(): Promise<AudioSession[]>;
  /** Changes every session of a program; returns them after the change ([] = it has no audio session now). */
  setAppVolume?(app: string, change: AppVolumeChange): Promise<AudioSession[]>;
  /** Active playback (output) or recording (input) devices. */
  audioDevices?(flow: "output" | "input"): Promise<AudioDevice[]>;
  /** Makes a device (an id from audioDevices) the default for every role. */
  setDefaultAudioDevice?(id: string): Promise<void>;
  /** Presses (down) or releases (up) a hotkey and keeps it held in between (push-to-talk). */
  holdKeys?(keys: string, down: boolean): Promise<void>;
  /** CPU temperature from the OS or a running sensor tool. */
  cpuTemp?(): Promise<CpuTempReading>;

  /** Opens a URL or settings link in the default handler (System Settings, the browser). */
  openExternal(url: string): Promise<void>;
  /** How a command line is written for the hook config (path style). */
  hookPath(p: string): string;
  /** Stops anything long-lived this platform started (the Windows helper). */
  dispose(): void;
}

export interface SecretStore {
  get(service: string, account: string): Promise<string | undefined>;
  /** True when stored. */
  set(service: string, account: string, value: string): Promise<boolean>;
  remove(service: string, account: string): Promise<void>;
}

export interface AppCatalog {
  list(): Promise<AppInfo[]>;
  /** PNG bytes of the app's icon (about 128 px), or null. */
  icon(id: string): Promise<Uint8Array | null>;
  /** Opens an app listed by `list()`. */
  open(id: string): Promise<void>;
  /** Shrinks an uploaded PNG/JPEG to at most `max` px as PNG; returns the PNG, or throws "cannot read the image". */
  resizeImage(bytes: Uint8Array, ext: "png" | "jpg", max: number): Promise<Uint8Array>;
}
