import {
  buildFeaturesDoc,
  buildFlowDoc,
  cleanLabel,
  featureFieldsForStep,
  type ClarificationsFile,
  type FeatureField,
  type FeaturesDoc,
  type FlowDoc,
} from "./build-docs.js";
import {
  buildManifest,
  controlFromPrd,
  type BlueprintField,
  type DomainSpec,
  type FieldBlueprint,
  type ManifestSpec,
} from "./build-pipeline.js";
import { parsePrdSteps, parseUiPattern, type StepSpec } from "./prd-parser.js";

/**
 * 영향 미리보기 — what a staged PRD change will actually touch, named in business Korean.
 *
 * Approving a change used to be blind: the user said 네 and only found out afterwards which
 * screens had been rewritten. A count ("화면 2장 · 기능명세 3행") is no better — it is developer
 * language and names nothing. This module answers the only question that matters before
 * approval: *which* screens, *which* rows of the feature spec, *which* branch of the flow.
 *
 * Deterministic — no LLM, no network, no live DB. buildFeaturesDoc / buildFlowDoc / buildManifest
 * are pure functions of (prdContent, domain, manifest), so the "after" side is built in memory
 * from the staged PRD and diffed against the documents already on disk.
 *
 * Three rules the output must never break:
 *   1. 번호가 아니라 이름 — never `02-step-2`, always the manifest label + `(2단계)`.
 *   2. 개수가 아니라 목록 — never `3행`, always the items (capped at 5 + 외 N건).
 *   3. 구조 용어 금지 — never 노드/엣지/아티팩트/필드; a flow branch is named by its condition.
 *
 * When in doubt it over-reports: a preview listing one extra screen is harmless, one that
 * omits a screen the user later finds changed destroys trust. Anything it cannot prove is
 * labelled 영향 가능성 rather than dropped.
 */

/** 5 items then "외 N건" — a wall of names is as unreadable as a count. */
const MAX_ITEMS = 5;

export type ImpactItem = {
  /** Business-language name of the thing that changes. Never an id. */
  text: string;
  /** 이미 승인된 화면입니다 / 새로 생기는 화면 / 영향 가능성 … */
  note?: string;
};

export type ImpactPreview = {
  hasImpact: boolean;
  /** "" when nothing generated changes — the chat then says nothing about impact. */
  text: string;
  screens: ImpactItem[];
  features: ImpactItem[];
  flow: ImpactItem[];
  /** true when this run's wireframes were already approved. */
  confirmed: boolean;
  /** Set when no comparison was possible (nothing built yet). */
  reason?: "not-built";
};

const EMPTY_PREVIEW: ImpactPreview = {
  hasImpact: false,
  text: "",
  screens: [],
  features: [],
  flow: [],
  confirmed: false,
};

/* ------------------------------------------------------------------ */
/* Rule 3 — nothing internal ever reaches the user                     */
/* ------------------------------------------------------------------ */

/**
 * Anything that reads as machine vocabulary rather than business Korean: artifact ids,
 * structure words, ascii file paths, SCREAMING_SNAKE table/column names, C0xxA code values.
 * A label that trips this is replaced, never silently dropped — the count stays honest.
 */
const INTERNAL_TOKEN =
  /\d{2}-step-\d+|\bstep-\d+|\bartifact|\bnode\b|\bedge\b|\.json\b|노드|엣지|아티팩트|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|\b[A-Z][A-Z0-9]*_[A-Z][A-Z0-9_]*\b|\bC0\d{2}[A-Z]\b/;

const UNNAMED = "이름이 정해지지 않은 항목";

export function businessName(raw: string, fallback: string): string {
  const text = cleanLabel(String(raw ?? "")).replace(/\s+/g, " ").trim();
  if (!text || INTERNAL_TOKEN.test(text)) return fallback;
  return text;
}

/** "공통 정보 입력 (2단계)" — rule 1: the manifest's own label plus the step number. */
export function screenName(label: string, stepNo: number): string {
  return `${businessName(label, `${stepNo}단계 화면`)} (${stepNo}단계)`;
}

/* ------------------------------------------------------------------ */
/* The "after" domain — PRD-derived parts only                        */
/* ------------------------------------------------------------------ */

function blueprintScreenKind(
  uiPattern: DomainSpec["uiPattern"],
  stepCount: number,
): FieldBlueprint["screenKind"] {
  if (uiPattern === "list") return "list";
  if (uiPattern === "detail") return "detail";
  if (uiPattern === "page" && stepCount <= 1) return "form";
  return "wizard-step";
}

