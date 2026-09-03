import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { resolveProjectSourcePaths } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";

type ScreenKind = "list" | "detail" | "form" | "other";

type RouteRow = {
  path: string;
  file: string;
  label: string;
  screenKind: ScreenKind;
  keywords: string[];
};

function normalizeRoutePath(link: string): string {
  const trimmed = link.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parseImportMap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe = /import\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function resolvePageFile(frontendRoot: string, importPath: string): string {
  const normalized = importPath.replace(/^\.\.\//, "src/");
  const candidate = path.join(frontendRoot, `${normalized}.tsx`);
  return candidate.replaceAll("\\", "/").replace(`${frontendRoot.replaceAll("\\", "/")}/`, "");
}

function guessScreenKind(pathStr: string, label: string, file: string): ScreenKind {
  const blob = `${pathStr} ${label} ${file}`.toLowerCase();
  if (/regist|create|write|edit|form|요청|등록|작성|수정/.test(blob)) return "form";
  if (/detail|view|info|상세/.test(blob)) return "detail";
  if (/list|목록|search|관리/.test(blob) || /\/$/.test(pathStr)) return "list";
  return "other";
}

function keywordsFrom(pathStr: string, label: string, file: string): string[] {
  const tokens = new Set<string>();
  for (const part of pathStr.split(/[\/\-_]/).filter(Boolean)) {
    if (part.length >= 2) tokens.add(part.toLowerCase());
  }
  for (const part of label.split(/\s+/).filter((t) => t.length >= 2)) {
    tokens.add(part.toLowerCase());
  }
  const base = path.basename(file, ".tsx");
  for (const part of base.split(/(?=[A-Z])|[_\-]/).filter((t) => t.length >= 2)) {
    tokens.add(part.toLowerCase());
  }
  return [...tokens].slice(0, 12);
}

function parseNavItems(navSource: string, frontendRoot: string, imports: Map<string, string>): RouteRow[] {
  const routes: RouteRow[] = [];
  const blockRe = /title:\s*"([^"]+)"[\s\S]*?element:\s*<(\w+)\s*\/?>[\s\S]*?link:\s*"([^"]+)"/g;

  for (const match of navSource.matchAll(blockRe)) {
    const [, label, componentName, link] = match;
    const importPath = imports.get(componentName);
    const file = importPath ? resolvePageFile(frontendRoot, importPath) : `src/pages/${componentName}.tsx`;
    const routePath = normalizeRoutePath(link);
    routes.push({
      path: routePath,
      file,
      label,
      screenKind: guessScreenKind(routePath, label, file),
      keywords: keywordsFrom(routePath, label, file),
    });
  }

  return routes;
}

function parseRouterConfig(routerSource: string): RouteRow[] {
  const routes: RouteRow[] = [];
  const routeRe = /path:\s*"([^"]+)"[\s\S]*?element:\s*<(\w+)\s*\/?>/g;
  for (const match of routerSource.matchAll(routeRe)) {
    const [, routePath, componentName] = match;
    if (routePath === "/") continue;
    const file = `src/pages/${componentName}.tsx`;
    const normalized = normalizeRoutePath(routePath);
    routes.push({
      path: normalized,
      file,
      label: componentName,
      screenKind: guessScreenKind(normalized, componentName, file),
      keywords: keywordsFrom(normalized, componentName, file),
    });
  }
  return routes;
}

export async function extractRouteAssets(project: ResolvedProject): Promise<string> {
  const { frontend } = resolveProjectSourcePaths(project);
  const navPath = path.join(frontend, "src/config/nav-config.tsx");
  const routerPath = path.join(frontend, "src/config/router-config.tsx");

  const [navSource, routerSource] = await Promise.all([
    readFile(navPath, "utf8"),
    readFile(routerPath, "utf8").catch(() => ""),
  ]);

  const imports = parseImportMap(navSource);
  const fromNav = parseNavItems(navSource, frontend, imports);
  const fromRouter = parseRouterConfig(routerSource);

  const merged = new Map<string, RouteRow>();
  for (const route of [...fromNav, ...fromRouter]) {
    const existing = merged.get(route.path);
    if (!existing || (existing.label === existing.file && route.label !== route.file)) {
      merged.set(route.path, route);
    }
  }

  const payload = {
    source: project.sources.frontend,
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    routes: [...merged.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };

  return writeProjectJson(project, "routes", payload);
}
