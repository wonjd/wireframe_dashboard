import { decideWorkflow } from "@wireframe-studio/scanner";
import { getFlag } from "./commands.js";
import { inferIssue, slugify } from "./infer.js";
import { ask, readPrd } from "./prompts.js";
import { writeWireFrameOut } from "./out.js";

function yn(argv: string[]): boolean | undefined {
  const detect = getFlag(argv, "--detect");
  if (detect !== undefined) {
    const d = detect.trim().toLowerCase();
    if (d === "y" || d === "yes") return true;
    if (d === "n" || d === "no") return false;
    throw new Error("--detect y|n");
  }
  const mode = getFlag(argv, "--mode");
  if (mode === "existing") return true;
  if (mode === "new") return false;
  return undefined;
}

async function runFromPrd(opts: {
  projectsRoot: string;
  prdText: string;
  prdPath?: string;
  repoHint?: string;
  project?: string;
  feature?: string;
  title?: string;
  forceExisting?: boolean;
}) {
  const inferred = inferIssue(opts.prdText, opts.prdPath);
  const decision = await decideWorkflow(opts.repoHint);
  let detect = decision.mode === "existing";
  if (opts.forceExisting === true) detect = true;
  if (opts.forceExisting === false) detect = false;
  const project = opts.project || (decision.context ? slugify(decision.context.repoName) : "new");
  const id = opts.feature || inferred.id;
  const title = opts.title || inferred.title;
  if (detect) {
    console.log(`기존 프로젝트로 파악했습니다: ${decision.reason}`);
    if (decision.context?.domains.length) console.log(`도메인: ${decision.context.domains.join(", ")}`);
    console.log("이 기준으로 와이어프레임을 구성합니다.");
  } else {
    console.log("새 프로젝트로 파악했습니다.");
    console.log("PRD만으로 와이어프레임을 구성합니다.");
  }
  await writeWireFrameOut({
    root: opts.projectsRoot,
    project,
    id,
    title,
    prdText: opts.prdText,
    detect,
    repoPath: opts.repoHint || decision.repoPath,
  });
}

export async function runWorkflowFromFlags(argv: string[], projectsRoot: string): Promise<void> {
  if (!argv.some((a) => a.startsWith("--"))) {
    let prdPath = "";
    while (!prdPath) {
      prdPath = (await ask("PRD 파일 경로: ")).trim();
      if (!prdPath) console.log("PRD만 있으면 됩니다. 파일 경로를 넣어 주세요.");
    }
    const { abs, text } = await readPrd(prdPath);
    const repoHint = (await ask("프로젝트 폴더 (모르면 Enter): ")).trim() || undefined;
    await runFromPrd({ projectsRoot, prdText: text, prdPath: abs, repoHint });
    return;
  }

  const prd = getFlag(argv, "--prd");
  if (!prd) throw new Error("필수: --prd");
  const { abs, text } = await readPrd(prd);
  await runFromPrd({
    projectsRoot,
    prdText: text,
    prdPath: abs,
    repoHint: getFlag(argv, "--repo"),
    project: getFlag(argv, "--project"),
    feature: getFlag(argv, "--feature"),
    title: getFlag(argv, "--title"),
    forceExisting: yn(argv),
  });
}
