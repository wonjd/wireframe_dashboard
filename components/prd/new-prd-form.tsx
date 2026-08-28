"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 프로젝트 생성 (§12.1).
 * prd.md 드래그&드롭이 1순위 UI이고, 텍스트 붙여넣기는 보조 경로다.
 */
export function NewPrdForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 모달이 열려 있는 동안 Esc로 닫고 본문 스크롤을 잠근다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setOpen(false);
        setError(null);
        setDragging(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy]);

  function close() {
    setOpen(false);
    setError(null);
    setDragging(false);
  }

  async function submitFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch("/api/prds", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "등록에 실패했습니다.");
      setOpen(false);
      onCreated?.();
      router.push(`/prd/${data.id}/spec`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function submitText() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/prds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, sourceText: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "등록에 실패했습니다.");
      setOpen(false);
      onCreated?.();
      router.push(`/prd/${data.id}/spec`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary w-full px-3 py-2 text-[13px]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M7 2.5v9M2.5 7h9" strokeLinecap="round" />
        </svg>
        새 프로젝트
      </button>
    );
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-prd-title"
        className="animate-pop-in w-full max-w-lg rounded-xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="new-prd-title" className="text-[15px] font-semibold text-ink">
              새 프로젝트
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              PRD 문서를 올리면 와이어프레임 생성까지 자동으로 이어집니다.
            </p>
          </div>
          <button
            onClick={close}
            disabled={busy}
            aria-label="닫기"
            className="btn-ghost -mt-1 -mr-1 h-8 w-8 shrink-0 text-ink-3"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 입력 방식 전환 */}
        <div className="flex gap-1 border-b border-line bg-subtle px-5 py-2">
          {[
            { key: false, label: "파일 업로드" },
            { key: true, label: "직접 붙여넣기" },
          ].map((m) => (
            <button
              key={String(m.key)}
              type="button"
              onClick={() => setPasteMode(m.key)}
              aria-pressed={pasteMode === m.key}
              className={`rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
                pasteMode === m.key
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {!pasteMode ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void submitFile(f);
              }}
              onClick={() => {
                if (!busy) fileRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              className={`flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-[13px] transition-colors ${
                dragging
                  ? "border-brand bg-brand-soft"
                  : "border-line-strong bg-subtle hover:border-brand hover:bg-brand-soft"
              } ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M12 16V4m0 0L8 8m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16" strokeLinecap="round" />
                </svg>
              </span>
              <p className="mt-3 font-medium text-ink-2">
                {busy ? "등록 중..." : "prd.md 를 여기에 놓거나 클릭해서 선택"}
              </p>
              <p className="mt-1 text-[11.5px] text-ink-3">.md / .markdown / .txt · 최대 1MB</p>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void submitFile(f);
                }}
              />
            </div>
          ) : (
            <label className="block">
              <span className="field-label">PRD 원문</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="PRD 내용을 붙여넣으세요"
                className="input-field w-full p-3 font-mono text-xs leading-relaxed"
              />
            </label>
          )}

          <label className="block">
            <span className="field-label">제목 (선택)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="비우면 파일명 또는 첫 # 헤딩에서 자동으로 채웁니다"
              className="input-field w-full px-3 py-2 text-[13px]"
            />
          </label>

          {error && (
            <p className="note note-danger px-3 py-2 text-[12.5px]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-subtle px-5 py-3.5">
          <p className="mr-auto text-[11.5px] text-ink-3">등록 즉시 와이어프레임 생성이 시작됩니다.</p>
          <button onClick={close} disabled={busy} className="btn-default px-3.5 py-2 text-[13px]">
            취소
          </button>
          {pasteMode && (
            <button
              onClick={submitText}
              disabled={busy || !text.trim()}
              className="btn-primary px-4 py-2 text-[13px]"
            >
              {busy ? "등록 중..." : "프로젝트 생성"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
