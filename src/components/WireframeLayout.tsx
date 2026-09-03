import { useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import type { Registry } from "../types";
import { useWireframeData } from "../lib/data";
import { NotFoundPage } from "./NotFoundPage";

export function WireframeLayout() {
  const { loadRegistry } = useWireframeData();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { projectNo, screenId } = useParams();
  const isList = !projectNo;
  const isScreenSolo = Boolean(screenId);

  useEffect(() => {
    loadRegistry()
      .then((reg) => {
        setRegistry(reg);
        setMissing(false);
        setError(null);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (/없음|404|not found|Failed to fetch/i.test(msg)) {
          setMissing(true);
          setError(null);
        } else {
          setMissing(false);
          setError(msg);
        }
        setRegistry(null);
      });
  }, [loadRegistry]);

  if (missing) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail="PRD를 확정한 뒤 와이어프레임을 생성하면 여기에 표시됩니다."
      />
    );
  }
  if (error) return <div className="wfs-empty">{error}</div>;
  if (!registry) return <div className="wfs-empty">로딩 중…</div>;

  const hasWireframes = registry.projects.some((p) => p.prds.length > 0);
  if (!hasWireframes) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail="PRD를 확정한 뒤 와이어프레임을 생성하면 여기에 표시됩니다."
      />
    );
  }

  // Screen view: no project sidebar — one HTML flow only.
  if (isScreenSolo || (!isList && projectNo)) {
    return (
      <main className={`wfs-main wfs-main-solo${isScreenSolo ? " wfs-main-screen" : ""}`}>
        <Outlet context={{ registry }} />
      </main>
    );
  }

  return (
    <main className="wfs-main wfs-main-full">
      <Outlet context={{ registry }} />
    </main>
  );
}
