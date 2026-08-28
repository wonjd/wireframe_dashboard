import { db } from "./db";

const STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS \"User\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"worksUserId\" TEXT NOT NULL,\n    \"email\" TEXT NOT NULL,\n    \"name\" TEXT NOT NULL,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
  "CREATE TABLE IF NOT EXISTS \"Prd\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"title\" TEXT NOT NULL,\n    \"sourceText\" TEXT NOT NULL,\n    \"contentHash\" TEXT NOT NULL,\n    \"status\" TEXT NOT NULL DEFAULT 'DRAFT',\n    \"createdById\" TEXT NOT NULL,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    \"updatedAt\" DATETIME NOT NULL,\n    CONSTRAINT \"Prd_createdById_fkey\" FOREIGN KEY (\"createdById\") REFERENCES \"User\" (\"id\") ON DELETE RESTRICT ON UPDATE CASCADE\n)",
  "CREATE TABLE IF NOT EXISTS \"PrdRevision\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"prdId\" TEXT NOT NULL,\n    \"revision\" INTEGER NOT NULL,\n    \"sourceText\" TEXT NOT NULL,\n    \"contentHash\" TEXT NOT NULL,\n    \"source\" TEXT NOT NULL,\n    \"authorId\" TEXT NOT NULL,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT \"PrdRevision_prdId_fkey\" FOREIGN KEY (\"prdId\") REFERENCES \"Prd\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"PrdRevision_authorId_fkey\" FOREIGN KEY (\"authorId\") REFERENCES \"User\" (\"id\") ON DELETE RESTRICT ON UPDATE CASCADE\n)",
  "CREATE TABLE IF NOT EXISTS \"Wireframe\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"prdId\" TEXT NOT NULL,\n    \"version\" INTEGER NOT NULL,\n    \"docJson\" TEXT NOT NULL,\n    \"prdRevisionId\" TEXT NOT NULL,\n    \"model\" TEXT NOT NULL,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    CONSTRAINT \"Wireframe_prdId_fkey\" FOREIGN KEY (\"prdId\") REFERENCES \"Prd\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"Wireframe_prdRevisionId_fkey\" FOREIGN KEY (\"prdRevisionId\") REFERENCES \"PrdRevision\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE\n)",
  "CREATE TABLE IF NOT EXISTS \"GenerationJob\" (\n    \"id\" TEXT NOT NULL PRIMARY KEY,\n    \"prdId\" TEXT NOT NULL,\n    \"status\" TEXT NOT NULL DEFAULT 'PENDING',\n    \"trigger\" TEXT NOT NULL,\n    \"triggeredById\" TEXT,\n    \"wireframeId\" TEXT,\n    \"error\" TEXT,\n    \"cursorAgentId\" TEXT,\n    \"cursorRunId\" TEXT,\n    \"model\" TEXT,\n    \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    \"updatedAt\" DATETIME NOT NULL,\n    CONSTRAINT \"GenerationJob_prdId_fkey\" FOREIGN KEY (\"prdId\") REFERENCES \"Prd\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE,\n    CONSTRAINT \"GenerationJob_triggeredById_fkey\" FOREIGN KEY (\"triggeredById\") REFERENCES \"User\" (\"id\") ON DELETE SET NULL ON UPDATE CASCADE\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"User_worksUserId_key\" ON \"User\"(\"worksUserId\")",
  "CREATE INDEX IF NOT EXISTS \"Prd_updatedAt_idx\" ON \"Prd\"(\"updatedAt\")",
  "CREATE INDEX IF NOT EXISTS \"PrdRevision_prdId_createdAt_idx\" ON \"PrdRevision\"(\"prdId\", \"createdAt\")",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"PrdRevision_prdId_revision_key\" ON \"PrdRevision\"(\"prdId\", \"revision\")",
  "CREATE INDEX IF NOT EXISTS \"Wireframe_prdId_createdAt_idx\" ON \"Wireframe\"(\"prdId\", \"createdAt\")",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"Wireframe_prdId_version_key\" ON \"Wireframe\"(\"prdId\", \"version\")",
  "CREATE INDEX IF NOT EXISTS \"GenerationJob_prdId_status_idx\" ON \"GenerationJob\"(\"prdId\", \"status\")",
  "CREATE INDEX IF NOT EXISTS \"GenerationJob_prdId_createdAt_idx\" ON \"GenerationJob\"(\"prdId\", \"createdAt\")",
  'ALTER TABLE "GenerationJob" ADD COLUMN "cursorAgentId" TEXT',
  'ALTER TABLE "GenerationJob" ADD COLUMN "cursorRunId" TEXT',
  'ALTER TABLE "GenerationJob" ADD COLUMN "model" TEXT',
];

let pending: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!pending) pending = apply();
  return pending;
}

async function apply(): Promise<void> {
  for (const stmt of STATEMENTS) {
    try {
      await db.$executeRawUnsafe(stmt);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (/duplicate column|already exists/i.test(msg)) continue;
      throw e;
    }
  }
}
