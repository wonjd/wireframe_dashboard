import { useEffect, useMemo, useState } from "react";
import { useCanvasPanZoom } from "./useCanvasPanZoom";
import { NodeEditor } from "./FeatureMap";
import type { NodeOverride } from "../lib/spec-overrides";

export type FlowNodeKind = "start" | "primary" | "page";

export type FlowLane = { id: string; label: string };
export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  lane: string;
  artifactId?: string | null;
};
export type FlowEdge = { from: string; to: string; condition?: string | null };

export type FlowDoc = {
  lanes?: FlowLane[];
  nodes?: FlowNode[];
  edges?: FlowEdge[];
};

const NODE_W = 176;
const NODE_H = 46;
const COL_GAP = 72;
const ROW_H = NODE_H + 28;
const LANE_PAD = 26;
const GUTTER_X = 24;
/** Distance from a branching node's right edge to its first vertical run. */
const FAN_BASE = 16;
/** Horizontal stagger between the vertical runs of sibling branch edges. */
const FAN_STEP = 10;
/** Gap between the last vertical run of a fan and its condition pills. */
const FAN_LABEL_GAP = 12;
/** Clearance kept between a condition pill and the target node. */
const LABEL_CLEARANCE = 16;
/** Condition pill font size (must track .wfs-uflow-cond in index.css). */
const COND_FONT = 10.5;
/** Pill horizontal padding + border (must track .wfs-uflow-cond). */
const COND_CHROME = 18;

type LaidNode = FlowNode & { x: number; y: number };
type LaidLane = FlowLane & { top: number; height: number };
type LaidEdge = {
  key: string;
  path: string;
  condition?: string | null;
  labelX: number;
  labelY: number;
};

/**
 * Rough pill width for a condition label: CJK glyphs are ~1em wide at the
 * pill's font size, everything else ~0.55em, plus padding/border chrome.
 * Used only to reserve layout room, so a slight overestimate is fine.
 */
function estimateCondWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e7f ? COND_FONT : COND_FONT * 0.55;
  }
  return Math.ceil(w) + COND_CHROME;
}

/**
 * Left-to-right layered layout. Column = longest path from a source node
 * (relaxed over the edge list with a cycle guard). Lanes stack vertically;
 * nodes sharing a lane and column stack within the lane, and each lane grows
 * to fit its tallest column.
 *
 * Columns are not uniformly spaced: a column that receives labeled edges gets
 * a wider gap in front of it, sized so every condition pill fits between the
 * branch fan and the target node. Sibling edges leaving the same node fan out
 * on staggered vertical runs, and each labeled branch edge carries its pill
 * on its own final horizontal segment (at the target row), to the right of
 * every vertical run — so pills never overlap each other or the connectors.
 */
