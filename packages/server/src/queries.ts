import { prisma } from "@wireframe-studio/db";
import type { Manifest, Registry } from "@wireframe-studio/core";

export async function getRegistry(): Promise<Registry> {
  const projects = await prisma.project.findMany({
    orderBy: { no: "asc" },
    include: {
      issues: {
        where: { kind: "epic", parentId: null },
        orderBy: { sortOrder: "asc" },
        include: {
          _count: { select: { children: true } },
          children: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  return {
    projects: projects.map((p) => ({
      no: p.no,
      slug: p.slug,
      folder: `${p.no}-${p.slug}`,
      title: p.title,
      prds: p.issues.map((epic) => ({
        prdNo: epic.issueNo,
        feature: epic.slug,
        title: epic.title,
        status: epic.status as "draft" | "review" | "approved",
        screenCount: epic._count.children,
        children: epic.children.map((ch) => ({
          slug: ch.slug,
          title: ch.title,
          issueNo: ch.issueNo,
        })),
      })),
    })),
  };
}

export async function getManifest(projectNo: string, epicSlug: string): Promise<Manifest | null> {
  const project = await prisma.project.findFirst({ where: { no: projectNo } });
  if (!project) return null;
  const epic = await prisma.issue.findFirst({
    where: { projectId: project.id, kind: "epic", slug: epicSlug, parentId: null },
    include: { children: { orderBy: { sortOrder: "asc" } } },
  });
  if (!epic) return null;
  const meta = epic.metaJson ? JSON.parse(epic.metaJson) : {};
  return {
    projectNo: project.no,
    projectSlug: project.slug,
    prdNo: epic.issueNo,
    feature: epic.slug,
    title: epic.title,
    mode: (epic.mode ?? "new") as "new" | "existing",
    screens: epic.children.map((s, i) => ({
      id: s.slug,
      no: i + 1,
      label: s.title,
      file: `db://${s.id}`,
      route: s.route ?? undefined,
      badge: s.badge as "NEW" | "MODIFY" | "EXTEND" | undefined,
      related: s.related ?? undefined,
    })),
    diff: meta.diff,
    meta: { overview: meta.overview, notes: meta.notes, screenCount: epic.children.length },
  };
}

export async function getScreenHtml(projectNo: string, epicSlug: string, screenSlug: string) {
  const project = await prisma.project.findFirst({ where: { no: projectNo } });
  if (!project) return null;
  const epic = await prisma.issue.findFirst({
    where: { projectId: project.id, kind: "epic", slug: epicSlug, parentId: null },
  });
  if (!epic) return null;
  const screen = await prisma.issue.findFirst({
    where: { parentId: epic.id, kind: "screen", slug: screenSlug },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  return screen?.versions[0]?.html ?? null;
}
