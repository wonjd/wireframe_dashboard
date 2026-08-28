import { PrismaClient } from "@prisma/client";

/**
 * 스펙 §3.1 — 로컬은 file SQLite, 프로덕션(Vercel)은 Turso(libSQL).
 *
 * 현재는 로컬 file SQLite만 쓴다. Turso 전환은 Phase 3에서 이 함수 안에
 * libSQL 어댑터 분기를 넣는 것으로 끝난다 — 스키마와 쿼리는 그대로다.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// dev의 HMR이 매 요청마다 커넥션을 새로 열지 않도록 전역에 붙인다.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
