/**
 * Claude에게 넘기는 도구 입력 스키마 — §13.2.
 *
 * 왜 Zod에서 자동 변환하지 않는가: IR 스키마는 z.lazy 재귀 + superRefine을 쓰므로
 * JSON Schema로 기계 변환하면 재귀와 의미 규칙이 온전히 넘어가지 않는다.
 * 여기서는 **형태를 강제하는 얕은 스키마**만 주고, 실제 검증은 서버의 Zod가 한다.
 * 스키마 강제는 형태를 보장할 뿐이고 의미 규칙(id 유일성, navigate 참조 무결성)은
 * 어차피 Zod refine의 몫이다. 불일치는 1회 재시도로 흡수한다 (§13.3).
 */

const NODE_TYPES = [
  "heading", "text", "button", "input", "select", "checkbox", "image", "divider",
  "table", "list", "nav", "sidebar", "tabs", "header", "card", "container", "modal",
] as const;

const actionSchema = {
  type: "object",
  description:
    "클릭 동작. navigate는 targetScreenId(다른 화면 id), openModal은 targetNodeId(같은 화면의 modal 노드 id)가 필요하다.",
  properties: {
    type: { type: "string", enum: ["navigate", "openModal", "closeModal"] },
    targetScreenId: { type: "string" },
    targetNodeId: { type: "string" },
  },
  required: ["type"],
} as const;

/**
 * 노드는 재귀 구조지만 도구 스키마에서는 2단계까지만 명시한다.
 * 더 깊은 중첩도 모델은 만들어내며, Zod가 전체 깊이를 검증한다.
 */
const nodeShape = (depth: number): Record<string, unknown> => {
  const shape: Record<string, unknown> = {
    type: "object",
    properties: {
      id: { type: "string", description: "화면 안에서 유일한 kebab-case id" },
      type: { type: "string", enum: NODE_TYPES },
      gridSpan: { type: "integer", minimum: 1, maximum: 12 },
      action: actionSchema,
      props: {
        type: "object",
        description:
          "노드 타입별 속성. heading:{text,level} text:{text,muted} button:{label,variant} input:{label,placeholder,inputType} select:{label,options[]} checkbox:{label,checked} table:{columns[],sampleRows[][]} list:{items[]} nav/sidebar:{items:[{label,action}]} tabs:{tabs[],activeIndex} header:{title,subtitle} card:{title} container:{direction} modal:{title,open}",
      },
    },
    required: ["id", "type"],
  };
  if (depth > 0) {
    (shape.properties as Record<string, unknown>).children = {
      type: "array",
      description: "container/card/header/tabs/modal이 품는 하위 노드",
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
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "문서 안에서 유일. 예: scr-order-list" },
            name: { type: "string", description: "사람이 읽는 화면 이름" },
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