function layout(doc: FlowDoc): {
  nodes: LaidNode[];
  lanes: LaidLane[];
  edges: LaidEdge[];
  width: number;
  height: number;
} {
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Drop back edges (found via DFS) so cycles don't inflate columns.
  const validEdges = edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const adj = new Map<string, Array<{ to: string; idx: number }>>();
  validEdges.forEach((e, idx) => {
    const list = adj.get(e.from) ?? [];
    list.push({ to: e.to, idx });
    adj.set(e.from, list);
  });
  const color = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const backEdges = new Set<number>();
  const dfs = (u: string) => {
    color.set(u, 1);
    for (const { to, idx } of adj.get(u) ?? []) {
      const c = color.get(to) ?? 0;
      if (c === 1) backEdges.add(idx);
      else if (c === 0) dfs(to);
    }
    color.set(u, 2);
  };
  for (const n of nodes) if ((color.get(n.id) ?? 0) === 0) dfs(n.id);

  // Longest-path column assignment over the remaining DAG.
  const col = new Map<string, number>();
  for (const n of nodes) col.set(n.id, 0);
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    validEdges.forEach((e, idx) => {
      if (backEdges.has(idx)) return;
      const next = (col.get(e.from) ?? 0) + 1;
      if (next > (col.get(e.to) ?? 0)) {
        col.set(e.to, next);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const maxCol = Math.max(0, ...nodes.map((n) => col.get(n.id) ?? 0));

  // Forward edges grouped by source; a source with 2+ forward edges branches,
  // and its edges fan out on staggered vertical runs.
  const isForward = (e: FlowEdge) => (col.get(e.to) ?? 0) > (col.get(e.from) ?? 0);
  const forwardBySource = new Map<string, number>();
  validEdges.forEach((e, idx) => {
    if (backEdges.has(idx) || !isForward(e)) return;
    forwardBySource.set(e.from, (forwardBySource.get(e.from) ?? 0) + 1);
  });
  const fanWidth = (sourceId: string) => {
    const count = forwardBySource.get(sourceId) ?? 1;
    return count > 1 ? FAN_BASE + (count - 1) * FAN_STEP : 0;
  };

  // Per-column gap: widen the space before any column that receives labeled
  // forward edges so their pills fit after the fan, clear of the target node.
  const gapBefore = new Array<number>(maxCol + 1).fill(COL_GAP);
  validEdges.forEach((e, idx) => {
    if (backEdges.has(idx) || !isForward(e) || !e.condition) return;
    const cTo = col.get(e.to) ?? 0;
    const need =
      fanWidth(e.from) + FAN_LABEL_GAP + estimateCondWidth(e.condition) + LABEL_CLEARANCE;
    gapBefore[cTo] = Math.max(gapBefore[cTo], need);
  });
  const colX = new Array<number>(maxCol + 1).fill(GUTTER_X);
  for (let c = 1; c <= maxCol; c += 1) {
    colX[c] = colX[c - 1] + NODE_W + gapBefore[c];
  }

  // Lanes in declared order; nodes without a known lane get a fallback lane.
  const laneDefs: FlowLane[] = [...(doc.lanes ?? [])];
  const knownLanes = new Set(laneDefs.map((l) => l.id));
  if (nodes.some((n) => !knownLanes.has(n.lane))) {
    laneDefs.push({ id: "__etc", label: "기타" });
  }

  const laidLanes: LaidLane[] = [];
  const laidNodes: LaidNode[] = [];
  let top = 0;
  for (const lane of laneDefs) {
    const laneNodes = nodes.filter((n) =>
      lane.id === "__etc" ? !knownLanes.has(n.lane) : n.lane === lane.id,
    );
    const stacks = new Map<number, number>();
    let maxStack = 1;
    for (const n of laneNodes) {
      const c = col.get(n.id) ?? 0;
      const idx = stacks.get(c) ?? 0;
      stacks.set(c, idx + 1);
      maxStack = Math.max(maxStack, idx + 1);
      laidNodes.push({
        ...n,
        x: colX[c] ?? GUTTER_X,
        y: top + LANE_PAD + idx * ROW_H,
      });
    }
    const height = LANE_PAD * 2 + Math.max(maxStack, 1) * ROW_H - (ROW_H - NODE_H);
    laidLanes.push({ ...lane, top, height });
    top += height;
  }

  const laidById = new Map(laidNodes.map((n) => [n.id, n]));

  // Rank each branching source's forward edges by target row so their
  // vertical runs stagger top-to-bottom without crossing each other.
  const fanRank = new Map<number, number>(); // edge index -> rank within its fan
  const grouped = new Map<string, number[]>();
  validEdges.forEach((e, idx) => {
    if (backEdges.has(idx) || !isForward(e)) return;
    const list = grouped.get(e.from) ?? [];
    list.push(idx);
    grouped.set(e.from, list);
  });
  for (const [, idxs] of grouped) {
    if (idxs.length < 2) continue;
    const sorted = [...idxs].sort((a, b) => {
      const ta = laidById.get(validEdges[a].to);
      const tb = laidById.get(validEdges[b].to);
      return (ta?.y ?? 0) - (tb?.y ?? 0) || (ta?.x ?? 0) - (tb?.x ?? 0);
    });
    sorted.forEach((idx, rank) => fanRank.set(idx, rank));
  }

  const laidEdges: LaidEdge[] = [];
  edges.forEach((e, i) => {
    const from = laidById.get(e.from);
    const to = laidById.get(e.to);
    if (!from || !to) return;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    let path: string;
    let labelX: number;
    let labelY: number;
    if (x2 > x1) {
      const validIdx = validEdges.indexOf(e);
      const rank = validIdx >= 0 ? fanRank.get(validIdx) : undefined;
      if (rank !== undefined) {
        // Branch edge: elbow on its own staggered vertical run, label pill
        // left-aligned after the whole fan on the target row.
        const bx = x1 + FAN_BASE + rank * FAN_STEP;
        path = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${bx} V ${y2} H ${x2}`;
        const labelLeft = x1 + fanWidth(e.from) + FAN_LABEL_GAP;
        labelX = e.condition
          ? Math.min(labelLeft + estimateCondWidth(e.condition) / 2, (labelLeft + x2) / 2)
          : (bx + x2) / 2;
        labelY = y2;
      } else {
        const midX = x1 + (x2 - x1) / 2;
        path = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
        labelX = midX;
        labelY = (y1 + y2) / 2;
      }
    } else {
      // Back edge: hook out to the right, then across.
      const outX = x1 + 20;
      path = `M ${x1} ${y1} H ${outX} V ${y2} H ${x2}`;
      labelX = outX;
      labelY = (y1 + y2) / 2;
    }
    laidEdges.push({
      key: `${e.from}-${e.to}-${i}`,
      path,
      condition: e.condition,
      labelX,
      labelY,
    });
  });

  return {
    nodes: laidNodes,
    lanes: laidLanes,
    edges: laidEdges,
    width: (colX[maxCol] ?? GUTTER_X) + NODE_W + GUTTER_X,
    height: Math.max(top, LANE_PAD * 2 + NODE_H),
  };
}

const KIND_LABEL: Record<FlowNodeKind, string> = {
  start: "시작",
  primary: "주요 페이지",
  page: "페이지",
};

/**
 * Detail panel for one flow node — the flow-side twin of FeatureMap's panel, sharing its
 * chrome classes (.wfs-fmap-panel*). Editing writes to spec/overrides.json only; see
 * src/lib/spec-overrides.ts.
 */
function FlowDetailPanel({
  node,
  laneLabel,
  onClose,
  onOpenArtifact,
  onPatch,
}: {
  node: FlowNode;
  laneLabel?: string;
  onClose: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onPatch?: (id: string, patch: NodeOverride) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="wfs-fmap-panel" aria-label={`플로우 상세: ${node.label}`}>
      <div className="wfs-fmap-panel-head">
        <span className="wfs-fmap-panel-title">{node.label}</span>
        <button
          type="button"
          className="wfs-fmap-panel-close"
          onClick={onClose}
          aria-label="상세 닫기"
          title="닫기 (Esc)"
        >
          ×
        </button>
      </div>
      <div className="wfs-fmap-panel-meta">
        <span className="wfs-fmap-panel-tag">{KIND_LABEL[node.kind]}</span>
      </div>
      {laneLabel ? (
        <div className="wfs-fmap-panel-source">영역: {laneLabel}</div>
      ) : null}
      {node.artifactId && onOpenArtifact ? (
        <button
          type="button"
          className="wfs-fmap-panel-open"
          onClick={() => onOpenArtifact(node.artifactId as string)}
        >
          와이어프레임 화면 열기 ↗
        </button>
      ) : null}
      {onPatch ? (
        <NodeEditor
          id={node.id}
          label={node.label}
          withImportance={false}
          onPatch={(patch) => onPatch(node.id, patch)}
        />
      ) : (
        <div className="wfs-fmap-panel-body" />
      )}
    </aside>
  );
}

export function UserFlow({
  doc,
  onOpenArtifact,
  onPatch,
}: {
  /** already merged with spec/overrides.json by the caller */
  doc: FlowDoc;
  onOpenArtifact?: (artifactId: string) => void;
  /** absent = read-only canvas (no overrides transport wired) */
  onPatch?: (id: string, patch: NodeOverride) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const laid = useMemo(() => layout(doc), [doc]);
  const selected = useMemo(
    () => (doc.nodes ?? []).find((n) => n.id === selectedId) ?? null,
    [doc, selectedId],
  );
  const { viewportRef, viewportProps, transform, panning, zoomBy, reset, view } =
    useCanvasPanZoom(laid);

  return (
    <div className={`wfs-uflow${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="wfs-uflow-toolbar">
        <div className="wfs-uflow-legend" aria-label="범례">
          <span className="wfs-uflow-legend-item">
            <i className="wfs-uflow-chip is-start" /> 시작
          </span>
          <span className="wfs-uflow-legend-item">
            <i className="wfs-uflow-chip is-primary" /> 주요 페이지
          </span>
          <span className="wfs-uflow-legend-item">
            <i className="wfs-uflow-chip is-page" /> 페이지
          </span>
          <span className="wfs-uflow-legend-item">→ 유저 흐름</span>
        </div>
        <span className="wfs-spacer" />
        <div className="wfs-fmap-zoom" role="group" aria-label="확대/축소">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} title="축소">
            −
          </button>
          <span className="wfs-fmap-zoom-level">{Math.round(view.k * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} title="확대">
            +
          </button>
          <button type="button" onClick={reset} title="전체 보기">
            초기화
          </button>
        </div>
        <button
          type="button"
          className="wfs-fmap-full"
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? "닫기" : "전체 화면"}
        </button>
      </div>

      <div className="wfs-uflow-body">
        <div
          ref={viewportRef}
          className={`wfs-studio-canvas${panning ? " is-panning" : ""}`}
          {...viewportProps}
        >
          {laid.nodes.length === 0 ? (
            <div className="wfs-studio-canvas-empty">표시할 노드가 없습니다.</div>
          ) : null}
          <div
            className="wfs-studio-canvas-inner"
            style={{ transform, width: laid.width, height: laid.height }}
          >
            <svg
              className="wfs-studio-canvas-edges"
              width={laid.width}
              height={laid.height}
              viewBox={`0 0 ${laid.width} ${laid.height}`}
            >
              <defs>
                <marker
                  id="wfs-uflow-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" className="wfs-uflow-arrowhead" />
                </marker>
              </defs>
              {laid.lanes.slice(1).map((lane) => (
                <line
                  key={`sep-${lane.id}`}
                  x1={0}
                  x2={laid.width}
                  y1={lane.top}
                  y2={lane.top}
                  className="wfs-uflow-lane-sep"
                />
              ))}
              {laid.edges.map((e) => (
                <path
                  key={e.key}
                  d={e.path}
                  className="wfs-uflow-edge"
                  markerEnd="url(#wfs-uflow-arrow)"
                />
              ))}
            </svg>
            {laid.lanes.map((lane) => (
              <div
                key={`label-${lane.id}`}
                className="wfs-uflow-lane-label"
                style={{ top: lane.top + 8 }}
              >
                {lane.label}
              </div>
            ))}
            {laid.edges
              .filter((e) => e.condition)
              .map((e) => (
                <div
                  key={`cond-${e.key}`}
                  className="wfs-uflow-cond"
                  style={{ left: e.labelX, top: e.labelY }}
                >
                  {e.condition}
                </div>
              ))}
            {laid.nodes.map((n) => {
              // With editing wired, a click opens the detail panel (which carries the
              // wireframe link); without it, the node stays a direct artifact link.
              const openable = Boolean(n.artifactId && onOpenArtifact);
              const selectable = Boolean(onPatch) || openable;
              return (
                <button
                  key={n.id}
                  type="button"
                  data-canvas-node
                  className={`wfs-uflow-node is-${n.kind}${selectable ? " is-clickable" : ""}${
                    n.id === selectedId ? " is-selected" : ""
                  }`}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  title={
                    onPatch
                      ? `${KIND_LABEL[n.kind]} · 상세 열기`
                      : openable
                        ? `${KIND_LABEL[n.kind]} · 와이어프레임 열기`
                        : KIND_LABEL[n.kind]
                  }
                  disabled={!selectable}
                  onClick={() => {
                    if (onPatch) {
                      setSelectedId(n.id);
                      return;
                    }
                    if (n.artifactId && onOpenArtifact) onOpenArtifact(n.artifactId);
                  }}
                >
                  {n.label}
                </button>
              );
            })}
          </div>
        </div>
        {selected ? (
          <FlowDetailPanel
            node={selected}
            laneLabel={(doc.lanes ?? []).find((l) => l.id === selected.lane)?.label}
            onClose={() => setSelectedId(null)}
            onOpenArtifact={onOpenArtifact}
            onPatch={onPatch}
          />
        ) : null}
      </div>
    </div>
  );
}
