import { db } from "@/lib/db";
import { PrdTable, type PrdRow } from "@/components/prd/prd-table";

export const dynamic = "force-dynamic";

/** PRD 전체 목록 — 어드민 테이블 (검색 + 상태 필터). */
export default async function HomePage() {
  const prds = await db.prd.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      wireframes: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
      revisions: {
        select: { revision: true, author: { select: { name: true } } },
        orderBy: { revision: "desc" },
        take: 1,
      },
    },
  });

  const rows: PrdRow[] = prds.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    version: p.wireframes[0]?.version ?? null,
    revision: p.revisions[0]?.revision ?? null,
    lastEditor: p.revisions[0]?.author.name ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-neutral-800">PRD 전체 목록</h1>
      <PrdTable rows={rows} />
    </div>
  );
}
