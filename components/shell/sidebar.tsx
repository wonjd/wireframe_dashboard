"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { NewPrdForm } from "@/components/prd/new-prd-form";

type Item = {
  id: string;
  title: string;
  status: string;
  latestWireframeVersion: number | null;
};

const DOT: Record<string, string> = {
  DRAFT: "bg-neutral-300",
  GENERATING: "bg-blue-500 animate-pulse",
  GENERATED: "bg-green-500",
  FAILED: "bg-red-500",
};

/**
 * 어드민 사이드바 — PRD 사이를 오가는 상시 내비게이션.
 *
 * 클라이언트에서 목록을 가져온다. 서버 레이아웃으로 두면 등록·수정 직후
 * 사이드바만 낡은 상태로 남을 수 있어서, 경로가 바뀔 때마다 다시 읽는다.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/prds", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  // 생성 중인 PRD가 있으면 상태 점이 살아 움직이도록 짧게 갱신한다.
  useEffect(() => {
    if (!items.some((i) => i.status === "GENERATING")) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [items, load]);

  const activeId = pathname.startsWith("/prd/") ? pathname.split("/")[2] : null;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-3 py-3">
        <NewPrdForm onCreated={load} />
      </div>

      <div className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-neutral-400">PRD</div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <p className="px-2 py-2 text-xs text-neutral-400">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-2 text-xs text-neutral-400">등록된 PRD가 없습니다.</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((p) => {
              const active = p.id === activeId;
              return (
                <li key={p.id}>
                  <Link
                    href={`/prd/${p.id}/spec`}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                      active
                        ? "bg-neutral-100 font-medium text-neutral-900"
                        : "text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.status] ?? DOT.DRAFT}`}
                      title={p.status}
                    />
                    <span className="truncate">{p.title}</span>
                    {p.latestWireframeVersion && (
                      <span className="ml-auto shrink-0 text-xs text-neutral-400">
                        v{p.latestWireframeVersion}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-neutral-200 px-3 py-2">
        <Link
          href="/"
          className={`block rounded px-2 py-1.5 text-sm ${
            pathname === "/" ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          전체 목록
        </Link>
      </div>
    </aside>
  );
}
