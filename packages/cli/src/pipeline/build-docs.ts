import type { DomainSpec, ManifestSpec } from "./build-pipeline.js";
import type { FieldControl, StepSpec } from "./prd-parser.js";

/**
 * Run documents derived from the PRD for the dashboard visualizations:
 * - features.json — 기능명세서 mind-map (PRD 섹션 구조 → 그룹/자식)
 * - flow.json — 유저플로우 sitemap (단계 노드 + 조건부 분기)
 *
 * Heuristic/regex extraction only — deterministic, no network, no LLM.
 * Labels must stay business Korean (PRD wording); never emit code values,
 * table names or column names.
 */

export type FeatureImportance = "high" | "medium" | "low";
export type FeatureStatus = "confirmed" | "draft" | "assumed";

/** PRD-derived input field of a step — business labels only, never db/api columns. */
export type FeatureField = {
  label: string;
  required: boolean;
  control: "radio" | "select" | "text" | "textarea" | "file";
  options?: string[];
};

export type FeatureChild = {
  no: string;
  label: string;
  importance: FeatureImportance;
  status: FeatureStatus;
  source: string;
  /** wizard step this child maps to — only set when the mapping is unambiguous */
  stepNo?: number;
  /** step wireframe artifact from the manifest; null when the step has none */
  artifactId?: string | null;
  /** PRD-derived fields of that step (source "prd" only — never db/api) */
  fields?: FeatureField[];
};

export type FeatureGroup = {
  no: string;
  label: string;
  importance: FeatureImportance;
  status: FeatureStatus;
  children: FeatureChild[];
};

export type FeaturesDoc = {
  runId: string;
  root: { label: string; runId: string };
  groups: FeatureGroup[];
  generatedAt: string;
};

export type FlowNodeKind = "start" | "primary" | "page";

export type FlowDoc = {
  runId: string;
  lanes: Array<{ id: string; label: string }>;
  nodes: Array<{
    id: string;
    kind: FlowNodeKind;
    label: string;
    lane: string;
    artifactId: string | null;
  }>;
  edges: Array<{ from: string; to: string; condition: string | null }>;
  generatedAt: string;
};

export type ClarificationsFile = {
  resolved?: Array<{ topic?: string; question?: string; answer?: string }>;
} | null;

/* ------------------------------------------------------------------ */
/* PRD section structure                                              */
/* ------------------------------------------------------------------ */

type PrdSubsection = { m: number; title: string; body: string };

type PrdSection = {
  no: number;
  title: string;
  body: string;
  subsections: PrdSubsection[];
};

const CONFIRMED_HEADING = /(?:^|\n)#+\s*확인된\s*결정/;

/** Strip numbering/markup/필수·선택형 meta so a raw PRD heading reads as a business name. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    .replace(/^[①-⑮]\s*/, "")
    .replace(/^\d+(?:-\d+)?[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*(?:필수|선택)\s*\/\s*(?:선택형|필수형?|선택)\s*$/, "")
    .replace(/\s*[/·]\s*(?:선택형|필수)\s*$/, "")
    .trim();
}

/**
 * Split the PRD into its own numbered top-level sections.
 * Handles "1. 개발 요청사항" plain lines and "## 1. ..." heading lines.
 * "N-M." sub-numbers never match the top-level pattern.
 */
