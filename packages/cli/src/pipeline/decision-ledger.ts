import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WireframeConfig } from "../lib/config.js";
import { resolveFromRepo } from "../lib/config.js";
import { getRunRoot, loadIndex } from "../lib/runs.js";

/**
 * Cross-run memory. Every answered clarification lands here, keyed by topic.
 * Append-only: when the same topic is decided again with a different answer we keep BOTH
 * entries (history matters) and treat the newest as current. Entries are never deleted.
 */
export type LedgerDecision = {
  topic: string;
  question: string;
  answer: string;
  decidedAt: string;
  byRun: string;
  byRunNo?: string;
};

export type DecisionLedger = {
  projectSlug: string;
  decisions: LedgerDecision[];
  updatedAt: string;
};

function ledgerPath(projectSlug: string): string {
  return resolveFromRepo(path.join("projects", projectSlug, "decisions.json"));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function emptyLedger(projectSlug: string): DecisionLedger {
  return { projectSlug, decisions: [], updatedAt: new Date().toISOString() };
}

/** Safe when the file does not exist yet (or is corrupt) — returns an empty ledger. */
export async function loadDecisionLedger(projectSlug: string): Promise<DecisionLedger> {
  const file = ledgerPath(projectSlug);
  if (!(await pathExists(file))) return emptyLedger(projectSlug);
  try {
    const raw = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Partial<DecisionLedger>;
    return {
      projectSlug,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptyLedger(projectSlug);
  }
}

/** Newest entry per topic (append order wins) — the "current" decision. */
export function currentLedgerAnswers(ledger: DecisionLedger): Map<string, LedgerDecision> {
  const current = new Map<string, LedgerDecision>();
  for (const decision of ledger.decisions) {
    if (!decision.topic || !decision.answer?.trim()) continue;
    current.set(decision.topic, decision);
  }
  return current;
}

/**
 * Append newly decided topics. A repeat of the current answer for a topic is skipped
 * (re-reviews must not grow the file); a *different* answer is appended, never replaced.
 */
export async function recordDecisions(
  projectSlug: string,
  entries: Array<{ topic: string; question: string; answer: string; byRun: string; byRunNo?: string }>,
): Promise<DecisionLedger> {
  const ledger = await loadDecisionLedger(projectSlug);
  const current = currentLedgerAnswers(ledger);
  let changed = false;

  for (const entry of entries) {
    const topic = entry.topic?.trim();
    const answer = entry.answer?.trim();
    if (!topic || !answer) continue;
    const existing = current.get(topic);
    if (existing && existing.answer.trim() === answer) continue;
    const decision: LedgerDecision = {
      topic,
      question: entry.question,
      answer,
      decidedAt: new Date().toISOString(),
      byRun: entry.byRun,
      byRunNo: entry.byRunNo,
    };
    ledger.decisions.push(decision);
    current.set(topic, decision);
    changed = true;
  }

  if (changed) {
    ledger.updatedAt = new Date().toISOString();
    const file = ledgerPath(projectSlug);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }
  return ledger;
}

/** Business-language topic labels for user-facing notices. Keep in sync with server/prd-tools.ts. */
const TOPIC_LABEL_KO: Record<string, string> = {
  who_does: "작성·승인 담당",
  new_or_change: "기존/새 화면 여부",
  screen_layout: "화면 형태",
  required_optional: "필수·선택 항목",
  choice_values: "선택지 문구",
  conditional_fields: "조건부 입력",
  attach_method: "참고 자료 전달 방식",
  limits: "글자·항목 제한",
  after_submit: "제출 후 진행",
  edit_rules: "제출 후 수정 규칙",
  privacy: "개인정보 표시",
  done_when: "완료 기준",
  prd_ready: "요청서 확정",
  other: "기타",
};

export function topicLabelKo(topic: string): string {
  return TOPIC_LABEL_KO[topic] ?? topic;
}

/** Plain-Korean notice the chat agent must relay ONCE — 감지는 자동, 판단은 사람. */
export function prefillNotice(topic: string, answer: string, source: string): string {
  return `이전 요청(${source})에서 정한 내용을 반영했습니다 — ${topicLabelKo(topic)}: ${answer}. 다르면 알려 주세요.`;
}

/* ------------------------------------------------------------------ */
/* Screen collision detection — deterministic, no LLM.                 */
/* ------------------------------------------------------------------ */

export type ScreenCollision = {
  /** Other run's PRD number (PRD-002 …) when known. */
  runNo?: string;
  /** Other run's business title — the ONLY name to show the user. */
  runTitle: string;
  runStatus: string;
  /** Internal shared route — never show to the user. */
  route: string;
  /** Ready-made business-language warning for chat. */
  message: string;
};

type ManifestArtifactLite = {
  id?: string;
  wireframe?: { route?: string; type?: string };
};

function statusLabelKo(status: string): string {
  if (status === "clarifying") return "보완 중";
  if (status === "ready") return "확정됨";
  if (status === "draft") return "초안";
  return status;
}

async function modifyRoutesOfRun(config: WireframeConfig, runId: string): Promise<string[]> {
  const manifestFile = path.join(getRunRoot(config, runId), "spec", "manifest.json");
  if (!(await pathExists(manifestFile))) return [];
  try {
    const raw = JSON.parse((await readFile(manifestFile, "utf8")).replace(/^\uFEFF/, "")) as {
      artifacts?: ManifestArtifactLite[];
    };
    const routes = new Set<string>();
    for (const artifact of raw.artifacts ?? []) {
      const wf = artifact.wireframe;
      if (wf?.type === "modify" && wf.route) routes.add(wf.route);
    }
    return [...routes];
  } catch {
    return [];
  }
}

/**
 * Compare this run's modify-routes against every OTHER not-yet-confirmed run.
 * One warning per (other run, shared route). Safe when manifests do not exist yet.
 */
export async function detectScreenCollisions(
  config: WireframeConfig,
  runId: string,
): Promise<ScreenCollision[]> {
  const mine = new Set(await modifyRoutesOfRun(config, runId));
  if (mine.size === 0) return [];

  const index = await loadIndex(config);
  const collisions: ScreenCollision[] = [];
  for (const project of index.projects) {
    for (const run of project.runs ?? []) {
      if (run.runId === runId || run.status === "confirmed") continue;
      for (const route of await modifyRoutesOfRun(config, run.runId)) {
        if (!mine.has(route)) continue;
        const name = run.no ? `${run.no} ${run.title}` : run.title;
        collisions.push({
          runNo: run.no,
          runTitle: run.title,
          runStatus: run.status,
          route,
          message: `이 화면은 「${name}」에서도 수정하기로 되어 있습니다(${statusLabelKo(run.status)}). 합칠지 따로 갈지 알려 주세요.`,
        });
      }
    }
  }
  return collisions;
}

/* ------------------------------------------------------------------ */
/* CLI: wireframe decisions list --project crm                         */
/* ------------------------------------------------------------------ */

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function listDecisionsCli(config: WireframeConfig, args: string[]): Promise<void> {
  const projectSlug = readFlag(args, "--project")?.trim() ?? config.defaultProject;
  const ledger = await loadDecisionLedger(projectSlug);
  console.log(JSON.stringify({ ok: true, ...ledger }, null, 2));
}
