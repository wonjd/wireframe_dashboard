import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wireframe Generator",
  description: "PRD를 넣으면 와이어프레임을 만들어 주는 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-canvas">{children}</body>
    </html>
  );
}
