import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleWireframeApi } from "@wireframe-studio/server/routes";

const app = new Hono();
app.use("/api/*", cors());
app.use("/wireframe/api/*", cors());

app.get("/api/*", (c) => {
  const path = c.req.path.replace(/^\/api\//, "").split("/").filter(Boolean);
  return handleWireframeApi(path);
});

app.get("/wireframe/api/*", (c) => {
  const path = c.req.path.replace(/^\/wireframe\/api\//, "").split("/").filter(Boolean);
  return handleWireframeApi(path);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`api http://localhost:${port}`);
serve({ fetch: app.fetch, port });
