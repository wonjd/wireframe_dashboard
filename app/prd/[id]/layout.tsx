import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { TabNav } from "@/components/tabs/tab-nav";
import { StatusBadge } from "@/components/prd/status-badge";

export const dynamic = "force-dynamic";

/**
 * 탭 셸 — §11.
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
  const prd = await db.prd.findUnique({ where: { id }, select: { id: true, title: true, status: true } });
  if (!prd) notFound();

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← 목록
        </Link>
        <h1 className="font-semibold text-neutral-800">{prd.title}</h1>
        <StatusBadge status={prd.status} />
      </div>
      <TabNav prdId={id} />
      <div className="rounded-b border border-t-0 border-neutral-200 bg-white">{children}</div>
    </div>
  );
}
