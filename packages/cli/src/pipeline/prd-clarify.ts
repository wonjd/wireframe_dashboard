import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { WireframeConfig } from "../lib/config.js";
import { resolveProject } from "../lib/config.js";
import { getRunRoot, loadIndex, saveIndex, getProject } from "../lib/runs.js";
import { quoteSql, runWonjdQuery } from "../extractors/wonjd.js";

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
};

export type ClarificationsDoc = {
  status: "clarifying" | "ready";
  open: ClarificationItem[];
  resolved: Array<ClarificationItem & { answer: string; resolvedAt: string }>;
  rounds: number;
  updatedAt: string;
  channel: "chat";
  audience: "non_developer";
};

function emptyDoc(): ClarificationsDoc {
  return {
    status: "clarifying",
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

/** Topics already covered by ## 확인된 결정 or prior answers */
function resolvedTopicsFromPrd(prd: string, resolved: ClarificationsDoc["resolved"]): Set<string> {
  const topics = new Set<string>(resolved.map((item) => item.topic || "other"));
  const section = prd.match(/(?:^|\n)#+\s*확인된\s*결정([\s\S]*)$/m)?.[1] ?? "";
  const blob = `${section}\n${resolved.map((r) => `${r.question}\n${r.answer}`).join("\n")}`;
  const full = `${prd}\n${blob}`;

  // Explicit negative / N/A answers for a resolved item always cover that topic
  for (const item of resolved) {
    if (isNegativeOrSkipAnswer(item.answer)) {
      topics.add(item.topic || "other");
    }
  }

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

  // Screen layout / chrome — before wireframe build
  if (
    !/모달|팝업|목록\s*표|테이블\s*형태|전체\s*페이지|단계별|위자드|화면\s*양식|화면\s*형태/.test(prd)
  ) {
    push(
      "screen_layout",
      "scope",
      "화면은 어떤 형태로 보여 주면 될까요? (예: 전체 페이지 입력폼 / 팝업·모달 / 목록 표 / 단계별로 넘어가는 화면). 섞여 있으면 단계마다 적어 주세요.",
      "와이어프레임 양식(페이지·모달·표·위자드)이 없으면 생성 레이아웃을 고를 수 없음",
    );
  }

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

  const open = heuristicQuestions(prdContent, run.title, live, covered).filter((item) => {
    // Never surface DB-code fishing to humans if live already has enums for list filters
    if (item.topic === "choice_values" && /목록에서 나누어/.test(item.question) && /codes=\[/.test(live)) {
      return false;
    }
    return true;
  });

  const ready = open.length === 0;
  const doc: ClarificationsDoc = {
    status: ready ? "ready" : "clarifying",
    open,
    resolved: prev.resolved,
    rounds: prev.rounds + 1,
    updatedAt: new Date().toISOString(),
    channel: "chat",
    audience: "non_developer",
  };
  await saveClarificationsDoc(config, runId, doc);
  await setRunStatus(config, projectSlug, runId, ready ? "ready" : "clarifying");

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        status: doc.status,
        audience: "non_developer",
        channel: "chat",
        open,
        resolvedCount: doc.resolved.length,
        liveDbBrief: live.slice(0, 2000),
        chat_instructions: [
          "이 루프의 목적은 개발 명세가 아니라 PRD 확정·보완입니다.",
          "open 질문을 업무 말로 채팅에서 물어 부족한 결정을 채우세요.",
          "테이블·컬럼·코드값·API·경로 등 개발 개념은 사용자에게 말하지 마세요.",
          "reason·liveDbBrief는 내부용입니다. 필요하면 ‘업무 흐름을 정하려고요’ 정도만.",
          "답 → prd_answer 도구로 반영 → 재질문. ready가 될 때까지 확정을 쌓으세요.",
          "ready 전에는 와이어프레임 빌드를 시작하지 마세요.",
        ],
        message: ready
          ? "보완할 미결 없음 — PRD 확정(ready). 와이어프레임 빌드 가능."
          : `보완 질문 ${open.length}건 — 채팅에서 확정하고 답변을 반영.`,
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

  const answers = JSON.parse(answersRaw) as Array<{ id: string; answer: string }>;
  const answerMap = new Map(
    answers.map((entry) => [entry.id, String(entry.answer ?? "").trim()] as const).filter(([, a]) => a),
  );

  const prev = await loadClarificationsDoc(config, runId);
  const newlyResolved: ClarificationsDoc["resolved"] = [];
  const unanswered: ClarificationItem[] = [];
  for (const item of prev.open) {
    const answer = answerMap.get(item.id);
    if (answer) {
      newlyResolved.push({ ...item, answer, resolvedAt: new Date().toISOString() });
    } else {
      unanswered.push(item);
    }
  }
  if (newlyResolved.length === 0) throw new Error("no matching answers for open questions");

  const prdPath = path.join(getRunRoot(config, runId), "input", `v${run.prdVersion}.md`);
  const prdContent = await readFile(prdPath, "utf8");
  const merged = appendAnswersToPrd(
    prdContent,
    newlyResolved.map((item) => ({ question: item.question, answer: item.answer })),
  );
  await writeFile(prdPath, `${merged.trimEnd()}\n`, "utf8");

  await saveClarificationsDoc(config, runId, {
    status: "clarifying",
    open: unanswered,
    resolved: [...prev.resolved, ...newlyResolved],
    rounds: prev.rounds,
    updatedAt: new Date().toISOString(),
    channel: "chat",
    audience: "non_developer",
  });
  await setRunStatus(config, projectSlug, runId, "clarifying");

  // Re-review
  await reviewPrdClarificationsCli(config, ["--run-id", runId, "--project", projectSlug]);
}
