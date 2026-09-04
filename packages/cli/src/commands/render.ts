import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../lib/config.js";
import {
  buildDomain,
  buildManifest,
  renderArtifactHtml,
  type ManifestArtifact,
  type ManifestSpec,
} from "../pipeline/build-pipeline.js";
import { loadBuildContext } from "../pipeline/build-context.js";
import {
  buildFeaturesDoc,
  buildFlowDoc,
  type ClarificationsFile,
} from "../pipeline/build-docs.js";
import { applyOverrides, loadOverrides } from "../pipeline/spec-overrides.js";
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadClarifications(clarificationsPath: string): Promise<ClarificationsFile> {
  try {
    return JSON.parse(await readFile(clarificationsPath, "utf8")) as ClarificationsFile;
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

  // Same triple context as build: PRD + JSON + live DB (rebuilds blueprints)
  const ctx = await loadBuildContext({
    config,
    projectSlug: parsed.projectSlug,
    assetProjectSlug,
    prdPath: run.prdPath,
    prdContent,
  });

  const domain = buildDomain({
    runId: parsed.runId,
    projectSlug: parsed.projectSlug,
    assetProjectSlug,
    prdTitle: run.title,
    prdContent: ctx.prdContent,
    assets: ctx.assets,
    sources: ctx.sources,
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
    assets: ctx.assets,
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

  // Same dashboard documents as build — the 00-spec/00-flow artifacts render from these,
  // so re-render must regenerate them from the same inputs, not read stale files.
  const clarifications = await loadClarifications(path.join(specDir, "clarifications.json"));
  const features = buildFeaturesDoc({
    runId: parsed.runId,
    prdContent: ctx.prdContent,
    domain,
    clarifications,
    manifest,
  });
  const flow = buildFlowDoc({
    runId: parsed.runId,
    prdContent: ctx.prdContent,
    domain,
    manifest,
  });
  await writeFile(path.join(specDir, "features.json"), `${JSON.stringify(features, null, 2)}\n`, "utf8");
  await writeFile(path.join(specDir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`, "utf8");

  // User edits are layered on top at read time — never written back into the two
  // generated documents above, and never written by this command. See spec-overrides.ts.
  const merged = applyOverrides(features, flow, await loadOverrides(specDir));

  const targets: ManifestArtifact[] = [];
  for (const artifact of manifest.artifacts) {
    if (parsed.artifactId && artifact.id !== parsed.artifactId) continue;
    // locked keeps an existing file untouched; it must not stop the first write.
    if (artifact.locked && (await fileExists(path.join(artifactsDir, artifact.file)))) continue;
    targets.push(artifact);
  }

  for (const artifact of targets) {
    const html = renderArtifactHtml({
      artifact,
      runTitle: run.title,
      prdContent: ctx.prdContent,
      domain,
      assets: ctx.assets,
      features: merged.features,
      flow: merged.flow,
    });
    await writeFile(path.join(artifactsDir, artifact.file), html, "utf8");
  }

  run.assetProjectSlug = assetProjectSlug;
  run.artifactCount = manifest.artifacts.length;
  run.updatedAt = new Date().toISOString();
  await saveIndex(config, index);

  const fieldCounts = (domain.fieldBlueprints ?? [])
    .filter((bp) => bp.screenKind === "wizard-step")
    .map((bp) => `${bp.stepNo}:${bp.fields.length}`)
    .join(",");

  console.log(`wireframe rendered: ${parsed.runId}`);
  console.log(`targets: ${targets.length}/${manifest.artifacts.length}`);
  console.log(`blueprints: ${fieldCounts || "none"}`);
  if (parsed.artifactId) console.log(`target: ${parsed.artifactId}`);
}
