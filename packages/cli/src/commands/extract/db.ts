import { extractDbAssets } from "../../extractors/db.js";
import { getDbEntities, parseProjectFlag } from "../../lib/args.js";
import type { WireframeConfig } from "../../lib/config.js";
import { resolveProject } from "../../lib/config.js";

export async function extractDb(config: WireframeConfig, args: string[]): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const entities = getDbEntities(project.extract, args);
  const target = await extractDbAssets(project, entities);
  console.log(`wrote ${target}`);
}
