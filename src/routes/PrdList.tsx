import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NotFoundPage } from "../components/NotFoundPage";

export type PrdRunRow = {
  runId: string;
  title: string;
  status: string;
  prdVersion: number;
  artifactCount: number;
  updatedAt?: string;
  createdAt?: string;
  projectSlug: string;
  projectNo: string;
  projectTitle: string;
  no?: string;
  routeId?: string;
};

export function statusLabel(status?: string): string {
  if (status === "ready") return "확정";
  if (status === "confirmed") return "와이어 확정";
  if (status === "clarifying") return "보완 중";
  return status || "대기";
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function deletePrd(id: string, project = "crm"): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/prd/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`, {
    method: "DELETE",
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

export async function deleteWireframes(
  id: string,
  project = "crm",
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `/api/wireframes/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
    { method: "DELETE" },
  );
  return (await res.json()) as { ok: boolean; error?: string };
}

export function PrdList() {
  const [runs, setRuns] = useState<PrdRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/prd/list?project=crm")
      .then(async (r) => {
        const j = (await r.json()) as { ok?: boolean; runs?: PrdRunRow[]; error?: string };
        if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setRuns(Array.isArray(j.runs) ? j.runs : []);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRuns([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDelete(run: PrdRunRow) {
    const label = run.title || run.no || run.runId;
    const ok = window.confirm(
      `「${label}」PRD를 삭제할까요?\n와이어프레임 화면 파일도 함께 삭제됩니다.`,
    );
    if (!ok) return;
    const id = run.routeId || run.no || run.runId;
    setDeletingId(run.runId);
    setError(null);
    try {
      const result = await deletePrd(id, run.projectSlug || "crm");
      if (result.ok === false) throw new Error(result.error || "삭제 실패");
      setRuns((prev) => prev.filter((r) => r.runId !== run.runId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="wfs-list-page">
      <header className="wfs-header">
        <h1>PRD</h1>
        <span className="wfs-badge">{runs.length}건</span>
        <span className="wfs-spacer" />
        <Link className="wfs-chat-reset" to="/prd/new" style={{ display: "inline-flex", alignItems: "center" }}>
          새 PRD
        </Link>
      </header>

      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}
      {loading ? <div className="wfs-empty">불러오는 중…</div> : null}

      {!loading && !error && runs.length === 0 ? (
        <NotFoundPage
          title="PRD가 없습니다"
          detail="「새 PRD」에서 초안을 넣고 확정·보완하면 여기에 목록으로 남습니다."
        />
      ) : null}

      {!loading && runs.length > 0 ? (
        <div className="wfs-list-wrap">
          <table className="wfs-list-table">
            <thead>
              <tr>
                <th>제목</th>
                <th>상태</th>
                <th>화면</th>
                <th>업데이트</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const routeId = run.routeId || run.no || run.runId;
                const busy = deletingId === run.runId;
                return (
                  <tr key={run.runId}>
                    <td>
                      <Link className="wfs-list-link" to={`/prd/${encodeURIComponent(routeId)}`}>
                        <strong>{run.title || run.runId}</strong>
                        <span className="wfs-prd-meta">{run.no ? `${run.no}` : run.runId}</span>
                      </Link>
                    </td>
                    <td>
                      <span className="wfs-badge">{statusLabel(run.status)}</span>
                    </td>
                    <td>{run.artifactCount}</td>
                    <td className="wfs-list-muted">{formatWhen(run.updatedAt || run.createdAt)}</td>
                    <td className="wfs-list-actions">
                      <button
                        type="button"
                        className="wfs-btn-danger"
                        disabled={busy}
                        onClick={() => void onDelete(run)}
                      >
                        {busy ? "삭제 중…" : "삭제"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
