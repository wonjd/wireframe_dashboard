/** 모델 — Cursor Cloud agent에 넘기는 id. */
export const MODELS = {
  default: "composer-2.5",
  smart: "auto-smart",
} as const;

export const ALLOWED_MODELS = [MODELS.default, MODELS.smart] as const;

/** 프롬프트에 실어 보내는 PRD 최대 길이 */
export const MAX_PROMPT_SOURCE = 8_000;
/** 입력으로 받는 PRD 최대 길이 */
export const MAX_SOURCE_TEXT = 50_000;
/** 업로드 파일 최대 크기 */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** 클라이언트 폴링 주기 / 전체 대기 한도 */
export const POLL_INTERVAL_MS = 2_000;
export const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 착수 요청을 기다려 주는 시간. 인증·검증 오류는 1초 안에 오므로 이 창 안에서
 * 잡아 바로 알려주고, 넘어가면 agentId만 주고 폴링으로 넘긴다.
 */
export const CREATE_ACK_MS = 3_000;

/**
 * agent가 이 시간이 지나도 조회되지 않으면 착수가 실패한 것으로 본다.
 * (폴링만으로는 "아직 생성 중"과 "영영 안 생김"을 구분할 수 없다.)
 */
export const AGENT_MISSING_TIMEOUT_MS = 120_000;
