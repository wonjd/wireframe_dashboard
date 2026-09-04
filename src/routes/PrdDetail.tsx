import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { NotFoundPage } from "../components/NotFoundPage";
import { statusLabel } from "./PrdList";

type PrdDetailData = {
  ok?: boolean;
  runId?: string;
  routeId?: string;
  no?: string;
  title?: string;
  status?: string;
  phase?: string;
  content?: string;
  projectSlug?: string;
  projectNo?: string;
  artifactCount?: number;
  error?: string;
};

export function PrdDetail() {
  const { runId: rawParam = "" } = useParams();
  const paramId = decodeURIComponent(rawParam);
  const navigate = useNavigate();

  const [resolvedRunId, setResolvedRunId] = useState("");
  const [routeId, setRouteId] = useState(paramId);
  const [prdNo, setPrdNo] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [phase, setPhase] = useState<string | undefined>();
  const [projectSlug, setProjectSlug] = useState("crm");
  const [artifactCount, setArtifactCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setError(null);
    setNotice(null);
    fetch(`/api/prd/${encodeURIComponent(paramId)}?project=crm`)
      .then(async (r) => {
        const j = (await r.json()) as PrdDetailData;
        if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
        if (cancelled) return;
        const realRunId = String(j.runId || paramId);
        const canonical = String(j.routeId || j.no || j.runId || paramId);
        setResolvedRunId(realRunId);
        setRouteId(canonical);
        setPrdNo(typeof j.no === "string" ? j.no : undefined);
        setTitle(String(j.title || ""));
        setContent(String(j.content || ""));
        setStatus(typeof j.status === "string" ? j.status : undefined);
        setPhase(typeof j.phase === "string" ? j.phase : undefined);
        setProjectSlug(String(j.projectSlug || "crm"));
        setArtifactCount(typeof j.artifactCount === "number" ? j.artifactCount : 0);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paramId]);

  // Canonical URL: /prd/PRD-002 (not Korean slug)
  if (!loading && !missing && routeId && paramId !== routeId) {
    return <Navigate to={`/prd/${encodeURIComponent(routeId)}`} replace />;
  }

  if (loading) return <div className="wfs-empty">불러오는 중…</div>;
  if (missing) {
    return (
      <NotFoundPage
        title="PRD를 찾을 수 없습니다"
        detail={`「${paramId}」 항목이 없거나 파일이 없습니다.`}
      />
    );
  }

  const canBuild =
    phase === "ready" && (status === "ready" || status === "confirmed");

  return (
    <div className="wfs-prd-detail">
      <header className="wfs-header">
        <h1>PRD 상세</h1>
        <span className="wfs-badge">{statusLabel(status)}</span>
        {prdNo ? <span className="wfs-badge">{prdNo}</span> : null}
        <span className="wfs-spacer" />
        <Link className="wfs-chat-reset" to="/prd" style={{ display: "inline-flex", alignItems: "center" }}>
          목록
        </Link>
        {/*
          Wireframe generation lives only in the studio chat. Generating from here rewrote the
          artifacts without the request ever passing through the conversation, so the intent was
          lost and the feature spec / user flow silently fell out of sync with the screens.
        */}
        <Link
          className="wfs-btn-primary"
          to={`/prd/${encodeURIComponent(routeId || resolvedRunId)}/studio`}
          style={{ display: "inline-flex", alignItems: "center" }}
          title="화면 생성·수정은 스튜디오 채팅에서 요청하세요"
        >
          {artifactCount > 0 ? "스튜디오에서 수정" : "스튜디오에서 생성"}
        </Link>
      </header>

      {!canBuild ? (
        <div className="wfs-chat-banner is-warn">
          {phase === "layout"
            ? "PRD는 확정됐습니다. 화면 형태(모달/표/페이지 등)를 스튜디오 채팅에서 답한 뒤에만 와이어프레임을 생성할 수 있습니다."
            : "① PRD 보완·승인 → ② 화면 형태 확정 → ③ 와이어프레임 생성. 스튜디오 채팅에서 이어 주세요."}
        </div>
      ) : null}
      {notice ? <div className="wfs-chat-banner">{notice}</div> : null}
      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}

      <div className="wfs-prd-detail-body">
        <label className="wfs-field">
          <span>제목</span>
          <input value={title} readOnly />
        </label>
        <label className="wfs-field wfs-field-grow">
          <span>본문</span>
          <textarea value={content} readOnly spellCheck={false} />
        </label>
      </div>
    </div>
  );
}
