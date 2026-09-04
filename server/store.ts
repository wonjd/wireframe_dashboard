import fs from "node:fs";
import path from "node:path";
import { migrate, query, queryOne } from "./db.js";

/**
 * App store over Postgres. The DB is the source of truth for PRD/spec DATA; the CLI still
 * works in files, so the server rehydrates a run's inputs/specs into a scratch directory
 * before a build and absorbs the produced specs back afterwards. Rendered HTML stays in
 * the scratch cache (regenerated, never stored). See server/schema.sql and server/db.ts.
 */

/** Spec documents kept in run_specs, in the order a run naturally produces them. */
export const SPEC_NAMES = [
  "domain",
  "manifest",
  "features",
  "flow",
  "clarifications",
  "build-context",
  "overrides",
  "graph",
] as const;
export type SpecName = (typeof SPEC_NAMES)[number];

export type RunRow = {
  run_id: string;
  project_slug: string;
  kind: string | null;
  no: string | null;
  title: string | null;
  status: string | null;
  prd_version: number;
  artifact_count: number;
  asset_project_slug: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Gitignored scratch cache the CLI reads/writes and HTML is served from. */
export function scratchRoot(root: string): string {
  const override = (process.env.WIREFRAME_SCRATCH || "").trim();
  return override ? path.resolve(root, override) : path.join(root, ".wireframe-cache");
}

export function ensureMigrated(root: string): Promise<void> {
  return migrate(root);
}

/* ------------------------------------------------------------------ */
/* index.json — rebuilt from DB in the exact shape the client expects */
/* ------------------------------------------------------------------ */

export async function buildIndex(): Promise<{ projects: unknown[] }> {
  const projects = await query<{ slug: string; no: string | null; title: string | null }>(
    "select slug, no, title from projects order by no nulls last, slug",
  );
  const runs = await query<RunRow>(
    "select * from runs order by no nulls last, created_at",
  );
  const byProject = new Map<string, unknown[]>();
  for (const run of runs) {
    const list = byProject.get(run.project_slug) ?? [];
    list.push({
      runId: run.run_id,
      kind: run.kind ?? "wireframe",
      no: run.no,
      title: run.title,
      status: run.status,
      prdVersion: run.prd_version,
      prdPath: `runs/${run.run_id}/input/v${run.prd_version}.md`,
      createdAt: run.created_at instanceof Date ? run.created_at.toISOString() : run.created_at,
      updatedAt: run.updated_at instanceof Date ? run.updated_at.toISOString() : run.updated_at,
      artifactCount: run.artifact_count,
      assetProjectSlug: run.asset_project_slug ?? undefined,
    });
    byProject.set(run.project_slug, list);
  }
  return {
    projects: projects.map((project) => ({
      no: project.no,
      slug: project.slug,
      title: project.title,
      runs: byProject.get(project.slug) ?? [],
    })),
  };
}

/* ------------------------------------------------------------------ */
/* run / spec / input primitives                                      */
/* ------------------------------------------------------------------ */

export function getRun(runId: string): Promise<RunRow | null> {
  return queryOne<RunRow>("select * from runs where run_id = $1", [runId]);
}

export async function upsertProject(slug: string, no: string | null, title: string | null): Promise<void> {
  await query(
    `insert into projects (slug, no, title) values ($1,$2,$3)
     on conflict (slug) do update set no = excluded.no, title = excluded.title, updated_at = now()`,
    [slug, no, title],
  );
}

export async function upsertRun(run: {
  runId: string;
  projectSlug: string;
  kind?: string;
  no?: string | null;
  title?: string | null;
  status?: string | null;
  prdVersion?: number;
  artifactCount?: number;
  assetProjectSlug?: string | null;
}): Promise<void> {
  await query(
    `insert into runs
       (run_id, project_slug, kind, no, title, status, prd_version, artifact_count, asset_project_slug)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (run_id) do update set
       project_slug = excluded.project_slug, kind = excluded.kind, no = excluded.no,
       title = excluded.title, status = excluded.status, prd_version = excluded.prd_version,
       artifact_count = excluded.artifact_count, asset_project_slug = excluded.asset_project_slug,
       updated_at = now()`,
    [
      run.runId,
      run.projectSlug,
      run.kind ?? "wireframe",
      run.no ?? null,
      run.title ?? null,
      run.status ?? null,
      run.prdVersion ?? 1,
      run.artifactCount ?? 0,
      run.assetProjectSlug ?? null,
    ],
  );
}

export async function getSpec(runId: string, name: SpecName): Promise<unknown | null> {
  const row = await queryOne<{ data: unknown }>(
    "select data from run_specs where run_id = $1 and name = $2",
    [runId, name],
  );
  return row?.data ?? null;
}

export async function putSpec(runId: string, name: SpecName, data: unknown): Promise<void> {
  await query(
    `insert into run_specs (run_id, name, data) values ($1,$2,$3)
     on conflict (run_id, name) do update set data = excluded.data, updated_at = now()`,
    [runId, name, JSON.stringify(data)],
  );
}

export async function getInput(runId: string, version: number): Promise<string | null> {
  const row = await queryOne<{ content: string }>(
    "select content from run_inputs where run_id = $1 and version = $2",
    [runId, version],
  );
  return row?.content ?? null;
}

export async function putInput(runId: string, version: number, content: string): Promise<void> {
  await query(
    `insert into run_inputs (run_id, version, content) values ($1,$2,$3)
     on conflict (run_id, version) do update set content = excluded.content`,
    [runId, version, content],
  );
}

/* ------------------------------------------------------------------ */
/* scratch sync — DB ⇄ files, around a CLI build                      */
/* ------------------------------------------------------------------ */

function runScratchDir(root: string, runId: string): string {
  return path.join(scratchRoot(root), "runs", runId);
}

/** DB → scratch files, so the file-based CLI can read this run's inputs and specs. */
export async function rehydrateScratch(root: string, runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  const dir = runScratchDir(root, runId);
  fs.mkdirSync(path.join(dir, "input"), { recursive: true });
  fs.mkdirSync(path.join(dir, "spec"), { recursive: true });
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });

  const input = await getInput(runId, run.prd_version);
  if (input != null) {
    fs.writeFileSync(path.join(dir, "input", `v${run.prd_version}.md`), input, "utf8");
  }
  for (const name of SPEC_NAMES) {
    const data = await getSpec(runId, name);
    if (data == null) continue;
    fs.writeFileSync(
      path.join(dir, "spec", `${name}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
  }

  // A per-run index.json so the CLI's index lookups resolve without the full registry.
  const index = await buildIndex();
  fs.writeFileSync(
    path.join(scratchRoot(root), "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

/** Scratch spec files (produced by a build) → DB, plus the refreshed run metadata. */
export async function absorbScratch(root: string, runId: string): Promise<void> {
  const dir = runScratchDir(root, runId);
  const specDir = path.join(dir, "spec");
  for (const name of SPEC_NAMES) {
    const file = path.join(specDir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      await putSpec(runId, name, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      /* skip an unreadable spec rather than fail the whole absorb */
    }
  }
  // The build rewrites the scratch index.json with fresh run metadata (status, count).
  const indexFile = path.join(scratchRoot(root), "index.json");
  if (!fs.existsSync(indexFile)) return;
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    for (const project of index.projects ?? []) {
      for (const run of project.runs ?? []) {
        if (run.runId !== runId) continue;
        await upsertRun({
          runId,
          projectSlug: project.slug,
          kind: run.kind,
          no: run.no,
          title: run.title,
          status: run.status,
          prdVersion: run.prdVersion,
          artifactCount: run.artifactCount,
          assetProjectSlug: run.assetProjectSlug ?? null,
        });
      }
    }
  } catch {
    /* leave run metadata as-is if the index is unreadable */
  }
}
