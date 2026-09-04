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

type ClarPhase = "clarify" | "layout" | "ready";

/* ------------------------------------------------------------------ */
/* Cross-run memory + screen collision warnings.                       */
/* Sync read-side mirror of packages/cli/src/pipeline/decision-ledger.ts —
/* the CLI owns all writes; keep labels/messages in sync with it.      */
/* ------------------------------------------------------------------ */

type LedgerDecision = {
  topic: string;
  question: string;
  answer: string;
  decidedAt: string;
  byRun: string;
  byRunNo?: string;
};

type DecisionLedgerDoc = {
  projectSlug: string;
  decisions: LedgerDecision[];
  updatedAt: string;
};

export function readDecisionLedger(root: string, projectSlug: string): DecisionLedgerDoc {
  const p = path.join(root, "projects", projectSlug, "decisions.json");
  if (!fs.existsSync(p)) return { projectSlug, decisions: [], updatedAt: "" };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<DecisionLedgerDoc>;
    return {
      projectSlug,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return { projectSlug, decisions: [], updatedAt: "" };
  }
}

const TOPIC_LABEL_KO: Record<string, string> = {
  who_does: "작성·승인 담당",
  new_or_change: "기존/새 화면 여부",
  screen_layout: "화면 형태",
  required_optional: "필수·선택 항목",
  choice_values: "선택지 문구",
  conditional_fields: "조건부 입력",
  attach_method: "참고 자료 전달 방식",
  limits: "글자·항목 제한",
  after_submit: "제출 후 진행",
  edit_rules: "제출 후 수정 규칙",
  privacy: "개인정보 표시",
  done_when: "완료 기준",
  other: "기타",
};

function prefillNoticeKo(topic: string, answer: string, source: string): string {
  return `이전 요청(${source})에서 정한 내용을 반영했습니다 — ${TOPIC_LABEL_KO[topic] ?? topic}: ${answer}. 다르면 알려 주세요.`;
}

type ClarResolvedItem = {
  topic?: string;
  question?: string;
  answer?: string;
  prefilledFrom?: string;
};

function prefillNoticesFromClarifications(
  clarifications: { resolved?: ClarResolvedItem[] } | null,
): string[] {
  return (clarifications?.resolved ?? [])
    .filter((item) => item.prefilledFrom && item.answer)
    .map((item) =>
      prefillNoticeKo(item.topic || "other", String(item.answer), String(item.prefilledFrom)),
    );
}

export type ScreenCollisionWarning = {
  runNo?: string;
  /** Other run's business title — the ONLY name to show the user. */
  runTitle: string;
  runStatus: string;
  /** Internal shared route — never show to the user. */
  route: string;
  /** Ready-made business-language warning for chat. */
  message: string;
};

function collisionStatusKo(status: string): string {
  if (status === "clarifying") return "보완 중";
  if (status === "ready") return "확정됨";
  if (status === "draft") return "초안";
  return status;
}

function modifyRoutesOfRun(root: string, runId: string): string[] {
  const man = readManifest(root, runId) as
    | (ManifestDoc & { artifacts?: Array<ManifestArtifactRow & { wireframe?: { route?: string; type?: string } }> })
    | null;
  if (!man) return [];
  const routes = new Set<string>();
  for (const art of man.artifacts ?? []) {
    const wf = (art as { wireframe?: { route?: string; type?: string } }).wireframe;
    if (wf?.type === "modify" && wf.route) routes.add(wf.route);
  }
  return [...routes];
}

/** Deterministic: this run's modify-routes vs every OTHER not-yet-confirmed run. */
export function detectScreenCollisions(root: string, runId: string): ScreenCollisionWarning[] {
  const index = readIndex(root);
  if (!index) return [];
  const mine = new Set(modifyRoutesOfRun(root, runId));
  if (mine.size === 0) return [];

  const collisions: ScreenCollisionWarning[] = [];
  for (const project of index.projects ?? []) {
    for (const run of project.runs ?? []) {
      if (run.runId === runId || run.status === "confirmed") continue;
      for (const route of modifyRoutesOfRun(root, run.runId)) {
        if (!mine.has(route)) continue;
        const name = run.no ? `${run.no} ${run.title}` : run.title;
        collisions.push({
          runNo: run.no,
          runTitle: run.title,
          runStatus: run.status,
          route,
          message: `이 화면은 「${name}」에서도 수정하기로 되어 있습니다(${collisionStatusKo(run.status)}). 합칠지 따로 갈지 알려 주세요.`,
        });
      }
    }
  }
  return collisions;
}

