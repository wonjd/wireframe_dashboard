import fs from "node:fs/promises";
import path from "node:path";
import type { IntegrationKind } from "@wireframe-studio/core";
import { detectProjectSpec, detectExistingContext } from "@wireframe-studio/scanner";

const INTEGRATION_EXTRAS: Partial<Record<IntegrationKind, { template: string; file: string }[]>> = {
  "next-pages": [{ template: "integrations/next-pages/wireframe.api.ts", file: "pages/api/wireframe/[...path].ts" }],
};

export function getFlag(argv: string[], flag: string) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

export async function runDetect(argv: string[]) {
  const repo = getFlag(argv, "--repo") ?? process.cwd();
  const json = argv.includes("--json");
  const full = argv.includes("--full");

  if (full) {
    const context = await detectExistingContext(repo);
    if (json) {
      console.log(JSON.stringify(context, null, 2));
      return;
    }
    console.log(`Repo: ${context.repoPath}`);
    console.log(`Framework: ${context.framework}  Router: ${context.router}`);
    console.log(`Domains: ${context.domains.join(", ") || "(none)"}`);
    const db = context.database.detected ? `${context.database.orm}/${context.database.provider}` : "없음";
    console.log(`Database: ${db}`);
    return;
  }

  const spec = await detectProjectSpec(repo);
  if (json) {
    console.log(JSON.stringify(spec, null, 2));
    return;
  }

  console.log(`Repo: ${spec.repoPath}`);
  console.log(`Framework: ${spec.framework}  Bundler: ${spec.bundler}  Router: ${spec.router}`);
  console.log(`Package manager: ${spec.packageManager}  Monorepo: ${spec.isMonorepo ? "yes" : "no"}`);
  console.log(`Integration (${spec.integration.kind}): ${spec.integration.file}`);
  console.log(`  template: ${spec.integration.template}`);
  console.log(`  package:  ${spec.integration.package}`);
  if (spec.integration.extraSteps.length) {
    console.log("  steps:");
    for (const step of spec.integration.extraSteps) console.log(`    - ${step}`);
  }
}

export async function runIntegrate(argv: string[], root: string) {
  const repo = getFlag(argv, "--repo") ?? process.cwd();
  const dryRun = argv.includes("--dry-run");
  const spec = await detectProjectSpec(repo);
  const absRepo = spec.repoPath;

  const copies = [
    { template: spec.integration.template, file: spec.integration.file },
    ...(INTEGRATION_EXTRAS[spec.integration.kind] ?? []),
  ];

  for (const { template, file } of copies) {
    const src = path.join(root, template);
    const dest = path.join(absRepo, file);
    if (dryRun) {
      console.log(`[dry-run] ${template} -> ${file}`);
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    console.log(`created ${file}`);
  }

  console.log(`\nPackage: ${spec.integration.package}`);
  console.log("Next steps:");
  for (const step of spec.integration.extraSteps) console.log(`  - ${step}`);
}

export function printUsage() {
  console.log(`워크플로우: git clone → PRD → [existing만 감지] → prompt.txt → wireframe.html

pnpm wf              # 인터랙티브
pnpm wf start        # 동일

# 비대화형
pnpm wf start --project crm_frontend --feature growth-pause --prd ./prd.md --detect y --repo ../crm_frontend
pnpm wf start --project landing --feature onboarding --prd ./prd.md --detect n
pnpm wf generate ... # start 와 동일 (--mode existing|new 는 --detect y|n 별칭)

wf detect [--repo path] [--json] [--full]
wf integrate [--repo path] [--dry-run]`);
}
