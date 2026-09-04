import { openAiModel, requireOpenAiKey } from "./env.js";
import {
  looksLikeBulkAccept,
  prdAnswer,
  prdAnswerApply,
  prdAnswerBulk,
  prdAnswerDiscard,
  prdAnswersPendingGet,
  prdApply,
  prdBuild,
  prdConflicts,
  prdDiscard,
  prdDocsStale,
  prdGet,
  prdList,
  prdPendingGet,
  prdPropose,
  prdOutline,
  prdReview,
  prdSave,
  prdSection,
} from "./prd-tools.js";
import {
  addUsage,
  emptyUsage,
  recordOpenAiUsage,
  type TokenUsage,
} from "./openai-usage.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "prd_save",
      description:
        "FIRST save only: the user just pasted a brand-new request that has no stored text yet. Never use this to change a request that already has text — use prd_propose. Never ask the user for ids.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short business title from the PRD" },
          content: {
            type: "string",
            description:
              "The user pasted text, copied VERBATIM. Never summarize, shorten, reword or restructure it, and never append your own sentences — the PRD is the source of truth for every generated document.",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_propose",
      description:
        "Stage a change to an ALREADY SAVED request without writing it. Send the complete new text (existing text with the change applied), never a fragment. Returns summary[] — plain Korean sentences describing what changed; relay them and then ask 이대로 저장할까요? Nothing is written until prd_apply.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "New business title, only if it changed" },
          content: { type: "string", description: "Complete new PRD text in plain language" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_apply",
      description:
        "The user approved what you restated (네/좋아요/저장해 주세요). Writes the staged answers and/or the staged PRD change for real and re-reviews. Only call after the user has seen the restatement/summary and said yes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_discard",
      description:
        "The user rejected what you restated outright (아니요/취소/원래대로). Throws the staged answers or the staged PRD change away. If the user instead wants a different answer or further edits, call prd_answer / prd_propose again — do NOT discard first.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_review",
      description: "Find missing business decisions. Returns open questions in plain Korean.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_answer",
      description:
        "Stage user answers to open questions — NOTHING is written yet. Call this whenever the user answers, including screen form (모달/표/페이지/단계별) and the 요청서 확정(네/아니요) approval. If you do not know the question id, send topic instead (screen_layout for 화면 형태, prd_ready for 확정) or just the answer; the server matches it to the open question. When the user answers with 제안대로 (제안대로 / 3번 빼고 제안대로 / 5번은 ②, 나머지 제안대로), pass their sentence through as the answer — the server expands it into each proposal's own wording and returns bulkAccepted[] plus needsUser[] (questions with 제안 없음 that the user must still answer). Returns restatement[] (plain Korean 확정안) and challenges[] (the answer denies something the request text spells out). Relay them, ask 이대로 확정할까요?, and stop; the answer is recorded only by prd_apply.",
      parameters: {
        type: "object",
        properties: {
          answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Open question id if known" },
                topic: {
                  type: "string",
                  description: "Question topic when the id is unknown, e.g. screen_layout",
                },
                answer: { type: "string" },
              },
              required: ["answer"],
            },
          },
        },
        required: ["answers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_get",
      description:
        "Read the request's status, phase, open questions, and an OUTLINE of the PRD (section titles and sizes) — not the full text. To read a section's wording, call prd_section. Editing a request still sends the full new text to prd_propose.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_section",
      description:
        "Read one section of the PRD by its outline number (no) or a keyword (query). Use this instead of pulling the whole PRD when the user points at one part such as 레퍼런스 or 종료 사유.",
      parameters: {
        type: "object",
        properties: {
          no: { type: "string", description: "Section number from prd_get's outline" },
          query: { type: "string", description: "Keyword to locate the section if no is unknown" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_conflicts",
      description:
        "Read cross-request memory for this request: ledgerNotices (decisions pre-filled from earlier requests — relay each once) and collisions (another request also modifies the same screen — ask the user 합칠지/따로 갈지). Business language only; never mention routes or ids.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_build",
      description:
        "Generate 1st-pass wireframe HTML. Only when phase=ready (PRD approved AND screen form answered). Call when the user says 진행/생성 or when phase just became ready.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

const SYSTEM = `당신은 비개발자(실무자)용 요청서 확정 도우미입니다. 상대는 개발자가 아닙니다.

세 단계 — **한 턴에 섞지 말고** 순서대로:
① 업무 요청서 확정 — 애매한 것만 쉬운 말로 물어 채움
② 화면 형태 — 모달/표/페이지/단계별만 묻고 **답을 기다림**
③ 와이어프레임 생성 — 형태까지 확정되면 **바로 prd_build** 호출

사용자에게 절대 금지:
- run_id, 프로젝트명, API, 테이블, 컬럼, status, phase, HTML, JSON, 도구 이름
- id를 묻기 / "저장이 안 됩니다" / "HTML은 만들지 않습니다"

이미 저장된 요청서를 고칠 때 (가장 중요):
- **승인 없이 절대 덮어쓰지 마세요.** 고친 전체 본문으로 **prd_propose**를 부르면 변경안만 보관됩니다
- 돌아온 summary를 업무 말로 그대로 전한 뒤 「이대로 저장할까요? 아니면 더 고칠까요?」라고 **묻고 멈추세요**
- 사용자가 「네/좋아요/저장해 주세요」라고 하면 **prd_apply**
- 「아니요/취소/원래대로」면 **prd_discard**
- 더 고쳐 달라고 하면 **prd_discard 없이 prd_propose를 다시** 부르세요 (앞서 만든 변경안 위에 얹힙니다)
- 처음 붙여 넣는 새 요청서만 예외 — 비교할 것이 없으니 prd_save로 바로 저장합니다

질문은 그대로 읽어 주세요 (상황·선택지·제안·근거):
- prd_review의 open에는 prompt가 들어 있습니다. **번호와 함께 그 문구를 그대로** 전하세요. 요약·각색 금지
- 제안은 요청서나 이전 결정에서 나온 것입니다. 근거에 없는 내용을 **지어내지 마세요**
- 「제안 없음 — 확인이 필요합니다」인 질문은 사용자가 직접 답해야 합니다. 제안을 만들어 주지 마세요
- 질문을 전한 뒤 「전부 제안대로 하시려면 “제안대로”라고만 답해 주셔도 됩니다. 「3번 빼고 제안대로」, 「5번은 ②, 나머지 제안대로」처럼도 됩니다」라고 안내하세요
- 사용자가 「제안대로」류로 답하면 그 말을 **그대로** prd_answer에 넘기세요. 서버가 제안 문구로 바꿔 보관합니다
- 「제안대로」로 처리되지 않은(근거 없는) 질문은 「아래 N건은 근거가 없어 직접 답해 주셔야 합니다」라고 알리고 이어서 물으세요

요청서 확정도 승인이 필요합니다:
- 업무 질문이 다 끝나면 「요청서를 이대로 확정할까요?」 질문이 열립니다. 정해진 내용을 그대로 전하고 **물은 뒤 멈추세요**
- 사용자의 확정 답(네/아니요)도 prd_answer → prd_apply로 넣으세요. 승인 전에는 확정되지 않습니다
- 확정된 뒤에만 화면 형태를 묻고, 그 뒤에 와이어프레임을 만듭니다

애매한 점에 대한 답도 승인 뒤에만 기록합니다:
- 사용자가 답하면 **prd_answer**를 부르세요. 이때는 **보관만** 되고 요청서에는 아직 반영되지 않습니다
- 돌아온 restatement를 평문으로 그대로 전한 뒤 「이대로 확정할까요?」라고 **묻고 멈추세요**
- 「네/좋아요/저장해 주세요」면 **prd_apply**, 「아니요/취소」면 **prd_discard**
- 다르게 고쳐 답하면 **prd_discard 없이 prd_answer를 다시** 부르세요 (앞 답 위에 얹힙니다)
- challenges가 오면 그 question을 **그대로** 물으세요. 요청서에 적힌 내용을 답이 부정하고 있다는 뜻입니다
- 사용자가 그래도 같은 답을 유지하면 그 답을 그대로 prd_answer 한 뒤 승인받으세요. **같은 주제를 두 번 넘게 되묻지 마세요**

승인을 묻기 전에 무엇이 바뀌는지 먼저 보여 주세요:
- prd_propose·prd_answer가 impactPreview를 돌려주면 **줄바꿈까지 그대로** 옮긴 뒤에 승인을 물으세요
- 요약하지도, 개수(「화면 2장」)로 바꾸지도 마세요. 비어 있으면 아무 말도 하지 마세요
- 「이미 승인된 화면입니다」가 붙어 있으면 그 사실을 분명히 전하고 사용자가 판단하게 두세요

필수 행동:
- 새 PRD를 붙여 넣으면 즉시 prd_save(title, content) → prd_review
- **content 에는 사용자가 붙여 넣은 본문을 글자 그대로** 넣으세요. 요약·재작성·줄임 금지이고,
  당신이 쓴 문장을 덧붙이지 마세요. 길어도 그대로 넣습니다 — 세부 규칙이 사라지면 화면도 틀립니다
- 사용자가 답하면 **반드시 prd_answer** (말로만 확정하지 마세요)
- 화면 형태 답(모달, 단계별 등)도 prd_answer로 넣으세요
- phase=ready가 되면 **같은 턴에서 prd_build** 하세요. "나중에 보여 드릴게요"라고 말하지 마세요
- 사용자가 「진행」「생성」「만들어」라고 하면 prd_build를 호출하세요
- prd_answer가 실패하면 **prd_review로 open을 다시 받아 그 id로 prd_answer** 하세요
- **실패했다고 prd_save를 다시 호출하지 마세요** — 이미 확정된 답이 지워지고 처음으로 되돌아갑니다
- 같은 질문을 두 번 묻지 마세요. 사용자가 이미 답했으면 그 답을 그대로 prd_answer에 넣으세요
- 대화에 요청서 본문이 이미 있으면 **다시 붙여 넣어 달라고 하지 마세요**. 그 본문을 그대로 쓰세요
- ledgerNotices(이전 요청에서 정한 내용 자동 반영)가 오면 그 문구를 **한 번만** 그대로 전하세요. 숨기지 말고, 사용자가 다르다고 하면 prd_answer로 새 답을 넣으세요
- collisions(같은 화면을 다른 요청도 수정)가 오면 그 요청의 **제목**만 들어 알리고 「합칠지 따로 갈지」를 **질문**하세요. 경로·주소·id는 말하지 말고, 임의로 결정하지 마세요
- 한국어로 짧고 친절하게. 기술 용어 없이.`;

type AgentState = {
  runId?: string;
  project: string;
  status?: string;
  phase?: string;
  built?: boolean;
  artifactCount?: number;
  /** A rewrite of this run's PRD, or an answer to an open question, is waiting for the user's yes. */
  pending?: boolean;
  pendingSummary?: string[];
  /** Staged clarification answers specifically (they apply/discard before a staged PRD change). */
  pendingAnswers?: boolean;
};

type OpenQ = {
  id: string;
  question: string;
  topic?: string;
  kind?: string;
  /** 1-based number the user refers to ("3번 빼고 제안대로"). */
  no?: number;
  /** 상황·선택지·제안·근거 — read this out as-is. */
  prompt?: string;
  /** 제안 없음 — never covered by 「제안대로」. */
  needsUser?: boolean;
  proposal?: { answer: string };
};

function sanitizeUserFacing(text: string): string {
  let out = text;
  out = out.replace(/\bRUN[_ ]?ID\b/gi, "이 요청");
  out = out.replace(/\brun[_ ]?id\b/gi, "이 요청");
  out = out.replace(/runId/g, "이 요청");
  out = out.replace(/프로젝트명(을|를)?\s*(알려|주시)/g, "요청 내용");
  out = out.replace(/기본값\s*['"]?crm['"]?/gi, "");
  out = out.replace(/phase\s*=\s*\w+/gi, "");
  out = out.replace(/status\s*=\s*\w+/gi, "");
  out = out.replace(/HTML\s*(제작|생성)?은?\s*하지\s*않습니다[^.]*\.?/gi, "");
  if (/run_id|RUN_ID|프로젝트명|저장이 안 됩니다|HTML 제작은 하지/i.test(out)) {
    return "요청하신 내용 반영했어요. 이어서 진행할게요.";
  }
  return out.trim();
}

function lastUserText(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return "";
}

function recentUserLayoutAnswer(messages: Array<{ role: string; content: string }>): string | null {
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && parts.length < 6; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const t = m.content.trim();
    if (t.length > 400) continue;
    if (/모달|팝업|목록|표|페이지|단계|위자드|wizard|폼/.test(t)) parts.unshift(t);
  }
  if (!parts.length) return null;
  return parts.join(" / ");
}

function wantsBuild(text: string): boolean {
  return /생성|만들어|진행|빌드|시작|와이어\s*프레임|초안/.test(text);
}

/** 네/좋아요/저장해 주세요 — the same yes the staged PRD change already uses. */
function saysApprove(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 60) return false;
  // "네, 이 4가지를 반영해 주세요" answers the re-ask with a different decision — not a yes.
  if (/아니|취소|원래대로|하지\s*마|말고|아직|잠깐|\d+\s*가지/.test(value)) return false;
  return (
    /^(네|넵|예|응|어|그래|오케이|ok|okay|좋아|좋아요|좋습니다|맞아|맞아요|맞습니다|확정|저장|반영|그대로)/i.test(
      value,
    ) || /확정(해|할|하)|저장(해|할|해서)|그대로\s*(해|가|진행)/.test(value)
  );
}

/** 아니요/취소/원래대로 */
function saysReject(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 60) return false;
  return /^(아니|아뇨|노|no)/i.test(value) || /취소|원래대로|하지\s*마세요|되돌/.test(value);
}

/**
 * Re-attach a chat session to its run when the browser lost runId (remount of /prd/new).
 * Matches the pasted PRD body against stored runs, newest first; falls back to the most
 * recent still-unfinished run for the project.
 */
function recoverRunId(
  root: string,
  project: string,
  messages: Array<{ role: string; content: string }>,
): string | undefined {
  const listed = prdList({ root, project });
  const runs = Array.isArray(listed.runs)
    ? (listed.runs as Array<{ runId?: string; title?: string; status?: string }>)
    : [];
  if (!runs.length) return undefined;

  const pasted = messages
    .filter((m) => m.role === "user" && m.content.trim().length > 300)
    .map((m) => m.content.trim());

  for (const run of runs) {
    if (!run.runId) continue;
    const snap = prdGet({ root, runId: run.runId, project });
    const content = typeof snap.content === "string" ? snap.content : "";
    if (!content) continue;
    const head = content.trim().slice(0, 200);
    if (pasted.some((text) => text.slice(0, 200) === head || content.includes(text.slice(0, 200)))) {
      return run.runId;
    }
  }

  // A long paste that matches no stored run is a NEW request. Falling through to "most recent
  // unfinished run" here bound a fresh PRD to someone else's request and edited that one instead.
  if (pasted.length > 0) return undefined;

  const active = runs.find((run) => run.runId && run.status !== "confirmed");
  return active?.runId;
}

function refreshState(root: string, state: AgentState): { state: AgentState; open: OpenQ[] } {
  if (!state.runId) return { state, open: [] };
  try {
    const snap = prdGet({ root, runId: state.runId, project: state.project });
    const clar = snap.clarifications as { open?: OpenQ[] } | null;
    const pending = prdPendingGet({ root, runId: state.runId, project: state.project });
    // Answers wait for the same yes as a PRD rewrite — both must block an auto-build.
    const answers = prdAnswersPendingGet({ root, runId: state.runId, project: state.project });
    const answersPending = answers.pending === true;
    const answerRestatement = Array.isArray(answers.restatement)
      ? (answers.restatement as string[])
      : [];
    return {
      state: {
        ...state,
        status: typeof snap.status === "string" ? snap.status : state.status,
        phase: typeof snap.phase === "string" ? snap.phase : state.phase,
        artifactCount:
          typeof snap.artifactCount === "number" ? snap.artifactCount : state.artifactCount,
        pending: pending.pending === true || answersPending,
        pendingAnswers: answersPending,
        pendingSummary: answersPending
          ? answerRestatement
          : Array.isArray(pending.summary)
            ? (pending.summary as string[])
            : [],
      },
      open: Array.isArray(clar?.open) ? clar.open : [],
    };
  } catch {
    return { state, open: [] };
  }
}

function runTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  state: AgentState,
  /** Conversation so far — recoverRunId needs it to avoid binding a new paste to another run. */
  userMessages: Array<{ role: string; content: string }> = [],
): { result: Record<string, unknown>; state: AgentState } {
  const project = state.project || "crm";

  const applySnap = (out: Record<string, unknown>, runId: string): {
    result: Record<string, unknown>;
    state: AgentState;
  } => {
    const refreshed = refreshState(root, { ...state, runId: runId || state.runId });
    return {
      result: {
        ...out,
        status: refreshed.state.status,
        phase: refreshed.state.phase,
        open: refreshed.open,
        artifactCount: refreshed.state.artifactCount,
      },
      state: refreshed.state,
    };
  };

  /**
   * The staging tools attach a business-language 영향 미리보기 (what this change would touch,
   * named screen by screen). It is the whole point of asking before approving, so it must
   * survive every result the agent rewrites on its way out.
   */
  const carryImpact = (
    from: Record<string, unknown>,
    into: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (typeof from.impactPreview !== "string" || !from.impactPreview) return into;
    return {
      ...into,
      impact: from.impact,
      impactPreview: from.impactPreview,
      chat_instructions: from.chat_instructions,
    };
  };

  /** One sentence appended to a staging message so the preview cannot be skipped. */
  const impactHint = (out: Record<string, unknown>): string =>
    typeof out.impactPreview === "string" && out.impactPreview
      ? " impactPreview는 이 수정이 무엇을 건드리는지 적은 것입니다 — 승인을 묻기 전에 줄바꿈까지 그대로 전하세요."
      : "";

  const proposeResult = (
    out: Record<string, unknown>,
    runId: string,
  ): { result: Record<string, unknown>; state: AgentState } => {
    const summary = Array.isArray(out.summary) ? (out.summary as string[]) : [];
    const fresh = Array.isArray(out.newChanges) ? (out.newChanges as string[]) : summary;
    if (out.unchanged === true) {
      return applySnap(
        {
          ok: true,
          pending: Boolean(out.pending),
          summary,
          message: "달라진 내용이 없습니다. 사용자에게 무엇을 고칠지 다시 물으세요.",
        },
        runId,
      );
    }
    return applySnap(
      carryImpact(out, {
        ok: true,
        saved: false,
        pending: true,
        restacked: Boolean(out.restacked),
        summary,
        newChanges: fresh,
        message:
          typeof out.impactPreview === "string" && out.impactPreview
            ? "아직 저장하지 않았습니다. summary를 업무 말로 전하고, impactPreview를 그대로 이어 붙인 뒤 「이대로 저장할까요? 아니면 더 고칠까요?」라고 묻고 이번 턴을 끝내세요. 승인하면 prd_apply, 취소하면 prd_discard, 더 고치면 prd_propose를 다시 부르세요."
            : "아직 저장하지 않았습니다. summary를 업무 말로 그대로 전한 뒤 「이대로 저장할까요? 아니면 더 고칠까요?」라고 묻고 이번 턴을 끝내세요. 승인하면 prd_apply, 취소하면 prd_discard, 더 고치면 prd_propose를 다시 부르세요.",
      }),
      runId,
    );
  };

  if (name === "prd_save") {
    // The PRD is the source of truth for every downstream document, so it has to be the user's
    // own words. A 20,000-character email thread once came back as a 2,000-character summary
    // that even ended with the agent's own "요청서를 이대로 저장할까요?" line — every detailed
    // rule was gone and the parser found no steps at all. Refuse a first save that is much
    // shorter than what the user actually pasted; the prompt alone did not hold.
    const pastedLongest = userMessages
      .filter((m) => m.role === "user")
      .reduce((longest, m) => (m.content.length > longest.length ? m.content : longest), "");
    const saving = String(args.content || "");
    if (pastedLongest.length > 1500 && saving.length < pastedLongest.length * 0.7) {
      return {
        result: {
          ok: false,
          error:
            "요청서 본문을 요약하거나 다시 쓰지 마세요. 사용자가 붙여 넣은 원문을 글자 그대로 content 에 넣어 다시 prd_save 하세요.",
          pastedChars: pastedLongest.length,
          savedChars: saving.length,
        },
        state,
      };
    }

    // A save aimed at a request that already has text is a rewrite, no matter what the model
    // called it — stage it instead of letting it overwrite input/vN.md unseen.
    if (state.runId) {
      const snap = prdGet({ root, runId: state.runId, project });
      const existing = typeof snap.content === "string" ? snap.content : "";
      if (existing.trim()) {
        const staged = prdPropose({
          root,
          runId: state.runId,
          project,
          title: args.title ? String(args.title) : undefined,
          content: String(args.content || ""),
        });
        if (staged.ok === false) {
          return {
            result: { ok: false, error: "변경안을 만들지 못했어요. 고친 전체 본문으로 prd_propose 하세요." },
            state,
          };
        }
        return proposeResult(staged, state.runId);
      }
    }
    const out = prdSave({
      root,
      title: String(args.title || "제목 없음"),
      content: String(args.content || ""),
      project,
      runId: state.runId,
    });
    if (out.ok === false) {
      return { result: { ok: false, error: "저장에 실패했어요. title·content로 다시 prd_save 하세요." }, state };
    }
    const runId = String(out.runId || state.runId || "");
    const review = out.review as { open?: OpenQ[] } | undefined;
    const next = applySnap(
      {
        ok: true,
        saved: true,
        open: review?.open,
        message: "저장됨. 사용자에게 id를 묻지 마세요. open이 있으면 업무 말로만 물으세요.",
      },
      runId,
    );
    return next;
  }

  // Proposing against a request that does not exist yet is the first paste: create it outright.
  if (name === "prd_propose" && !state.runId) {
    const recovered = recoverRunId(root, project, userMessages);
    if (!recovered) {
      const out = prdSave({
        root,
        title: String(args.title || "제목 없음"),
        content: String(args.content || ""),
        project,
      });
      if (out.ok === false) {
        return { result: { ok: false, error: "저장에 실패했어요. title·content로 다시 prd_save 하세요." }, state };
      }
      const review = out.review as { open?: OpenQ[] } | undefined;
      return applySnap(
        {
          ok: true,
          saved: true,
          firstSave: true,
          open: review?.open,
          message: "새 요청서라 바로 저장했습니다. open이 있으면 업무 말로만 물으세요.",
        },
        String(out.runId || ""),
      );
    }
    state = { ...state, runId: recovered };
  }

  if (
    !state.runId &&
    (name === "prd_review" ||
      name === "prd_answer" ||
      name === "prd_get" ||
      name === "prd_section" ||
      name === "prd_build" ||
      name === "prd_conflicts" ||
      name === "prd_apply" ||
      name === "prd_discard")
  ) {
    const recovered = recoverRunId(root, project, userMessages);
    if (recovered) {
      state = { ...state, runId: recovered };
    } else {
      return {
        result: {
          ok: false,
          error:
            "아직 저장된 요청서가 없습니다. 대화에 이미 본문이 있으면 그 본문으로 prd_save 하세요. 사용자에게 다시 붙여 넣어 달라고 하지 마세요.",
        },
        state,
      };
    }
  }

  const runId = state.runId!;

  if (name === "prd_review") {
    const out = prdReview({ root, runId, project });
    if (out.ok === false) {
      return { result: { ok: false, error: "검토에 실패했어요. 다시 prd_review 하세요." }, state };
    }
    return applySnap({ ok: true, ...out }, runId);
  }

  if (name === "prd_answer") {
    const raw = Array.isArray(args.answers)
      ? (args.answers as Array<{ id?: string; topic?: string; answer: string }>)
      : [];

    // 「제안대로」/「3번 빼고 제안대로」 — answered in one line. Parsed from the user's own text,
    // never from the model's paraphrase, and the phrase itself is never stored as an answer.
    const userText = lastUserText(userMessages);
    const bulkText = looksLikeBulkAccept(userText)
      ? userText
      : raw.map((entry) => String(entry.answer ?? "")).find(looksLikeBulkAccept);
    if (bulkText) {
      const out = prdAnswerBulk({ root, runId, project, text: bulkText });
      if (out.ok !== false) {
        const needsUser = Array.isArray(out.needsUser) ? (out.needsUser as unknown[]) : [];
        return applySnap(
          {
            ok: true,
            ...out,
            saved: false,
            pending: out.staged === true,
            message:
              out.staged === true
                ? `「제안대로」 처리했습니다. restatement를 그대로 전하고 「이대로 확정할까요?」를 물으세요. 승인하면 prd_apply.${
                    needsUser.length > 0
                      ? ` needsUser ${needsUser.length}건은 근거가 없어 「제안대로」에 포함되지 않았습니다. 「아래 ${needsUser.length}건은 근거가 없어 직접 답해 주셔야 합니다」라고 알리고 그 prompt를 그대로 물으세요.`
                      : ""
                  }${impactHint(out)}`
                : "제안이 붙은 질문이 없습니다. needsUser의 prompt를 그대로 물어 답을 받으세요.",
          },
          runId,
        );
      }
    }
    // The model cannot know real question ids: they only ever appear in a previous request's
    // tool output. Remap onto whatever is actually open on disk right now.
    const live = refreshState(root, state).open;
    const answers = raw
      .map((entry, i) => {
        const answer = String(entry.answer ?? "").trim();
        if (!answer) return null;
        const byId = live.find((q) => q.id === entry.id);
        const byTopic = entry.topic ? live.find((q) => q.topic === entry.topic) : undefined;
        const byLayout = /모달|팝업|목록|표|페이지|단계|위자드|폼/.test(answer)
          ? live.find((q) => q.topic === "screen_layout")
          : undefined;
        const target = byId ?? byTopic ?? byLayout ?? live[i] ?? live[0];
        return target ? { id: target.id, topic: target.topic, answer } : null;
      })
      .filter((entry): entry is { id: string; topic: string | undefined; answer: string } => entry !== null);

    if (answers.length === 0) {
      return {
        result: {
          ok: false,
          open: live,
          error: live.length
            ? "열린 질문에 맞는 답이 없습니다. open의 id를 그대로 써서 다시 prd_answer 하세요."
            : "지금은 열린 질문이 없습니다. prd_review로 상태를 확인하세요.",
        },
        state,
      };
    }

    const out = prdAnswer({ root, runId, project, answers });
    if (out.ok === false) {
      return {
        result: {
          ok: false,
          open: live,
          error: "답 반영에 실패했어요. open id를 확인해 다시 prd_answer 하세요.",
        },
        state,
      };
    }
    const challenges = Array.isArray(out.challenges) ? (out.challenges as unknown[]) : [];
    return applySnap(
      {
        ok: true,
        ...out,
        saved: false,
        pending: true,
        message:
          challenges.length > 0
            ? "아직 기록하지 않았습니다. challenges의 question을 그대로 물어 확인부터 받고 이번 턴을 끝내세요. 사용자가 같은 답을 유지하면 그 답으로 prd_answer를 다시 부르고, 승인하면 prd_apply 하세요."
            : `아직 기록하지 않았습니다. restatement를 업무 말로 그대로 전한 뒤 「이대로 확정할까요?」라고 묻고 이번 턴을 끝내세요. 승인하면 prd_apply, 취소하면 prd_discard, 다르게 답하면 prd_answer를 다시 부르세요.${impactHint(out)}`,
      },
      runId,
    );
  }

  if (name === "prd_propose") {
    const staged = prdPropose({
      root,
      runId,
      project,
      title: args.title ? String(args.title) : undefined,
      content: String(args.content || ""),
    });
    if (staged.ok === false) {
      return {
        result: { ok: false, error: "변경안을 만들지 못했어요. 고친 전체 본문으로 다시 prd_propose 하세요." },
        state,
      };
    }
    if (staged.applied === true) {
      const review = staged.review as { open?: OpenQ[] } | undefined;
      return applySnap(
        {
          ok: true,
          saved: true,
          firstSave: true,
          open: review?.open,
          message: "새 요청서라 바로 저장했습니다. open이 있으면 업무 말로만 물으세요.",
        },
        runId,
      );
    }
    return proposeResult(staged, runId);
  }

  if (name === "prd_apply") {
    // Answers and PRD rewrites share the same 네/아니요 wording, so one approval tool covers
    // both. The PRD change goes first: the answers append onto the text it produces.
    const stagedPrd = prdPendingGet({ root, runId, project }).pending === true;
    const stagedAnswers = prdAnswersPendingGet({ root, runId, project }).pending === true;
    if (stagedAnswers) {
      const applied = stagedPrd ? prdApply({ root, runId, project }) : { ok: true };
      const out = prdAnswerApply({ root, runId, project });
      if (out.ok === false) {
        return {
          result: {
            ok: false,
            pending: false,
            error:
              "지금 확정 대기 중인 답이 없습니다. 사용자의 답을 prd_answer로 먼저 제시하세요.",
          },
          state,
        };
      }
      return applySnap(
        {
          ok: true,
          saved: true,
          pending: false,
          open: Array.isArray(out.open) ? out.open : undefined,
          summary: applied.ok === false ? undefined : (applied as { summary?: unknown }).summary,
          message:
            "승인대로 기록했습니다. 반영됐다고 짧게 알리고, open이 남았으면 업무 말로 이어서 물으세요. phase=ready면 prd_build 하세요.",
        },
        runId,
      );
    }
    const out = prdApply({ root, runId, project });
    if (out.ok === false) {
      return {
        result: {
          ok: false,
          pending: false,
          error:
            "지금 승인 대기 중인 변경안이 없습니다. 사용자가 고쳐 달라고 한 내용을 prd_propose로 먼저 만드세요.",
        },
        state,
      };
    }
    const review = out.review as { open?: OpenQ[] } | undefined;
    return applySnap(
      {
        ok: true,
        saved: true,
        pending: false,
        open: review?.open,
        summary: out.summary,
        message:
          "승인대로 반영했습니다. 반영됐다고 짧게 알리고, open이 있으면 업무 말로 이어서 물으세요.",
      },
      runId,
    );
  }

  if (name === "prd_discard") {
    if (prdAnswersPendingGet({ root, runId, project }).pending === true) {
      const dropped = prdAnswerDiscard({ root, runId, project });
      return applySnap(
        {
          ok: dropped.ok !== false,
          pending: false,
          discarded: dropped.discarded === true,
          message:
            "확정 대기 중이던 답을 버렸습니다. 요청서는 그대로입니다. 어떤 답으로 할지 다시 물으세요.",
        },
        runId,
      );
    }
    const out = prdDiscard({ root, runId, project });
    // applySnap re-reads the stage, so state.pending (and the pendingPrd the UI banner
    // hangs off) clears in the same turn instead of lingering as a false "저장 대기 중".
    return applySnap(
      {
        ok: out.ok !== false,
        pending: false,
        discarded: out.discarded === true,
        message: "변경안을 버렸습니다. 요청서는 그대로입니다. 원래 내용이 유지된다고 알려 주세요.",
      },
      runId,
    );
  }

  if (name === "prd_get") {
    const out = prdGet({ root, runId, project });
    if (out.ok === false) {
      return { result: { ok: false, error: "불러오기에 실패했어요." }, state };
    }
    const pending = prdPendingGet({ root, runId, project });
    const answers = prdAnswersPendingGet({ root, runId, project });
    const answersPending = answers.pending === true;
    // Strip the full PRD text from what the model sees. It gets an outline (section titles +
    // sizes) and pulls a specific section with prd_section only when it needs the wording —
    // the whole PRD reprinted on every tool round was the bulk of a turn's tokens.
    const { content: _fullContent, clarifications: _clar, ...outLite } = out as Record<string, unknown>;
    return applySnap(
      {
        ok: true,
        ...outLite,
        // A staged draft is the exception: an edit-in-progress must see the exact text it is
        // building on, so hand that over verbatim. Otherwise send only the outline.
        pending: pending.pending === true || answersPending,
        pendingSummary: pending.summary,
        pendingAnswers: answersPending,
        pendingAnswerRestatement: answers.restatement,
        content: pending.pending === true ? pending.content : undefined,
        outline:
          pending.pending === true ? undefined : prdOutline({ root, runId, project }).outline,
        message:
          answersPending
            ? "확정 대기 중인 답이 있습니다. pendingAnswerRestatement를 그대로 전하고 「이대로 확정할까요?」를 물으세요. 승인하면 prd_apply, 취소하면 prd_discard."
            : pending.pending === true
              ? "승인 대기 중인 변경안이 있습니다. content는 그 변경안 본문입니다. 사용자가 승인하면 prd_apply, 더 고치면 이 본문을 고쳐 prd_propose 하세요."
              : undefined,
      },
      runId,
    );
  }

  if (name === "prd_section") {
    const out = prdSection({
      root,
      runId,
      project,
      no: args.no ? String(args.no) : undefined,
      query: args.query ? String(args.query) : undefined,
    });
    return { result: out, state };
  }

  if (name === "prd_conflicts") {
    const out = prdConflicts({ root, runId, project });
    if (out.ok === false) {
      return { result: { ok: false, error: "확인에 실패했어요. 다시 prd_conflicts 하세요." }, state };
    }
    return { result: out, state };
  }

  if (name === "prd_build") {
    const gate = refreshState(root, state);
    if (gate.state.phase !== "ready") {
      return {
        result: {
          ok: false,
          phase: gate.state.phase,
          open: gate.open,
          error:
            gate.state.phase === "layout"
              ? "화면 형태 답이 아직입니다. open 화면 형태 질문에 prd_answer 한 뒤 다시 prd_build 하세요."
              : "업무 질문이 남아 있습니다. 답을 받은 뒤 다시 시도하세요.",
        },
        state: gate.state,
      };
    }
    const out = prdBuild({ root, runId, project });
    if (out.ok === false) {
      return {
        result: { ok: false, error: String(out.error || "생성 실패"), phase: out.phase },
        state: gate.state,
      };
    }
    const n = Array.isArray(out.screens) ? out.screens.length : Number(out.artifactCount || 0);
    return {
      result: {
        ok: true,
        built: true,
        artifactCount: n,
        phase: "ready",
        message: `기능명세서·유저플로우·와이어프레임(화면 ${n}개)을 만들었습니다. 오른쪽에 바로 보인다고 안내하고, 고칠 점이 있으면 말해 달라고 하세요.`,
      },
      state: { ...gate.state, built: true, artifactCount: n, phase: "ready" },
    };
  }

  return { result: { ok: false, error: `unknown tool: ${name}` }, state };
}

async function chatCompletion(
  messages: ChatMessage[],
): Promise<{ message: ChatMessage; usage: TokenUsage | null }> {
  const key = requireOpenAiKey();
  const model = openAiModel();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 800)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: ChatMessage }>;
    usage?: unknown;
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("OpenAI returned empty message");
  const usage = recordOpenAiUsage("prd-agent", model, data.usage);
  return { message, usage };
}

