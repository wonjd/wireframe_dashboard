"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | null;

/**
 * 스펙 탭 — §12.2.
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
    if (data.status === "DONE" || data.status === "FAILED") {
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

  const generating = jobStatus === "PENDING" || jobStatus === "RUNNING";

  return (
    <div className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={busy}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              저장
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setTitle(initialTitle);
                setText(initialText);
              }}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
            >
              편집
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
            >
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
          </>
        )}

        <button
          onClick={regenerate}
          disabled={busy || generating}
          className="ml-auto rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 disabled:opacity-40"
        >
          {generating ? "⏳ 생성 중..." : "🔄 재생성"}
        </button>
      </div>

      <p className="mb-3 text-xs text-neutral-500">
        ⓘ 저장하면 와이어프레임이 자동으로 다시 생성됩니다. 제목만 바꾸면 생성은 돌지 않습니다.
      </p>

      {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {jobStatus === "FAILED" && jobError && (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          <div className="font-medium">생성 실패</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono">{jobError}</pre>
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={24}
            className="w-full rounded border border-neutral-300 p-3 font-mono text-xs"
          />
        </div>
      ) : (
        <pre className="max-h-[600px] overflow-auto rounded border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs whitespace-pre-wrap text-neutral-700">
          {initialText}
        </pre>
      )}
    </div>
  );
}
