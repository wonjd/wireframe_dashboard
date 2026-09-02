import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectOutputPaths, resolveFromRepo } from "../lib/config.js";
import { parsePrdSteps, parseStepSummaries, type FieldControl, type StepSpec } from "./prd-parser.js";

export type DbJson = {
  entities?: string[];
  tables?: Array<{
    name: string;
    rows?: number;
    columns?: Array<{ name: string; type?: string; null?: boolean; codes?: unknown[] }>;
  }>;
};

export type DesignJson = {
  color?: Record<string, string>;
  component?: Array<{ name: string }>;
};

export type RoutesJson = {
  routes?: Array<{ path: string; label?: string; file?: string }>;
};

export type ApiJson = {
  endpoints?: Array<{ method?: string; path?: string; fields?: string[] }>;
};

export type ProjectAssets = {
  projectSlug: string;
  design: DesignJson;
  routes: RoutesJson;
  api: ApiJson;
  db: DbJson;
  shellHtml: string;
  shellStyles: string;
};

const JSON_FILES = ["design.json", "routes.json", "api.json", "db.json"] as const;

async function readJsonFile<T>(absolutePath: string): Promise<T> {
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as T;
}

function extractShellStyles(shellHtml: string): string {
  const match = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(shellHtml);
  return match?.[1]?.trim() ?? "";
}

export function projectAssetsDir(projectSlug: string): string {
  return resolveFromRepo(`projects/${projectSlug}`);
}

export async function loadProjectAssets(projectSlug: string): Promise<ProjectAssets> {
  const assetsRoot = resolveFromRepo(`projects/${projectSlug}`);
  const outputs = projectOutputPaths(projectSlug);

  const designPath = path.join(assetsRoot, "design.json");
  const routesPath = path.join(assetsRoot, "routes.json");
  const apiPath = path.join(assetsRoot, "api.json");
  const dbPath = path.join(assetsRoot, "db.json");
  const shellPath = path.join(assetsRoot, "shell.html");

  for (const file of ["design.json", "routes.json", "api.json", "db.json", "shell.html"]) {
    const target = path.join(assetsRoot, file);
    try {
      await readFile(target);
    } catch {
      throw new Error(`missing asset: ${target}`);
    }
  }

  const shellHtml = await readFile(shellPath, "utf8");

  return {
    projectSlug,
    design: await readJsonFile<DesignJson>(designPath),
    routes: await readJsonFile<RoutesJson>(routesPath),
    api: await readJsonFile<ApiJson>(apiPath),
    db: await readJsonFile<DbJson>(dbPath),
    shellHtml,
    shellStyles: extractShellStyles(shellHtml),
  };
}

export type DomainSpec = {
  runId: string;
  projectSlug: string;
  assetProjectSlug: string;
  prdTitle: string;
  entities: string[];
  tables: string[];
  steps: Array<{ no: number; label: string }>;
  stepSpecs: StepSpec[];
  requirements: string[];
  judgements: Array<{ target: string; rule: string }>;
  assumptions: Array<{ text: string; reason: string }>;
  generatedAt: string;
};

