import { MAX_SCREENS } from "../constants";
import type { Action, NavItem, NodeType, Screen, WireframeDoc, WireframeNode } from "./schema";

const NODE_TYPES = new Set<NodeType>([
  "heading", "text", "button", "input", "select", "checkbox", "image", "divider",
  "table", "list", "nav", "sidebar", "tabs", "header", "card", "container", "modal",
]);

const LAYOUTS = new Set<Screen["layout"]>(["plain", "sidebar-left", "topnav"]);

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function idStr(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || fallback).slice(0, 64);
}

function coerceAction(raw: unknown): Action | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.type === "closeModal") return { type: "closeModal" };
  if (o.type === "navigate") {
    const targetScreenId = idStr(o.targetScreenId, "");
    if (!targetScreenId) return undefined;
    return { type: "navigate", targetScreenId };
  }
  if (o.type === "openModal") {
    const targetNodeId = idStr(o.targetNodeId, "");
    if (!targetNodeId) return undefined;
    return { type: "openModal", targetNodeId };
  }
  return undefined;
}

function coerceNavItems(raw: unknown): NavItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NavItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = str(o.label, "\uD56D\uBAA9");
    const action = coerceAction(o.action);
    out.push(action ? { label, action } : { label });
  }
  return out;
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function coerceChildren(raw: unknown, prefix: string): WireframeNode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const children: WireframeNode[] = [];
  raw.forEach((c, i) => {
    const n = coerceNode(c, `${prefix}-c${i + 1}`);
    if (n) children.push(n);
  });
  return children.length > 0 ? children : undefined;
}

function coerceNode(raw: unknown, fallbackId: string): WireframeNode | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const typeRaw = o.type;
  if (typeof typeRaw !== "string" || !NODE_TYPES.has(typeRaw as NodeType)) return null;
  const type = typeRaw as NodeType;
  const id = idStr(o.id, fallbackId);
  const gridSpan =
    typeof o.gridSpan === "number" && Number.isFinite(o.gridSpan)
      ? Math.min(12, Math.max(1, Math.round(o.gridSpan)))
      : undefined;
  const action = coerceAction(o.action);
  const propsRaw = o.props && typeof o.props === "object" ? (o.props as Record<string, unknown>) : {};

  const withBase = <T extends WireframeNode>(node: T): T => {
    if (gridSpan !== undefined) (node as WireframeNode & { gridSpan?: number }).gridSpan = gridSpan;
    if (action) (node as WireframeNode & { action?: Action }).action = action;
    return node;
  };

  switch (type) {
    case "divider":
      return withBase({ id, type: "divider" });
    case "heading": {
      const levelRaw = propsRaw.level;
      const level = levelRaw === 1 || levelRaw === 2 || levelRaw === 3 ? levelRaw : undefined;
      return withBase({
        id,
        type: "heading",
        props: { text: str(propsRaw.text, "\uC81C\uBAA9"), ...(level !== undefined ? { level } : {}) },
      });
    }
    case "text":
      return withBase({
        id,
        type: "text",
        props: { text: str(propsRaw.text, ""), ...(propsRaw.muted === true ? { muted: true } : {}) },
      });
    case "button": {
      const variantRaw = propsRaw.variant;
      const variant =
        variantRaw === "primary" || variantRaw === "secondary" || variantRaw === "danger"
          ? variantRaw
          : undefined;
      return withBase({
        id,
        type: "button",
        props: { label: str(propsRaw.label, "\uBC84\uD2BC"), ...(variant ? { variant } : {}) },
      });
    }
    case "input": {
      const inputTypeRaw = propsRaw.inputType;
      const inputType =
        inputTypeRaw === "text" ||
        inputTypeRaw === "number" ||
        inputTypeRaw === "date" ||
        inputTypeRaw === "password"
          ? inputTypeRaw
          : undefined;
      return withBase({
        id,
        type: "input",
        props: {
          ...(typeof propsRaw.label === "string" ? { label: propsRaw.label } : {}),
          ...(typeof propsRaw.placeholder === "string" ? { placeholder: propsRaw.placeholder } : {}),
          ...(inputType ? { inputType } : {}),
        },
      });
    }
    case "select": {
      const options = stringArray(propsRaw.options);
      return withBase({
        id,
        type: "select",
        props: {
          ...(typeof propsRaw.label === "string" ? { label: propsRaw.label } : {}),
          options: options.length > 0 ? options : ["\uC635\uC158"],
        },
      });
    }
    case "checkbox":
      return withBase({
        id,
        type: "checkbox",
        props: {
          label: str(propsRaw.label, "\uC635\uC158"),
          ...(propsRaw.checked === true ? { checked: true } : {}),
        },
      });
    case "image": {
      const ratio = propsRaw.ratio === "square" || propsRaw.ratio === "wide" ? propsRaw.ratio : undefined;
      return withBase({
        id,
        type: "image",
        props: {
          ...(typeof propsRaw.label === "string" ? { label: propsRaw.label } : {}),
          ...(ratio ? { ratio } : {}),
        },
      });
    }
    case "table": {
      const columns = stringArray(propsRaw.columns);
      const sampleRows = Array.isArray(propsRaw.sampleRows)
        ? propsRaw.sampleRows
            .filter((row): row is string[] => Array.isArray(row))
            .map((row) => row.map((c) => (typeof c === "string" ? c : String(c))))
        : undefined;
      return withBase({
        id,
        type: "table",
        props: {
          columns: columns.length > 0 ? columns : ["\uCEEC\uB7FC"],
          ...(sampleRows && sampleRows.length > 0 ? { sampleRows } : {}),
        },
      });
    }
    case "list":
      return withBase({
        id,
        type: "list",
        props: { items: stringArray(propsRaw.items).length > 0 ? stringArray(propsRaw.items) : ["\uD56D\uBAA9"] },
      });
    case "nav":
      return withBase({ id, type: "nav", props: { items: coerceNavItems(propsRaw.items) } });
    case "sidebar":
      return withBase({ id, type: "sidebar", props: { items: coerceNavItems(propsRaw.items) } });
    case "tabs": {
      const tabs = stringArray(propsRaw.tabs);
      const activeIndex =
        typeof propsRaw.activeIndex === "number" && Number.isFinite(propsRaw.activeIndex)
          ? Math.max(0, Math.round(propsRaw.activeIndex))
          : undefined;
      const children = coerceChildren(o.children, id);
      return withBase({
        id,
        type: "tabs",
        props: {
          tabs: tabs.length > 0 ? tabs : ["\uD0ED"],
          ...(activeIndex !== undefined ? { activeIndex } : {}),
        },
        ...(children ? { children } : {}),
      });
    }
    case "header": {
      const children = coerceChildren(o.children, id);
      return withBase({
        id,
        type: "header",
        props: {
          title: str(propsRaw.title, "\uC81C\uBAA9"),
          ...(typeof propsRaw.subtitle === "string" ? { subtitle: propsRaw.subtitle } : {}),
        },
        ...(children ? { children } : {}),
      });
    }
    case "card": {
      const children = coerceChildren(o.children, id);
      return withBase({
        id,
        type: "card",
        ...(typeof propsRaw.title === "string" ? { props: { title: propsRaw.title } } : {}),
        ...(children ? { children } : {}),
      });
    }
    case "container": {
      const direction = propsRaw.direction === "row" || propsRaw.direction === "column" ? propsRaw.direction : undefined;
      const children = coerceChildren(o.children, id);
      return withBase({
        id,
        type: "container",
        ...(direction ? { props: { direction } } : {}),
        ...(children ? { children } : {}),
      });
    }
    case "modal": {
      const children = coerceChildren(o.children, id);
      return withBase({
        id,
        type: "modal",
        props: {
          title: str(propsRaw.title, "\uBAA8\uB2EC"),
          ...(propsRaw.open === true ? { open: true } : {}),
        },
        ...(children ? { children } : {}),
      });
    }
    default:
      return null;
  }
}

