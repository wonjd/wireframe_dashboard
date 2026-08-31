import type { Manifest, Registry } from "@wireframe-studio/core";
import { sql, type IssueRow } from "./db.js";

export async function getRegistry(): Promise<Registry> {
  const epics = await sql<IssueRow>(
    "SELECT * FROM wireframe_issue WHERE parentId IS NULL ORDER BY projectNo ASC, sortOrder ASC"
  );
  if (!epics.length) return { projects: [] };
  const children = await sql<IssueRow>(
    "SELECT * FROM wireframe_issue WHERE parentId IS NOT NULL ORDER BY sortOrder ASC"
  );
  const byParent = new Map<string, IssueRow[]>();
  for (const ch of children) {
    if (!ch.parentId) continue;
    const list = byParent.get(ch.parentId) ?? [];
    list.push(ch);
    byParent.set(ch.parentId, list);
  }
  const byProject = new Map<string, IssueRow[]>();
  for (const epic of epics) {
    const list = byProject.get(epic.projectNo) ?? [];
    list.push(epic);
    byProject.set(epic.projectNo, list);
  }
  return {
    projects: [...byProject.entries()].map(([no, issues]) => {
      const first = issues[0]!;
      return {
        no,
        slug: first.projectSlug,
        folder: "wireFrame",
        title: first.projectTitle,
        prds: issues.map((epic) => {
          const kids = byParent.get(epic.id) ?? [];
          return {
            prdNo: epic.issueNo,
            feature: epic.slug,
            title: epic.title,
            status: "draft" as const,
            screenCount: kids.length,
            children: kids.map((ch) => ({ slug: ch.slug, title: ch.title, issueNo: ch.issueNo })),
          };
        }),
      };
    }),
  };
}

export async function getManifest(projectNo: string, epicSlug: string): Promise<Manifest | null> {
  const [epic] = await sql<IssueRow>(
    "SELECT * FROM wireframe_issue WHERE projectNo = ? AND slug = ? AND parentId IS NULL LIMIT 1",
    [projectNo, epicSlug]
  );
  if (!epic) return null;
  const screens = await sql<IssueRow>(
    "SELECT * FROM wireframe_issue WHERE parentId = ? ORDER BY sortOrder ASC",
    [epic.id]
  );
  return {
    projectNo: epic.projectNo,
    projectSlug: epic.projectSlug,
    prdNo: epic.issueNo,
    feature: epic.slug,
    title: epic.title,
    mode: "existing",
    screens: screens.map((s, i) => ({
      id: s.slug,
      no: i + 1,
      label: s.title,
      file: `db://${s.id}`,
      route: s.route ?? undefined,
    })),
    meta: { screenCount: screens.length },
  };
}

export async function getScreenHtml(projectNo: string, epicSlug: string, screenSlug: string) {
  const [epic] = await sql<IssueRow>(
    "SELECT id FROM wireframe_issue WHERE projectNo = ? AND slug = ? AND parentId IS NULL LIMIT 1",
    [projectNo, epicSlug]
  );
  if (!epic) return null;
  const [screen] = await sql<IssueRow>(
    "SELECT html FROM wireframe_issue WHERE parentId = ? AND slug = ? LIMIT 1",
    [epic.id, screenSlug]
  );
  return screen?.html || null;
}