/**
 * The DomainSpec the staged PRD would produce, without re-reading the project's JSON assets.
 *
 * buildDomain is (prdContent, assets) → DomainSpec, and a PRD edit moves only the PRD half:
 * steps, step specs, screen form, and each step's own PRD controls. The DB/API half is a
 * snapshot on disk that the edit cannot move, so a step whose fields came from that snapshot
 * (no PRD controls of its own) keeps the last build's fields — and is reported as 영향 가능성
 * instead of being claimed unaffected. That keeps every proposal off the ~900KB asset read
 * and entirely off the live DB.
 */
export function projectDomain(cached: DomainSpec, prdContent: string): DomainSpec {
  const stepSpecs = parsePrdSteps(prdContent);
  const uiPattern = parseUiPattern(prdContent, stepSpecs.length > 1);

  const cachedByStep = new Map<number, FieldBlueprint>();
  for (const blueprint of cached.fieldBlueprints ?? []) {
    if (typeof blueprint.stepNo === "number") cachedByStep.set(blueprint.stepNo, blueprint);
  }

  const source: StepSpec[] =
    stepSpecs.length > 0 ? stepSpecs : [{ no: 1, title: "요청 입력", controls: [] } as StepSpec];

  const fieldBlueprints: FieldBlueprint[] = [{ screenKind: "overview", title: "개요", fields: [] }];
  for (const step of source) {
    const fromPrd = step.controls
      .map((control, index) => controlFromPrd(control, index))
      .filter((field): field is BlueprintField => Boolean(field));
    const fields = fromPrd.length > 0 ? fromPrd : cachedByStep.get(step.no)?.fields ?? [];
    fieldBlueprints.push({
      stepNo: step.no,
      screenKind: blueprintScreenKind(uiPattern, source.length),
      title: step.title,
      fields,
      enums: fields
        .filter((field) => field.options && field.options.length >= 2)
        .map((field) => ({ name: field.name, label: field.label, options: field.options! })),
    });
  }

  return { ...cached, uiPattern, stepSpecs, fieldBlueprints };
}

/** True when this step's fields are the DB/API snapshot's, not the PRD's — so we cannot prove it unaffected. */
function stepLeansOnSnapshot(domain: DomainSpec, stepNo: number): boolean {
  const spec = domain.stepSpecs.find((entry) => entry.no === stepNo);
  return !spec || spec.controls.every((control) => control.kind === "note");
}

/* ------------------------------------------------------------------ */
/* Diffs                                                              */
/* ------------------------------------------------------------------ */

function fieldSignature(fields: FeatureField[]): string {
  return fields
    .map(
      (field) =>
        `${field.label}|${field.control}|${field.required ? "1" : "0"}|${(field.options ?? []).join("·")}`,
    )
    .join("\n");
}

type StepArtifact = { no: number; label: string; locked: boolean };

function stepArtifacts(manifest: ManifestSpec | null): Map<number, StepArtifact> {
  const map = new Map<number, StepArtifact>();
  for (const artifact of manifest?.artifacts ?? []) {
    // 00-overview / 00-spec / 00-flow are the handoff documents, not request screens —
    // the 기능 명세 and 흐름 sections below already speak for them.
    if (artifact.no <= 0 || !/step/.test(artifact.id)) continue;
    map.set(artifact.no, {
      no: artifact.no,
      label: artifact.label,
      locked: Boolean(artifact.locked),
    });
  }
  return map;
}

