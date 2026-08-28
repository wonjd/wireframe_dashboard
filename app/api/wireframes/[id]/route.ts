import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, apiError, handle } from "@/lib/api-error";
import { getLatestRevision } from "@/lib/prd-service";
import { wireframeDocSchema } from "@/lib/wireframe/schema";
import { toWireframeListItem } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const wireframe = await db.wireframe.findUnique({
      where: { id },
      include: {
        prdRevision: { include: { author: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!wireframe) throw new ApiError("NOT_FOUND", "와이어프레임을 찾을 수 없습니다.");

    // 저장된 docJson을 서버에서 파싱·검증해 내려준다.
    // 여기서 실패하면 렌더러 버그가 아니라 데이터 문제이므로 422로 구분한다 (§10.2).
    const parsed = wireframeDocSchema.safeParse(JSON.parse(wireframe.docJson));
    if (!parsed.success) {
      return apiError("GENERATION_FAILED", "저장된 와이어프레임이 현재 스키마와 맞지 않습니다.");
    }

    const current = await getLatestRevision(wireframe.prdId);

    return NextResponse.json({
      ...toWireframeListItem(wireframe, current?.id ?? null, wireframe.prdRevision),
      prdId: wireframe.prdId,
      doc: parsed.data,
    });
  });
}