/** Deterministic: persist layout answers + build when ready — don't rely on the model alone. */
function ensureProgress(
  root: string,
  state: AgentState,
  open: OpenQ[],
  userMessages: Array<{ role: string; content: string }>,
): { state: AgentState; open: OpenQ[]; note?: string } {
  let cur = state;
  let curOpen = open;
  const userText = lastUserText(userMessages);

  // Deadlock guard: phase=layout with nothing open can never be answered nor built.
  // Re-review regenerates the screen_layout question (or closes the phase outright).
  if (cur.runId && cur.phase === "layout" && curOpen.length === 0) {
    const review = prdReview({ root, runId: cur.runId, project: cur.project });
    if (review.ok !== false) {
      const refreshed = refreshState(root, cur);
      cur = refreshed.state;
      curOpen = refreshed.open;
    }
  }

  // A staged answer is the user's word waiting for their own yes: apply it only on an explicit
  // approval, drop it on an explicit rejection, and otherwise leave it staged.
  let note: string | undefined;
  if (cur.runId && cur.pendingAnswers) {
    if (saysApprove(userText)) {
      const out = prdAnswerApply({ root, runId: cur.runId, project: cur.project });
      if (out.ok !== false) {
        const refreshed = refreshState(root, cur);
        cur = refreshed.state;
        curOpen = refreshed.open;
      }
    } else if (saysReject(userText)) {
      prdAnswerDiscard({ root, runId: cur.runId, project: cur.project });
      const refreshed = refreshState(root, cur);
      cur = refreshed.state;
      curOpen = refreshed.open;
      note = "확정 대기 중이던 답을 취소했습니다. 요청서는 그대로예요. 어떻게 정할지 알려 주세요.";
    }
  }

  // 「제안대로」 in prose, with no tool call: stage the proposals here so the phrase always
  // works. Deterministic (regex over the user's text) and still staged — never written.
  if (
    cur.runId &&
    !cur.pendingAnswers &&
    looksLikeBulkAccept(userText) &&
    curOpen.some((q) => q.proposal)
  ) {
    const out = prdAnswerBulk({ root, runId: cur.runId, project: cur.project, text: userText });
    if (out.ok !== false && out.staged === true) {
      const refreshed = refreshState(root, cur);
      cur = refreshed.state;
      curOpen = refreshed.open;
      const lines = Array.isArray(out.restatement) ? (out.restatement as string[]) : [];
      const left = Array.isArray(out.needsUser)
        ? (out.needsUser as Array<{ prompt?: string; reason?: string }>)
        : [];
      // 근거가 없어 빠진 질문과, 사용자가 직접 빼 달라고 한 질문은 다르게 말한다.
      const block = (items: typeof left, headline: string): string =>
        items.length === 0
          ? ""
          : `\n\n${headline}\n${items
              .map((item) => item.prompt ?? "")
              .filter(Boolean)
              .join("\n\n")}`;
      const noProposal = left.filter((item) => item.reason !== "사용자가 제외함");
      const skipped = left.filter((item) => item.reason === "사용자가 제외함");
      note =
        `${lines.join(" / ")} — 이대로 확정할까요?` +
        block(noProposal, `아래 ${noProposal.length}건은 근거가 없어 직접 답해 주셔야 합니다.`) +
        block(skipped, `빼 달라고 하신 질문은 그대로 남겨 뒀습니다.`);
    }
  }
  if (note) return { state: cur, open: curOpen, note };

  // Auto-answer screen_layout from recent short user replies — staged, never written silently.
  const layoutQ = curOpen.find((q) => q.topic === "screen_layout" || /화면\s*(형태|양식)/.test(q.question));
  if (cur.runId && layoutQ && cur.phase === "layout" && !cur.pendingAnswers) {
    const answer = recentUserLayoutAnswer(userMessages);
    if (answer) {
      const out = prdAnswer({
        root,
        runId: cur.runId,
        project: cur.project,
        answers: [{ id: layoutQ.id, answer }],
      });
      if (out.ok !== false) {
        const refreshed = refreshState(root, cur);
        cur = refreshed.state;
        curOpen = refreshed.open;
        const lines = Array.isArray(out.restatement)
          ? (out.restatement as string[])
          : (cur.pendingSummary ?? []);
        // The answer is staged, so the turn must end on the confirmation question.
        note = `${lines.join(" / ")} — 이대로 확정할까요?`;
      }
    }
  }
  if (note) return { state: cur, open: curOpen, note };

  // Auto-build when ready and user asked, or just became ready with no open Qs
  // A staged rewrite is still awaiting the user's yes — building now would hand them
  // wireframes made from text they are in the middle of deciding about.
  const shouldBuild =
    cur.runId &&
    cur.phase === "ready" &&
    !cur.built &&
    !cur.pending &&
    (wantsBuild(userText) || curOpen.length === 0);

  if (shouldBuild && cur.runId) {
    // Skip a rebuild only when the documents already match the PRD. Gating on the user saying
    // "생성/만들어" instead meant an approved PRD edit ("레퍼런스에 웍스방 추가해줘") rewrote the
    // request while the feature spec, user flow and screens silently kept describing the old one.
    const stale = prdDocsStale({ root, runId: cur.runId, project: cur.project });
    if ((cur.artifactCount ?? 0) > 0 && !stale && !wantsBuild(userText)) {
      return { state: cur, open: curOpen };
    }
    const out = prdBuild({ root, runId: cur.runId, project: cur.project });
    if (out.ok !== false) {
      const n = Array.isArray(out.screens) ? out.screens.length : Number(out.artifactCount || 0);
      cur = { ...cur, built: true, artifactCount: n, phase: "ready" };
      return {
        state: cur,
        open: curOpen,
        note: `기능명세서·유저플로우·와이어프레임(화면 ${n}개)을 만들었습니다. 오른쪽에서 바로 확인하시고, 고칠 점을 말씀하시면 반영합니다.`,
      };
    }
  }

  return { state: cur, open: curOpen };
}

