import { access, readdir } from "node:fs/promises";
import path from "node:path";
import {
  listProjectSlugs,
  resolveFromRepo,
  resolveProject,
  type WireframeConfig,
} from "../../lib/config.js";
import { loadIndex } from "../../lib/runs.js";

const ASSET_FILES = ["design.json", "routes.json", "api.json", "db.json", "shell.html"] as const;

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listDiskProjectSlugs(): Promise<string[]> {
  const projectsDir = resolveFromRepo("projects");
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

export async function listProjects(config: WireframeConfig): Promise<void> {
  const index = await loadIndex(config);
  const configured = listProjectSlugs(config);
  const onDisk = await listDiskProjectSlugs();
  const slugs = [...new Set([...configured, ...onDisk])].sort();

  if (slugs.length === 0) {
    console.log("no projects — run: wireframe project init <slug>");
    return;
  }

  for (const slug of slugs) {
    const indexEntry = index.projects.find((entry) => entry.slug === slug);
    const runCount = indexEntry?.runs.length ?? 0;
    const assetsDir = resolveFromRepo(`projects/${slug}`);
    const assets: string[] = [];
    for (const file of ASSET_FILES) {
      if (await fileExists(path.join(assetsDir, file))) {
        assets.push(file.replace(/\.(json|html)$/, ""));
      }
    }

    let title = indexEntry?.title ?? slug.toUpperCase();
    if (configured.includes(slug)) {
      try {
        title = resolveProject(config, slug).title;
      } catch {
        // keep fallback title
      }
    }

    const defaultMark = slug === config.defaultProject ? " (default)" : "";
    console.log(`${slug}${defaultMark}\t${title}\truns=${runCount}\tassets=${assets.join(",") || "none"}`);
  }
}
