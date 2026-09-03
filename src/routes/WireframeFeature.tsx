import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import type { Manifest, Registry } from "../types";
import { findProject, useWireframeData } from "../lib/data";
import { NotFoundPage } from "../components/NotFoundPage";

function safeDecode(value: string): string {
  try {
    let out = value;
    for (let i = 0; i < 2; i += 1) {
      if (!/%[0-9A-Fa-f]{2}/.test(out)) break;
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    }
    return out;
  } catch {
    return value;
  }
}

export function WireframeFeature() {
  const { projectNo = "", feature: rawFeature = "", screenId: rawScreenId } = useParams();
  const feature = safeDecode(rawFeature);
  const screenId = rawScreenId ? safeDecode(rawScreenId) : undefined;
  const { registry } = useOutletContext<{ registry: Registry }>();
  const data = useWireframeData();
  const project = findProject(registry, projectNo);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    setManifest(null);
    setIframeSrc(null);
    setLoadError(null);
    setNotFound(false);
    setLoading(true);
    data
      .loadManifest(project, feature)
      .then((m) => {
        setManifest(m);
        setNotFound(false);
      })
      .catch(() => {
        setManifest(null);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [project, feature, data]);

  const screens = useMemo(
    () => (manifest?.screens ?? []).filter((s) => s.id !== "00-overview"),
    [manifest],
  );
  const activeId = screenId ?? screens[0]?.id;

  useEffect(() => {
    if (!project || !manifest || !activeId) return;
    let cancelled = false;
    setIframeSrc(null);
    setLoadError(null);

    const direct = data.artifactUrl(manifest, activeId);
    data
      .loadHtml(project, manifest, activeId)
      .then((html) => {
        if (cancelled) return;
        if (html && html.trim()) {
          setIframeSrc(direct);
          setLoadError(null);
        } else {
          setIframeSrc(null);
          setLoadError(
            `HTML을 불러오지 못했습니다 (${activeId}). 경로: ${direct ?? "—"}`,
          );
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setIframeSrc(null);
        setLoadError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [project, manifest, activeId, data]);

  if (!project || notFound) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail={
          feature
            ? `「${feature}」 화면이 없거나 아직 생성되지 않았습니다.`
            : "해당 프로젝트에 생성된 화면이 없습니다."
        }
      />
    );
  }
  if (loading || !manifest) return <div className="wfs-empty">로딩 중…</div>;

  if (!screens.length) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail="매니페스트는 있지만 화면 HTML이 아직 없습니다. 빌드를 다시 실행하세요."
      />
    );
  }

  if (!screenId && screens[0]) {
    return (
      <Navigate
        to={`/wireframes/${projectNo}/${feature}/screens/${screens[0].id}`}
        replace
      />
    );
  }

  const base = `/wireframes/${projectNo}/${feature}/screens`;

  return (
    <div className="wfs-viewer wfs-viewer-solo">
      <header className="wfs-screen-bar">
        <Link className="wfs-screen-bar-link" to="/wireframes">
          ← 목록
        </Link>
        <nav className="wfs-flow-nav" aria-label="플로우">
          {screens.map((s) => {
            const active = s.id === activeId;
            return (
              <Link
                key={s.id}
                className={`wfs-flow-btn${active ? " is-active" : ""}`}
                to={`${base}/${s.id}`}
                title={s.label}
              >
                <span className="wfs-flow-btn-no">{String(s.no).padStart(2, "0")}</span>
                <span className="wfs-flow-btn-label">{s.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {loadError ? <div className="wfs-chat-banner is-error">{loadError}</div> : null}

      <div className="wfs-iframe-wrap wfs-iframe-wrap-solo">
        {iframeSrc ? (
          <iframe
            key={iframeSrc}
            title={activeId}
            src={iframeSrc}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : !loadError ? (
          <div className="wfs-empty">화면 불러오는 중…</div>
        ) : (
          <NotFoundPage
            title="생성된 와이어프레임이 없습니다"
            detail={loadError}
          />
        )}
      </div>
    </div>
  );
}
