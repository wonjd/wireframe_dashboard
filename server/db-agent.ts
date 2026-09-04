import { openAiModel, requireOpenAiKey } from "./env.js";
import { dbEnvStatus } from "./db-env.js";
import { listTables, runSelectQuery, type QueryResult } from "./db-query.js";
import {
  searchGlossary,
  serializeTerm,
  type GlossaryTerm,
} from "./db-glossary.js";
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
      name: "db_search_terms",
      description:
        "Search business vocabulary (word + meaning + aliases) to map user language to tables/columns. Call this FIRST for natural-language questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "User keywords or phrase, e.g. 광고주, 세금계산서",
          },
          limit: { type: "number", description: "max hits, default 12" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "db_list_tables",
      description: "List tables (name, approx rows, Korean comment/meaning).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "max tables, default 40" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "db_describe",
      description:
        "Describe a table with column names, types, and COLUMN_COMMENT meanings.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "table name" },
        },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "db_query",
      description:
        "Run a read-only SQL statement (SELECT / WITH / SHOW / DESCRIBE / EXPLAIN only). Never mutate data.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Single SELECT (or SHOW/DESCRIBE/EXPLAIN)" },
        },
        required: ["sql"],
      },
    },
  },
] as const;

const SYSTEM = `당신은 CRM/서비스 DB 조회 도우미입니다.
사용자는 비개발자입니다. 테이블·컬럼 이름을 몰라도 업무 말로 질문합니다.
조회만 가능합니다. INSERT/UPDATE/DELETE 등 수정은 절대 하지 마세요.

규칙:
- 질문이 오면 먼저 db_search_terms로 업무 단어·의미를 찾으세요. (광고주, 마케터, 소재요청, 세금계산서 등)
- 매칭된 의미·테이블을 바탕으로 필요하면 db_describe / db_query를 쓰세요.
- 사용자에게는 한국어로 의미와 결과만 설명하세요. 테이블·컬럼명은 꼭 필요할 때만 괄호로 짧게.
- SQL은 반드시 SELECT 또는 WITH / SHOW / DESCRIBE / EXPLAIN만 작성합니다. LIMIT을 둡니다.
- 개인정보가 있으면 샘플·집계로 제한하고 전체 dump를 피하세요.
- 데이터가 없으면 그렇게 말하고, 비슷한 업무 단어를 제안하세요.
- 수정·삭제 요청이면 "이 도구는 조회만 가능합니다. 작업자가 직접 수정합니다."라고 거절하세요.

사람·역할 조회 (중요):
- "마케터"는 직책/역할 단어다. USER_NAME이나 USER_ID에 '마케터' 문자열이 있는 계정을 찾지 마라.
- "마케터 한세민"처럼 이름이 오면: USER_MT에서 USER_NAME으로 USER_ID를 찾은 뒤, CONTENT_MT.CREATED_ID / REQUEST_ID 또는 다른 테이블의 MARKETER_ID로 조인/필터한다.
- 소재·제작 요청 화면 데이터는 주로 CONTENT_MT다. CONTENT_DATE는 하이픈 없는 YYYYMMDD(예: 20260903)이다.
- "없다"고 말하기 전에 이름→ID→업무테이블 순으로 한 번은 조회하라.`;

