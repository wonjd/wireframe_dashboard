import { z } from "zod";

/**
 * 와이어프레임 IR (중간 표현) — 스펙 §5.
 *
 * LLM은 HTML이 아니라 이 JSON을 만든다. 렌더러가 이것을 React로 그린다.
 * Zod 스키마가 단일 소스이고, TS 타입은 여기서 함께 도출한다.
 */

const idSchema = z.string().min(1).max(64);

/** 클릭 동작 — 렌더러에 화이트리스트된 것만 실행된다 (§5.4). */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), targetScreenId: idSchema }),
  z.object({ type: z.literal("openModal"), targetNodeId: idSchema }),
  z.object({ type: z.literal("closeModal") }),
]);

export type Action = z.infer<typeof actionSchema>;

export type NavItem = { label: string; action?: Action };

/**
 * 노드는 discriminated union.
 * children을 갖는 타입이 재귀적이므로 타입을 먼저 선언하고 스키마를 z.lazy로 묶는다.
 */
export type WireframeNode =
  | { id: string; type: "heading"; gridSpan?: number; action?: Action; props: { text: string; level?: 1 | 2 | 3 } }
  | { id: string; type: "text"; gridSpan?: number; action?: Action; props: { text: string; muted?: boolean } }
  | { id: string; type: "button"; gridSpan?: number; action?: Action; props: { label: string; variant?: "primary" | "secondary" | "danger" } }
  | { id: string; type: "input"; gridSpan?: number; action?: Action; props: { label?: string; placeholder?: string; inputType?: "text" | "number" | "date" | "password" } }
  | { id: string; type: "select"; gridSpan?: number; action?: Action; props: { label?: string; options: string[] } }
  | { id: string; type: "checkbox"; gridSpan?: number; action?: Action; props: { label: string; checked?: boolean } }
  | { id: string; type: "image"; gridSpan?: number; action?: Action; props?: { label?: string; ratio?: "square" | "wide" } }
  | { id: string; type: "divider"; gridSpan?: number; action?: Action }
  | { id: string; type: "table"; gridSpan?: number; action?: Action; props: { columns: string[]; sampleRows?: string[][] } }
  | { id: string; type: "list"; gridSpan?: number; action?: Action; props: { items: string[] } }
  | { id: string; type: "nav"; gridSpan?: number; action?: Action; props: { items: NavItem[] } }
  | { id: string; type: "sidebar"; gridSpan?: number; action?: Action; props: { items: NavItem[] } }
  | { id: string; type: "tabs"; gridSpan?: number; action?: Action; props: { tabs: string[]; activeIndex?: number }; children?: WireframeNode[] }
  | { id: string; type: "header"; gridSpan?: number; action?: Action; props: { title: string; subtitle?: string }; children?: WireframeNode[] }
  | { id: string; type: "card"; gridSpan?: number; action?: Action; props?: { title?: string }; children?: WireframeNode[] }
  | { id: string; type: "container"; gridSpan?: number; action?: Action; props?: { direction?: "row" | "column" }; children?: WireframeNode[] }
  | { id: string; type: "modal"; gridSpan?: number; action?: Action; props: { title: string; open?: boolean }; children?: WireframeNode[] };

export type NodeType = WireframeNode["type"];

const navItemSchema: z.ZodType<NavItem> = z.object({
  label: z.string().min(1),
  action: actionSchema.optional(),
});

const baseFields = {
  id: idSchema,
  /** 12컬럼 그리드에서 차지하는 폭 (§5.3) */
  gridSpan: z.number().int().min(1).max(12).optional(),
  action: actionSchema.optional(),
};

