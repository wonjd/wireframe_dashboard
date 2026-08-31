import { getFlag } from "./commands.js";
import { ask, parseYesNo, readPrd } from "./prompts.js";
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

export async function runWorkflowFromFlags(argv: string[], projectsRoot: string): Promise<void> {
  if (!argv.some((a) => a.startsWith("--"))) {
    const repoPath = (await ask("git clone 후 repo 경로 (Enter=건너뛰기): ")).trim() || undefined;
    let prdPath = "";
    while (!prdPath) {
      prdPath = (await ask("PRD 파일 경로: ")).trim();
      if (!prdPath) console.log("PRD 경로는 필수입니다.");
    }
    const { text: prdText } = await readPrd(prdPath);
    const detect = parseYesNo(await ask("기존 프로젝트를 감지하시겠습니까? (y/n): "));
    let project = "";
    while (!project) project = (await ask("프로젝트 slug: ")).trim();
    let feature = "";
    while (!feature) feature = (await ask("기능(이슈) id: ")).trim();
    const title = (await ask("제목 (Enter=id): ")).trim() || feature;
    await writeWireFrameOut({ root: projectsRoot, project, id: feature, title, prdText, detect, repoPath });
    return;
  }

  const prd = getFlag(argv, "--prd");
  const project = getFlag(argv, "--project");
  const feature = getFlag(argv, "--feature");
  const title = getFlag(argv, "--title");
  const repo = getFlag(argv, "--repo");
  const detect = yn(argv);
  if (!prd || !project || !feature) throw new Error("필수: --project, --feature, --prd");
  if (detect === undefined) throw new Error("필수: --detect y|n");
  if (detect && !repo) throw new Error("감지 시 --repo 필요");
  const { text: prdText } = await readPrd(prd);
  await writeWireFrameOut({
    root: projectsRoot,
    project,
    id: feature,
    title: title ?? feature,
    prdText,
    detect,
    repoPath: repo,
  });
}
