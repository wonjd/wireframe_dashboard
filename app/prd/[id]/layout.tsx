import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { TabNav } from "@/components/tabs/tab-nav";
import { StatusBadge } from "@/components/prd/status-badge";
import { PrdActions } from "@/components/prd/prd-actions";

export const dynamic = "force-dynamic";

/**
 * 프로젝트 셸 — §11.
 * 탭 전환 시 이 layout(제목·탭 바)은 유지되고 하위 page.tsx만 교체된다.
 * 탭이 클라이언트 state가 아니라 URL이므로 새로고침·공유가 그대로 된다.
 */
export default async function PrdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const prd = await db.prd.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!prd) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      {/* 사이드바가 상시 내비게이션이므로 "목록으로" 링크를 중복해서 두지 않는다. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">{prd.title}</h1>
        <StatusBadge status={prd.status} />
        <div className="ml-auto">
          <PrdActions prdId={prd.id} title={prd.title} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <TabNav prdId={id} />
        {children}
      </div>
    </div>
  );
}
