import type { ResolvedProject, WireframeConfig } from "../lib/config.js";
import { resolveProject } from "../lib/config.js";
import { quoteSql, runWonjdQuery } from "../extractors/wonjd.js";
import {
  loadProjectAssets,
  type DbColumn,
  type DbJson,
  type ProjectAssets,
} from "./build-pipeline.js";

export type BuildContextSources = {
  prd: { path: string; chars: number };
  jsonAssets: {
    projectSlug: string;
    files: Array<"design.json" | "routes.json" | "api.json" | "db.json" | "shell.html">;
  };
  liveDb: {
    ok: boolean;
    tables: string[];
    error?: string;
  };
};

export type BuildContextPack = {
  prdContent: string;
  prdPath: string;
  assets: ProjectAssets;
  sources: BuildContextSources;
};

function pickHints(prd: string, configured: string[]): string[] {
  const lower = prd.toLowerCase();
  const hints = new Set(configured.map((e) => e.toLowerCase()));
  const lexicon: Array<[RegExp, string]> = [
    [/content|소재|이미지|영상|creative/, "content"],
    [/growth|성장|pause|일시정지/, "growth"],
    [/account|계정/, "account"],
    [/ent|업체|광고주/, "ent"],
    [/request|요청/, "request"],
    [/file|파일|첨부/, "file"],
  ];
  for (const [re, entity] of lexicon) {
    if (re.test(lower)) hints.add(entity);
  }
  return [...hints].slice(0, 8);
}

async function fetchLiveDbTables(
  project: ResolvedProject,
  prdContent: string,
): Promise<{ ok: true; tables: NonNullable<DbJson["tables"]> } | { ok: false; error: string }> {
  try {
    const entities = project.extract?.dbEntities ?? ["ent", "account", "content", "growth"];
    const hints = pickHints(prdContent, entities);
    const like = hints
      .flatMap((h) => [
        `TABLE_NAME LIKE ${quoteSql(`%${h.toUpperCase()}%`)}`,
        `TABLE_NAME LIKE ${quoteSql(`%${h}%`)}`,
      ])
      .join(" OR ");

    const tablesResult = await runWonjdQuery(
      project,
      `
      SELECT TABLE_NAME, TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND (${like || "TABLE_NAME LIKE '%CONTENT%' OR TABLE_NAME LIKE '%ACCOUNT%'"})
      ORDER BY TABLE_ROWS DESC
      LIMIT 8
    `,
    );

    const tables: NonNullable<DbJson["tables"]> = [];
    for (const row of tablesResult.rows.slice(0, 5)) {
      const tableName = String(row[0]);
      const rows = Number(row[1] ?? 0);
      const colsResult = await runWonjdQuery(
        project,
        `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${quoteSql(tableName)}
        ORDER BY ORDINAL_POSITION
        LIMIT 40
      `,
      );

      const columns: DbColumn[] = [];
      for (const colRow of colsResult.rows) {
        const name = String(colRow[0]);
        const type = String(colRow[1] ?? "");
        const nullable = String(colRow[2]) === "YES";
        const column: DbColumn = {
          name,
          type,
          null: nullable,
          kind: /_CD$|STATUS|STATE|TYPE|METHOD|DIV|LIVE|PROGRESS|INTENT/i.test(name)
            ? "enum"
            : /_ID$|^ID$/i.test(name)
              ? "id"
              : "free_text",
          label: name
            .replace(/_CD$/i, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, (ch) => ch.toUpperCase()),
        };

        if (column.kind === "enum") {
          try {
            const codes = await runWonjdQuery(
              project,
              `
              SELECT ${name}, COUNT(*) AS cnt
              FROM ${tableName}
              WHERE ${name} IS NOT NULL AND ${name} <> ''
              GROUP BY ${name}
              ORDER BY cnt DESC
              LIMIT 8
            `,
            );
            if (codes.row_count >= 2 && codes.row_count <= 8) {
              const values = codes.rows
                .map((r) => String(r[0]).trim())
                .filter((v) => v.length > 0 && v.length <= 40);
              if (values.length >= 2) {
                column.codes = values.map((value, index) => ({
                  value,
                  count: Number(codes.rows[index]?.[1] ?? 0),
                }));
              } else {
                column.kind = "free_text";
              }
            } else {
              column.kind = "free_text";
            }
          } catch {
            column.kind = "free_text";
          }
        }
        columns.push(column);
      }

      tables.push({ name: tableName, rows, columns });
    }

    return { ok: true, tables };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Prefer live table rows/columns over snapshot when names match; append new live tables. */
export function mergeLiveDbIntoAssets(assets: ProjectAssets, liveTables: NonNullable<DbJson["tables"]>): ProjectAssets {
  const byName = new Map((assets.db.tables ?? []).map((table) => [table.name, table]));
  for (const live of liveTables) {
    byName.set(live.name, live);
  }
  return {
    ...assets,
    db: {
      ...assets.db,
      source: "wonjd-live+json",
      tables: [...byName.values()],
      entities: [
        ...new Set([...(assets.db.entities ?? []), ...liveTables.map((t) => t.name.split("_")[0]?.toLowerCase() ?? "")]),
      ].filter(Boolean),
    } as DbJson,
  };
}

/**
 * Wireframe build SSOT context: PRD file + JSON assets + live DB (wonjd query) together.
 * Call once per `run build`. Artifact re-render should reuse domain.json instead.
 */
export async function loadBuildContext(input: {
  config: WireframeConfig;
  projectSlug: string;
  assetProjectSlug: string;
  prdPath: string;
  prdContent: string;
}): Promise<BuildContextPack> {
  const jsonAssets = await loadProjectAssets(input.assetProjectSlug);
  const project = resolveProject(input.config, input.assetProjectSlug);

  const live = await fetchLiveDbTables(project, input.prdContent);
  const assets =
    live.ok && live.tables.length > 0
      ? mergeLiveDbIntoAssets(jsonAssets, live.tables)
      : jsonAssets;

  return {
    prdContent: input.prdContent,
    prdPath: input.prdPath,
    assets,
    sources: {
      prd: { path: input.prdPath, chars: input.prdContent.length },
      jsonAssets: {
        projectSlug: input.assetProjectSlug,
        files: ["design.json", "routes.json", "api.json", "db.json", "shell.html"],
      },
      liveDb: live.ok
        ? { ok: true, tables: live.tables.map((t) => t.name) }
        : { ok: false, tables: [], error: live.error },
    },
  };
}
