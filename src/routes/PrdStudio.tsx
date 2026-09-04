import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PrdAgentChat } from "./PrdAgentChat";
import { FeatureMap, type FeaturesDoc } from "../components/FeatureMap";
import { UserFlow, type FlowDoc } from "../components/UserFlow";
import { useWireframeData } from "../lib/data";
import {
  applyFeatureOverrides,
  applyFlowOverrides,
  EMPTY_OVERRIDES,
  fetchOverrides,
  putOverrides,
  withPatch,
  type NodeOverride,
  type SpecOverrides,
} from "../lib/spec-overrides";
import type { Manifest, ProjectEntry } from "../types";

const RATIO_KEY = "wf-studio-ratio";
const MIN_LEFT = 320;
const MIN_RIGHT = 380;

type StudioTab = "features" | "flow" | "wireframe";

/** Debounce before a canvas edit is written to spec/overrides.json. */
const SAVE_DELAY_MS = 500;
const PROJECT_SLUG = "crm";

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<Exclude<SaveState, "idle">, string> = {
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 실패",
};

type SpecState<T> =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "ready"; doc: T };

function useSpecJson<T>(runId: string | undefined, file: string, reloadToken: number): SpecState<T> {
  const [state, setState] = useState<SpecState<T>>({ state: "loading" });
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setState({ state: "loading" });
    fetch(`/runs/${encodeURIComponent(runId)}/spec/${file}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("missing");
        return (await res.json()) as T;
      })
      .then((doc) => {
        if (!cancelled) setState({ state: "ready", doc });
      })
      .catch(() => {
        if (!cancelled) setState({ state: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, file, reloadToken]);
  return state;
}

function loadRatio(): number {
  try {
    const v = Number(localStorage.getItem(RATIO_KEY));
    if (Number.isFinite(v) && v >= 0.2 && v <= 0.8) return v;
  } catch {
    /* ignore */
  }
  return 0.4;
}

function SpecEmpty({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="wfs-studio-empty">
      <div className="wfs-studio-empty-title">아직 생성되지 않았습니다</div>
      <div className="wfs-studio-empty-detail">
        PRD 보완이 끝나고 파이프라인이 실행되면 이곳에 문서가 표시됩니다.
      </div>
      <button type="button" className="wfs-chat-reset" onClick={onRetry}>
        다시 확인
      </button>
    </div>
  );
}

/** Calm right-pane state before any document exists: one quiet line, no dev vocabulary. */
function StudioAwaiting() {
  return (
    <div className="wfs-studio-empty">
      <div className="wfs-studio-empty-detail">PRD를 확정하면 여기에 만들어집니다.</div>
    </div>
  );
}

function WireframePane({
  runId,
  project,
}: {
  runId: string;
  project: ProjectEntry;
}) {
  const data = useWireframeData();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setManifest(null);
    setMissing(false);
    data
      .loadManifest(project, runId)
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [data, project, runId, reloadToken]);

  const screens = useMemo(
    () => (manifest?.screens ?? []).filter((s) => s.id !== "00-overview"),
    [manifest],
  );
  const activeId = selected ?? screens[0]?.id;
  const iframeSrc =
    manifest && activeId ? data.artifactUrl(manifest, activeId) : null;

  if (missing) {
    return <SpecEmpty onRetry={() => setReloadToken((n) => n + 1)} />;
  }
  if (!manifest) return <div className="wfs-empty">로딩 중…</div>;
  if (!screens.length) {
    return <SpecEmpty onRetry={() => setReloadToken((n) => n + 1)} />;
  }

  return (
    <div className="wfs-studio-wf">
      <div className="wfs-studio-wf-bar">
        <nav className="wfs-flow-nav" aria-label="화면 목록">
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`wfs-flow-btn${s.id === activeId ? " is-active" : ""}`}
              onClick={() => setSelected(s.id)}
              title={s.label}
            >
              <span className="wfs-flow-btn-no">{String(s.no).padStart(2, "0")}</span>
              <span className="wfs-flow-btn-label">{s.label}</span>
            </button>
          ))}
        </nav>
        {activeId ? (
          <Link
            className="wfs-studio-wf-open"
            to={`/wireframes/${project.no}/${encodeURIComponent(runId)}/screens/${encodeURIComponent(activeId)}?view=1`}
            title="이 화면을 크게 봅니다 — 수정은 왼쪽 채팅으로 요청하세요"
          >
            크게 보기 ↗
          </Link>
        ) : null}
      </div>
      <div className="wfs-studio-wf-frame">
        {iframeSrc ? (
          <iframe key={iframeSrc} title={activeId ?? "wireframe"} src={iframeSrc} sandbox="allow-scripts allow-same-origin" />
        ) : (
          <div className="wfs-empty">화면 불러오는 중…</div>
        )}
      </div>
    </div>
  );
}

export function PrdStudio() {
  const { runId: rawParam = "" } = useParams();
  const paramId = decodeURIComponent(rawParam);
  // No param → the studio is the entry point for a brand-new request (/prd/new). There is no
  // run yet: the chat on the left creates one and reports it back via onRunId.
  const isNew = !paramId;
  const navigate = useNavigate();
  const data = useWireframeData();

  // The route param may be a routeId alias (e.g. PRD-001); resolve the real runId.
  // In the "new" flow there is nothing to resolve until the chat reports its run id.
  const [realRunId, setRealRunId] = useState<string | null>(null);
  const [runTitle, setRunTitle] = useState("");
  // Once the run exists we swap the URL to the real studio path (see onChatRunId). That is a
  // brand-new run whose id equals its own alias, so re-resolving it is redundant; skip it so the
  // chat is never handed a runId prop (which would reload its session and wipe the conversation).
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (isNew || adoptedRef.current) return;
    let cancelled = false;
    setRealRunId(null);
    fetch(`/api/prd/${encodeURIComponent(paramId)}?project=crm`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; runId?: string; title?: string }) => {
        if (cancelled) return;
        setRealRunId(j.ok !== false && j.runId ? String(j.runId) : paramId);
        if (typeof j.title === "string") setRunTitle(j.title);
      })
      .catch(() => {
        if (!cancelled) setRealRunId(paramId);
      });
    return () => {
      cancelled = true;
    };
  }, [paramId, isNew]);

  // Project entry for wireframe links (falls back to a stub when unknown).
  const [project, setProject] = useState<ProjectEntry | null>(null);
  useEffect(() => {
    if (!realRunId) return;
    let cancelled = false;
    data
      .loadRegistry()
      .then((reg) => {
        if (cancelled) return;
        const found = reg.projects.find((p) =>
          p.prds.some((prd) => prd.feature === realRunId),
        );
        setProject(
          found ?? { no: "01", slug: "crm", folder: "crm", title: "CRM", prds: [] },
        );
      })
      .catch(() => {
        if (!cancelled)
          setProject({ no: "01", slug: "crm", folder: "crm", title: "CRM", prds: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [data, realRunId]);

  // Split ratio (left pane share), persisted.
  const [ratio, setRatio] = useState(loadRatio);
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onDividerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onDividerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minR = Math.min(0.8, MIN_LEFT / rect.width);
    const maxR = Math.max(0.2, 1 - MIN_RIGHT / rect.width);
    const next = Math.min(maxR, Math.max(minR, (e.clientX - rect.left) / rect.width));
    setRatio(next);
  }, []);
  const onDividerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setRatio((r) => {
      try {
        localStorage.setItem(RATIO_KEY, String(r));
      } catch {
        /* ignore */
      }
      return r;
    });
  }, []);

  const [tab, setTab] = useState<StudioTab>("features");
  const [reloadToken, setReloadToken] = useState(0);
  const features = useSpecJson<FeaturesDoc>(realRunId ?? undefined, "features.json", reloadToken);
  const flow = useSpecJson<FlowDoc>(realRunId ?? undefined, "flow.json", reloadToken);

  // The embedded chat is the single source of truth for the run; the studio only listens.
  // When it reports a run id we adopt it (to start watching this run's spec files) and, for the
  // "new" flow, rewrite the URL to the real studio path. We use history.replaceState directly —
  // not router navigate — so the /prd/new route element never unmounts and the chat keeps its
  // conversation and composer state. A later refresh loads /prd/:runId/studio and rehydrates.
  const onChatRunId = useCallback(
    (id: string) => {
      setRealRunId((prev) => prev ?? id);
      if (isNew && !adoptedRef.current) {
        adoptedRef.current = true;
        window.history.replaceState(null, "", `/prd/${encodeURIComponent(id)}/studio`);
      }
    },
    [isNew],
  );

  // A finished build means new spec files: re-fetch features/flow/overrides and the wireframe list.
  const onChatBuilt = useCallback(() => setReloadToken((n) => n + 1), []);

  // Reveal: the first time either document becomes available, snap the right pane to 기능명세서 so
  // the user actually sees the result appear. Later rebuilds must not keep yanking the tab.
  const revealedRef = useRef(false);
  useEffect(() => {
    if (revealedRef.current) return;
    if (features.state === "ready" || flow.state === "ready") {
      revealedRef.current = true;
      setTab("features");
    }
  }, [features.state, flow.state]);

  // The chat manages its own run id in the "new" flow, so we never feed the adopted id back as a
  // prop (that would reload its session). Deep-linked existing runs still receive the resolved id.
  const chatRunId = isNew ? undefined : realRunId ?? undefined;

  // User edits (rename / importance / hide) live in spec/overrides.json — never in the
  // two generated documents above — and are merged in here with the same rules the CLI
  // uses for 00-spec/00-flow. See src/lib/spec-overrides.ts.
  const [overrides, setOverrides] = useState<SpecOverrides>(EMPTY_OVERRIDES);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!realRunId) return;
    let cancelled = false;
    dirtyRef.current = false;
    setSaveState("idle");
    fetchOverrides(realRunId, PROJECT_SLUG)
      .then((doc) => {
        if (!cancelled) setOverrides(doc);
      })
      .catch(() => {
        // No overrides yet (or the endpoint is unavailable): render the generated docs.
        if (!cancelled) setOverrides(EMPTY_OVERRIDES);
      });
    return () => {
      cancelled = true;
    };
  }, [realRunId, reloadToken]);

  // Debounced whole-document PUT: each edit restarts the timer.
  useEffect(() => {
    if (!dirtyRef.current || !realRunId) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      putOverrides(realRunId, PROJECT_SLUG, overrides)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [overrides, realRunId]);

  const patchNode = useCallback(
    (kind: "features" | "flow", id: string, patch: NodeOverride) => {
      dirtyRef.current = true;
      setOverrides((prev) => withPatch(prev, kind, id, patch));
    },
    [],
  );
  const patchFeature = useCallback(
    (no: string, patch: NodeOverride) => patchNode("features", no, patch),
    [patchNode],
  );
  const patchFlow = useCallback(
    (id: string, patch: NodeOverride) => patchNode("flow", id, patch),
    [patchNode],
  );

  const mergedFeatures = useMemo(
    () =>
      features.state === "ready"
        ? applyFeatureOverrides(features.doc, overrides.features ?? {})
        : null,
    [features, overrides],
  );
  const mergedFlow = useMemo(
    () => (flow.state === "ready" ? applyFlowOverrides(flow.doc, overrides.flow ?? {}) : null),
    [flow, overrides],
  );

  const openArtifact = useCallback(
    (artifactId: string) => {
      if (!realRunId) return;
      const projectNo = project?.no ?? "01";
      navigate(
        `/wireframes/${projectNo}/${encodeURIComponent(realRunId)}/screens/${encodeURIComponent(artifactId)}`,
      );
    },
    [navigate, project, realRunId],
  );

  const retry = useCallback(() => setReloadToken((n) => n + 1), []);

  // Hidden nodes are gone from the canvas, so the only way back is this list.
  const hiddenKind = tab === "flow" ? "flow" : "features";
  const hiddenIds = useMemo(
    () =>
      Object.entries(overrides[hiddenKind] ?? {})
        .filter(([, patch]) => patch.hidden)
        .map(([id]) => id),
    [overrides, hiddenKind],
  );

  // Right-pane phases: docs shown once either document is ready; a brief spinner only while an
  // adopted run is fetching; otherwise the calm "awaiting" state (new run, or build not run yet).
  const docsReady = features.state === "ready" || flow.state === "ready";
  const docsLoading =
    Boolean(realRunId) && (features.state === "loading" || flow.state === "loading");

  const TABS: Array<{ id: StudioTab; label: string }> = [
    { id: "features", label: "기능명세서" },
    { id: "flow", label: "유저플로우" },
    { id: "wireframe", label: "와이어프레임" },
  ];

  return (
    <div className={`wfs-studio${dragging ? " is-dragging" : ""}`} ref={splitRef}>
      <div className="wfs-studio-left" style={{ width: `${ratio * 100}%` }}>
        <PrdAgentChat
          runId={chatRunId}
          chatOnly
          onRunId={onChatRunId}
          onBuilt={onChatBuilt}
        />
      </div>
      <div
        className="wfs-studio-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="패널 크기 조절"
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={onDividerUp}
        onPointerCancel={onDividerUp}
      />
      <div className="wfs-studio-right">
        {!docsReady ? (
          docsLoading ? (
            <div className="wfs-empty">불러오는 중…</div>
          ) : (
            <StudioAwaiting />
          )
        ) : (
        <>
        <div className="wfs-studio-right-bar">
          <nav className="wfs-tabs wfs-studio-tabs" aria-label="캔버스">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`wfs-tab${tab === t.id ? " is-active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {runTitle ? (
            <span className="wfs-studio-run-title" title={runTitle}>
              {runTitle}
            </span>
          ) : null}
          {tab !== "wireframe" && hiddenIds.length > 0 ? (
            <span className="wfs-studio-hidden" aria-label="숨긴 항목">
              숨김
              {hiddenIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="wfs-studio-hidden-chip"
                  title={`${id} 다시 표시`}
                  onClick={() => patchNode(hiddenKind, id, { hidden: false })}
                >
                  {id} ↩
                </button>
              ))}
            </span>
          ) : null}
          {saveState !== "idle" ? (
            <span className={`wfs-studio-save is-${saveState}`} role="status">
              {SAVE_LABEL[saveState]}
            </span>
          ) : null}
        </div>
        <div className="wfs-studio-canvas-slot">
          {tab === "features" ? (
            mergedFeatures ? (
              <FeatureMap
                doc={mergedFeatures}
                onOpenArtifact={openArtifact}
                onPatch={patchFeature}
              />
            ) : features.state === "loading" ? (
              <div className="wfs-empty">로딩 중…</div>
            ) : (
              <SpecEmpty onRetry={retry} />
            )
          ) : null}
          {tab === "flow" ? (
            mergedFlow ? (
              <UserFlow doc={mergedFlow} onOpenArtifact={openArtifact} onPatch={patchFlow} />
            ) : flow.state === "loading" ? (
              <div className="wfs-empty">로딩 중…</div>
            ) : (
              <SpecEmpty onRetry={retry} />
            )
          ) : null}
          {tab === "wireframe" ? (
            project && realRunId ? (
              <WireframePane runId={realRunId} project={project} />
            ) : (
              <div className="wfs-empty">로딩 중…</div>
            )
          ) : null}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
