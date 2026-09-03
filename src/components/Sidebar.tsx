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
};

export function Sidebar({ registry, activeProjectNo, activeFeature }: Props) {
  const data = useWireframeData();
  const project = activeProjectNo ? findProject(registry, activeProjectNo) : registry.projects[0];
  const epics = project?.prds ?? [];
  const [kids, setKids] = useState<Record<string, Child[]>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const decodedFeature = (() => {
    if (!activeFeature) return undefined;
    try {
      return decodeURIComponent(activeFeature);
    } catch {
      return activeFeature;
    }
  })();
  const activeEpic = epics.find((e) => e.feature === decodedFeature) ?? epics[0];

  // Prefetch children for all epics so expanding any PRD shows screens
  useEffect(() => {
    if (!project || epics.length === 0) return;
    let cancelled = false;
    for (const epic of epics) {
      if (epic.children?.length) {
        setKids((p) => ({ ...p, [epic.feature]: epic.children! }));
        continue;
      }
      data
        .loadManifest(project, epic.feature)
        .then((m) => {
          if (cancelled) return;
          setKids((p) => ({
            ...p,
            [epic.feature]: m.screens
              .filter((s) => s.id !== "00-overview")
              .map((s) => ({
                slug: s.id,
                title: s.label,
                issueNo: String(s.no).padStart(2, "0"),
              })),
          }));
        })
        .catch(() => {
          if (!cancelled) setKids((p) => ({ ...p, [epic.feature]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [project, epics, data]);

  if (!project) return <aside className="" />;

  return (
    <aside className="">
      <div className="wfs-project-title">{project.title}</div>
      <nav className="wfs-tree" aria-label="이슈">
        {epics.map((epic) => {
          const selected = epic.feature === activeEpic?.feature;
          // Let the router encode once — do not pre-encode (double-encoding blanks screens)
          return (
            <details
              key={epic.feature}
              open={openEpics[epic.feature] ?? selected}
              onToggle={(e) => {
                const open = e.currentTarget.open;
                setOpenEpics((p) => ({ ...p, [epic.feature]: open }));
              }}
            >
              <summary className={`wfs-tree-parent${selected ? " is-active" : ""}`}>
                <span className="wfs-issue-tab-id">{epic.prdNo}</span>
                <span>{epic.title}</span>
              </summary>
              {(kids[epic.feature] ?? epic.children ?? []).map((child) => (
                <NavLink
                  key={child.slug}
                  to={`/wireframes/${project.no}/${epic.feature}/screens/${child.slug}`}
                  className={({ isActive }) =>
                    `wfs-tree-child${isActive ? " is-active" : ""}`
                  }
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
