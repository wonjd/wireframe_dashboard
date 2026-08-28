/** 모델 — Cursor Cloud agent에 넘기는 id. */
export const MODELS = {
  default: "composer-2.5",
  smart: "auto-smart",
} as const;

export const ALLOWED_MODELS = [MODELS.default, MODELS.smart] as const;

/** 와이어프레임 IR 상한 */
export const MAX_SCREENS = 6;

/** 프롬프트에 실어 보내는 PRD 최대 길이 */
export const MAX_PROMPT_SOURCE = 8_000;
/** 입력으로 받는 PRD 최대 길이 */
export const MAX_SOURCE_TEXT = 50_000;
/** 업로드 파일 최대 크기 */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** 클라이언트 폴링 주기 / 전체 대기 한도 */
export const POLL_INTERVAL_MS = 2_000;
export const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
