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
  DRAFT: "bg-ink-4",
  GENERATING: "bg-brand animate-pulse",
  GENERATED: "bg-ok",
  FAILED: "bg-danger",
};

/**
 * 사이드바 — 프로젝트 사이를 오가는 상시 내비게이션.
 *
 * 클라이언트에서 목록을 가져온다. 서버 레이아웃으로 두면 등록·수정 직후
 * 사이드바만 낡은 상태로 남을 수 있어서, 경로가 바뀔 때마다 다시 읽는다.
 */
export function Sidebar({ userName }: { userName: string }) {
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

  // 생성 중인 프로젝트가 있으면 상태 점이 살아 움직이도록 짧게 갱신한다.
  useEffect(() => {
    if (!items.some((i) => i.status === "GENERATING")) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [items, load]);

  const activeId = pathname.startsWith("/prd/") ? pathname.split("/")[2] : null;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-nav-line bg-nav">
      <div className="flex h-14 shrink-0 items-center border-b border-nav-line px-4">
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-white">
            W
          </span>
          <span className="text-[13px] font-semibold text-ink">Wireframe</span>
        </Link>
      </div>

      <div className="px-3 py-3">
        <NewPrdForm onCreated={load} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="space-y-1.5 px-3 py-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-line"
                style={{ width: `${80 - i * 15}%` }}
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-xs leading-relaxed text-ink-3">
            프로젝트가 없습니다.
            <br />
            위 버튼으로 PRD를 올리세요.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((p) => {
              const active = p.id === activeId;
              return (
                <li key={p.id}>
                  <Link
                    href={`/prd/${p.id}/spec`}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                      active
                        ? "bg-brand-soft font-medium text-brand"
                        : "text-ink-2 hover:bg-nav-2 hover:text-ink"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.status] ?? DOT.DRAFT}`}
                      title={p.status}
                    />
                    <span className="truncate">{p.title}</span>
                    {p.latestWireframeVersion != null && (
                      <span
                        className={`tnum ml-auto shrink-0 rounded px-1 py-px text-[10px] ${
                          active ? "bg-surface text-brand" : "bg-line text-ink-3"
                        }`}
                      >
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

      <div className="flex shrink-0 items-center gap-2 border-t border-nav-line px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand">
          {userName.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-[12px] text-ink-3">{userName}</span>
      </div>
    </aside>
  );
}
