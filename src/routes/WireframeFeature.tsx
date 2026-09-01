import { useEffect, useState } from "react";
import { Navigate, useOutletContext, useParams } from "react-router-dom";
import type { Manifest, Registry } from "../types";
import { findProject, useWireframeData } from "../lib/data";

export function WireframeFeature() {
  const { projectNo = "", feature = "", screenId } = useParams();
  const { registry } = useOutletContext<{ registry: Registry }>();
  const data = useWireframeData();
  const project = findProject(registry, projectNo);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [doc, setDoc] = useState("");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!project) return;
    setManifest(null);
    setDoc("");
    setErrMsg("");
    data.loadManifest(project, feature).then(setManifest).catch((e) => setErrMsg(String(e)));
  }, [project, feature, data]);

  const activeId = screenId ?? manifest?.screens[0]?.id;

  useEffect(() => {
    if (!project || !manifest || !activeId) return;
    let cancelled = false;
    setDoc("");
    data.loadHtml(project, manifest, activeId).then((h) => {
      if (!cancelled) setDoc(h ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [project, manifest, activeId, data]);

  if (!project) return <div className="wfs-empty">not found</div>;
  if (errMsg) return <div className="wfs-empty">{errMsg}</div>;
  if (!manifest) return <div className="wfs-empty">loading</div>;
  if (!screenId && manifest.screens[0]) {
    return <Navigate to={`/${projectNo}/${feature}/screens/${manifest.screens[0].id}`} replace />;
  }

  return (
    <>
      <header className="wfs-header"><h1>{manifest.title}</h1></header>
      <div className="wfs-iframe-wrap">
        {doc ? <iframe key={activeId} title={activeId} srcDoc={doc} sandbox="allow-scripts" /> : null}
      </div>
    </>
  );
}
