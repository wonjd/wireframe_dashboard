import { readFile, writeFile, mkdir, access, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { WireframeConfig } from "../lib/config.js";
import { resolveFromRepo, resolveProject } from "../lib/config.js";
import { getRunRoot, loadIndex, saveIndex, getProject } from "../lib/runs.js";
import { quoteSql, runWonjdQuery } from "../extractors/wonjd.js";
import {
  currentLedgerAnswers,
  detectScreenCollisions,
  loadDecisionLedger,
  prefillNotice,
  recordDecisions,
  topicLabelKo,
} from "./decision-ledger.js";
import { parseConditionalMatrix, parsePrdSteps, type FieldControl } from "./prd-parser.js";

export type ClarificationKind = "ambiguity" | "policy" | "scope" | "data";

/** Stable topic keys — skip re-asking once answered (exact question text may change). */
export type ClarificationTopic =
  | "who_does"
  | "new_or_change"
  | "screen_layout"
  | "required_optional"
  | "choice_values"
  | "conditional_fields"
  | "attach_method"
  | "limits"
  | "after_submit"
  | "edit_rules"
  | "privacy"
  | "done_when"
  /** 업무 질문이 다 끝난 뒤 "요청서를 이대로 확정할까요?" — 승인해야 ready. */
  | "prd_ready"
  | "other";

/**
 * The answer the system computed for a question, from evidence that already exists:
 * the PRD's own words (prdEvidenceFor), an earlier request's decision (decision ledger),
 * or live code values translated by the project glossary. Never invented.
 */
export type ClarificationProposal = {
  /** 1-based index into ClarificationItem.options — the ① the user can accept as-is. */
  optionNo: number;
  /** Stored verbatim as the answer on 「제안대로」 — never the phrase itself. */
  answer: string;
  /** 근거 — where it came from, in business Korean. */
  basis: string;
  source: "prd" | "ledger" | "live";
};

export type ClarificationItem = {
  id: string;
  kind: ClarificationKind;
  topic: ClarificationTopic;
  question: string;
  /** Internal: why we ask — may mention assets; chat must NOT dump this raw to non-devs. */
  reason: string;
  /** PRD's own words behind a re-ask (see prdEvidenceFor) — safe to show, business language. */
  evidence?: string[];
  /** 1-based number shown to the user ("3번 빼고 제안대로"). Stable within a round. */
  no?: number;
  /** 상황 — the concrete case, quoting the PRD's own words when they exist. */
  situation?: string;
  /** 선택지 — concrete options, not free text. Rendered ①②③… */
  options?: string[];
  /** 제안 — absent when nothing in the system says what the answer should be. */
  proposal?: ClarificationProposal;
  /** 근거 for a question that has no proposal but does have PRD words behind it (re-asks). */
  basis?: string;
  /** No evidence → no proposal → 「제안대로」 일괄 승인에서 제외. */
  needsUser?: boolean;
  /** 상황·선택지·제안·근거를 합친 표시용 문구. 채팅은 이 문구를 그대로 읽어 준다. */
  prompt?: string;
};

export type ClarificationsPhase = "clarify" | "layout" | "ready";

export type ResolvedClarification = ClarificationItem & {
  answer: string;
  resolvedAt: string;
  /** prefilledFrom = adopted from an earlier run's ledger decision (PRD-00x) — not asked here. */
  prefilledFrom?: string;
  /**
   * The user denied ("없다") something the PRD spells out, was shown the PRD's own words, and
   * kept the denial. Recorded so the PRD/answer conflict stays traceable instead of silent.
   */
  overridesPrd?: boolean;
  /** The PRD lines this answer overrides. */
  prdEvidence?: string[];
  /**
   * The user accepted the system's proposal verbatim. The proposal was read out of the PRD,
   * so this answer can never contradict it — even when it quotes an option called "없음".
   */
  fromProposal?: boolean;
};

export type ClarificationsDoc = {
  status: "clarifying" | "ready";
  /** clarify = 업무 미결, layout = PRD 승인 후 화면 형태만, ready = 빌드 가능 */
  phase?: ClarificationsPhase;
  open: ClarificationItem[];
  resolved: ResolvedClarification[];
  rounds: number;
  updatedAt: string;
  channel: "chat";
  /**
   * 사용자가 「요청서를 이대로 확정할까요?」에 승인한 시점의 본문(확인된 결정 제외) 지문.
   * 이것이 현재 본문과 같을 때에만 ready로 갈 수 있다 — 본문이 바뀌면 다시 승인받는다.
   */
  prdConfirm?: { bodyHash: string; confirmedAt: string };
  audience: "non_developer";
};

function emptyDoc(): ClarificationsDoc {
  return {
    status: "clarifying",
    phase: "clarify",
    open: [],
    resolved: [],
    rounds: 0,
    updatedAt: new Date().toISOString(),
    channel: "chat",
    audience: "non_developer",
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function clarificationsPath(config: WireframeConfig, runId: string): string {
  return path.join(getRunRoot(config, runId), "spec", "clarifications.json");
}

export async function loadClarificationsDoc(
  config: WireframeConfig,
  runId: string,
): Promise<ClarificationsDoc> {
  const file = clarificationsPath(config, runId);
  if (!(await pathExists(file))) return emptyDoc();
  try {
    const raw = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
    return {
      ...emptyDoc(),
      ...(JSON.parse(raw) as ClarificationsDoc),
      channel: "chat",
      audience: "non_developer",
    };
  } catch {
    return emptyDoc();
  }
}

async function saveClarificationsDoc(
  config: WireframeConfig,
  runId: string,
  doc: ClarificationsDoc,
): Promise<void> {
  const file = clarificationsPath(config, runId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* PRD evidence for a topic — deterministic, reuses the build parsers.  */
/* A "없다" answer must not close a topic the PRD itself spells out.     */
/* ------------------------------------------------------------------ */

/** Parsing the same PRD once per process is enough — the CLI is one-shot. */
let evidenceMemo: { prd: string; controls: FieldControl[]; conditional: string[] } | null = null;

function parsedControls(prd: string): { controls: FieldControl[]; conditional: string[] } {
  if (evidenceMemo?.prd === prd) return evidenceMemo;
  let controls: FieldControl[] = [];
  let conditional: string[] = [];
  try {
    controls = parsePrdSteps(prd).flatMap((step) => step.controls);
  } catch {
    controls = [];
  }
  try {
    conditional = conditionalQuotes(parseConditionalMatrix(prd));
  } catch {
    conditional = [];
  }
  evidenceMemo = { prd, controls, conditional };
  return evidenceMemo;
}

/** "이미지 · 가이드 제작 → 메인 카피" — the combo comes from the parsed hint, not a new parser. */
function conditionalQuotes(controls: FieldControl[]): string[] {
  const quotes: string[] = [];
  for (const control of controls) {
    if (control.kind === "note") continue;
    const hint = "hint" in control ? (control.hint ?? "") : "";
    const combo = hint.match(/^(.*?)\s*선택\s*시\s*노출/)?.[1]?.trim() ?? "";
    const quote = combo ? `${combo} → ${control.label}` : control.label;
    if (quote && !quotes.includes(quote)) quotes.push(quote);
  }
  return quotes;
}

function labelOf(control: FieldControl): string {
  return control.kind === "note" ? "" : control.label;
}

const EVIDENCE_MAX = 8;

/**
 * The PRD's own words for a topic, in business Korean. Empty when the PRD says nothing —
 * only then may a negative answer close the topic.
 */
export function prdEvidenceFor(prd: string, topic: string): string[] {
  const { controls, conditional } = parsedControls(prd);
  const quotes: string[] = [];
  const push = (text: string): void => {
    const value = text.trim();
    if (value && !quotes.includes(value)) quotes.push(value);
  };

  if (topic === "conditional_fields") {
    conditional.forEach(push);
  } else if (topic === "required_optional") {
    for (const control of controls) {
      if (control.kind === "note" || !control.required) continue;
      push(`${control.label} 필수`);
    }
  } else if (topic === "choice_values") {
    for (const control of controls) {
      if (control.kind !== "radio" && control.kind !== "select") continue;
      if (!control.options?.length) continue;
      push(`${control.label}: ${control.options.join(" / ")}`);
    }
  } else if (topic === "attach_method") {
    for (const control of controls) {
      const label = labelOf(control);
      if (!label || !/레퍼런스|첨부|업로드|파일/.test(label)) continue;
      const options =
        (control.kind === "radio" || control.kind === "select") && control.options?.length
          ? `: ${control.options.join(" / ")}`
          : "";
      push(`${label}${options}`);
    }
  } else if (topic === "limits") {
    for (const control of controls) {
      if (control.kind !== "textarea" || !control.maxLength) continue;
      push(`${control.label} 최대 ${control.maxLength}자`);
    }
  }

  return quotes.slice(0, EVIDENCE_MAX);
}

/** 이/가 by final jamo — a non-hangul tail defaults to 가. */
function subjectParticle(word: string): string {
  const code = word.trim().slice(-1).charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

const TOPIC_PHRASE_KO: Record<string, string> = {
  conditional_fields: "선택에 따라 달라지는 항목",
  required_optional: "꼭 채워야 하는 항목",
  choice_values: "고를 수 있는 선택지",
  attach_method: "참고 자료 전달 방식",
  limits: "글자·항목 제한",
};

/* ------------------------------------------------------------------ *
 * 상황 · 선택지 · 제안 · 근거
 *
 * A question that asks a non-developer to invent policy gets "없다" and ships an empty
 * screen. Every question therefore carries the answer the system already knows, built
 * ONLY from evidence that exists: the PRD's own words (prdEvidenceFor — the same reader
 * the contradiction check uses), an earlier request's decision (decision ledger), or a
 * live code list translated by the project glossary. No new parser, no extra LLM call.
 * Where nothing says what the answer should be we say so — 제안 없음 — instead of guessing.
 * ------------------------------------------------------------------ */

const OPTION_KEYS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

export type QuestionKit = {
  situation: string;
  options: string[];
  proposal?: ClarificationProposal;
};

function optionKey(no: number): string {
  return OPTION_KEYS[no - 1] ?? `${no}`;
}

/** 「A」, 「B」 외 2건 — quoted so the user sees the PRD's own words. */
function quoteJoin(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return shown.map((text) => `「${text}」`).join(", ") + (rest > 0 ? ` 외 ${rest}건` : "");
}

const NO_PRD_BASIS = "PRD에 이 부분이 적혀 있지 않습니다.";

function prdBasis(evidence: string[]): string {
  return `요청서에 적혀 있습니다 — ${quoteJoin(evidence)}`;
}

/** 제안 없음 — the options still stand, but the user must pick. */
function askOnly(situation: string, options: string[]): QuestionKit {
  return { situation, options };
}

function proposeFirst(
  situation: string,
  options: string[],
  answer: string,
  basis: string,
  source: ClarificationProposal["source"],
): QuestionKit {
  return { situation, options, proposal: { optionNo: 1, answer, basis, source } };
}

/**
 * The four parts as one block of text. `question` stays the plain one-line ask so the
 * PRD's 확인된 결정 section (and every id→topic match) is unchanged by this.
 */
function renderPrompt(item: ClarificationItem): string {
  const lines: string[] = [`${item.no ?? 1}번. ${item.question}`];
  if (item.situation) lines.push(`상황: ${item.situation}`);
  if (item.options?.length) {
    lines.push(
      `선택지: ${item.options.map((text, i) => `${optionKey(i + 1)} ${text}`).join("  ")}`,
    );
  }
  // The approval question is not a proposal question — it must not read as one.
  if (item.topic === "prd_ready") {
    lines.push("확정하면 화면 형태만 정한 뒤 와이어프레임을 만듭니다. 고칠 곳이 있으면 지금 알려 주세요.");
    return lines.join("\n");
  }
  lines.push(
    item.proposal
      ? `제안: ${optionKey(item.proposal.optionNo)} ${item.proposal.answer}`
      : "제안 없음 — 확인이 필요합니다",
  );
  lines.push(`근거: ${item.proposal?.basis ?? item.basis ?? NO_PRD_BASIS}`);
  return lines.join("\n");
}

/** Numbers the round and renders every prompt. Numbers are what 「3번 빼고」 refers to. */
function numberQuestions(items: ClarificationItem[]): ClarificationItem[] {
  return items.map((item, index) => {
    const numbered: ClarificationItem = {
      ...item,
      no: index + 1,
      needsUser: item.needsUser ?? !item.proposal,
    };
    return { ...numbered, prompt: renderPrompt(numbered) };
  });
}

/* --- per-topic kits: evidence in, 상황/선택지/제안/근거 out --------- */

function limitsKit(evidence: string[]): QuestionKit {
  if (evidence.length === 0) {
    return askOnly("글자 수나 항목 개수를 얼마나 받을지가 요청서에 적혀 있지 않습니다.", [
      "제한 없이 받기",
      "긴 입력칸(대본·카피)에만 글자 수 제한 두기 — 숫자를 알려 주세요",
      "항목 개수를 제한하기 — 숫자를 알려 주세요",
    ]);
  }
  const listed = evidence.join(", ");
  return proposeFirst(
    `요청서에는 ${quoteJoin(evidence)}처럼 길이 제한이 적혀 있고, 나머지 입력칸에는 제한이 적혀 있지 않습니다.`,
    [
      `${listed}만 제한하고 나머지 입력칸은 제한 없이 받기`,
      "모든 긴 입력칸에 같은 제한을 적용하기",
      "제한을 아예 두지 않기",
    ],
    `${listed}만 제한, 나머지 입력칸은 제한 없음`,
    prdBasis(evidence),
    "prd",
  );
}

function requiredKit(evidence: string[]): QuestionKit {
  if (evidence.length === 0) {
    return askOnly("꼭 채워야 하는 항목과 비워도 되는 항목이 요청서에 나뉘어 있지 않습니다.", [
      "모든 항목을 꼭 채우게 하기",
      "일부만 꼭 채우게 하기 — 항목을 알려 주세요",
      "전부 비워도 되게 하기",
    ]);
  }
  const required = evidence.map((text) => text.replace(/\s*필수$/, ""));
  const listed = required.join(", ");
  return proposeFirst(
    `요청서에는 ${quoteJoin(required)} 등 ${required.length}개 항목이 꼭 채워야 하는 것으로 적혀 있습니다.`,
    [
      `요청서에 적힌 ${required.length}개만 꼭 채우게 하고 나머지는 선택으로 두기`,
      "여기에 몇 개를 더 꼭 채우게 하기 — 항목을 알려 주세요",
      "전부 선택으로 두기",
    ],
    `꼭 채울 항목: ${listed} / 나머지는 선택`,
    prdBasis(required),
    "prd",
  );
}

function choiceKit(evidence: string[]): QuestionKit {
  if (evidence.length === 0) {
    return askOnly("골라서 쓰는 항목의 선택지 문구가 요청서에 적혀 있지 않습니다.", [
      "선택지 문구를 직접 알려 주기",
      "선택지 없이 직접 입력으로 받기",
    ]);
  }
  const listed = evidence.join(" · ");
  return proposeFirst(
    `고르는 항목의 선택지가 요청서에 이렇게 적혀 있습니다 — ${listed}`,
    [
      "요청서에 적힌 선택지를 그대로 쓰기",
      "여기에 ‘기타(직접 입력)’을 더하기",
      "선택지를 다르게 정하기 — 문구를 알려 주세요",
    ],
    listed,
    prdBasis(evidence),
    "prd",
  );
}

function conditionalKit(evidence: string[]): QuestionKit {
  if (evidence.length === 0) {
    return askOnly(
      "앞 단계에서 고른 값에 따라 어떤 칸이 더 나오는지가 요청서에 적혀 있지 않습니다.",
      [
        "고른 값과 상관없이 항상 같은 칸을 보여 주기",
        "고른 값에 따라 칸을 다르게 보여 주기 — 조합을 알려 주세요",
      ],
    );
  }
  const listed = evidence.join(" · ");
  return proposeFirst(
    `무엇을 고르면 어떤 칸이 나오는지가 요청서에 이렇게 적혀 있습니다 — ${listed}`,
    [
      "요청서에 적힌 조합 그대로 보여 주기",
      "조건 없이 모든 칸을 항상 보여 주기",
      "조합을 다르게 정하기 — 알려 주세요",
    ],
    listed,
    prdBasis(evidence),
    "prd",
  );
}

function attachKit(evidence: string[]): QuestionKit {
  if (evidence.length === 0) {
    return askOnly("참고 자료를 어떤 방법으로 넘길지가 요청서에 적혀 있지 않습니다.", [
      "링크만 받기",
      "파일 첨부만 받기",
      "링크·파일 둘 다 받기",
      "메신저(웍스방)로 직접 전달받기",
    ]);
  }
  const listed = evidence.join(" · ");
  return proposeFirst(
    `참고 자료 전달 방식이 요청서에 이렇게 적혀 있습니다 — ${listed}`,
    [
      "요청서에 적힌 그대로 받기",
      "파일 첨부 대신 메신저(웍스방)로 직접 전달받기",
      "링크만 받기",
    ],
    listed,
    prdBasis(evidence),
    "prd",
  );
}

/* --- live code values, translated to business Korean by the glossary ---- *
 * liveDbBrief reports what the system actually stores ("… codes=[C026A,…]"). A code is
 * never shown to a non-developer, and inventing names for codes would be inventing policy,
 * so a live value only becomes a proposal when projects/<slug>/glossary.json spells out what
 * each code means in business Korean. Today crm's glossary maps words to tables but carries
 * no code labels, so this path yields 제안 없음 — by design, not by accident.
 */

type GlossaryCodeMap = Map<string, Map<string, string>>;

type GlossaryTerm = {
  word?: string;
  column?: string;
  table?: string;
  codes?: Record<string, string> | Array<{ value?: string; label?: string }>;
};

function codeEntries(codes: GlossaryTerm["codes"]): Array<[string, string]> {
  if (!codes) return [];
  if (Array.isArray(codes)) {
    return codes
      .filter((row) => typeof row?.value === "string" && typeof row?.label === "string")
      .map((row) => [String(row.value).toUpperCase(), String(row.label)] as [string, string]);
  }
  return Object.entries(codes)
    .filter(([, label]) => typeof label === "string" && label.trim())
    .map(([value, label]) => [value.toUpperCase(), String(label)] as [string, string]);
}

/** Safe when the file is missing or hand-broken — an empty map means "no live proposal". */
async function loadGlossaryCodes(projectSlug: string): Promise<GlossaryCodeMap> {
  const map: GlossaryCodeMap = new Map();
  const file = resolveFromRepo(path.join("projects", projectSlug, "glossary.json"));
  if (!(await pathExists(file))) return map;
  try {
    const raw = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")) as {
      terms?: GlossaryTerm[];
    };
    for (const term of raw.terms ?? []) {
      const entries = codeEntries(term.codes);
      if (!entries.length || !term.column) continue;
      const keys = [term.column.toUpperCase()];
      if (term.table) keys.push(`${term.table.toUpperCase()}.${term.column.toUpperCase()}`);
      for (const key of keys) map.set(key, new Map(entries));
    }
  } catch {
    return new Map();
  }
  return map;
}

/**
 * Business labels for the first live code column the glossary can fully translate.
 * Partial coverage is no coverage: a half-named list would leave the user guessing.
 */
function liveChoiceLabels(liveSummary: string, glossary: GlossaryCodeMap): string[] {
  if (glossary.size === 0) return [];
  for (const line of liveSummary.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\.([A-Z0-9_]+)\s+codes=\[([^\]]*)\]/);
    if (!match) continue;
    const [, table, column, list] = match;
    const labels = glossary.get(`${table}.${column}`) ?? glossary.get(column!);
    if (!labels) continue;
    const codes = list!.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
    if (codes.length === 0) continue;
    const named = codes.map((code) => labels.get(code) ?? "");
    if (named.some((name) => !name)) continue;
    return named;
  }
  return [];
}

function listFilterKit(liveLabels: string[]): QuestionKit {
  const options = [
    "구분을 나누지 않고 한 목록으로 보기",
    "구분 이름을 직접 알려 주기",
  ];
  if (liveLabels.length === 0) {
    return askOnly("목록에서 어떤 구분으로 나눠 볼지가 요청서에 적혀 있지 않습니다.", options);
  }
  const listed = liveLabels.join(" · ");
  return proposeFirst(
    `목록 구분이 요청서에 적혀 있지 않지만, 지금 업무에서는 ${listed} 단계로 나눠 쓰고 있습니다.`,
    [`지금 쓰는 대로 ${listed}로 나누기`, ...options],
    `목록 구분: ${listed}`,
    `지금 실제로 쓰고 있는 구분입니다 — ${listed}`,
    "live",
  );
}

/** A topic decided in an earlier request that was not pre-filled — propose it, don't assume it. */
function withLedgerProposal(kit: QuestionKit, decided?: { answer: string; source: string }): QuestionKit {
  if (kit.proposal || !decided?.answer.trim()) return kit;
  const answer = decided.answer.trim();
  const options = kit.options.includes(answer) ? kit.options : [answer, ...kit.options];
  return {
    situation: kit.situation,
    options,
    proposal: {
      optionNo: options.indexOf(answer) + 1,
      answer,
      basis: `이전 요청(${decided.source})에서 같은 내용을 이렇게 정했습니다 — ${answer}`,
      source: "ledger",
    },
  };
}

export type PrdContradiction = {
  topic: ClarificationTopic;
  /** The denial that conflicts with the PRD. */
  answer: string;
  /** The PRD's own words, business language — safe to show. */
  evidence: string[];
  /** Plain-Korean re-ask, asked once and only once per topic. */
  question: string;
};

function contradictionQuestion(topic: string, answer: string, evidence: string[]): string {
  const phrase = TOPIC_PHRASE_KO[topic] ?? topicLabelKo(topic);
  const count = evidence.length;
  return `PRD에는 「${evidence[0]}」처럼 ${phrase}이 ${count}가지 적혀 있습니다. 「${answer}」${subjectParticle(answer)} 맞나요, 아니면 이 ${count}가지를 반영할까요?`;
}

/**
 * Answers that deny what the PRD spells out and have NOT yet been re-confirmed.
 * A later answer on the same topic (a real answer, or the denial kept after the re-ask)
 * clears it — so a topic is never challenged more than once.
 */
export function prdContradictions(
  prd: string,
  resolved: ResolvedClarification[],
): PrdContradiction[] {
  const pending = new Map<string, PrdContradiction>();
  for (const item of resolved) {
    const topic = (item.topic || "other") as ClarificationTopic;
    if (item.fromProposal || item.overridesPrd || !isNegativeOrSkipAnswer(item.answer)) {
      pending.delete(topic);
      continue;
    }
    const evidence = prdEvidenceFor(prd, topic);
    if (evidence.length === 0) continue;
    pending.set(topic, {
      topic,
      answer: item.answer.trim(),
      evidence,
      question: contradictionQuestion(topic, item.answer.trim(), evidence),
    });
  }
  return [...pending.values()];
}

/**
 * Topics already covered by ## 확인된 결정 or prior answers.
 *
 * scope="decided" counts only what somebody actually decided (the 확인된 결정 section and
 * answered questions). scope="all" also counts keywords in the PRD body — that is the right
 * rule for topics we can only ask blind, but for the five evidence topics body text is
 * *evidence for a proposal*, not a decision, so those questions are gated on "decided".
 */
function resolvedTopicsFromPrd(
  prd: string,
  resolved: ClarificationsDoc["resolved"],
  scope: "all" | "decided" = "all",
): Set<string> {
  // A denial that contradicts the PRD covers nothing until the user has confirmed it once.
  const contradicted = new Set<string>(prdContradictions(prd, resolved).map((item) => item.topic));
  const topics = new Set<string>();
  for (const item of resolved) {
    const topic = item.topic || "other";
    if (contradicted.has(topic)) continue;
    topics.add(topic);
  }
  const section = prd.match(/(?:^|\n)#+\s*확인된\s*결정([\s\S]*)$/m)?.[1] ?? "";
  const blob = `${section}\n${resolved.map((r) => `${r.question}\n${r.answer}`).join("\n")}`;
  const full = scope === "decided" ? blob : `${prd}\n${blob}`;

  if (/권한|역할|담당|승인|영업|콘텐츠\s*팀|요청자/.test(blob) || /콘텐츠\s*팀/.test(full)) {
    topics.add("who_does");
  }
  if (
    /기존\s*화면|신규\s*화면|지금\s*있는\s*화면|새\s*화면|메뉴\s*이름|화면\s*이름/.test(blob) ||
    /새\s+.+\s*화면|화면\s*이름|메뉴\s*이름|신규|기존\s*화면/.test(full)
  ) {
    topics.add("new_or_change");
  }
  if (
    /화면\s*양식|화면\s*형태|모달|팝업|목록\s*표|테이블\s*형태|전체\s*페이지|단계별\s*화면|위자드/.test(
      blob,
    ) ||
    /모달|팝업|목록\s*표|테이블|전체\s*페이지\s*폼|단계별로/.test(full)
  ) {
    topics.add("screen_layout");
  }
  if (/필수|선택\s*항목|미기입/.test(blob)) topics.add("required_optional");
  // Choice labels present, or user said none / N/A in decisions section
  if (
    hasChoiceLabelsInText(blob) ||
    hasChoiceLabelsInText(full) ||
    (isNegativeOrSkipAnswer(blob) && /선택지|선택해서|드롭다운|선택\s*목록/.test(blob))
  ) {
    topics.add("choice_values");
  }
  if (
    /조건부|선택값에\s*따라|유형별|가이드.*노출|자유\s*제작/.test(blob) ||
    (/조건부|선택값에\s*따라|달라지는\s*입력/.test(blob) && isNegativeOrSkipAnswer(blob)) ||
    /조건부\s*입력.{0,12}없|선택값에\s*따라.{0,20}노출되지\s*않/.test(full)
  ) {
    topics.add("conditional_fields");
  }
  if (/첨부|업로드|웍스|레퍼런스\s*전달|링크\s*첨부|파일\s*첨부/.test(blob)) {
    topics.add("attach_method");
  }
  if (/\d+\s*자|최대\s*\d+|항목\s*수|글자\s*수\s*제한/.test(blob) || /\d+\s*자/.test(full)) {
    topics.add("limits");
  }
  if (/제출\s*후|제작\s*착수|알림|담당자에게|배정|작업\s*완료/.test(blob) || /제출\s*후|배정/.test(full)) {
    topics.add("after_submit");
  }
  if (/수정\s*가능|초기화|도중에\s*변경|재입력|마이그레이션/.test(blob) || /제출한\s*뒤.{0,10}수정/.test(full)) {
    topics.add("edit_rules");
  }
  if (/개인정보|마스킹|연락처/.test(blob)) topics.add("privacy");
  if (/완료\s*기준|성공\s*기준|끝으로\s*본다/.test(blob)) topics.add("done_when");

  // The PRD text itself is what the denial contradicts, so its keywords must not re-cover
  // the topic behind the user's back — the re-ask below is the only way to close it.
  for (const topic of contradicted) topics.delete(topic);

  return topics;
}

function isNegativeOrSkipAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Short N/A answers from non-devs
  if (/^(없(다|음|어요)?|해당\s*없(음|다)?|없음|몰라요|모름|해당\s*사항\s*없|N\/?A|no)$/i.test(t)) {
    return true;
  }
  return /없(다|음|어요)|해당\s*없|노출되지\s*않|선택지\s*없|추가\s*없|조건부.{0,8}없/.test(t);
}

function hasChoiceLabelsInText(text: string): boolean {
  return (
    /선택지|목록\s*값|화면에\s*보일\s*선택|예\s*[:：].{0,60}\//.test(text) ||
    /이미지\s*(또는|\/|,|·)\s*영상/.test(text) ||
    /링크\s*첨부.{0,20}파일\s*첨부/.test(text) ||
    /가이드.{0,30}자유\s*제작|자유\s*제작.{0,30}가이드/.test(text) ||
    (/드롭다운|선택\s*목록/.test(text) && /기타|직접\s*입력|허용/.test(text) && /[,，/·]/.test(text))
  );
}

/**
 * Non-developer PRD gaps only. Questions must be everyday work Korean —
 * no column names, API, ENUM, FK, modify/extend jargon.
 */
type QuestionContext = {
  prd: string;
  title: string;
  liveSummary: string;
  /** Decided OR merely mentioned in the PRD body — the gate for blind questions. */
  covered: Set<string>;
  /** Actually decided by somebody — the gate for the five evidence topics. */
  decided: Set<string>;
  /** Live code values the glossary could name in business Korean (usually empty). */
  liveLabels: string[];
  /** Earlier requests' decisions, by topic — a proposal source of last resort. */
  ledger: Map<string, { answer: string; source: string }>;
};

function heuristicQuestions(ctx: QuestionContext): ClarificationItem[] {
  const { prd, title, liveSummary, covered, decided } = ctx;
  const items: ClarificationItem[] = [];
  const push = (
    topic: ClarificationTopic,
    kind: ClarificationKind,
    question: string,
    reason: string,
    kit: QuestionKit,
  ) => {
    if (covered.has(topic)) return;
    if (items.some((item) => item.topic === topic)) return;
    const withLedger = withLedgerProposal(kit, ctx.ledger.get(topic));
    items.push({
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      topic,
      question,
      reason,
      situation: withLedger.situation,
      options: withLedger.options,
      ...(withLedger.proposal ? { proposal: withLedger.proposal } : {}),
      needsUser: !withLedger.proposal,
    });
  };
  /** Evidence topics: a PRD that spells the answer out becomes a proposal, not a skip. */
  const pushEvidence = (
    topic: ClarificationTopic,
    kind: ClarificationKind,
    question: string,
    reason: string,
    kit: (evidence: string[]) => QuestionKit,
  ) => {
    if (decided.has(topic)) return;
    if (items.some((item) => item.topic === topic)) return;
    const evidence = prdEvidenceFor(prd, topic);
    const built = withLedgerProposal(kit(evidence), ctx.ledger.get(topic));
    items.push({
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      topic,
      question,
      reason,
      ...(evidence.length ? { evidence } : {}),
      situation: built.situation,
      options: built.options,
      ...(built.proposal ? { proposal: built.proposal } : {}),
      needsUser: !built.proposal,
    });
  };

  const hasFlow =
    /①|②|\d+\s*단계|요청\s*구조|플로우|→|공통\s*정보|유형\s*선택/.test(prd);
  const hasForm = /폼|입력|등록|요청|양식|필수|선택/.test(prd);
  const hasList = /목록|리스트|현황|검색|필터/.test(prd);
  const mentionsChoice =
    /선택형|드롭다운|라디오|단일\s*선택|이미지\s*\/\s*영상|가이드|자유\s*제작/.test(prd);
  const mentionsAttach = /첨부|업로드|레퍼런스|파일|웍스|링크\s*첨부/.test(prd);
  const mentionsConditional =
    /조건부|선택값에\s*따라|유형별|추가\s*입력\s*항목|매트릭스/.test(prd);
  const mentionsLimit = /글자|자\s*제한|최대|200자|개수\s*제한/.test(prd);

  // Who uses / approves
  if (!/권한|역할|담당|승인|영업|콘텐츠\s*팀|요청자/.test(prd)) {
    push(
      "who_does",
      "policy",
      "이 요청은 누가 작성하고, 누가 확인·승인하나요?",
      "담당·승인 주체가 없으면 버튼·권한 흐름을 그릴 수 없음",
      askOnly("누가 작성하고 누가 확인·승인하는지가 요청서에 적혀 있지 않습니다.", [
        "영업(요청자)이 작성하고 콘텐츠팀이 확인",
        "콘텐츠팀이 작성부터 확인까지",
        "영업이 작성하고 별도 확인 없이 바로 진행",
      ]),
    );
  }

  // New screen vs changing existing — plain language
  if (
    !/기존|지금\s*있는|신규|새로\s*만|새\s+.+\s*화면|화면\s*이름|메뉴\s*이름|메뉴|경로|화면\s*수정|개선/.test(
      prd,
    )
  ) {
    push(
      "new_or_change",
      "scope",
      "지금 쓰는 화면을 고치는 건가요, 새 화면을 만드는 건가요?",
      "기존 수정 vs 신규에 따라 라우트·셸 배치가 갈림",
      askOnly("기존 화면을 고치는지 새 화면을 만드는지가 요청서에 적혀 있지 않습니다.", [
        "지금 쓰는 화면을 고치기 — 메뉴 이름을 알려 주세요",
        "새 화면을 만들기",
      ]),
    );
  }

  // screen_layout is NOT asked here — only after PRD ready (see reviewPrdClarificationsCli)

  // Required vs optional on form-like PRDs — the PRD's own "필수" lines become the proposal
  if (hasForm) {
    pushEvidence(
      "required_optional",
      "ambiguity",
      "꼭 채워야 하는 항목과 비워도 되는 항목을 어떻게 나눌까요?",
      "폼성 PRD — 필수/선택 확정 필요",
      requiredKit,
    );
  }

  // Choice lists — the labels the PRD already lists become the proposal
  if (mentionsChoice) {
    pushEvidence(
      "choice_values",
      "data",
      "골라서 쓰는 항목의 선택지 문구를 어떻게 할까요?",
      "선택형 항목의 선택지 문구 확정 필요",
      choiceKit,
    );
  }

  // Dropdown mentioned but no value list after decisions saying "드롭다운"
  if (
    /드롭다운/.test(prd) &&
    /확인된\s*결정/.test(prd) &&
    !hasChoiceLabelsInText(prd) &&
    !/선택지|목록\s*값|예\s*[:：].{0,40}\//.test(prd)
  ) {
    pushEvidence(
      "choice_values",
      "data",
      "드롭다운으로 하기로 한 항목의 선택지를 어떻게 할까요?",
      "드롭다운 확정인데 선택지 목록이 비어 있음",
      choiceKit,
    );
  }

  // Conditional fields
  if (mentionsConditional) {
    pushEvidence(
      "conditional_fields",
      "ambiguity",
      "앞 단계에서 고른 값에 따라 달라지는 입력칸을 어떻게 할까요?",
      "조건부 노출 조합 확정 필요",
      conditionalKit,
    );
  }

  // Attach / reference method
  if (mentionsAttach) {
    pushEvidence(
      "attach_method",
      "data",
      "참고 자료는 어떤 방법으로 넘길까요?",
      "첨부·레퍼런스 전달 방식 확정 필요",
      attachKit,
    );
  }

  // Limits
  if (/리스트|복수|여러\s*개|추가\s*소구|대본|카피/.test(prd) || mentionsLimit) {
    pushEvidence(
      "limits",
      "data",
      "글자 수·항목 개수 제한을 어떻게 할까요?",
      "복수/장문 입력이 있어 상한 확정 필요",
      limitsKit,
    );
  }

  // After submit — "다음 단계 넘어가지 못하도록"(입력 단계 이동)은 제출 이후 흐름이 아니다
  if (hasForm && !/제출\s*후|요청\s*후|알림|담당자|제작\s*착수/.test(prd)) {
    push(
      "after_submit",
      "policy",
      "요청을 제출하면 다음에 누가 무엇을 하나요?",
      "제출 이후 업무 흐름이 PRD에 없음",
      askOnly("요청을 제출한 다음 누가 무엇을 하는지가 요청서에 적혀 있지 않습니다.", [
        "콘텐츠팀이 확인한 뒤 제작 시작",
        "담당자를 정한 뒤 제작 시작",
        "바로 제작 대기 목록으로 넘기기",
      ]),
    );
  }

  // Edit after submit / mid-change
  if (
    hasForm &&
    /상태|진행|제작/.test(prd) &&
    !/제출.{0,8}수정|요청.{0,8}수정|초기화|도중에\s*변경|재입력/.test(prd)
  ) {
    push(
      "edit_rules",
      "policy",
      "제출한 뒤에도 내용을 고칠 수 있나요?",
      "진행 상태가 언급되나 수정·초기화 규칙 없음",
      askOnly("제출한 뒤에 내용을 고칠 수 있는지가 요청서에 적혀 있지 않습니다.", [
        "제출한 뒤에는 고칠 수 없음",
        "제작이 시작되기 전까지만 고칠 수 있음",
        "언제든 고칠 수 있음",
      ]),
    );
  }

  // Privacy
  if (/개인정보|연락처|전화|이메일|주민/.test(prd) && !/마스킹|비공개|권한/.test(prd)) {
    push(
      "privacy",
      "policy",
      "개인정보(연락처 등)는 누구에게 보이게 할까요?",
      "개인정보 언급 — 표시 정책 필요",
      askOnly("개인정보를 누구에게 보여 줄지가 요청서에 적혀 있지 않습니다.", [
        "요청한 사람과 콘텐츠팀에게만 보이기",
        "모두에게 보이되 일부를 가리기",
        "제한 없이 보이기",
      ]),
    );
  }

  // List filters — live code values only become a proposal when the glossary can name them
  if (hasList && !/상태|필터|탭/.test(prd) && (!/codes=\[/.test(liveSummary) || ctx.liveLabels.length > 0)) {
    push(
      "choice_values",
      "data",
      "목록을 어떤 구분으로 나눠 볼까요?",
      "목록성 요구인데 구분·필터 기준이 없음",
      listFilterKit(ctx.liveLabels),
    );
  }

  // Very short PRD
  if (items.length === 0 && prd.replace(/#+\s*확인된\s*결정[\s\S]*$/m, "").trim().length < 400) {
    push(
      "done_when",
      "ambiguity",
      `"${title}"이(가) 잘 됐다고 보려면 무엇이 가능해야 하나요?`,
      "본문이 짧아 완료 기준이 불명확",
      askOnly("무엇이 되면 이 요청이 잘 됐다고 볼지가 요청서에 적혀 있지 않습니다.", [
        "요청을 끝까지 등록할 수 있으면 완료",
        "등록한 요청을 담당 팀이 확인할 수 있으면 완료",
        "완료 기준을 직접 알려 주기",
      ]),
    );
  }

  // Flow present but no common fields detail
  if (hasFlow && hasForm && !/랜딩|지면|타겟|필수/.test(prd) && items.length < 3) {
    pushEvidence(
      "required_optional",
      "ambiguity",
      "단계별로 꼭 넣어야 하는 정보를 어떻게 정할까요?",
      "요청 구조는 있으나 단계별 입력 내용이 빈약",
      requiredKit,
    );
  }

  return items.slice(0, 8);
}

async function liveDbBrief(config: WireframeConfig, assetSlug: string, prd: string): Promise<string> {
  try {
    const project = resolveProject(config, assetSlug);
    const hints = ["content", "growth", "account", "ent"].filter(
      (h) => prd.toLowerCase().includes(h) || /소재|요청|계정|업체|일시정지/.test(prd),
    );
    const tokens = hints.length > 0 ? hints : ["content", "account"];
    const like = tokens
      .flatMap((h) => [`TABLE_NAME LIKE ${quoteSql(`%${h.toUpperCase()}%`)}`])
      .join(" OR ");
    const tables = await runWonjdQuery(
      project,
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (${like}) ORDER BY TABLE_ROWS DESC LIMIT 5`,
    );
    const parts: string[] = [];
    for (const row of tables.rows.slice(0, 3)) {
      const name = String(row[0]);
      parts.push(`table=${name} rows=${row[1]}`);
      try {
        const cols = await runWonjdQuery(
          project,
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${quoteSql(name)} AND COLUMN_NAME REGEXP '_CD$|STATUS|TYPE|METHOD|DIV' LIMIT 8`,
        );
        for (const col of cols.rows) {
          const colName = String(col[0]);
          const codes = await runWonjdQuery(
            project,
            `SELECT ${colName}, COUNT(*) c FROM ${name} WHERE ${colName} IS NOT NULL AND ${colName} <> '' GROUP BY ${colName} ORDER BY c DESC LIMIT 6`,
          );
          if (codes.row_count >= 2 && codes.row_count <= 6) {
            parts.push(
              `${name}.${colName} codes=[${codes.rows.map((r) => String(r[0])).join(",")}]`,
            );
          }
        }
      } catch {
        // skip
      }
    }
    return parts.join("\n");
  } catch (err) {
    return `liveDbError=${err instanceof Error ? err.message : String(err)}`;
  }
}

function appendAnswersToPrd(
  content: string,
  answers: Array<{ question: string; answer: string }>,
): string {
  const block = answers
    .flatMap((entry) => ["", `### Q. ${entry.question}`, "", `A. ${entry.answer}`, ""])
    .join("\n");
  if (/##\s*확인된\s*결정/.test(content)) {
    return `${content.trimEnd()}\n${block}`;
  }
  return `${content.trimEnd()}\n\n## 확인된 결정\n${block}`;
}

/* ------------------------------------------------------------------ *
 * Staged answers (제시 → 승인 → 기록)
 *
 * PRD *content* edits already wait for the user's yes in spec/pending-prd.json.
 * Clarification answers used to be written the moment they arrived — into input/vN.md,
 * clarifications.json and the project decision ledger at once. They are staged here
 * beside pending-prd.json instead: nothing lands until `prd answer-apply`.
 * ------------------------------------------------------------------ */

export type PendingAnswerEntry = {
  /** Open-question id, or the id of the pre-filled decision being overridden. */
  id: string;
  topic: string;
  question: string;
  answer: string;
  /** open = answers an open question, override = replaces a decision adopted from an earlier run. */
  target: "open" | "override";
  kind?: ClarificationKind;
  reason?: string;
  /** Denial kept after the PRD was quoted back — record it as overriding the PRD. */
  overridesPrd?: boolean;
  prdEvidence?: string[];
  /** Accepted the system's proposal verbatim (「제안대로」 included). */
  fromProposal?: boolean;
};

export type PendingAnswersDoc = {
  runId: string;
  entries: PendingAnswerEntry[];
  /** Topics already re-asked once — never challenge the same topic twice. */
  challenged: string[];
  /** Deterministic plain-Korean restatement shown before approval. */
  restatement: string[];
  basedOnVersion: number;
  stagedAt: string;
};

const PENDING_ANSWERS_MAX_BYTES = 256 * 1024;

function pendingAnswersPath(config: WireframeConfig, runId: string): string {
  return path.join(getRunRoot(config, runId), "spec", "pending-answers.json");
}

/** Safe when absent, truncated or hand-edited — a broken stage reads as "nothing staged". */
export async function loadPendingAnswers(
  config: WireframeConfig,
  runId: string,
): Promise<{ doc: PendingAnswersDoc | null; corrupt: boolean }> {
  const file = pendingAnswersPath(config, runId);
  if (!(await pathExists(file))) return { doc: null, corrupt: false };
  let parsed: unknown;
  try {
    const stripped = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
    if (Buffer.byteLength(stripped, "utf8") > PENDING_ANSWERS_MAX_BYTES * 2) {
      return { doc: null, corrupt: true };
    }
    parsed = JSON.parse(stripped);
  } catch {
    return { doc: null, corrupt: true };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { doc: null, corrupt: true };
  }
  const raw = parsed as Partial<PendingAnswersDoc>;
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter(
    (entry): entry is PendingAnswerEntry =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as PendingAnswerEntry).id === "string" &&
      typeof (entry as PendingAnswerEntry).answer === "string" &&
      Boolean((entry as PendingAnswerEntry).answer.trim()),
  );
  if (entries.length === 0) return { doc: null, corrupt: true };
  return {
    doc: {
      runId,
      entries,
      challenged: (Array.isArray(raw.challenged) ? raw.challenged : []).filter(
        (topic): topic is string => typeof topic === "string",
      ),
      restatement: (Array.isArray(raw.restatement) ? raw.restatement : []).filter(
        (line): line is string => typeof line === "string",
      ),
      basedOnVersion: typeof raw.basedOnVersion === "number" ? raw.basedOnVersion : 0,
      stagedAt: typeof raw.stagedAt === "string" ? raw.stagedAt : "",
    },
    corrupt: false,
  };
}

async function savePendingAnswers(
  config: WireframeConfig,
  runId: string,
  doc: PendingAnswersDoc,
): Promise<void> {
  const file = pendingAnswersPath(config, runId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

async function clearPendingAnswers(config: WireframeConfig, runId: string): Promise<boolean> {
  const file = pendingAnswersPath(config, runId);
  if (!(await pathExists(file))) return false;
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** "화면 형태: 모달" — deterministic, no LLM. */
function restatementLine(entry: PendingAnswerEntry): string {
  const suffix = entry.overridesPrd ? " (PRD에 적힌 내용보다 이 답을 우선)" : "";
  return `${topicLabelKo(entry.topic || "other")}: ${entry.answer}${suffix}`;
}

const CONFIRM_QUESTION = "이대로 확정할까요?";

async function setRunStatus(
  config: WireframeConfig,
  projectSlug: string,
  runId: string,
  status: "clarifying" | "ready",
): Promise<void> {
  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (run.status === "confirmed") return;
  run.status = status;
  run.updatedAt = new Date().toISOString();
  await saveIndex(config, index);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasScreenLayoutAnswered(prd: string, covered: Set<string>): boolean {
  if (covered.has("screen_layout")) return true;
  const section = prd.match(/(?:^|\n)#+\s*확인된\s*결정([\s\S]*)$/m)?.[1] ?? "";
  // Only decisions section — PRD title/body mentioning "모달" must not skip the post-ready ask
  return /화면\s*양식|화면\s*형태|모달|팝업|목록\s*표|테이블\s*형태|전체\s*페이지|단계별\s*화면|위자드|단계별로/.test(
    section,
  );
}

/** Stable id — the chat agent must be able to answer this across turns without re-reviewing first. */
const SCREEN_LAYOUT_QID = "q-screen-layout";

function screenLayoutQuestion(): ClarificationItem {
  return {
    id: SCREEN_LAYOUT_QID,
    kind: "scope",
    topic: "screen_layout",
    question:
      "PRD가 확정됐습니다. 화면은 어떤 형태로 보여 주면 될까요? (예: 전체 페이지 입력폼 / 팝업·모달 / 목록 표 / 단계별로 넘어가는 화면). 섞여 있으면 단계마다 적어 주세요.",
    reason: "애매한 업무 결정 확정·승인 후에만 화면 양식을 묻는다",
    situation: "요청서가 확정됐습니다. 이제 화면을 어떤 형태로 보여 줄지만 정하면 됩니다.",
    options: ["전체 페이지 입력폼", "팝업·모달", "목록 표", "단계별로 넘어가는 화면"],
    needsUser: true,
  };
}

/* ------------------------------------------------------------------ *
 * PRD 확정(ready)도 승인이 필요하다
 *
 * The last business answer used to flip the run to ready on its own. What the request
 * now says is restated in plain Korean and confirmed like every other decision: the
 * confirmation is just one more question, so it goes through the same staging gate.
 * ------------------------------------------------------------------ */

const PRD_CONFIRM_QID = "q-prd-ready";

/** Body only — applied answers append to 확인된 결정, and that must not re-open the approval. */
function prdBodyHash(prd: string): string {
  const body = prd.replace(/(?:^|\n)#+\s*확인된\s*결정[\s\S]*$/m, "");
  return crypto.createHash("sha1").update(body.replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/** Newest answer per topic, in business Korean — the recap the user approves. */
function decisionRecap(resolved: ResolvedClarification[]): string[] {
  const byTopic = new Map<string, string>();
  for (const item of resolved) {
    const topic = item.topic || "other";
    if (topic === "prd_ready" || !item.answer?.trim()) continue;
    byTopic.set(topic, item.answer.trim());
  }
  return [...byTopic].map(([topic, answer]) => `${topicLabelKo(topic)}: ${answer}`);
}

function prdConfirmQuestion(resolved: ResolvedClarification[]): ClarificationItem {
  const recap = decisionRecap(resolved);
  const situation =
    recap.length > 0
      ? `지금까지 이렇게 정했습니다.\n${recap.map((line) => `  · ${line}`).join("\n")}`
      : "따로 정해야 할 애매한 부분은 남아 있지 않습니다.";
  return {
    id: PRD_CONFIRM_QID,
    kind: "policy",
    topic: "prd_ready",
    question: "요청서를 이대로 확정할까요?",
    reason: "마지막 업무 질문이 끝났지만 확정은 사용자 승인 뒤에만 한다",
    situation,
    options: ["네, 이대로 확정합니다", "아니요, 더 고칠 부분이 있어요"],
    needsUser: true,
  };
}

/** 네/이대로/확정 — deterministic, mirrors the chat's approval wording. */
function isAffirmativeAnswer(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/아니|아뇨|취소|고칠|고쳐|수정|더\s*볼|아직|잠깐/.test(value)) return false;
  return (
    /^(네|넵|예|응|그래|오케이|ok|okay|yes|좋)/i.test(value) ||
    /이대로|확정(합|해|할|하)|그대로\s*(가|해|진행)|맞습니다|맞아요/.test(value)
  );
}

/* ------------------------------------------------------------------ *
 * 「제안대로」 — bulk accept
 *
 * The reference email thread answered several questions at once ("1번 → 제안대로 ①,
 * 5번은 ②, 나머지 제안대로"). Parsing is a regex over the user's own text — no LLM —
 * and what gets stored is the proposal's text, never the phrase. Questions with
 * 제안 없음 are never covered: they come back so the agent asks them one by one.
 * ------------------------------------------------------------------ */

const BULK_PHRASE = /제안\s*대로/;

export type BulkAcceptance = {
  /** The user actually used the phrase (or a per-number 제안대로). */
  matched: boolean;
  accepted: Array<{ item: ClarificationItem; answer: string; via: "proposal" | "option" }>;
  /** 제안 없음 — must be asked separately. */
  needsUser: ClarificationItem[];
  /** "3번 빼고" — deliberately left open. */
  excluded: ClarificationItem[];
};

/** ① … ⑩ or a bare digit that follows a question number. */
function optionIndexFromClause(clause: string): number | null {
  const circled = clause.match(/[①-⑩]/)?.[0];
  if (circled) return OPTION_KEYS.indexOf(circled) + 1;
  const plain = clause.match(/\d+\s*번(?:은|는|만|:|：)?\s*(\d+)\s*번?/);
  if (plain?.[1]) return Number(plain[1]);
  return null;
}

export function parseBulkAcceptance(text: string, open: ClarificationItem[]): BulkAcceptance {
  const empty: BulkAcceptance = { matched: false, accepted: [], needsUser: [], excluded: [] };
  const value = (text ?? "").trim();
  if (!value) return empty;

  const clauses = value
    .split(/[\n,，、;；]|\s+그리고\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const byNo = new Map<number, ClarificationItem>();
  open.forEach((item, index) => byNo.set(item.no ?? index + 1, item));

  const excludedNos = new Set<number>();
  const explicit = new Map<number, number>();
  let acceptRest = false;
  let anyBulk = false;

  for (const clause of clauses) {
    const numbers = [...clause.matchAll(/(\d+)\s*번/g)].map((match) => Number(match[1]));
    const hasBulk = BULK_PHRASE.test(clause);
    if (hasBulk) anyBulk = true;
    if (/빼고|제외|말고|빼\s*줘|빼주/.test(clause)) {
      for (const no of numbers) excludedNos.add(no);
      // "3번 빼고 제안대로" is one clause: the exclusion AND the bulk accept for the rest.
      if (hasBulk) acceptRest = true;
      continue;
    }
    const optionNo = numbers.length > 0 ? optionIndexFromClause(clause) : null;
    if (numbers.length > 0 && optionNo) {
      for (const no of numbers) explicit.set(no, optionNo);
      continue;
    }
    if (hasBulk && numbers.length > 0) {
      for (const no of numbers) explicit.set(no, 0); // 0 = 그 번호는 제안대로
      continue;
    }
    if (hasBulk) acceptRest = true;
  }

  // Numbered choices stand on their own. Requiring the 제안대로 phrase meant "1번은 ①, 2번은 ①"
  // was dropped entirely — which is exactly how a user answers the 제안 없음 questions left over
  // after a bulk accept, since those are the ones bulk accept never covers.
  if (!anyBulk && explicit.size === 0) return empty;

  const result: BulkAcceptance = { matched: true, accepted: [], needsUser: [], excluded: [] };
  for (const [no, item] of byNo) {
    if (excludedNos.has(no)) {
      result.excluded.push(item);
      continue;
    }
    const chosen = explicit.get(no);
    if (chosen && chosen > 0) {
      const answer = item.options?.[chosen - 1];
      if (answer) {
        result.accepted.push({ item, answer, via: "option" });
        continue;
      }
    }
    if (!item.proposal) {
      // Never bulk-accept a question the system has no evidence for.
      if (chosen !== undefined || acceptRest) result.needsUser.push(item);
      continue;
    }
    if (chosen !== undefined || acceptRest) {
      result.accepted.push({ item, answer: item.proposal.answer, via: "proposal" });
    }
  }
  return result;
}

export async function reviewPrdClarificationsCli(
  config: WireframeConfig,
  args: string[],
): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) throw new Error("usage: wireframe prd review --run-id slug [--project crm]");
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const assetSlug = readFlag(args, "--asset-project")?.trim() ?? projectSlug;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const prdPath = path.join(getRunRoot(config, runId), "input", `v${run.prdVersion}.md`);
  const prdContent = await readFile(prdPath, "utf8");
  const prev = await loadClarificationsDoc(config, runId);
  const live = await liveDbBrief(config, assetSlug, prdContent);
  const covered = resolvedTopicsFromPrd(prdContent, prev.resolved);
  // Only what somebody decided closes an evidence topic; PRD body text feeds the proposal.
  const decided = resolvedTopicsFromPrd(prdContent, prev.resolved, "decided");

  // Sync this run's own answers into the project ledger (memory across requests).
  // Prefilled entries keep their original run's provenance and are not re-recorded.
  // The PRD-confirmation answer is this run's approval, never a decision to reuse elsewhere.
  await recordDecisions(
    projectSlug,
    prev.resolved
      .filter((item) => !item.prefilledFrom && item.topic !== "prd_ready")
      .map((item) => ({
        topic: item.topic || "other",
        question: item.question,
        answer: item.answer,
        byRun: runId,
        byRunNo: run.no,
      })),
  );

  // 감지는 자동, 판단은 사람: a topic already decided in an earlier request is not asked again —
  // it is adopted as a pre-filled decision AND announced to the user, never silently.
  const ledger = await loadDecisionLedger(projectSlug);
  const current = currentLedgerAnswers(ledger);

  // Earlier requests are a proposal source for anything the ledger does NOT pre-fill.
  const ledgerProposals = new Map<string, { answer: string; source: string }>();
  for (const [topic, hit] of current) {
    if (topic === "prd_ready" || !hit.answer.trim() || hit.byRun === runId) continue;
    ledgerProposals.set(topic, { answer: hit.answer.trim(), source: hit.byRunNo || hit.byRun });
  }

  const businessOpen = heuristicQuestions({
    prd: prdContent,
    title: run.title,
    liveSummary: live,
    covered,
    decided,
    liveLabels: liveChoiceLabels(live, await loadGlossaryCodes(assetSlug)),
    ledger: ledgerProposals,
  }).filter((item) => {
    // Never ask layout during ambiguity loop
    if (item.topic === "screen_layout") return false;
    return true;
  });
  const prefilled: ClarificationsDoc["resolved"] = [];
  const ledgerNotices: string[] = [];
  const prefillFromLedger = (item: ClarificationItem): boolean => {
    if (item.topic === "other") return false;
    const hit = current.get(item.topic);
    if (!hit || !hit.answer.trim() || hit.byRun === runId) return false;
    const source = hit.byRunNo || hit.byRun;
    prefilled.push({
      ...item,
      answer: hit.answer,
      resolvedAt: new Date().toISOString(),
      prefilledFrom: source,
    });
    ledgerNotices.push(prefillNotice(item.topic, hit.answer, source));
    return true;
  };

  // An answer that denies what the PRD spells out is re-asked ONCE, quoting the PRD's own
  // words. Until it is confirmed the topic stays open — it must not be silently accepted.
  const contradictions = prdContradictions(prdContent, prev.resolved);
  const contradictedTopics = new Set(contradictions.map((item) => item.topic));
  // A denial the user is being asked to reconsider is never auto-accepted by 「제안대로」.
  const rechecks: ClarificationItem[] = contradictions.map((item) => ({
    id: `q-recheck-${item.topic}`,
    kind: "ambiguity",
    topic: item.topic,
    question: item.question,
    reason: `PRD에 근거가 있는데 답변이 이를 부정함 — 1회만 재확인`,
    evidence: item.evidence,
    situation: `앞서 「${item.answer}」라고 답하셨는데, 요청서에는 ${quoteJoin(item.evidence)}처럼 적혀 있습니다.`,
    options: [`요청서에 적힌 ${item.evidence.length}가지를 반영하기`, `앞서 답한 대로 두기`],
    basis: prdBasis(item.evidence),
    needsUser: true,
  }));

  let open: ClarificationItem[] = [
    ...rechecks,
    ...businessOpen.filter(
      (item) => !contradictedTopics.has(item.topic) && !prefillFromLedger(item),
    ),
  ];
  let status: ClarificationsDoc["status"] = "clarifying";
  let phase: "clarify" | "layout" | "ready" = "clarify";

  // 확정(ready)은 사용자가 승인해야 한다. The last business answer presents what the request
  // now says and asks 「요청서를 이대로 확정할까요?」 — nothing becomes ready on its own.
  const bodyHash = prdBodyHash(prdContent);
  const prdApproved = prev.prdConfirm?.bodyHash === bodyHash;
  let awaitingPrdConfirm = false;

  if (open.length === 0 && !prdApproved) {
    open = [prdConfirmQuestion(prev.resolved)];
    awaitingPrdConfirm = true;
  }

  if (open.length === 0) {
    status = "ready";
    // PRD approved (ready) — only then ask screen form if missing
    if (!hasScreenLayoutAnswered(prdContent, covered)) {
      const layout = screenLayoutQuestion();
      if (prefillFromLedger(layout)) {
        phase = "ready";
      } else {
        open = [layout];
        phase = "layout";
      }
    } else {
      open = [];
      phase = "ready";
    }
  }

  open = numberQuestions(open);

  // Persist adopted decisions into the PRD's 확인된 결정 section (marked with their source) so the
  // build pipeline sees them exactly as if they had been answered here.
  if (prefilled.length > 0) {
    const merged = appendAnswersToPrd(
      prdContent,
      prefilled.map((item) => ({
        question: item.question,
        answer: `${item.answer} — 이전 요청(${item.prefilledFrom}) 결정 반영`,
      })),
    );
    await writeFile(prdPath, `${merged.trimEnd()}\n`, "utf8");
  }

  const collisions = await detectScreenCollisions(config, runId);
  const staged = await loadPendingAnswers(config, runId);

  const doc: ClarificationsDoc = {
    status,
    phase,
    open,
    resolved: [...prev.resolved, ...prefilled],
    rounds: prev.rounds + 1,
    updatedAt: new Date().toISOString(),
    channel: "chat",
    ...(prev.prdConfirm ? { prdConfirm: prev.prdConfirm } : {}),
    audience: "non_developer",
  };
  await saveClarificationsDoc(config, runId, doc);
  await setRunStatus(config, projectSlug, runId, status);

  const proposalCount = open.filter((item) => item.proposal).length;
  const message = awaitingPrdConfirm
    ? "업무 질문이 끝났습니다. 정해진 내용을 전하고 「요청서를 이대로 확정할까요?」를 물으세요. 승인 전에는 확정하지 않습니다."
    : phase === "clarify"
      ? `보완 질문 ${open.length}건(제안 있음 ${proposalCount}건) — 채팅에서 확정하고 답변을 반영.`
      : phase === "layout"
        ? "PRD 승인(ready)됨. 화면 형태만 정해 주세요. (양식 확정 후 와이어프레임 생성)"
        : "보완·화면 양식 확정 완료 — 와이어프레임 빌드 가능.";

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        status: doc.status,
        phase,
        audience: "non_developer",
        channel: "chat",
        open,
        /** 사용자에게 그대로 읽어 줄 문구 — 번호·상황·선택지·제안·근거가 모두 들어 있음. */
        prompts: open.map((item) => item.prompt ?? item.question),
        awaitingPrdConfirm,
        proposalCount,
        needsUserNos: open.filter((item) => item.needsUser).map((item) => item.no),
        resolvedCount: doc.resolved.length,
        ledgerNotices,
        collisions,
        contradictions,
        pendingAnswers: Boolean(staged.doc),
        pendingRestatement: staged.doc?.restatement ?? [],
        liveDbBrief: live.slice(0, 2000),
        chat_instructions: [
          "이 루프의 목적은 개발 명세가 아니라 PRD 확정·보완입니다.",
          "prompts를 번호와 함께 그대로 읽어 주세요. 상황·선택지·제안·근거를 임의로 바꾸거나 요약하지 마세요.",
          "제안이 붙은 질문은 사용자가 「제안대로」 한마디로 한꺼번에 답할 수 있다고 알려 주세요. (예: 「제안대로」, 「3번 빼고 제안대로」, 「5번은 ②, 나머지 제안대로」)",
          "needsUserNos의 번호는 제안이 없는 질문입니다. 「제안대로」에 포함되지 않으니 따로 물어 답을 받으세요.",
          "제안·근거에 없는 내용을 지어내지 마세요. 근거가 없으면 「제안 없음 — 확인이 필요합니다」 그대로 전하세요.",
          "awaitingPrdConfirm=true면 업무 질문이 끝난 상태입니다. 정해진 내용을 전하고 「요청서를 이대로 확정할까요?」를 물으세요. 승인 답도 prd_answer로 넣고 승인 뒤에만 확정됩니다.",
          "open 질문을 업무 말로 채팅에서 물어 부족한 결정을 채우세요.",
          "테이블·컬럼·코드값·API·경로 등 개발 개념은 사용자에게 말하지 마세요.",
          "reason·liveDbBrief는 내부용입니다. 필요하면 ‘업무 흐름을 정하려고요’ 정도만.",
          "답 → prd_answer로 제시 → 사용자가 승인해야 기록 → 재질문.",
          "contradictions가 있으면 그 question을 그대로 물으세요. PRD에 적힌 내용을 답변이 부정하고 있습니다. 같은 주제를 두 번 넘게 되묻지 마세요.",
          "pendingAnswers=true면 아직 확정되지 않은 답이 있습니다. pendingRestatement를 전하고 「이대로 확정할까요?」를 물으세요.",
          "화면 형태(모달/표/페이지 등)는 애매한 부분이 다 확정되고 PRD가 ready인 뒤에만 묻습니다.",
          "phase=layout이면 PRD는 이미 승인된 상태입니다. 화면 형태만 묻고 빌드는 양식 답 뒤에 하세요.",
          "phase=ready일 때만 와이어프레임 빌드를 시작하세요.",
          "ledgerNotices가 있으면 그 문구를 한 번만 사용자에게 그대로 전하세요. 자동 반영을 숨기지 말고, 사용자가 다르다고 하면 prd_answer로 새 답을 받으세요.",
          "collisions가 있으면 다른 요청의 제목만 들어 알리고 「합칠지 따로 갈지」를 질문하세요. route·경로·id·테이블은 절대 언급 금지. 임의로 결정하지 마세요.",
        ],
        message,
      },
      null,
      2,
    ),
  );
}

export async function answerPrdClarificationsCli(
  config: WireframeConfig,
  args: string[],
): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  const answersRaw = readFlag(args, "--answers")?.trim();
  // 「제안대로」 — the user's own words, parsed by regex here and never sent to a model.
  const bulkText = readFlag(args, "--bulk-text")?.trim();
  if (!runId || (!answersRaw && !bulkText)) {
    throw new Error(
      'usage: wireframe prd answer --run-id slug (--answers \'[{"id":"q1","answer":"..."}]\' | --bulk-text "제안대로") [--project crm]',
    );
  }
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const parsedAnswers = (
    answersRaw
      ? (JSON.parse(answersRaw) as Array<{ id?: string; topic?: string; answer: string }>)
      : []
  ).map((entry) => ({
    id: String(entry.id ?? "").trim(),
    topic: String(entry.topic ?? "").trim(),
    answer: String(entry.answer ?? "").trim(),
  }));
  // 「제안대로」 itself is never stored as an answer — the proposal's own wording is.
  // An answer that carries the phrase is treated as the bulk instruction it actually is.
  const bulkSource =
    bulkText ?? parsedAnswers.map((entry) => entry.answer).find((text) => BULK_PHRASE.test(text));
  const answers = parsedAnswers.filter(
    (entry) => entry.answer && !BULK_PHRASE.test(entry.answer),
  );

  const prev = await loadClarificationsDoc(config, runId);
  // Pre-filled decisions (adopted from an earlier run) are not open questions, but the user may
  // contradict one — that must overwrite the run's answer and append a new ledger entry.
  const overridable = prev.resolved.filter((item) => item.prefilledFrom);
  if (prev.open.length === 0 && overridable.length === 0) {
    throw new Error("no open questions to answer");
  }

  // Match by id, then by topic, then positionally. Question ids live only inside a previous
  // request's tool output, so an id-exact-match-only rule strands every answer the chat agent
  // sends on a later turn.
  const pending = [...prev.open];
  const resolvedFor = new Map<string, string>();
  const takeBy = (predicate: (item: ClarificationItem) => boolean): ClarificationItem | undefined => {
    const index = pending.findIndex((item) => !resolvedFor.has(item.id) && predicate(item));
    return index === -1 ? undefined : pending[index];
  };

  // 「제안대로」 first: proposals fill in, explicit --answers still take the questions they name.
  const bulk = bulkSource ? parseBulkAcceptance(bulkSource, prev.open) : null;
  for (const hit of bulk?.accepted ?? []) {
    resolvedFor.set(hit.item.id, hit.answer);
  }

  const overrides = new Map<string, string>();
  for (const entry of answers) {
    const hit =
      (entry.id ? takeBy((item) => item.id === entry.id) : undefined) ??
      (entry.topic ? takeBy((item) => item.topic === entry.topic) : undefined) ??
      (entry.id && /layout|화면|모달|팝업|페이지|단계|표/i.test(entry.id)
        ? takeBy((item) => item.topic === "screen_layout")
        : undefined) ??
      (answers.length === 1 && pending.length === 1 ? takeBy(() => true) : undefined) ??
      takeBy(() => true);
    if (hit) {
      resolvedFor.set(hit.id, entry.answer);
      continue;
    }
    // No open question left — try a pre-filled decision (id → topic → layout wording).
    const target =
      (entry.id ? overridable.find((item) => item.id === entry.id) : undefined) ??
      (entry.topic ? overridable.find((item) => item.topic === entry.topic) : undefined) ??
      (/모달|팝업|목록|표|페이지|단계|위자드|폼/.test(entry.answer)
        ? overridable.find((item) => item.topic === "screen_layout")
        : undefined);
    if (target && !overrides.has(target.id)) overrides.set(target.id, entry.answer);
  }

  const staged: PendingAnswerEntry[] = [];
  for (const item of prev.open) {
    const answer = resolvedFor.get(item.id);
    if (!answer) continue;
    staged.push({
      id: item.id,
      topic: item.topic || "other",
      question: item.question,
      answer,
      target: "open",
      kind: item.kind,
      reason: item.reason,
      ...(item.proposal?.answer === answer ? { fromProposal: true } : {}),
    });
  }
  for (const item of prev.resolved) {
    const answer = overrides.get(item.id);
    if (!answer) continue;
    staged.push({
      id: item.id,
      topic: item.topic || "other",
      question: item.question,
      answer,
      target: "override",
      kind: item.kind,
      reason: item.reason,
    });
  }

  const bulkOutcome = bulk
    ? {
        bulkAccepted: bulk.accepted.map((hit) => ({
          no: hit.item.no,
          topic: hit.item.topic,
          answer: hit.answer,
          via: hit.via,
        })),
        // 근거가 없는 질문은 「제안대로」로 덮이지 않는다 — 그대로 다시 물어야 한다.
        needsUser: [...bulk.needsUser, ...bulk.excluded].map((item) => ({
          no: item.no,
          topic: item.topic,
          question: item.question,
          prompt: item.prompt ?? item.question,
          reason: bulk.excluded.includes(item) ? "사용자가 제외함" : "제안 없음",
        })),
      }
    : null;

  if (staged.length === 0) {
    if (bulk?.matched) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            runId,
            staged: false,
            saved: false,
            ...bulkOutcome,
            message:
              "「제안대로」로 확정할 수 있는 질문이 없습니다. 아래 질문은 근거가 없어 직접 답을 받아야 합니다.",
          },
          null,
          2,
        ),
      );
      return;
    }
    throw new Error("no matching answers for open questions");
  }

  // 모호한 점 → 답변 → "이렇게 확정하겠습니다" → 승인 → 기록.
  // Nothing below writes input/vN.md, clarifications.json or the decision ledger.
  const prdPath = path.join(getRunRoot(config, runId), "input", `v${run.prdVersion}.md`);
  const prdContent = await readFile(prdPath, "utf8");
  const before = await loadPendingAnswers(config, runId);
  const challengedTopics = new Set<string>(before.doc?.challenged ?? []);
  const challenges: PrdContradiction[] = [];

  for (const entry of staged) {
    // The system's own proposal was read out of the PRD, so it can never contradict it —
    // and a proposal that quotes an option called "없음" must not read as a denial.
    if (entry.fromProposal) continue;
    if (!isNegativeOrSkipAnswer(entry.answer)) continue;
    const evidence = prdEvidenceFor(prdContent, entry.topic);
    if (evidence.length === 0) continue;
    entry.prdEvidence = evidence;
    // Second denial on the same topic (re-ask answered, or a denial already recorded):
    // accept it and mark that it overrides the PRD. Never challenge the same topic twice.
    const askedBefore =
      challengedTopics.has(entry.topic) ||
      entry.id.startsWith("q-recheck-") ||
      prev.resolved.some(
        (item) => (item.topic || "other") === entry.topic && isNegativeOrSkipAnswer(item.answer),
      );
    if (askedBefore) {
      entry.overridesPrd = true;
      continue;
    }
    challengedTopics.add(entry.topic);
    challenges.push({
      topic: entry.topic as ClarificationTopic,
      answer: entry.answer,
      evidence,
      question: contradictionQuestion(entry.topic, entry.answer, evidence),
    });
  }

  // Further edits re-stage on top of the draft instead of discarding it.
  const kept = (before.doc?.entries ?? []).filter(
    (entry) => !staged.some((next) => next.id === entry.id && next.target === entry.target),
  );
  const entries = [...kept, ...staged];
  const restatement = entries.map(restatementLine);

  await savePendingAnswers(config, runId, {
    runId,
    entries,
    challenged: [...challengedTopics],
    restatement,
    basedOnVersion: run.prdVersion,
    stagedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        staged: true,
        saved: false,
        restacked: Boolean(before.doc),
        restatement,
        restatementText: restatement.join(" / "),
        confirmQuestion: CONFIRM_QUESTION,
        challenges,
        open: prev.open,
        ...(bulkOutcome ?? {}),
        message:
          challenges.length > 0
            ? "아직 기록하지 않았습니다. challenges의 question을 그대로 물어 확인부터 받으세요."
            : bulkOutcome && bulkOutcome.needsUser.length > 0
              ? `「제안대로」 처리했습니다 — ${bulkOutcome.bulkAccepted.length}건 확정 대기. needsUser 중 「제안 없음」인 ${
                  bulkOutcome.needsUser.filter((item) => item.reason === "제안 없음").length
                }건은 근거가 없어 사용자가 직접 답해야 합니다. restatement를 전하고 「이대로 확정할까요?」를 물은 뒤, 그 질문들을 이어서 물으세요.`
              : "아직 기록하지 않았습니다. restatement를 그대로 전한 뒤 「이대로 확정할까요?」를 묻고 멈추세요.",
        chat_instructions: [
          "이 답변은 보관만 됐습니다. 승인 전에는 요청서에 반영되지 않습니다.",
          "restatement를 업무 말로 그대로 전하고 「이대로 확정할까요?」라고 물으세요.",
          "needsUser가 있으면 「아래 N건은 근거가 없어 직접 답해 주셔야 합니다」라고 알리고 그 prompt를 그대로 물으세요.",
          "승인(네/좋아요/저장해 주세요)하면 prd_apply, 취소(아니요/취소)면 prd_discard, 다르게 고치면 prd_answer를 다시 부르세요.",
          "challenges가 있으면 그 question을 그대로 물으세요. 사용자가 같은 답을 유지하면 그 답을 그대로 다시 prd_answer 하세요 — PRD보다 우선한다고 기록됩니다.",
          "파일·경로·도구 이름은 사용자에게 말하지 마세요.",
        ],
      },
      null,
      2,
    ),
  );
}

