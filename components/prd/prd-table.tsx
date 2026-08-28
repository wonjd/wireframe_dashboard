import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { formatDateTime } from "@/lib/format";

export type PrdRow = {
  id: string;
  title: string;
  status: string;
  version: number | null;
  updatedAt: string;
};

/** 프로젝트 목록 — 사이드바와 같은 데이터를 표로만 보여준다. */
export function PrdTable({ rows }: { rows: PrdRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card px-6 py-16 text-center">
        <p className="text-[14px] font-medium text-ink">프로젝트가 없습니다</p>
        <p className="mt-1.5 text-[13px] text-ink-3">
          왼쪽 위 <span className="font-medium text-ink-2">＋ 새 프로젝트</span>로 prd.md를 올리면
          와이어프레임 생성이 시작됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-[11.5px] text-ink-3">
              <th scope="col" className="px-5 py-2.5 font-medium">프로젝트</th>
              <th scope="col" className="px-5 py-2.5 font-medium">상태</th>
              <th scope="col" className="px-5 py-2.5 font-medium">와이어프레임</th>
              <th scope="col" className="px-5 py-2.5 font-medium">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-line transition-colors last:border-b-0 hover:bg-subtle"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/prd/${r.id}/spec`}
                    className="font-medium text-ink transition-colors hover:text-brand"
                  >
                    {r.title}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-5 py-3">
                  {r.version ? (
                    <Link
                      href={`/prd/${r.id}/wireframe`}
                      className="tnum rounded-md border border-line bg-subtle px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:border-brand-line hover:bg-brand-soft hover:text-brand"
                    >
                      v{r.version}
                    </Link>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="tnum px-5 py-3 text-ink-3">{formatDateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
