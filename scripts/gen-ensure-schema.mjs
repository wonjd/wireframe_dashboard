import { readFileSync, writeFileSync } from "node:fs";

const sql = readFileSync("prisma/init.sql", "utf8");
const stripped = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const stmts = stripped
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    if (s.startsWith("CREATE TABLE")) return s.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS");
    if (s.startsWith("CREATE UNIQUE INDEX")) return s.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
    if (s.startsWith("CREATE INDEX")) return s.replace("CREATE INDEX", "CREATE INDEX IF NOT EXISTS");
    return s;
  });

const body = stmts.map((s) => JSON.stringify(s)).join(",\n  ");
const out = `import { db } from "./db";

const STATEMENTS = [
  ${body}
];

let pending: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!pending) pending = apply();
  return pending;
}

async function apply(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.$executeRawUnsafe(stmt);
  }
}
`;

writeFileSync("lib/ensure-schema.ts", out);
console.info("wrote lib/ensure-schema.ts", stmts.length);