export function buildDomain(input: {
  runId: string;
  projectSlug: string;
  assetProjectSlug: string;
  prdTitle: string;
  prdContent: string;
  assets: ProjectAssets;
}): DomainSpec {
  const steps = parseStepSummaries(input.prdContent);
  const stepSpecs = parsePrdSteps(input.prdContent);

  const requirements = input.prdContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^FR-\d+/.test(line) || /^NFR-/.test(line) || line.startsWith("·"))
    .slice(0, 12);

  const entities = input.assets.db.entities ?? [];
  const tables = (input.assets.db.tables ?? []).slice(0, 8).map((table) => table.name);

  const judgements: DomainSpec["judgements"] = [];
  if (steps.length > 0) {
    judgements.push({
      target: "wizard",
      rule: `${steps.length}단계 요청 흐름 — 단계별 화면 분리`,
    });
  }
  if (input.prdContent.includes("검색")) {
    judgements.push({ target: "list", rule: "검색 필드 필수" });
  }
  if (input.prdContent.includes("조건부")) {
    judgements.push({ target: "form", rule: "조건부 필드 노출/검증 분리" });
  }
  for (const table of input.assets.db.tables ?? []) {
    if ((table.rows ?? 0) > 10000) {
      judgements.push({
        target: "list",
        rule: `${table.name} ${table.rows}건 — 페이징/검색 필수`,
      });
    }
  }

  const assumptions: DomainSpec["assumptions"] = [];
  if (entities.length === 0) {
    assumptions.push({
      text: "DB 엔티티 매칭 없이 PRD 텍스트 기준으로 화면 구성",
      reason: "db.json entities가 비어 있거나 PRD와 직접 매칭되지 않음",
    });
  }

  return {
    runId: input.runId,
    projectSlug: input.projectSlug,
    assetProjectSlug: input.assetProjectSlug,
    prdTitle: input.prdTitle,
    entities,
    tables,
    steps,
    stepSpecs,
    requirements,
    judgements,
    assumptions,
    generatedAt: new Date().toISOString(),
  };
}

export type ManifestArtifact = {
  id: string;
  no: number;
  label: string;
  file: string;
  locked: boolean;
  updatedAt: string;
  covers: string[];
  instructions: Array<{ at: string; text: string }>;
  wireframe: { route: string; type: "new" | "modify" | "extend" };
};

export type ManifestSpec = {
  runId: string;
  kind: "wireframe";
  projectSlug: string;
  assetProjectSlug: string;
  no: string;
  title: string;
  mode: "existing" | "new";
  status: "draft" | "confirmed";
  createdAt: string;
  updatedAt: string;
  inputs: {
    prd: string;
    assets: string[];
    shell: string;
  };
  assumptions: Array<{ text: string; reason: string }>;
  artifacts: ManifestArtifact[];
};

