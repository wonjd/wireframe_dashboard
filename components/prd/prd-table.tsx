"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge } from "./status-badge";
import { formatDateTime } from "@/lib/format";

export type PrdRow = {
  id: string;
  title: string;
  status: string;
  version: number | null;
  revision: number | null;
  lastEditor: string | null;
  updatedAt: string;
};

const STATUSES = ["전체", "DRAFT", "GENERATING", "GENERATED", "FAILED"] as const;

/**
 * PRD 목록 테이블 — 어드민 패턴(검색 + 상태 필터 + 테이블).
 * 내부 도구 규모에서는 서버 페이징 없이 클라이언트 필터로 충분하다.
 */
export function PrdTable({ rows }: { rows: PrdRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("전체");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "전체" && r.status !== status) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        (r.lastEditor ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, status]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-56">
          <span className="mb-1 block text-xs text-neutral-500">검색</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="PRD 제목 또는 수정자"
            className="h-9 w-full rounded border border-neutral-300 bg-white px-3 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-neutral-500">상태</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto pb-2 text-xs text-neutral-400">
          {filtered.length} / {rows.length}건
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="text-left text-xs text-neutral-500">
              <th className="px-4 py-2 font-medium">PRD</th>
              <th className="px-4 py-2 font-medium">상태</th>
              <th className="px-4 py-2 font-medium">버전</th>
              <th className="px-4 py-2 font-medium">리비전</th>
              <th className="px-4 py-2 font-medium">최종 수정자</th>
              <th className="px-4 py-2 font-medium">최종 수정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">
                  {rows.length === 0
                    ? "PRD가 없습니다. 왼쪽 위 '+ 새 PRD'로 등록하세요."
                    : "조건에 맞는 PRD가 없습니다."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200 hover:bg-neutral-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/prd/${r.id}/spec`}
                      className="font-medium text-neutral-800 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500">
                    {r.version ? `v${r.version}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500">
                    {r.revision ? `r${r.revision}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{r.lastEditor ?? "—"}</td>
                  <td className="px-4 py-2.5 text-neutral-500">{formatDateTime(r.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
