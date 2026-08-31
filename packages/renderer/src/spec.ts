import type { ExistingContext } from "@wireframe-studio/core";

export function buildSpecDocument(opts: {
  title: string;
  feature: string;
  prdText: string;
  detected?: ExistingContext;
}): string {
  const lines = [
    `# Wireframe Spec: ${opts.title}`,
    "",
    `- feature: \`${opts.feature}\``,
    `- generated: ${new Date().toISOString()}`,
    "",
    "## PRD",
    "",
    opts.prdText.trim(),
  ];

  if (!opts.detected) {
    lines.push("", "## Context", "", "신규 프로젝트 — 기존 repo 감지 없음 (design-kit 기준).");
    return lines.join("\n");
  }

  const d = opts.detected;
  lines.push(
    "",
    "## Domain",
    "",
    d.domains.length ? d.domains.map((x) => `- ${x}`).join("\n") : "- (감지된 도메인 없음)",
    "",
    "## Database",
    "",
    d.database.detected
      ? [
          `- ORM: ${d.database.orm ?? "unknown"}`,
          `- Provider: ${d.database.provider ?? "unknown"}`,
          d.database.schemaPath ? `- Schema: \`${d.database.schemaPath}\`` : "",
          d.database.models?.length ? `- Models: ${d.database.models.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "- DB 스키마 미감지",
    "",
    "## Framework",
    "",
    `- Framework: ${d.framework}`,
    `- Bundler: ${d.bundler}`,
    `- Router: ${d.router}`,
    `- Package manager: ${d.packageManager}`,
    "",
    "## Repo",
    "",
    `- Path: \`${d.repoPath}\``,
    `- Related: ${d.relatedFiles.join(", ") || "(none)"}`
  );

  return lines.join("\n");
}
