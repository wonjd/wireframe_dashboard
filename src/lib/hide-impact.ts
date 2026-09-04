import type { FeaturesDoc } from "../components/FeatureMap";
import type { FlowDoc } from "../components/UserFlow";

/**
 * Business-language description of what a hide will remove, shown in the confirm dialog
 * before an "이 항목 숨기기" edit is committed. Deliberately SIMPLE: it names only the
 * thing being hidden (its screen / 기능 label) and, for a flow node, the branch decision
 * that leads to it. It does NOT re-compute the full downstream collapse (bypass edges,
 * orphaned successors) — that is applyFlowOverrides' job at save time. This is a
 * non-developer confirmation, not an engineering diff.
 */
export type HideImpact = {
  /** business label of the thing being hidden (never an id) */
  title: string;
  /** short business-language bullets naming what goes with it */
  lines: string[];
};

/**
 * No-dev-terms bar for anything shown in the dialog. Mirrors the spirit of
 * server/openai-agent.ts `sanitizeUserFacing`: user-facing copy must never leak build
 * vocabulary. If a candidate string carries build vocabulary (노드/엣지/아티팩트/step-N),
 * or a bare code-looking token (an id, a table/column/code name — 6+ run of
 * ASCII/underscore/hyphen), we drop it for a generic screen name rather than show the leak.
 */
const DEV_TERMS = /(노드|엣지|아티팩트|artifact|step[-_\s]?\d)/i;
const CODE_TOKEN = /[A-Za-z0-9_-]{6,}/;

export function businessSafe(text: string | null | undefined, fallback: string): string {
  const t = (text ?? "").trim();
  if (!t) return fallback;
  if (DEV_TERMS.test(t) || CODE_TOKEN.test(t)) return fallback;
  return t;
}

/**
 * Flow node hide: name the screen, and if an incoming edge carries the branch condition
 * that leads here, phrase it as 「{condition}」을 골랐을 때 나오는 화면. No downstream walk.
 */
export function describeFlowHide(doc: FlowDoc, nodeId: string): HideImpact {
  const node = (doc.nodes ?? []).find((n) => n.id === nodeId);
  const screen = businessSafe(node?.label, "이 화면");
  const condRaw = (doc.edges ?? []).find((e) => e.to === nodeId && e.condition)?.condition;
  const cond = condRaw ? businessSafe(condRaw, "") : "";
  const lines = cond
    ? [`「${cond}」을 골랐을 때 나오는 화면`, `${screen} 화면`]
    : [`${screen} 화면`];
  return { title: screen, lines };
}

/**
 * Feature node hide: name the 기능 그룹 → 하위 기능 path. If the 하위 기능 maps to a screen
 * (artifactId/stepNo), add that the connected screen goes too. Hiding a group takes its
 * children with it. No screen ids are ever surfaced.
 */
export function describeFeatureHide(doc: FeaturesDoc, no: string): HideImpact {
  for (const group of doc.groups ?? []) {
    if (group.no === no) {
      const g = businessSafe(group.label, "이 기능 그룹");
      return { title: g, lines: [`${g}에 속한 하위 기능이 모두 함께 빠집니다.`] };
    }
    for (const child of group.children ?? []) {
      if (child.no !== no) continue;
      const g = businessSafe(group.label, "기능");
      const c = businessSafe(child.label, "이 기능");
      const lines = [`${g} → ${c}`];
      if (child.artifactId || typeof child.stepNo === "number") {
        lines.push("연결된 와이어프레임 화면도 함께 빠집니다.");
      }
      return { title: c, lines };
    }
  }
  return { title: "이 기능", lines: [] };
}
