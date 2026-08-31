import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const projectsRoot = path.join(repoRoot, "wireFrame");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function projectsMiddleware(
  req: import("http").IncomingMessage,
  res: import("http").ServerResponse,
  next: (err?: unknown) => void
) {
  if (!req.url?.startsWith("/wireFrame")) return next();
  const rel = decodeURIComponent(req.url.slice("/wireFrame".length).split("?")[0]!);
  const filePath = path.normalize(path.join(projectsRoot, rel));
  if (!filePath.startsWith(projectsRoot)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return next();
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.end(data);
  });
}

function serveProjects() {
  return {
    name: "serve-projects",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => projectsMiddleware(req, res, next));
    },
    configurePreviewServer(server: import("vite").PreviewServer) {
      server.middlewares.use((req, res, next) => projectsMiddleware(req, res, next));
    },
    closeBundle() {
      const dest = path.join(__dirname, "dist/wireFrame");
      fs.cpSync(projectsRoot, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveProjects()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": "http://localhost:3001",
      "/wireframe/api": {
        target: "http://localhost:3001",
        rewrite: (path) => path.replace(/^\/wireframe\/api/, "/api"),
      },
    },
  },
  preview: {
    port: 5173,
  },
});
