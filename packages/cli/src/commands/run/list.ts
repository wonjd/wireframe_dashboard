import type { WireframeConfig } from "../../lib/config.js";
import { getProject, loadIndex } from "../../lib/runs.js";

export async function listRuns(config: WireframeConfig, args: string[]): Promise<void> {
  const projectFlagIndex = args.findIndex((arg) => arg === "--project");
  const projectSlug =
    projectFlagIndex !== -1 && args[projectFlagIndex + 1]
      ? args[projectFlagIndex + 1].trim()
      : config.defaultProject;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);

  if (project.runs.length === 0) {
    console.log(`no runs for project ${projectSlug}`);
    return;
  }

  for (const run of project.runs) {
    console.log(
      `${run.no}\t${run.runId}\t${run.status}\t${run.title}\t${run.prdPath}`,
    );
  }
}
