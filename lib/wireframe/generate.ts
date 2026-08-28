import { ALLOWED_MODELS, MAX_PROMPT_SOURCE, MODELS } from "../constants";
import { createCloudAgent, GenerationError, newAgentId } from "../cursor-cloud";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { buildDocument } from "./shell";

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

/**
 * 에이전트 최종 텍스트에서 마크업을 꺼낸다 — 코드펜스나 앞뒤 설명이 섞여 와도 견딘다.
 *
 * JSON을 받던 때와 달리 파싱이 실패할 지점이 없다. 첫 태그부터 마지막 닫는
 * 태그까지 잘라내면 되고, 모델이 태그를 조금 어긋나게 써도 브라우저가 받아준다.
 */
export function extractMarkup(text: string): string {
  let out = text.trim();
  if (!out) throw new GenerationError("모델 응답이 비어 있습니다.");

  // ```html … ``` 코드펜스가 있으면 그 안이 곧 답이다.
  const fence = out.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  if (fence) out = fence[1].trim();

  // 앞뒤 설명 문장을 태그 경계로 잘라낸다.
  const start = out.search(/<(?:section|div|!doctype|html|body)\b/i);
  const end = out.lastIndexOf(">");
  if (start > 0 && end > start) out = out.slice(start, end + 1).trim();
  else if (start === -1) throw new GenerationError("모델 응답에서 HTML을 찾지 못했습니다.");

  return out;
}

/** 완료된 run의 결과 텍스트 → iframe에 그대로 넣을 수 있는 문서. */
export function htmlFromRunResult(text: string | undefined): string {
  let markup = "";
  if (text) {
    try {
      markup = extractMarkup(text);
    } catch {
      markup = "";
    }
  }
  if (!markup) {
    markup =
      '<section data-screen="empty" data-name="빈 결과">' +
      '<div class="wf-body"><h1>생성 결과가 비어 있습니다</h1>' +
      "<p>다시 생성하거나 PRD 내용을 더 구체적으로 적어 보세요.</p></div></section>";
  }
  return buildDocument(markup);
}
