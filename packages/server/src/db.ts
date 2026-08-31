import mysql from "mysql2/promise";

export type IssueRow = {
  id: string;
  parentId: string | null;
  projectNo: string;
  projectSlug: string;
  projectTitle: string;
  slug: string;
  title: string;
  issueNo: string;
  html: string;
  sortOrder: number;
  route: string | null;
};

export async function sql<T>(q: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return [];
  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.query(q, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}
