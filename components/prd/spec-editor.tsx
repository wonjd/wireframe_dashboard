"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELED" | null;

/**
 * PRD 탭 — §12.2.
 *
 * 저장 시 본문이 실제로 바뀌었으면 재생성이 자동으로 걸린다(T2). 사용자가
 * "저장했는데 화면이 왜 바뀌지?"로 놀라지 않도록 그 사실을 상시 노출한다.
 */
export function SpecEditor({
  prdId,
  initialTitle,
  initialText,
  activeJobId,
}: {
  prdId: string;
  initialTitle: string;
  initialText: string;
  activeJobId: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>(activeJobId ? "PENDING" : null);
  const [jobError, setJobError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/prds/${prdId}/generate/status`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setJobStatus(data.status);
    setJobError(data.error ?? null);
    if (data.status === "DONE" || data.status === "FAILED" || data.status === "CANCELED") {
      router.refresh();
      return true;
    }
    return false;
  }, [prdId, router]);

  // 생성 중에만 폴링한다 — 완료되면 멈춘다 (§13.5).
  useEffect(() => {
    if (jobStatus !== "PENDING" && jobStatus !== "RUNNING") return;
    const t = setInterval(() => void poll(), 2000);
    return () => clearInterval(t);
  }, [jobStatus, poll]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prds/${prdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, sourceText: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "저장에 실패했습니다.");
      setEditing(false);
      // jobId가 있으면 본문이 실제로 바뀌어 재생성이 걸린 것 (§6.2 T2)
      setJobStatus(data.jobId ? "PENDING" : null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reupload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/prds/${prdId}`, { method: "PATCH", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "업로드에 실패했습니다.");
      setText(data.sourceText ?? text);
      setJobStatus(data.jobId ? "PENDING" : null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prds/${prdId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "재생성에 실패했습니다.");
      setJobStatus("PENDING");
      setJobError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 생성 중단. 모델 호출 자체는 끊지 못하므로 서버는 결과를 버리는 것으로 처리한다.
   * 낙관적으로 먼저 상태를 내려 버튼이 두 번 눌리지 않게 한다.
   */
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prds/${prdId}/generate`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "중단에 실패했습니다.");
      setJobStatus("CANCELED");
      setJobError(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const generating = jobStatus === "PENDING" || jobStatus === "RUNNING";
  const lineCount = initialText ? initialText.split("\n").length : 0;

  return (
    <div>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-5 py-3">
        {editing ? (
          <>
            <button onClick={save} disabled={busy} className="btn-primary px-3.5 py-1.5 text-[13px]">
              {busy ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setTitle(initialTitle);
                setText(initialText);
              }}
              disabled={busy}
              className="btn-default px-3.5 py-1.5 text-[13px]"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="btn-default px-3.5 py-1.5 text-[13px]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5L11 2.5z" strokeLinejoin="round" />
              </svg>
              편집
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn-default px-3.5 py-1.5 text-[13px]"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M8 11V3m0 0L5 6m3-3l3 3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.5 11v1.5A1.5 1.5 0 004 14h8a1.5 1.5 0 001.5-1.5V11" strokeLinecap="round" />
              </svg>
              파일 재업로드
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void reupload(f);
              }}
            />
            <span className="tnum ml-1 text-[11.5px] text-ink-4">{lineCount}줄</span>
          </>
        )}

        {generating ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand">
              <Spinner />
              생성 중
            </span>
            <button onClick={cancel} disabled={busy} className="btn-danger px-3 py-1.5 text-[12.5px]">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
              </svg>
              생성 중단
            </button>
          </div>
        ) : (
          <button
            onClick={regenerate}
            disabled={busy}
            className="btn-default ml-auto px-3.5 py-1.5 text-[13px]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M13.5 8a5.5 5.5 0 11-1.7-3.97" strokeLinecap="round" />
              <path d="M13.5 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            와이어프레임 재생성
          </button>
        )}
      </div>

      <div className="space-y-3 p-5">
        {generating ? (
          <div className="note note-info flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px]">
            <Spinner />
            <span>와이어프레임을 생성하고 있습니다. 완료되면 와이어프레임 탭에서 확인할 수 있습니다.</span>
          </div>
        ) : jobStatus === "CANCELED" ? (
          <p className="note px-3.5 py-2.5 text-[12.5px]">
            생성을 중단했습니다. 결과는 저장되지 않았고 기존 버전은 그대로입니다.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-3">
            <InfoIcon />
            <span>
              저장하면 와이어프레임이 자동으로 다시 생성됩니다. 제목만 바꾸면 생성은 돌지 않습니다.
            </span>
          </p>
        )}

        {error && (
          <p className="note note-danger px-3.5 py-2.5 text-[12.5px]" role="alert">
            {error}
          </p>
        )}

        {jobStatus === "FAILED" && jobError && (
          <div className="note note-danger px-3.5 py-2.5 text-[12.5px]">
            <p className="font-medium">생성 실패</p>
            <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap">
              {jobError}
            </pre>
          </div>
        )}

        {editing ? (
          <div className="space-y-3">
            <label className="block">
              <span className="field-label">제목</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-field w-full px-3 py-2 text-[13px]"
              />
            </label>
            <label className="block">
              <span className="field-label">PRD 원문</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={24}
                className="input-field w-full p-3.5 font-mono text-xs leading-relaxed"
              />
            </label>
          </div>
        ) : (
          <pre className="prose-source max-h-[620px] p-4">{initialText}</pre>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" />
      <path d="M14.2 8A6.2 6.2 0 008 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="mt-0.5 shrink-0 text-ink-4" aria-hidden>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4M8 5h.01" strokeLinecap="round" />
    </svg>
  );
}
