import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { NotFoundPage } from "../components/NotFoundPage";
import { statusLabel, type PrdRunRow } from "./PrdList";

type ScreenRow = {
  runId: string;
  runTitle: string;
  runNo?: string;
  projectNo: string;
  screenId: string;
  label: string;
  file: string;
  url: string;
  linkTitle: string;
};

type PrdGroup = {
  routeId: string;
  runId: string;
  title: string;
  no?: string;
  status?: string;
  screens: ScreenRow[];
};

export function WireframeHome() {
  const [runs, setRuns] = useState<PrdRunRow[]>([]);
  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    return Promise.all([
      fetch("/api/prd/list?project=crm").then((r) => r.json()),
      fetch("/api/wireframes/list?project=crm").then((r) => r.json()),
    ])
      .then(([prdJson, wfJson]: [unknown, unknown]) => {
        const prd = prdJson as { ok?: boolean; runs?: PrdRunRow[]; error?: string };
        const wf = wfJson as { ok?: boolean; screens?: ScreenRow[]; error?: string };
        if (prd.ok === false) throw new Error(prd.error || "PRD 목록 실패");
        if (wf.ok === false) throw new Error(wf.error || "화면 목록 실패");
        setRuns(Array.isArray(prd.runs) ? prd.runs : []);
        setScreens(Array.isArray(wf.screens) ? wf.screens : []);
        setError(null);
      })
      .catch((e: unknown) => {
        setRuns([]);
        setScreens([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/prd/list?project=crm").then((r) => r.json()),
      fetch("/api/wireframes/list?project=crm").then((r) => r.json()),
    ])
      .then(([prdJson, wfJson]: [unknown, unknown]) => {
        if (cancelled) return;
        const prd = prdJson as { ok?: boolean; runs?: PrdRunRow[]; error?: string };
        const wf = wfJson as { ok?: boolean; screens?: ScreenRow[]; error?: string };
        if (prd.ok === false) throw new Error(prd.error || "PRD 목록 실패");
        if (wf.ok === false) throw new Error(wf.error || "화면 목록 실패");
        setRuns(Array.isArray(prd.runs) ? prd.runs : []);
        setScreens(Array.isArray(wf.screens) ? wf.screens : []);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRuns([]);
          setScreens([]);
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

  const groups: PrdGroup[] = useMemo(() => {
    const screensByRun = new Map<string, ScreenRow[]>();
    for (const s of screens) {
      const list = screensByRun.get(s.runId) ?? [];
      list.push(s);
      screensByRun.set(s.runId, list);
    }

    const fromRuns: PrdGroup[] = runs.map((r) => ({
      routeId: r.routeId || r.no || r.runId,
      runId: r.runId,
      title: r.title || r.runId,
      no: r.no,
      status: r.status,
      screens: screensByRun.get(r.runId) ?? [],
    }));

    const known = new Set(fromRuns.map((g) => g.runId));
    for (const [runId, list] of screensByRun) {
      if (known.has(runId)) continue;
      known.add(runId);
      const first = list[0]!;
      fromRuns.push({
        routeId: first.runNo || runId,
        runId,
        title: first.runTitle || runId,
        no: first.runNo,
        screens: list,
      });
    }

    return fromRuns.filter(
      (g) => g.screens.length > 0 || g.status === "ready" || g.status === "confirmed",
    );
  }, [runs, screens]);

  function toggle(runId: string) {
    setOpenRunId((prev) => (prev === runId ? null : runId));
  }

  function screenPath(s: ScreenRow): string {
    const projectNo = s.projectNo || "01";
    // Router encodes path segments — avoid encodeURIComponent here (double-encoding)
    return `/wireframes/${projectNo}/${s.runId}/screens/${s.screenId}`;
  }

  return (
    <div className="wfs-list-page">
      <header className="wfs-header">
        <h1>와이어프레임</h1>
        <span className="wfs-badge">{groups.length} PRD</span>
        <span className="wfs-spacer" />
        <Link className="wfs-chat-reset" to="/prd" style={{ display: "inline-flex", alignItems: "center" }}>
          PRD 목록
        </Link>
      </header>

      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}
      {loading ? <div className="wfs-empty">불러오는 중…</div> : null}

      {!loading && !error && groups.length === 0 ? (
        <NotFoundPage
          title="생성된 와이어프레임이 없습니다"
          detail="PRD를 확정하면 여기에 PRD 제목으로 모이고, 제목을 누르면 바로 아래 화면이 펼쳐집니다."
        />
      ) : null}

      {!loading && groups.length > 0 ? (
        <div className="wfs-list-wrap">
          <div className="wfs-wf-prd-list">
            {groups.map((g) => {
              const open = openRunId === g.runId;
              return (
                <div key={g.runId} className={`wfs-wf-prd-block${open ? " is-open" : ""}`}>
                  <div className="wfs-wf-prd-row">
                    <button
                      type="button"
                      className="wfs-wf-prd-item"
                      onClick={() => toggle(g.runId)}
                      aria-expanded={open}
                    >
                      <div className="wfs-wf-prd-main">
                        <strong>{g.title}</strong>
                        <span className="wfs-prd-meta">
                          {g.no ? `${g.no} · ` : ""}
                          {g.screens.length}개 화면
                        </span>
                      </div>
                      <div className="wfs-wf-prd-side">
                        {g.status ? <span className="wfs-badge">{statusLabel(g.status)}</span> : null}
                        <span className={`wfs-wf-prd-chevron${open ? " is-open" : ""}`} aria-hidden>
                          ›
                        </span>
                      </div>
                    </button>
                  </div>

                  {open ? (
                    <div className="wfs-wf-issue-list" role="list">
                      {g.screens.length === 0 ? (
                        <p className="wfs-wf-empty">아직 생성된 화면 HTML이 없습니다.</p>
                      ) : (
                        g.screens.map((s, i) => (
                          <Link
                            key={s.screenId}
                            className="wfs-wf-issue-item"
                            role="listitem"
                            to={screenPath(s)}
                          >
                            <span className="wfs-wf-issue-id">{String(i + 1).padStart(2, "0")}</span>
                            <span className="wfs-wf-issue-body">
                              <strong>{s.label}</strong>
                              <span className="wfs-prd-meta">{s.file}</span>
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
