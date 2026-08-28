/** 스펙 §9 — SQLite는 Prisma enum을 지원하지 않으므로 앱단 유니온으로 강제한다. */

export const JOB_STATUS = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export const PRD_STATUS = ["DRAFT", "GENERATING", "GENERATED", "FAILED"] as const;
export type PrdStatus = (typeof PRD_STATUS)[number];

/** 리비전이 만들어진 경로 — §8.3 */
export const REVISION_SOURCE = ["UPLOAD", "EDIT"] as const;
export type RevisionSource = (typeof REVISION_SOURCE)[number];

/** 무엇이 생성을 유발했는지 — §6.2 */
export const GEN_TRIGGER = ["T1", "T2", "MANUAL"] as const;
export type GenTrigger = (typeof GEN_TRIGGER)[number];

/** §13.4 — 기본은 sonnet, 복잡한 PRD는 opus */
export const MODELS = {
  default: "claude-sonnet-5",
  complex: "claude-opus-5",
} as const;

export const ALLOWED_MODELS = [MODELS.default, MODELS.complex] as const;

/** 입력 길이 제한 — §14.4 (비용 폭주·컨텍스트 초과 방지) */
export const MAX_SOURCE_TEXT = 50_000;
export const MAX_UPLOAD_BYTES = 1024 * 1024; // 1MB
