import { extractApiAssets } from "../../extractors/api.js";
import type { WireframeConfig } from "../../lib/config.js";
import { resolveProject } from "../../lib/config.js";
import { parseProjectFlag } from "../../lib/args.js";

export async function extractApi(config: WireframeConfig, args: string[]): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const target = await extractApiAssets(project);
  console.log(`wrote ${target}`);
}
