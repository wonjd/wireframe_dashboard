"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WireframeRenderer } from "@/components/wireframe/renderer";
import {
  ALLOWED_MODELS,
  GENERATION_TIMEOUT_MS,
  MAX_SOURCE_TEXT,
  MODELS,
  POLL_INTERVAL_MS,
} from "@/lib/constants";
import type { WireframeDoc } from "@/lib/wireframe/schema";

type Phase = "idle" | "running" | "done";
type RunRef = { agentId: string; runId: string };

const MODEL_LABEL: Record<string, string> = {
  [MODELS.default]: "빠르게 (composer-2.5)",
  [MODELS.smart]: "꼼꼼하게 (auto-smart)",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * PRD(파일 또는 텍스트) → 와이어프레임.
 *
 * 서버는 상태를 갖지 않는다. 착수 응답으로 받은 (agentId, runId)를 들고
 * 여기서 폴링한다. 그래서 서버 함수가 긴 생성 시간을 물고 있을 필요가 없다.
 */
export function Generator() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [model, setModel] = useState<string>(MODELS.default);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<WireframeDoc | null>(null);
  const [dragging, setDragging] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const runRef = useRef<RunRef | null>(null);
  const canceledRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 진행 중 경과 시간 — 몇 분 걸리는 작업이라 멈춘 것처럼 보이지 않게 한다.
  useEffect(() => {
    if (phase !== "running") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    const content = await file.text();
    if (!content.trim()) {
      setError("파일이 비어 있습니다.");
      return;
    }
    if (content.length > MAX_SOURCE_TEXT) {
      setError(`PRD가 너무 깁니다 (최대 ${MAX_SOURCE_TEXT.toLocaleString()}자).`);
      return;
    }
    setText(content);
    setFileName(file.name);
  }, []);

  const generate = useCallback(async () => {
    const sourceText = text.trim();
    if (!sourceText) {
      setError("PRD 파일을 올리거나 내용을 붙여넣으세요.");
      return;
    }

    canceledRef.current = false;
    setError(null);
    setDoc(null);
    setPhase("running");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, model }),
      });
      const started = await res.json();
      if (!res.ok) throw new Error(started?.error ?? "생성 요청에 실패했습니다.");

      runRef.current = { agentId: started.agentId, runId: started.runId };

      const deadline = Date.now() + GENERATION_TIMEOUT_MS;
      while (!canceledRef.current) {
        if (Date.now() > deadline) throw new Error("생성 시간이 초과되었습니다.");
        await sleep(POLL_INTERVAL_MS);
        if (canceledRef.current) return;

        const q = new URLSearchParams(runRef.current);
        const poll = await fetch(`/api/generate?${q}`, { cache: "no-store" });
        const data = await poll.json();
        if (!poll.ok) throw new Error(data?.error ?? "상태 조회에 실패했습니다.");

        if (data.status === "CREATING" || data.status === "RUNNING") continue;
        if (data.error) throw new Error(data.error);

        setDoc(data.doc as WireframeDoc);
        setPhase("done");
        runRef.current = null;
        return;
      }
    } catch (e) {
      if (canceledRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
      runRef.current = null;
    }
  }, [text, model]);

  const cancel = useCallback(() => {
    canceledRef.current = true;
    const run = runRef.current;
    if (run) {
      const q = new URLSearchParams(run);
      void fetch(`/api/generate?${q}`, { method: "DELETE" });
      runRef.current = null;
    }
    setPhase("idle");
  }, []);

  function downloadJson() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName?.replace(/\.[^.]+$/, "") || "wireframe") + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- 결과 화면 -------------------------------------------------------
  if (phase === "done" && doc) {
    return (
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
          <h1 className="text-[14px] font-semibold text-ink">와이어프레임</h1>
          <span className="text-[12.5px] text-ink-3">
            {fileName ?? "붙여넣은 PRD"} · 화면 {doc.screens.length}개
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={downloadJson} className="btn-default px-3 py-1.5 text-[13px]">
              JSON 저장
            </button>
            <button onClick={() => void generate()} className="btn-default px-3 py-1.5 text-[13px]">
              다시 생성
            </button>
            <button
              onClick={() => {
                setPhase("idle");
                setDoc(null);
              }}
              className="btn-primary px-3 py-1.5 text-[13px]"
            >
              새 PRD
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <WireframeRenderer doc={doc} />
        </div>
      </div>
    );
  }

  // ---- 입력 / 진행 화면 -------------------------------------------------
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">와이어프레임 생성</h1>
      <p className="mt-1 text-[13px] text-ink-3">
        PRD 파일을 올리거나 내용을 붙여넣으면 화면 초안을 만들어 줍니다.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
        className={`mt-5 rounded-card border border-dashed p-6 text-center transition ${
          dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface"
        }`}
      >
        <p className="text-[13px] text-ink-2">
          PRD 파일(.md, .txt)을 여기에 끌어다 놓거나
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ml-1 font-medium text-brand underline underline-offset-2"
          >
            파일 선택
          </button>
        </p>
        {fileName && <p className="mt-1.5 text-[12.5px] text-ink-3">불러옴: {fileName}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <label className="field-label mt-5" htmlFor="source">
        PRD 내용
      </label>
      <textarea
        id="source"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        rows={12}
        maxLength={MAX_SOURCE_TEXT}
        placeholder="여기에 PRD를 붙여넣어도 됩니다."
        className="input-field w-full resize-y p-3 text-[13px] leading-relaxed"
      />
      <p className="tnum mt-1 text-right text-[12px] text-ink-4">
        {text.length.toLocaleString()} / {MAX_SOURCE_TEXT.toLocaleString()}
      </p>

      {error && <div className="note note-danger mt-3 px-3 py-2 text-[13px]">{error}</div>}

      <div className="mt-4 flex items-center gap-3">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={phase === "running"}
          className="input-field px-3 py-2 text-[13px]"
          aria-label="모델"
        >
          {ALLOWED_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m] ?? m}
            </option>
          ))}
        </select>

        {phase === "running" ? (
          <>
            <span className="tnum text-[13px] text-ink-2">
              생성 중… {Math.floor(elapsed / 60)}분 {String(elapsed % 60).padStart(2, "0")}초
            </span>
            <button onClick={cancel} className="btn-danger ml-auto px-4 py-2 text-[13px]">
              중단
            </button>
          </>
        ) : (
          <button
            onClick={() => void generate()}
            disabled={!text.trim()}
            className="btn-primary ml-auto px-5 py-2 text-[13px]"
          >
            와이어프레임 생성
          </button>
        )}
      </div>
    </div>
  );
}
