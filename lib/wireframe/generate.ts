import Anthropic from "@anthropic-ai/sdk";
import { ALLOWED_MODELS, MODELS } from "../constants";
import { wireframeDocSchema, type WireframeDoc } from "./schema";
import { EMIT_TOOL } from "./tool-schema";
import { SYSTEM_PROMPT, incrementalAnchor, retryPrompt, userPrompt } from "./prompt";

export type GenerateInput = {
  sourceText: string;
  model?: string;
  /** T2 증분 재생성일 때만 전달 — 직전 버전의 docJson (§6.5) */
  previousDocJson?: string;
};

export type GenerateResult = { doc: WireframeDoc; model: string };

export class GenerationError extends Error {}

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new GenerationError(
      "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요."
    );
  }
  return new Anthropic({ apiKey });
}

function pickModel(requested?: string): string {
  if (requested && (ALLOWED_MODELS as readonly string[]).includes(requested)) return requested;
  return MODELS.default;
}

/** tool_use 블록에서 IR을 꺼낸다. 도구를 안 쓰고 텍스트로 답한 경우는 실패로 본다. */
function extractToolInput(msg: Anthropic.Message): unknown {
  for (const block of msg.content) {
    if (block.type === "tool_use" && block.name === EMIT_TOOL.name) return block.input;
  }
  throw new GenerationError("모델이 emit_wireframe 도구를 호출하지 않았습니다.");
}

function formatIssues(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    return issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  }
  return String(err);
}

/**
 * PRD → IR 생성 — §4, §13.
 *
 * 도구 호출로 형태를 강제하고, 받은 JSON을 서버에서 Zod로 다시 검증한다.
 * 검증에 실패하면 오류 목록을 그대로 붙여 1회 재시도한다 (§13.3).
 * 검증을 통과한 것만 저장되므로 렌더러는 깨진 문서를 만나지 않는다.
 */
export async function generateWireframe(input: GenerateInput): Promise<GenerateResult> {
  const anthropic = client();
  const model = pickModel(input.model);
  const anchor = input.previousDocJson ? incrementalAnchor(input.previousDocJson) : undefined;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt(input.sourceText, anchor) },
  ];

  let lastIssues = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TOOL],
      tool_choice: { type: "tool", name: EMIT_TOOL.name },
      messages,
    });

    let raw: unknown;
    try {
      raw = extractToolInput(msg);
    } catch (e) {
      if (attempt === 1) throw e;
      lastIssues = e instanceof Error ? e.message : String(e);
      messages.push({ role: "assistant", content: msg.content });
      messages.push({ role: "user", content: retryPrompt(lastIssues) });
      continue;
    }

    const parsed = wireframeDocSchema.safeParse(raw);
    if (parsed.success) return { doc: parsed.data, model };

    lastIssues = formatIssues(parsed.error);
    if (attempt === 1) break;

    // 실패한 출력을 대화에 남긴 채 오류를 알려줘야 모델이 무엇을 고칠지 안다.
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: retryPrompt(lastIssues) });
  }

  throw new GenerationError(`IR 검증에 실패했습니다 (재시도 1회 포함).\n${lastIssues}`);
}
