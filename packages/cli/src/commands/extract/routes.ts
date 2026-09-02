import { extractRouteAssets } from "../../extractors/routes.js";
import type { WireframeConfig } from "../../lib/config.js";
import { resolveProject } from "../../lib/config.js";
import { parseProjectFlag } from "../../lib/args.js";

export async function extractRoutes(config: WireframeConfig, args: string[]): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const target = await extractRouteAssets(project);
  console.log(`wrote ${target}`);
}
