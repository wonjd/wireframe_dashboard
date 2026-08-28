import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { getLatestRevision } from "@/lib/prd-service";
import { coerceWireframeDoc } from "@/lib/wireframe/coerce";
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

    const doc = coerceWireframeDoc(JSON.parse(wireframe.docJson));
    const current = await getLatestRevision(wireframe.prdId);

    return NextResponse.json({
      ...toWireframeListItem(wireframe, current?.id ?? null, wireframe.prdRevision),
      prdId: wireframe.prdId,
      doc,
    });
  });
}
