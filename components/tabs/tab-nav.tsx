"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "spec", label: "PRD" },
  { seg: "wireframe", label: "와이어프레임" },
] as const;

/** 탭은 링크다 — 키보드 이동·뒤로가기가 기본 제공된다 (§14.5). */
export function TabNav({ prdId }: { prdId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-line px-4">
      {TABS.map((t) => {
        const href = `/prd/${prdId}/${t.seg}`;
        const active = pathname === href;
        return (
          <Link
            key={t.seg}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px px-3 py-3 text-[13px] transition-colors ${
              active ? "font-medium text-brand" : "text-ink-2 hover:text-brand"
            }`}
          >
            {t.label}
            {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
          </Link>
        );
      })}
    </nav>
  );
}
