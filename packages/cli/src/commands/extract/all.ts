import { buildShell } from "../shell.js";
import { extractApi } from "./api.js";
import { extractDb } from "./db.js";
import { extractDesign } from "./design.js";
import { extractRoutes } from "./routes.js";
import { getDbEntities, parseProjectFlag } from "../../lib/args.js";
import type { WireframeConfig } from "../../lib/config.js";
import { resolveProject, resolveProjectSourcePaths } from "../../lib/config.js";

type Step = {
  name: string;
  run: () => Promise<void>;
  skip?: boolean;
};

export async function extractAll(config: WireframeConfig, args: string[]): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const { frontend, backend } = resolveProjectSourcePaths(project);
  console.log(`project: ${project.slug}`);
  console.log(`frontend: ${frontend}`);
  console.log(`backend: ${backend}`);

  const entities = getDbEntities(project.extract, args);
  const steps: Step[] = [
    { name: "design", run: () => extractDesign(config, args) },
    { name: "routes", run: () => extractRoutes(config, args) },
    { name: "api", run: () => extractApi(config, args) },
    {
      name: "db",
      run: () => extractDb(config, args),
      skip: entities.length === 0,
    },
    { name: "shell", run: () => buildShell(config, args) },
  ];

  for (const step of steps) {
    if (step.skip) {
      console.log(`[skip] extract ${step.name} — no db entities configured`);
      continue;
    }
    console.log(`[run] extract ${step.name}`);
    try {
      await step.run();
      console.log(`[done] extract ${step.name}`);
    } catch (error) {
      if (step.name === "db") {
        console.log(`[warn] extract ${step.name} failed — ${error instanceof Error ? error.message : error}`);
        continue;
      }
      throw error;
    }
  }

  console.log(`\nextract all finished for project ${project.slug}`);
}
