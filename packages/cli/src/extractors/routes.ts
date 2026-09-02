import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { resolveProjectSourcePaths } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";

type RouteRow = {
  path: string;
  file: string;
  label: string;
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

function parseNavItems(navSource: string, frontendRoot: string, imports: Map<string, string>): RouteRow[] {
  const routes: RouteRow[] = [];
  const blockRe = /title:\s*"([^"]+)"[\s\S]*?element:\s*<(\w+)\s*\/?>[\s\S]*?link:\s*"([^"]+)"/g;

  for (const match of navSource.matchAll(blockRe)) {
    const [, label, componentName, link] = match;
    const importPath = imports.get(componentName);
    const file = importPath ? resolvePageFile(frontendRoot, importPath) : `src/pages/${componentName}.tsx`;
    routes.push({
      path: normalizeRoutePath(link),
      file,
      label,
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
    routes.push({
      path: normalizeRoutePath(routePath),
      file: `src/pages/${componentName}.tsx`,
      label: componentName,
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
    merged.set(route.path, route);
  }

  const payload = {
    source: project.sources.frontend,
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    routes: [...merged.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };

  return writeProjectJson(project, "routes", payload);
}
