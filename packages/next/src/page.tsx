import { fetchManifest, fetchRegistry, fetchScreenHtml } from "./actions";
import { WireframeApp } from "@wireframe-studio/viewer/wireframe";
import "@wireframe-studio/viewer/styles.css";

/**
 * 클론 프로젝트에 이 파일 하나만 복사:
 * app/wireframe/[[...slug]]/page.tsx
 */
export default async function WireframePage() {
  const registry = await fetchRegistry();
  return (
    <WireframeApp
      basePath="/wireframe"
      initialRegistry={registry}
      loaders={{
        loadRegistry: fetchRegistry,
        loadManifest: fetchManifest,
        loadHtml: fetchScreenHtml,
      }}
    />
  );
}
