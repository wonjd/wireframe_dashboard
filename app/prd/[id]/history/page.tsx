import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { HistoryList } from "@/components/prd/history-list";

export const dynamic = "force-dynamic";

/** 이력 탭 — §12.4. 읽기 전용이며 되돌리기·삭제 조작은 없다 (§8.3). */
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prd = await db.prd.findUnique({ where: { id }, select: { id: true } });
  if (!prd) notFound();

  const revisions = await db.prdRevision.findMany({
    where: { prdId: id },
    orderBy: { revision: "desc" },
    include: {
      author: { select: { name: true } },
      wireframes: { select: { id: true, version: true }, orderBy: { version: "asc" } },
    },
  });

  const items = revisions.map((r, i) => ({
    id: r.id,
    revision: r.revision,
    source: r.source,
    authorName: r.author.name,
    createdAt: r.createdAt.toISOString(),
    isCurrent: i === 0,
    wireframes: r.wireframes,
  }));

  return <HistoryList prdId={id} items={items} />;
}
