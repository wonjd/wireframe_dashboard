import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma는 서버 전용. 번들러가 클라이언트로 끌고 가지 않게 한다.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
