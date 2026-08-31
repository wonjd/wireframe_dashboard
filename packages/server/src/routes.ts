import { getManifest, getRegistry, getScreenHtml } from "./index.js";

/** `/wireframe/api/*` catch-all용 — 클론 프로젝트 route.ts에서 1줄로 호출 */
export async function handleWireframeApi(path: string[]): Promise<Response> {
  if (path.length === 0 || path[0] === "registry") {
    return Response.json(await getRegistry());
  }

  if (path[0] === "projects" && path.length === 4 && path[2] === "epics") {
    const manifest = await getManifest(path[1]!, path[3]!);
    if (!manifest) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(manifest);
  }

  if (path[0] === "html" && path.length === 4) {
    const html = await getScreenHtml(path[1]!, path[2]!, path[3]!);
    if (!html) return new Response("not found", { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
