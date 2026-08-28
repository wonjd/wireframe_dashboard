import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Prisma sqlite provider는 libsql:// URL을 DATABASE_URL로 받지 못한다.
 * 커밋된 prisma/init.sql을 Turso에 적용한다.
 *
 * 이전 버그는 `-- CreateTable` 주석으로 시작하는 문을 전부 버려서
 * 테이블이 하나도 안 만들어졌다.
 */
const tursoUrl = process.env.TURSO_DATABASE_URL;
if (!tursoUrl) {
  console.info("[turso-db-push] TURSO_DATABASE_URL 없음 — skip");
  process.exit(0);
}

const sql = readFileSync(resolve("prisma/init.sql"), "utf8");
const stripped = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const statements = stripped
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

if (statements.length === 0) {
  throw new Error("[turso-db-push] prisma/init.sql 에 실행할 문이 없습니다.");
}

const client = createClient({
  url: tursoUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const alters = [
  'ALTER TABLE "GenerationJob" ADD COLUMN "cursorAgentId" TEXT',
  'ALTER TABLE "GenerationJob" ADD COLUMN "cursorRunId" TEXT',
  'ALTER TABLE "GenerationJob" ADD COLUMN "model" TEXT',
];

let applied = 0;
for (const stmt of [...statements, ...alters]) {
  try {
    await client.execute(stmt);
    applied += 1;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/already exists|duplicate column/i.test(msg)) continue;
    console.error("[turso-db-push] failed:", stmt.slice(0, 80));
    throw e;
  }
}

console.info(`[turso-db-push] applied ${applied}/${statements.length} statements`);
