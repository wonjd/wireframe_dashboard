import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import type { Registry } from "@wireframe-studio/core";
import { findProject } from "@/lib/data";

export function WireframeProject() {
  const { projectNo = "" } = useParams();
  const { registry } = useOutletContext<{ registry: Registry }>();
  const project = findProject(registry, projectNo);

  if (!project) return <div className="wfs-empty">프로젝트 #{projectNo} 없음</div>;

  if (project.prds.length === 1) {
    return <Navigate to={`/${project.no}/${project.prds[0]!.feature}`} replace />;
  }

  return (
    <div className="wfs-panel-body">
      <h1>
        #{project.no} {project.title}
      </h1>
      <div style={{ display: "grid", gap: "10px", marginTop: "16px", maxWidth: "560px" }}>
        {project.prds.map((prd) => (
          <Link
            key={prd.feature}
            to={`/${project.no}/${prd.feature}`}
            style={{ padding: "14px", border: "1px solid #e9ebf1", borderRadius: "10px", background: "#fff" }}
          >
            {prd.prdNo} {prd.title}
            <div className="wfs-prd-meta">
              [{prd.screenCount} screens] · {prd.status}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
