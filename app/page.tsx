import Link from "next/link";
import { db } from "@/lib/db";
import { NewPrdForm } from "@/components/prd/new-prd-form";
import { StatusBadge } from "@/components/prd/status-badge";

export const dynamic = "force-dynamic";

/** PRD 목록 — §12.1 */
export default async function HomePage() {
  const prds = await db.prd.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      wireframes: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
      revisions: {
        select: { revision: true, createdAt: true, author: { select: { name: true } } },
        orderBy: { revision: "desc" },
        take: 1,
      },
    },
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-800">PRD 목록</h1>
        <NewPrdForm />
      </div>

      {prds.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          PRD가 없습니다. 새 PRD를 등록하세요.
        </div>
      ) : (
        <ul className="space-y-2">
          {prds.map((p) => {
            const last = p.revisions[0];
            return (
              <li key={p.id}>
                <Link
                  href={`/prd/${p.id}/spec`}
                  className="block rounded border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-neutral-800">{p.title}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      {p.wireframes[0] && (
                        <span className="text-xs text-neutral-400">v{p.wireframes[0].version}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    최종 수정: {formatDate(p.updatedAt)}
                    {last?.author?.name ? ` · ${last.author.name}` : ""}
                    {last ? ` · r${last.revision}` : ""}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(d);
}