/** Ledger notices + collision warnings for the chat agent. Read-only, no LLM. */
export function prdConflicts(input: { root: string; runId: string; project?: string }): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;

  const ledger = readDecisionLedger(input.root, hit.project.slug);
  const clarPath = path.join(input.root, "wireFrame", "runs", realRunId, "spec", "clarifications.json");
  let clarifications: { resolved?: ClarResolvedItem[] } | null = null;
  if (fs.existsSync(clarPath)) {
    try {
      clarifications = JSON.parse(fs.readFileSync(clarPath, "utf8")) as typeof clarifications;
    } catch {
      clarifications = null;
    }
  }

  return {
    ok: true,
    runId: realRunId,
    routeId: hit.run.no || realRunId,
    ledgerNotices: prefillNoticesFromClarifications(clarifications),
    collisions: detectScreenCollisions(input.root, realRunId),
    decisions: ledger.decisions,
    chat_instructions: [
      "ledgerNotices는 한 번만 사용자에게 그대로 전하세요. 사용자가 다르다고 하면 prd_answer로 새 답을 넣으세요.",
      "collisions는 다른 요청의 제목만 들어 알리고 「합칠지 따로 갈지」를 물으세요. route·경로·id·테이블 언급 금지, 임의 결정 금지.",
    ],
  };
}

