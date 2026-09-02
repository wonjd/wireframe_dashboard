import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import type { WireframeConfig } from "../../lib/config.js";
import {
  allocatePrdNo,
  ensureRunDirs,
  getProject,
  getRunPrdPath,
  loadIndex,
  saveIndex,
  slugifyRunId,
  toWireFrameRelative,
  type RunEntry,
} from "../../lib/runs.js";

type CreateArgs = {
  title: string;
  runId?: string;
  projectSlug?: string;
  prdPath?: string;
};

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseCreateArgs(args: string[]): CreateArgs {
  const title = readFlag(args, "--title");
  if (!title?.trim()) {
    throw new Error(
      "usage: wireframe run create --title \"기능명\" [--run-id slug] [--project crm] [--prd ./path.md | --prd -]",
    );
  }

  return {
    title: title.trim(),
    runId: readFlag(args, "--run-id")?.trim(),
    projectSlug: readFlag(args, "--project")?.trim(),
    prdPath: readFlag(args, "--prd")?.trim(),
  };
}

async function readPrdContent(prdPath?: string): Promise<string> {
  if (!prdPath || prdPath === "-") {
    if (process.stdin.isTTY) {
      throw new Error("PRD 본문이 필요합니다. --prd ./file.md 또는 --prd - (stdin)을 사용하세요.");
    }
    return fs.readFileSync(0, "utf8");
  }

  return readFile(prdPath, "utf8");
}

export async function createRun(config: WireframeConfig, args: string[]): Promise<void> {
  const parsed = parseCreateArgs(args);
  const projectSlug = parsed.projectSlug ?? config.defaultProject;
  const runId = slugifyRunId(parsed.runId ?? parsed.title);

  if (!runId) {
    throw new Error("run-id를 만들 수 없습니다. --run-id를 직접 지정하세요.");
  }

  const prdBody = (await readPrdContent(parsed.prdPath)).trim();
  if (!prdBody) {
    throw new Error("PRD 본문이 비어 있습니다.");
  }

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);

  if (project.runs.some((run) => run.runId === runId)) {
    throw new Error(`run already exists: ${runId} (프로젝트 ${projectSlug})`);
  }

  const now = new Date().toISOString();
  const prdVersion = 1;
  await ensureRunDirs(config, runId);

  const prdAbsolutePath = getRunPrdPath(config, runId, prdVersion);
  const prdRelativePath = toWireFrameRelative(config, prdAbsolutePath);
  const prdContent = `${prdBody}\n`;
  await writeFile(prdAbsolutePath, prdContent, "utf8");

  const entry: RunEntry = {
    runId,
    kind: "wireframe",
    no: allocatePrdNo(project.runs),
    title: parsed.title,
    status: "draft",
    prdVersion,
    prdPath: prdRelativePath,
    createdAt: now,
    updatedAt: now,
    artifactCount: 0,
  };

  project.runs.unshift(entry);
  const indexPath = await saveIndex(config, index);

  console.log(`run created: ${runId}`);
  console.log(`project: ${projectSlug}`);
  console.log(`prd: ${prdRelativePath}`);
  console.log(`index: ${indexPath}`);
}
