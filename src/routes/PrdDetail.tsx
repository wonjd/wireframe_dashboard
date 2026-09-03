import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { NotFoundPage } from "../components/NotFoundPage";
import { deletePrd, statusLabel } from "./PrdList";

type PrdDetailData = {
  ok?: boolean;
  runId?: string;
  routeId?: string;
  no?: string;
  title?: string;
  status?: string;
  content?: string;
  projectSlug?: string;
  projectNo?: string;
  artifactCount?: number;
  error?: string;
};

type BuildResult = {
  ok?: boolean;
  error?: string;
  artifactCount?: number;
  screens?: Array<{ linkTitle: string; url: string }>;
};

async function buildWireframe(id: string, project: string): Promise<BuildResult> {
  const res = await fetch(`/api/prd/${encodeURIComponent(id)}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  });
  return (await res.json()) as BuildResult;
}

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
  const [projectSlug, setProjectSlug] = useState("crm");
  const [artifactCount, setArtifactCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  async function save() {
    if (saving || !resolvedRunId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/prd/${encodeURIComponent(routeId || resolvedRunId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, project: projectSlug }),
      });
      const j = (await res.json()) as PrdDetailData & {
        review?: { status?: string };
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
      if (typeof j.title === "string") setTitle(j.title);
      if (typeof j.content === "string") setContent(j.content);
      if (typeof j.runId === "string") setResolvedRunId(j.runId);
      if (typeof j.routeId === "string") setRouteId(j.routeId);
      const nextStatus =
        (typeof j.status === "string" && j.status) ||
        (typeof j.review?.status === "string" ? j.review.status : undefined);
      if (nextStatus) setStatus(nextStatus);
      setNotice(
        nextStatus && nextStatus !== "ready"
          ? "저장했습니다. 본문을 고치면 다시 보완·승인이 필요할 수 있습니다."
          : "저장했습니다.",
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function generateWireframe() {
    if (building || !resolvedRunId) return;
    setBuilding(true);
    setError(null);
    setNotice("와이어프레임 생성 중… 잠시만 기다려 주세요.");
    try {
      const j = await buildWireframe(routeId || resolvedRunId, projectSlug);
      if (j.ok === false) throw new Error(j.error || "빌드 실패");
      setArtifactCount(typeof j.artifactCount === "number" ? j.artifactCount : artifactCount);
      const n = Array.isArray(j.screens) ? j.screens.length : 0;
      setNotice(`와이어프레임 ${n || j.artifactCount || ""}개 화면 생성 완료. 와이어프레임 탭에서 열어 보세요.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice(null);
    } finally {
      setBuilding(false);
    }
  }

  async function onDelete() {
    if (deleting || !resolvedRunId) return;
    const label = title || prdNo || routeId || resolvedRunId;
    const ok = window.confirm(
      `「${label}」PRD를 삭제할까요?\n와이어프레임 화면 파일도 함께 삭제됩니다.`,
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deletePrd(routeId || resolvedRunId, projectSlug);
      if (result.ok === false) throw new Error(result.error || "삭제 실패");
      navigate("/prd", { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
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

  const canBuild = status === "ready" || status === "confirmed";

  return (
    <div className="wfs-prd-detail">
      <header className="wfs-header">
        <h1>PRD 상세</h1>
        <span className="wfs-badge">{statusLabel(status)}</span>
        {prdNo ? <span className="wfs-badge">{prdNo}</span> : null}
        <span className="wfs-badge">{routeId}</span>
        <span className="wfs-spacer" />
        <Link className="wfs-chat-reset" to="/prd" style={{ display: "inline-flex", alignItems: "center" }}>
          목록
        </Link>
        <Link
          className="wfs-chat-reset"
          to={`/prd/new?runId=${encodeURIComponent(resolvedRunId)}`}
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          보완 채팅 이어하기
        </Link>
        {canBuild ? (
          <button
            type="button"
            className="wfs-btn-primary"
            onClick={() => void generateWireframe()}
            disabled={building || saving || deleting}
          >
            {building ? "생성 중…" : artifactCount > 0 ? "와이어프레임 다시 생성" : "와이어프레임 생성"}
          </button>
        ) : null}
        {artifactCount > 0 ? (
          <Link className="wfs-chat-reset" to="/wireframes" style={{ display: "inline-flex", alignItems: "center" }}>
            화면 목록
          </Link>
        ) : null}
        <button
          type="button"
          className="wfs-chat-reset"
          onClick={() => void save()}
          disabled={saving || building || deleting}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          className="wfs-btn-danger"
          onClick={() => void onDelete()}
          disabled={saving || building || deleting}
        >
          {deleting ? "삭제 중…" : "삭제"}
        </button>
      </header>

      {!canBuild ? (
        <div className="wfs-chat-banner is-warn">
          PRD가 확정(ready)되면 여기서 와이어프레임을 생성할 수 있습니다. 보완 채팅을 이어 주세요.
        </div>
      ) : null}
      {notice ? <div className="wfs-chat-banner">{notice}</div> : null}
      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}

      <div className="wfs-prd-detail-body">
        <label className="wfs-field">
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving || building} />
        </label>
        <label className="wfs-field wfs-field-grow">
          <span>본문</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={saving || building}
            spellCheck={false}
          />
        </label>
      </div>
    </div>
  );
}
