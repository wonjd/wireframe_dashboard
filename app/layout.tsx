import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Wireframe Dashboard",
  description: "PRD를 넣으면 와이어프레임을 자동 생성하는 사내 도구",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
            <Link href="/" className="text-sm font-semibold text-neutral-800">
              Wireframe Dashboard
            </Link>
            <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
              <span>{user.name}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                개발용 스텁 로그인
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
