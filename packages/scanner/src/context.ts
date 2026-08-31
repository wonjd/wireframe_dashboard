import { existingContextSchema } from "@wireframe-studio/core";
import { detectDatabase } from "./db-detect.js";
import { detectProjectSpec } from "./detect.js";
import { scanExistingProject } from "./domain.js";

/** EXISTING 분기 — 도메인 + 프레임워크 + DB 통합 감지 */
export async function detectExistingContext(repoPath: string) {
  const [domain, spec, database] = await Promise.all([
    scanExistingProject(repoPath),
    detectProjectSpec(repoPath),
    detectDatabase(repoPath),
  ]);

  return existingContextSchema.parse({
    repoPath: domain.repoPath,
    repoName: domain.repoName,
    domains: domain.domains,
    relatedFiles: domain.relatedFiles,
    theme: domain.theme,
    framework: spec.framework,
    bundler: spec.bundler,
    router: spec.router,
    packageManager: spec.packageManager,
    database,
    integration: {
      kind: spec.integration.kind,
      file: spec.integration.file,
      package: spec.integration.package,
    },
  });
}
