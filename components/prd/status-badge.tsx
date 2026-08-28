type Tone = {
  wrap: string;
  dot: string;
  label: string;
};

const TONES: Record<string, Tone> = {
  DRAFT: {
    wrap: "border-line bg-subtle text-ink-3",
    dot: "bg-ink-4",
    label: "초안",
  },
  GENERATING: {
    wrap: "border-brand-line bg-brand-soft text-brand",
    dot: "bg-brand animate-pulse",
    label: "생성 중",
  },
  GENERATED: {
    wrap: "border-ok-line bg-ok-soft text-ok",
    dot: "bg-ok",
    label: "생성 완료",
  },
  FAILED: {
    wrap: "border-danger-line bg-danger-soft text-danger",
    dot: "bg-danger",
    label: "생성 실패",
  },
};

/** 상태 뱃지 — 색 + 점 + 한국어 라벨. 색만으로 구분하지 않는다. */
export function StatusBadge({ status }: { status: string }) {
  const t = TONES[status] ?? TONES.DRAFT;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${t.wrap}`}
      title={status}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}
