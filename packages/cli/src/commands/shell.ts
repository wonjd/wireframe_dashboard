import { buildShellHtml } from "../extractors/shell.js";
import { parseProjectFlag } from "../lib/args.js";
import type { WireframeConfig } from "../lib/config.js";
import { resolveProject } from "../lib/config.js";

export async function buildShell(config: WireframeConfig, args: string[] = []): Promise<void> {
  const project = resolveProject(config, parseProjectFlag(args, config));
  const target = await buildShellHtml(project);
  console.log(`wrote ${target}`);
}
