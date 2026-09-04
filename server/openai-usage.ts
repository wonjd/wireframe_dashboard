export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type TokenUsageEvent = TokenUsage & {
  at: string;
  label: string;
  model: string;
  calls?: number;
};

const sessionTotals: TokenUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};

const recent: TokenUsageEvent[] = [];
const RECENT_MAX = 40;

function asUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const total = Number(u.total_tokens ?? prompt + completion);
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null;
  return {
    prompt_tokens: Math.max(0, prompt || 0),
    completion_tokens: Math.max(0, completion || 0),
    total_tokens: Math.max(0, total || 0),
  };
}

export function emptyUsage(): TokenUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

/** Record one Chat Completions `usage` object. Logs to server console. */
export function recordOpenAiUsage(
  label: string,
  model: string,
  rawUsage: unknown,
): TokenUsage | null {
  const usage = asUsage(rawUsage);
  if (!usage) return null;

  sessionTotals.prompt_tokens += usage.prompt_tokens;
  sessionTotals.completion_tokens += usage.completion_tokens;
  sessionTotals.total_tokens += usage.total_tokens;

  const event: TokenUsageEvent = {
    ...usage,
    at: new Date().toISOString(),
    label,
    model,
  };
  recent.push(event);
  if (recent.length > RECENT_MAX) recent.shift();

  console.log(
    `[openai-tokens] ${label} model=${model} in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens} | session in=${sessionTotals.prompt_tokens} out=${sessionTotals.completion_tokens} total=${sessionTotals.total_tokens}`,
  );
  return usage;
}

export function getSessionTokenTotals(): TokenUsage {
  return { ...sessionTotals };
}

export function getRecentTokenEvents(): TokenUsageEvent[] {
  return [...recent];
}
