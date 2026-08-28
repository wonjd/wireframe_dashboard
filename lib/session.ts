import { db } from "./db";
import { ensureSchema } from "./ensure-schema";

/**
 * 현재 사용자 조회 — 스펙 §7.3.
 *
 * ⚠️ 지금은 개발용 스텁이다. 네이버웍스 OAuth는 Phase 0(사내 앱 등록) 이후에 붙인다.
 *
 * 스텁이지만 이 경계 자체는 지금부터 지킨다:
 *   - 쓰기 경로의 작성자는 **항상 이 함수**로만 결정한다.
 *   - 요청 바디의 authorId류 필드는 어디서도 읽지 않는다 (§10).
 * 그래야 나중에 이 함수 본문만 실제 세션 조회로 바꾸면 인증이 완성된다.
 */

const DEV_USER = {
  worksUserId: "dev-stub-user",
  email: "dev@example.com",
  name: "개발용 사용자",
} as const;

export async function getCurrentUser() {
  await ensureSchema();
  return db.user.upsert({
    where: { worksUserId: DEV_USER.worksUserId },
    update: {},
    create: { ...DEV_USER },
  });
}

/** 인증이 붙은 뒤에는 여기서 401을 던지게 된다. 지금은 항상 스텁 사용자를 준다. */
export async function requireUser() {
  return getCurrentUser();
}
