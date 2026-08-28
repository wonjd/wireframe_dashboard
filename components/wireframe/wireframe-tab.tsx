"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WireframeRenderer } from "./renderer";
import type { WireframeDoc } from "@/lib/wireframe/types";
import { formatDateTime } from "@/lib/format";

type VersionItem = {
  id: string;
  version: number;
  model: string;
  isStale: boolean;
  basedOn: { revision: number; author: { name: string }; createdAt: string } | null;
  createdAt: string;
};

/**
 * 와이어프레임 탭 — §12.3.
 *
 * 재생성이 끝나면 최신 버전으로 넘어간다. 보고 있던 화면 id가 새 버전에도
 * 있으면 그 화면을 유지한다. 매번 첫 화면으로 돌아가면 방금 추가한 요구사항이
 * 어떻게 반영되는지 확인하는 데 클릭이 많아진다 (§6.5).
 */
export function WireframeTab({
  prdId,
  initialVersions,
  initialDoc,
  initialWireframeId,
}: {
  prdId: string;
  initialVersions: VersionItem[];
  initialDoc: WireframeDoc | null;
  initialWireframeId: string | null;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState(initialVersions);
  const [selectedId, setSelectedId] = useState<string | null>(initialWireframeId);
  const [doc, setDoc] = useState<WireframeDoc | null>(initialDoc);
  const [screenId, setScreenId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);

  const selected = versions.find((v) => v.id === selectedId) ?? null;

  const loadVersion = useCallback(async (wireframeId: string) => {
    const res = await fetch(`/api/wireframes/${wireframeId}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "와이어프레임을 불러오지 못했습니다.");
      return;
    }
    setDoc(data.doc);
    setSelectedId(wireframeId);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/prds/${prdId}/wireframes`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setVersions(data.items);
    const latest = data.items[0];
    if (latest && latest.id !== selectedId) {
      await loadVersion(latest.id); // screenId는 그대로 두어 화면 유지
    }
  }, [prdId, selectedId, loadVersion]);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/prds/${prdId}/generate/status`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const running = data.status === "PENDING" || data.status === "RUNNING";
    setGenerating(running);
    setCanceled(data.status === "CANCELED");
    if (data.status === "DONE") {
      await refresh();
      router.refresh();
    }
    if (data.status === "FAILED") {
      setError(data.error ?? "생성에 실패했습니다.");
      router.refresh();
    }
  }, [prdId, refresh, router]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 3000);
    return () => clearInterval(t);
  }, [poll]);

  /** 생성 중단 — 서버의 진행 중인 Job을 CANCELED로 바꾸고 결과를 버린다 */
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prds/${prdId}/generate`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? "중단에 실패했습니다.");
      setGenerating(false);
      setCanceled(true);
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
    setCanceled(false);
    try {
      const res = await fetch(`/api/prds/${prdId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "재생성에 실패했습니다.");
      setGenerating(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // --- 아직 결과가 없을 때 -------------------------------------------
  if (!doc || versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        {generating ? (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand">
              <Spinner size={22} />
            </span>
            <p className="mt-4 text-[14px] font-medium text-ink">와이어프레임을 생성하고 있습니다</p>
            <p className="mt-1.5 text-[13px] text-ink-3">
              보통 30초~1분 정도 걸립니다. 이 화면을 벗어나도 됩니다.
            </p>
            <button onClick={cancel} disabled={busy} className="btn-danger mt-5 px-3.5 py-2 text-[13px]">
              <StopIcon />
              생성 중단
            </button>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-subtle text-ink-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18M9 9v11" />
              </svg>
            </span>
            <p className="mt-4 text-[14px] font-medium text-ink">
              {canceled ? "생성이 중단되었습니다" : "아직 생성된 와이어프레임이 없습니다"}
            </p>
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-3">
              {canceled
                ? "결과가 저장되지 않았습니다. 다시 생성하려면 아래 버튼을 누르세요."
                : "PRD 원문을 기준으로 화면을 구성합니다. 아래 버튼을 누르면 바로 시작합니다."}
            </p>
            {error && (
              <p className="note note-danger mt-4 max-w-md px-3.5 py-2.5 text-[12.5px]" role="alert">
                {error}
              </p>
            )}
            <button onClick={regenerate} disabled={busy} className="btn-primary mt-5 px-4 py-2 text-[13px]">
              {canceled ? "다시 생성" : "와이어프레임 생성"}
            </button>
          </>
        )}
      </div>
    );
  }

  // --- 결과 뷰어 -------------------------------------------------------
  return (
    <div>
      {selected?.isStale && (
        <div className="note-warn flex flex-wrap items-center gap-2 border-b border-warn-line px-5 py-2.5 text-[12.5px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0" aria-hidden>
            <path d="M8 2.2l6 11.3H2L8 2.2z" strokeLinejoin="round" />
            <path d="M8 6.6v3M8 11.6h.01" strokeLinecap="round" />
          </svg>
          <span className="font-medium">이 와이어프레임은 현재 PRD 기준이 아닙니다.</span>
          {selected.basedOn && (
            <span className="tnum opacity-80">
              기준 r{selected.basedOn.revision} · {selected.basedOn.author.name} ·{" "}
              {formatDateTime(selected.basedOn.createdAt)}
            </span>
          )}
          <button
            onClick={generating ? cancel : regenerate}
            disabled={busy}
            className={`ml-auto px-3 py-1 text-[12px] ${generating ? "btn-danger" : "btn-primary"}`}
          >
            {generating ? "생성 중단" : "지금 재생성"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-subtle px-5 py-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className="font-medium">버전</span>
          <select
            value={selectedId ?? ""}
            onChange={(e) => void loadVersion(e.target.value)}
            className="input-field tnum h-8 px-2.5 text-[12.5px]"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {v.model}
                {v.isStale ? " (낡음)" : ""}
              </option>
            ))}
          </select>
        </label>

        {selected?.basedOn && (
          <span className="tnum text-[11.5px] text-ink-4">
            r{selected.basedOn.revision} 기준 · {selected.basedOn.author.name}
          </span>
        )}

        {generating ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-brand-line bg-brand-soft px-2.5 py-1 text-[11.5px] font-medium text-brand">
              <Spinner size={11} />
              새 버전 생성 중
            </span>
            <button onClick={cancel} disabled={busy} className="btn-danger px-3 py-1.5 text-[12.5px]">
              <StopIcon />
              중단
            </button>
          </div>
        ) : (
          <button
            onClick={regenerate}
            disabled={busy}
            className="btn-default ml-auto px-3 py-1.5 text-[12.5px]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M13.5 8a5.5 5.5 0 11-1.7-3.97" strokeLinecap="round" />
              <path d="M13.5 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            재생성
          </button>
        )}
      </div>

      {error && (
        <p className="note note-danger border-x-0 border-t-0 px-5 py-2.5 text-[12.5px]" role="alert">
          {error}
        </p>
      )}

      {/* 캔버스 — 와이어프레임 전체를 흑백 톤으로 렌더한다 (§5.1) */}
      <div className="bg-canvas p-5">
        <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-card">
          <WireframeRenderer doc={doc} screenId={screenId} onScreenChange={setScreenId} />
        </div>
      </div>

      <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[11.5px] text-ink-3">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-ink-4" aria-hidden>
          <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
        </svg>
        와이어프레임은 읽기 전용입니다. 화면을 바꾸려면 PRD 탭에서 원문을 수정하세요.
      </p>
    </div>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

function Spinner({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0 animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" />
      <path d="M14.2 8A6.2 6.2 0 008 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
