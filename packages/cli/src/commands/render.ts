import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../lib/config.js";
import {
  buildDomain,
  buildManifest,
  loadProjectAssets,
  renderArtifactHtml,
  type ManifestArtifact,
  type ManifestSpec,
} from "../pipeline/build-pipeline.js";
import {
  ensureRunDirs,
  getProject,
  getRunPrdPath,
  getRunRoot,
  loadIndex,
  saveIndex,
} from "../lib/runs.js";

type RenderArgs = {
  runId: string;
  projectSlug: string;
  artifactId?: string;
  instruction?: string;
};

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseRenderArgs(args: string[], config: WireframeConfig): RenderArgs {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error(
      "usage: wireframe render --run-id slug [--project crm] [--artifact id] [--instruction text]",
    );
  }

  return {
    runId,
    projectSlug: readFlag(args, "--project")?.trim() ?? config.defaultProject,
    artifactId: readFlag(args, "--artifact")?.trim(),
    instruction: readFlag(args, "--instruction")?.trim(),
  };
}

async function loadExistingManifest(manifestPath: string): Promise<ManifestSpec | null> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as ManifestSpec;
  } catch {
    return null;
  }
}

function mergeArtifactState(
  next: ManifestArtifact,
  previous: ManifestArtifact | undefined,
): ManifestArtifact {
  if (!previous) return next;
  return {
    ...next,
    locked: previous.locked,
    instructions: previous.instructions,
    updatedAt: previous.updatedAt,
  };
}

export async function renderRun(config: WireframeConfig, args: string[]): Promise<void> {
  const parsed = parseRenderArgs(args, config);
  const index = await loadIndex(config);
  const project = getProject(index, parsed.projectSlug);
  const run = project.runs.find((entry) => entry.runId === parsed.runId);

  if (!run) {
    throw new Error(`run not found: ${parsed.runId} (project ${parsed.projectSlug})`);
  }

  const assetProjectSlug = run.assetProjectSlug ?? config.defaultProject;
  await ensureRunDirs(config, parsed.runId);

  const prdAbsolute = getRunPrdPath(config, parsed.runId, run.prdVersion);
  const prdContent = await readFile(prdAbsolute, "utf8");
  const assets = await loadProjectAssets(assetProjectSlug);

  const domain = buildDomain({
    runId: parsed.runId,
    projectSlug: parsed.projectSlug,
    assetProjectSlug,
    prdTitle: run.title,
    prdContent,
    assets,
  });

  const runRoot = getRunRoot(config, parsed.runId);
  const specDir = path.join(runRoot, "spec");
  const artifactsDir = path.join(runRoot, "artifacts");
  const manifestPath = path.join(specDir, "manifest.json");
  const domainPath = path.join(specDir, "domain.json");
  const existingManifest = await loadExistingManifest(manifestPath);

  let manifest = buildManifest({
    run: {
      runId: run.runId,
      no: run.no,
      title: run.title,
      prdPath: run.prdPath,
    },
    projectSlug: parsed.projectSlug,
    assetProjectSlug,
    domain,
  });

  if (existingManifest) {
    const previousById = new Map(existingManifest.artifacts.map((artifact) => [artifact.id, artifact]));
    manifest = {
      ...manifest,
      createdAt: existingManifest.createdAt,
      status: existingManifest.status,
      artifacts: manifest.artifacts.map((artifact) =>
        mergeArtifactState(artifact, previousById.get(artifact.id)),
      ),
    };
  }

  if (parsed.instruction && parsed.artifactId) {
    const now = new Date().toISOString();
    manifest = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) => {
        if (artifact.id !== parsed.artifactId) return artifact;
        if (artifact.locked) {
          throw new Error(`artifact locked: ${artifact.id}`);
        }
        return {
          ...artifact,
          locked: false,
          updatedAt: now,
          instructions: [...artifact.instructions, { at: now, text: parsed.instruction! }],
        };
      }),
    };
  }

  await writeFile(domainPath, `${JSON.stringify(domain, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const targets = manifest.artifacts.filter((artifact) => {
    if (parsed.artifactId && artifact.id !== parsed.artifactId) return false;
    if (artifact.locked) return false;
    return true;
  });

  for (const artifact of targets) {
    const html = renderArtifactHtml({
      artifact,
      runTitle: run.title,
      prdContent,
      domain,
      assets,
    });
    await writeFile(path.join(artifactsDir, artifact.file), html, "utf8");
  }

  run.assetProjectSlug = assetProjectSlug;
  run.artifactCount = manifest.artifacts.length;
  run.updatedAt = new Date().toISOString();
  await saveIndex(config, index);

  console.log(`wireframe rendered: ${parsed.runId}`);
  console.log(`artifacts: ${targets.length}/${manifest.artifacts.length}`);
  if (parsed.artifactId) console.log(`target: ${parsed.artifactId}`);
}
