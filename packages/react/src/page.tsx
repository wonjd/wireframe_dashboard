"use client";

import { WireframeApp } from "@wireframe-studio/viewer/wireframe";
import "@wireframe-studio/viewer/styles.css";

/** Vite / CRA / Next Pages — client-only, `/wireframe/api` 프록시 필요 */
export default function WireframePage() {
  return <WireframeApp basePath="/wireframe" apiBase="/wireframe/api" />;
}
