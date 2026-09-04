import { useEffect, useMemo, useState } from "react";
import { useCanvasPanZoom } from "./useCanvasPanZoom";
import type { NodeOverride } from "../lib/spec-overrides";

export type FeatureImportance = "high" | "medium" | "low";
export type FeatureStatus = "confirmed" | "draft" | "assumed";
export type FeatureFieldControl = "radio" | "select" | "text" | "textarea" | "file";

export type FeatureField = {
  label: string;
  required?: boolean;
  control?: FeatureFieldControl;
  options?: string[];
};

export type FeatureChild = {
  no: string;
  label: string;
  importance?: FeatureImportance;
  status?: FeatureStatus;
  source?: string;
  stepNo?: number;
  artifactId?: string;
  fields?: FeatureField[];
};

export type FeatureGroup = {
  no: string;
  label: string;
  importance?: FeatureImportance;
  status?: FeatureStatus;
  children?: FeatureChild[];
};

export type FeaturesDoc = {
  root?: { label?: string; runId?: string };
  groups?: FeatureGroup[];
};

const CARD_W = 200;
const CARD_H = 54;
const GAP_X = 96;
const ROW_H = 70;
const PAD = 40;

const IMPORTANCE_LABEL: Record<FeatureImportance, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
};
const STATUS_LABEL: Record<FeatureStatus, string> = {
  confirmed: "확정",
  draft: "초안",
  assumed: "가정",
};
/** Plain-Korean control names — must match the static spec page (00-spec). */
const CONTROL_LABEL: Record<FeatureFieldControl, string> = {
  radio: "택1",
  select: "선택",
  text: "입력",
  textarea: "긴 입력",
  file: "파일 첨부",
};

function controlLabel(control?: FeatureFieldControl): string {
  return (control && CONTROL_LABEL[control]) || "입력";
}

function optionsText(options?: string[]): string {
  const clean = (options ?? []).filter((o) => o && o.trim().length > 0);
  return clean.length ? clean.join(" / ") : "—";
}

type LaidNode = {
  key: string;
  depth: 0 | 1 | 2;
  x: number;
  y: number;
  label: string;
  no?: string;
  importance?: FeatureImportance;
  status?: FeatureStatus;
  source?: string;
  dimmed?: boolean;
};

type LaidEdge = { key: string; x1: number; y1: number; x2: number; y2: number };

function matches(
  node: { importance?: FeatureImportance; status?: FeatureStatus },
  fImportance: string,
  fStatus: string,
): boolean {
  if (fImportance !== "all" && node.importance !== fImportance) return false;
  if (fStatus !== "all" && node.status !== fStatus) return false;
  return true;
}

/**
 * Simple tidy-tree layout: depth decides x (root → groups → children, left to
 * right), leaf order decides y. Each leaf takes one row; a parent sits at the
 * vertical center of its visible children.
 */
function layout(
  doc: FeaturesDoc,
  fImportance: string,
  fStatus: string,
): { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number } {
  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const groupX = PAD + CARD_W + GAP_X;
  const childX = groupX + CARD_W + GAP_X;
  let row = 0;
  const groupYs: number[] = [];

  for (const group of doc.groups ?? []) {
    const groupSelf = matches(group, fImportance, fStatus);
    const children = (group.children ?? []).filter((c) => matches(c, fImportance, fStatus));
    if (!groupSelf && children.length === 0) continue;

    let groupY: number;
    if (children.length > 0) {
      const childYs: number[] = [];
      for (const child of children) {
        const y = PAD + row * ROW_H;
        row += 1;
        childYs.push(y);
        nodes.push({
          key: `c-${child.no}`,
          depth: 2,
          x: childX,
          y,
          label: child.label,
          no: child.no,
          importance: child.importance,
          status: child.status,
          source: child.source,
        });
      }
      groupY = childYs.reduce((a, b) => a + b, 0) / childYs.length;
      for (const y of childYs) {
        edges.push({
          key: `e-${group.no}-${y}`,
          x1: groupX + CARD_W,
          y1: groupY + CARD_H / 2,
          x2: childX,
          y2: y + CARD_H / 2,
        });
      }
    } else {
      groupY = PAD + row * ROW_H;
      row += 1;
    }
    groupYs.push(groupY);
    nodes.push({
      key: `g-${group.no}`,
      depth: 1,
      x: groupX,
      y: groupY,
      label: group.label,
      no: group.no,
      importance: group.importance,
      status: group.status,
      dimmed: !groupSelf,
    });
  }

  const rootY = groupYs.length
    ? groupYs.reduce((a, b) => a + b, 0) / groupYs.length
    : PAD;
  nodes.push({
    key: "root",
    depth: 0,
    x: PAD,
    y: rootY,
    label: doc.root?.label || "PRD",
  });
  for (const y of groupYs) {
    edges.push({
      key: `e-root-${y}`,
      x1: PAD + CARD_W,
      y1: rootY + CARD_H / 2,
      x2: groupX,
      y2: y + CARD_H / 2,
    });
  }

  return {
    nodes,
    edges,
    width: childX + CARD_W + PAD,
    height: Math.max(row, 1) * ROW_H + PAD * 2,
  };
}

