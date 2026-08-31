import { prisma } from "@wireframe-studio/db";
import type { Manifest, Registry } from "@wireframe-studio/core";

export async function getRegistry(): Promise<Registry> {
  const epics = await prisma.wireframeIssue.findMany({
    where: { parentId: null },
    orderBy: [{ projectNo: "asc" }, { sortOrder: "asc" }],
    include: { children: { orderBy: { sortOrder: "asc" } } },
  });

  const byProject = new Map<string, (typeof epics)[number][]>();
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
        prds: issues.map((epic) => ({
          prdNo: epic.issueNo,
          feature: epic.slug,
          title: epic.title,
          status: "draft" as const,
          screenCount: epic.children.length,
          children: epic.children.map((ch) => ({
            slug: ch.slug,
            title: ch.title,
            issueNo: ch.issueNo,
          })),
        })),
      };
    }),
  };
}

export async function getManifest(projectNo: string, epicSlug: string): Promise<Manifest | null> {
  const epic = await prisma.wireframeIssue.findFirst({
    where: { projectNo, slug: epicSlug, parentId: null },
    include: { children: { orderBy: { sortOrder: "asc" } } },
  });
  if (!epic) return null;
  return {
    projectNo: epic.projectNo,
    projectSlug: epic.projectSlug,
    prdNo: epic.issueNo,
    feature: epic.slug,
    title: epic.title,
    mode: "existing",
    screens: epic.children.map((s, i) => ({
      id: s.slug,
      no: i + 1,
      label: s.title,
      file: `db://${s.id}`,
      route: s.route ?? undefined,
    })),
    meta: { screenCount: epic.children.length },
  };
}

export async function getScreenHtml(projectNo: string, epicSlug: string, screenSlug: string) {
  const epic = await prisma.wireframeIssue.findFirst({
    where: { projectNo, slug: epicSlug, parentId: null },
  });
  if (!epic) return null;
  const screen = await prisma.wireframeIssue.findFirst({
    where: { parentId: epic.id, slug: screenSlug },
  });
  return screen?.html || null;
}
