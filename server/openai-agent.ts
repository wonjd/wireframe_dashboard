import { openAiModel, requireOpenAiKey } from "./env.js";
import { prdAnswer, prdGet, prdReview, prdSave } from "./prd-tools.js";

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
        "Save or update a business PRD (plain language). Creates a run if run_id omitted. Always review after save.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short PRD title" },
          content: { type: "string", description: "Full PRD markdown body" },
          run_id: { type: "string", description: "Existing run id to update" },
          project: { type: "string", description: "default crm" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_review",
      description: "Find missing business decisions (확정·보완). Returns open questions in plain Korean.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          project: { type: "string" },
        },
        required: ["run_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_answer",
      description:
        "Confirm user answers into ## 확인된 결정, then re-review. Map each user reply to open question ids. '없다/없음' is a valid answer. Partial answers are OK.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          project: { type: "string" },
          answers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                answer: { type: "string" },
              },
              required: ["id", "answer"],
            },
          },
        },
        required: ["run_id", "answers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prd_get",
      description: "Read current PRD text, status, and clarifications for a run.",
      parameters: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          project: { type: "string" },
        },
        required: ["run_id"],
      },
    },
  },
] as const;

const SYSTEM = `당신은 와이어프레임 대시보드 안의 PRD 확정·보완 에이전트입니다.
목표: 비개발자가 쓴 업무 PRD를 분석하고, 애매한 결정을 쉬운 말로 물어 확정한 뒤 PRD를 ready로 만듭니다.
지금은 와이어프레임 HTML 생성은 하지 마세요. PRD 확정만 합니다.

규칙:
- 개발 용어(테이블, 컬럼, API, 코드값, 경로, modify/extend)를 사용자에게 말하지 마세요.
- 도구로 저장·검토·답변 반영하세요. 추측으로 결정하지 마세요.
- prd_review에 open 질문이 있으면, 번호를 매겨 업무 말로 묻고 사용자 답을 기다리세요.
- 사용자 답이 오면 **반드시** open 질문 id마다 prd_answer로 반영하세요. 말로만 되묻지 마세요.
- 「없다 / 없음 / 해당 없음」도 유효한 답입니다. 선택지·조건부 칸이 없다는 뜻으로 그대로 반영하세요. 같은 질문을 다시 묻지 마세요.
- 이미 PRD 본문에 적힌 선택지(예: 이미지/영상)나 화면 이름(예: 소재 요청 화면)은 다시 묻지 마세요.
- 화면 형태(모달/표/페이지 등)는 **애매한 업무 질문이 다 끝나고 status=ready(승인)인 뒤**에만 묻습니다. phase=layout이면 형태만 묻고, phase=ready일 때만 빌드하세요.
- 한 번에 일부만 답해도 prd_answer로 반영한 뒤, 남은 open만 이어서 물으세요.
- status=ready이고 phase=layout이면 "PRD는 확정됐습니다. 화면 형태만 알려 주세요"라고 하세요.
- status=ready이고 open이 비면 "PRD·화면 양식이 확정됐습니다"라고 짧게 알리세요.
- 한국어로 답하세요.`;

type AgentState = {
  runId?: string;
  project: string;
  status?: string;
};

function runTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  state: AgentState,
): { result: Record<string, unknown>; state: AgentState } {
  const project = String(args.project || state.project || "crm");
  if (name === "prd_save") {
    const out = prdSave({
      root,
      title: String(args.title || "제목 없음"),
      content: String(args.content || ""),
      project,
      runId: args.run_id ? String(args.run_id) : state.runId,
    });
    const runId = String(out.runId || state.runId || "");
    const review = out.review as { status?: string } | undefined;
    return {
      result: out,
      state: {
        ...state,
        project,
        runId: runId || state.runId,
        status: review?.status || state.status,
      },
    };
  }
  if (name === "prd_review") {
    const runId = String(args.run_id || state.runId || "");
    const out = prdReview({ root, runId, project });
    return {
      result: out,
      state: { ...state, project, runId, status: String(out.status || state.status || "") },
    };
  }
  if (name === "prd_answer") {
    const runId = String(args.run_id || state.runId || "");
    const answers = Array.isArray(args.answers)
      ? (args.answers as Array<{ id: string; answer: string }>)
      : [];
    const out = prdAnswer({ root, runId, project, answers });
    return {
      result: out,
      state: { ...state, project, runId, status: String(out.status || state.status || "") },
    };
  }
  if (name === "prd_get") {
    const runId = String(args.run_id || state.runId || "");
    const out = prdGet({ root, runId, project });
    return {
      result: out,
      state: {
        ...state,
        project,
        runId,
        status: String(out.status || state.status || ""),
      },
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
  openQuestions?: Array<{ id: string; question: string; kind?: string }>;
  trace?: string[];
};

export async function runPrdAgentChat(input: AgentChatInput): Promise<AgentChatResult> {
  let state: AgentState = {
    runId: input.runId,
    project: input.project || "crm",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const trace: string[] = [];
  let lastOpen: AgentChatResult["openQuestions"];

  for (let round = 0; round < 8; round += 1) {
    const assistant = await chatCompletion(messages);
    messages.push(assistant);

    const calls = assistant.tool_calls;
    if (!calls || calls.length === 0) {
      return {
        ok: true,
        assistantMessage: String(assistant.content || "").trim() || "(응답 없음)",
        runId: state.runId,
        project: state.project,
        status: state.status,
        openQuestions: lastOpen,
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
      const { result, state: next } = runTool(input.root, name, args, state);
      state = next;
      if (Array.isArray((result as { open?: unknown }).open)) {
        lastOpen = (result as { open: AgentChatResult["openQuestions"] }).open;
      }
      if (typeof result.status === "string") state.status = result.status;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    ok: true,
    assistantMessage: "도구 호출이 많아 여기서 멈췄습니다. 답을 이어서 보내 주세요.",
    runId: state.runId,
    project: state.project,
    status: state.status,
    openQuestions: lastOpen,
    trace,
  };
}
