import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { Registry } from "@wireframe-studio/core";
import { findProject, useWireframeData } from "@/lib/data";
import "../issue-nav.css";

type Child = { slug: string; title: string; issueNo?: string };

type Props = {
  registry: Registry;
  activeProjectNo?: string;
  activeFeature?: string;
  activeScreen?: string;
};

export function Sidebar({ registry, activeProjectNo, activeFeature, activeScreen }: Props) {
  const navigate = useNavigate();
  const data = useWireframeData();
  const project = activeProjectNo ? findProject(registry, activeProjectNo) : registry.projects[0];
  const epics = project?.prds ?? [];
  const activeEpic = epics.find((e) => e.feature === activeFeature) ?? epics[0];
  const [children, setChildren] = useState<Child[]>(activeEpic?.children ?? []);

  useEffect(() => {
    if (!project || !activeEpic) {
      setChildren([]);
      return;
    }
    if (activeEpic.children?.length) {
      setChildren(activeEpic.children);
      return;
    }
    data
      .loadManifest(project, activeEpic.feature)
      .then((m) =>
        setChildren(m.screens.map((s) => ({ slug: s.id, title: s.label, issueNo: String(s.no).padStart(2, "0") })))
      )
      .catch(() => setChildren([]));
  }, [project, activeEpic, data]);

  if (!project) return <aside className="wfs-sidebar" />;

  return (
    <aside className="wfs-sidebar">
      <div className="wfs-project-title">#{project.no} {project.title}</div>

      <div className="wfs-issue-tabs" role="tablist" aria-label="이슈">
        {epics.map((epic) => {
          const selected = epic.feature === activeEpic?.feature;
          return (
            <button
              key={epic.feature}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`wfs-issue-tab${selected ? " is-active" : ""}`}
              onClick={() => navigate(`/${project.no}/${epic.feature}`)}
            >
              <span className="wfs-issue-tab-id">{epic.prdNo}</span>
              <span>{epic.title}</span>
            </button>
          );
        })}
      </div>

      <div className="wfs-issue-screens">
        <div className="wfs-project-title">하위 이슈</div>
        {children.length === 0 ? (
          <div className="wfs-prd-meta" style={{ padding: "0 8px" }}>화면 없음</div>
        ) : (
          children.map((child) => (
            <NavLink
              key={child.slug}
              to={`/${project.no}/${activeEpic!.feature}/screens/${child.slug}`}
              className={`wfs-child-link${activeScreen === child.slug ? " is-active" : ""}`}
            >
              {child.issueNo ? `${child.issueNo} ` : ""}
              {child.title}
            </NavLink>
          ))
        )}
      </div>
    </aside>
  );
}
