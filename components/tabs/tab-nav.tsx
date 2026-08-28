"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "spec", label: "스펙" },
  { seg: "wireframe", label: "와이어프레임" },
  { seg: "history", label: "이력" },
] as const;

/** 탭은 링크다 — 키보드 이동·뒤로가기가 기본 제공된다 (§14.5). */
export function TabNav({ prdId }: { prdId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-neutral-200">
      {TABS.map((t) => {
        const href = `/prd/${prdId}/${t.seg}`;
        const active = pathname === href;
        return (
          <Link
            key={t.seg}
            href={href}
            className={`rounded-t border border-b-0 px-4 py-2 text-sm ${
              active
                ? "border-neutral-200 bg-white font-medium text-neutral-800"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
