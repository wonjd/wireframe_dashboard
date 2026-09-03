import type { ResolvedProject } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";
import { quoteSql, runWonjdQuery } from "./wonjd.js";

export type ColumnKind = "enum" | "fk" | "free_text" | "audit" | "id";

type Column = {
  name: string;
  type: string;
  null: boolean;
  fk?: string;
  codes?: Array<{ value: string; label?: string; count: number }>;
  kind: ColumnKind;
  label?: string;
};

type Table = {
  name: string;
  rows: number;
  columns: Column[];
};

const AUDIT_RE = /^(CREATED|UPDATED|DELETED)_(AT|ID)$|^PASSWORD$|^PASSWD$/i;
const ID_RE = /_ID$|^ID$/i;
const ENUM_NAME_RE = /_CD$|_STATUS|_STATE|TYPE|METHOD|DIV|LIVE|PROGRESS|INTENT|REF_TYPE|PLATFORM$/i;

function humanize(name: string): string {
  return name
    .replace(/_CD$/i, "")
    .replace(/_ID$/i, " ID")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Classify column before/after codes so free-text dumps are not treated as enums */
export function classifyColumnKind(input: {
  name: string;
  fk?: string;
  codes?: Array<{ value: string; count: number }>;
}): ColumnKind {
  if (AUDIT_RE.test(input.name)) return "audit";
  if (input.fk) return "fk";
  if (ID_RE.test(input.name) && !ENUM_NAME_RE.test(input.name)) return "id";

  if (ENUM_NAME_RE.test(input.name) && input.codes && input.codes.length >= 2) {
    const values = input.codes.map((c) => String(c.value ?? "").trim()).filter(Boolean);
    if (values.length < 2) return "free_text";
    const avgLen = values.reduce((s, v) => s + v.length, 0) / values.length;
    if (avgLen > 40) return "free_text";
    if (values.some((v) => /@|https?:|!/.test(v))) return "free_text";
    if (values.length <= 12) return "enum";
  }

  if (input.codes && input.codes.length >= 2 && !ENUM_NAME_RE.test(input.name)) {
    return "free_text";
  }

  return "free_text";
}

function filterEnumCodes(
  codes: Array<{ value: string; count: number }> | undefined,
): Array<{ value: string; count: number }> | undefined {
  if (!codes?.length) return undefined;
  const cleaned = codes
    .map((entry) => ({
      value: String(entry.value ?? "").trim(),
      count: entry.count,
    }))
    .filter((entry) => entry.value.length > 0 && entry.value.length <= 40);
  if (cleaned.length < 2 || cleaned.length > 12) return undefined;
  return cleaned;
}

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
    LIMIT 40
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
    const fk = fkMap.get(name);

    let codes: Array<{ value: string; count: number }> | undefined;
    // Prefer *_CD and enum-ish names for distinct-value sampling
    const shouldSampleCodes =
      ENUM_NAME_RE.test(name) &&
      /(char|text|enum|int|tinyint|smallint)/i.test(type) &&
      rows > 0 &&
      !AUDIT_RE.test(name);

    if (shouldSampleCodes) {
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
          codes = filterEnumCodes(
            codeResult.rows.map((codeRow) => ({
              value: String(codeRow[0]),
              count: Number(codeRow[1]),
            })),
          );
        }
      } catch {
        // skip code extraction for heavy columns
      }
    }

    const kind = classifyColumnKind({ name, fk, codes });
    const column: Column = {
      name,
      type,
      null: nullable,
      kind,
      label: humanize(name),
    };
    if (fk) column.fk = fk;
    // Only keep codes on enum columns — free-text dumps stay out of the render contract
    if (kind === "enum" && codes) column.codes = codes;

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

/** Offline: annotate an existing db.json with kind/label without re-querying MySQL */
export function annotateDbPayload(payload: {
  tables?: Array<{
    name: string;
    rows?: number;
    columns?: Array<{
      name: string;
      type?: string;
      null?: boolean;
      fk?: string;
      codes?: Array<{ value: string; count: number }>;
      kind?: string;
      label?: string;
    }>;
  }>;
}): typeof payload {
  for (const table of payload.tables ?? []) {
    for (const col of table.columns ?? []) {
      const kind = classifyColumnKind({
        name: col.name,
        fk: col.fk,
        codes: col.codes,
      });
      col.kind = kind;
      col.label = col.label ?? humanize(col.name);
      if (kind !== "enum") {
        delete col.codes;
      } else if (col.codes) {
        col.codes = filterEnumCodes(col.codes);
      }
    }
  }
  return payload;
}
