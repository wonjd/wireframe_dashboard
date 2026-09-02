import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type WonjdSource = {
  type: "cli" | "http";
  cwd?: string;
  command?: string;
  args?: string[];
  url?: string;
};

export type ProjectSources = {
  frontend: string;
  backend: string;
  wonjd: WonjdSource;
};

export type ProjectConfig = {
  title?: string;
  sources: ProjectSources;
  extract?: {
    dbEntities?: string[];
  };
};

export type ProjectOutputs = {
  design: string;
  routes: string;
  api: string;
  db: string;
  shell: string;
};

export type ResolvedProject = {
  slug: string;
  title: string;
  sources: ProjectSources;
  extract?: ProjectConfig["extract"];
  assetsDir: string;
  outputs: ProjectOutputs;
};

export type WireframeConfig = {
  defaultProject: string;
  paths: {
    wireFrame: string;
  };
  projects: Record<string, ProjectConfig>;
  mysql: {
    urlEnv: string;
  };
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const ENV_KEYS = {
  frontend: "WIREFRAME_SOURCE_FRONTEND",
  backend: "WIREFRAME_SOURCE_BACKEND",
  wonjdCommand: "WIREFRAME_WONJD_COMMAND",
  wonjdUrl: "WIREFRAME_WONJD_URL",
} as const;

export function getRepoRoot(): string {
  return repoRoot;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("_")) continue;
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

function defaultProjectTitle(slug: string): string {
  if (slug === "crm") return "CRM";
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function projectOutputPaths(slug: string): ProjectOutputs {
  const root = `projects/${slug}`;
  return {
    design: `${root}/design.json`,
    routes: `${root}/routes.json`,
    api: `${root}/api.json`,
    db: `${root}/db.json`,
    shell: `${root}/shell.html`,
  };
}

function asProjectSources(value: unknown): ProjectSources | null {
  if (!isPlainObject(value)) return null;
  const frontend = value.frontend;
  const backend = value.backend;
  const wonjd = value.wonjd;
  if (typeof frontend !== "string" || typeof backend !== "string" || !isPlainObject(wonjd)) {
    return null;
  }
  return {
    frontend,
    backend,
    wonjd: wonjd as WonjdSource,
  };
}

function asProjectConfig(value: unknown, slug: string): ProjectConfig | null {
  if (!isPlainObject(value)) return null;
  const sources = asProjectSources(value.sources);
  if (!sources) return null;
  const extract = isPlainObject(value.extract)
    ? {
        dbEntities: Array.isArray(value.extract.dbEntities)
          ? value.extract.dbEntities.map(String)
          : undefined,
      }
    : undefined;
  return {
    title: typeof value.title === "string" ? value.title : defaultProjectTitle(slug),
    sources,
    extract,
  };
}

function normalizeConfig(raw: Record<string, unknown>): WireframeConfig {
  const slug =
    (typeof raw.defaultProject === "string" && raw.defaultProject) ||
    (typeof raw.projectSlug === "string" && raw.projectSlug) ||
    "crm";

  if (isPlainObject(raw.projects)) {
    const projects: Record<string, ProjectConfig> = {};
    for (const [projectSlug, value] of Object.entries(raw.projects)) {
      const parsed = asProjectConfig(value, projectSlug);
      if (parsed) projects[projectSlug] = parsed;
    }
    if (Object.keys(projects).length > 0) {
      return {
        defaultProject: slug,
        paths: {
          wireFrame:
            isPlainObject(raw.paths) && typeof raw.paths.wireFrame === "string"
              ? raw.paths.wireFrame
              : "wireFrame",
        },
        projects,
        mysql: {
          urlEnv:
            isPlainObject(raw.mysql) && typeof raw.mysql.urlEnv === "string"
              ? raw.mysql.urlEnv
              : "WIREFRAME_DATABASE_URL",
        },
      };
    }
  }

  const sources = asProjectSources(raw.sources);
  if (!sources) {
    throw new Error("wireframe.config.json: projects 또는 sources 블록이 필요합니다.");
  }

  const extract = isPlainObject(raw.extract)
    ? {
        dbEntities: Array.isArray(raw.extract.dbEntities)
          ? raw.extract.dbEntities.map(String)
          : undefined,
      }
    : undefined;

  return {
    defaultProject: slug,
    paths: {
      wireFrame:
        isPlainObject(raw.paths) && typeof raw.paths.wireFrame === "string"
          ? raw.paths.wireFrame
          : "wireFrame",
    },
    projects: {
      [slug]: {
        title: defaultProjectTitle(slug),
        sources,
        extract,
      },
    },
    mysql: {
      urlEnv:
        isPlainObject(raw.mysql) && typeof raw.mysql.urlEnv === "string"
          ? raw.mysql.urlEnv
          : "WIREFRAME_DATABASE_URL",
    },
  };
}

function applyEnvOverrides(config: WireframeConfig): WireframeConfig {
  const next = structuredClone(config);
  const frontend = process.env[ENV_KEYS.frontend];
  const backend = process.env[ENV_KEYS.backend];
  const wonjdCommand = process.env[ENV_KEYS.wonjdCommand];
  const wonjdUrl = process.env[ENV_KEYS.wonjdUrl];

  const defaultProject = next.projects[next.defaultProject];
  if (!defaultProject) return next;

  if (frontend) defaultProject.sources.frontend = frontend;
  if (backend) defaultProject.sources.backend = backend;
  if (wonjdCommand) {
    defaultProject.sources.wonjd.type = "cli";
    defaultProject.sources.wonjd.command = wonjdCommand;
  }
  if (wonjdUrl) {
    defaultProject.sources.wonjd.type = "http";
    defaultProject.sources.wonjd.url = wonjdUrl;
  }

  return next;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<WireframeConfig> {
  const basePath = path.join(repoRoot, "wireframe.config.json");
  const localPath = path.join(repoRoot, "wireframe.config.local.json");

  const base = (await readJsonIfExists(basePath)) ?? {};
  const local = await readJsonIfExists(localPath);
  const merged = local ? deepMerge(base, local) : base;

  return applyEnvOverrides(normalizeConfig(merged));
}

export function listProjectSlugs(config: WireframeConfig): string[] {
  return Object.keys(config.projects).sort();
}

export function resolveProject(config: WireframeConfig, slug?: string): ResolvedProject {
  const projectSlug = slug?.trim() || config.defaultProject;
  const project = config.projects[projectSlug];
  if (!project) {
    const available = listProjectSlugs(config).join(", ") || "(none)";
    throw new Error(`unknown project: ${projectSlug} — configured: ${available}`);
  }

  const outputs = projectOutputPaths(projectSlug);
  return {
    slug: projectSlug,
    title: project.title ?? defaultProjectTitle(projectSlug),
    sources: project.sources,
    extract: project.extract,
    assetsDir: resolveFromRepo(`projects/${projectSlug}`),
    outputs: {
      design: resolveFromRepo(outputs.design),
      routes: resolveFromRepo(outputs.routes),
      api: resolveFromRepo(outputs.api),
      db: resolveFromRepo(outputs.db),
      shell: resolveFromRepo(outputs.shell),
    },
  };
}

/** 레포 내부 산출물 — 상대경로는 repo root 기준 */
export function resolveFromRepo(relativePath: string): string {
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(repoRoot, relativePath);
}

/** CRM/WONJD 소스 — 절대경로 그대로, 상대경로는 repo root 기준 */
export function resolveSourcePath(sourcePath: string): string {
  return path.isAbsolute(sourcePath)
    ? path.normalize(sourcePath)
    : path.resolve(repoRoot, sourcePath);
}

export function normalizeWireframeConfig(raw: Record<string, unknown>): WireframeConfig {
  return normalizeConfig(raw);
}

export function resolveProjectSourcePaths(project: ResolvedProject) {
  return {
    frontend: resolveSourcePath(project.sources.frontend),
    backend: resolveSourcePath(project.sources.backend),
    wonjd: project.sources.wonjd,
  };
}
