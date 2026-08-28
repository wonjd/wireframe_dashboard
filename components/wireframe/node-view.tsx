"use client";

import type { Action, WireframeNode } from "@/lib/wireframe/types";

/**
 * 노드 타입별 렌더링 — §5.1 "같은 type은 항상 같은 컴포넌트로".
 *
 * 회색조 + 시스템 폰트로 "이건 와이어프레임이다"를 시각적으로 못박는다.
 * 알 수 없는 type은 앱을 깨뜨리지 않고 placeholder로 떨어진다 (IR 버전 진화 대비).
 */

const SPAN: Record<number, string> = {
  1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4",
  5: "col-span-5", 6: "col-span-6", 7: "col-span-7", 8: "col-span-8",
  9: "col-span-9", 10: "col-span-10", 11: "col-span-11", 12: "col-span-12",
};

export function NodeView({
  node,
  dispatch,
  bare = false,
}: {
  node: WireframeNode;
  dispatch: (a: Action) => void;
  /** 사이드바처럼 그리드 밖에서 그릴 때 span 래퍼를 생략한다. */
  bare?: boolean;
}) {
  const clickable = Boolean(node.action);
  const onClick = node.action ? () => dispatch(node.action!) : undefined;

  const inner = renderNode(node, dispatch);
  if (bare) return <>{inner}</>;

  return (
    <div
      className={[
        SPAN[node.gridSpan ?? 12] ?? "col-span-12",
        clickable ? "cursor-pointer rounded outline-offset-2 hover:outline hover:outline-2 hover:outline-blue-400" : "",
      ].join(" ")}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {inner}
    </div>
  );
}

