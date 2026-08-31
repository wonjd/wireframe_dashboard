import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import type { Registry } from "../types";
import { findProject, useWireframeData } from "../lib/data";
import "../issue-nav.css";

type Child = { slug: string; title: string; issueNo?: string };

type Props = {
  registry: Registry;
  activeProjectNo?: string;
  activeFeature?: string;
  activeScreen?: string;
};

export function Sidebar({ registry, activeProjectNo, activeFeature, activeScreen }: Props) {
  const data = useWireframeData();
  const project = activeProjectNo ? findProject(registry, activeProjectNo) : registry.projects[0];
  const epics = project?.prds ?? [];
  const [kids, setKids] = useState<Record<string, Child[]>>({});
  const activeEpic = epics.find((e) => e.feature === activeFeature) ?? epics[0];

  useEffect(() => {
    if (!project || !activeEpic) {
      return;
    }
    if (activeEpic.children?.length) {
      setKids((p) => ({ ...p, [activeEpic.feature]: activeEpic.children! }));
      return;
    }
    data
      .loadManifest(project, activeEpic.feature)
      .then((m) =>
        setKids((p) => ({
          ...p,
          [activeEpic.feature]: m.screens.map((s) => ({
            slug: s.id,
            title: s.label,
            issueNo: String(s.no).padStart(2, "0"),
          })),
        }))
      )
      .catch(() => setKids((p) => ({ ...p, [activeEpic.feature]: [] })));
  }, [project, activeEpic, data]);

  if (!project) return <aside className="wfs-sidebar" />;

  return (
    <aside className="wfs-sidebar">
      <div className="wfs-project-title">{project.title}</div>
      <nav className="wfs-tree" aria-label="이슈">
        {epics.map((epic) => {
          const selected = epic.feature === activeEpic?.feature;
          return (
            <details key={epic.feature} open={selected}>
              <summary className={`wfs-tree-parent${selected ? " is-active" : ""}`}>
                <span className="wfs-issue-tab-id">{epic.prdNo}</span>
                <span>{epic.title}</span>
              </summary>
              {(kids[epic.feature] ?? epic.children ?? []).map((child) => (
                <NavLink
                  key={child.slug}
                  to={`/${project.no}/${epic.feature}/screens/${child.slug}`}
                  className={`wfs-tree-child${activeScreen === child.slug && selected ? " is-active" : ""}`}
                >
                  {child.issueNo ? <span className="wfs-tree-id">{child.issueNo}</span> : null}
                  <span>{child.title}</span>
                </NavLink>
              ))}
            </details>
          );
        })}
      </nav>
    </aside>
  );
}
