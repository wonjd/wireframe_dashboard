import { readFile, writeFile, mkdir, access, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { WireframeConfig } from "../lib/config.js";
import { resolveProject } from "../lib/config.js";
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
  | "other";

export type ClarificationItem = {
  id: string;
  kind: ClarificationKind;
  topic: ClarificationTopic;
  question: string;
  /** Internal: why we ask — may mention assets; chat must NOT dump this raw to non-devs. */
  reason: string;
  /** PRD's own words behind a re-ask (see prdEvidenceFor) — safe to show, business language. */
  evidence?: string[];
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
    if (item.overridesPrd || !isNegativeOrSkipAnswer(item.answer)) {
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

/** Topics already covered by ## 확인된 결정 or prior answers */
function resolvedTopicsFromPrd(prd: string, resolved: ClarificationsDoc["resolved"]): Set<string> {
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
  const full = `${prd}\n${blob}`;

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
function heuristicQuestions(
  prd: string,
  title: string,
  liveSummary: string,
  covered: Set<string>,
): ClarificationItem[] {
  const items: ClarificationItem[] = [];
  const push = (
    topic: ClarificationTopic,
    kind: ClarificationKind,
    question: string,
    reason: string,
  ) => {
    if (covered.has(topic)) return;
    if (items.some((item) => item.topic === topic)) return;
    items.push({
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      topic,
      question,
      reason,
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
  const hasDecisions = /##\s*확인된\s*결정/.test(prd);

  // Who uses / approves
  if (!/권한|역할|담당|승인|영업|콘텐츠\s*팀|요청자/.test(prd)) {
    push(
      "who_does",
      "policy",
      "이 요청·화면은 누가 작성하고, 누가 확인·승인하나요? (예: 영업 / 콘텐츠팀 / 둘 다)",
      "담당·승인 주체가 없으면 버튼·권한 흐름을 그릴 수 없음",
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
      "지금 쓰는 화면을 고치는 건가요, 새 화면을 만드는 건가요? 알고 있는 메뉴 이름이 있으면 알려 주세요.",
      "기존 수정 vs 신규에 따라 라우트·셸 배치가 갈림",
    );
  }

  // screen_layout is NOT asked here — only after PRD ready (see reviewPrdClarificationsCli)

  // Required vs optional on form-like PRDs
  if (hasForm && !/필수|선택\s*항목|미기입\s*시/.test(prd)) {
    push(
      "required_optional",
      "ambiguity",
      "꼭 채워야 하는 항목과, 비워도 되는 항목을 나눠 주세요.",
      "폼성 PRD인데 필수/선택 구분이 없음",
    );
  }

  // Choice lists without actual values — skip if PRD already lists labels (이미지/영상 등)
  if (
    mentionsChoice &&
    !hasChoiceLabelsInText(prd) &&
    !/드롭다운|선택\s*목록|선택지\s*[:=]|옵션\s*[:=]|예\s*[:：]/.test(prd) &&
    !hasDecisions
  ) {
    push(
      "choice_values",
      "data",
      "선택해서 고르는 항목이 있으면, 화면에 보일 선택지 문구를 적어 주세요. (예: 이미지/영상, 또는 지면 목록)",
      "선택형은 있는데 실제 선택지 문구가 없음",
    );
  }

  // Dropdown mentioned but no value list after decisions saying "드롭다운"
  if (
    /드롭다운/.test(prd) &&
    /확인된\s*결정/.test(prd) &&
    !hasChoiceLabelsInText(prd) &&
    !/선택지|목록\s*값|예\s*[:：].{0,40}\//.test(prd)
  ) {
    push(
      "choice_values",
      "data",
      "드롭다운으로 하기로 한 항목들의 실제 선택지(화면에 보이는 이름)를 정해주세요. 목록에 없는 값은 ‘기타(직접 입력)’을 허용할까요?",
      "드롭다운 확정인데 선택지 목록이 비어 있음",
    );
  }

  // Conditional fields — skip if PRD already maps 이미지→가이드 fields or says none
  if (
    mentionsConditional &&
    !/이미지.{0,40}가이드|영상.{0,40}대본|노출\s*항목|조건부.{0,12}없|선택값에\s*따라.{0,24}없/.test(prd)
  ) {
    push(
      "conditional_fields",
      "ambiguity",
      "앞 단계에서 고른 값에 따라 나중에 달라지는 입력칸이 있나요? 있다면 ‘무엇을 고르면 → 어떤 칸이 나오는지’를 알려 주세요.",
      "조건부 언급은 있으나 조합→필드 매핑이 약함",
    );
  }

  // Attach / reference method
  if (mentionsAttach && !/링크\s*첨부|파일\s*첨부|웍스|없음/.test(prd)) {
    push(
      "attach_method",
      "data",
      "참고 자료는 어떻게 넘기나요? (링크 / 파일 첨부 / 메신저·웍스방 전달 / 없음 중 무엇이며, 각각 꼭 채울 칸이 있나요?)",
      "첨부·레퍼런스 언급은 있으나 전달 방식 미확정",
    );
  }

  // Limits
  if ((/리스트|복수|여러\s*개|추가\s*소구|대본|카피/.test(prd) || mentionsLimit) && !/\d+\s*자|최대\s*\d+|항목\s*수/.test(prd)) {
    push(
      "limits",
      "data",
      "글자 수나 항목 개수 제한이 필요한가요? 있다면 숫자로 알려 주세요. (예: 대본 최대 200자, 추가 항목 최대 5개)",
      "복수/장문 입력이 보이나 상한이 없음",
    );
  }

  // After submit
  if (hasForm && !/제출\s*후|알림|담당|제작\s*착수|다음\s*단계/.test(prd)) {
    push(
      "after_submit",
      "policy",
      "요청을 제출하면 다음에 누가 무엇을 하나요? (예: 콘텐츠팀이 확인 후 제작 시작)",
      "제출 이후 업무 흐름이 PRD에 없음",
    );
  }

  // Edit after submit / mid-change
  if (
    hasForm &&
    /상태|진행|제작/.test(prd) &&
    !/수정\s*가능|초기화|도중에\s*변경|재입력/.test(prd)
  ) {
    push(
      "edit_rules",
      "policy",
      "제출한 뒤에도 내용을 고칠 수 있나요? 고칠 수 있다면 어느 단계까지이며, 유형을 바꾸면 이미 쓴 내용은 지울까요?",
      "진행 상태가 언급되나 수정·초기화 규칙 없음",
    );
  }

  // Privacy
  if (/개인정보|연락처|전화|이메일|주민/.test(prd) && !/마스킹|비공개|권한/.test(prd)) {
    push(
      "privacy",
      "policy",
      "개인정보(연락처 등)는 누구에게 보이게 하고, 가리거나 숨길 규칙이 있나요?",
      "개인정보 언급 — 표시 정책 필요",
    );
  }

  // List filters — ask in business terms; skip if live DB already has codes
  if (hasList && !/상태|필터|탭/.test(prd) && !/codes=\[/.test(liveSummary)) {
    push(
      "choice_values",
      "data",
      "목록에서 나누어 보고 싶은 구분(진행 중 / 완료 등)이 있으면, 화면에 쓸 이름들로 알려 주세요.",
      "목록성 요구인데 구분·필터 기준이 없음",
    );
  }

  // Very short PRD
  if (items.length === 0 && prd.replace(/#+\s*확인된\s*결정[\s\S]*$/m, "").trim().length < 400) {
    push(
      "done_when",
      "ambiguity",
      `"${title}"이(가) 잘 됐다고 보려면 무엇이 가능해야 하나요? 한두 문장으로 적어 주세요.`,
      "본문이 짧아 완료 기준이 불명확",
    );
  }

  // Flow present but no common fields detail
  if (hasFlow && hasForm && !/랜딩|지면|타겟|필수/.test(prd) && items.length < 3) {
    push(
      "required_optional",
      "ambiguity",
      "단계별로 꼭 넣어야 하는 정보를 순서대로 적어 주세요. (예: 1) 유형 고르기 2) 공통 정보 …)",
      "요청 구조는 있으나 단계별 입력 내용이 빈약",
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
  };
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

  const businessOpen = heuristicQuestions(prdContent, run.title, live, covered).filter((item) => {
    if (item.topic === "choice_values" && /목록에서 나누어/.test(item.question) && /codes=\[/.test(live)) {
      return false;
    }
    // Never ask layout during ambiguity loop
    if (item.topic === "screen_layout") return false;
    return true;
  });

  // Sync this run's own answers into the project ledger (memory across requests).
  // Prefilled entries keep their original run's provenance and are not re-recorded.
  await recordDecisions(
    projectSlug,
    prev.resolved
      .filter((item) => !item.prefilledFrom)
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
  const rechecks: ClarificationItem[] = contradictions.map((item) => ({
    id: `q-recheck-${item.topic}`,
    kind: "ambiguity",
    topic: item.topic,
    question: item.question,
    reason: `PRD에 근거가 있는데 답변이 이를 부정함 — 1회만 재확인`,
    evidence: item.evidence,
  }));

  let open: ClarificationItem[] = [
    ...rechecks,
    ...businessOpen.filter(
      (item) => !contradictedTopics.has(item.topic) && !prefillFromLedger(item),
    ),
  ];
  let status: ClarificationsDoc["status"] = open.length === 0 ? "ready" : "clarifying";
  let phase: "clarify" | "layout" | "ready" = "clarify";

  if (open.length === 0) {
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
    audience: "non_developer",
  };
  await saveClarificationsDoc(config, runId, doc);
  await setRunStatus(config, projectSlug, runId, status);

  const message =
    phase === "clarify"
      ? `보완 질문 ${open.length}건 — 채팅에서 확정하고 답변을 반영.`
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
        resolvedCount: doc.resolved.length,
        ledgerNotices,
        collisions,
        contradictions,
        pendingAnswers: Boolean(staged.doc),
        pendingRestatement: staged.doc?.restatement ?? [],
        liveDbBrief: live.slice(0, 2000),
        chat_instructions: [
          "이 루프의 목적은 개발 명세가 아니라 PRD 확정·보완입니다.",
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
  if (!runId || !answersRaw) {
    throw new Error(
      'usage: wireframe prd answer --run-id slug --answers \'[{"id":"q1","answer":"..."}]\' [--project crm]',
    );
  }
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;

  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId}`);

  const answers = (JSON.parse(answersRaw) as Array<{ id?: string; topic?: string; answer: string }>)
    .map((entry) => ({
      id: String(entry.id ?? "").trim(),
      topic: String(entry.topic ?? "").trim(),
      answer: String(entry.answer ?? "").trim(),
    }))
    .filter((entry) => entry.answer);

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

  if (staged.length === 0) {
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
        message:
          challenges.length > 0
            ? "아직 기록하지 않았습니다. challenges의 question을 그대로 물어 확인부터 받으세요."
            : "아직 기록하지 않았습니다. restatement를 그대로 전한 뒤 「이대로 확정할까요?」를 묻고 멈추세요.",
        chat_instructions: [
          "이 답변은 보관만 됐습니다. 승인 전에는 요청서에 반영되지 않습니다.",
          "restatement를 업무 말로 그대로 전하고 「이대로 확정할까요?」라고 물으세요.",
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
  if (newlyResolved.length > 0) {
    merged = appendAnswersToPrd(
      merged,
      newlyResolved.map((item) => ({
        question: item.question,
        // Keep the conflict visible in the document the build reads.
        answer: item.overridesPrd
          ? `${item.answer} — PRD에 적힌 내용보다 이 답을 우선(사용자 재확인)`
          : item.answer,
      })),
    );
  }
  await writeFile(prdPath, `${merged.trimEnd()}\n`, "utf8");

  await saveClarificationsDoc(config, runId, {
    status: "clarifying",
    phase: "clarify",
    open: unanswered,
    resolved: [...keptResolved, ...newlyResolved],
    rounds: prev.rounds,
    updatedAt: now,
    channel: "chat",
    audience: "non_developer",
  });

  // Grow the project memory: only approved answers become ledger entries.
  await recordDecisions(
    projectSlug,
    [...newlyResolved, ...overridden].map((item) => ({
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
