import { NextResponse } from "next/server";

/** 스펙 §10.1 — 모든 에러는 { error: { code, message } } 단일 형태. */

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  GENERATION_IN_PROGRESS: 409,
  GENERATION_FAILED: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function apiError(code: ErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: ERROR_CODES[code] });
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
  }
}

/**
 * Route Handler 공통 래퍼.
 * 예상된 실패는 ApiError로 던지고, 그 외는 500으로 뭉갠다 —
 * 내부 상세는 서버 로그에만 남기고 응답에는 일반 메시지만 내보낸다 (§10.1).
 */
export async function handle<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return apiError(e.code, e.message);
    console.error("[api] unhandled", e);
    return apiError("INTERNAL_ERROR", "서버 오류가 발생했습니다.");
  }
}