function renderNode(node: WireframeNode, dispatch: (a: Action) => void) {
  switch (node.type) {
    case "heading": {
      const size = node.props.level === 1 ? "text-xl" : node.props.level === 3 ? "text-sm" : "text-base";
      return <div className={`${size} font-semibold text-neutral-800`}>{node.props.text}</div>;
    }

    case "text":
      return (
        <p className={`text-sm ${node.props.muted ? "text-neutral-400" : "text-neutral-600"}`}>
          {node.props.text}
        </p>
      );

    case "button": {
      const v = node.props.variant ?? "secondary";
      const style =
        v === "primary"
          ? "bg-neutral-700 text-white border-neutral-700"
          : v === "danger"
            ? "bg-white text-red-600 border-red-300"
            : "bg-white text-neutral-700 border-neutral-300";
      return (
        <span className={`inline-block rounded border px-3 py-1.5 text-sm ${style}`}>
          {node.props.label}
        </span>
      );
    }

    case "input":
      return (
        <label className="block">
          {node.props.label && (
            <span className="mb-1 block text-xs text-neutral-500">{node.props.label}</span>
          )}
          <div className="h-9 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-400">
            {node.props.placeholder ?? ""}
          </div>
        </label>
      );

    case "select":
      return (
        <label className="block">
          {node.props.label && (
            <span className="mb-1 block text-xs text-neutral-500">{node.props.label}</span>
          )}
          <div className="flex h-9 w-full items-center justify-between rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-500">
            <span>{node.props.options[0] ?? ""}</span>
            <span className="text-neutral-400">▾</span>
          </div>
        </label>
      );

    case "checkbox":
      return (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <span
            className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border ${
              node.props.checked ? "border-neutral-600 bg-neutral-600 text-white" : "border-neutral-400 bg-white"
            }`}
          >
            {node.props.checked ? "✓" : ""}
          </span>
          {node.props.label}
        </div>
      );

    case "image":
      return (
        <div
          className={`flex items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-100 text-xs text-neutral-400 ${
            node.props?.ratio === "square" ? "aspect-square" : "aspect-video"
          }`}
        >
          {node.props?.label ?? "이미지"}
        </div>
      );

    case "divider":
      return <hr className="border-neutral-200" />;

    case "table":
      return (
        <div className="overflow-x-auto rounded border border-neutral-300">
          <table className="w-full text-sm">
            <thead className="bg-neutral-100">
              <tr>
                {node.props.columns.map((c, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-neutral-600">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(node.props.sampleRows ?? [node.props.columns.map(() => "—")]).map((row, ri) => (
                <tr key={ri} className="border-t border-neutral-200">
                  {node.props.columns.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 text-neutral-500">
                      {row[ci] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "list":
      return (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-300">
          {node.props.items.map((it, i) => (
            <li key={i} className="px-3 py-2 text-sm text-neutral-600">
              {it}
            </li>
          ))}
        </ul>
      );

    case "nav":
      return (
        <nav className="flex items-center gap-1 rounded border border-neutral-300 bg-white p-1">
          {node.props.items.map((it, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                if (it.action) dispatch(it.action);
              }}
              className={`rounded px-3 py-1.5 text-sm text-neutral-600 ${
                it.action ? "hover:bg-neutral-100" : "cursor-default"
              }`}
            >
              {it.label}
            </button>
          ))}
        </nav>
      );

    case "sidebar":
      return (
        <nav className="flex flex-col gap-1">
          {node.props.items.map((it, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                if (it.action) dispatch(it.action);
              }}
              className={`rounded px-3 py-2 text-left text-sm text-neutral-600 ${
                it.action ? "hover:bg-neutral-200" : "cursor-default"
              }`}
            >
              {it.label}
            </button>
          ))}
        </nav>
      );

    case "tabs":
      return (
        <div>
          <div className="flex gap-1 border-b border-neutral-300">
            {node.props.tabs.map((t, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 text-sm ${
                  i === (node.props.activeIndex ?? 0)
                    ? "-mb-px border-b-2 border-neutral-700 font-medium text-neutral-800"
                    : "text-neutral-500"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
          {node.children && (
            <div className="grid grid-cols-12 gap-3 pt-3">
              {node.children.map((c) => (
                <NodeView key={c.id} node={c} dispatch={dispatch} />
              ))}
            </div>
          )}
        </div>
      );

    case "header":
      return (
        <div className="border-b border-neutral-300 pb-3">
          <div className="text-lg font-semibold text-neutral-800">{node.props.title}</div>
          {node.props.subtitle && (
            <div className="text-sm text-neutral-500">{node.props.subtitle}</div>
          )}
          {node.children && (
            <div className="grid grid-cols-12 gap-3 pt-3">
              {node.children.map((c) => (
                <NodeView key={c.id} node={c} dispatch={dispatch} />
              ))}
            </div>
          )}
        </div>
      );

    case "card":
      return (
        <div className="rounded border border-neutral-300 bg-white p-4">
          {node.props?.title && (
            <div className="mb-3 text-sm font-medium text-neutral-700">{node.props.title}</div>
          )}
          <div className="grid grid-cols-12 gap-3">
            {(node.children ?? []).map((c) => (
              <NodeView key={c.id} node={c} dispatch={dispatch} />
            ))}
          </div>
        </div>
      );

    case "container":
      return (
        <div
          className={
            node.props?.direction === "row"
              ? "flex flex-wrap items-end gap-3"
              : "grid grid-cols-12 gap-3"
          }
        >
          {(node.children ?? []).map((c) =>
            node.props?.direction === "row" ? (
              <div key={c.id} className="flex-1">
                <NodeView node={c} dispatch={dispatch} bare />
              </div>
            ) : (
              <NodeView key={c.id} node={c} dispatch={dispatch} />
            )
          )}
        </div>
      );

    case "modal":
      // 모달은 열렸을 때 renderer가 오버레이로 그린다. 흐름상 자리만 표시.
      return (
        <div className="rounded border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-400">
          모달: {node.props.title} (버튼을 눌러 열림)
        </div>
      );

    default:
      return (
        <div className="rounded border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          지원하지 않는 노드 타입
        </div>
      );
  }
}
