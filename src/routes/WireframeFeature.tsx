import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
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
  const activeId = screenId ?? manifest?.screens[0]?.id;

  useEffect(() => {
    if (!project) return;
    data.loadManifest(project, feature).then(setManifest).catch((e) => setErrMsg(String(e)));
  }, [project, feature, data]);

  useEffect(() => {
    if (!project || !manifest || !activeId) return;
    data.loadHtml(project, manifest, activeId).then((h) => setDoc(h ?? ""));
  }, [project, manifest, activeId, data]);

  if (!project) return <div className="wfs-empty">not found</div>;
  if (errMsg) return <div className="wfs-empty">{errMsg}</div>;
  if (!manifest) return <div className="wfs-empty">loading</div>;

  return (
    <>
      <header className="wfs-header"><h1>{manifest.title}</h1></header>
      <div className="wfs-iframe-wrap">{doc ? <iframe title={activeId} srcDoc={doc} sandbox="allow-scripts" /> : null}</div>
    </>
  );
}
