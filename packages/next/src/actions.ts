"use server";

import { getManifest, getRegistry, getScreenHtml } from "@wireframe-studio/server";

export async function fetchRegistry() {
  return getRegistry();
}

export async function fetchManifest(projectNo: string, epicSlug: string) {
  const m = await getManifest(projectNo, epicSlug);
  if (!m) throw new Error("manifest not found");
  return m;
}

export async function fetchScreenHtml(projectNo: string, epicSlug: string, screenSlug: string) {
  return getScreenHtml(projectNo, epicSlug, screenSlug);
}
