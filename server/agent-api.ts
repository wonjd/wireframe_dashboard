import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnvFiles } from "./env.js";
import { runPrdAgentChat } from "./openai-agent.js";
import { runDbAgentChat } from "./db-agent.js";
import { dbEnvStatus } from "./db-env.js";
import { runSelectQuery } from "./db-query.js";
import { searchGlossary, serializeTerm } from "./db-glossary.js";
import {
  prdBuild,
  prdDelete,
  prdGet,
  prdList,
  prdSave,
  listWireframeScreens,
  wireframeDelete,
} from "./prd-tools.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function createAgentApiMiddleware(root: string) {
  loadEnvFiles(root);

  return async function agentApiMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    const url = req.url?.split("?")[0] ?? "";
    if (
      !url.startsWith("/api/agent") &&
      !url.startsWith("/api/db") &&
      !url.startsWith("/api/prd") &&
      !url.startsWith("/api/wireframes")
    ) {
      return next();
    }
    loadEnvFiles(root);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");

    try {
      if (url === "/api/agent/health" && req.method === "GET") {
        const hasKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
        sendJson(res, 200, {
          ok: true,
          openai: hasKey,
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        });
        return;
      }

      if (url === "/api/db/health" && req.method === "GET") {
        const hasKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
        sendJson(res, 200, {
          ...dbEnvStatus(),
          openai: hasKey,
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        });
        return;
      }

      if (url === "/api/agent/chat" && req.method === "POST") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          runId?: string;
          project?: string;
        };
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          sendJson(res, 400, { ok: false, error: "messages required" });
          return;
        }
        const result = await runPrdAgentChat({
          root,
          messages: body.messages,
          runId: body.runId,
          project: body.project || "crm",
        });
        sendJson(res, 200, result);
        return;
      }

      if (url === "/api/prd/list" && req.method === "GET") {
        const full = req.url || "";
        const qs = full.includes("?") ? new URL(full, "http://local").searchParams : new URLSearchParams();
        const project = (qs.get("project") || "").trim() || undefined;
        const result = prdList({ root, project });
        sendJson(res, result.ok === false ? 404 : 200, result);
        return;
      }

      if (url === "/api/wireframes/list" && req.method === "GET") {
        const full = req.url || "";
        const qs = full.includes("?") ? new URL(full, "http://local").searchParams : new URLSearchParams();
        const project = (qs.get("project") || "").trim() || undefined;
        const runId = (qs.get("runId") || "").trim() || undefined;
        const result = listWireframeScreens({ root, project, runId });
        sendJson(res, 200, result);
        return;
      }

      {
        const wfDelMatch = url.match(/^\/api\/wireframes\/([^/]+)$/);
        if (wfDelMatch && req.method === "DELETE") {
          const runId = decodeURIComponent(wfDelMatch[1] || "");
          const full = req.url || "";
          const qs = full.includes("?")
            ? new URL(full, "http://local").searchParams
            : new URLSearchParams();
          const project = (qs.get("project") || "crm").trim() || "crm";
          const mode = (qs.get("mode") || "artifacts").trim();
          const result =
            mode === "prd"
              ? prdDelete({ root, runId, project })
              : wireframeDelete({ root, runId, project });
          sendJson(res, result.ok === false ? 404 : 200, result);
          return;
        }
      }

      {
        const buildMatch = url.match(/^\/api\/prd\/([^/]+)\/build$/);
        if (buildMatch && req.method === "POST") {
          const runId = decodeURIComponent(buildMatch[1] || "");
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as { project?: string; assetProject?: string };
          const result = prdBuild({
            root,
            runId,
            project: body.project || "crm",
            assetProject: body.assetProject,
          });
          sendJson(res, result.ok === false ? 400 : 200, result);
          return;
        }
      }

      {
        const prdMatch = url.match(/^\/api\/prd\/([^/]+)$/);
        if (prdMatch) {
          const runId = decodeURIComponent(prdMatch[1] || "");
          if (!runId || runId === "list") {
            /* list handled above */
          } else if (req.method === "GET") {
            const full = req.url || "";
            const qs = full.includes("?")
              ? new URL(full, "http://local").searchParams
              : new URLSearchParams();
            const project = (qs.get("project") || "crm").trim() || "crm";
            const result = prdGet({ root, runId, project });
            sendJson(res, result.ok === false ? 404 : 200, result);
            return;
          } else if (req.method === "POST") {
            const raw = await readBody(req);
            const body = JSON.parse(raw || "{}") as {
              title?: string;
              content?: string;
              project?: string;
            };
            if (typeof body.content !== "string") {
              sendJson(res, 400, { ok: false, error: "content required" });
              return;
            }
            const existing = prdGet({
              root,
              runId,
              project: body.project || "crm",
            });
            if (existing.ok === false) {
              sendJson(res, 404, existing);
              return;
            }
            const realRunId = String(existing.runId || runId);
            const title =
              (body.title && body.title.trim()) ||
              (typeof existing.title === "string" ? existing.title : realRunId);
            const project =
              body.project ||
              (typeof existing.projectSlug === "string" ? existing.projectSlug : "crm");
            const result = prdSave({
              root,
              runId: realRunId,
              title,
              content: body.content,
              project,
            });
            const fresh = prdGet({ root, runId: realRunId, project });
            sendJson(res, result.ok === false ? 500 : 200, {
              ...result,
              status: fresh.status,
              title: fresh.title,
              content: fresh.content,
              runId: fresh.runId,
              routeId: fresh.routeId,
              no: fresh.no,
            });
            return;
          } else if (req.method === "DELETE") {
            const full = req.url || "";
            const qs = full.includes("?")
              ? new URL(full, "http://local").searchParams
              : new URLSearchParams();
            const project = (qs.get("project") || "crm").trim() || "crm";
            const result = prdDelete({ root, runId, project });
            sendJson(res, result.ok === false ? 404 : 200, result);
            return;
          }
        }
      }

      if (url === "/api/db/terms" && req.method === "GET") {
        const full = req.url || "";
        const qs = full.includes("?") ? new URL(full, "http://local").searchParams : new URLSearchParams();
        const q = (qs.get("q") || "").trim();
        const slug = (qs.get("project") || "crm").trim() || "crm";
        const limit = Number(qs.get("limit") || 20);
        if (!q) {
          sendJson(res, 400, { ok: false, error: "q required" });
          return;
        }
        const terms = await searchGlossary(root, q, { slug, limit });
        sendJson(res, 200, {
          ok: true,
          query: q,
          project: slug,
          terms: terms.map(serializeTerm),
        });
        return;
      }

      if (url === "/api/db/chat" && req.method === "POST") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          project?: string;
        };
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          sendJson(res, 400, { ok: false, error: "messages required" });
          return;
        }
        const result = await runDbAgentChat({
          root,
          messages: body.messages,
          project: body.project || "crm",
        });
        sendJson(res, 200, result);
        return;
      }

      if (url === "/api/db/query" && req.method === "POST") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { sql?: string };
        if (!body.sql || typeof body.sql !== "string") {
          sendJson(res, 400, { ok: false, error: "sql required" });
          return;
        }
        const result = await runSelectQuery(body.sql);
        sendJson(res, 200, {
          ok: true,
          sql: result.sql,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          truncated: result.truncated,
          ms: result.ms,
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
