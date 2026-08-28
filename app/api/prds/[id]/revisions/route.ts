import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { toRevisionListItem } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PRD 변경 이력 — §8.
 * 목록에는 원문(sourceText)을 싣지 않는다. 단건 조회(/api/revisions/[id])에서만 준다.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const prd = await db.prd.findUnique({ where: { id }, select: { id: true } });
    if (!prd) throw new ApiError("NOT_FOUND", "PRD를 찾을 수 없습니다.");

    const revisions = await db.prdRevision.findMany({
      where: { prdId: id },
      orderBy: { revision: "desc" },
      include: {
        author: { select: { id: true, name: true, email: true } },
        wireframes: { select: { version: true }, orderBy: { version: "asc" } },
      },
    });

    const currentId = revisions[0]?.id ?? null;

    return NextResponse.json({
      items: revisions.map((r) =>
        toRevisionListItem(r, {
          isCurrent: r.id === currentId,
          wireframeVersions: r.wireframes.map((w) => w.version),
        })
      ),
    });
  });
}
