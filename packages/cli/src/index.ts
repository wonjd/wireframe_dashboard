import { validateConfig } from "./commands/config/validate.js";
import { extractAll } from "./commands/extract/all.js";
import { extractApi } from "./commands/extract/api.js";
import { extractDb } from "./commands/extract/db.js";
import { extractDesign } from "./commands/extract/design.js";
import { extractRoutes } from "./commands/extract/routes.js";
import { initProject } from "./commands/project/init.js";
import { listProjects } from "./commands/project/list.js";
import { buildRun } from "./commands/run/build.js";
import { runImpactCli } from "./commands/run/impact.js";
import { confirmRun } from "./commands/run/confirm.js";
import { createRun } from "./commands/run/create.js";
import { listRuns } from "./commands/run/list.js";
import { updateRun } from "./commands/run/update.js";
import { renderRun } from "./commands/render.js";
import { buildShell } from "./commands/shell.js";
import { prdImpactCli } from "./commands/prd/impact.js";
import { loadConfig } from "./lib/config.js";
import {
  answerPrdClarificationsCli,
  applyPrdAnswersCli,
  discardPrdAnswersCli,
  reviewPrdClarificationsCli,
} from "./pipeline/prd-clarify.js";
import { listDecisionsCli } from "./pipeline/decision-ledger.js";

const USAGE = `wireframe config validate [--project crm | --all] [--entities ent,account]
wireframe project list
wireframe project init <slug> [--title "표시 이름"] [--from crm]
wireframe extract design|routes|api|db|all [--project crm] [--entities ent,account]
wireframe shell [--project crm]
wireframe run create --title "기능명" [--run-id slug] [--project crm] [--prd ./file.md | --prd -]
wireframe run update --run-id slug [--project crm] [--title "제목"] [--prd ./file.md | --prd -]
wireframe run build --run-id slug [--project crm] [--asset-project crm]
wireframe run confirm --run-id slug [--project crm]
wireframe run impact --run-id slug [--project crm] --hide flow:step-2,features:2.1 [--rename flow:step-1="새 이름"]
                                                             (와이어프레임 편집 영향 미리보기 — 읽기 전용)
wireframe run list [--project crm]
wireframe prd review --run-id slug [--project crm] [--asset-project crm]
wireframe prd answer --run-id slug --answers '[{"id":"q1","answer":"..."}]' [--project crm]   (제시만 — 저장 안 함)
wireframe prd answer --run-id slug --bulk-text "3번 빼고 제안대로" [--project crm]            (제안 일괄 수락 — 제시만)
wireframe prd answer-apply --run-id slug [--project crm]     (사용자가 승인한 답을 기록)
wireframe prd answer-discard --run-id slug [--project crm]   (제시한 답을 버림)
wireframe prd impact --run-id slug [--project crm] [--source prd|answers] [--prd ./file.md]
                                                             (승인 전 영향 미리보기 — 읽기 전용)
wireframe decisions list [--project crm]
wireframe render --run-id slug [--project crm] [--artifact id] [--instruction text]

Paths: wireframe.config.json + wireframe.config.local.json (gitignored)
Env: WIREFRAME_SOURCE_FRONTEND, WIREFRAME_SOURCE_BACKEND, WIREFRAME_WONJD_COMMAND`;

function argvTail(subcommand: string | undefined, rest: string[]): string[] {
  if (!subcommand) return rest;
  return [subcommand, ...rest];
}

export async function runCli(argv: string[]): Promise<void> {
  const [, , command, subcommand, ...rest] = argv;

  if (command === "config" && subcommand === "validate") {
    await validateConfig(rest);
    return;
  }

  const config = await loadConfig();

  if (command === "project" && subcommand === "list") {
    await listProjects(config);
    return;
  }
  if (command === "project" && subcommand === "init") {
    await initProject(config, rest);
    return;
  }

  if (command === "extract" && subcommand === "design") {
    await extractDesign(config, rest);
    return;
  }
  if (command === "extract" && subcommand === "routes") {
    await extractRoutes(config, rest);
    return;
  }
  if (command === "extract" && subcommand === "api") {
    await extractApi(config, rest);
    return;
  }
  if (command === "extract" && subcommand === "db") {
    await extractDb(config, rest);
    return;
  }
  if (command === "extract" && subcommand === "all") {
    await extractAll(config, rest);
    return;
  }
  if (command === "shell") {
    await buildShell(config, argvTail(subcommand, rest));
    return;
  }

  if (command === "run" && subcommand === "build") {
    await buildRun(config, rest);
    return;
  }
  if (command === "run" && subcommand === "create") {
    await createRun(config, rest);
    return;
  }
  if (command === "run" && subcommand === "list") {
    await listRuns(config, rest);
    return;
  }

  if (command === "run" && subcommand === "update") {
    await updateRun(config, rest);
    return;
  }
  if (command === "run" && subcommand === "confirm") {
    await confirmRun(config, rest);
    return;
  }
  if (command === "run" && subcommand === "impact") {
    await runImpactCli(config, rest);
    return;
  }
  if (command === "render") {
    await renderRun(config, argvTail(subcommand, rest));
    return;
  }

  if (command === "prd" && subcommand === "review") {
    await reviewPrdClarificationsCli(config, rest);
    return;
  }
  if (command === "prd" && subcommand === "answer") {
    await answerPrdClarificationsCli(config, rest);
    return;
  }
  if (command === "prd" && subcommand === "answer-apply") {
    await applyPrdAnswersCli(config, rest);
    return;
  }
  if (command === "prd" && subcommand === "answer-discard") {
    await discardPrdAnswersCli(config, rest);
    return;
  }
  if (command === "prd" && subcommand === "impact") {
    await prdImpactCli(config, rest);
    return;
  }
  if (command === "decisions" && subcommand === "list") {
    await listDecisionsCli(config, rest);
    return;
  }

  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
