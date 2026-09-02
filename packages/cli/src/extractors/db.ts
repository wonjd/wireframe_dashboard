import type { ResolvedProject } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";
import { quoteSql, runWonjdQuery } from "./wonjd.js";

type Column = {
  name: string;
  type: string;
  null: boolean;
  fk?: string;
  codes?: Array<{ value: string; count: number }>;
};

type Table = {
  name: string;
  rows: number;
  columns: Column[];
};

async function findTablesWithConfig(project: ResolvedProject, entities: string[]): Promise<string[]> {
  const patterns = entities.flatMap((entity) => [
    entity.toUpperCase(),
    `${entity.toUpperCase()}_MT`,
    `${entity.toUpperCase()}_TB`,
  ]);

  const likeClause = patterns.map((name) => `TABLE_NAME LIKE ${quoteSql(`%${name}%`)}`).join(" OR ");
  const sql = `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (${likeClause})
    ORDER BY TABLE_NAME
    LIMIT 20
  `;

  const result = await runWonjdQuery(project, sql);
  return result.rows.map((row) => String(row[0]));
}

async function loadTableSchema(project: ResolvedProject, tableName: string): Promise<Table> {
  const columnsSql = `
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${quoteSql(tableName)}
    ORDER BY ORDINAL_POSITION
  `;
  const columnsResult = await runWonjdQuery(project, columnsSql);

  const fkSql = `
    SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${quoteSql(tableName)}
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `;
  const fkResult = await runWonjdQuery(project, fkSql);
  const fkMap = new Map<string, string>();
  for (const row of fkResult.rows) {
    fkMap.set(String(row[0]), `${row[1]}.${row[2]}`);
  }

  const countResult = await runWonjdQuery(
    project,
    `SELECT COUNT(*) AS row_count FROM ${tableName}`,
  );
  const rows = Number(countResult.rows[0]?.[0] ?? 0);

  const columns: Column[] = [];
  for (const row of columnsResult.rows) {
    const name = String(row[0]);
    const type = String(row[1]);
    const nullable = String(row[2]) === "YES";
    const column: Column = {
      name,
      type,
      null: nullable,
    };
    const fk = fkMap.get(name);
    if (fk) column.fk = fk;

    if (/(char|text|enum)/i.test(type) && rows > 0) {
      const codeSql = `
        SELECT ${name}, COUNT(*) AS cnt
        FROM ${tableName}
        WHERE ${name} IS NOT NULL
        GROUP BY ${name}
        ORDER BY cnt DESC
        LIMIT 12
      `;
      try {
        const codeResult = await runWonjdQuery(project, codeSql);
        if (codeResult.row_count > 0 && codeResult.row_count <= 12) {
          column.codes = codeResult.rows.map((codeRow) => ({
            value: String(codeRow[0]),
            count: Number(codeRow[1]),
          }));
        }
      } catch {
        // skip code extraction for heavy columns
      }
    }

    columns.push(column);
  }

  return { name: tableName, rows, columns };
}

export async function extractDbAssets(
  project: ResolvedProject,
  entities: string[],
): Promise<string> {
  if (entities.length === 0) {
    throw new Error(
      "usage: wireframe extract db --project <slug> --entities pause,member (or set extract.dbEntities in config)",
    );
  }

  const tableNames = await findTablesWithConfig(project, entities);
  const tables: Table[] = [];
  for (const tableName of tableNames) {
    tables.push(await loadTableSchema(project, tableName));
  }

  const payload = {
    source: "wonjd",
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    entities,
    tables,
  };

  return writeProjectJson(project, "db", payload);
}
