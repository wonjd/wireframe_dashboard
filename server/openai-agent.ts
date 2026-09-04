import { openAiModel, requireOpenAiKey } from "./env.js";
import {
  prdAnswer,
  prdApply,
  prdBuild,
  prdConflicts,
  prdDiscard,
  prdGet,
  prdList,
  prdPendingGet,
  prdPropose,
  prdReview,
  prdSave,
} from "./prd-tools.js";

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
          content: { type: "string", description: "Full PRD text in plain language" },
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
        "The user approved the staged change (네/좋아요/저장해 주세요). Writes it for real and re-reviews. Only call after the user has seen the summary and said yes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_discard",
      description:
        "The user rejected the staged change outright (아니요/취소/원래대로). Throws the draft away. If the user instead wants further edits, call prd_propose again — do NOT discard first.",
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
        "Save user answers to open questions, then re-review. Call this whenever the user answers — including screen form (모달/표/페이지/단계별). If you do not know the question id, send topic instead (screen_layout for 화면 형태) or just the answer; the server matches it to the open question.",
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
      description: "Read current PRD text, phase, and open questions.",
      parameters: { type: "object", properties: {} },
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

필수 행동:
- 새 PRD를 붙여 넣으면 즉시 prd_save(title, content) → prd_review
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
  /** A rewrite of this run's PRD is staged and waiting for the user's yes. */
  pending?: boolean;
  pendingSummary?: string[];
};

type OpenQ = { id: string; question: string; topic?: string; kind?: string };

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
    return {
      state: {
        ...state,
        status: typeof snap.status === "string" ? snap.status : state.status,
        phase: typeof snap.phase === "string" ? snap.phase : state.phase,
        artifactCount:
          typeof snap.artifactCount === "number" ? snap.artifactCount : state.artifactCount,
        pending: pending.pending === true,
        pendingSummary: Array.isArray(pending.summary) ? (pending.summary as string[]) : [],
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
      {
        ok: true,
        saved: false,
        pending: true,
        restacked: Boolean(out.restacked),
        summary,
        newChanges: fresh,
        message:
          "아직 저장하지 않았습니다. summary를 업무 말로 그대로 전한 뒤 「이대로 저장할까요? 아니면 더 고칠까요?」라고 묻고 이번 턴을 끝내세요. 승인하면 prd_apply, 취소하면 prd_discard, 더 고치면 prd_propose를 다시 부르세요.",
      },
      runId,
    );
  };

  if (name === "prd_save") {
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
    return applySnap(
      {
        ok: true,
        ...out,
        message:
          "답이 반영됐습니다. phase=ready면 즉시 prd_build를 호출하세요. 사용자에게 나중이라고 말하지 마세요.",
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
    return applySnap(
      {
        ok: true,
        ...out,
        // A staged draft is what the next edit must build on, so hand the model that text
        // rather than the saved one — otherwise a follow-up edit silently drops the first.
        pending: pending.pending === true,
        pendingSummary: pending.summary,
        content: pending.pending === true ? pending.content : out.content,
        message:
          pending.pending === true
            ? "승인 대기 중인 변경안이 있습니다. content는 그 변경안 본문입니다. 사용자가 승인하면 prd_apply, 더 고치면 이 본문을 고쳐 prd_propose 하세요."
            : undefined,
      },
      runId,
    );
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
        message: `와이어프레임 ${n}개 화면 생성 완료. 사용자에게 「와이어프레임」 탭에서 보고 수정·승인하라고 안내하세요.`,
      },
      state: { ...gate.state, built: true, artifactCount: n, phase: "ready" },
    };
  }

  return { result: { ok: false, error: `unknown tool: ${name}` }, state };
}

async function chatCompletion(messages: ChatMessage[]): Promise<ChatMessage> {
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
  };
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("OpenAI returned empty message");
  return message;
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

  // Auto-answer screen_layout from recent short user replies
  const layoutQ = curOpen.find((q) => q.topic === "screen_layout" || /화면\s*(형태|양식)/.test(q.question));
  if (cur.runId && layoutQ && cur.phase === "layout") {
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
      }
    }
  }

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
    // Avoid rebuilding if artifacts already exist unless user explicitly asked
    if ((cur.artifactCount ?? 0) > 0 && !wantsBuild(userText)) {
      return { state: cur, open: curOpen };
    }
    const out = prdBuild({ root, runId: cur.runId, project: cur.project });
    if (out.ok !== false) {
      const n = Array.isArray(out.screens) ? out.screens.length : Number(out.artifactCount || 0);
      cur = { ...cur, built: true, artifactCount: n, phase: "ready" };
      return {
        state: cur,
        open: curOpen,
        note: `화면 형태까지 반영해 와이어프레임 ${n}개 화면을 만들었습니다. 「와이어프레임」 탭에서 확인한 뒤, 고칠 점을 말하고 마음에 들면 승인해 주세요.`,
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
      (state.pending
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

  for (let round = 0; round < 8; round += 1) {
    const assistant = await chatCompletion(messages);
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
          ? `와이어프레임 ${state.artifactCount ?? ""}개 화면을 만들었습니다. 「와이어프레임」 탭에서 확인해 주세요.`
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
  };
}
