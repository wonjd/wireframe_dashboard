/**
 * 날짜·시각 표기 — 항상 KST, 항상 24시간제.
 *
 * ko-KR 로케일 포맷터를 그대로 쓰면 서버(Node ICU)는 "PM 1:32", 브라우저는
 * "오후 1:32"를 내놓아 하이드레이션이 깨진다. 숫자 파트만 뽑아 직접 조립하면
 * 로케일 데이터에 의존하지 않으므로 양쪽 결과가 항상 같다.
 */
const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "2026.08.28 13:32" */
export function formatDateTime(d: Date | string): string {
  const p = parts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

/** "2026.08.28" */
export function formatDate(d: Date | string): string {
  const p = parts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}.${p.month}.${p.day}`;
}
