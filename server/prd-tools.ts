import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CliJson = Record<string, unknown>;

function cliEntry(root: string): string {
  return path.join(root, "packages", "cli", "bin", "wireframe.js");
}

export function runWireframeCli(
  root: string,
  args: string[],
  opts?: { timeoutMs?: number },
): {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
} {
  const entry = cliEntry(root);
  if (!fs.existsSync(entry)) {
    return { ok: false, stdout: "", stderr: `missing CLI: ${entry}`, code: 1 };
  }
  const proc = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
    timeout: opts?.timeoutMs ?? 120_000,
  });
  return {
    ok: proc.status === 0,
    stdout: (proc.stdout || "").trim(),
    stderr: (proc.stderr || "").trim() || (proc.error ? String(proc.error.message) : ""),
    code: proc.status ?? 1,
  };
}

function parseJsonStdout(stdout: string): CliJson {
  const start = stdout.indexOf("{");
  if (start === -1) return { raw: stdout };
  try {
    return JSON.parse(stdout.slice(start)) as CliJson;
  } catch {
    return { raw: stdout };
  }
}

function writeTempPrd(content: string): string {
  const file = path.join(os.tmpdir(), `wf-prd-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(file, content.replace(/^\uFEFF/, "").trimEnd() + "\n", "utf8");
  return file;
}

export function prdSave(input: {
  root: string;
  title: string;
  content: string;
  project?: string;
  runId?: string;
}): CliJson {
  const project = input.project || "crm";
  const tmp = writeTempPrd(input.content);
  try {
    const args = input.runId
      ? ["run", "update", "--run-id", input.runId, "--project", project, "--prd", tmp, "--title", input.title]
      : ["run", "create", "--title", input.title, "--project", project, "--prd", tmp];
    if (input.runId && !input.title) {
      // update without forcing title rewrite if empty — still pass title for create path only
    }
    const result = runWireframeCli(input.root, args);
    if (!result.ok) {
      return { ok: false, error: result.stderr || result.stdout || `exit ${result.code}` };
    }
    let runId = input.runId || "";
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(/^run (?:created|updated):\s*(.+)$/i);
      if (match) runId = match[1].trim();
    }
    if (!runId && input.runId) runId = input.runId;

    const review = runWireframeCli(input.root, [
      "prd",
      "review",
      "--run-id",
      runId,
      "--project",
      project,
    ]);
    const reviewJson = review.ok ? parseJsonStdout(review.stdout) : { ok: false, error: review.stderr };
    return {
      ok: true,
      runId,
      project,
      action: input.runId ? "update" : "create",
      detail: result.stdout,
      review: reviewJson,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function prdReview(input: { root: string; runId: string; project?: string }): CliJson {
  const project = input.project || "crm";
  const result = runWireframeCli(input.root, [
    "prd",
    "review",
    "--run-id",
    input.runId,
    "--project",
    project,
  ]);
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout };
  return { ok: true, ...parseJsonStdout(result.stdout) };
}

export function prdAnswer(input: {
  root: string;
  runId: string;
  project?: string;
  answers: Array<{ id: string; answer: string }>;
}): CliJson {
  const project = input.project || "crm";
  const result = runWireframeCli(input.root, [
    "prd",
    "answer",
    "--run-id",
    input.runId,
    "--project",
    project,
    "--answers",
    JSON.stringify(input.answers),
  ]);
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout };
  return { ok: true, ...parseJsonStdout(result.stdout) };
}

export type PrdListItem = {
  runId: string;
  title: string;
  status: string;
  prdVersion: number;
  artifactCount: number;
  updatedAt?: string;
  createdAt?: string;
  projectSlug: string;
  projectNo: string;
  projectTitle: string;
  no?: string;
  routeId?: string;
};

type IndexRun = {
  runId: string;
  title: string;
  status: string;
  prdVersion: number;
  prdPath?: string;
  artifactCount?: number;
  updatedAt?: string;
  createdAt?: string;
  no?: string;
};

type IndexProject = {
  no: string;
  slug: string;
  title: string;
  runs?: IndexRun[];
};

function indexPath(root: string): string {
  return path.join(root, "wireFrame", "index.json");
}

function readIndex(root: string): { projects: IndexProject[] } | null {
  const p = indexPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as { projects: IndexProject[] };
  } catch {
    return null;
  }
}

function writeIndex(root: string, index: { projects: IndexProject[] }): void {
  fs.writeFileSync(indexPath(root), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function rmDirSafe(abs: string): void {
  if (!fs.existsSync(abs)) return;
  fs.rmSync(abs, { recursive: true, force: true });
}

/** Remove a PRD run (index entry + runs/{runId} folder). */
export function prdDelete(input: {
  root: string;
  runId: string;
  project?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };

  const realRunId = hit.run.runId;
  const runsRoot = path.join(input.root, "wireFrame", "runs");
  const runDir = path.join(runsRoot, realRunId);
  const resolved = path.resolve(runDir);
  if (!resolved.startsWith(path.resolve(runsRoot) + path.sep) && resolved !== path.resolve(runsRoot)) {
    return { ok: false, error: "invalid run path" };
  }

  hit.project.runs = (hit.project.runs ?? []).filter((r) => r.runId !== realRunId);
  writeIndex(input.root, index);
  rmDirSafe(runDir);

  // Legacy flat spec files (if any)
  const legacySpec = path.join(input.root, "wireFrame", "spec");
  if (fs.existsSync(legacySpec)) {
    for (const name of fs.readdirSync(legacySpec)) {
      if (name.startsWith(`${realRunId}.`) || name === `${realRunId}.json`) {
        try {
          fs.unlinkSync(path.join(legacySpec, name));
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    ok: true,
    deleted: true,
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    no: hit.run.no,
    title: hit.run.title,
  };
}

/** Clear wireframe HTML/artifacts for a run; keep PRD input. */
export function wireframeDelete(input: {
  root: string;
  runId: string;
  project?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };

  const realRunId = hit.run.runId;
  const runsRoot = path.join(input.root, "wireFrame", "runs");
  const artifactsDir = path.join(runsRoot, realRunId, "artifacts");
  const resolved = path.resolve(artifactsDir);
  const allowed = path.resolve(path.join(runsRoot, realRunId));
  if (!resolved.startsWith(allowed + path.sep) && resolved !== allowed) {
    return { ok: false, error: "invalid artifact path" };
  }

  rmDirSafe(artifactsDir);
  // Keep domain/manifest/build-context for rebuild; zero out count in index
  hit.run.artifactCount = 0;
  hit.run.updatedAt = new Date().toISOString();
  if (hit.run.status === "confirmed") {
    hit.run.status = "ready";
  }
  writeIndex(input.root, index);

  return {
    ok: true,
    deleted: "wireframes",
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    no: hit.run.no,
    title: hit.run.title,
    artifactCount: 0,
    status: hit.run.status,
  };
}

function findRun(
  index: { projects: IndexProject[] },
  idOrSlug: string,
  projectSlug?: string,
): { project: IndexProject; run: IndexRun } | null {
  const key = idOrSlug.trim();
  if (!key) return null;

  const matchIn = (projects: IndexProject[]) => {
    for (const project of projects) {
      const run = (project.runs ?? []).find(
        (r) => r.runId === key || (r.no && r.no === key),
      );
      if (run) return { project, run };
    }
    return null;
  };

  const scoped = projectSlug
    ? index.projects.filter((p) => p.slug === projectSlug)
    : index.projects;
  return matchIn(scoped) ?? (projectSlug ? matchIn(index.projects) : null);
}

export function prdList(input: { root: string; project?: string }): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing", runs: [] };
  const slugFilter = input.project?.trim();
  const items: PrdListItem[] = [];
  for (const project of index.projects ?? []) {
    if (slugFilter && project.slug !== slugFilter) continue;
    for (const run of project.runs ?? []) {
      items.push({
        runId: run.runId,
        title: run.title,
        status: run.status,
        prdVersion: run.prdVersion,
        artifactCount: run.artifactCount ?? 0,
        updatedAt: run.updatedAt,
        createdAt: run.createdAt,
        projectSlug: project.slug,
        projectNo: project.no,
        projectTitle: project.title,
        no: run.no,
        routeId: run.no || run.runId,
      });
    }
  }
  items.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || "") || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || "") || 0;
    return tb - ta;
  });
  return { ok: true, runs: items };
}

export function prdGet(input: { root: string; runId: string; project?: string }): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const { project, run } = hit;
  const prdPath = path.join(input.root, "wireFrame", "runs", run.runId, "input", `v${run.prdVersion}.md`);
  const clarPath = path.join(input.root, "wireFrame", "runs", run.runId, "spec", "clarifications.json");
  const content = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, "utf8") : "";
  let clarifications: unknown = null;
  if (fs.existsSync(clarPath)) {
    try {
      clarifications = JSON.parse(fs.readFileSync(clarPath, "utf8"));
    } catch {
      clarifications = null;
    }
  }
  return {
    ok: true,
    runId: run.runId,
    routeId: run.no || run.runId,
    title: run.title,
    status: run.status,
    prdVersion: run.prdVersion,
    artifactCount: run.artifactCount ?? 0,
    updatedAt: run.updatedAt,
    createdAt: run.createdAt,
    projectSlug: project.slug,
    projectNo: project.no,
    projectTitle: project.title,
    no: run.no,
    content,
    clarifications,
  };
}

export function prdBuild(input: {
  root: string;
  runId: string;
  project?: string;
  assetProject?: string;
}): CliJson {
  const project = input.project || "crm";
  const assetProject = input.assetProject || project;
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, project);
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  if (hit.run.status !== "ready" && hit.run.status !== "confirmed") {
    return {
      ok: false,
      error: `PRD가 아직 확정(ready)이 아닙니다 (status=${hit.run.status}). 보완·승인을 먼저 끝내 주세요.`,
      status: hit.run.status,
    };
  }

  const realRunId = hit.run.runId;
  const result = runWireframeCli(
    input.root,
    [
      "run",
      "build",
      "--run-id",
      realRunId,
      "--project",
      project,
      "--asset-project",
      assetProject,
    ],
    { timeoutMs: 10 * 60 * 1000 },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || `exit ${result.code}`,
      detail: result.stdout,
    };
  }

  const fresh = prdGet({ root: input.root, runId: realRunId, project });
  const screens = listWireframeScreens({ root: input.root, runId: realRunId });
  return {
    ok: true,
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    project,
    status: fresh.status,
    artifactCount: fresh.artifactCount,
    screens: screens.screens,
    detail: result.stdout,
  };
}

export type WireframeScreenItem = {
  runId: string;
  runTitle: string;
  runNo?: string;
  projectNo: string;
  projectSlug: string;
  projectTitle: string;
  screenId: string;
  label: string;
  file: string;
  url: string;
  linkTitle: string;
};

export function listWireframeScreens(input: {
  root: string;
  project?: string;
  runId?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing", screens: [] };
  const slugFilter = input.project?.trim();
  const screens: WireframeScreenItem[] = [];

  for (const project of index.projects ?? []) {
    if (slugFilter && project.slug !== slugFilter) continue;
    for (const run of project.runs ?? []) {
      if (input.runId && run.runId !== input.runId) continue;
      const manifestPath = path.join(
        input.root,
        "wireFrame",
        "runs",
        run.runId,
        "spec",
        "manifest.json",
      );
      if (!fs.existsSync(manifestPath)) continue;
      let artifacts: Array<{ id: string; label: string; file: string }> = [];
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
          artifacts?: Array<{ id: string; label: string; file: string }>;
          screens?: Array<{ id: string; label: string; file: string }>;
        };
        artifacts = raw.artifacts?.length
          ? raw.artifacts
          : (raw.screens ?? []).map((s) => ({
              id: s.id,
              label: s.label,
              file: s.file,
            }));
      } catch {
        continue;
      }

      for (const art of artifacts) {
        if (!art.file || art.id === "00-overview") continue;
        const abs = path.join(input.root, "wireFrame", "runs", run.runId, "artifacts", art.file);
        if (!fs.existsSync(abs)) continue;
        const encRun = encodeURIComponent(run.runId);
        const encFile = encodeURIComponent(art.file);
        const url = `/runs/${encRun}/artifacts/${encFile}`;
        const linkTitle = `${art.label} — ${run.title}`;
        screens.push({
          runId: run.runId,
          runTitle: run.title,
          runNo: run.no,
          projectNo: project.no,
          projectSlug: project.slug,
          projectTitle: project.title,
          screenId: art.id,
          label: art.label,
          file: art.file,
          url,
          linkTitle,
        });
      }
    }
  }

  return { ok: true, screens };
}

type ManifestArtifactRow = {
  id: string;
  no: number;
  label: string;
  file: string;
  locked: boolean;
  updatedAt?: string;
  instructions: Array<{ at: string; text: string }>;
};

type ManifestDoc = {
  runId?: string;
  title?: string;
  status?: string;
  artifacts?: ManifestArtifactRow[];
};

function manifestPath(root: string, runId: string): string {
  return path.join(root, "wireFrame", "runs", runId, "spec", "manifest.json");
}

function readManifest(root: string, runId: string): ManifestDoc | null {
  const p = manifestPath(root, runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ManifestDoc;
  } catch {
    return null;
  }
}

function writeManifest(root: string, runId: string, doc: ManifestDoc): void {
  fs.writeFileSync(manifestPath(root, runId), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

export function wireframeManifest(input: {
  root: string;
  runId: string;
  project?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;
  const man = readManifest(input.root, realRunId);
  if (!man) return { ok: false, error: "manifest.json missing" };

  const artifacts = (man.artifacts ?? [])
    .filter((a) => a.id !== "00-overview")
    .map((a) => ({
      id: a.id,
      no: a.no,
      label: a.label,
      file: a.file,
      locked: Boolean(a.locked),
      updatedAt: a.updatedAt,
      instructions: Array.isArray(a.instructions) ? a.instructions : [],
      url: `/runs/${encodeURIComponent(realRunId)}/artifacts/${encodeURIComponent(a.file)}`,
    }));

  return {
    ok: true,
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    no: hit.run.no,
    title: hit.run.title,
    status: hit.run.status,
    projectSlug: hit.project.slug,
    projectNo: hit.project.no,
    artifacts,
  };
}

/** Multi-turn: append instruction and re-render one artifact. */
export function wireframeRefine(input: {
  root: string;
  runId: string;
  artifactId: string;
  instruction: string;
  project?: string;
}): CliJson {
  const project = input.project || "crm";
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, project);
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  if (hit.run.status === "confirmed") {
    return { ok: false, error: "이미 승인(confirmed)된 와이어프레임입니다. 잠금을 해제한 뒤 수정하세요." };
  }

  const realRunId = hit.run.runId;
  const man = readManifest(input.root, realRunId);
  if (!man) return { ok: false, error: "manifest.json missing" };
  const art = (man.artifacts ?? []).find((a) => a.id === input.artifactId);
  if (!art) return { ok: false, error: `artifact not found: ${input.artifactId}` };
  if (art.locked) {
    return { ok: false, error: `화면이 잠겨 있습니다: ${input.artifactId}` };
  }

  const instruction = input.instruction.trim();
  if (!instruction) return { ok: false, error: "instruction required" };

  const result = runWireframeCli(
    input.root,
    [
      "render",
      "--run-id",
      realRunId,
      "--project",
      project,
      "--artifact",
      input.artifactId,
      "--instruction",
      instruction,
    ],
    { timeoutMs: 5 * 60 * 1000 },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || `exit ${result.code}`,
      detail: result.stdout,
    };
  }

  const fresh = wireframeManifest({ root: input.root, runId: realRunId, project });
  return {
    ok: true,
    runId: realRunId,
    artifactId: input.artifactId,
    instruction,
    status: hit.run.status,
    artifacts: fresh.artifacts,
    detail: result.stdout,
  };
}

export function wireframeLockArtifact(input: {
  root: string;
  runId: string;
  artifactId: string;
  locked: boolean;
  project?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  if (hit.run.status === "confirmed" && !input.locked) {
    // unlocking one screen after confirm → reopen refining
    hit.run.status = "ready";
    hit.run.updatedAt = new Date().toISOString();
    writeIndex(input.root, index);
  }

  const realRunId = hit.run.runId;
  const man = readManifest(input.root, realRunId);
  if (!man) return { ok: false, error: "manifest.json missing" };
  let found = false;
  man.artifacts = (man.artifacts ?? []).map((a) => {
    if (a.id !== input.artifactId) return a;
    found = true;
    return { ...a, locked: input.locked, updatedAt: new Date().toISOString() };
  });
  if (!found) return { ok: false, error: `artifact not found: ${input.artifactId}` };
  writeManifest(input.root, realRunId, man);

  return wireframeManifest({ root: input.root, runId: realRunId, project: input.project });
}

/** Approve wireframes: lock all screens + status confirmed. */
export function wireframeConfirm(input: {
  root: string;
  runId: string;
  project?: string;
}): CliJson {
  const project = input.project || "crm";
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, project);
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };

  const realRunId = hit.run.runId;
  const result = runWireframeCli(input.root, [
    "run",
    "confirm",
    "--run-id",
    realRunId,
    "--project",
    project,
  ]);
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout || `exit ${result.code}` };
  }

  const man = readManifest(input.root, realRunId);
  if (man) {
    const now = new Date().toISOString();
    man.status = "confirmed";
    man.artifacts = (man.artifacts ?? []).map((a) =>
      a.id === "00-overview" ? a : { ...a, locked: true, updatedAt: now },
    );
    writeManifest(input.root, realRunId, man);
  }

  return {
    ok: true,
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    status: "confirmed",
    detail: result.stdout,
    ...(wireframeManifest({ root: input.root, runId: realRunId, project }) as object),
  };
}
