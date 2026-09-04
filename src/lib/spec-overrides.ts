import type { FeatureGroup, FeatureImportance, FeaturesDoc } from "../components/FeatureMap";
import type { FlowDoc, FlowEdge } from "../components/UserFlow";

/**
 * User-owned edits layered over the generated run documents.
 *
 * features.json / flow.json are regenerated from the PRD on every build, so renames,
 * importance changes and hidden nodes live apart in wireFrame/runs/<runId>/spec/
 * overrides.json (patch-by-id, so unknown ids are ignored after a regeneration) and are
 * merged in at read time — here for the canvas, and in the CLI for the static artifacts.
 *
 * MIRROR: packages/cli/src/pipeline/spec-overrides.ts implements the same rules for
 * `run build` / `render` (the CLI compiles standalone with rootDir "src", so the file
 * cannot be shared). Any rule change here must be made there too, or this canvas and the
 * 00-spec / 00-flow handoff documents will disagree. The CLI merges both documents in one
 * `applyOverrides` call; the canvas loads them independently, so the two halves
 * (applyFeatureOverrides / applyFlowOverrides) are exported separately here.
 */

export type NodeOverride = {
  /** replacement label; blank/absent keeps the generated one */
  label?: string;
  /** features only — flow nodes carry no importance */
  importance?: FeatureImportance;
  /** true removes the node from rendered output */
  hidden?: boolean;
};

export type SpecOverrides = {
  runId?: string;
  /** keyed by feature group no ("2") or child no ("2.1") */
  features?: Record<string, NodeOverride>;
  /** keyed by flow node id ("step-4-image-guide") */
  flow?: Record<string, NodeOverride>;
  updatedAt?: string;
};

export const EMPTY_OVERRIDES: SpecOverrides = { features: {}, flow: {} };

export function isEmptyPatch(patch: NodeOverride | undefined): boolean {
  return !patch || Object.keys(patch).length === 0;
}

/**
 * Apply one edit to the document, dropping keys that carry no edit so a reverted field
 * disappears instead of piling up as `{ label: undefined }`.
 */
export function withPatch(
  overrides: SpecOverrides,
  kind: "features" | "flow",
  id: string,
  patch: NodeOverride,
): SpecOverrides {
  const map = { ...(overrides[kind] ?? {}) };
  const next: NodeOverride = { ...(map[id] ?? {}), ...patch };
  if (next.label !== undefined && next.label.trim().length === 0) delete next.label;
  if (next.hidden === false) delete next.hidden;
  if (isEmptyPatch(next)) delete map[id];
  else map[id] = next;
  return { ...overrides, [kind]: map };
}

function mergeFeatureNode<T extends { label: string; importance?: FeatureImportance }>(
  node: T,
  patch: NodeOverride | undefined,
): T {
  if (!patch) return node;
  return {
    ...node,
    ...(patch.label ? { label: patch.label } : {}),
    ...(patch.importance ? { importance: patch.importance } : {}),
  };
}

export function applyFeatureOverrides(
  doc: FeaturesDoc,
  patches: Record<string, NodeOverride>,
): FeaturesDoc {
  if (Object.keys(patches).length === 0) return doc;
  const groups: FeatureGroup[] = [];
  for (const group of doc.groups ?? []) {
    const groupPatch = patches[group.no];
    if (groupPatch?.hidden) continue; // hiding a group hides its children with it
    const children = (group.children ?? [])
      .filter((child) => !patches[child.no]?.hidden)
      .map((child) => mergeFeatureNode(child, patches[child.no]));
    groups.push({ ...mergeFeatureNode(group, groupPatch), children });
  }
  return { ...doc, groups };
}

/**
 * Drop one node and keep the graph connected: every predecessor is rewired to every
 * successor, so hiding a middle step shortens the path instead of orphaning what came
 * after it. The bypass edge keeps the incoming condition (the branch decision is made at
 * the predecessor), falling back to the outgoing one. Self-loops and duplicates dropped.
 */
function bypassNode(edges: FlowEdge[], id: string): FlowEdge[] {
  const incoming = edges.filter((edge) => edge.to === id && edge.from !== id);
  const outgoing = edges.filter((edge) => edge.from === id && edge.to !== id);
  const kept = edges.filter((edge) => edge.from !== id && edge.to !== id);
  for (const inEdge of incoming) {
    for (const outEdge of outgoing) {
      if (inEdge.from === outEdge.to) continue;
      const condition = inEdge.condition ?? outEdge.condition ?? null;
      const exists = kept.some(
        (edge) =>
          edge.from === inEdge.from && edge.to === outEdge.to && edge.condition === condition,
      );
      if (exists) continue;
      kept.push({ from: inEdge.from, to: outEdge.to, condition });
    }
  }
  return kept;
}

export function applyFlowOverrides(
  doc: FlowDoc,
  patches: Record<string, NodeOverride>,
): FlowDoc {
  if (Object.keys(patches).length === 0) return doc;

  const nodes: NonNullable<FlowDoc["nodes"]> = [];
  const hidden: string[] = [];
  for (const node of doc.nodes ?? []) {
    const patch = patches[node.id];
    if (patch?.hidden) {
      hidden.push(node.id);
      continue;
    }
    nodes.push(patch?.label ? { ...node, label: patch.label } : node);
  }
  if (hidden.length === 0) return { ...doc, nodes };

  // One node at a time, so a hidden chain collapses into a single bypass.
  let edges = doc.edges ?? [];
  for (const id of hidden) edges = bypassNode(edges, id);

  const liveLanes = new Set(nodes.map((node) => node.lane));
  return {
    ...doc,
    lanes: (doc.lanes ?? []).filter((lane) => liveLanes.has(lane.id)),
    nodes,
    edges,
  };
}

/* ------------------------------------------------------------------ */
/* transport                                                          */
/* ------------------------------------------------------------------ */

function overridesUrl(runId: string, project: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/overrides?project=${encodeURIComponent(project)}`;
}

export async function fetchOverrides(runId: string, project: string): Promise<SpecOverrides> {
  const res = await fetch(overridesUrl(runId, project));
  if (!res.ok) throw new Error(`overrides load failed (${res.status})`);
  const json = (await res.json()) as { ok?: boolean; overrides?: SpecOverrides };
  if (json.ok === false) throw new Error("overrides load failed");
  return {
    features: json.overrides?.features ?? {},
    flow: json.overrides?.flow ?? {},
  };
}

export async function putOverrides(
  runId: string,
  project: string,
  overrides: SpecOverrides,
): Promise<void> {
  const res = await fetch(overridesUrl(runId, project), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      features: overrides.features ?? {},
      flow: overrides.flow ?? {},
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `overrides save failed (${res.status})`);
  }
}
