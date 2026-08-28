export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(typeof d === "string" ? new Date(d) : d);
}
