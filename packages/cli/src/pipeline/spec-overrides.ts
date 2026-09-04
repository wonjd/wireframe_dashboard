import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FeatureChild, FeatureGroup, FeatureImportance, FeaturesDoc, FlowDoc } from "./build-docs.js";

/**
 * User-owned edits layered over the generated run documents.
 *
 * features.json / flow.json are regenerated from the PRD on every build, so a rename
 * written back into them would be destroyed by the next run (the same trap manifest.json
 * fell into by mixing generated artifacts with `locked`/`instructions[]` state). Instead
 * the edits live alone in spec/overrides.json, keyed by feature `no` / flow node `id`,
 * and are merged in at READ time — here for the static artifacts, and in
 * `src/lib/spec-overrides.ts` for the React canvas.
 *
 * MIRROR: `src/lib/spec-overrides.ts` implements the same rules for the browser (the CLI
 * compiles standalone under packages/cli/tsconfig.json with rootDir "src", so the file
 * cannot be shared). Any rule change here must be made there too, or the canvas and the
 * handoff document will disagree.
 *
 * The build never writes this file. Unknown ids are ignored silently so a patch survives
 * regeneration; a missing or corrupt file means "no overrides", never a failed build.
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

const IMPORTANCES: FeatureImportance[] = ["high", "medium", "low"];

/** Longest label a node card can carry; anything past it is user error, not intent. */
export const MAX_LABEL_LENGTH = 200;
/** Guard against an overrides file that grew into a data dump. */
export const MAX_PATCH_ENTRIES = 500;

function sanitizePatch(raw: unknown): NodeOverride | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const patch: NodeOverride = {};
  if (typeof source.label === "string" && source.label.trim().length > 0) {
    patch.label = source.label.trim().slice(0, MAX_LABEL_LENGTH);
  }
  if (
    typeof source.importance === "string" &&
    IMPORTANCES.includes(source.importance as FeatureImportance)
  ) {
    patch.importance = source.importance as FeatureImportance;
  }
  if (typeof source.hidden === "boolean") patch.hidden = source.hidden;
  return Object.keys(patch).length > 0 ? patch : null;
}

function sanitizePatchMap(raw: unknown): Record<string, NodeOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, NodeOverride> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || count >= MAX_PATCH_ENTRIES) continue;
    const patch = sanitizePatch(value);
    if (!patch) continue;
    out[key] = patch;
    count += 1;
  }
  return out;
}

/** Tolerant reader: anything unrecognized is dropped, never thrown. */
export function parseOverrides(raw: unknown): SpecOverrides | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const features = sanitizePatchMap(source.features);
  const flow = sanitizePatchMap(source.flow);
  if (Object.keys(features).length === 0 && Object.keys(flow).length === 0) return null;
  return {
    runId: typeof source.runId === "string" ? source.runId : undefined,
    features,
    flow,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : undefined,
  };
}

export function overridesPath(specDir: string): string {
  return path.join(specDir, "overrides.json");
}

/** Read spec/overrides.json if it exists. Missing or corrupt file → null. */
export async function loadOverrides(specDir: string): Promise<SpecOverrides | null> {
  try {
    return parseOverrides(JSON.parse(await readFile(overridesPath(specDir), "utf8")));
  } catch {
    return null;
  }
}

function mergeFeatureNode<T extends { label: string; importance: FeatureImportance }>(
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
  for (const group of doc.groups) {
    const groupPatch = patches[group.no];
    if (groupPatch?.hidden) continue; // hiding a group hides its children with it
    const children: FeatureChild[] = [];
    for (const child of group.children) {
      const childPatch = patches[child.no];
      if (childPatch?.hidden) continue;
      children.push(mergeFeatureNode(child, childPatch));
    }
    groups.push({ ...mergeFeatureNode(group, groupPatch), children });
  }
  return { ...doc, groups };
}

/**
 * Drop one node and keep the graph connected: every predecessor is rewired to every
 * successor, so hiding a middle step shortens the path instead of orphaning what came
 * after it. The bypass edge keeps the incoming condition (the branch decision is made at
 * the predecessor); it falls back to the outgoing one when the incoming edge is
 * unconditional. Self-loops and duplicates are dropped.
 */
function bypassNode(edges: FlowDoc["edges"], id: string): FlowDoc["edges"] {
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

  const nodes: FlowDoc["nodes"] = [];
  const hidden: string[] = [];
  for (const node of doc.nodes) {
    const patch = patches[node.id];
    if (patch?.hidden) {
      hidden.push(node.id);
      continue;
    }
    nodes.push(patch?.label ? { ...node, label: patch.label } : node);
  }
  if (hidden.length === 0) return { ...doc, nodes };

  // One node at a time, so a hidden chain collapses into a single bypass.
  let edges = doc.edges;
  for (const id of hidden) edges = bypassNode(edges, id);

  const liveLanes = new Set(nodes.map((node) => node.lane));
  return {
    ...doc,
    lanes: doc.lanes.filter((lane) => liveLanes.has(lane.id)),
    nodes,
    edges,
  };
}

/** generated ∪ overrides — the one place the merge is defined for the CLI. */
export function applyOverrides(
  features: FeaturesDoc,
  flow: FlowDoc,
  overrides: SpecOverrides | null,
): { features: FeaturesDoc; flow: FlowDoc } {
  if (!overrides) return { features, flow };
  return {
    features: applyFeatureOverrides(features, overrides.features ?? {}),
    flow: applyFlowOverrides(flow, overrides.flow ?? {}),
  };
}
