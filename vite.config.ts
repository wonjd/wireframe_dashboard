import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createAgentApiMiddleware } from "./server/agent-api";

const root = path.dirname(fileURLToPath(import.meta.url));
const wireFrame = path.join(root, "wireFrame");
const projectsDir = path.join(root, "projects");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** Serve files from wireFrame/ at site root (and legacy /wireFrame/*). */
function resolveWireFrameFile(urlPath: string): string | null {
  let rel = decodeURIComponent(urlPath.split("?")[0] ?? "");
  if (rel.startsWith("/wireFrame")) rel = rel.slice("/wireFrame".length) || "/";
  if (!rel || rel === "/") return null;
  if (
    !(
      rel === "/index.json" ||
      rel.startsWith("/runs/") ||
      rel.startsWith("/spec/") ||
      rel.startsWith("/issue/") ||
      rel.startsWith("/input/")
    )
  ) {
    return null;
  }
  const filePath = path.normalize(path.join(wireFrame, rel));
  if (!filePath.startsWith(wireFrame)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function resolveProjectAsset(urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath.split("?")[0] ?? "");
  if (!rel.startsWith("/projects/")) return null;
  const filePath = path.normalize(path.join(root, rel));
  if (!filePath.startsWith(projectsDir)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return filePath;
}

function serveApp() {
  return {
    name: "serve-wireframe-app",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(createAgentApiMiddleware(root));

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";

        // Known data paths must NOT fall through to SPA index.html
        const isDataPath =
          url === "/index.json" ||
          url.startsWith("/runs/") ||
          url.startsWith("/spec/") ||
          url.startsWith("/issue/") ||
          url.startsWith("/input/") ||
          url.startsWith("/projects/") ||
          url.startsWith("/wireFrame/");

        if (!isDataPath) return next();

        const filePath = resolveWireFrameFile(url) ?? resolveProjectAsset(url);
        if (!filePath) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(`not found: ${url}`);
          return;
        }
        res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
        res.end(fs.readFileSync(filePath));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveApp()],
  server: { open: "/prd" },
});
