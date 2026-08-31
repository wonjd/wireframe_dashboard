import fs from "node:fs/promises";
import path from "node:path";
import { registrySchema, type ExistingContext, type WireframeMode } from "@wireframe-studio/core";
import { detectExistingContext } from "@wireframe-studio/scanner";
import { buildGenerationPrompt, buildSpecDocument } from "@wireframe-studio/renderer";
import { getFlag } from "./commands.js";
import { ask, parseYesNo, readPrd } from "./prompts.js";

export type RunWorkflowOpts = {
  projectsRoot: string;
  project?: string;
  feature?: string;
  title?: string;
};

async function loadRegistry(projectsRoot: string) {
  const indexPath = path.join(projectsRoot, "index.json");
  try {
    const raw = JSON.parse(await fs.readFile(indexPath, "utf8"));
    return registrySchema.parse(raw);
  } catch {
    return registrySchema.parse({ projects: [] });
  }
}

async function resolveProjectFolder(projectsRoot: string, projectSlug: string) {
  const registry = await loadRegistry(projectsRoot);
  const found = registry.projects.find((p) => p.slug === projectSlug);
  if (found) return { slug: found.slug, folder: found.folder };
  return { slug: projectSlug, folder: projectSlug };
}

function featureRoot(projectsRoot: string, folder: string, feature: string) {
  return path.join(projectsRoot, folder, "features", feature);
}

function parseDetectFlag(argv: string[]): boolean | undefined {
  const detect = getFlag(argv, "--detect");
  if (detect !== undefined) {
    const d = detect.trim().toLowerCase();
    if (d === "y" || d === "yes") return true;
    if (d === "n" || d === "no") return false;
    throw new Error(`--detect 는 y 또는 n 이어야 합니다 (입력: ${detect})`);
  }
  const mode = getFlag(argv, "--mode");
  if (mode === "existing") return true;
  if (mode === "new") return false;
  return undefined;
}

async function writeWorkflowArtifacts(opts: {
  projectsRoot: string;
  project: string;
  feature: string;
  title: string;
  prdText: string;
  detect: boolean;
  repoPath?: string;
}) {
  const { folder } = await resolveProjectFolder(opts.projectsRoot, opts.project);
  const root = featureRoot(opts.projectsRoot, folder, opts.feature);
  await fs.mkdir(path.join(root, "input"), { recursive: true });
  await fs.writeFile(path.join(root, "input", `${opts.feature}.md`), opts.prdText, "utf8");

  let detected: ExistingContext | undefined;
  if (opts.detect) {
    const repo = opts.repoPath ?? process.cwd();
    detected = await detectExistingContext(repo);
    await fs.writeFile(path.join(root, "wireframe-spec.json"), JSON.stringify(detected, null, 2), "utf8");
  }

  const spec = buildSpecDocument({
    title: opts.title,
    feature: opts.feature,
    prdText: opts.prdText,
    detected,
  });
  await fs.writeFile(path.join(root, "spec.md"), spec, "utf8");

  const mode: WireframeMode = opts.detect ? "existing" : "new";
  const prompt = buildGenerationPrompt({
    mode,
    prdText: opts.prdText,
    projectSlug: folder,
    feature: opts.feature,
    scan: detected as Record<string, unknown> | undefined,
  });
  await fs.writeFile(path.join(root, "prompt.txt"), prompt, "utf8");

  console.log(`\n생성 완료: ${root}`);
  console.log(`  - input/${opts.feature}.md`);
  console.log(`  - spec.md`);
  if (opts.detect) console.log(`  - wireframe-spec.json`);
  console.log(`  - prompt.txt`);
}


export async function runWorkflow(opts: RunWorkflowOpts): Promise<void> {
  const repoPath = (await ask("git clone 후 repo 경로 (Enter=건너뛰기): ")).trim() || undefined;

  let prdPath = "";
  while (!prdPath) {
    prdPath = (await ask("PRD 파일 경로: ")).trim();
    if (!prdPath) console.log("PRD 경로는 필수입니다.");
  }
  const { text: prdText } = await readPrd(prdPath);

  const detect = parseYesNo(await ask("기존 프로젝트를 감지하시겠습니까? (y/n): "));

  let project = opts.project ?? "";
  while (!project) project = (await ask("프로젝트 slug (--project): ")).trim();

  let feature = opts.feature ?? "";
  while (!feature) feature = (await ask("기능 slug (--feature): ")).trim();

  const titleInput = opts.title ?? (await ask("기능 제목 (--title): ")).trim();
  const title = titleInput || feature;

  await writeWorkflowArtifacts({
    projectsRoot: opts.projectsRoot,
    project,
    feature,
    title,
    prdText,
    detect,
    repoPath,
  });
}

export async function runWorkflowFromFlags(argv: string[], projectsRoot: string): Promise<void> {
  if (!argv.some((a) => a.startsWith("--"))) {
    return runWorkflow({ projectsRoot });
  }

  const prd = getFlag(argv, "--prd");
  const project = getFlag(argv, "--project");
  const feature = getFlag(argv, "--feature");
  const title = getFlag(argv, "--title");
  const repo = getFlag(argv, "--repo");
  const detect = parseDetectFlag(argv);

  if (!prd || !project || !feature) {
    throw new Error("필수: --project, --feature, --prd");
  }
  if (detect === undefined) {
    throw new Error("필수: --detect y|n 또는 --mode existing|new");
  }
  if (detect && !repo) {
    throw new Error("기존 프로젝트 감지(--detect y / --mode existing)에는 --repo 가 필요합니다.");
  }

  const { text: prdText } = await readPrd(prd);
  await writeWorkflowArtifacts({
    projectsRoot,
    project,
    feature,
    title: title ?? feature,
    prdText,
    detect,
    repoPath: repo,
  });
}
