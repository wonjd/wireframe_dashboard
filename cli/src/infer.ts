import path from "node:path";

export function slugify(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "feature";
}

export function inferIssue(prdText: string, prdPath?: string) {
  const heading = prdText.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fileBase = prdPath ? path.basename(prdPath).replace(/\.(md|txt)$/i, "") : "";
  const title = heading || fileBase || "새 기능";
  const raw = fileBase && fileBase.toLowerCase() !== "prd" ? fileBase : heading || "feature";
  return { title, id: slugify(raw) };
}
