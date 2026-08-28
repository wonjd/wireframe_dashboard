"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Action, Screen, WireframeDoc, WireframeNode } from "@/lib/wireframe/schema";
import { NodeView } from "./node-view";

/**
 * 와이어프레임 렌더러 — 스펙 §5.1, §5.4.
 *
 * IR(데이터)을 받아 미리 정의된 컴포넌트로 그린다. LLM이 만든 HTML을 주입하지
 * 않으므로 script 주입 경로가 없다. 동작(Action)도 데이터이며, 여기 있는
 * 경량 상태 머신이 **화이트리스트된 것만** 실행한다.
 */

export type RendererState = {
  currentScreenId: string;
  openModalId: string | null;
  history: string[];
};

export function WireframeRenderer({
  doc,
  screenId,
  onScreenChange,
}: {
  doc: WireframeDoc;
  /** 외부(탭)에서 화면을 고정하고 싶을 때. 재생성 후 화면 유지에 쓴다 (§12.3). */
  screenId?: string;
  onScreenChange?: (screenId: string) => void;
}) {
  const screens = doc.screens;
  const firstId = screens[0]?.id ?? "";

  const [state, setState] = useState<RendererState>({
    currentScreenId: screenId && screens.some((s) => s.id === screenId) ? screenId : firstId,
    openModalId: null,
    history: [],
  });

  // 외부에서 화면을 바꾸면 따라간다. 존재하지 않는 id면 첫 화면으로 떨어진다 —
  // 재생성으로 화면이 사라졌을 때 빈 화면을 보여주지 않기 위해서다.
  useEffect(() => {
    if (!screenId) return;
    setState((s) =>
      s.currentScreenId === screenId
        ? s
        : {
            currentScreenId: screens.some((x) => x.id === screenId) ? screenId : firstId,
            openModalId: null,
            history: [],
          }
    );
  }, [screenId, screens, firstId]);

  const current: Screen | undefined = useMemo(
    () => screens.find((s) => s.id === state.currentScreenId) ?? screens[0],
    [screens, state.currentScreenId]
  );

  const dispatch = useCallback(
    (action: Action) => {
      setState((s) => {
        switch (action.type) {
          case "navigate": {
            if (!screens.some((x) => x.id === action.targetScreenId)) return s;
            onScreenChange?.(action.targetScreenId);
            return {
              currentScreenId: action.targetScreenId,
              openModalId: null,
              history: [...s.history, s.currentScreenId],
            };
          }
          case "openModal":
            return { ...s, openModalId: action.targetNodeId };
          case "closeModal":
            return { ...s, openModalId: null };
          default:
            return s;
        }
      });
    },
    [screens, onScreenChange]
  );

  const goBack = useCallback(() => {
    setState((s) => {
      if (s.history.length === 0) return s;
      const prev = s.history[s.history.length - 1];
      onScreenChange?.(prev);
      return { currentScreenId: prev, openModalId: null, history: s.history.slice(0, -1) };
    });
  }, [onScreenChange]);

  if (!current) {
    return <div className="p-10 text-center text-[13px] text-ink-3">화면이 없습니다.</div>;
  }

  const modal = state.openModalId ? findNode(current.nodes, state.openModalId) : null;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3.5 py-2 text-[12px]">
        <span className="flex items-center gap-1.5 font-medium text-ink-2">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
          </span>
          {current.name}
        </span>
        {current.route && (
          <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-4">
            {current.route}
          </code>
        )}
        <div className="ml-auto flex items-center gap-2">
          {state.history.length > 0 && (
            <button onClick={goBack} className="btn-default px-2 py-1 text-[11.5px]">
              ← 뒤로
            </button>
          )}
          <select
            aria-label="화면 선택"
            value={current.id}
            onChange={(e) => dispatch({ type: "navigate", targetScreenId: e.target.value })}
            className="input-field h-7 px-2 text-[11.5px]"
          >
            {screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ScreenView screen={current} dispatch={dispatch} />

      {modal && modal.type === "modal" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-900/40 p-6">
          <div className="w-full max-w-md rounded border-2 border-neutral-400 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
              <span className="text-sm font-medium text-neutral-700">{modal.props.title}</span>
              <button
                onClick={() => dispatch({ type: "closeModal" })}
                className="text-neutral-400 hover:text-neutral-700"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-12 gap-2 p-4">
              {(modal.children ?? []).map((c) => (
                <NodeView key={c.id} node={c} dispatch={dispatch} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScreenView({ screen, dispatch }: { screen: Screen; dispatch: (a: Action) => void }) {
  const sidebar = screen.nodes.find((n) => n.type === "sidebar");
  const rest = screen.nodes.filter((n) => n !== sidebar);

  if (screen.layout === "sidebar-left" && sidebar) {
    return (
      <div className="flex min-h-[420px]">
        <div className="w-48 shrink-0 border-r border-neutral-200 bg-neutral-50 p-3">
          <NodeView node={sidebar} dispatch={dispatch} bare />
        </div>
        <div className="grid flex-1 grid-cols-12 content-start gap-3 p-4">
          {rest.map((n) => (
            <NodeView key={n.id} node={n} dispatch={dispatch} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[420px] grid-cols-12 content-start gap-3 p-4">
      {screen.nodes.map((n) => (
        <NodeView key={n.id} node={n} dispatch={dispatch} />
      ))}
    </div>
  );
}

function findNode(nodes: WireframeNode[], id: string): WireframeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if ("children" in n && n.children) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