function serializeCell(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

function serializeResult(result: QueryResult): Record<string, unknown> {
  return {
    ok: true,
    sql: result.sql,
    columns: result.columns,
    rowCount: result.rowCount,
    truncated: result.truncated,
    ms: result.ms,
    rows: result.rows.map((row) => row.map(serializeCell)),
  };
}

function mergeTerms(into: GlossaryTerm[], more: GlossaryTerm[]): void {
  for (const t of more) {
    const key = `${t.word}|${t.table ?? ""}|${t.column ?? ""}`;
    if (!into.some((x) => `${x.word}|${x.table ?? ""}|${x.column ?? ""}` === key)) {
      into.push(t);
    }
  }
}

type ToolOut = {
  tool: Record<string, unknown>;
  lastResult?: QueryResult;
  matched?: GlossaryTerm[];
};

async function runTool(
  root: string,
  slug: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOut> {
  try {
    if (name === "db_search_terms") {
      const query = String(args.query || "");
      const limit = typeof args.limit === "number" ? args.limit : 12;
      const hits = await searchGlossary(root, query, { slug, limit });
      return {
        tool: {
          ok: true,
          query,
          count: hits.length,
          terms: hits.map(serializeTerm),
        },
        matched: hits,
      };
    }
    if (name === "db_list_tables") {
      const limit = typeof args.limit === "number" ? args.limit : 40;
      const result = await listTables(limit);
      return { tool: serializeResult(result), lastResult: result };
    }
    if (name === "db_describe") {
      const table = String(args.table || "").replace(/[^a-zA-Z0-9_]/g, "");
      if (!table) return { tool: { ok: false, error: "table required" } };
      const result = await runSelectQuery(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = '${table}'
        ORDER BY ORDINAL_POSITION
      `);
      return { tool: serializeResult(result), lastResult: result };
    }
    if (name === "db_query") {
      const sql = String(args.sql || "");
      const result = await runSelectQuery(sql);
      return { tool: serializeResult(result), lastResult: result };
    }
    return { tool: { ok: false, error: `unknown tool: ${name}` } };
  } catch (err) {
    return {
      tool: { ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
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
      temperature: 0.1,
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
  const usage = recordOpenAiUsage("db-agent", model, data.usage);
  return { message, usage };
}

export type DbAgentChatInput = {
  root: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  project?: string;
};

export type DbAgentChatResult = {
  ok: true;
  assistantMessage: string;
  lastQuery?: {
    sql: string;
    columns: string[];
    rows: unknown[][];
    rowCount: number;
    truncated: boolean;
    ms: number;
  };
  matchedTerms?: Array<ReturnType<typeof serializeTerm>>;
  trace?: string[];
  usage?: TokenUsage;
  usageCalls?: number;
};

function packResult(
  assistantMessage: string,
  lastResult: QueryResult | undefined,
  matched: GlossaryTerm[],
  trace: string[],
  usage?: TokenUsage,
  usageCalls?: number,
): DbAgentChatResult {
  return {
    ok: true,
    assistantMessage,
    lastQuery: lastResult
      ? {
          sql: lastResult.sql,
          columns: lastResult.columns,
          rows: lastResult.rows.map((row) => row.map(serializeCell)),
          rowCount: lastResult.rowCount,
          truncated: lastResult.truncated,
          ms: lastResult.ms,
        }
      : undefined,
    matchedTerms: matched.slice(0, 12).map(serializeTerm),
    trace,
    usage,
    usageCalls,
  };
}

export async function runDbAgentChat(input: DbAgentChatInput): Promise<DbAgentChatResult> {
  const status = dbEnvStatus();
  if (!status.ok) {
    throw new Error(`DB env 부족: ${status.missing.join(", ")}. .env의 SSH_*/DB_*를 확인하세요.`);
  }

  const root = input.root;
  const slug = input.project || "crm";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const trace: string[] = [];
  let lastResult: QueryResult | undefined;
  const matched: GlossaryTerm[] = [];
  let turnUsage = emptyUsage();
  let usageCalls = 0;

  // Prefetch terms from the latest user message so UI always has something useful
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  if (lastUser?.content) {
    try {
      const pre = await searchGlossary(root, lastUser.content, { slug, limit: 8 });
      mergeTerms(matched, pre);
    } catch {
      /* ignore */
    }
  }

  for (let round = 0; round < 8; round += 1) {
    const { message: assistant, usage } = await chatCompletion(messages);
    if (usage) {
      turnUsage = addUsage(turnUsage, usage);
      usageCalls += 1;
    }
    messages.push(assistant);

    const calls = assistant.tool_calls;
    if (!calls || calls.length === 0) {
      return packResult(
        String(assistant.content || "").trim() || "(응답 없음)",
        lastResult,
        matched,
        trace,
        turnUsage,
        usageCalls,
      );
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
      const out = await runTool(root, slug, name, args);
      if (out.lastResult) lastResult = out.lastResult;
      if (out.matched) mergeTerms(matched, out.matched);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(out.tool),
      });
    }
  }

  return packResult(
    "도구 호출이 많아 여기서 멈췄습니다. 질문을 이어서 보내 주세요.",
    lastResult,
    matched,
    trace,
    turnUsage,
    usageCalls,
  );
}
