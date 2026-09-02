#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(pkgRoot, "dist", "cli.js");

if (!existsSync(entry)) {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: pkgRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

await import(pathToFileURL(entry).href);
