import { Link, useOutletContext } from "react-router-dom";
import type { Registry } from "../types";

export function WireframeHome() {
  const { registry } = useOutletContext<{ registry: Registry }>();

  return (
    <div className="wfs-panel-body">
      <h1>프로젝트</h1>
      <div style={{ display: "grid", gap: "12px", marginTop: "20px", maxWidth: "560px" }}>
        {registry.projects.map((p) => (
          <Link
            key={p.no}
            to={`/${p.no}`}
            style={{ padding: "16px", border: "1px solid #e9ebf1", borderRadius: "10px", background: "#fff" }}
          >
            <strong>#{p.no}</strong> {p.title}
            <div className="wfs-prd-meta">{p.prds.length} PRD</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
