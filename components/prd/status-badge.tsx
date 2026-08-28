const STYLES: Record<string, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600",
  GENERATING: "bg-blue-50 text-blue-700",
  GENERATED: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
};

const LABELS: Record<string, string> = {
  DRAFT: "DRAFT",
  GENERATING: "⏳ 생성 중",
  GENERATED: "GENERATED",
  FAILED: "실패",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${STYLES[status] ?? STYLES.DRAFT}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
