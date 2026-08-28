import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

/**
 * 스펙 §3.1 — 로컬은 file SQLite, 프로덕션(Vercel)은 Turso(libSQL).
 *
 * TURSO_DATABASE_URL이 있으면 libSQL 어댑터로 연결한다.
 * 없으면 DATABASE_URL(file SQLite)을 쓴다 — 로컬 개발 전용.
 */

function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    const adapter = new PrismaLibSql({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter });
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
