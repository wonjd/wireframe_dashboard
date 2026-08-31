import fs from "node:fs/promises";
import path from "node:path";
import { registrySchema, type ExistingContext, type WireframeMode } from "@wireframe-studio/core";
import { detectExistingContext } from "@wireframe-studio/scanner";
import { buildGenerationPrompt, buildSpecDocument } from "@wireframe-studio/renderer";

export async function writeWireFrameOut(o: {
  root: string;
  project: string;
  id: string;
  title: string;
  prdText: string;
  detect: boolean;
  repoPath?: string;
}) {
  const { root, id } = o;
  await fs.mkdir(path.join(root, "spec"), { recursive: true });
  await fs.mkdir(path.join(root, "issue"), { recursive: true });
  await fs.mkdir(path.join(root, "input"), { recursive: true });
  await fs.mkdir(path.join(root, "prompt"), { recursive: true });
  await fs.writeFile(path.join(root, "input", `${id}.md`), o.prdText, "utf8");

  let detected: ExistingContext | undefined;
  if (o.detect) {
    detected = await detectExistingContext(o.repoPath ?? process.cwd());
    await fs.writeFile(path.join(root, "spec", `${id}.json`), JSON.stringify(detected, null, 2), "utf8");
  }

  await fs.writeFile(
    path.join(root, "spec", `${id}.md`),
    buildSpecDocument({ title: o.title, feature: id, prdText: o.prdText, detected }),
    "utf8"
  );

  const mode: WireframeMode = o.detect ? "existing" : "new";
  await fs.writeFile(
    path.join(root, "prompt", `${id}.txt`),
    buildGenerationPrompt({
      mode,
      prdText: o.prdText,
      projectSlug: o.project,
      feature: id,
      scan: detected as Record<string, unknown> | undefined,
    }),
    "utf8"
  );

  let registry;
  try {
    registry = registrySchema.parse(JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8")));
  } catch {
    registry = registrySchema.parse({ projects: [] });
  }
  let entry = registry.projects.find((p) => p.slug === o.project);
  if (!entry) {
    const no = String(registry.projects.length + 1).padStart(2, "0");
    entry = { no, slug: o.project, folder: "wireFrame", title: o.project, prds: [] };
    registry.projects.push(entry);
  }
  if (!entry.prds.find((p) => p.feature === id)) {
    entry.prds.push({
      prdNo: `PRD-${String(entry.prds.length + 1).padStart(3, "0")}`,
      feature: id,
      title: o.title,
      status: "draft",
      screenCount: 0,
    });
  }
  await fs.writeFile(path.join(root, "index.json"), JSON.stringify(registry, null, 2), "utf8");
  console.log(`완료 ${root}  spec/${id}.md  issue/{id}.html`);
}
