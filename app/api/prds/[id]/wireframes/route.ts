import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { getLatestRevision } from "@/lib/prd-service";
import { toWireframeListItem } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const prd = await db.prd.findUnique({ where: { id }, select: { id: true } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

    const [wireframes, current] = await Promise.all([
      db.wireframe.findMany({
        where: { prdId: id },
        orderBy: { version: "desc" },
        include: {
          prdRevision: { include: { author: { select: { id: true, name: true, email: true } } } },
        },
      }),
      getLatestRevision(id),
    ]);

    return NextResponse.json({
      items: wireframes.map((w) => toWireframeListItem(w, current?.id ?? null, w.prdRevision)),
    });
  });
}
