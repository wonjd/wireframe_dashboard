import fs from "node:fs";
import path from "node:path";
import { runSelectQuery } from "./db-query.js";

export type GlossaryTerm = {
  word: string;
  meaning: string;
  aliases: string[];
  table?: string;
  column?: string;
  source: "comment" | "db_json" | "glossary";
};

type DbJsonColumn = {
  name: string;
  label?: string;
  codes?: Array<{ value: string; label?: string }>;
};

type DbJsonTable = {
  name: string;
  columns?: DbJsonColumn[];
};

type GlossaryFile = {
  terms?: Array<{
    word: string;
    meaning?: string;
    aliases?: string[];
    table?: string;
    column?: string;
  }>;
};

type CacheEntry = {
  builtAt: number;
  terms: GlossaryTerm[];
};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function pushUnique(list: GlossaryTerm[], term: GlossaryTerm): void {
  const key = `${normalize(term.word)}|${term.table ?? ""}|${term.column ?? ""}|${term.source}`;
  if (list.some((t) => `${normalize(t.word)}|${t.table ?? ""}|${t.column ?? ""}|${t.source}` === key)) {
    return;
  }
  if (!term.word.trim() || !term.meaning.trim()) return;
  list.push({
    ...term,
    word: term.word.trim(),
    meaning: term.meaning.trim(),
    aliases: (term.aliases ?? []).map((a) => a.trim()).filter(Boolean),
  });
}

