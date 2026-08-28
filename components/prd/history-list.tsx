"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateTime } from "@/lib/format";

type Item = {
  id: string;
  revision: number;
  source: string;
  authorName: string;
  createdAt: string;
  isCurrent: boolean;
  wireframes: { id: string; version: number }[];
};

const SOURCE_LABEL: Record<string, string> = { UPLOAD: "업로드", EDIT: "편집" };

/** 이력 타임라인 — §12.4 */
export function HistoryList({ prdId, items }: { prdId: string; items: Item[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function view(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setLoading(true);
    setOpenId(id);
    try {
      const res = await fetch(`/api/revisions/${id}`, { cache: "no-store" });
      const data = await res.json();
      setText(res.ok ? data.sourceText : (data?.error?.message ?? "불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return <div className="p-10 text-center text-sm text-neutral-500">이력이 없습니다.</div>;
  }

  return (
    <div className="p-4">
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r.id} className="border-l-2 border-neutral-200 pl-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-neutral-800">r{r.revision}</span>
              <span className="text-neutral-500">{formatDateTime(r.createdAt)}</span>
              <span className="text-neutral-700">{r.authorName}</span>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                {SOURCE_LABEL[r.source] ?? r.source}
              </span>
              {r.isCurrent && (
                <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">현재</span>
              )}
              <button
                onClick={() => void view(r.id)}
                className="ml-auto rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                {openId === r.id ? "원문 닫기" : "원문 보기"}
              </button>
            </div>

            <div className="mt-1 text-xs text-neutral-500">
              {r.wireframes.length > 0 ? (
                <span>
                  →{" "}
                  {r.wireframes.map((w, i) => (
                    <span key={w.id}>
                      {i > 0 && ", "}
                      <Link
                        href={`/prd/${prdId}/wireframe`}
                        className="text-neutral-600 underline hover:text-neutral-900"
                      >
                        와이어프레임 v{w.version}
                      </Link>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-neutral-400">→ 생성된 와이어프레임 없음</span>
              )}
            </div>

            {openId === r.id && (
              <pre className="mt-2 max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs whitespace-pre-wrap text-neutral-700">
                {loading ? "불러오는 중..." : text}
              </pre>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-neutral-400">
        이력은 추가만 되며 수정·삭제할 수 없습니다. 과거 리비전으로 되돌리려면 그 원문을 복사해 스펙
        탭에서 저장하세요 — 되돌림도 새 리비전으로 남습니다.
      </p>
    </div>
  );
}
