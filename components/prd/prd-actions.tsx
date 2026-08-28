"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 프로젝트 삭제.
 *
 * 되돌릴 수 없고 와이어프레임·리비전까지 같이 지워지므로(스키마의 onDelete: Cascade)
 * 확인 단계를 반드시 거친다. window.confirm 대신 모달을 쓰는 이유는 무엇이 함께
 * 사라지는지를 글로 보여주기 위해서다.
 */
export function PrdActions({ prdId, title }: { prdId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prds/${prdId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "삭제에 실패했습니다.");
      }
      setOpen(false);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-danger px-3 py-1.5 text-[12.5px]"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9a1 1 0 001 .9h4.8a1 1 0 001-.9L12 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        삭제
      </button>

      {open && (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-prd-title"
            className="animate-pop-in w-full max-w-md rounded-xl border border-line bg-surface shadow-pop"
          >
            <div className="flex items-start gap-3 p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-danger-line bg-danger-soft text-danger">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M12 3.5l9 16.5H3l9-16.5z" strokeLinejoin="round" />
                  <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 id="delete-prd-title" className="text-[15px] font-semibold text-ink">
                  프로젝트를 삭제할까요?
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  <span className="font-medium text-ink">{title}</span>
                  <br />
                  PRD 원문, 생성된 와이어프레임 전 버전, 변경 이력이 모두 함께 삭제되며 되돌릴 수
                  없습니다.
                </p>
              </div>
            </div>

            {error && (
              <p className="note note-danger mx-5 mb-4 px-3.5 py-2.5 text-[12.5px]" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-line bg-subtle px-5 py-3.5">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-default px-3.5 py-2 text-[13px]"
              >
                취소
              </button>
              <button onClick={remove} disabled={busy} className="btn-danger-solid px-4 py-2 text-[13px]">
                {busy ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
