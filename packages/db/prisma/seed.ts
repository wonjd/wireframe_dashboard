import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function readHtml(rel: string) {
  return fs.readFile(path.join(root, rel), "utf8");
}

async function main() {
  await prisma.wireframeIssue.deleteMany();

  const epic = await prisma.wireframeIssue.create({
    data: {
      projectNo: "01",
      projectSlug: "crm_frontend",
      projectTitle: "CRM Frontend",
      slug: "growth-pause",
      title: "일시정지 연장 현황",
      issueNo: "PRD-001",
      sortOrder: 1,
    },
  });

  const screens = [
    { slug: "01-list", issueNo: "01", title: "목록", route: "/growth/pause-status", file: "wireFrame/issue/01-list.html" },
    { slug: "02-detail", issueNo: "02", title: "상세", file: "wireFrame/issue/02-detail.html" },
    { slug: "03-modal", issueNo: "03", title: "연장 모달", file: "wireFrame/issue/03-modal.html" },
  ];

  for (const [i, s] of screens.entries()) {
    await prisma.wireframeIssue.create({
      data: {
        parentId: epic.id,
        projectNo: "01",
        projectSlug: "crm_frontend",
        projectTitle: "CRM Frontend",
        slug: s.slug,
        title: s.title,
        issueNo: s.issueNo,
        html: await readHtml(s.file),
        sortOrder: i + 1,
        route: s.route,
      },
    });
  }

  console.log("seed ok:", { project: "01", epic: epic.slug, screens: screens.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
