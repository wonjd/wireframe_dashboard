import type { WireframeConfig } from "./config.js";

export function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function parseProjectFlag(args: string[], config: WireframeConfig): string {
  return readFlag(args, "--project")?.trim() || config.defaultProject;
}

export function getDbEntities(
  projectExtract: { dbEntities?: string[] } | undefined,
  args: string[],
): string[] {
  const flagIndex = args.findIndex((arg) => arg === "--entities");
  if (flagIndex !== -1 && args[flagIndex + 1]) {
    return args[flagIndex + 1].split(",").map((entity) => entity.trim()).filter(Boolean);
  }
  return projectExtract?.dbEntities ?? [];
}
