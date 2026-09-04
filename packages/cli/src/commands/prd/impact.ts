import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../../lib/config.js";
import { getProject, getRunPrdPath, getRunRoot, loadIndex } from "../../lib/runs.js";
import type { DomainSpec, ManifestSpec } from "../../pipeline/build-pipeline.js";
import type {
  ClarificationsFile,
  FeaturesDoc,
  FlowDoc,
} from "../../pipeline/build-docs.js";
import { computeImpact, type ImpactPreview } from "../../pipeline/impact-preview.js";
import {
  appendAnswersToPrd,
  loadClarificationsDoc,
  loadPendingAnswers,
  type PendingAnswerEntry,
  type ResolvedClarification,
} from "../../pipeline/prd-clarify.js";

/**
 * `wireframe prd impact --run-id slug` — what the staged change would touch, in business Korean.
 *
 * Read-only: it writes nothing and never runs the HTML renderer. See pipeline/impact-preview.ts
 * for how "affected" is decided.
 */

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")) as T;
  } catch {
    // A missing or hand-broken document reads as "nothing to compare against" — the preview
    // goes quiet rather than blocking the proposal the user is waiting on.
    return null;
  }
}

/** spec/pending-prd.json is written by the chat server; the CLI only ever reads it. */
type PendingPrdFile = { content?: unknown };

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The PRD that approving the staged answers would write.
 * Mirrors applyPrdAnswersCli: pre-filled decisions are corrected in place, new answers are
 * appended to 확인된 결정, and the 요청서 확정(네/아니요) answer is an approval, not a decision.
 */
export function prdWithStagedAnswers(
  prdContent: string,
  resolved: ResolvedClarification[],
  entries: PendingAnswerEntry[],
): string {
  let merged = prdContent;

  for (const entry of entries) {
    if (entry.target !== "override") continue;
    const item = resolved.find((candidate) => candidate.id === entry.id);
    if (!item) continue;
    const block = new RegExp(`(###\\s*Q\\.\\s*${escapeRe(item.question)}\\s*\\n\\s*\\n?A\\.\\s*)[^\\n]*`);
    merged = block.test(merged)
      ? merged.replace(block, `$1${entry.answer}`)
      : appendAnswersToPrd(merged, [{ question: item.question, answer: entry.answer }]);
  }

  const decisions = entries.filter(
    (entry) => entry.target === "open" && entry.topic !== "prd_ready",
  );
  if (decisions.length > 0) {
    merged = appendAnswersToPrd(
      merged,
      decisions.map((entry) => ({
        question: entry.question,
        answer: entry.overridesPrd
          ? `${entry.answer} — PRD에 적힌 내용보다 이 답을 우선(사용자 재확인)`
          : entry.answer,
      })),
    );
  }
  return `${merged.trimEnd()}\n`;
}

export type ImpactSource = "prd" | "answers" | "file" | "none";

export async function loadImpactPreview(
  config: WireframeConfig,
  input: { runId: string; projectSlug: string; source?: ImpactSource; prdFile?: string },
): Promise<{ ok: boolean; error?: string; source: ImpactSource; preview: ImpactPreview }> {
  const empty: ImpactPreview = {
    hasImpact: false,
    text: "",
    screens: [],
    features: [],
    flow: [],
    confirmed: false,
  };

  const index = await loadIndex(config);
  const project = getProject(index, input.projectSlug);
  const run = project.runs.find((entry) => entry.runId === input.runId);
  if (!run) return { ok: false, error: `run not found: ${input.runId}`, source: "none", preview: empty };

  const runRoot = getRunRoot(config, input.runId);
  const specDir = path.join(runRoot, "spec");
  const beforePrd = await safeRead(getRunPrdPath(config, input.runId, run.prdVersion));
  // No saved request yet — the first paste saves straight through, nothing to preview.
  if (beforePrd === null) return { ok: true, source: "none", preview: empty };

  let afterPrd: string | null = null;
  let source: ImpactSource = "none";

  if (input.prdFile) {
    afterPrd = await safeRead(input.prdFile);
    source = "file";
  }
  if (afterPrd === null && input.source !== "answers") {
    const staged = await readJson<PendingPrdFile>(path.join(specDir, "pending-prd.json"));
    if (staged && typeof staged.content === "string" && staged.content.trim()) {
      afterPrd = staged.content;
      source = "prd";
    }
  }
  if (afterPrd === null && input.source !== "prd") {
    const { doc } = await loadPendingAnswers(config, input.runId);
    if (doc && doc.entries.length > 0) {
      const clarifications = await loadClarificationsDoc(config, input.runId);
      afterPrd = prdWithStagedAnswers(beforePrd, clarifications.resolved, doc.entries);
      source = "answers";
    }
  }
  if (afterPrd === null) return { ok: true, source: "none", preview: empty };

  const preview = computeImpact({
    runId: input.runId,
    run: { no: run.no, title: run.title, prdPath: run.prdPath, status: run.status },
    projectSlug: input.projectSlug,
    assetProjectSlug: run.assetProjectSlug ?? input.projectSlug,
    beforePrd,
    afterPrd,
    domain: await readJson<DomainSpec>(path.join(specDir, "domain.json")),
    manifest: await readJson<ManifestSpec>(path.join(specDir, "manifest.json")),
    features: await readJson<FeaturesDoc>(path.join(specDir, "features.json")),
    flow: await readJson<FlowDoc>(path.join(specDir, "flow.json")),
    clarifications: await readJson<NonNullable<ClarificationsFile>>(
      path.join(specDir, "clarifications.json"),
    ),
  });

  return { ok: true, source, preview };
}

async function safeRead(file: string): Promise<string | null> {
  if (!file) return null;
  try {
    return (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

export async function prdImpactCli(config: WireframeConfig, args: string[]): Promise<void> {
  const runId = readFlag(args, "--run-id")?.trim();
  if (!runId) {
    throw new Error("usage: wireframe prd impact --run-id slug [--project crm] [--source prd|answers] [--prd ./file.md]");
  }
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const sourceFlag = readFlag(args, "--source")?.trim();
  const source =
    sourceFlag === "prd" || sourceFlag === "answers" ? (sourceFlag as ImpactSource) : undefined;

  const result = await loadImpactPreview(config, {
    runId,
    projectSlug,
    source,
    prdFile: readFlag(args, "--prd")?.trim(),
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        runId,
        source: result.source,
        hasImpact: result.preview.hasImpact,
        // The exact text a non-developer should see. Relay it verbatim.
        impactPreview: result.preview.text,
        screens: result.preview.screens,
        features: result.preview.features,
        flow: result.preview.flow,
        confirmed: result.preview.confirmed,
        ...(result.preview.reason ? { reason: result.preview.reason } : {}),
      },
      null,
      2,
    ),
  );
}
