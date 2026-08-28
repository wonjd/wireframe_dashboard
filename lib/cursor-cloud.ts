/**
 * Cursor Cloud REST.
 *
 * agent 생성(POST /v1/agents)은 20초를 넘길 때가 많다. 그래서 agentId를
 * 클라이언트가 `bc-<uuid>`로 정해서 보낸다 — 응답을 못 받아도 id를 이미 알고
 * 있으므로 폴링으로 따라잡을 수 있고, 같은 id로 다시 POST하면 409라 중복 생성도
 * 안 된다. 재시도는 GET에만 건다 (POST 재시도 = 중복 생성).
 */

/** 사용자에게 그대로 보여줄 수 있는 생성 실패. */
export class GenerationError extends Error {}

export const CURSOR_API_BASE =
  process.env.CURSOR_API_BASE_URL?.replace(/\/$/, "") || "https://api.cursor.com";

const CREATE_TIMEOUT_MS = 50_000;
const POLL_TIMEOUT_MS = 15_000;
const GET_RETRIES = 3;

export type CloudRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export type CloudRunSnapshot = {
  status: CloudRunStatus;
  result?: string;
  error?: string;
};

/** fetch 헤더는 ASCII(ByteString)만 허용 — 복붙 시 •·스마트 따옴표·BOM 제거 */
function normalizeApiKey(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201C\u201D`\u00B4]/g, "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/[^\x21-\x7E]/g, "")
    .trim();
}

function apiKey(): string {
  const raw = process.env.CURSOR_API_KEY?.trim();
  if (!raw) {
    throw new GenerationError(
      "CURSOR_API_KEY가 설정되지 않았습니다. 환경 변수에 키를 넣고 다시 배포하세요."
    );
  }
  const key = normalizeApiKey(raw);
  if (!key) {
    throw new GenerationError(
      "CURSOR_API_KEY가 비어 있습니다. crsr_... 형태의 키만 붙여넣으세요."
    );
  }
  if (key.length !== raw.length || /[^\x20-\x7E]/.test(raw)) {
    console.warn("[cursor-cloud] CURSOR_API_KEY에서 비-ASCII/따옴표 문자를 제거했습니다.");
  }
  return key;
}

export function causeMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code;
    parts.push(code ? cause.message + " (" + code + ")" : cause.message);
  } else if (cause != null) {
    parts.push(String(cause));
  }
  return parts.join(" — ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableNetwork(e: unknown): boolean {
  const msg = causeMessage(e).toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("abort")
  );
}

function formatApiError(
  method: string,
  path: string,
  status: number,
  json: unknown,
  text: string
): string {
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const nested =
    obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : obj;
  const code = typeof nested.code === "string" ? nested.code : undefined;
  const message =
    typeof nested.message === "string"
      ? nested.message
      : typeof obj.message === "string"
        ? obj.message
        : text.slice(0, 300) || "HTTP " + status;
  return "[" + (code ?? status) + "] " + message + " (" + method + " " + path + ")";
}

type FetchOpts = {
  body?: unknown;
  timeoutMs?: number;
  /** POST는 재시도하지 않는다 — 같은 작업을 두 번 만들 수 있다. */
  retries?: number;
  /** 404를 오류가 아니라 null로 받고 싶을 때 (아직 안 만들어진 agent 조회) */
  notFoundOk?: boolean;
};

async function cursorFetch(method: string, path: string, opts: FetchOpts = {}): Promise<unknown> {
  const url = CURSOR_API_BASE + path;
  const headers: Record<string, string> = {
    Authorization: "Bearer " + apiKey(),
    "x-cursor-client-type": "sdk",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const retries = opts.retries ?? 1;
  let last: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? POLL_TIMEOUT_MS),
      });
      if (res.status === 404 && opts.notFoundOk) return null;

      const text = await res.text().catch(() => "");
      let json: unknown = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        throw new GenerationError(formatApiError(method, path, res.status, json, text));
      }
      return json;
    } catch (e) {
      last = e;
      if (e instanceof GenerationError) throw e;
      if (!(attempt < retries && isRetryableNetwork(e))) {
        if (causeMessage(e).includes("ByteString")) {
          throw new GenerationError(
            "CURSOR_API_KEY에 •·스마트 따옴표·보이지 않는 문자가 섞였습니다. 환경 변수에 crsr_... 키만 다시 붙여넣으세요."
          );
        }
        throw new GenerationError(
          "Cursor API 연결 실패 (" + method + " " + path + "): " + causeMessage(e)
        );
      }
      console.error(
        "[cursor-cloud] " + method + " " + path + " attempt " + attempt + " failed:",
        causeMessage(e)
      );
      await sleep(300 * attempt);
    }
  }
  throw new GenerationError(
    "Cursor API 연결 실패 (" + method + " " + path + "): " + causeMessage(last)
  );
}

/** Cursor가 요구하는 agent id 형식: bc-<uuid> */
export function newAgentId(): string {
  return "bc-" + crypto.randomUUID();
}

/**
 * agent 착수. 응답이 늦어도 agentId는 호출자가 이미 알고 있으므로,
 * 이 Promise를 끝까지 기다리지 않아도 폴링으로 결과를 따라갈 수 있다.
 */
export async function createCloudAgent(input: {
  agentId: string;
  prompt: string;
  model: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    agentId: input.agentId,
    prompt: { text: input.prompt },
    name: "wireframe",
  };
  if (input.model) {
    body.model =
      input.model === "auto-smart"
        ? { id: "auto-smart", params: [{ id: "optimize_for", value: "speed" }] }
        : { id: input.model };
  }

  await cursorFetch("POST", "/v1/agents", { body, timeoutMs: CREATE_TIMEOUT_MS });
}

/** 아직 만들어지지 않았으면 null. 만들어졌으면 최신 run id를 준다. */
export async function getLatestRunId(agentId: string): Promise<string | null> {
  const json = (await cursorFetch("GET", "/v1/agents/" + encodeURIComponent(agentId), {
    retries: GET_RETRIES,
    notFoundOk: true,
  })) as Record<string, unknown> | null;

  if (!json) return null;
  const agent =
    json.agent && typeof json.agent === "object" ? (json.agent as Record<string, unknown>) : json;
  return typeof agent.latestRunId === "string" ? agent.latestRunId : null;
}

export async function getCloudRun(agentId: string, runId: string): Promise<CloudRunSnapshot> {
  const json = (await cursorFetch(
    "GET",
    "/v1/agents/" + encodeURIComponent(agentId) + "/runs/" + encodeURIComponent(runId),
    { retries: GET_RETRIES }
  )) as Record<string, unknown>;

  const status = (typeof json.status === "string" ? json.status : "RUNNING") as CloudRunStatus;
  const result = typeof json.result === "string" ? json.result : undefined;
  const errObj =
    json.error && typeof json.error === "object"
      ? (json.error as Record<string, unknown>)
      : undefined;
  const error =
    typeof json.error === "string"
      ? json.error
      : typeof errObj?.message === "string"
        ? errObj.message
        : undefined;

  return { status, result, error };
}

export async function cancelCloudRun(agentId: string, runId: string): Promise<void> {
  try {
    await cursorFetch(
      "POST",
      "/v1/agents/" + encodeURIComponent(agentId) + "/runs/" + encodeURIComponent(runId) + "/cancel"
    );
  } catch (e) {
    console.warn("[cursor-cloud] cancel failed:", causeMessage(e));
  }
}
