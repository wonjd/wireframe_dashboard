import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectOutputs, ResolvedProject } from "./config.js";

export type OutputKey = keyof ProjectOutputs;

export async function writeProjectJson(
  project: ResolvedProject,
  key: OutputKey,
  data: unknown,
): Promise<string> {
  const target = project.outputs[key];
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return target;
}

export async function writeProjectText(
  project: ResolvedProject,
  key: OutputKey,
  content: string,
): Promise<string> {
  const target = project.outputs[key];
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}
