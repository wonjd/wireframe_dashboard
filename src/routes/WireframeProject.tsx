import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import type { Registry } from "../types";
import { findProject } from "../lib/data";
import { NotFoundPage } from "../components/NotFoundPage";

export function WireframeProject() {
  const { projectNo = "" } = useParams();
  const { registry } = useOutletContext<{ registry: Registry }>();
  const project = findProject(registry, projectNo);

  if (!project) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail={`프로젝트 #${projectNo}에 해당하는 화면이 없습니다.`}
      />
    );
  }
  if (project.prds.length === 0) {
    return (
      <NotFoundPage
        title="생성된 와이어프레임이 없습니다"
        detail={`#${project.no} ${project.title}에 생성된 화면이 아직 없습니다.`}
      />
    );
  }
  if (project.prds.length === 1) {
    return (
      <Navigate
        to={`/wireframes/${project.no}/${encodeURIComponent(project.prds[0]!.feature)}`}
        replace
      />
    );
  }

  return (
    <div className="wfs-panel-body">
      <h1>
        #{project.no} {project.title}
      </h1>
      <div className="wfs-wf-prd-list">
        {project.prds.map((prd) => (
          <Link
            key={prd.feature}
            className="wfs-wf-prd-block"
            to={`/wireframes/${project.no}/${encodeURIComponent(prd.feature)}`}
            style={{ display: "block", padding: "16px 18px" }}
          >
            {prd.prdNo} {prd.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
