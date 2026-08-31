import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const wireFrame = path.join(root, "wireFrame");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function serveWireFrame() {
  return {
    name: "serve-wireFrame",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url === "/" || url === "/index.html") {
          res.statusCode = 302;
          res.setHeader("Location", "/wireFrame");
          res.end();
          return;
        }
        if (!url.startsWith("/wireFrame")) return next();

        const rel = decodeURIComponent(url.slice("/wireFrame".length));
        if (rel && rel !== "/") {
          const filePath = path.normalize(path.join(wireFrame, rel));
          if (filePath.startsWith(wireFrame) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
            res.end(fs.readFileSync(filePath));
            return;
          }
        }

        req.url = "/index.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveWireFrame()],
  server: { port: 5173, open: "/wireFrame" },
  preview: { port: 5173 },
});
