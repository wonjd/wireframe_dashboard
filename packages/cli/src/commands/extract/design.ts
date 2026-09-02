import { extractDesignAssets } from "../../extractors/design.js";
import type { WireframeConfig } from "../../lib/config.js";
import { resolveProject } from "../../lib/config.js";
import { parseProjectFlag } from "../../lib/args.js";

export async function extractDesign(config: WireframeConfig, args: string[]): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const target = await extractDesignAssets(project);
  console.log(`wrote ${target}`);
}
