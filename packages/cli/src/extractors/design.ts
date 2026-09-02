import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { resolveProjectSourcePaths } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";

const HEX = /#(?:[0-9a-fA-F]{3,8})\b/g;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function listComponentFiles(frontendRoot: string): Promise<string[]> {
  const roots = ["src/components/common", "src/components/shared", "src/components/layout"];
  const files: string[] = [];
  for (const rel of roots) {
    const dir = path.join(frontendRoot, rel);
    try {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".tsx")) {
          files.push(path.join(rel, entry.name).replaceAll("\\", "/"));
        }
      }
    } catch {
      // optional tree
    }
  }
  return files.sort();
}

export async function extractDesignAssets(project: ResolvedProject): Promise<string> {
  const { frontend } = resolveProjectSourcePaths(project);
  const themePath = path.join(frontend, "src/config/theme.ts");
  const layoutConstants = path.join(frontend, "src/constants/constant.ts");

  const [themeSource, constantsSource] = await Promise.all([
    readFile(themePath, "utf8"),
    readFile(layoutConstants, "utf8").catch(() => ""),
  ]);

  const colors = unique([...(themeSource.match(HEX) ?? []), ...(constantsSource.match(HEX) ?? [])]);
  const spacingMatch = themeSource.match(/spacing:\s*(\d+)/);
  const radiusMatch = themeSource.match(/borderRadius:\s*(\d+)/);
  const componentFiles = await listComponentFiles(frontend);

  const payload = {
    source: project.sources.frontend,
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    color: Object.fromEntries(colors.map((hex, index) => [`token-${index + 1}`, hex])),
    spacing: unique([
      Number(spacingMatch?.[1] ?? 4),
      8,
      12,
      16,
      24,
      32,
    ]),
    radius: {
      card: `${radiusMatch?.[1] ?? 4}px`,
      control: `${radiusMatch?.[1] ?? 4}px`,
    },
    type: {
      family: "Pretendard, sans-serif",
      scale: [11, 12, 13, 14, 15, 20],
    },
    layout: {
      minWidth: constantsSource.match(/MIN_WIDTH\s*=\s*"([^"]+)"/)?.[1] ?? "600px",
      topNavHeight: constantsSource.match(/TOPNAV_HEIGHT\s*=\s*"([^"]+)"/)?.[1] ?? "50px",
      sideNavWidth: constantsSource.match(/SIDENAV_WIDTH\s*=\s*"([^"]+)"/)?.[1] ?? "220px",
    },
    component: componentFiles.slice(0, 40).map((file) => ({
      name: path.basename(file, ".tsx"),
      file,
    })),
  };

  return writeProjectJson(project, "design", payload);
}