function decisionsSection(prd: string): string {
  return prd.match(/(?:^|\n)#+\s*확인된\s*결정([\s\S]*)$/m)?.[1] ?? "";
}

/**
 * True if screen form (modal/list/page/wizard) was answered after PRD approval.
 * Must stay in sync with resolvedTopicsFromPrd() in packages/cli/src/pipeline/prd-clarify.ts —
 * when the two disagree the CLI closes the layout question while the server still reports
 * phase=layout, leaving a run with no open question that can never be built.
 */
function hasScreenLayoutInPrd(prd: string, clarifications: { resolved?: Array<{ topic?: string }> } | null): boolean {
  if ((clarifications?.resolved ?? []).some((r) => r.topic === "screen_layout")) return true;
  const section = decisionsSection(prd);
  if (
    /화면\s*양식|화면\s*형태|모달|팝업|목록\s*표|테이블\s*형태|전체\s*페이지|단계별\s*화면|위자드|단계별로/.test(
      section,
    )
  ) {
    return true;
  }
  // Same permissive full-PRD fallback the CLI uses, so an answer the agent wrote into the
  // PRD body (rather than the 확인된 결정 section) is still recognised.
  return /모달|팝업|목록\s*표|테이블|전체\s*페이지\s*폼|단계별로/.test(prd);
}

/**
 * clarify = 업무 미결, layout = PRD ready지만 화면 형태 미답, ready = 빌드 가능.
 * status=ready alone is NOT enough to build.
 */
export function resolvePrdPhase(input: {
  status: string;
  content?: string;
  clarifications?: {
    phase?: ClarPhase;
    open?: Array<{ topic?: string }>;
    resolved?: Array<{ topic?: string }>;
  } | null;
}): ClarPhase {
  const clar = input.clarifications;
  // Already handed off — layout was part of that path
  if (input.status === "confirmed") return "ready";
  // An open screen_layout question outranks the run status: it is only ever injected once the
  // business questions are done, and a stray prd_save resets status to "clarifying", which would
  // otherwise hide the question and disarm the layout auto-answer in the chat agent.
  if ((clar?.open ?? []).some((q) => q.topic === "screen_layout")) return "layout";
  if (input.status === "clarifying" || input.status === "draft") return "clarify";
  if (clar?.phase === "layout") return "layout";
  if (clar?.phase === "clarify") return "clarify";
  if (input.status === "ready" && !hasScreenLayoutInPrd(input.content || "", clar ?? null)) {
    return "layout";
  }
  if (input.status === "ready") return "ready";
  return "clarify";
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
  let clarifications: {
    phase?: ClarPhase;
    open?: Array<{ topic?: string }>;
    resolved?: Array<{ topic?: string }>;
  } | null = null;
  if (fs.existsSync(clarPath)) {
    try {
      clarifications = JSON.parse(fs.readFileSync(clarPath, "utf8")) as typeof clarifications;
    } catch {
      clarifications = null;
    }
  }
  const phase = resolvePrdPhase({
    status: run.status,
    content,
    clarifications,
  });
  return {
    ok: true,
    runId: run.runId,
    routeId: run.no || run.runId,
    title: run.title,
    status: run.status,
    phase,
    ledgerNotices: prefillNoticesFromClarifications(clarifications),
    collisions: detectScreenCollisions(input.root, run.runId),
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
      phase: "clarify",
    };
  }

  // Hard gate: never build until screen form is answered (phase=ready)
  const gate = prdGet({ root: input.root, runId: hit.run.runId, project });
  const phase = typeof gate.phase === "string" ? gate.phase : "layout";
  if (phase !== "ready") {
    return {
      ok: false,
      error:
        phase === "layout"
          ? "PRD는 승인됐지만 화면 형태(모달/표/페이지 등)가 아직입니다. 형태를 답한 뒤에만 생성합니다."
          : "PRD 보완이 끝나지 않았습니다. 애매한 부분을 먼저 확정해 주세요.",
      status: hit.run.status,
      phase,
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

/* ------------------------------------------------------------------ */
/* spec/overrides.json — user-owned edits over the generated documents */
/* ------------------------------------------------------------------ */

/**
 * features.json / flow.json are rebuilt from the PRD on every build, so renames,
 * importance changes and hidden nodes are kept apart in spec/overrides.json and merged
 * at read time. The CLI (packages/cli/src/pipeline/spec-overrides.ts) and the canvas
 * (src/lib/spec-overrides.ts) own the merge rules; this layer only stores the file.
 */

export type SpecOverridePatch = {
  label?: string;
  importance?: "high" | "medium" | "low";
  hidden?: boolean;
};

export type SpecOverridesDoc = {
  runId: string;
  features: Record<string, SpecOverridePatch>;
  flow: Record<string, SpecOverridePatch>;
  updatedAt: string;
};

/** Mirrors the caps in packages/cli/src/pipeline/spec-overrides.ts. */
const OVERRIDE_MAX_LABEL = 200;
const OVERRIDE_MAX_ENTRIES = 500;
const OVERRIDE_MAX_KEY = 120;
const OVERRIDE_TOP_KEYS = new Set(["runId", "features", "flow", "updatedAt"]);
const OVERRIDE_PATCH_KEYS = new Set(["label", "importance", "hidden"]);
const OVERRIDE_IMPORTANCE = new Set(["high", "medium", "low"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePatchMap(
  raw: unknown,
  field: string,
): { ok: true; map: Record<string, SpecOverridePatch> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, map: {} };
  if (!isPlainObject(raw)) return { ok: false, error: `${field} must be an object` };
  const entries = Object.entries(raw);
  if (entries.length > OVERRIDE_MAX_ENTRIES) {
    return { ok: false, error: `${field}: too many entries (max ${OVERRIDE_MAX_ENTRIES})` };
  }
  const map: Record<string, SpecOverridePatch> = {};
  for (const [key, value] of entries) {
    if (!key.trim() || key.length > OVERRIDE_MAX_KEY) {
      return { ok: false, error: `${field}: invalid id "${key.slice(0, 32)}"` };
    }
    if (!isPlainObject(value)) {
      return { ok: false, error: `${field}.${key} must be an object` };
    }
    for (const patchKey of Object.keys(value)) {
      if (!OVERRIDE_PATCH_KEYS.has(patchKey)) {
        return { ok: false, error: `${field}.${key}: unknown key "${patchKey}"` };
      }
    }
    const patch: SpecOverridePatch = {};
    if (value.label !== undefined) {
      if (typeof value.label !== "string" || value.label.length > OVERRIDE_MAX_LABEL) {
        return { ok: false, error: `${field}.${key}.label must be a string (max ${OVERRIDE_MAX_LABEL})` };
      }
      const label = value.label.trim();
      if (label) patch.label = label;
    }
    if (value.importance !== undefined) {
      if (typeof value.importance !== "string" || !OVERRIDE_IMPORTANCE.has(value.importance)) {
        return { ok: false, error: `${field}.${key}.importance must be high|medium|low` };
      }
      patch.importance = value.importance as SpecOverridePatch["importance"];
    }
    if (value.hidden !== undefined) {
      if (typeof value.hidden !== "boolean") {
        return { ok: false, error: `${field}.${key}.hidden must be a boolean` };
      }
      patch.hidden = value.hidden;
    }
    // An empty patch is a cleared edit, not a value worth storing.
    if (Object.keys(patch).length > 0) map[key] = patch;
  }
  return { ok: true, map };
}

/**
 * Absolute path of a run's overrides.json, or null when it would escape
 * wireFrame/runs/<runId>/spec/ (runId reaches us URL-encoded from the browser).
 */
function overridesPathFor(root: string, runId: string): string | null {
  const runsRoot = path.resolve(path.join(root, "wireFrame", "runs"));
  const specDir = path.resolve(path.join(runsRoot, runId, "spec"));
  const file = path.resolve(path.join(specDir, "overrides.json"));
  if (!specDir.startsWith(runsRoot + path.sep)) return null;
  if (path.dirname(file) !== specDir) return null;
  if (path.basename(file) !== "overrides.json") return null;
  return file;
}

export function overridesGet(input: {
  root: string;
  runId: string;
  project?: string;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;
  const file = overridesPathFor(input.root, realRunId);
  if (!file) return { ok: false, error: "invalid run path" };

  const empty: SpecOverridesDoc = { runId: realRunId, features: {}, flow: {}, updatedAt: "" };
  if (!fs.existsSync(file)) {
    return { ok: true, runId: realRunId, overrides: empty, exists: false };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // A hand-edited file that no longer parses reads as "no overrides", exactly like
    // the build treats it — never a 500 that blocks the canvas.
    return { ok: true, runId: realRunId, overrides: empty, exists: true, corrupt: true };
  }
  const features = validatePatchMap(isPlainObject(parsed) ? parsed.features : {}, "features");
  const flow = validatePatchMap(isPlainObject(parsed) ? parsed.flow : {}, "flow");
  return {
    ok: true,
    runId: realRunId,
    exists: true,
    overrides: {
      runId: realRunId,
      features: features.ok ? features.map : {},
      flow: flow.ok ? flow.map : {},
      updatedAt:
        isPlainObject(parsed) && typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    } satisfies SpecOverridesDoc,
  };
}

/** Whole-document write. Rejects unknown top-level keys and malformed patches. */
export function overridesSave(input: {
  root: string;
  runId: string;
  project?: string;
  body: unknown;
}): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;
  const file = overridesPathFor(input.root, realRunId);
  if (!file) return { ok: false, error: "invalid run path" };

  if (!isPlainObject(input.body)) return { ok: false, error: "body must be an object" };
  for (const key of Object.keys(input.body)) {
    if (!OVERRIDE_TOP_KEYS.has(key)) return { ok: false, error: `unknown key: ${key}` };
  }
  const features = validatePatchMap(input.body.features, "features");
  if (!features.ok) return { ok: false, error: features.error };
  const flow = validatePatchMap(input.body.flow, "flow");
  if (!flow.ok) return { ok: false, error: flow.error };

  const doc: SpecOverridesDoc = {
    runId: realRunId,
    features: features.map,
    flow: flow.map,
    updatedAt: new Date().toISOString(),
  };
  const specDir = path.dirname(file);
  if (!fs.existsSync(specDir)) fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return { ok: true, runId: realRunId, overrides: doc, saved: true };
}

/* ------------------------------------------------------------------ *
 * Pending PRD change (propose → approve → apply)
 *
 * A non-developer asking for "레퍼런스에 웍스방 추가해줘" used to get input/vN.md
 * rewritten on the spot. The PRD feeds every downstream document, so a silent bad
 * rewrite propagates everywhere. An edit to an EXISTING PRD is therefore staged
 * here first, summarised in business Korean, and only written once the user
 * approves. The first paste of a brand-new PRD still saves immediately — there is
 * nothing to compare it against.
 * ------------------------------------------------------------------ */

export type PendingPrdDoc = {
  runId: string;
  title?: string;
  content: string;
  summary: string[];
  basedOnVersion: number;
  proposedAt: string;
};

const PENDING_MAX_BYTES = 512 * 1024;
const PENDING_MAX_PHRASES = 8;
const PENDING_QUOTE_MAX = 40;
/** LCS is O(n*m); past this a PRD is not a PRD, so fall back to a set diff. */
const PENDING_DIFF_MAX_LINES = 1500;

function pendingPrdPathFor(root: string, runId: string): string | null {
  const runsRoot = path.resolve(path.join(root, "wireFrame", "runs"));
  const specDir = path.resolve(path.join(runsRoot, runId, "spec"));
  const file = path.resolve(path.join(specDir, "pending-prd.json"));
  if (!specDir.startsWith(runsRoot + path.sep)) return null;
  if (path.dirname(file) !== specDir) return null;
  if (path.basename(file) !== "pending-prd.json") return null;
  return file;
}

/** 을/를 by final jamo of the quoted phrase. A non-hangul tail defaults to 를. */
function objectParticle(word: string): string {
  const ch = word.trim().slice(-1).charCodeAt(0);
  if (Number.isNaN(ch) || ch < 0xac00 || ch > 0xd7a3) return "를";
  return (ch - 0xac00) % 28 === 0 ? "를" : "을";
}

/** 으로/로 — a ㄹ 받침 also takes 로. */
function directionParticle(word: string): string {
  const ch = word.trim().slice(-1).charCodeAt(0);
  if (Number.isNaN(ch) || ch < 0xac00 || ch > 0xd7a3) return "로";
  const jong = (ch - 0xac00) % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** The Q/A block is written by the clarify cycle, not by the user — never diff it. */
function splitDecisions(prd: string): { body: string; decisions: string } {
  const match = prd.match(/\n##\s*확인된\s*결정/);
  if (!match || match.index === undefined) return { body: prd, decisions: "" };
  return { body: prd.slice(0, match.index), decisions: prd.slice(match.index) };
}

const SUB_MARKER = /^(?:ㄴ|[-*•·]|[①-⑳]|\d+[.)]|※)\s*/;

function stripMarker(line: string): string {
  return line.replace(SUB_MARKER, "").trim();
}

function isSubItem(line: string): boolean {
  return SUB_MARKER.test(line);
}

function quotable(line: string): string {
  const text = stripMarker(line).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return text.length > PENDING_QUOTE_MAX ? `${text.slice(0, PENDING_QUOTE_MAX)}…` : text;
}

/** Nearest preceding non-sub-item line — the business heading the item hangs under. */
function parentLabels(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  lines.forEach((text, i) => {
    if (!isSubItem(text)) return;
    for (let j = i - 1; j >= 0 && i - j <= 12; j -= 1) {
      const candidate = lines[j]!;
      if (isSubItem(candidate)) continue;
      const label = quotable(candidate);
      if (label && label.length <= PENDING_QUOTE_MAX && !map.has(text)) map.set(text, label);
      break;
    }
  });
  return map;
}

function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

type DiffOp = { kind: "same" | "add" | "del"; text: string };

function lineDiff(before: string[], after: string[]): DiffOp[] {
  if (before.length > PENDING_DIFF_MAX_LINES || after.length > PENDING_DIFF_MAX_LINES) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return [
      ...before.filter((l) => !afterSet.has(l)).map((text) => ({ kind: "del" as const, text })),
      ...after.filter((l) => !beforeSet.has(l)).map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "same", text: before[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "del", text: before[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", text: after[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", text: before[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "add", text: after[j]! });
    j += 1;
  }
  return ops;
}

/**
 * Business-language summary of old → new. Deterministic, no extra LLM call: added and
 * removed lines are grouped into blocks, a one-line removal immediately followed by a
 * one-line insert reads as a rewrite, and sub-items are phrased against the heading
 * they sit under ("레퍼런스 전달 방식에 '…'을 추가했습니다").
 */
export function summarizePrdChange(oldPrd: string, newPrd: string): string[] {
  const before = meaningfulLines(splitDecisions(oldPrd).body);
  const after = meaningfulLines(splitDecisions(newPrd).body);
  const beforeParents = parentLabels(before);
  const afterParents = parentLabels(after);

  type Block = { kind: "add" | "del"; lines: string[] };
  const blocks: Block[] = [];
  for (const op of lineDiff(before, after)) {
    if (op.kind === "same") {
      blocks.push({ kind: "del", lines: [] }); // barrier: never merge across kept text
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === op.kind && last.lines.length) last.lines.push(op.text);
    else blocks.push({ kind: op.kind, lines: [op.text] });
  }
  const real = blocks.filter((b) => b.lines.length > 0);

  const phrases: string[] = [];
  let extra = 0;
  const push = (text: string): void => {
    if (phrases.includes(text)) return;
    if (phrases.length >= PENDING_MAX_PHRASES) {
      extra += 1;
      return;
    }
    phrases.push(text);
  };

  const describe = (lines: string[], kind: "add" | "del"): void => {
    const parents = kind === "add" ? afterParents : beforeParents;
    const byParent = new Map<string, string[]>();
    for (const line of lines) {
      const parent = parents.get(line) || "";
      const item = quotable(line);
      if (!item) continue;
      const list = byParent.get(parent) ?? [];
      list.push(item);
      byParent.set(parent, list);
    }
    for (const [parent, items] of byParent) {
      const shown = items.slice(0, 3);
      const rest = items.length - shown.length;
      const label = shown.map((s) => `'${s}'`).join(", ") + (rest > 0 ? ` 외 ${rest}건` : "");
      const tail = rest > 0 ? "건" : shown[shown.length - 1]!;
      if (parent) {
        push(
          kind === "add"
            ? `${parent}에 ${label}${objectParticle(tail)} 추가했습니다`
            : `${parent}에서 ${label}${objectParticle(tail)} 뺐습니다`,
        );
      } else {
        push(
          kind === "add"
            ? `${label}${objectParticle(tail)} 새로 넣었습니다`
            : `${label}${objectParticle(tail)} 뺐습니다`,
        );
      }
    }
  };

  for (let k = 0; k < real.length; k += 1) {
    const block = real[k]!;
    const next = real[k + 1];
    if (
      block.kind === "del" &&
      next?.kind === "add" &&
      block.lines.length === 1 &&
      next.lines.length === 1
    ) {
      const from = quotable(block.lines[0]!);
      const to = quotable(next.lines[0]!);
      if (from && to && from !== to) {
        push(`'${from}'${objectParticle(from)} '${to}'${directionParticle(to)} 바꿨습니다`);
        k += 1;
        continue;
      }
    }
    describe(block.lines, block.kind);
  }

  if (extra > 0) phrases.push(`그 밖에 ${extra}군데를 더 손봤습니다`);
  return phrases;
}

/** Keep the clarify cycle's Q/A block when a proposed body drops it. */
function preserveDecisions(oldPrd: string, proposed: string): string {
  const oldSplit = splitDecisions(oldPrd);
  if (!oldSplit.decisions) return proposed;
  if (splitDecisions(proposed).decisions) return proposed;
  return `${proposed.trimEnd()}\n\n${oldSplit.decisions.trim()}\n`;
}

function readPendingPrd(
  root: string,
  runId: string,
): { doc: PendingPrdDoc | null; corrupt: boolean } {
  const file = pendingPrdPathFor(root, runId);
  if (!file || !fs.existsSync(file)) return { doc: null, corrupt: false };
  let parsed: unknown = null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > PENDING_MAX_BYTES * 2) return { doc: null, corrupt: true };
    parsed = JSON.parse(raw);
  } catch {
    // A truncated or hand-edited draft reads as "nothing pending" — it must never break
    // prd_get / prd_review, which every turn of the chat depends on.
    return { doc: null, corrupt: true };
  }
  if (!isPlainObject(parsed) || typeof parsed.content !== "string" || !parsed.content.trim()) {
    return { doc: null, corrupt: true };
  }
  return {
    doc: {
      runId,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      content: parsed.content,
      summary: Array.isArray(parsed.summary)
        ? parsed.summary.filter((s): s is string => typeof s === "string")
        : [],
      basedOnVersion: typeof parsed.basedOnVersion === "number" ? parsed.basedOnVersion : 0,
      proposedAt: typeof parsed.proposedAt === "string" ? parsed.proposedAt : "",
    },
    corrupt: false,
  };
}

function clearPendingPrd(root: string, runId: string): boolean {
  const file = pendingPrdPathFor(root, runId);
  if (!file || !fs.existsSync(file)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Read-only view of the staged draft. Safe when absent or corrupt. */
export function prdPendingGet(input: { root: string; runId: string; project?: string }): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const { doc, corrupt } = readPendingPrd(input.root, hit.run.runId);
  return {
    ok: true,
    runId: hit.run.runId,
    pending: Boolean(doc),
    corrupt,
    summary: doc?.summary ?? [],
    proposedAt: doc?.proposedAt ?? "",
    content: doc?.content ?? "",
    title: doc?.title ?? "",
  };
}

/**
 * Stage a change to an existing PRD without touching input/vN.md.
 * A run with no PRD yet is the first paste — that saves straight through.
 * Re-proposing stacks on the pending draft instead of discarding it.
 */
export function prdPropose(input: {
  root: string;
  runId: string;
  project?: string;
  title?: string;
  content: string;
}): CliJson {
  const project = input.project || "crm";
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, project);
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;

  const proposed = String(input.content || "")
    .replace(/^\uFEFF/, "")
    .trimEnd();
  if (!proposed.trim()) return { ok: false, error: "본문이 비어 있습니다." };
  if (Buffer.byteLength(proposed, "utf8") > PENDING_MAX_BYTES) {
    return { ok: false, error: "본문이 너무 깁니다." };
  }

  const snap = prdGet({ root: input.root, runId: realRunId, project });
  const saved = typeof snap.content === "string" ? snap.content : "";

  // First paste of a brand-new request: nothing to compare, so asking would be noise.
  if (!saved.trim()) {
    const out = prdSave({
      root: input.root,
      title: input.title || hit.run.title || "제목 없음",
      content: proposed,
      project,
      runId: realRunId,
    });
    if (out.ok === false) return out;
    return { ...out, applied: true, pending: false, firstSave: true, summary: [] };
  }

  const prev = readPendingPrd(input.root, realRunId).doc;
  const base = prev?.content ?? saved;
  const content = preserveDecisions(saved, proposed);
  const summary = summarizePrdChange(saved, content);
  const newChanges = prev ? summarizePrdChange(base, content) : summary;

  if (!summary.length) {
    return {
      ok: true,
      runId: realRunId,
      pending: Boolean(prev),
      unchanged: true,
      summary: prev?.summary ?? [],
    };
  }

  const file = pendingPrdPathFor(input.root, realRunId);
  if (!file) return { ok: false, error: "invalid run path" };
  const doc: PendingPrdDoc = {
    runId: realRunId,
    title: input.title?.trim() || prev?.title || undefined,
    content,
    summary,
    basedOnVersion: hit.run.prdVersion,
    proposedAt: new Date().toISOString(),
  };
  const specDir = path.dirname(file);
  if (!fs.existsSync(specDir)) fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  return {
    ok: true,
    runId: realRunId,
    pending: true,
    restacked: Boolean(prev),
    summary,
    newChanges,
    proposedAt: doc.proposedAt,
  };
}

/** User approved: write the staged draft for real, clear the stage, re-review. */
export function prdApply(input: { root: string; runId: string; project?: string }): CliJson {
  const project = input.project || "crm";
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, project);
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const realRunId = hit.run.runId;

  const { doc, corrupt } = readPendingPrd(input.root, realRunId);
  if (!doc) {
    clearPendingPrd(input.root, realRunId);
    return {
      ok: false,
      corrupt,
      error: "승인 대기 중인 변경안이 없습니다. 먼저 변경안을 만들어 주세요.",
    };
  }

  const out = prdSave({
    root: input.root,
    title: doc.title || hit.run.title || "제목 없음",
    content: doc.content,
    project,
    runId: realRunId,
  });
  if (out.ok === false) return out;
  clearPendingPrd(input.root, realRunId);
  return { ...out, applied: true, pending: false, summary: doc.summary };
}

/** User said no: drop the staged draft, leave input/vN.md untouched. */
export function prdDiscard(input: { root: string; runId: string; project?: string }): CliJson {
  const index = readIndex(input.root);
  if (!index) return { ok: false, error: "index.json missing" };
  const hit = findRun(index, input.runId, input.project || "crm");
  if (!hit) return { ok: false, error: `run not found: ${input.runId}` };
  const discarded = clearPendingPrd(input.root, hit.run.runId);
  return { ok: true, runId: hit.run.runId, pending: false, discarded };
}
