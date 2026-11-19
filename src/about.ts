import { arch } from "node:os";
import pkg from "../package.json" with { type: "json" };
import { BUILD_INFO, DECK_BUILD } from "./assets.gen";
import { platform } from "./platform";

export const REPO_URL = "https://github.com/nguyentienanhvtth/phonedesk";

export interface About {
  name: string;
  version: string;
  build: string; // deck build id: phones compare it to know they run stale code
  commit: string; // short git SHA baked in at build time, "" when not built from a git checkout
  dirty: boolean; // the tree had uncommitted changes when it was built
  builtAt: string; // ISO time of the build
  platform: string;
  arch: string;
  bun: string;
  repo: string;
  license: string;
}

/** Everything is known at build or start time: no network calls, no update check. */
export function aboutInfo(): About {
  return {
    name: "PhoneDesk",
    version: pkg.version,
    build: DECK_BUILD,
    commit: BUILD_INFO?.commit ?? "",
    dirty: BUILD_INFO?.dirty ?? false,
    builtAt: BUILD_INFO?.builtAt ?? "",
    platform: platform.id,
    arch: arch(),
    bun: typeof Bun !== "undefined" ? Bun.version : "",
    repo: REPO_URL,
    license: "MIT",
  };
}

/** "phonedesk 0.1.0 (abc1234)", "(abc1234-dirty)" for a tree with changes, plain "phonedesk 0.1.0" without git info. */
export function versionLine(a: About = aboutInfo()): string {
  return `phonedesk ${a.version}${a.commit ? ` (${a.commit}${a.dirty ? "-dirty" : ""})` : ""}`;
}
