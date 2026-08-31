import fs from "node:fs/promises";
import path from "node:path";

export type ScanResult = {
  repoPath: string;
  repoName: string;
  theme: {
    layout: string;
    components: string[];
    tokens: Record<string, string>;
  };
  domains: string[];
  relatedFiles: string[];
};

export async function scanExistingProject(repoPath: string): Promise<ScanResult> {
  const abs = path.resolve(repoPath);
  const repoName = path.basename(abs);
  const relatedFiles: string[] = [];
  const domains: string[] = [];

  for (const rel of ["package.json", "src/app", "src/pages", "app", "components"]) {
    try {
      await fs.access(path.join(abs, rel));
      relatedFiles.push(rel);
    } catch {
      /* skip */
    }
  }

  try {
    const pkg = JSON.parse(await fs.readFile(path.join(abs, "package.json"), "utf8")) as { name?: string };
    if (pkg.name) domains.push(pkg.name);
  } catch {
    /* no package.json */
  }

  for (const root of ["src/app", "app", "src/pages"]) {
    try {
      const entries = await fs.readdir(path.join(abs, root), { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("(")) domains.push(e.name);
      }
    } catch {
      /* skip */
    }
  }

  return {
    repoPath: abs,
    repoName,
    theme: {
      layout: "admin-sidebar",
      components: ["table", "form", "modal", "sidebar"],
      tokens: { note: "design-kit과 diff 후 수동 보정" },
    },
    domains: [...new Set(domains)].slice(0, 12),
    relatedFiles,
  };
}
