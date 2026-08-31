export function printUsage() {
  console.log(`워크플로우: PRD만 준다. 기존/신규는 자동 판단.

pnpm wf
pnpm wf start --prd ./prd.md
pnpm wf start --prd ./prd.md --repo ../crm

wf detect [--repo path] [--json] [--full]
wf integrate [--repo path] [--dry-run]`);
}
