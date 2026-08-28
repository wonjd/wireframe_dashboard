import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ALLOWED_MODELS, MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { cancelCloudRun, causeMessage, getCloudRun, GenerationError } from "@/lib/cursor-cloud";
import { docFromRunResult, startWireframeRun } from "@/lib/wireframe/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 와이어프레임 생성 — 상태를 서버에 두지 않는다.
 *
 * POST 는 Cursor Cloud agent를 착수시키고 (agentId, runId)만 돌려준다.
 * 진행 상태는 Cursor 쪽에 있으므로 클라이언트가 GET으로 폴링한다.
 * 그래서 DB도, 잡 큐도, cron도 필요 없고 Vercel 함수 시간 제한에도 걸리지 않는다.
 */

const jsonBody = z.object({
  sourceText: z.string().min(1).max(MAX_SOURCE_TEXT),
  model: z.enum(ALLOWED_MODELS).optional(),
});

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function readSource(req: NextRequest): Promise<{ sourceText: string; model?: string }> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new GenerationError("PRD 파일이 필요합니다.");
    if (file.size > MAX_UPLOAD_BYTES) throw new GenerationError("파일이 너무 큽니다 (최대 1MB).");

    const text = await file.text();
    if (!text.trim()) throw new GenerationError("파일이 비어 있습니다.");
    if (text.length > MAX_SOURCE_TEXT) {
      throw new GenerationError(`PRD가 너무 깁니다 (최대 ${MAX_SOURCE_TEXT}자).`);
    }

    const model = form.get("model");
    return {
      sourceText: text,
      model: typeof model === "string" ? model : undefined,
    };
  }

  const parsed = jsonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new GenerationError("PRD 내용을 입력하세요.");
  return parsed.data;
}

/** 생성 착수 */
export async function POST(req: NextRequest) {
  try {
    const { sourceText, model } = await readSource(req);
    const started = await startWireframeRun({ sourceText, model });
    return NextResponse.json(started, { status: 202 });
  } catch (e) {
    if (e instanceof GenerationError) return fail(e.message);
    console.error("[generate] POST failed:", causeMessage(e));
    return fail("생성 요청에 실패했습니다.", 500);
  }
}

/** 폴링 — 끝났으면 IR까지 같이 준다 */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  const runId = req.nextUrl.searchParams.get("runId");
  if (!agentId || !runId) return fail("agentId, runId가 필요합니다.");

  try {
    const run = await getCloudRun(agentId, runId);

    if (run.status === "CREATING" || run.status === "RUNNING") {
      return NextResponse.json({ status: run.status });
    }
    if (run.status !== "FINISHED") {
      return NextResponse.json({
        status: run.status,
        error: run.error || `생성이 ${run.status} 상태로 끝났습니다.`,
      });
    }

    return NextResponse.json({ status: "FINISHED", doc: docFromRunResult(run.result) });
  } catch (e) {
    if (e instanceof GenerationError) return fail(e.message);
    console.error("[generate] GET failed:", causeMessage(e));
    return fail("상태 조회에 실패했습니다.", 500);
  }
}

/** 생성 중단 */
export async function DELETE(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  const runId = req.nextUrl.searchParams.get("runId");
  if (!agentId || !runId) return fail("agentId, runId가 필요합니다.");

  await cancelCloudRun(agentId, runId);
  return NextResponse.json({ ok: true });
}
