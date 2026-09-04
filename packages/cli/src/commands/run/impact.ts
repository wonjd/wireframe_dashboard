import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../../lib/config.js";
import { getProject, getRunRoot, loadIndex } from "../../lib/runs.js";
import type { ManifestSpec } from "../../pipeline/build-pipeline.js";
import type { FeaturesDoc, FlowDoc } from "../../pipeline/build-docs.js";
import { businessName, screenName, type ImpactItem } from "../../pipeline/impact-preview.js";
import {
  resolveCascade,
  type NodeOverride,
  type SpecOverrides,
} from "../../pipeline/spec-overrides.js";

/**
 * `wireframe run impact --run-id slug --hide flow:step-2,features:2.1 [--rename flow:step-1=새 이름]`
 *
 * What a wireframe/flow/feature edit would touch — the deterministic trigger (resolveCascade)
 * rendered in business Korean, read-only. This is the backend the chat agent calls to explain
 * "이걸 빼면 A·B가 함께 사라집니다" before the user consents. It writes nothing and never runs
 * the HTML renderer; applying the edit is a separate step (overrides save + rebuild).
 */

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

/** Parse `flow:step-2,features:2.1` into a patch map per kind. */
function parseTargets(raw: string | undefined): {
  flow: Record<string, NodeOverride>;
  features: Record<string, NodeOverride>;
} {
  const flow: Record<string, NodeOverride> = {};
  const features: Record<string, NodeOverride> = {};
  for (const token of (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
    const [kind, id] = token.split(":");
    if (kind === "flow" && id) flow[id] = { hidden: true };
    else if (kind === "features" && id) features[id] = { hidden: true };
  }
  return { flow, features };
}

/** Parse `flow:step-1=새 이름` rename targets, merged onto the hide patch maps. */
function applyRenames(
  raw: string | undefined,
  flow: Record<string, NodeOverride>,
  features: Record<string, NodeOverride>,
): void {
  for (const token of (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
    const eq = token.indexOf("=");
    if (eq < 0) continue;
    const target = token.slice(0, eq);
    const label = token.slice(eq + 1).trim();
    const [kind, id] = target.split(":");
    if (!label || !id) continue;
    if (kind === "flow") flow[id] = { ...flow[id], label };
    else if (kind === "features") features[id] = { ...features[id], label };
  }
}

export type EditImpact = {
  hasImpact: boolean;
  text: string;
  screens: ImpactItem[];
  features: ImpactItem[];
  flow: ImpactItem[];
};

/** Deterministic: cascade → business-language impact. No files written, no LLM. */
export function computeEditImpact(input: {
  features: FeaturesDoc;
  flow: FlowDoc;
  manifest: ManifestSpec;
  overrides: SpecOverrides;
}): EditImpact {
  const cascade = resolveCascade({
    flow: input.flow,
    features: input.features,
    manifest: input.manifest,
    overrides: input.overrides,
  });

  const screens: ImpactItem[] = [];
  for (const id of cascade.artifactHidden) {
    const artifact = input.manifest.artifacts.find((entry) => entry.id === id);
    if (!artifact) continue;
    screens.push({ text: screenName(artifact.label, artifact.no), note: "없어지는 화면" });
  }

  const featureItems: ImpactItem[] = [];
  for (const no of cascade.featureHidden) {
    let label: string | undefined;
    for (const group of input.features.groups) {
      if (group.no === no) label = group.label;
      const child = group.children.find((entry) => entry.no === no);
      if (child) label = child.label;
      if (label) break;
    }
    if (label) featureItems.push({ text: businessName(label, "기능 항목"), note: "빠지는 기능" });
  }

  const flowItems: ImpactItem[] = [];
  for (const id of cascade.flowHidden) {
    const node = input.flow.nodes.find((entry) => entry.id === id);
    if (node) flowItems.push({ text: businessName(node.label, "흐름 단계"), note: "빠지는 흐름" });
  }

  const renamed = [...cascade.renameArtifact.entries()].map(([id, label]) => {
    const artifact = input.manifest.artifacts.find((entry) => entry.id === id);
    return artifact ? { text: `${businessName(label, `${artifact.no}단계`)} (이름 변경)`, note: "이름이 바뀌는 화면" } : null;
  });
  for (const item of renamed) if (item) screens.push(item);

  const hasImpact = screens.length + featureItems.length + flowItems.length > 0;

  const lines: string[] = [];
  if (hasImpact) {
    lines.push("이 편집을 적용하면 아래가 화면·문서에서 함께 바뀝니다:");
    if (screens.length) lines.push(`- 와이어프레임: ${screens.map((s) => s.text).join(", ")}`);
    if (featureItems.length) lines.push(`- 기능명세서: ${featureItems.map((s) => s.text).join(", ")}`);
    if (flowItems.length) lines.push(`- 유저플로우: ${flowItems.map((s) => s.text).join(", ")}`);
  }

  return { hasImpact, text: lines.join("\n"), screens, features: featureItems, flow: flowItems };
}

export async function runImpactCli(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error(
      'usage: wireframe run impact --run-id slug [--project crm] --hide flow:step-2,features:2.1 [--rename flow:step-1="새 이름"]',
    );
  }
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const index = await loadIndex(config);
  const project = getProject(index, projectSlug);
  const run = project.runs.find((entry) => entry.runId === runId);
  if (!run) throw new Error(`run not found: ${runId} (project ${projectSlug})`);

  const { flow, features } = parseTargets(readFlag(args, "--hide"));
  applyRenames(readFlag(args, "--rename"), flow, features);

  const specDir = path.join(getRunRoot(config, runId), "spec");
  const featuresDoc = await readJson<FeaturesDoc>(path.join(specDir, "features.json"));
  const flowDoc = await readJson<FlowDoc>(path.join(specDir, "flow.json"));
  const manifest = await readJson<ManifestSpec>(path.join(specDir, "manifest.json"));

  if (!featuresDoc || !flowDoc || !manifest) {
    console.log(
      JSON.stringify(
        { ok: true, runId, hasImpact: false, reason: "not-built", text: "", screens: [], features: [], flow: [] },
        null,
        2,
      ),
    );
    return;
  }

  const impact = computeEditImpact({
    features: featuresDoc,
    flow: flowDoc,
    manifest,
    overrides: { runId, flow, features },
  });

  console.log(JSON.stringify({ ok: true, runId, ...impact }, null, 2));
}
