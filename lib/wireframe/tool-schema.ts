import { MAX_SCREENS } from "../constants";

/**
 * Cursor 에이전트 도구 입력 스키마 — §13.2.
 * 형태만 강제하고, 의미 검증은 서버 coerce/렌더러가 처리한다.
 */

const NODE_TYPES = [
  "heading", "text", "button", "input", "select", "checkbox", "image", "divider",
  "table", "list", "nav", "sidebar", "tabs", "header", "card", "container", "modal",
] as const;

const actionSchema = {
  type: "object",
  description:
    "클릭 동작. navigate는 targetScreenId, openModal은 targetNodeId가 필요하다.",
  properties: {
    type: { type: "string", enum: ["navigate", "openModal", "closeModal"] },
    targetScreenId: { type: "string" },
    targetNodeId: { type: "string" },
  },
  required: ["type"],
} as const;

const nodeShape = (depth: number): Record<string, unknown> => {
  const shape: Record<string, unknown> = {
    type: "object",
    properties: {
      id: { type: "string", description: "화면 안에서 유일한 kebab-case id" },
      type: { type: "string", enum: NODE_TYPES },
      gridSpan: { type: "integer", minimum: 1, maximum: 12 },
      action: actionSchema,
      props: { type: "object" },
    },
    required: ["id", "type"],
  };
  if (depth > 0) {
    (shape.properties as Record<string, unknown>).children = {
      type: "array",
      items: nodeShape(depth - 1),
    };
  }
  return shape;
};

export const EMIT_TOOL = {
  name: "emit_wireframe",
  description: "완성된 와이어프레임 IR을 넘긴다. 반드시 이 도구로만 응답한다.",
  input_schema: {
    type: "object" as const,
    properties: {
      version: { type: "string", enum: ["1"] },
      screens: {
        type: "array",
        minItems: 1,
        maxItems: MAX_SCREENS,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            route: { type: "string" },
            layout: { type: "string", enum: ["plain", "sidebar-left", "topnav"] },
            nodes: { type: "array", items: nodeShape(4) },
          },
          required: ["id", "name", "nodes"],
        },
      },
    },
    required: ["version", "screens"],
  },
};
