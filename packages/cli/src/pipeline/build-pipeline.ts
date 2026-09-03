import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectOutputPaths, resolveFromRepo } from "../lib/config.js";
import { parsePrdSteps, parseStepSummaries, parseUiPattern, type FieldControl, type StepSpec, type UiPattern } from "./prd-parser.js";

export type DbColumn = {
  name: string;
  type?: string;
  null?: boolean;
  codes?: Array<{ value?: string; label?: string; count?: number }>;
  fk?: string;
  kind?: string;
  label?: string;
};

export type DbJson = {
  source?: string;
  entities?: string[];
  tables?: Array<{
    name: string;
    rows?: number;
    columns?: Array<DbColumn>;
  }>;
};

export type DesignJson = {
  color?: Record<string, string>;
  component?: Array<{ name: string }>;
};

export type RoutesJson = {
  routes?: Array<{
    path: string;
    label?: string;
    file?: string;
    screenKind?: string;
    keywords?: string[];
  }>;
};

export type ApiJson = {
  endpoints?: Array<{
    method?: string;
    path?: string;
    fields?: string[];
    requestFields?: string[];
    responseFields?: string[];
    resource?: string;
  }>;
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

export type BlueprintField = {
  name: string;
  label: string;
  control: "radio" | "select" | "text" | "textarea" | "file";
  required: boolean;
  options?: string[];
  source: "prd" | "db" | "api";
  table?: string;
  column?: string;
  hint?: string;
};

export type FieldBlueprint = {
  stepNo?: number;
  screenKind: "wizard-step" | "list" | "detail" | "form" | "overview";
  title: string;
  fields: BlueprintField[];
  filters?: BlueprintField[];
  columns?: Array<{ name: string; label: string }>;
  enums?: Array<{ name: string; label: string; options: string[] }>;
};

const JSON_FILES = ["design.json", "routes.json", "api.json", "db.json"] as const;
const AUDIT_FIELD = /^(CREATED|UPDATED|DELETED)_(AT|ID)$|^PASSWORD$|^MEMO$/i;

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

  for (const file of ["design.json", "routes.json", "api.json", "db.json", "shell.html"]) {
    const target = path.join(assetsRoot, file);
    try {
      await readFile(target);
    } catch {
      throw new Error(`missing asset: ${target}`);
    }
  }

  const shellHtml = await readFile(path.join(assetsRoot, "shell.html"), "utf8");

  return {
    projectSlug,
    design: await readJsonFile<DesignJson>(path.join(assetsRoot, "design.json")),
    routes: await readJsonFile<RoutesJson>(path.join(assetsRoot, "routes.json")),
    api: await readJsonFile<ApiJson>(path.join(assetsRoot, "api.json")),
    db: await readJsonFile<DbJson>(path.join(assetsRoot, "db.json")),
    shellHtml,
    shellStyles: extractShellStyles(shellHtml),
  };
}

export type DomainSpec = {
  runId: string;
  projectSlug: string;
  assetProjectSlug: string;
  prdTitle: string;
  /** page | modal | list | wizard | detail — from PRD clarify */
  uiPattern: UiPattern;
  entities: string[];
  tables: string[];
  steps: Array<{ no: number; label: string }>;
  stepSpecs: StepSpec[];
  fieldBlueprints: FieldBlueprint[];
  requirements: string[];
  judgements: Array<{ target: string; rule: string }>;
  assumptions: Array<{ text: string; reason: string }>;
  /** Build-time triple context: PRD + JSON assets + live DB */
  sources?: {
    prd: { path: string; chars: number };
    jsonAssets: { projectSlug: string; files: string[] };
    liveDb: { ok: boolean; tables: string[]; error?: string };
  };
  generatedAt: string;
};

