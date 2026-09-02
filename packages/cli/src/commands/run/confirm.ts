import type { WireframeConfig } from "../../lib/config.js";
import { getProject, loadIndex, saveIndex } from "../../lib/runs.js";

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function confirmRun(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error("usage: wireframe run confirm --run-id slug [--project crm]");
  }

  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);

  if (!run) {
    throw new Error(`run not found: ${runId} (project ${projectSlug})`);
  }

  run.status = "confirmed";
  run.updatedAt = new Date().toISOString();
  const indexPath = await saveIndex(config, index);

  console.log(`wireframe confirmed: ${runId}`);
  console.log(`project: ${projectSlug}`);
  console.log(`index: ${indexPath}`);
}
