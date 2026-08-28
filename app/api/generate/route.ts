import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { ALLOWED_MODELS, CREATE_ACK_MS, MAX_SOURCE_TEXT, MAX_UPLOAD_BYTES } from "@/lib/constants";
import {
  cancelCloudRun,
  causeMessage,
  getCloudRun,
  getLatestRunId,
  GenerationError,
} from "@/lib/cursor-cloud";
import { docFromRunResult, startWireframeRun } from "@/lib/wireframe/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 와이어프레임 생성 — 상태를 서버에 두지 않는다.
 *
 * POST 는 agentId만 정해서 착수시키고 바로 돌려준다. 진행 상태는 Cursor 쪽
 * run에 있으므로 클라이언트가 GET으로 폴링한다. 그래서 DB도, 잡 큐도, cron도
 * 필요 없고 Vercel 함수 시간 제한에도 걸리지 않는다.
 *
 * 착수 요청(POST /v1/agents)은 20초를 넘기는 일이 잦다. 응답을 끝까지 기다리지
 * 않고 agentId만 먼저 반환한 뒤, 남은 요청은 after()로 함수 수명 안에서 계속
 * 굴린다. 클라이언트는 agentId로 폴링하다가 run이 잡히면 그때부터 따라간다.
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
    return { sourceText: text, model: typeof model === "string" ? model : undefined };
  }

  const parsed = jsonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new GenerationError("PRD 내용을 입력하세요.");
  return parsed.data;
}

/** 생성 착수 */
export async function POST(req: NextRequest) {
  try {
    const { sourceText, model } = await readSource(req);
    const started = startWireframeRun({ sourceText, model });

    // 인증 오류·검증 오류는 1초 안에 돌아온다. 그 창까지만 기다렸다가
    // 즉시 실패로 알려주고, 넘어가면 agentId만 주고 폴링에 맡긴다.
    const settled = await Promise.race([
      started.created.then(() => "ok" as const).catch((e: unknown) => e),
      new Promise<"pending">((r) => setTimeout(() => r("pending"), CREATE_ACK_MS)),
    ]);

    if (settled !== "ok" && settled !== "pending") {
      if (settled instanceof GenerationError) return fail(settled.message);
      throw settled;
    }
    if (settled === "pending") {
      // 응답을 보낸 뒤에도 착수 요청이 끝까지 가도록 함수를 붙잡아 둔다.
      after(started.created.catch((e: unknown) => {
        console.error("[generate] create failed after ack:", causeMessage(e));
      }));
    }

    return NextResponse.json({ agentId: started.agentId, model: started.model }, { status: 202 });
  } catch (e) {
    if (e instanceof GenerationError) return fail(e.message);
    console.error("[generate] POST failed:", causeMessage(e));
    return fail("생성 요청에 실패했습니다.", 500);
  }
}

/** 폴링 — 끝났으면 IR까지 같이 준다 */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) return fail("agentId가 필요합니다.");

  try {
    // 착수 응답을 기다리지 않았으므로 run id는 여기서 따라잡는다.
    const runId = req.nextUrl.searchParams.get("runId") || (await getLatestRunId(agentId));
    if (!runId) return NextResponse.json({ status: "CREATING" });

    const run = await getCloudRun(agentId, runId);

    if (run.status === "CREATING" || run.status === "RUNNING") {
      return NextResponse.json({ status: run.status, runId });
    }
    if (run.status !== "FINISHED") {
      return NextResponse.json({
        status: run.status,
        runId,
        error: run.error || `생성이 ${run.status} 상태로 끝났습니다.`,
      });
    }

    return NextResponse.json({
      status: "FINISHED",
      runId,
      doc: docFromRunResult(run.result),
      // ?raw=1 — 모델이 실제로 뭘 뱉었는지 보기 위한 디버그용.
      // 화면이 비어 나올 때 coerce가 깎아낸 건지 모델이 안 만든 건지 가른다.
      ...(req.nextUrl.searchParams.get("raw") ? { raw: run.result } : {}),
    });
  } catch (e) {
    if (e instanceof GenerationError) return fail(e.message);
    console.error("[generate] GET failed:", causeMessage(e));
    return fail("상태 조회에 실패했습니다.", 500);
  }
}

/** 생성 중단 */
export async function DELETE(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) return fail("agentId가 필요합니다.");

  try {
    const runId = req.nextUrl.searchParams.get("runId") || (await getLatestRunId(agentId));
    if (runId) await cancelCloudRun(agentId, runId);
  } catch (e) {
    console.warn("[generate] cancel failed:", causeMessage(e));
  }
  return NextResponse.json({ ok: true });
}