function humanizeField(name: string): string {
  const key = name.toUpperCase();
  const mapped = COLUMN_LABELS[key] ?? COLUMN_LABELS[key.replace(/_CD$/, "")];
  if (mapped) return mapped;
  return name
    .replace(/_CD$/i, "")
    .replace(/_ID$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Prefer business labels; never show raw codes like C025A on wireframes. */
const COLUMN_LABELS: Record<string, string> = {
  CONTENT_DIV_CD: "콘텐츠 유형",
  CONTENT_DIV: "콘텐츠 유형",
  PROD_METHOD: "제작 방식",
  REF_TYPE: "레퍼런스 전달",
  CONTENT_STATE_CD: "진행 상태",
  CONTENT_STATE: "진행 상태",
  CONTENT_DATE: "요청일",
  LANDING_URL: "랜딩페이지",
  LANDING: "랜딩페이지",
  GROUND: "지면",
  TARGET: "타겟",
  MAIN_COPY: "메인 카피",
  SUB_COPY: "서브 카피",
  SCRIPT: "최종 대본",
  FINAL_SCRIPT: "최종 대본",
  INTENT: "기획의도",
  TEST_PURPOSE: "테스트 목적",
  EXTRA_HOOK: "추가 소구",
  MUST_KEEP: "필수 유지 문장/요소",
  MUST_REFLECT: "필수 반영사항",
  TITLE: "제목",
  STATUS: "상태",
  TYPE: "유형",
  METHOD: "방식",
};

const CODE_LABELS: Record<string, string> = {
  C025A: "이미지",
  C025B: "영상",
  GUIDE: "가이드 제작",
  FREE: "자유 제작",
  FILE: "파일 첨부",
  LINK: "링크 첨부",
  NONE: "없음",
  C026A: "요청",
  C026C: "진행",
  C026D: "검토",
  C026E: "완료",
  C026F: "보류",
};

function codeOptions(
  codes: Array<{ value?: string; label?: string; count?: number }> | undefined,
): string[] | null {
  if (!codes?.length) return null;
  const values = codes
    .map((entry) => {
      const value = String(entry.value ?? "").trim();
      if (!value) return null;
      const label = String(entry.label ?? "").trim();
      if (label && label !== value && !/^C\d+/i.test(label)) return label;
      if (CODE_LABELS[value.toUpperCase()]) return CODE_LABELS[value.toUpperCase()]!;
      if (/^C\d+/i.test(value) || /^[A-Z0-9_]{2,12}$/.test(value)) {
        return CODE_LABELS[value] ?? null;
      }
      return label || value;
    })
    .filter((value): value is string => Boolean(value));
  if (values.length < 2 || values.length > 12) return null;
  const avgLen = values.reduce((sum, value) => sum + value.length, 0) / values.length;
  if (avgLen > 40) return null;
  if (values.some((value) => /@|!|https?:/.test(value))) return null;
  return [...new Set(values)];
}

function isEnumColumn(col: DbColumn): string[] | null {
  if (/password|passwd|memo|email|phone|created_id|updated_id|deleted_id/i.test(col.name)) {
    return null;
  }
  if (col.kind === "free_text" || col.kind === "audit" || col.kind === "id") return null;
  if (col.kind === "enum" || /_CD$|_STATUS|_STATE|TYPE|METHOD|DIV|LIVE|PROGRESS|INTENT|REF_TYPE/i.test(col.name)) {
    return codeOptions(col.codes);
  }
  // Only accept codes on enum-ish names
  if (/_CD$|STATUS|STATE|TYPE|METHOD|DIV|LIVE|PROGRESS/i.test(col.name)) {
    return codeOptions(col.codes);
  }
  return null;
}

function pickRelatedTables(prdContent: string, tables: NonNullable<DbJson["tables"]>) {
  const lower = prdContent.toLowerCase();
  const scored = tables.map((table) => {
    const name = table.name.toLowerCase();
    let score = 0;
    if (/content|growth|request|creative|image|video|제작|요청|이미지|영상|소재/.test(lower)) {
      if (/content|growth|request|creative|file/.test(name)) score += 5;
    }
    if (/account|ent|업체|계정/.test(lower) && /account|ent/.test(name)) score += 3;
    if ((table.columns ?? []).some((col) => isEnumColumn(col))) score += 1;
    return { table, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((entry) => entry.score > 0).slice(0, 6).map((entry) => entry.table);
  return picked.length > 0 ? picked : tables.slice(0, 6);
}

function controlFromPrd(control: FieldControl, index: number): BlueprintField | null {
  if (control.kind === "note") return null;
  const name = `prd_${index}_${control.label}`.replace(/\s+/g, "_").slice(0, 48);
  if (control.kind === "radio") {
    return {
      name,
      label: control.label,
      control: "radio",
      required: control.required,
      options: control.options,
      source: "prd",
    };
  }
  if (control.kind === "select") {
    return {
      name,
      label: control.label,
      control: "select",
      required: control.required,
      options: control.options,
      source: "prd",
      hint: control.hint,
    };
  }
  if (control.kind === "file") {
    return {
      name,
      label: control.label,
      control: "file",
      required: control.required,
      source: "prd",
      hint: control.hint,
    };
  }
  if (control.kind === "textarea") {
    return {
      name,
      label: control.label,
      control: "textarea",
      required: control.required,
      source: "prd",
      hint: control.hint,
    };
  }
  return {
    name,
    label: control.label,
    control: "text",
    required: control.required,
    source: "prd",
    hint: "hint" in control ? control.hint : undefined,
  };
}

function dbFieldsForStep(
  tables: NonNullable<DbJson["tables"]>,
  step: StepSpec,
  limit: number,
): BlueprintField[] {
  const title = `${step.title} ${step.hint ?? ""}`.toLowerCase();
  const out: BlueprintField[] = [];
  for (const table of tables) {
    for (const col of table.columns ?? []) {
      if (AUDIT_FIELD.test(col.name)) continue;
      const options = isEnumColumn(col);
      const required = col.null === false && !/_ID$|_AT$/i.test(col.name);
      const label =
        COLUMN_LABELS[col.name.toUpperCase()] ||
        COLUMN_LABELS[col.name.toUpperCase().replace(/_CD$/, "")] ||
        (col.label && !/^[A-Z0-9_ ]+$/.test(col.label) ? col.label : null) ||
        humanizeField(col.name);

      // Prefer enums always; required non-id columns for common/confirm steps
      const enumHit = Boolean(options);
      const nameHit =
        title.length > 0 &&
        (title.includes(col.name.toLowerCase()) ||
          title.includes(label.toLowerCase()) ||
          (/유형|콘텐츠|제작|방법|방식/.test(title) && /DIV|METHOD|TYPE|REF/i.test(col.name)) ||
          (/공통|정보|입력/.test(title) && required) ||
          (/확인|제출/.test(title) && (enumHit || required)));

      if (!enumHit && !nameHit && !required) continue;
      if (!enumHit && !required && out.length >= limit) continue;

      out.push({
        name: `${table.name}.${col.name}`,
        label,
        control: options ? (options.length <= 5 ? "radio" : "select") : /MEMO|DESC|NOTE|COPY|SCRIPT/i.test(col.name) ? "textarea" : "text",
        required,
        options: options ?? undefined,
        source: "db",
        table: table.name,
        column: col.name,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function apiFieldsForForm(api: ApiJson, prdContent: string, limit: number): BlueprintField[] {
  const endpoints = (api.endpoints ?? [])
    .filter((ep) => /content|growth|request|account|ent/i.test(ep.path ?? "") || /content|요청|소재/.test(prdContent))
    .filter((ep) => /POST|PUT|PATCH/i.test(ep.method ?? "") || /regist|create|request|detail/i.test(ep.path ?? ""))
    .slice(0, 4);

  const out: BlueprintField[] = [];
  const seen = new Set<string>();
  for (const ep of endpoints) {
    const fields = [...new Set([...(ep.requestFields ?? []), ...(ep.fields ?? [])])].filter(
      (field) => !AUDIT_FIELD.test(field),
    );
    for (const field of fields) {
      if (seen.has(field)) continue;
      seen.add(field);
      out.push({
        name: field,
        label: humanizeField(field),
        control: /MEMO|DESC|NOTE|COPY|URL/i.test(field) ? "textarea" : "text",
        required: false,
        source: "api",
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function mergeFields(primary: BlueprintField[], secondary: BlueprintField[], limit: number): BlueprintField[] {
  const out: BlueprintField[] = [];
  const seen = new Set<string>();
  const keyOf = (field: BlueprintField) =>
    `${field.label.toLowerCase()}|${(field.column ?? field.name).toLowerCase()}`;

  for (const field of [...primary, ...secondary]) {
    const key = keyOf(field);
    if (seen.has(key)) continue;
    // skip near-duplicate labels
    const labelKey = field.label.toLowerCase().replace(/\s+/g, "");
    if ([...seen].some((k) => k.startsWith(`${labelKey}|`))) continue;
    seen.add(key);
    out.push(field);
    if (out.length >= limit) break;
  }
  return out;
}

function buildFieldBlueprints(input: {
  stepSpecs: StepSpec[];
  relatedTables: NonNullable<DbJson["tables"]>;
  assets: ProjectAssets;
  prdContent: string;
  uiPattern?: UiPattern;
}): FieldBlueprint[] {
  const blueprints: FieldBlueprint[] = [
    {
      screenKind: "overview",
      title: "개요",
      fields: [],
    },
  ];

  const steps =
    input.stepSpecs.length > 0
      ? input.stepSpecs
      : ([
          {
            no: 1,
            title: "요청 입력",
            controls: [],
          },
        ] as StepSpec[]);

  for (const step of steps) {
    const fromPrd = step.controls
      .map((control, index) => controlFromPrd(control, index))
      .filter((field): field is BlueprintField => Boolean(field));

    // One step = that step's PRD controls. Do not densify with unrelated DB/API fields.
    let fields = fromPrd;

    if (fields.length === 0) {
      const fromDb = dbFieldsForStep(input.relatedTables, step, 12);
      const fromApi =
        /공통|정보|확인|제출|입력|요청/.test(step.title)
          ? apiFieldsForForm(input.assets.api, input.prdContent, 8)
          : [];
      fields = mergeFields(fromDb, fromApi, 12);
    }

    if (fields.length === 0) {
      for (const table of input.relatedTables) {
        for (const col of table.columns ?? []) {
          const options = isEnumColumn(col);
          if (!options) continue;
          fields.push({
            name: `${table.name}.${col.name}`,
            label: col.label || humanizeField(col.name),
            control: options.length <= 5 ? "radio" : "select",
            required: col.null === false,
            options,
            source: "db",
            table: table.name,
            column: col.name,
          });
          if (fields.length >= 8) break;
        }
        if (fields.length >= 8) break;
      }
    }

    const enums = fields
      .filter((field) => field.options && field.options.length >= 2)
      .map((field) => ({
        name: field.name,
        label: field.label,
        options: field.options!,
      }));

    const kind: FieldBlueprint["screenKind"] =
      input.uiPattern === "list"
        ? "list"
        : input.uiPattern === "detail"
          ? "detail"
          : input.uiPattern === "page" && steps.length <= 1
            ? "form"
            : "wizard-step";

    blueprints.push({
      stepNo: step.no,
      screenKind: kind,
      title: step.title,
      fields,
      enums,
    });
  }

  return blueprints;
}

export function buildDomain(input: {
  runId: string;
  projectSlug: string;
  assetProjectSlug: string;
  prdTitle: string;
  prdContent: string;
  assets: ProjectAssets;
  sources?: DomainSpec["sources"];
}): DomainSpec {
  const steps = parseStepSummaries(input.prdContent);
  const stepSpecs = parsePrdSteps(input.prdContent);

  const requirements = input.prdContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^FR-\d+/.test(line) || /^NFR-/.test(line) || line.startsWith("·"))
    .slice(0, 12);

  const entities = input.assets.db.entities ?? [];
  const relatedTables = pickRelatedTables(input.prdContent, input.assets.db.tables ?? []);
  const tables = relatedTables.map((table) => table.name);

  const judgements: DomainSpec["judgements"] = [];
  if (steps.length > 0) {
    judgements.push({
      target: "wizard",
      rule: `${steps.length}단계 요청 흐름 — 단계별 화면 분리`,
    });
  }
  if (input.prdContent.includes("검색") || /list|목록/.test(input.prdContent)) {
    judgements.push({ target: "list", rule: "검색 필드 필수" });
  }
  if (input.prdContent.includes("조건부")) {
    judgements.push({ target: "form", rule: "조건부 필드 노출/검증 분리" });
  }

  for (const table of relatedTables) {
    if ((table.rows ?? 0) > 10000) {
      judgements.push({
        target: "list",
        rule: `${table.name} ${table.rows}건 — 페이징/검색 필수`,
      });
    }
    for (const col of table.columns ?? []) {
      const codes = isEnumColumn(col);
      if (codes) {
        judgements.push({
          target: col.name,
          rule:
            codes.length <= 5
              ? `${table.name}.${col.name} 코드 ${codes.length}개 — 탭 또는 radio`
              : `${table.name}.${col.name} 코드 ${codes.length}개 — select/필터`,
        });
      }
      if (col.fk) {
        judgements.push({
          target: col.name,
          rule: `${table.name}.${col.name} → ${col.fk} — 연결 필드`,
        });
      }
    }
  }

  const uiPattern = parseUiPattern(input.prdContent, steps.length > 1);

  const fieldBlueprints = buildFieldBlueprints({
    stepSpecs,
    relatedTables,
    assets: input.assets,
    prdContent: input.prdContent,
    uiPattern,
  });

  for (const bp of fieldBlueprints) {
    if (bp.screenKind === "wizard-step" || bp.screenKind === "form" || bp.screenKind === "list") {
      judgements.push({
        target: `step-${bp.stepNo ?? "x"}`,
        rule: `${bp.title}: ${bp.fields.length} fields · ui=${uiPattern}/${bp.screenKind}`,
      });
    }
  }

  const assumptions: DomainSpec["assumptions"] = [];
  if (entities.length === 0) {
    assumptions.push({
      text: "DB 엔티티 매칭 없이 PRD+휴리스틱 테이블 스코프로 화면 구성",
      reason: "db.json entities가 비어 있거나 PRD와 직접 매칭되지 않음",
    });
  }
  if (!/모달|팝업|목록\s*표|테이블\s*형태|전체\s*페이지|단계별|위자드|화면\s*양식/.test(input.prdContent)) {
    assumptions.push({
      text: `화면 양식 미확정 → ${uiPattern}으로 가정`,
      reason: "PRD에 모달/표/페이지/단계 양식 답이 없어 휴리스틱 적용",
    });
  }
  if (input.sources?.liveDb) {
    judgements.unshift({
      target: "build-context",
      rule: input.sources.liveDb.ok
        ? `triple context: PRD + JSON(${input.sources.jsonAssets.projectSlug}) + live DB [${input.sources.liveDb.tables.join(", ")}]`
        : `triple context: PRD + JSON only (live DB fail: ${input.sources.liveDb.error ?? "unknown"})`,
    });
  }
  if (input.sources?.liveDb && !input.sources.liveDb.ok) {
    assumptions.push({
      text: "live DB 조회 실패 — JSON db.json 스냅샷만 사용",
      reason: input.sources.liveDb.error ?? "wonjd query failed",
    });
  }

  return {
    runId: input.runId,
    projectSlug: input.projectSlug,
    assetProjectSlug: input.assetProjectSlug,
    prdTitle: input.prdTitle,
    uiPattern,
    entities,
    tables,
    steps,
    stepSpecs,
    fieldBlueprints,
    requirements,
    judgements: judgements.slice(0, 50),
    assumptions,
    sources: input.sources,
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
  wireframe: {
    route: string;
    type: "new" | "modify" | "extend";
    uiPattern?: UiPattern;
  };
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

function matchRoute(
  routes: RoutesJson,
  label: string,
  runId: string,
): { path: string; type: "new" | "modify" | "extend" } {
  const tokens = label.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  let best: { path: string; score: number } | null = null;
  for (const route of routes.routes ?? []) {
    const blob = `${route.path} ${route.label ?? ""} ${(route.keywords ?? []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (blob.includes(token)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { path: route.path, score };
    }
  }
  if (best && best.score >= 1) {
    return { path: best.path, type: "modify" };
  }
  return { path: `/wireframe/${runId}`, type: "new" };
}

export function buildManifest(input: {
  run: { runId: string; no: string; title: string; prdPath: string };
  projectSlug: string;
  assetProjectSlug: string;
  domain: DomainSpec;
  assets?: ProjectAssets;
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
    const matched = input.assets
      ? matchRoute(input.assets.routes, `${input.run.title} ${step.label}`, input.run.runId)
      : { path: `/wireframe/${input.run.runId}/step-${step.no}`, type: "new" as const };
    artifacts.push({
      id,
      no: step.no,
      label: step.label,
      file: `${id}.html`,
      locked: false,
      updatedAt: now,
      covers: [`${step.no}단계 — ${step.label}`],
      instructions: [],
      wireframe: {
        route: matched.type === "new" ? `/wireframe/${input.run.runId}/step-${step.no}` : matched.path,
        type: matched.type,
        uiPattern: input.domain.uiPattern,
      },
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

export { renderArtifactHtml } from "./render-html.js";
