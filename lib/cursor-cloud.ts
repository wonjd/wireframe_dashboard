import { GenerationError } from "./wireframe/generate-errors";

/** Cursor Cloud REST. Create returns immediately; completion is polled. */

export const CURSOR_API_BASE =
  process.env.CURSOR_API_BASE_URL?.replace(/\/$/, "") || "https://api.cursor.com";

const CREATE_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 15_000;
const RETRIES = 3;

export type CloudRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export type CloudAgentRef = { agentId: string; runId: string };

export type CloudRunSnapshot = {
  status: CloudRunStatus;
  result?: string;
  error?: string;
};

function apiKey(): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new GenerationError(
      "CURSOR_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요."
    );
  }
  return key;
}

export function causeMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code;
    parts.push(code ? "" + cause.message + " (" + code + ")" : cause.message);
  } else if (cause != null) {
    parts.push(String(cause));
  }
  return parts.join(" ? ");
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
        : text.slice(0, 300) || ("HTTP " + status);
  return "[" + (code ?? status) + "] " + message + " (" + method + " " + path + ")";
}

async function cursorFetch(
  method: string,
  path: string,
  opts?: { body?: unknown; timeoutMs?: number }
): Promise<unknown> {
  const url = CURSOR_API_BASE + path;
  const headers: Record<string, string> = {
    Authorization: "Bearer " + apiKey(),
    "x-cursor-client-type": "sdk",
  };
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";

  let last: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(opts?.timeoutMs ?? POLL_TIMEOUT_MS),
      });
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
      if (!(attempt < RETRIES && isRetryableNetwork(e))) {
        throw new GenerationError(
          "Cursor API 연결 실패 (" + method + " " + path + "): " + causeMessage(e)
        );
      }
      console.error("[cursor-cloud] " + method + " " + path + " attempt " + attempt + " failed:", causeMessage(e));
      await sleep(300 * attempt);
    }
  }
  throw new GenerationError(
    "Cursor API 연결 실패 (" + method + " " + path + "): " + causeMessage(last)
  );
}

export async function createCloudAgent(input: {
  prompt: string;
  model: string;
}): Promise<CloudAgentRef> {
  const body: Record<string, unknown> = {
    prompt: { text: input.prompt },
    name: "wireframe",
  };
  if (input.model) {
    body.model =
      input.model === "auto-smart"
        ? { id: "auto-smart", params: [{ id: "optimize_for", value: "speed" }] }
        : { id: input.model };
  }

  const json = (await cursorFetch("POST", "/v1/agents", {
    body,
    timeoutMs: CREATE_TIMEOUT_MS,
  })) as Record<string, unknown>;

  const agent =
    json.agent && typeof json.agent === "object"
      ? (json.agent as Record<string, unknown>)
      : json;
  const run =
    json.run && typeof json.run === "object" ? (json.run as Record<string, unknown>) : undefined;
  const agentId = typeof agent.id === "string" ? agent.id : undefined;
  const runId =
    (run && typeof run.id === "string" ? run.id : undefined) ??
    (typeof agent.latestRunId === "string" ? agent.latestRunId : undefined);

  if (!agentId || !runId) {
    throw new GenerationError("Cursor Cloud agent 응답에 id가 없습니다.");
  }
  return { agentId, runId };
}

export async function getCloudRun(agentId: string, runId: string): Promise<CloudRunSnapshot> {
  const json = (await cursorFetch(
    "GET",
    "/v1/agents/" + encodeURIComponent(agentId) + "/runs/" + encodeURIComponent(runId)
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