function edgePath(e: LaidEdge): string {
  const dx = Math.max(28, (e.x2 - e.x1) * 0.55);
  return `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`;
}

/**
 * Rename / importance / hide for one node. The edits are written to
 * spec/overrides.json (never into features.json) and merged back at read time — see
 * src/lib/spec-overrides.ts.
 */
export function NodeEditor({
  id,
  label,
  importance,
  withImportance,
  onPatch,
}: {
  id: string;
  label: string;
  importance?: FeatureImportance;
  withImportance: boolean;
  onPatch: (patch: NodeOverride) => void;
}) {
  // Local draft so clearing the box does not snap back to the generated label mid-typing
  // (an empty override is dropped, which restores the generated value).
  const [draft, setDraft] = useState(label);
  // Re-seed on selection change only — depending on `label` would fight every keystroke.
  useEffect(() => {
    setDraft(label);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wfs-fmap-edit">
      <label className="wfs-fmap-edit-row">
        <span className="wfs-fmap-edit-label">이름</span>
        <input
          type="text"
          className="wfs-fmap-edit-input"
          value={draft}
          maxLength={200}
          placeholder="비우면 원래 이름"
          onChange={(e) => {
            setDraft(e.target.value);
            onPatch({ label: e.target.value });
          }}
        />
      </label>
      {withImportance ? (
        <label className="wfs-fmap-edit-row">
          <span className="wfs-fmap-edit-label">중요도</span>
          <select
            className="wfs-fmap-edit-input"
            value={importance ?? ""}
            onChange={(e) =>
              onPatch({ importance: (e.target.value || undefined) as FeatureImportance })
            }
          >
            <option value="high">높음</option>
            <option value="medium">중간</option>
            <option value="low">낮음</option>
          </select>
        </label>
      ) : null}
      {/* Always unchecked: hiding removes the node from the canvas, so this panel can
          only ever show a visible one. Restore is the chip list in the studio bar. */}
      <label className="wfs-fmap-edit-check">
        <input type="checkbox" checked={false} onChange={() => onPatch({ hidden: true })} />
        <span>이 항목 숨기기</span>
      </label>
    </div>
  );
}

function FeatureDetailPanel({
  child,
  onClose,
  onOpenArtifact,
  onPatch,
}: {
  child: FeatureChild;
  onClose: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onPatch?: (no: string, patch: NodeOverride) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fields = child.fields ?? [];

  return (
    <aside className="wfs-fmap-panel" aria-label={`기능 상세: ${child.label}`}>
      <div className="wfs-fmap-panel-head">
        <span className="wfs-fmap-node-no">{child.no}</span>
        <span className="wfs-fmap-panel-title">{child.label}</span>
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
        {child.importance ? (
          <span className="wfs-fmap-panel-tag">
            <i className={`wfs-fmap-dot is-${child.importance}`} />
            중요도 {IMPORTANCE_LABEL[child.importance]}
          </span>
        ) : null}
        {child.status ? (
          <span className="wfs-fmap-panel-tag">상태 {STATUS_LABEL[child.status]}</span>
        ) : null}
        {typeof child.stepNo === "number" ? (
          <span className="wfs-fmap-panel-tag">단계 {child.stepNo}</span>
        ) : null}
      </div>
      {child.source ? (
        <div className="wfs-fmap-panel-source">근거: {child.source}</div>
      ) : null}
      {onPatch ? (
        <NodeEditor
          id={child.no}
          label={child.label}
          importance={child.importance}
          withImportance
          onPatch={(patch) => onPatch(child.no, patch)}
        />
      ) : null}
      {child.artifactId && onOpenArtifact ? (
        <button
          type="button"
          className="wfs-fmap-panel-open"
          onClick={() => onOpenArtifact(child.artifactId as string)}
        >
          와이어프레임 화면 열기 ↗
        </button>
      ) : null}
      <div className="wfs-fmap-panel-body">
        {fields.length > 0 ? (
          <table className="wfs-fmap-panel-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>필수</th>
                <th>입력 방식</th>
                <th>선택지</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={`${f.label}-${i}`}>
                  <td>{f.label}</td>
                  <td>{f.required ? "필수" : "선택"}</td>
                  <td>{controlLabel(f.control)}</td>
                  <td>{optionsText(f.options)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="wfs-fmap-panel-nofields">
            정의된 입력 항목이 없습니다.
          </div>
        )}
      </div>
    </aside>
  );
}

export function FeatureMap({
  doc,
  onOpenArtifact,
  onPatch,
}: {
  /** already merged with spec/overrides.json by the caller */
  doc: FeaturesDoc;
  onOpenArtifact?: (artifactId: string) => void;
  /** absent = read-only canvas (no overrides transport wired) */
  onPatch?: (no: string, patch: NodeOverride) => void;
}) {
  const [fImportance, setFImportance] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);

  const laid = useMemo(() => layout(doc, fImportance, fStatus), [doc, fImportance, fStatus]);
  const { viewportRef, viewportProps, transform, panning, zoomBy, reset, view } =
    useCanvasPanZoom(laid);

  const childByNo = useMemo(() => {
    const map = new Map<string, FeatureChild>();
    for (const group of doc.groups ?? []) {
      for (const child of group.children ?? []) map.set(child.no, child);
    }
    return map;
  }, [doc]);
  const selected = selectedNo ? childByNo.get(selectedNo) ?? null : null;

  return (
    <div className={`wfs-fmap${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="wfs-fmap-toolbar">
        <label className="wfs-fmap-filter">
          중요도
          <select value={fImportance} onChange={(e) => setFImportance(e.target.value)}>
            <option value="all">전체</option>
            <option value="high">높음</option>
            <option value="medium">중간</option>
            <option value="low">낮음</option>
          </select>
        </label>
        <label className="wfs-fmap-filter">
          상태
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="all">전체</option>
            <option value="confirmed">확정</option>
            <option value="draft">초안</option>
            <option value="assumed">가정</option>
          </select>
        </label>
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

      <div className="wfs-fmap-body">
        <div
          ref={viewportRef}
          className={`wfs-studio-canvas${panning ? " is-panning" : ""}`}
          {...viewportProps}
        >
          {laid.nodes.length <= 1 ? (
            <div className="wfs-studio-canvas-empty">조건에 맞는 항목이 없습니다.</div>
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
              {laid.edges.map((e) => (
                <path key={e.key} d={edgePath(e)} className="wfs-fmap-edge" />
              ))}
            </svg>
            {laid.nodes.map((n) => {
              const selectable = n.depth === 2 && n.no !== undefined;
              const isSelected = selectable && n.no === selectedNo;
              return (
                <div
                  key={n.key}
                  data-canvas-node
                  className={`wfs-fmap-node is-depth-${n.depth}${
                    n.status ? ` is-${n.status}` : ""
                  }${n.dimmed ? " is-dimmed" : ""}${
                    selectable ? " is-selectable" : ""
                  }${isSelected ? " is-selected" : ""}`}
                  style={{ left: n.x, top: n.y, width: CARD_W, minHeight: CARD_H }}
                  title={n.source ? `근거: ${n.source}` : undefined}
                  role={selectable ? "button" : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  onClick={selectable ? () => setSelectedNo(n.no ?? null) : undefined}
                  onKeyDown={
                    selectable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedNo(n.no ?? null);
                          }
                        }
                      : undefined
                  }
                >
                  <div className="wfs-fmap-node-top">
                    {n.importance ? (
                      <span
                        className={`wfs-fmap-dot is-${n.importance}`}
                        title={`중요도 ${IMPORTANCE_LABEL[n.importance]}`}
                      />
                    ) : null}
                    <span className="wfs-fmap-node-label">{n.label}</span>
                    {n.no ? <span className="wfs-fmap-node-no">{n.no}</span> : null}
                  </div>
                  {n.status ? (
                    <div className="wfs-fmap-node-meta">{STATUS_LABEL[n.status]}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        {selected ? (
          <FeatureDetailPanel
            child={selected}
            onClose={() => setSelectedNo(null)}
            onOpenArtifact={onOpenArtifact}
            onPatch={onPatch}
          />
        ) : null}
      </div>
    </div>
  );
}
