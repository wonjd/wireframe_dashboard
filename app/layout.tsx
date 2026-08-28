import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/shell/sidebar";

export const metadata: Metadata = {
  title: "Wireframe Dashboard",
  description: "PRD를 넣으면 와이어프레임을 자동 생성하는 사내 도구",
};

/**
 * 어드민 셸 — 상단 바 + 좌측 사이드바 + 본문.
 * 사이드바가 상시 내비게이션이므로 화면마다 "목록으로" 버튼을 두지 않는다.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <html lang="ko">
      <body className="min-h-screen">
        <div className="flex h-screen flex-col">
          <header className="flex shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-5 py-2.5">
            <Link href="/" className="text-sm font-semibold text-neutral-800">
              Wireframe Dashboard
            </Link>
            <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
              <span>{user.name}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                개발용 스텁 로그인
              </span>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
