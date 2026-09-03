import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../../lib/config.js";
import {
  buildDomain,
  buildManifest,
  renderArtifactHtml,
  type ManifestArtifact,
  type ManifestSpec,
} from "../../pipeline/build-pipeline.js";
import { loadBuildContext } from "../../pipeline/build-context.js";
import {
  ensureRunDirs,
  getProject,
  getRunPrdPath,
  getRunRoot,
  loadIndex,
  saveIndex,
} from "../../lib/runs.js";

type BuildArgs = {
  runId: string;
  projectSlug: string;
  assetProjectSlug: string;
};

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseBuildArgs(args: string[], config: WireframeConfig): BuildArgs {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error(
      "usage: wireframe run build --run-id slug [--project crm] [--asset-project crm]",
    );
  }

  return {
    runId,
    projectSlug: readFlag(args, "--project")?.trim() ?? config.defaultProject,
    assetProjectSlug: readFlag(args, "--asset-project")?.trim() ?? config.defaultProject,
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

export async function buildRun(config: WireframeConfig, args: string[]): Promise<void> {
  const parsed = parseBuildArgs(args, config);
  const index = await loadIndex(config);
  const project = getProject(index, parsed.projectSlug);
  const run = project.runs.find((entry) => entry.runId === parsed.runId);

  if (!run) {
    throw new Error(`run not found: ${parsed.runId} (project ${parsed.projectSlug})`);
  }

  if (run.status !== "ready" && run.status !== "confirmed") {
    throw new Error(
      `PRD not ready (status=${run.status}). 채팅에서 확정·보완을 끝내 ready가 된 뒤에 빌드하세요.`,
    );
  }

  await ensureRunDirs(config, parsed.runId);

  const prdAbsolute = getRunPrdPath(config, parsed.runId, run.prdVersion);
  const prdContent = await readFile(prdAbsolute, "utf8");
  const prdPath = run.prdPath;

  // Triple context in one pack: PRD + JSON assets + live DB (wonjd)
  const ctx = await loadBuildContext({
    config,
    projectSlug: parsed.projectSlug,
    assetProjectSlug: parsed.assetProjectSlug,
    prdPath,
    prdContent,
  });

  const domain = buildDomain({
    runId: parsed.runId,
    projectSlug: parsed.projectSlug,
    assetProjectSlug: parsed.assetProjectSlug,
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
  const contextPath = path.join(specDir, "build-context.json");
  const existingManifest = await loadExistingManifest(manifestPath);

  let manifest = buildManifest({
    run: {
      runId: run.runId,
      no: run.no,
      title: run.title,
      prdPath: run.prdPath,
    },
    projectSlug: parsed.projectSlug,
    assetProjectSlug: parsed.assetProjectSlug,
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

  await writeFile(domainPath, `${JSON.stringify(domain, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    contextPath,
    `${JSON.stringify({ sources: ctx.sources, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  for (const artifact of manifest.artifacts) {
    if (artifact.locked) continue;
    const html = renderArtifactHtml({
      artifact,
      runTitle: run.title,
      prdContent: ctx.prdContent,
      domain,
      assets: ctx.assets,
    });
    await writeFile(path.join(artifactsDir, artifact.file), html, "utf8");
  }

  run.assetProjectSlug = parsed.assetProjectSlug;
  run.artifactCount = manifest.artifacts.length;
  run.updatedAt = new Date().toISOString();

  const indexPath = await saveIndex(config, index);

  console.log(`wireframe built: ${parsed.runId}`);
  console.log(`project: ${parsed.projectSlug}`);
  console.log(`assets: ${parsed.assetProjectSlug}`);
  console.log(
    `context: PRD + JSON + liveDB(${ctx.sources.liveDb.ok ? ctx.sources.liveDb.tables.join("|") || "ok" : "fail"})`,
  );
  console.log(`artifacts: ${manifest.artifacts.length}`);
  console.log(`domain: ${domainPath}`);
  console.log(`manifest: ${manifestPath}`);
  console.log(`index: ${indexPath}`);
}
