import { ALLOWED_MODELS, MAX_PROMPT_SOURCE, MODELS } from "../constants";
import { createCloudAgent, GenerationError, newAgentId } from "../cursor-cloud";
import { coerceWireframeDoc } from "./coerce";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import type { WireframeDoc } from "./schema";

export { GenerationError };

export function pickModel(requested?: string): string {
  if (requested && (ALLOWED_MODELS as readonly string[]).includes(requested)) return requested;
  return MODELS.default;
}

function truncateSource(text: string): string {
  if (text.length <= MAX_PROMPT_SOURCE) return text;
  return text.slice(0, MAX_PROMPT_SOURCE) + "\n\n...(PRD 일부 생략)";
}

export function buildPrompt(sourceText: string): string {
  return SYSTEM_PROMPT + "\n\n" + userPrompt(truncateSource(sourceText));
}

/**
 * Cursor Cloud agent 착수.
 *
 * agentId를 먼저 정하고 요청을 보낸다. 착수 응답(POST /v1/agents)은 20초를
 * 넘길 때가 잦은데, id를 이미 알고 있으므로 응답을 못 기다려도 폴링으로
 * 결과를 따라갈 수 있다. 그래서 agentId와 진행 중인 Promise를 함께 돌려준다.
 */
export function startWireframeRun(input: { sourceText: string; model?: string }): {
  agentId: string;
  model: string;
  created: Promise<void>;
} {
  const model = pickModel(input.model);
  const agentId = newAgentId();
  const created = createCloudAgent({
    agentId,
    prompt: buildPrompt(input.sourceText),
    model,
  });
  return { agentId, model, created };
}

/** 에이전트 최종 텍스트에서 JSON을 꺼낸다 — 코드펜스/앞뒤 설명이 섞여 와도 견딘다. */
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new GenerationError("모델 응답이 비어 있습니다.");

  try {
    return JSON.parse(trimmed);
  } catch {
    // 아래 폴백으로
  }

  const fenceStart = trimmed.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = trimmed.indexOf("\n", fenceStart);
    const fenceEnd = trimmed.indexOf("```", afterFence + 1);
    if (afterFence !== -1 && fenceEnd !== -1) {
      try {
        return JSON.parse(trimmed.slice(afterFence + 1, fenceEnd).trim());
      } catch {
        // 아래 폴백으로
      }
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // 폴백 실패
    }
  }

  throw new GenerationError("모델 응답에서 JSON을 찾지 못했습니다.");
}

/** 완료된 run의 결과 텍스트 → 렌더러가 바로 그릴 수 있는 IR. */
export function docFromRunResult(text: string | undefined): WireframeDoc {
  let raw: unknown;
  if (text) {
    try {
      raw = extractJsonFromText(text);
    } catch {
      raw = undefined;
    }
  }
  return coerceWireframeDoc(raw ?? {});
}
