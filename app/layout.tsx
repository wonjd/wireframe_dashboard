import type { Metadata } from "next";
import "./globals.css";
import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/shell/app-sidebar";

export const metadata: Metadata = {
  title: "Wireframe Dashboard",
  description: "PRD를 넣으면 와이어프레임을 자동 생성하는 사내 도구",
};

export const dynamic = "force-dynamic";

/** 셸 — 사이드바(프로젝트 목록) + 본문. 색·간격은 globals.css 토큰만 사용한다. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <html lang="ko">
      <body className="min-h-screen">
        <div className="flex h-screen overflow-hidden">
          <Sidebar userName={user.name} />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-canvas p-6 lg:p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