export function buildManifest(input: {
  run: { runId: string; no: string; title: string; prdPath: string };
  projectSlug: string;
  assetProjectSlug: string;
  domain: DomainSpec;
}): ManifestSpec {
  const now = new Date().toISOString();
  const artifacts: ManifestArtifact[] = [];

  artifacts.push({
    id: "00-overview",
    no: 0,
    label: "개요",
    file: "00-overview.html",
    locked: true,
    updatedAt: now,
    covers: ["PRD 요약 및 범위"],
    instructions: [],
    wireframe: { route: `/wireframe/${input.run.runId}`, type: "new" },
  });

  const steps =
    input.domain.stepSpecs.length > 0
      ? input.domain.stepSpecs.map((step) => ({ no: step.no, label: step.title }))
      : input.domain.steps.length > 0
        ? input.domain.steps
        : [{ no: 1, label: input.run.title }];
  for (const step of steps) {
    const id = `${String(step.no).padStart(2, "0")}-step-${step.no}`;
    artifacts.push({
      id,
      no: step.no,
      label: step.label,
      file: `${id}.html`,
      locked: false,
      updatedAt: now,
      covers: [`${step.no}단계 — ${step.label}`],
      instructions: [],
      wireframe: { route: `/wireframe/${input.run.runId}/step-${step.no}`, type: "new" },
    });
  }

  return {
    runId: input.run.runId,
    kind: "wireframe",
    projectSlug: input.projectSlug,
    assetProjectSlug: input.assetProjectSlug,
    no: input.run.no,
    title: input.run.title,
    mode: "existing",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    inputs: {
      prd: input.run.prdPath,
      assets: JSON_FILES.map((file) => `projects/${input.assetProjectSlug}/${file}`),
      shell: `projects/${input.assetProjectSlug}/shell.html`,
    },
    assumptions: input.domain.assumptions,
    artifacts,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderOverviewPage(input: {
  runTitle: string;
  prdExcerpt: string;
  domain: DomainSpec;
  assets: ProjectAssets;
  styles: string;
}): string {
  const tables = (input.assets.db.tables ?? [])
    .slice(0, 5)
    .map(
      (table) =>
        `<tr><td>${escapeHtml(table.name)}</td><td>${table.rows ?? "—"}</td><td>${table.columns?.length ?? 0} cols</td></tr>`,
    )
    .join("");

  const reqs = input.domain.requirements
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.runTitle)} — 개요</title>
  <style>${wireframePageStyles(input.styles)}</style>
</head>
<body>
  <div class="wfs-app">
    <header class="wfs-topnav">${escapeHtml(input.runTitle)} · 개요</header>
    <aside class="wfs-sidenav">WONJD Wireframe</aside>
    <main class="wfs-main">
      <div class="wfs-card" style="margin-bottom:16px">
        <h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(input.runTitle)}</h1>
        <p style="margin:0;color:#666">PRD + JSON 자산 기반 자동 생성 와이어프레임</p>
      </div>
      <div class="wfs-card" style="margin-bottom:16px">
        <h2 style="margin:0 0 8px;font-size:15px">PRD 발췌</h2>
        <pre style="white-space:pre-wrap;margin:0;font-family:inherit;font-size:13px">${escapeHtml(input.prdExcerpt)}</pre>
      </div>
      <div class="wfs-card" style="margin-bottom:16px">
        <h2 style="margin:0 0 8px;font-size:15px">요구사항</h2>
        <ul style="margin:0;padding-left:18px">${reqs || "<li>—</li>"}</ul>
      </div>
      <div class="wfs-card">
        <h2 style="margin:0 0 8px;font-size:15px">참조 DB (${escapeHtml(input.assets.projectSlug)})</h2>
        <table class="wfs-table"><thead><tr><th>테이블</th><th>행</th><th>컬럼</th></tr></thead><tbody>${tables || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
      </div>
    </main>
  </div>
</body>
</html>`;
}

function wireframePageStyles(shellStyles: string): string {
  return `${shellStyles}
    body { color: #23262e; background: #fff; }
    .wfs-main { color: #23262e; }
    .wfs-topnav { color: #23262e; }
    .wfs-field { margin-bottom: 14px; }
    .wfs-field-label { display: block; margin-bottom: 6px; font-weight: 600; }
    .wfs-field-label .req { color: #e74c3c; margin-left: 4px; }
    .wfs-field-hint { display: block; margin-top: 4px; font-size: 12px; color: #666; }
    .wfs-radio-group { display: flex; flex-direction: column; gap: 8px; }
    .wfs-radio { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius); }
    .wfs-input, .wfs-textarea, .wfs-select { width: 100%; min-height: 32px; border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 8px; font: inherit; color: #23262e; }
    .wfs-textarea { min-height: 80px; resize: vertical; }
    .wfs-note { margin-bottom: 12px; color: #444; font-size: 13px; }
    .wfs-steps { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
    .wfs-step-dot { padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; color: #666; }
    .wfs-step-dot.is-active { background: var(--brand); color: #fff; border-color: var(--brand); }`;
}

function renderControl(control: FieldControl, index: number): string {
  const req = "required" in control && control.required ? '<span class="req">*</span>' : "";

  if (control.kind === "note") {
    return `<div class="wfs-note">${control.text}</div>`;
  }

  if (control.kind === "radio") {
    const options = control.options
      .map(
        (option, optIndex) =>
          `<label class="wfs-radio"><input type="radio" name="field-${index}" ${optIndex === 0 ? "checked" : ""}> ${escapeHtml(option)}</label>`,
      )
      .join("");
    return `<div class="wfs-field"><span class="wfs-field-label">${escapeHtml(control.label)}${req}</span><div class="wfs-radio-group">${options}</div></div>`;
  }

  if (control.kind === "select") {
    const options = control.options.map((option) => `<option>${escapeHtml(option)}</option>`).join("");
    const hint = control.hint ? `<span class="wfs-field-hint">${escapeHtml(control.hint)}</span>` : "";
    return `<div class="wfs-field"><label class="wfs-field-label">${escapeHtml(control.label)}${req}</label><select class="wfs-select">${options}</select>${hint}</div>`;
  }

  if (control.kind === "textarea") {
    const hint = control.hint ? `<span class="wfs-field-hint">${escapeHtml(control.hint)}</span>` : "";
    return `<div class="wfs-field"><label class="wfs-field-label">${escapeHtml(control.label)}${req}</label><textarea class="wfs-textarea" maxlength="${control.maxLength ?? 500}"></textarea>${hint}</div>`;
  }

  if (control.kind === "file") {
    const hint = control.hint ? `<span class="wfs-field-hint">${escapeHtml(control.hint)}</span>` : "";
    return `<div class="wfs-field"><label class="wfs-field-label">${escapeHtml(control.label)}${req}</label><input type="file" class="wfs-input">${hint}</div>`;
  }

  return `<div class="wfs-field"><label class="wfs-field-label">${escapeHtml(control.label)}${req}</label><input type="text" class="wfs-input" placeholder="입력"></div>`;
}

function renderStepPage(input: {
  runTitle: string;
  step: StepSpec;
  allSteps: StepSpec[];
  styles: string;
}): string {
  const stepDots = input.allSteps
    .map(
      (step) =>
        `<span class="wfs-step-dot${step.no === input.step.no ? " is-active" : ""}">${step.no}. ${escapeHtml(step.title)}</span>`,
    )
    .join("");

  const fieldHtml = input.step.controls.map((control, index) => renderControl(control, index)).join("");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.runTitle)} — ${escapeHtml(input.step.title)}</title>
  <style>${wireframePageStyles(input.styles)}</style>
</head>
<body>
  <div class="wfs-app">
    <header class="wfs-topnav">${escapeHtml(input.runTitle)}</header>
    <aside class="wfs-sidenav">Step ${input.step.no}</aside>
    <main class="wfs-main">
      <div class="wfs-card">
        <div class="wfs-steps">${stepDots}</div>
        <p class="wfs-badge">${input.step.no}단계</p>
        <h1 style="margin:8px 0 4px;font-size:18px">${escapeHtml(input.step.title)}</h1>
        ${input.step.hint ? `<p class="wfs-field-hint" style="margin:0 0 16px">${escapeHtml(input.step.hint)}</p>` : ""}
        <form onsubmit="return false">
          ${fieldHtml}
          <div style="display:flex;gap:8px;margin-top:16px">
            <button class="wfs-btn wfs-btn--ghost" type="button">이전</button>
            <button class="wfs-btn" type="button">${input.step.no >= input.allSteps.length ? "제출" : "다음"}</button>
          </div>
        </form>
      </div>
    </main>
  </div>
</body>
</html>`;
}

export function renderArtifactHtml(input: {
  artifact: ManifestArtifact;
  runTitle: string;
  prdContent: string;
  domain: DomainSpec;
  assets: ProjectAssets;
}): string {
  if (input.artifact.id === "00-overview") {
    return renderOverviewPage({
      runTitle: input.runTitle,
      prdExcerpt: input.prdContent.split("\n").slice(0, 24).join("\n"),
      domain: input.domain,
      assets: input.assets,
      styles: input.assets.shellStyles,
    });
  }

  const stepNo = input.artifact.no;
  const stepSpec =
    input.domain.stepSpecs.find((entry) => entry.no === stepNo) ??
    ({
      no: stepNo,
      title: input.artifact.label,
      controls: [{ kind: "note", text: "PRD 단계 정보 없음" }],
    } as StepSpec);

  return renderStepPage({
    runTitle: input.runTitle,
    step: stepSpec,
    allSteps: input.domain.stepSpecs,
    styles: input.assets.shellStyles,
  });
}
