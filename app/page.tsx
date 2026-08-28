import { db } from "@/lib/db";
import { PrdTable, type PrdRow } from "@/components/prd/prd-table";

export const dynamic = "force-dynamic";

/** 프로젝트 목록. */
export default async function HomePage() {
  const prds = await db.prd.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      wireframes: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });

  const rows: PrdRow[] = prds.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    version: p.wireframes[0]?.version ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-[20px] font-semibold tracking-tight text-ink">프로젝트</h1>
      <PrdTable rows={rows} />
    </div>
  );
}
