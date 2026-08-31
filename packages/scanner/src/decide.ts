import fs from "node:fs/promises";
import path from "node:path";
import type { ExistingContext } from "@wireframe-studio/core";
import { detectExistingContext } from "./context.js";
import { detectDatabase } from "./db-detect.js";

export type WorkflowDecision = {
  mode: "existing" | "new";
  repoPath?: string;
  reason: string;
  context?: ExistingContext;
};

type Pkg = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readPkg(dir: string): Promise<Pkg | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as Pkg;
  } catch {
    return null;
  }
}

export async function isWireframeStudio(dir: string): Promise<boolean> {
  const pkg = await readPkg(dir);
  if (pkg?.name === "wireframe-studio") return true;
  return (await exists(path.join(dir, "packages", "scanner"))) && (await exists(path.join(dir, "AGENTS.md")));
}

export async function looksLikeProductRepo(dir: string): Promise<boolean> {
  if (!(await exists(dir))) return false;
  if (await isWireframeStudio(dir)) return false;
  const pkg = await readPkg(dir);
  if (!pkg) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasFw = Boolean(deps.next || deps.react || deps.vue || deps.nuxt);
  const hasApp =
    (await exists(path.join(dir, "app"))) ||
    (await exists(path.join(dir, "src", "app"))) ||
    (await exists(path.join(dir, "pages"))) ||
    (await exists(path.join(dir, "src")));
  const db = await detectDatabase(dir);
  return hasFw || db.detected || hasApp;
}

/** PRD만 받은 뒤: 기존 코드베이스면 existing, 없으면 new. y/n 없음. */
export async function decideWorkflow(hint?: string): Promise<WorkflowDecision> {
  const raw = [hint?.trim(), process.env.WIREFRAME_REPO?.trim(), process.cwd(), path.dirname(process.cwd())].filter(
    Boolean
  ) as string[];
  const candidates = [...new Set(raw.map((p) => path.resolve(p)))];

  for (const dir of candidates) {
    if (!(await exists(dir))) continue;
    if (await isWireframeStudio(dir)) continue;
    if (!(await looksLikeProductRepo(dir))) continue;

    const context = await detectExistingContext(dir);
    const bits = [
      context.framework !== "unknown" ? context.framework : null,
      context.database.detected ? `${context.database.orm ?? "db"}/${context.database.provider ?? "?"}` : null,
    ].filter(Boolean);
    return {
      mode: "existing",
      repoPath: dir,
      reason: bits.length ? `${path.basename(dir)} (${bits.join(", ")})` : path.basename(dir),
      context,
    };
  }

  return { mode: "new", reason: "기존 코드베이스가 없어 새 프로젝트로 구성합니다." };
}
