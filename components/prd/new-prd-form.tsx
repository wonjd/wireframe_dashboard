"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * PRD 등록 — §12.1.
 * prd.md 드래그&드롭이 1순위 UI이고, 텍스트 붙여넣기는 접힌 보조 경로다.
 */
export function NewPrdForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
      router.push(`/prd/${data.id}/spec`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
      >
        + 새 PRD
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-neutral-900/40 p-6">
      <div className="w-full max-w-lg rounded border border-neutral-300 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <span className="text-sm font-medium">새 PRD 등록</span>
          <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
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
              onClick={() => fileRef.current?.click()}
              className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed text-sm ${
                dragging ? "border-neutral-600 bg-neutral-100" : "border-neutral-300 bg-neutral-50"
              }`}
            >
              <div className="text-2xl">📄</div>
              <div className="mt-2 text-neutral-600">prd.md 를 여기에 드래그하거나 클릭해서 선택</div>
              <div className="mt-1 text-xs text-neutral-400">.md / .markdown / .txt, 최대 1MB</div>
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
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="PRD 내용을 붙여넣으세요"
              className="w-full rounded border border-neutral-300 p-3 font-mono text-xs"
            />
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 (비우면 파일명 또는 첫 # 헤딩에서 자동)"
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />

          <button
            onClick={() => setPasteMode((v) => !v)}
            className="text-xs text-neutral-500 underline"
          >
            {pasteMode ? "▸ 파일 업로드로" : "▸ 또는 텍스트 직접 붙여넣기"}
          </button>

          {error && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          <p className="text-xs text-neutral-500">
            등록하면 와이어프레임 생성이 자동으로 시작됩니다.
          </p>

          {pasteMode && (
            <button
              onClick={submitText}
              disabled={busy || !text.trim()}
              className="w-full rounded bg-neutral-800 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy ? "등록 중..." : "등록"}
            </button>
          )}
          {busy && !pasteMode && <p className="text-xs text-neutral-500">등록 중...</p>}
        </div>
      </div>
    </div>
  );
}