function screenImpact(input: {
  before: ManifestSpec | null;
  after: ManifestSpec;
  beforeDomain: DomainSpec;
  afterDomain: DomainSpec;
  runConfirmed: boolean;
}): ImpactItem[] {
  const before = stepArtifacts(input.before);
  const after = stepArtifacts(input.after);
  const layoutChanged = input.beforeDomain.uiPattern !== input.afterDomain.uiPattern;

  const items: ImpactItem[] = [];
  const numbers = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);

  for (const no of numbers) {
    const was = before.get(no);
    const now = after.get(no);
    // 이미 승인된 화면은 사용자가 가장 멈춰 서서 봐야 하는 자리다.
    const approved = input.runConfirmed || Boolean(was?.locked);
    const notes: string[] = [];
    if (approved) notes.push("이미 승인된 화면입니다");

    if (!was && now) {
      items.push({ text: screenName(now.label, no), note: ["새로 생기는 화면", ...notes].join(" · ") });
      continue;
    }
    if (was && !now) {
      items.push({ text: screenName(was.label, no), note: ["없어지는 화면", ...notes].join(" · ") });
      continue;
    }
    if (!was || !now) continue;

    const renamed = cleanLabel(was.label) !== cleanLabel(now.label);
    const fieldsChanged =
      fieldSignature(featureFieldsForStep(input.beforeDomain, no)) !==
      fieldSignature(featureFieldsForStep(input.afterDomain, no));
    // A step filled from the DB/API snapshot cannot be proven untouched from the PRD alone.
    const unproven = stepLeansOnSnapshot(input.afterDomain, no);

    if (layoutChanged) notes.unshift("화면 형태가 바뀝니다");
    else if (!renamed && !fieldsChanged && unproven) notes.unshift("영향 가능성");

    if (!layoutChanged && !renamed && !fieldsChanged && !unproven) continue;

    const text = renamed
      ? `${businessName(was.label, `${no}단계 화면`)} → ${screenName(now.label, no)}`
      : screenName(now.label, no);
    items.push({ text, ...(notes.length > 0 ? { note: notes.join(" · ") } : {}) });
  }

  return items;
}

type FeatureEntry = { key: string; text: string; signature: string };

/**
 * Two kinds of row in the feature spec, both named by their business path:
 *   · a 하위 기능 under its 기능 그룹      → "요청 구조 → 공통 정보 입력"
 *   · an 항목 under its 하위 기능          → "공통 정보 입력 → 레퍼런스 전달 방식"
 * Identity is the PRD's own numbering, so a rename reads as a change, not as a delete + add.
 */
function featureEntries(doc: FeaturesDoc | null): Map<string, FeatureEntry> {
  const map = new Map<string, FeatureEntry>();
  for (const group of doc?.groups ?? []) {
    const groupName = businessName(group.label, UNNAMED);
    for (const child of group.children ?? []) {
      const childName = businessName(child.label, UNNAMED);
      const childKey = `child:${group.no}/${child.no}`;
      map.set(childKey, {
        key: childKey,
        text: `${groupName} → ${childName}`,
        // Fields have rows of their own — keep them out of here so one added option
        // does not report the 하위 기능 and the 항목 as two separate changes.
        signature: `${childName}|${child.importance}|${child.status}`,
      });
      for (const field of child.fields ?? []) {
        const fieldKey = `field:${group.no}/${child.no}/${field.label}`;
        map.set(fieldKey, {
          key: fieldKey,
          text: `${childName} → ${businessName(field.label, UNNAMED)}`,
          signature: `${field.control}|${field.required ? "1" : "0"}|${(field.options ?? []).join("·")}`,
        });
      }
    }
  }
  return map;
}

function featureImpact(before: FeaturesDoc | null, after: FeaturesDoc): ImpactItem[] {
  const was = featureEntries(before);
  const now = featureEntries(after);
  const items: ImpactItem[] = [];

  for (const [key, entry] of now) {
    const previous = was.get(key);
    if (!previous) {
      items.push({ text: entry.text, note: "새로 생깁니다" });
      continue;
    }
    if (previous.signature !== entry.signature) items.push({ text: entry.text });
  }
  for (const [key, entry] of was) {
    if (!now.has(key)) items.push({ text: entry.text, note: "빠집니다" });
  }
  return items;
}

/** Rule 3: a branch is named by the choice that leads to it, never by the thing it is. */
function branchPhrase(condition: string): string {
  return `「${businessName(condition, UNNAMED)}」을 골랐을 때 나오는 화면`;
}

type FlowShape = {
  /** branch condition → the screen it leads to */
  branches: Map<string, string>;
  /** how many screens sit on the straight-through path */
  linearCount: number;
};

function flowShape(doc: FlowDoc | null): FlowShape {
  const labelById = new Map((doc?.nodes ?? []).map((node) => [node.id, node.label]));
  const branches = new Map<string, string>();
  let linearCount = 0;
  for (const edge of doc?.edges ?? []) {
    if (edge.condition) {
      branches.set(edge.condition, labelById.get(edge.to) ?? "");
    } else {
      linearCount += 1;
    }
  }
  return { branches, linearCount };
}

