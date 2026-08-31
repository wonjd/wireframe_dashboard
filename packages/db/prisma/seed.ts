import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function readHtml(rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), "utf8");
}

async function main() {
  await prisma.issueVersion.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.project.deleteMany();
  await prisma.member.deleteMany();
  await prisma.workspace.deleteMany();

  const ws = await prisma.workspace.create({
    data: { name: "WONJD", slug: "wonjd" },
  });

  await prisma.member.create({
    data: { workspaceId: ws.id, email: "team@wonjd.com", name: "Team", role: "admin" },
  });

  const project = await prisma.project.create({
    data: {
      workspaceId: ws.id,
      no: "01",
      slug: "crm_frontend",
      title: "CRM Frontend",
    },
  });

  const epic = await prisma.issue.create({
    data: {
      projectId: project.id,
      kind: "epic",
      issueNo: "PRD-001",
      slug: "growth-pause",
      title: "일시정지 연장 현황",
      status: "review",
      mode: "existing",
      sortOrder: 1,
      body: await fs.readFile(
        path.join(root, "wireFrame/input/growth-pause.md"),
        "utf8"
      ),
      metaJson: JSON.stringify({
        overview: "성장 계정의 일시정지·연장 요청을 목록으로 보고 상세에서 처리한다.",
        notes: "기존 growthColumns 테이블 컬럼과 용어를 맞춘다.",
        diff: { new: 2, modify: 1, extend: 0 },
      }),
    },
  });

  const screens = [
    { slug: "01-list", issueNo: "01", title: "목록", badge: "NEW", route: "/growth/pause-status", file: "wireFrame/issue/01-list.html" },
    { slug: "02-detail", issueNo: "02", title: "상세", badge: "MODIFY", related: "growthColumns", file: "wireFrame/issue/02-detail.html" },
    { slug: "03-modal", issueNo: "03", title: "연장 모달", badge: "NEW", file: "wireFrame/issue/03-modal.html" },
  ];

  for (const [i, s] of screens.entries()) {
    const screen = await prisma.issue.create({
      data: {
        projectId: project.id,
        parentId: epic.id,
        kind: "screen",
        issueNo: s.issueNo,
        slug: s.slug,
        title: s.title,
        status: "review",
        sortOrder: i + 1,
        badge: s.badge,
        related: s.related,
        route: s.route,
      },
    });
    await prisma.issueVersion.create({
      data: {
        issueId: screen.id,
        version: 1,
        html: await readHtml(s.file),
        source: "seed",
      },
    });
  }

  console.log("seed ok:", { workspace: ws.slug, project: project.slug, epic: epic.slug });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