export const nodeSchema: z.ZodType<WireframeNode> = z.lazy(
  () =>
    z.discriminatedUnion("type", [
      z.object({ ...baseFields, type: z.literal("heading"), props: z.object({ text: z.string().min(1), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }) }),
      z.object({ ...baseFields, type: z.literal("text"), props: z.object({ text: z.string(), muted: z.boolean().optional() }) }),
      z.object({ ...baseFields, type: z.literal("button"), props: z.object({ label: z.string().min(1), variant: z.enum(["primary", "secondary", "danger"]).optional() }) }),
      z.object({ ...baseFields, type: z.literal("input"), props: z.object({ label: z.string().optional(), placeholder: z.string().optional(), inputType: z.enum(["text", "number", "date", "password"]).optional() }) }),
      z.object({ ...baseFields, type: z.literal("select"), props: z.object({ label: z.string().optional(), options: z.array(z.string()).min(1) }) }),
      z.object({ ...baseFields, type: z.literal("checkbox"), props: z.object({ label: z.string().min(1), checked: z.boolean().optional() }) }),
      z.object({ ...baseFields, type: z.literal("image"), props: z.object({ label: z.string().optional(), ratio: z.enum(["square", "wide"]).optional() }).optional() }),
      z.object({ ...baseFields, type: z.literal("divider") }),
      z.object({ ...baseFields, type: z.literal("table"), props: z.object({ columns: z.array(z.string()).min(1), sampleRows: z.array(z.array(z.string())).optional() }) }),
      z.object({ ...baseFields, type: z.literal("list"), props: z.object({ items: z.array(z.string()) }) }),
      z.object({ ...baseFields, type: z.literal("nav"), props: z.object({ items: z.array(navItemSchema) }) }),
      z.object({ ...baseFields, type: z.literal("sidebar"), props: z.object({ items: z.array(navItemSchema) }) }),
      z.object({ ...baseFields, type: z.literal("tabs"), props: z.object({ tabs: z.array(z.string()).min(1), activeIndex: z.number().int().min(0).optional() }), children: z.array(nodeSchema).optional() }),
      z.object({ ...baseFields, type: z.literal("header"), props: z.object({ title: z.string().min(1), subtitle: z.string().optional() }), children: z.array(nodeSchema).optional() }),
      z.object({ ...baseFields, type: z.literal("card"), props: z.object({ title: z.string().optional() }).optional(), children: z.array(nodeSchema).optional() }),
      z.object({ ...baseFields, type: z.literal("container"), props: z.object({ direction: z.enum(["row", "column"]).optional() }).optional(), children: z.array(nodeSchema).optional() }),
      z.object({ ...baseFields, type: z.literal("modal"), props: z.object({ title: z.string().min(1), open: z.boolean().optional() }), children: z.array(nodeSchema).optional() }),
    ]) as unknown as z.ZodType<WireframeNode>
);

export const screenSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  route: z.string().optional(),
  layout: z.enum(["plain", "sidebar-left", "topnav"]).optional(),
  nodes: z.array(nodeSchema),
});

export type Screen = z.infer<typeof screenSchema>;

/** 노드 트리를 깊이 우선으로 순회하며 노드와 그 안의 Action을 모은다. */
export function walkNodes(nodes: WireframeNode[], visit: (n: WireframeNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if ("children" in n && n.children) walkNodes(n.children, visit);
  }
}

/** 노드 자신과 nav/sidebar 항목에 달린 Action을 모두 모은다. */
export function collectActions(nodes: WireframeNode[]): Action[] {
  const out: Action[] = [];
  walkNodes(nodes, (n) => {
    if (n.action) out.push(n.action);
    if ((n.type === "nav" || n.type === "sidebar") && n.props?.items) {
      for (const item of n.props.items) if (item.action) out.push(item.action);
    }
  });
  return out;
}

/**
 * 최상위 문서. docJson 컬럼에 직렬화되어 저장된다.
 *
 * superRefine으로 의미 규칙을 검증한다 — 형태(스키마)만 맞고 의미가 깨진 문서를
 * 저장하면 렌더러에서 죽은 클릭이 된다. 저장 전에 막는 것이 §13.2의 요지다.
 */
export const wireframeDocSchema = z
  .object({
    version: z.literal("1"),
    screens: z.array(screenSchema).min(1).max(20),
  })
  .superRefine((doc, ctx) => {
    const screenIds = new Set<string>();
    for (const s of doc.screens) {
      if (screenIds.has(s.id)) {
        ctx.addIssue({ code: "custom", message: `screen id 중복: ${s.id}` });
      }
      screenIds.add(s.id);
    }

    for (const s of doc.screens) {
      const nodeIds = new Set<string>();
      walkNodes(s.nodes, (n) => {
        if (nodeIds.has(n.id)) {
          ctx.addIssue({ code: "custom", message: `화면 "${s.id}" 안에서 node id 중복: ${n.id}` });
        }
        nodeIds.add(n.id);
      });

      for (const a of collectActions(s.nodes)) {
        if (a.type === "navigate" && !screenIds.has(a.targetScreenId)) {
          ctx.addIssue({
            code: "custom",
            message: `화면 "${s.id}": 존재하지 않는 화면으로 navigate — ${a.targetScreenId}`,
          });
        }
        if (a.type === "openModal" && !nodeIds.has(a.targetNodeId)) {
          ctx.addIssue({
            code: "custom",
            message: `화면 "${s.id}": 같은 화면에 없는 노드를 openModal — ${a.targetNodeId}`,
          });
        }
      }
    }
  });

export type WireframeDoc = z.infer<typeof wireframeDocSchema>;