export type AgentChatInput = {
  root: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  runId?: string;
  project?: string;
};

export type AgentChatResult = {
  ok: true;
  assistantMessage: string;
  runId?: string;
  project: string;
  status?: string;
  phase?: string;
  openQuestions?: OpenQ[];
  built?: boolean;
  artifactCount?: number;
  /** A PRD rewrite is staged and waiting for the user to approve it. */
  pendingPrd?: boolean;
  pendingSummary?: string[];
  trace?: string[];
  /** Token usage for this chat turn (sum of all model rounds). */
  usage?: TokenUsage;
  usageCalls?: number;
};

export async function runPrdAgentChat(input: AgentChatInput): Promise<AgentChatResult> {
  let state: AgentState = {
    runId: input.runId,
    project: input.project || "crm",
  };

  // A chat remount loses runId in the browser; recover it before the tool guard forces the
  // model to ask the user to paste the PRD all over again (which forks a duplicate run).
  if (!state.runId) {
    state.runId = recoverRunId(input.root, state.project, input.messages);
  }

  let bootOpen: OpenQ[] = [];
  if (state.runId) {
    const boot = refreshState(input.root, state);
    state = boot.state;
    bootOpen = boot.open;
  }

  const sessionHint = state.runId
    ? `세션에 요청서가 연결되어 있습니다. 본문이 이미 저장돼 있으므로 내용을 고칠 때는 prd_save가 아니라 prd_propose를 쓰고 승인 뒤 prd_apply 하세요. phase=${state.phase || "?"}. open이 있으면 묻고, 사용자 답은 prd_answer, phase=ready면 prd_build.` +
      (bootOpen.length
        ? ` 지금 열린 질문: ${bootOpen.map((q) => `${q.id}=${q.topic || q.kind || "other"}`).join(", ")}. 이 id를 그대로 prd_answer에 쓰세요.`
        : "") +
      (state.pendingAnswers
        ? ` 확정 대기 중인 답이 있습니다: ${(state.pendingSummary ?? []).join(" / ")}. 그대로 전하고 「이대로 확정할까요?」를 물으세요. 승인하면 prd_apply, 취소하면 prd_discard, 다르게 답하면 prd_answer를 다시 부르세요.`
        : state.pending
          ? ` 승인 대기 중인 변경안이 있습니다: ${(state.pendingSummary ?? []).join(" / ")}. 사용자가 승인하면 prd_apply, 취소하면 prd_discard, 더 고치면 prd_propose를 다시 부르세요.`
          : "")
    : `새 요청입니다. 본문이 오면 prd_save만 하세요.`;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "system", content: sessionHint },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const trace: string[] = [];
  // Seed from disk: on a turn where the model answers in prose without calling a tool,
  // ensureProgress() is the only thing that can persist the layout answer — and it needs
  // the open list. Starting empty silently disarmed it.
  let lastOpen: OpenQ[] = bootOpen;
  let turnUsage = emptyUsage();
  let usageCalls = 0;

  for (let round = 0; round < 8; round += 1) {
    const { message: assistant, usage } = await chatCompletion(messages);
    if (usage) {
      turnUsage = addUsage(turnUsage, usage);
      usageCalls += 1;
    }
    messages.push(assistant);

    const calls = assistant.tool_calls;
    if (!calls || calls.length === 0) {
      const text = String(assistant.content || "").trim();
      const ensured = ensureProgress(input.root, state, lastOpen, input.messages);
      state = ensured.state;
      lastOpen = ensured.open;
      const msg = ensured.note || text || "(응답 없음)";
      return {
        ok: true,
        assistantMessage: sanitizeUserFacing(msg),
        runId: state.runId,
        project: state.project,
        status: state.status,
        phase: state.phase,
        openQuestions: lastOpen,
        built: state.built,
        artifactCount: state.artifactCount,
        pendingPrd: state.pending,
        pendingSummary: state.pendingSummary,
        trace,
        usage: turnUsage,
        usageCalls,
      };
    }

    for (const call of calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      trace.push(name);
      const { result, state: next } = runTool(input.root, name, args, state, input.messages);
      state = next;
      if (Array.isArray((result as { open?: unknown }).open)) {
        lastOpen = (result as { open: OpenQ[] }).open;
      }
      if (result.built === true) state.built = true;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  const ensured = ensureProgress(input.root, state, lastOpen, input.messages);
  state = ensured.state;
  lastOpen = ensured.open;

  return {
    ok: true,
    assistantMessage: sanitizeUserFacing(
      ensured.note ||
        (state.built
          ? `기능명세서·유저플로우·와이어프레임(화면 ${state.artifactCount ?? ""}개)을 만들었습니다. 오른쪽에서 바로 확인해 주세요.`
          : "이어서 답을 보내 주세요."),
    ),
    runId: state.runId,
    project: state.project,
    status: state.status,
    phase: state.phase,
    openQuestions: lastOpen,
    built: state.built,
    artifactCount: state.artifactCount,
    pendingPrd: state.pending,
    pendingSummary: state.pendingSummary,
    trace,
    usage: turnUsage,
    usageCalls,
  };
}
