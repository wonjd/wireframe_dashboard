import { ALLOWED_MODELS, MAX_PROMPT_SOURCE, MODELS } from "../constants";
import type { WireframeDoc } from "./schema";
import { SYSTEM_PROMPT, userPrompt } from "./prompt";
import { coerceWireframeDoc } from "./coerce";
import { extractJsonFromText } from "./generate-agent-run";
import { GenerationError } from "./generate-errors";
import { createCloudAgent } from "../cursor-cloud";

export type GenerateInput = {
  sourceText: string;
  model?: string;
};

export type CloudStartResult = { agentId: string; runId: string; model: string };
export type GenerateResult = { doc: WireframeDoc; model: string };

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

export async function startCloudWireframe(input: GenerateInput): Promise<CloudStartResult> {
  const model = pickModel(input.model);
  const { agentId, runId } = await createCloudAgent({
    prompt: buildPrompt(input.sourceText),
    model,
  });
  return { agentId, runId, model };
}

export function docFromAgentResult(text: string | undefined, model: string): GenerateResult {
  let raw: unknown;
  if (text) {
    try {
      raw = extractJsonFromText(text);
    } catch {
      raw = undefined;
    }
  }
  return { doc: coerceWireframeDoc(raw ?? {}), model };
}
