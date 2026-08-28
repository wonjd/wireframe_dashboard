import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

/** 폴링용 — 클라이언트가 긴 요청을 물고 있지 않게 한다 (§13.5). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const job = await db.generationJob.findFirst({
      where: { prdId: id },
      orderBy: { createdAt: "desc" },
    });

    if (!job) {
      return NextResponse.json({ jobId: null, status: null, wireframeId: null, error: null });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      trigger: job.trigger,
      wireframeId: job.wireframeId,
      error: job.error,
    });
  });
}