async function loadCommentsFromLiveDb(): Promise<GlossaryTerm[]> {
  const terms: GlossaryTerm[] = [];
  try {
    const tables = await runSelectQuery(`
      SELECT TABLE_NAME, TABLE_COMMENT
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_COMMENT IS NOT NULL
        AND TABLE_COMMENT <> ''
      ORDER BY TABLE_NAME
      LIMIT 200
    `);
    for (const row of tables.rows) {
      const table = String(row[0] ?? "");
      const comment = String(row[1] ?? "").trim();
      if (!table || !comment) continue;
      pushUnique(terms, {
        word: comment,
        meaning: comment,
        aliases: [table],
        table,
        source: "comment",
      });
      // Also index table name as searchable word pointing at comment meaning
      pushUnique(terms, {
        word: table,
        meaning: comment,
        aliases: [],
        table,
        source: "comment",
      });
    }

    const cols = await runSelectQuery(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_COMMENT IS NOT NULL
        AND COLUMN_COMMENT <> ''
      ORDER BY TABLE_NAME, ORDINAL_POSITION
      LIMIT 2000
    `);
    for (const row of cols.rows) {
      const table = String(row[0] ?? "");
      const column = String(row[1] ?? "");
      const comment = String(row[2] ?? "").trim();
      if (!table || !column || !comment) continue;
      pushUnique(terms, {
        word: comment,
        meaning: comment,
        aliases: [column, `${table}.${column}`],
        table,
        column,
        source: "comment",
      });
    }
  } catch {
    // Live DB optional for static assets; search still works on db.json / glossary
  }
  return terms;
}

function loadFromDbJson(root: string, slug: string): GlossaryTerm[] {
  const file = path.join(root, "projects", slug, "db.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { tables?: DbJsonTable[] };
    const terms: GlossaryTerm[] = [];
    for (const table of raw.tables ?? []) {
      if (!table?.name) continue;
      pushUnique(terms, {
        word: table.name,
        meaning: table.name.replace(/_/g, " "),
        aliases: [],
        table: table.name,
        source: "db_json",
      });
      for (const col of table.columns ?? []) {
        const label = (col.label || col.name || "").trim();
        if (!label) continue;
        pushUnique(terms, {
          word: label,
          meaning: label,
          aliases: [col.name],
          table: table.name,
          column: col.name,
          source: "db_json",
        });
        for (const code of col.codes ?? []) {
          const codeLabel = (code.label || code.value || "").trim();
          if (!codeLabel) continue;
          pushUnique(terms, {
            word: codeLabel,
            meaning: `${label} 코드값: ${codeLabel}`,
            aliases: [String(code.value ?? "")],
            table: table.name,
            column: col.name,
            source: "db_json",
          });
        }
      }
    }
    return terms;
  } catch {
    return [];
  }
}

function loadGlossaryOverlay(root: string, slug: string): GlossaryTerm[] {
  const file = path.join(root, "projects", slug, "glossary.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as GlossaryFile;
    const terms: GlossaryTerm[] = [];
    for (const t of raw.terms ?? []) {
      const word = String(t.word || "").trim();
      if (!word) continue;
      pushUnique(terms, {
        word,
        meaning: String(t.meaning || word).trim(),
        aliases: Array.isArray(t.aliases) ? t.aliases.map(String) : [],
        table: t.table ? String(t.table) : undefined,
        column: t.column ? String(t.column) : undefined,
        source: "glossary",
      });
    }
    return terms;
  } catch {
    return [];
  }
}

export async function buildGlossary(root: string, slug = "crm"): Promise<GlossaryTerm[]> {
  const glossPath = path.join(root, "projects", slug, "glossary.json");
  let glossMtime = 0;
  try {
    if (fs.existsSync(glossPath)) glossMtime = fs.statSync(glossPath).mtimeMs;
  } catch {
    glossMtime = 0;
  }
  const key = `${root}::${slug}::${glossMtime}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.builtAt < TTL_MS) return hit.terms;

  const [comments, fromJson, overlay] = await Promise.all([
    loadCommentsFromLiveDb(),
    Promise.resolve(loadFromDbJson(root, slug)),
    Promise.resolve(loadGlossaryOverlay(root, slug)),
  ]);

  // Priority: glossary overlay first in search scoring, then comments, then db.json
  const terms = [...overlay, ...comments, ...fromJson];
  cache.set(key, { builtAt: Date.now(), terms });
  return terms;
}

export function invalidateGlossaryCache(root?: string, slug?: string): void {
  if (!root) {
    cache.clear();
    return;
  }
  const prefix = slug ? `${root}::${slug}` : `${root}::`;
  for (const k of cache.keys()) {
    if (k === prefix || k.startsWith(prefix)) cache.delete(k);
  }
}

function scoreTerm(term: GlossaryTerm, tokens: string[], rawQ: string): number {
  const word = normalize(term.word);
  const meaning = normalize(term.meaning);
  const aliases = term.aliases.map(normalize);
  const q = normalize(rawQ);
  let score = 0;

  if (word === q || aliases.includes(q)) score += 100;
  if (word.includes(q) || meaning.includes(q)) score += 40;
  if (aliases.some((a) => a.includes(q))) score += 35;

  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (word === tok || aliases.includes(tok)) score += 50;
    if (word.includes(tok)) score += 20;
    if (meaning.includes(tok)) score += 18;
    if (aliases.some((a) => a.includes(tok))) score += 15;
    if (term.table && normalize(term.table).includes(tok)) score += 10;
    if (term.column && normalize(term.column).includes(tok)) score += 8;
  }

  if (term.source === "glossary") score += 8;
  else if (term.source === "comment") score += 4;

  return score;
}

export async function searchGlossary(
  root: string,
  query: string,
  opts?: { slug?: string; limit?: number },
): Promise<GlossaryTerm[]> {
  const q = query.trim();
  if (!q) return [];
  const slug = opts?.slug || "crm";
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  const terms = await buildGlossary(root, slug);
  const tokens = normalize(q)
    .split(/[\s,./|]+/)
    .filter(Boolean);

  return terms
    .map((term) => ({ term, score: scoreTerm(term, tokens, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.term);
}

/** Public shape for API / agent. */
export function serializeTerm(term: GlossaryTerm): Record<string, unknown> {
  return {
    word: term.word,
    meaning: term.meaning,
    aliases: term.aliases,
    table: term.table ?? null,
    column: term.column ?? null,
    source: term.source,
  };
}
