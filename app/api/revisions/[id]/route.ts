import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { toUserDto } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

/** 리비전 단건 — 그 시점 원문을 포함한다 (§8.3). 수정/삭제 API는 두지 않는다. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const rev = await db.prdRevision.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, email: true } },
        wireframes: { select: { id: true, version: true }, orderBy: { version: "asc" } },
      },
    });
    if (!rev) throw new ApiError("NOT_FOUND", "리비전을 찾을 수 없습니다.");

    const current = await db.prdRevision.findFirst({
      where: { prdId: rev.prdId },
      orderBy: { revision: "desc" },
      select: { id: true },
    });

    return NextResponse.json({
      id: rev.id,
      prdId: rev.prdId,
      revision: rev.revision,
      source: rev.source,
      sourceText: rev.sourceText,
      author: toUserDto(rev.author),
      createdAt: rev.createdAt,
      isCurrent: current?.id === rev.id,
      wireframes: rev.wireframes,
    });
  });
}
