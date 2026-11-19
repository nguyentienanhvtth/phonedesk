#!/usr/bin/env bun
// web/deck/dist and web/manage/dist are generated (and git-ignored). Builds the web apps when either is missing
// or when source files are newer than the last build, so a fresh clone or git pull can run the agent from scratch.
import { existsSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");

/** Recursively get the most recent mtime of all files in a directory. */
function maxMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let max = 0;
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== "dist") walk(p);
      } else {
        const mt = statSync(p).mtimeMs;
        if (mt > max) max = mt;
      }
    }
  };
  walk(dir);
  return max;
}

/** Get the mtime of a single file, or 0 if it doesn't exist. */
function fileMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

type WebApp = "deck" | "manage";

/** Check if a web app needs rebuilding: source newer than dist, or dist missing. */
function needsRebuild(app: WebApp): { rebuild: boolean; reason: string } {
  const webDir = join(root, "web", app);
  const distFile = join(webDir, "dist", "build.json");
  const distIndex = join(webDir, "dist", "index.html");

  // No dist at all
  if (!existsSync(distIndex)) {
    return { rebuild: true, reason: "no dist yet" };
  }

  const distMtime = fileMtime(distFile) || fileMtime(distIndex);
  if (distMtime === 0) {
    return { rebuild: true, reason: "no dist yet" };
  }

  // Check source directories and files
  const srcMtime = maxMtime(join(webDir, "src"));
  const indexMtime = fileMtime(join(webDir, "index.html"));
  const pkgMtime = fileMtime(join(webDir, "package.json"));
  const viteMtime = fileMtime(join(webDir, "vite.config.ts"));
  const tsconfigMtime = fileMtime(join(webDir, "tsconfig.json"));

  const maxSrc = Math.max(srcMtime, indexMtime, pkgMtime, viteMtime, tsconfigMtime);

  if (maxSrc > distMtime) {
    const delta = Math.round((maxSrc - distMtime) / 1000);
    return { rebuild: true, reason: `source is ${delta}s newer than dist` };
  }

  return { rebuild: false, reason: "" };
}

const apps: WebApp[] = ["deck", "manage"];
const toRebuild: { app: WebApp; reason: string }[] = [];

for (const app of apps) {
  const { rebuild, reason } = needsRebuild(app);
  if (rebuild) {
    toRebuild.push({ app, reason });
  }
}

if (toRebuild.length > 0) {
  for (const { app, reason } of toRebuild) {
    console.log(`web/${app}: rebuilding (${reason})`);
  }
  const p = Bun.spawn([process.execPath, "run", "build:web"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error("build:web failed");
  console.log("web build complete");
}
