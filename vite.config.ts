import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createAgentApiMiddleware } from "./server/agent-api";
import { dbConfigured } from "./server/db";
import { buildIndex, ensureMigrated, getSpec, scratchRoot, SPEC_NAMES, type SpecName } from "./server/store";

const root = path.dirname(fileURLToPath(import.meta.url));
const wireFrame = path.join(root, "wireFrame");
const scratch = scratchRoot(root);
const projectsDir = path.join(root, "projects");

const SPEC_SET = new Set<string>(SPEC_NAMES);

/** GET /runs/<runId>/spec/<name>.json → { runId, name } when name is a known spec. */
function matchSpecPath(rel: string): { runId: string; name: string } | null {
  const match = /^\/runs\/(.+)\/spec\/([^/]+)\.json$/.exec(rel);
  if (!match) return null;
  const [, runId, name] = match;
  if (!SPEC_SET.has(name)) return null;
  return { runId, name };
}

/** Serve a run's file (HTML/input) from the scratch cache first, then legacy wireFrame/. */
function resolveRunFile(urlPath: string): string | null {
  let rel = decodeURIComponent(urlPath.split("?")[0] ?? "");
  if (rel.startsWith("/wireFrame")) rel = rel.slice("/wireFrame".length) || "/";
  if (!rel || rel === "/") return null;
  for (const base of [scratch, wireFrame]) {
    const filePath = path.normalize(path.join(base, rel));
    if (!filePath.startsWith(base)) continue;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  }
  return null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function resolveProjectAsset(urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath.split("?")[0] ?? "");
  if (!rel.startsWith("/projects/")) return null;
  const filePath = path.normalize(path.join(root, rel));
  if (!filePath.startsWith(projectsDir)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

/**
 * Serve run data. Structured specs + the registry come from Postgres (source of truth);
 * rendered HTML and PRD inputs come from the scratch cache (regenerated), with the legacy
 * wireFrame/ tree as fallback. A DB error falls through to files so the app keeps working.
 */
async function handleDataRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  next: (err?: unknown) => void,
): Promise<void> {
  const url = req.url?.split("?")[0] ?? "";
  const isDataPath =
    url === "/index.json" ||
    url.startsWith("/runs/") ||
    url.startsWith("/spec/") ||
    url.startsWith("/issue/") ||
    url.startsWith("/input/") ||
    url.startsWith("/projects/") ||
    url.startsWith("/wireFrame/");
  if (!isDataPath) return next();

  let rel = decodeURIComponent(url);
  if (rel.startsWith("/wireFrame")) rel = rel.slice("/wireFrame".length) || "/";

  if (dbConfigured()) {
    try {
      await ensureMigrated(root);
      if (rel === "/index.json") {
        const index = await buildIndex();
        if ((index.projects as unknown[]).length > 0) {
          res.setHeader("Content-Type", MIME[".json"]);
          res.end(JSON.stringify(index));
          return;
        }
      }
      const spec = matchSpecPath(rel);
      if (spec) {
        const data = await getSpec(spec.runId, spec.name as SpecName);
        if (data != null) {
          res.setHeader("Content-Type", MIME[".json"]);
          res.end(JSON.stringify(data));
          return;
        }
      }
    } catch (err) {
      console.warn(`[data] DB read failed for ${url}, falling back to files:`, err);
    }
  }

  const filePath = resolveRunFile(url) ?? resolveProjectAsset(url);
  if (!filePath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`not found: ${url}`);
    return;
  }
  res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
  res.end(fs.readFileSync(filePath));
}

function serveApp() {
  return {
    name: "serve-wireframe-app",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(createAgentApiMiddleware(root));

      server.middlewares.use((req, res, next) => {
        void handleDataRequest(req, res, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveApp()],
  server: { open: "/prd" },
});
