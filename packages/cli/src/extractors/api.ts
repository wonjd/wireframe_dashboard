import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { resolveProjectSourcePaths } from "../lib/config.js";
import { writeProjectJson } from "../lib/paths.js";

type Endpoint = {
  method: string;
  path: string;
  fields: string[];
  controller: string;
};

function parseRouteMounts(routesIndex: string): Array<{ base: string; symbol: string }> {
  const mounts: Array<{ base: string; symbol: string }> = [];
  const mountRe = /router\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
  for (const match of routesIndex.matchAll(mountRe)) {
    mounts.push({ base: `/${match[1]}`.replace(/\/+/g, "/"), symbol: match[2] });
  }
  return mounts;
}

function parseControllerImports(routesIndex: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe = /import\s+(\w+)\s+from\s+["']\.\.\/controllers\/([^"']+)["']/g;
  for (const match of routesIndex.matchAll(importRe)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function joinPaths(base: string, routePath: string): string {
  if (!routePath || routePath === "/") return base;
  const suffix = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `${base}${suffix}`.replace(/\/+/g, "/");
}

function parseControllerMethods(controllerSource: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const routeRe = /router\.(get|post|put|delete|patch)\(\s*["']([^"']*)["']/gi;
  for (const match of controllerSource.matchAll(routeRe)) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] || "/" });
  }
  return routes;
}

async function readTypeFields(backendRoot: string, controllerFile: string): Promise<string[]> {
  const baseName = path.basename(controllerFile, ".ts").replace(/Controller$/, "");
  const typeName = `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Type`;
  const typePath = path.join(backendRoot, "src/types", `${typeName}.ts`);
  try {
    const source = await readFile(typePath, "utf8");
    const fields: string[] = [];
    const fieldRe = /^\s+([A-Z][A-Z0-9_]+)(\?)?:/gm;
    for (const match of source.matchAll(fieldRe)) {
      fields.push(match[1]);
    }
    return fields;
  } catch {
    return [];
  }
}

export async function extractApiAssets(project: ResolvedProject): Promise<string> {
  const { backend } = resolveProjectSourcePaths(project);
  const routesIndexPath = path.join(backend, "src/api/routes/index.ts");
  const routesIndex = await readFile(routesIndexPath, "utf8");

  const mounts = parseRouteMounts(routesIndex);
  const imports = parseControllerImports(routesIndex);
  const endpoints: Endpoint[] = [];

  for (const mount of mounts) {
    const controllerFile = imports.get(mount.symbol);
    if (!controllerFile) continue;

    const controllerPath = path.join(
      backend,
      "src/api/controllers",
      controllerFile.endsWith(".ts") ? controllerFile : `${controllerFile}.ts`,
    );
    let controllerSource = "";
    try {
      controllerSource = await readFile(controllerPath, "utf8");
    } catch {
      continue;
    }
    const methods = parseControllerMethods(controllerSource);
    const fields = await readTypeFields(backend, controllerFile);

    for (const method of methods) {
      endpoints.push({
        method: method.method,
        path: joinPaths(mount.base, method.path),
        fields,
        controller: controllerFile,
      });
    }
  }

  const payload = {
    source: project.sources.backend,
    projectSlug: project.slug,
    extractedAt: new Date().toISOString(),
    endpoints: endpoints.sort((a, b) => a.path.localeCompare(b.path)),
  };

  return writeProjectJson(project, "api", payload);
}
