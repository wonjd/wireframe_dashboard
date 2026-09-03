import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { resolveProjectSourcePaths } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";

const HEX = /#(?:[0-9a-fA-F]{3,8})\b/g;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : raw;
  if (full.length !== 6 || Number.isNaN(Number.parseInt(full, 16))) return 999;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function buildSemanticColors(colors: string[]): Record<string, string> {
  const byLum = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const dark = byLum.find((hex) => luminance(hex) < 80) ?? "#23262e";
  const mid =
    byLum.find((hex) => {
      const raw = hex.replace("#", "");
      const full =
        raw.length === 3
          ? raw
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : raw;
      if (full.length !== 6) return false;
      const r = Number.parseInt(full.slice(0, 2), 16);
      const g = Number.parseInt(full.slice(2, 4), 16);
      const b = Number.parseInt(full.slice(4, 6), 16);
      const lum = luminance(hex);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      return lum >= 80 && lum < 180 && chroma < 40;
    }) ?? "#666666";
  const line =
    byLum.find((hex) => luminance(hex) >= 200 && luminance(hex) < 245) ?? "#d9d9d9";
  // Prefer saturated mid/dark as brand (skip near-white)
  const brand =
    colors.find((hex) => {
      const lum = luminance(hex);
      return lum > 40 && lum < 160 && !/^#fff/i.test(hex);
    }) ??
    colors[0] ??
    "#246beb";
  const danger =
    colors.find((hex) => {
      const raw = hex.replace("#", "");
      const full =
        raw.length === 3
          ? raw
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : raw;
      if (full.length !== 6) return false;
      const r = Number.parseInt(full.slice(0, 2), 16);
      const g = Number.parseInt(full.slice(2, 4), 16);
      const b = Number.parseInt(full.slice(4, 6), 16);
      return r > 160 && g < 100 && b < 100;
    }) ?? "#e74c3c";

  return {
    brand,
    ink: dark,
    line,
    muted: mid,
    danger,
  };
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
  const semantic = buildSemanticColors(colors);

  const payload = {
    source: project.sources.frontend,
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    color: {
      ...semantic,
      ...Object.fromEntries(colors.map((hex, index) => [`token-${index + 1}`, hex])),
    },
    spacing: unique([Number(spacingMatch?.[1] ?? 4), 8, 12, 16, 24, 32]),
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