function flowImpact(before: FlowDoc | null, after: FlowDoc): ImpactItem[] {
  const was = flowShape(before);
  const now = flowShape(after);
  const items: ImpactItem[] = [];

  for (const [condition, target] of now.branches) {
    const previous = was.branches.get(condition);
    if (previous === undefined) {
      items.push({ text: branchPhrase(condition), note: "새로 생깁니다" });
      continue;
    }
    if (previous !== target) items.push({ text: branchPhrase(condition) });
  }
  for (const [condition] of was.branches) {
    if (!now.branches.has(condition)) {
      items.push({ text: branchPhrase(condition), note: "없어집니다" });
    }
  }
  // Renames of a straight-through screen are already reported under 바뀌는 화면; only a
  // screen appearing or disappearing actually reshapes the path the user walks.
  if (before && was.linearCount !== now.linearCount) {
    items.push({ text: "화면을 넘어가는 순서" });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function renderSection(title: string, items: ImpactItem[]): string[] {
  if (items.length === 0) return [];
  const lines = [`  ${title}`];
  for (const item of items.slice(0, MAX_ITEMS)) {
    lines.push(`    · ${item.text}${item.note ? ` — ${item.note}` : ""}`);
  }
  // Rule 2 is a list, not a count — but an unbounded list is unreadable, so the tail is capped.
  if (items.length > MAX_ITEMS) lines.push(`    · 외 ${items.length - MAX_ITEMS}건`);
  return lines;
}

export function renderImpactText(preview: {
  screens: ImpactItem[];
  features: ImpactItem[];
  flow: ImpactItem[];
}): string {
  const blocks = [
    renderSection("바뀌는 화면", preview.screens),
    renderSection("바뀌는 기능 명세", preview.features),
    renderSection("바뀌는 흐름", preview.flow),
  ].filter((block) => block.length > 0);
  // Nothing generated moves — say nothing rather than reassure with an empty list.
  if (blocks.length === 0) return "";

  const lines = ["이 수정은 아래에 영향을 줍니다.", ""];
  blocks.forEach((block, index) => {
    lines.push(...block);
    if (index < blocks.length - 1) lines.push("");
  });
  lines.push("", "계속할까요?");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

export type ImpactInput = {
  runId: string;
  run: { no: string; title: string; prdPath: string; status: string };
  projectSlug: string;
  assetProjectSlug: string;
  /** The PRD as saved on disk right now. */
  beforePrd: string;
  /** The PRD the staged change would save. */
  afterPrd: string;
  /** spec/domain.json from the last build — the DB/API half is reused from here. */
  domain: DomainSpec | null;
  manifest: ManifestSpec | null;
  features: FeaturesDoc | null;
  flow: FlowDoc | null;
  clarifications: ClarificationsFile;
};

export function computeImpact(input: ImpactInput): ImpactPreview {
  // Nothing has been generated yet, so this change cannot disturb anything the user has seen.
  if (!input.domain || !input.manifest || !input.features || !input.flow) {
    return { ...EMPTY_PREVIEW, reason: "not-built" };
  }
  if (input.beforePrd === input.afterPrd) return EMPTY_PREVIEW;

  const beforeDomain = input.domain;
  const afterDomain = projectDomain(beforeDomain, input.afterPrd);
  const runIdentity = {
    runId: input.runId,
    no: input.run.no,
    title: input.run.title,
    prdPath: input.run.prdPath,
  };
  // Routes come from the project's route snapshot, which a PRD edit cannot move, and no part
  // of this preview shows a route — so the manifest is built without loading the assets.
  const afterManifest = buildManifest({
    run: runIdentity,
    projectSlug: input.projectSlug,
    assetProjectSlug: input.assetProjectSlug,
    domain: afterDomain,
  });
  const afterFeatures = buildFeaturesDoc({
    runId: input.runId,
    prdContent: input.afterPrd,
    domain: afterDomain,
    clarifications: input.clarifications,
    manifest: afterManifest,
  });
  const afterFlow = buildFlowDoc({
    runId: input.runId,
    prdContent: input.afterPrd,
    domain: afterDomain,
    manifest: afterManifest,
  });

  const confirmed = input.run.status === "confirmed";
  const screens = screenImpact({
    before: input.manifest,
    after: afterManifest,
    beforeDomain,
    afterDomain,
    runConfirmed: confirmed,
  });
  const features = featureImpact(input.features, afterFeatures);
  const flow = flowImpact(input.flow, afterFlow);

  const text = renderImpactText({ screens, features, flow });
  return {
    hasImpact: text.length > 0,
    text,
    screens,
    features,
    flow,
    confirmed,
  };
}
