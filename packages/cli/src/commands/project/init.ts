import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getRepoRoot,
  normalizeWireframeConfig,
  projectOutputPaths,
  resolveFromRepo,
  type ProjectConfig,
  type WireframeConfig,
} from "../../lib/config.js";
import { getProject, loadIndex, saveIndex } from "../../lib/runs.js";

function slugifyProject(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readConfigFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    await access(filePath);
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeConfigFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function defaultProjectBlock(slug: string, title?: string): ProjectConfig {
  return {
    title: title ?? slug.toUpperCase(),
    sources: {
      frontend: `../${slug}_frontend`,
      backend: `../${slug}_backend`,
      wonjd: {
        type: "cli",
        cwd: "../WONJD_DB_CHAT_BOT",
        command: "uv",
        args: ["run", "db/query.py", "--json"],
      },
    },
    extract: {
      dbEntities: [],
    },
  };
}

async function registerProjectInConfig(
  slug: string,
  title: string,
  template?: ProjectConfig,
): Promise<void> {
  const repoRoot = getRepoRoot();
  const configPath = path.join(repoRoot, "wireframe.config.json");
  const raw = await readConfigFile(configPath);
  const normalized = normalizeWireframeConfig(raw);

  if (normalized.projects[slug]) return;

  normalized.projects[slug] = template ?? defaultProjectBlock(slug, title);
  if (!normalized.defaultProject) {
    normalized.defaultProject = slug;
  }

  await writeConfigFile(configPath, {
    defaultProject: normalized.defaultProject,
    paths: normalized.paths,
    projects: normalized.projects,
    mysql: normalized.mysql,
    _comment:
      typeof raw._comment === "string"
        ? raw._comment
        : "팀원별 절대경로는 wireframe.config.local.json 또는 환경변수로 덮어쓴다.",
  });
}

async function ensureIndexProject(config: WireframeConfig, slug: string, title: string): Promise<void> {
  const index = await loadIndex(config);
  const entry = getProject(index, slug);
  if (entry.title === slug.toUpperCase() || entry.title === slug) {
    entry.title = title;
  }
  await saveIndex(config, index);
}

export async function initProject(config: WireframeConfig, args: string[]): Promise<void> {
  const positional = args.find((arg) => !arg.startsWith("--"));
  const slug = slugifyProject(positional ?? "");
  if (!slug) {
    throw new Error('usage: wireframe project init <slug> [--title "표시 이름"] [--from crm]');
  }

  const title = readFlag(args, "--title")?.trim() ?? slug.toUpperCase();
  const fromSlug = readFlag(args, "--from")?.trim();
  const template = fromSlug ? structuredClone(config.projects[fromSlug]) : undefined;
  if (fromSlug && !template) {
    throw new Error(`template project not found: ${fromSlug}`);
  }

  const assetsDir = resolveFromRepo(`projects/${slug}`);
  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(assetsDir, ".gitkeep"), "", "utf8");

  await registerProjectInConfig(slug, title, template ? { ...template, title } : undefined);
  await ensureIndexProject(config, slug, title);

  const outputs = projectOutputPaths(slug);
  console.log(`project initialized: ${slug}`);
  console.log(`title: ${title}`);
  console.log(`assets: ${assetsDir}`);
  console.log(`config: wireframe.config.json → projects.${slug}`);
  console.log(`next: wireframe extract all --project ${slug}`);
  console.log(`outputs: ${Object.values(outputs).join(", ")}`);
}