export function parsePrdSections(prd: string): PrdSection[] {
  const confirmedAt = prd.search(CONFIRMED_HEADING);
  const scope = confirmedAt >= 0 ? prd.slice(0, confirmedAt) : prd;

  const headRe = /(?:^|\n)#{0,6}\s*(\d+)\.\s+([^\n]+)/g;
  const heads: Array<{ no: number; title: string; start: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headRe.exec(scope)) !== null) {
    const no = Number(match[1]);
    // Sequential numbering only — an ordered list restarting mid-document
    // must not be mistaken for a new top-level section.
    if (heads.length > 0 && no !== heads[heads.length - 1].no + 1) continue;
    heads.push({
      no,
      title: cleanLabel(match[2]),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  return heads.map((head, index) => {
    const end = index + 1 < heads.length ? heads[index + 1].start : scope.length;
    const body = scope.slice(head.bodyStart, end);
    return {
      no: head.no,
      title: head.title,
      body,
      subsections: parseSubsections(body, head.no),
    };
  });
}

function parseSubsections(body: string, sectionNo: number): PrdSubsection[] {
  const subRe = new RegExp(`(?:^|\\n)#{0,6}\\s*${sectionNo}-(\\d+)\\.?\\s+([^\\n]+)`, "g");
  const heads: Array<{ m: number; title: string; start: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = subRe.exec(body)) !== null) {
    heads.push({
      m: Number(match[1]),
      title: cleanLabel(match[2]),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }
  return heads.map((head, index) => ({
    m: head.m,
    title: head.title,
    body: body.slice(head.bodyStart, index + 1 < heads.length ? heads[index + 1].start : body.length),
  }));
}

/** ①②③ step items inside a section body — first occurrence per number wins. */
function parseCircledItems(body: string): Array<{ label: string; block: string }> {
  const re = /(?:^|\n)(?:#{0,6}\s*)?([①-⑮])\s*([^\n]+)/g;
  const seen = new Set<string>();
  const hits: Array<{ label: string; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    hits.push({ label: cleanLabel(match[2]), start: match.index });
  }
  return hits.map((hit, index) => ({
    label: hit.label,
    block: body.slice(hit.start, index + 1 < hits.length ? hits[index + 1].start : body.length),
  }));
}

/** "개발 확인 N — 제목" question items (개발 확인 필요사항 sections). */
function parseNumberedCheckItems(body: string): Array<{ label: string; block: string }> {
  const re = /(?:^|\n)[^\n]{0,12}확인\s*\d+\s*[—–-]+\s*([^\n]+)/g;
  const hits: Array<{ label: string; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    hits.push({ label: cleanLabel(match[1]), start: match.index });
  }
  return hits.map((hit, index) => ({
    label: hit.label,
    block: body.slice(hit.start, index + 1 < hits.length ? hits[index + 1].start : body.length),
  }));
}

/* ------------------------------------------------------------------ */
/* features.json                                                      */
/* ------------------------------------------------------------------ */

const OUT_OF_SCOPE = /포함하지\s*않|범위\s*(?:외|제외)|별도\s*사항/;

function importanceOf(text: string): FeatureImportance {
  if (OUT_OF_SCOPE.test(text)) return "low";
  const requiredHits = (text.match(/필수/g) ?? []).length;
  if (requiredHits >= 1 || /차단|불가|넘어가지\s*못/.test(text)) return "high";
  return "medium";
}

function isQuestionSection(title: string): boolean {
  return /확인\s*필요|문의|질문|검토\s*요청/.test(title);
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, "");
}

type StatusContext = {
  /** resolved Q/A blob (clarifications + PRD ## 확인된 결정 section) */
  resolvedBlob: string;
  screenLayoutResolved: boolean;
  assumedTexts: string[];
};

function buildStatusContext(
  prd: string,
  domain: DomainSpec,
  clarifications: ClarificationsFile,
): StatusContext {
  const parts: string[] = [];
  for (const item of clarifications?.resolved ?? []) {
    parts.push(item.topic ?? "", item.question ?? "", item.answer ?? "");
  }
  const confirmedAt = prd.search(CONFIRMED_HEADING);
  if (confirmedAt >= 0) parts.push(prd.slice(confirmedAt));

  const screenLayoutResolved =
    (clarifications?.resolved ?? []).some((item) => item.topic === "screen_layout") ||
    /화면.*(?:형태|양식)|screen_layout/.test(parts.join("\n"));

  return {
    resolvedBlob: normalizeForMatch(parts.join("\n")),
    screenLayoutResolved,
    assumedTexts: domain.assumptions.map((entry) => normalizeForMatch(entry.text)),
  };
}

function statusOf(label: string, ctx: StatusContext, question: boolean): FeatureStatus {
  if (question) return "draft";
  const key = normalizeForMatch(label);
  if (key.length >= 2 && ctx.resolvedBlob.includes(key)) return "confirmed";
  // A resolved screen-layout decision confirms how the 요청 구조/화면 is presented.
  if (ctx.screenLayoutResolved && /요청\s*구조|화면\s*(?:형태|구성|양식)/.test(label)) {
    return "confirmed";
  }
  if (ctx.assumedTexts.some((text) => text.includes(key) || key.includes(text))) return "assumed";
  return "draft";
}

/** A value that still looks like a system constant (EXPIRED_NO_RENEWAL, reward, ent). */
function isRawToken(option: string): boolean {
  const value = option.trim();
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) return true;
  if (/^[a-z][a-z0-9_]{1,15}$/.test(value)) return true;
  return false;
}

function featureFieldFromControl(control: FieldControl): FeatureField | null {
  if (control.kind === "note") return null;
  return {
    label: control.label,
    required: control.required,
    control: control.kind,
    options: "options" in control ? control.options : undefined,
  };
}

/**
 * PRD-truthful fields for one step: blueprint fields with source === "prd", else the
 * step's own PRD controls, else nothing. Never db/api fields — buildDomain pads steps
 * with those from tables unrelated to the PRD, and raw column names/code constants
 * must not reach this user-facing document.
 */
export function featureFieldsForStep(domain: DomainSpec, stepNo: number): FeatureField[] {
  const blueprint = domain.fieldBlueprints.find((bp) => bp.stepNo === stepNo);
  const prdFields = (blueprint?.fields ?? []).filter((field) => field.source === "prd");

  const raw: FeatureField[] =
    prdFields.length > 0
      ? prdFields.map((field) => ({
          label: field.label,
          required: field.required,
          control: field.control,
          options: field.options,
        }))
      : (domain.stepSpecs.find((spec) => spec.no === stepNo)?.controls ?? [])
          .map((control) => featureFieldFromControl(control))
          .filter((field): field is FeatureField => Boolean(field));

  const out: FeatureField[] = [];
  for (const field of raw) {
    // A label with no Korean business term is a system name, not a PRD field.
    if (!/[가-힣]/.test(field.label)) continue;
    const options = (field.options ?? []).filter((option) => !isRawToken(option));
    out.push({
      label: field.label,
      required: field.required,
      control: field.control,
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return out;
}

/**
 * Conditional fields live in the PRD twice: once under the step that shows them
 * (`④ 선택값에 따라 추가 입력 항목 노출`) and once under the 유형 section that owns them
 * (`2-1. 이미지 요청` / `2-2. 영상 요청`). The step link only fills the former, leaving the
 * 유형 sections empty in the spec. The parser records the owning 유형 at the head of each
 * field hint ("이미지 · 가이드… 선택 시 노출"), so match on that.
 */
function featureFieldsForVariant(domain: DomainSpec, childLabel: string): FeatureField[] {
  const variant = /이미지/.test(childLabel)
    ? "이미지"
    : /영상/.test(childLabel)
      ? "영상"
      : null;
  if (!variant) return [];

  const out: FeatureField[] = [];
  for (const blueprint of domain.fieldBlueprints) {
    for (const field of blueprint.fields ?? []) {
      if (field.source !== "prd") continue;
      const hint = field.hint ?? "";
      if (!/선택\s*시\s*노출/.test(hint)) continue;
      if (!hint.trimStart().startsWith(variant)) continue;
      if (!/[가-힣]/.test(field.label)) continue;
      if (out.some((entry) => entry.label === field.label)) continue;
      const options = (field.options ?? []).filter((option) => !isRawToken(option));
      out.push({
        label: field.label,
        required: field.required,
        control: field.control,
        ...(options.length > 0 ? { options } : {}),
      });
    }
  }
  return out;
}

type StepLinkEntry = { no: number; key: string };

/**
 * Match feature children to wizard steps by normalized label (trailing 필수/선택형
 * meta and whitespace stripped); fall back to positional order within the group only
 * when every label match already agrees with position. Never force a match.
 */
function linkChildrenToSteps(
  children: FeatureChild[],
  stepEntries: StepLinkEntry[],
  domain: DomainSpec,
  manifest: ManifestSpec | undefined,
): FeatureChild[] {
  if (children.length === 0 || stepEntries.length === 0) return children;

  const stepByKey = new Map<string, number | null>();
  for (const entry of stepEntries) {
    stepByKey.set(entry.key, stepByKey.has(entry.key) ? null : entry.no);
  }

  const matched = children.map((child) => {
    const key = normalizeForMatch(cleanLabel(child.label));
    const no = key.length >= 2 ? stepByKey.get(key) : undefined;
    return typeof no === "number" ? no : undefined;
  });
  // Two children claiming the same step is ambiguity, not a match.
  for (let i = 0; i < matched.length; i++) {
    if (matched[i] !== undefined && matched.some((no, j) => j !== i && no === matched[i])) {
      matched[i] = undefined;
    }
  }

  // Positional fallback: same shape as the step list and no label match disagrees.
  if (
    children.length === stepEntries.length &&
    matched.every((no, index) => no === undefined || no === stepEntries[index].no)
  ) {
    for (let i = 0; i < matched.length; i++) {
      if (matched[i] === undefined) matched[i] = stepEntries[i].no;
    }
  }

  return children.map((child, index) => {
    const stepNo = matched[index];
    if (stepNo === undefined) return child;
    const artifactId =
      manifest?.artifacts.find(
        (artifact) => artifact.no === stepNo && /step/.test(artifact.id),
      )?.id ?? null;
    const fields = featureFieldsForStep(domain, stepNo);
    return {
      ...child,
      stepNo,
      artifactId,
      ...(fields.length > 0 ? { fields } : {}),
    };
  });
}

export function buildFeaturesDoc(input: {
  runId: string;
  prdContent: string;
  domain: DomainSpec;
  clarifications: ClarificationsFile;
  manifest?: ManifestSpec;
}): FeaturesDoc {
  const sections = parsePrdSections(input.prdContent);
  const ctx = buildStatusContext(input.prdContent, input.domain, input.clarifications);
  const stepEntries: StepLinkEntry[] = [...input.domain.stepSpecs]
    .sort((a, b) => a.no - b.no)
    .map((step) => ({ no: step.no, key: normalizeForMatch(cleanLabel(step.title)) }));

  const groups: FeatureGroup[] = sections.map((section) => {
    const question = isQuestionSection(section.title);
    let label = section.title;
    let childItems: Array<{ label: string; block: string; source: string }> = [];

    if (section.subsections.length >= 2) {
      childItems = section.subsections.map((sub) => ({
        label: sub.title,
        block: sub.body,
        source: `PRD ${section.no}-${sub.m}`,
      }));
    } else {
      // A single "N-1" subsection is structural — adopt its title as the group
      // label and read the ① step items beneath it as children.
      const merged = section.subsections[0];
      if (merged) label = merged.title || label;
      const source = merged ? `PRD ${section.no}-${merged.m}` : `PRD ${section.no}`;
      const circled = parseCircledItems(section.body);
      if (circled.length >= 2) {
        childItems = circled.map((item) => ({ ...item, source }));
      } else if (merged && circled.length === 0) {
        childItems = [{ label: merged.title, block: merged.body, source }];
      } else {
        childItems = parseNumberedCheckItems(section.body).map((item) => ({
          ...item,
          source: `PRD ${section.no}`,
        }));
      }
    }

    const children: FeatureChild[] = linkChildrenToSteps(
      childItems
        .filter((item) => item.label.length >= 2 && item.label.length <= 48)
        .map((item, index) => ({
          no: `${section.no}.${index + 1}`,
          label: item.label,
          importance: OUT_OF_SCOPE.test(section.body) ? "low" : importanceOf(item.block),
          status: statusOf(item.label, ctx, question),
          source: item.source,
        })),
      stepEntries,
      input.domain,
      input.manifest,
    );

    // 유형 sections own conditional fields but map to no step, so they would render empty.
    for (const child of children) {
      if (child.stepNo !== undefined || (child.fields?.length ?? 0) > 0) continue;
      const variantFields = featureFieldsForVariant(input.domain, child.label);
      if (variantFields.length > 0) child.fields = variantFields;
    }

    return {
      no: String(section.no),
      label,
      importance: importanceOf(section.body),
      status: statusOf(label, ctx, question),
      children,
    };
  });

  return {
    runId: input.runId,
    root: { label: "PRD", runId: input.runId },
    groups,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* flow.json                                                          */
/* ------------------------------------------------------------------ */

type ConditionalCombo = {
  /** raw combo text, e.g. "이미지 · 가이드(대본·카피) 그대로 제작" */
  combo: string;
  /** business labels of the extra fields this combo reveals */
  fields: string[];
};

const COMBO_TOKEN_SLUGS: Array<[RegExp, string]> = [
  [/이미지/, "image"],
  [/영상/, "video"],
  [/배너/, "banner"],
  [/텍스트/, "text"],
  [/가이드/, "guide"],
  [/자유/, "free"],
];

/** "(대본·카피)" 같은 괄호 속 가운뎃점이 조합 구분자로 오인되지 않도록 제거 */
function comboParts(combo: string): string[] {
  return combo
    .replace(/\([^)]*\)/g, "")
    .split(/\s*·\s*/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function comboSlug(combo: string, index: number): string {
  const parts = comboParts(combo).map((part) => {
    for (const [re, slug] of COMBO_TOKEN_SLUGS) {
      if (re.test(part)) return slug;
    }
    return "";
  });
  const slug = parts.filter(Boolean).join("-");
  return slug || `combo-${index + 1}`;
}

/** "이미지 · 가이드(대본·카피) 그대로 제작" → "이미지 + 가이드 제작" */
function comboCondition(combo: string): string {
  return comboParts(combo)
    .map((part) => {
      if (/가이드/.test(part)) return "가이드 제작";
      if (/자유/.test(part)) return "자유 제작";
      return part;
    })
    .join(" + ");
}

function isConditionalStep(step: StepSpec): boolean {
  return /조건부|선택값|유형별|추가\s*입력/.test(step.title);
}

/** Read 콘텐츠 유형 × 제작방식 combos out of the conditional step's controls. */
function parseCombos(step: StepSpec): ConditionalCombo[] {
  const byCombo = new Map<string, ConditionalCombo>();
  const push = (combo: string): ConditionalCombo => {
    const key = normalizeForMatch(combo);
    let entry = byCombo.get(key);
    if (!entry) {
      entry = { combo, fields: [] };
      byCombo.set(key, entry);
    }
    return entry;
  };

  for (const control of step.controls) {
    if (control.kind === "note") {
      const match = control.text.match(/^(.+?)\s*(?:→|⇒)\s*추가\s*입력\s*없음$/);
      if (match) push(match[1].trim());
      continue;
    }
    const hint = "hint" in control ? control.hint ?? "" : "";
    const match = hint.match(/^(.+?)\s*선택\s*시\s*노출/);
    if (!match) continue;
    const entry = push(match[1].trim());
    if (!entry.fields.includes(control.label)) entry.fields.push(control.label);
  }
  return [...byCombo.values()];
}

function stepHasDecision(step: StepSpec | undefined): boolean {
  return Boolean(
    step?.controls.some(
      (control) =>
        (control.kind === "radio" || control.kind === "select") && control.required,
    ),
  );
}

export function buildFlowDoc(input: {
  runId: string;
  prdContent: string;
  domain: DomainSpec;
  manifest: ManifestSpec;
}): FlowDoc {
  const sections = parsePrdSections(input.prdContent);
  const flowSection = sections.find(
    (section) => (section.body.match(/[①-⑮]/g) ?? []).length >= 2,
  );
  const conditionalSection = sections.find((section) => /유형별|조건부/.test(section.title));

  const requestLane = {
    id: "request",
    label:
      flowSection?.subsections[0]?.title || flowSection?.title || "요청 흐름",
  };
  const lanes: FlowDoc["lanes"] = [requestLane];

  const steps = [...input.domain.stepSpecs]
    .sort((a, b) => a.no - b.no)
    .map((spec) => ({ no: spec.no, label: spec.title }));
  const specByNo = new Map(input.domain.stepSpecs.map((spec) => [spec.no, spec]));
  const artifactIdOf = (no: number): string | null =>
    input.manifest.artifacts.find((artifact) => artifact.no === no && /step/.test(artifact.id))
      ?.id ?? null;

  const nodes: FlowDoc["nodes"] = [
    { id: "start", kind: "start", label: "시작", lane: requestLane.id, artifactId: null },
  ];
  const edges: FlowDoc["edges"] = [];

  // Node ids that the next linear step must be reached from — usually the single
  // previous node, but every conditional leaf when a fan-out precedes it.
  let tails: string[] = ["start"];

  for (const step of steps) {
    const spec = specByNo.get(step.no);
    const combos = spec && isConditionalStep(spec) ? parseCombos(spec) : [];

    if (combos.length >= 2) {
      // Fan-out: the previous decision step branches per 유형 × 제작방식 combo.
      // The combo leaves stand in for this step's node; leaves with extra
      // inputs deep-link to the step's wireframe artifact.
      const laneId = "conditional";
      lanes.push({
        id: laneId,
        label: conditionalSection?.title ?? "조건부 추가 입력",
      });
      const nextTails: string[] = [];
      combos.forEach((combo, index) => {
        const id = `step-${step.no}-${comboSlug(combo.combo, index)}`;
        const hasInputs = combo.fields.length > 0;
        nodes.push({
          id,
          kind: "page",
          label: hasInputs ? `${combo.fields.join(" · ")} 입력` : "추가 입력 없음 · 제출",
          lane: laneId,
          artifactId: hasInputs ? artifactIdOf(step.no) : null,
        });
        for (const from of tails) {
          edges.push({ from, to: id, condition: comboCondition(combo.combo) });
        }
        nextTails.push(id);
      });
      tails = nextTails;
      continue;
    }

    const id = `step-${step.no}`;
    nodes.push({
      id,
      kind: stepHasDecision(spec) ? "primary" : "page",
      label: cleanLabel(step.label) || step.label,
      lane: requestLane.id,
      artifactId: artifactIdOf(step.no),
    });
    for (const from of tails) {
      edges.push({ from, to: id, condition: null });
    }
    tails = [id];
  }

  return {
    runId: input.runId,
    lanes,
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
  };
}
