import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "./config.js";
import { getRepoRoot, resolveFromRepo } from "./config.js";

export type RunStatus = "draft" | "confirmed";

export type RunEntry = {
  runId: string;
  kind: "wireframe";
  no: string;
  title: string;
  status: RunStatus;
  prdVersion: number;
  prdPath: string;
  assetProjectSlug?: string;
  createdAt: string;
  updatedAt: string;
  artifactCount: number;
};

export type ProjectEntry = {
  no: string;
  slug: string;
  title: string;
  runs: RunEntry[];
};

export type WireframeIndex = {
  projects: ProjectEntry[];
};

function defaultProjectTitle(slug: string): string {
  if (slug === "crm") return "CRM";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function slugifyRunId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function getIndexPath(config: WireframeConfig): string {
  return path.join(resolveFromRepo(config.paths.wireFrame), "index.json");
}

export function getRunRoot(config: WireframeConfig, runId: string): string {
  return path.join(resolveFromRepo(config.paths.wireFrame), "runs", runId);
}

export function getRunPrdPath(config: WireframeConfig, runId: string, version: number): string {
  return path.join(getRunRoot(config, runId), "input", `v${version}.md`);
}

export function toWireFrameRelative(config: WireframeConfig, absolutePath: string): string {
  const wireFrameRoot = resolveFromRepo(config.paths.wireFrame);
  return path.relative(wireFrameRoot, absolutePath).replace(/\\/g, "/");
}

function normalizeIndex(raw: Record<string, unknown>, projectSlug: string): WireframeIndex {
  if (Array.isArray(raw.projects)) {
    return raw as unknown as WireframeIndex;
  }

  const legacyRuns = Array.isArray(raw.runs) ? (raw.runs as RunEntry[]) : [];
  const slug = typeof raw.projectSlug === "string" ? raw.projectSlug : projectSlug;

  return {
    projects: [
      {
        no: "01",
        slug,
        title: defaultProjectTitle(slug),
        runs: legacyRuns,
      },
    ],
  };
}

export async function loadIndex(config: WireframeConfig): Promise<WireframeIndex> {
  const indexPath = getIndexPath(config);
  try {
    await access(indexPath);
    const raw = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, unknown>;
    return normalizeIndex(raw, config.defaultProject);
  } catch {
    return {
      projects: [
        {
          no: "01",
          slug: config.defaultProject,
          title: defaultProjectTitle(config.defaultProject),
          runs: [],
        },
      ],
    };
  }
}

export async function saveIndex(config: WireframeConfig, index: WireframeIndex): Promise<string> {
  const indexPath = getIndexPath(config);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return indexPath;
}

export function getProject(index: WireframeIndex, projectSlug: string): ProjectEntry {
  let project = index.projects.find((entry) => entry.slug === projectSlug);
  if (!project) {
    project = {
      no: String(index.projects.length + 1).padStart(2, "0"),
      slug: projectSlug,
      title: defaultProjectTitle(projectSlug),
      runs: [],
    };
    index.projects.push(project);
  }
  return project;
}

export function allocatePrdNo(runs: RunEntry[]): string {
  let max = 0;
  for (const run of runs) {
    const match = /^PRD-(\d+)$/.exec(run.no);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PRD-${String(max + 1).padStart(3, "0")}`;
}

export async function ensureRunDirs(config: WireframeConfig, runId: string): Promise<void> {
  const root = getRunRoot(config, runId);
  await mkdir(path.join(root, "input"), { recursive: true });
  await mkdir(path.join(root, "spec"), { recursive: true });
  await mkdir(path.join(root, "artifacts"), { recursive: true });
}

export function getRepoRootPath(): string {
  return getRepoRoot();
}
