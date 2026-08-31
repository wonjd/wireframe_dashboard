import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import type { Registry } from "../types";
import { useWireframeData } from "../lib/data";
import { Sidebar } from "./Sidebar";

export function WireframeLayout() {
  const { loadRegistry } = useWireframeData();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { projectNo, feature, screenId } = useParams();

  useEffect(() => {
    loadRegistry()
      .then(setRegistry)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [loadRegistry]);

  if (error) return <div className="wfs-empty">{error}</div>;
  if (!registry) return <div className="wfs-empty">로딩 중…</div>;

  return (
    <div className="wfs-layout">
      <Sidebar registry={registry} activeProjectNo={projectNo} activeFeature={feature} activeScreen={screenId} />
      <main className="wfs-main">
        <Outlet context={{ registry }} />
      </main>
    </div>
  );
}
