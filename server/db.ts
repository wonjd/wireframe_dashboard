import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * Postgres connection for the app store (source of truth for PRD/spec DATA).
 *
 * One lazily-created pool per process. The schema is applied once per process on first
 * use (create table if not exists — safe to repeat). Rendered HTML is never stored here;
 * it is regenerated into a gitignored scratch cache. See server/schema.sql.
 */

let pool: Pool | null = null;
let migrated: Promise<void> | null = null;

export function dbConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL || "").trim());
}

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL이 없습니다. 레포 루트 .env에 DATABASE_URL=postgres://… 를 넣으세요.",
    );
  }
  pool = new Pool({ connectionString, max: 8 });
  return pool;
}

/** Apply schema.sql once. Idempotent; every caller awaits the same promise. */
export function migrate(root: string): Promise<void> {
  if (migrated) return migrated;
  migrated = (async () => {
    const schema = fs.readFileSync(path.join(root, "server", "schema.sql"), "utf8");
    await getPool().query(schema);
  })();
  return migrated;
}

export async function query<Row extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<Row[]> {
  const result = await getPool().query(text, params);
  return result.rows as Row[];
}

export async function queryOne<Row extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, params);
  return rows[0] ?? null;
}