/** 승인됨 — staged answers are written for real: PRD, clarifications, ledger. */
export async function applyPrdAnswersCli(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) throw new Error("usage: wireframe prd answer-apply --run-id slug [--project crm]");
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const { doc: stage, corrupt } = await loadPendingAnswers(config, runId);
  if (!stage) {
    await clearPendingAnswers(config, runId);
    console.log(
      JSON.stringify(
        {
          ok: false,
          runId,
          corrupt,
          error: "확정 대기 중인 답변이 없습니다. 먼저 답을 받아 제시해 주세요.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const prev = await loadClarificationsDoc(config, runId);
  const prdPath = path.join(getRunRoot(config, runId), "input", `v${run.prdVersion}.md`);
  const prdContent = await readFile(prdPath, "utf8");
  const now = new Date().toISOString();

  const openEntries = stage.entries.filter((entry) => entry.target === "open");
  const overrideEntries = stage.entries.filter((entry) => entry.target === "override");
  const answeredIds = new Set(openEntries.map((entry) => entry.id));
  const answeredTopics = new Set(openEntries.map((entry) => entry.topic));

  const newlyResolved: ResolvedClarification[] = openEntries.map((entry) => {
    const source = prev.open.find((item) => item.id === entry.id);
    // Reaching approval means the user saw the PRD's own words and kept the denial.
    const overridesPrd = Boolean(entry.overridesPrd || (entry.prdEvidence?.length && isNegativeOrSkipAnswer(entry.answer)));
    return {
      id: entry.id,
      kind: source?.kind ?? entry.kind ?? "ambiguity",
      topic: (source?.topic ?? entry.topic ?? "other") as ClarificationTopic,
      question: source?.question ?? entry.question,
      reason: source?.reason ?? entry.reason ?? "채팅에서 확정된 답",
      answer: entry.answer,
      resolvedAt: now,
      ...(entry.fromProposal ? { fromProposal: true } : {}),
      ...(overridesPrd ? { overridesPrd: true, prdEvidence: entry.prdEvidence ?? [] } : {}),
    };
  });

  // Apply overrides of pre-filled decisions: the user's word wins over the adopted answer.
  const overridden: ResolvedClarification[] = [];
  const keptResolved = prev.resolved.map((item) => {
    const entry = overrideEntries.find((candidate) => candidate.id === item.id);
    if (!entry) return item;
    const updated: ResolvedClarification = { ...item, answer: entry.answer, resolvedAt: now };
    delete updated.prefilledFrom;
    if (entry.overridesPrd) {
      updated.overridesPrd = true;
      updated.prdEvidence = entry.prdEvidence ?? [];
    }
    overridden.push(updated);
    return updated;
  });

  const unanswered = prev.open.filter(
    (item) => !answeredIds.has(item.id) && !answeredTopics.has(item.topic),
  );

  const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let merged = prdContent;
  // Replace the marked prefill answer line in place — the stale adopted answer must not linger
  // next to the user's correction (the build parser reads the whole 확인된 결정 section).
  for (const item of overridden) {
    const block = new RegExp(
      `(###\\s*Q\\.\\s*${escapeRe(item.question)}\\s*\\n\\s*\\n?A\\.\\s*)[^\\n]*`,
    );
    merged = block.test(merged)
      ? merged.replace(block, `$1${item.answer}`)
      : appendAnswersToPrd(merged, [{ question: item.question, answer: item.answer }]);
  }
  // 「요청서를 이대로 확정할까요?」에 대한 답은 요청서의 결정이 아니라 승인 자체다.
  const confirmAnswer = newlyResolved.find((item) => item.topic === "prd_ready");
  const prdConfirmed = Boolean(confirmAnswer && isAffirmativeAnswer(confirmAnswer.answer));
  const decisionAnswers = newlyResolved.filter((item) => item.topic !== "prd_ready");
  if (decisionAnswers.length > 0) {
    merged = appendAnswersToPrd(
      merged,
      decisionAnswers.map((item) => ({
        question: item.question,
        // Keep the conflict visible in the document the build reads.
        answer: item.overridesPrd
          ? `${item.answer} — PRD에 적힌 내용보다 이 답을 우선(사용자 재확인)`
          : item.answer,
      })),
    );
  }
  await writeFile(prdPath, `${merged.trimEnd()}\n`, "utf8");

  const prdConfirm = prdConfirmed
    ? { bodyHash: prdBodyHash(merged), confirmedAt: now }
    : prev.prdConfirm;

  await saveClarificationsDoc(config, runId, {
    status: "clarifying",
    phase: "clarify",
    open: unanswered,
    resolved: [...keptResolved, ...newlyResolved],
    rounds: prev.rounds,
    updatedAt: now,
    channel: "chat",
    ...(prdConfirm ? { prdConfirm } : {}),
    audience: "non_developer",
  });

  // Grow the project memory: only approved answers become ledger entries.
  // The PRD approval is this run's gate, not a decision other requests can inherit.
  await recordDecisions(
    projectSlug,
    [...newlyResolved, ...overridden]
      .filter((item) => item.topic !== "prd_ready")
      .map((item) => ({
      topic: item.topic || "other",
      question: item.question,
      answer: item.answer,
      byRun: runId,
      byRunNo: run.no,
    })),
  );
  await clearPendingAnswers(config, runId);
  await setRunStatus(config, projectSlug, runId, "clarifying");

  // Re-review
  await reviewPrdClarificationsCli(config, ["--run-id", runId, "--project", projectSlug]);
}

/** 취소됨 — drop the staged answers, leave the PRD and clarifications untouched. */
export async function discardPrdAnswersCli(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) throw new Error("usage: wireframe prd answer-discard --run-id slug [--project crm]");
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  if (!project.runs.some((entry) => entry.runId === runId)) {
    throw new Error(`run not found: ${runId}`);
  }

  const discarded = await clearPendingAnswers(config, runId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        staged: false,
        discarded,
        message: "확정 대기 중이던 답을 버렸습니다. 요청서는 그대로입니다.",
      },
      null,
      2,
    ),
  );
}
