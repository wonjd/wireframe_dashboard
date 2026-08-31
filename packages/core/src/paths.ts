import type { Manifest, ProjectEntry } from "./schema.js";

export const WIREFRAME_DIR = "wireFrame";

export function specPath(issueId: string): string {
  return `${WIREFRAME_DIR}/spec/${issueId}.md`;
}

export function specJsonPath(issueId: string): string {
  return `${WIREFRAME_DIR}/spec/${issueId}.json`;
}

export function issueHtmlPath(issueId: string): string {
  return `${WIREFRAME_DIR}/issue/${issueId}.html`;
}

export function promptPath(issueId: string): string {
  return `${WIREFRAME_DIR}/prompt/${issueId}.txt`;
}

export function prdPath(issueId: string): string {
  return `${WIREFRAME_DIR}/input/${issueId}.md`;
}

export function manifestPath(_project: ProjectEntry, feature: string): string {
  return `${WIREFRAME_DIR}/spec/${feature}.manifest.json`;
}

export function screenUrl(_project: ProjectEntry, _manifest: Manifest, screenId: string): string {
  return `/${issueHtmlPath(screenId)}`;
}

export function wireframePath(projectNo: string, feature: string, screenId?: string, tab?: string): string {
  const base = `/wireframe/${projectNo}/${feature}`;
  if (screenId) return `${base}/screens/${screenId}`;
  if (tab && tab !== "screens") return `${base}?tab=${tab}`;
  return base;
}
