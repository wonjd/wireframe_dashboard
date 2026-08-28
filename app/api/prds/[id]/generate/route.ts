import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, apiError, handle } from "@/lib/api-error";
import { requireUser } from "@/lib/session";
import { cancelActiveJob, createJob, findActiveJob } from "@/lib/prd-service";
import { startJobIfServer } from "@/lib/job-runner";
import { cancelCloudRun } from "@/lib/cursor-cloud";
import { ALLOWED_MODELS } from "@/lib/constants";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ model: z.enum(ALLOWED_MODELS).optional() });

/**
 * 수동 재생성 — §6.2.
 *
 * 자동 트리거(T1/T2)는 이 엔드포인트를 거치지 않고 서버 내부에서 같은 로직을 부른다.
 * 여기는 "PRD는 그대로인데 결과만 다시 뽑기"와 "실패 복구"를 위한 경로다.
 * 그래서 앵커를 걸지 않는다 — 오히려 다른 구조를 원하는 상황이기 때문이다 (§6.5).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();

    const prd = await db.prd.findUnique({ where: { id } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

    const active = await findActiveJob(id);
    if (active) {
      return apiError("GENERATION_IN_PROGRESS", "이미 생성이 진행 중입니다.");
    }

    const parsed = body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "지원하지 않는 모델입니다.");
    }

    const { job, created } = await createJob({ prdId: id, trigger: "MANUAL", userId: user.id });
    if (created) await startJobIfServer(job.id, { model: parsed.data.model });

    return NextResponse.json({ jobId: job.id, status: "PENDING" }, { status: 202 });
  });
}

/**
 * 생성 중단 — §6.2.
 *
 * 모델 호출 자체는 끊을 수 없으므로 "중단 = 결과를 버린다"로 정의한다.
 * runJob이 체크포인트마다 CANCELED를 확인하고, 이미 중단된 Job은 와이어프레임을
 * 만들지 않는다. 그래서 중단 직후 재생성해도 낡은 결과가 새 버전을 덮지 않는다.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;

    const prd = await db.prd.findUnique({ where: { id }, select: { id: true } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

    const activeJob = await findActiveJob(id);
    if (activeJob?.cursorAgentId && activeJob.cursorRunId) {
      void cancelCloudRun(activeJob.cursorAgentId, activeJob.cursorRunId);
    }

    const job = await cancelActiveJob(id);
    if (!job) throw new ApiError("NOT_FOUND", "진행 중인 생성이 없습니다.");

    return NextResponse.json({ jobId: job.id, status: job.status });
  });
}