function coerceScreen(raw: unknown, index: number): Screen | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = idStr(o.id, `scr-${index + 1}`);
  const name = str(o.name, `\uD654\uBA74 ${index + 1}`);
  const route = typeof o.route === "string" ? o.route : undefined;
  const layoutRaw = o.layout;
  const layout: Screen["layout"] | undefined =
    typeof layoutRaw === "string" && LAYOUTS.has(layoutRaw as Screen["layout"])
      ? (layoutRaw as Screen["layout"])
      : undefined;
  const nodesRaw = Array.isArray(o.nodes) ? o.nodes : [];
  const nodes: WireframeNode[] = [];
  nodesRaw.forEach((n, i) => {
    const node = coerceNode(n, `${id}-n${i + 1}`);
    if (node) nodes.push(node);
  });
  if (nodes.length === 0) {
    nodes.push({ id: `${id}-placeholder`, type: "text", props: { text: "(\uB0B4\uC6A9 \uC5C6\uC74C)", muted: true } });
  }
  return { id, name, ...(route ? { route } : {}), ...(layout ? { layout } : {}), nodes };
}

/** LLM/DB JSON\uC744 \uB290\uC2AC\uD558\uAC8C WireframeDoc\uC73C\uB85C \uB9DE\uCD98\uB2E4 (Zod \uBBF8\uC0AC\uC6A9). */
export function coerceWireframeDoc(raw: unknown): WireframeDoc {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const screensRaw = Array.isArray(root.screens) ? root.screens : [];
  const screens: Screen[] = [];
  for (let i = 0; i < screensRaw.length && screens.length < MAX_SCREENS; i++) {
    const s = coerceScreen(screensRaw[i], i);
    if (s) screens.push(s);
  }
  if (screens.length === 0) {
    screens.push({
      id: "scr-1",
      name: "\uD654\uBA74 1",
      nodes: [{ id: "n-1", type: "text", props: { text: "(\uB0B4\uC6A9 \uC5C6\uC74C)", muted: true } }],
    });
  }
  return { version: "1", screens };
}
