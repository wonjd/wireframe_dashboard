import { access, stat } from "node:fs/promises";
import path from "node:path";
import { getDbEntities, parseProjectFlag } from "../../lib/args.js";
import {
  getRepoRoot,
  listProjectSlugs,
  loadConfig,
  resolveFromRepo,
  resolveProject,
  resolveProjectSourcePaths,
  type WireframeConfig,
} from "../../lib/config.js";

type Check = {
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function parseValidateArgs(args: string[], config: WireframeConfig): string[] {
  if (args.includes("--all")) {
    return listProjectSlugs(config);
  }
  return [parseProjectFlag(args, config)];
}

async function checkProjectAssets(projectSlug: string): Promise<Check[]> {
  const assetsDir = resolveFromRepo(`projects/${projectSlug}`);
  const assetsOk = await isDirectory(assetsDir);
  return [
    {
      label: `projects/${projectSlug}`,
      ok: assetsOk,
      detail: assetsDir,
      required: false,
    },
  ];
}

export async function validateConfig(args: string[] = []): Promise<void> {
  const repoRoot = getRepoRoot();
  const checks: Check[] = [];

  const baseConfigPath = path.join(repoRoot, "wireframe.config.json");
  const localConfigPath = path.join(repoRoot, "wireframe.config.local.json");

  checks.push({
    label: "wireframe.config.json",
    ok: await pathExists(baseConfigPath),
    detail: baseConfigPath,
    required: true,
  });

  const hasLocal = await pathExists(localConfigPath);
  checks.push({
    label: "wireframe.config.local.json",
    ok: hasLocal,
    detail: hasLocal ? localConfigPath : "optional — copy from wireframe.config.example.json",
    required: false,
  });

  let config: WireframeConfig;
  try {
    config = await loadConfig();
  } catch (error) {
    checks.push({
      label: "config parse",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      required: true,
    });
    printChecks(checks);
    process.exit(1);
  }

  const wireFrameDir = resolveFromRepo(config.paths.wireFrame);
  checks.push({
    label: "paths.wireFrame",
    ok: await isDirectory(wireFrameDir),
    detail: wireFrameDir,
    required: false,
  });

  const projectSlugs = parseValidateArgs(args, config);
  for (const projectSlug of projectSlugs) {
    let project;
    try {
      project = resolveProject(config, projectSlug);
    } catch (error) {
      checks.push({
        label: `project.${projectSlug}`,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        required: true,
      });
      continue;
    }

    const { frontend, backend } = resolveProjectSourcePaths(project);
    checks.push({
      label: `${projectSlug}.sources.frontend`,
      ok: await isDirectory(frontend),
      detail: frontend,
      required: true,
    });
    checks.push({
      label: `${projectSlug}.sources.backend`,
      ok: await isDirectory(backend),
      detail: backend,
      required: true,
    });

    const wonjd = project.sources.wonjd;
    if (wonjd.type === "http") {
      checks.push({
        label: `${projectSlug}.sources.wonjd.url`,
        ok: Boolean(wonjd.url),
        detail: wonjd.url ?? "set wonjd.url or WIREFRAME_WONJD_URL",
        required: false,
      });
    } else {
      const cwd = wonjd.cwd ? path.resolve(repoRoot, wonjd.cwd) : "";
      const command = wonjd.command ?? "";
      const script = (wonjd.args ?? []).join(" ");
      checks.push({
        label: `${projectSlug}.sources.wonjd.cwd`,
        ok: cwd ? await isDirectory(cwd) : false,
        detail: cwd || "set wonjd.cwd to WONJD_DB_CHAT_BOT root",
        required: false,
      });
      checks.push({
        label: `${projectSlug}.sources.wonjd.command`,
        ok: Boolean(command),
        detail: command ? `${command} ${script}`.trim() : "set wonjd.command",
        required: false,
      });
    }

    const entities = getDbEntities(project.extract, args);
    checks.push({
      label: `${projectSlug}.extract.dbEntities`,
      ok: entities.length > 0,
      detail:
        entities.length > 0
          ? entities.join(", ")
          : "set extract.dbEntities in config or pass --entities",
      required: false,
    });

    checks.push(...(await checkProjectAssets(projectSlug)));
  }

  const mysqlEnv = config.mysql?.urlEnv ?? "WIREFRAME_DATABASE_URL";
  const mysqlSet = Boolean(process.env[mysqlEnv]);
  checks.push({
    label: `env.${mysqlEnv}`,
    ok: mysqlSet,
    detail: mysqlSet ? "set" : "optional until run sync / API",
    required: false,
  });

  printChecks(checks);

  const failed = checks.filter((check) => check.required && !check.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} required check(s) failed. Fix paths in wireframe.config.local.json`);
    process.exit(1);
  }

  const target = projectSlugs.length === 1 ? projectSlugs[0] : "all projects";
  console.log(`\nconfig ok — run: wireframe extract all --project ${target}`);
}

function printChecks(checks: Check[]): void {
  for (const check of checks) {
    const mark = check.ok ? "ok" : check.required ? "FAIL" : "skip";
    console.log(`[${mark}] ${check.label}`);
    console.log(`      ${check.detail}`);
  }
}
