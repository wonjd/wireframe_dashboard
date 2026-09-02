import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import type { WireframeConfig } from "../../lib/config.js";
import { getProject, getRunPrdPath, loadIndex, saveIndex } from "../../lib/runs.js";

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
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

export async function updateRun(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error("usage: wireframe run update --run-id slug [--project crm] [--title \"제목\"] [--prd ./file.md | --prd -]");
  }

  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const title = readFlag(args, "--title")?.trim();
  const prdPath = readFlag(args, "--prd")?.trim();

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) {
    throw new Error(`run not found: ${runId} (project ${projectSlug})`);
  }

  if (title) run.title = title;

  if (prdPath !== undefined) {
    const prdBody = (await readPrdContent(prdPath)).trim();
    if (!prdBody) throw new Error("PRD 본문이 비어 있습니다.");
    await writeFile(getRunPrdPath(config, runId, run.prdVersion), `${prdBody}\n`, "utf8");
  } else if (!title) {
    throw new Error("--title 또는 --prd 중 하나는 필요합니다.");
  }

  run.updatedAt = new Date().toISOString();
  const indexPath = await saveIndex(config, index);

  console.log(`run updated: ${runId}`);
  console.log(`project: ${projectSlug}`);
  console.log(`index: ${indexPath}`);
}
