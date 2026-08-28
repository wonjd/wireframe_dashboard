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
 * 재생성이 끝나면 최신 버전으로 넘어가되, 보고 있던 화면 id가 새 버전에도
 * 있으면 그 화면을 유지한다. 매번 첫 화면으로 튕기면 방금 추가한 요구사항이
 * 어떻게 반영됐는지 확인하는 데 클릭이 더 든다 (§6.5).
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
      setGenerating(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!doc || versions.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-neutral-500">
        {generating ? (
          <>⏳ 와이어프레임을 생성하고 있습니다...</>
        ) : (
          <>
            <p>아직 생성된 와이어프레임이 없습니다.</p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <button
              onClick={regenerate}
              disabled={busy}
              className="mt-3 rounded bg-neutral-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              생성하기
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {selected?.isStale && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span>⚠ 이 와이어프레임은 현재 PRD 기준이 아닙니다.</span>
          {selected.basedOn && (
            <span className="text-amber-700">
              (기준: r{selected.basedOn.revision} · {selected.basedOn.author.name} ·{" "}
              {formatDateTime(selected.basedOn.createdAt)})
            </span>
          )}
          <button
            onClick={regenerate}
            disabled={busy || generating}
            className="ml-auto rounded border border-amber-400 bg-white px-2 py-0.5 text-amber-800 disabled:opacity-40"
          >
            {generating ? "생성 중..." : "재생성"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 text-xs">
        <label className="flex items-center gap-1 text-neutral-500">
          버전
          <select
            value={selectedId ?? ""}
            onChange={(e) => void loadVersion(e.target.value)}
            className="rounded border border-neutral-300 bg-white px-2 py-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.model}){v.isStale ? " · 낡음" : ""}
              </option>
            ))}
          </select>
        </label>
        {selected?.basedOn && (
          <span className="text-neutral-400">
            r{selected.basedOn.revision} 기준 · {selected.basedOn.author.name}
          </span>
        )}
        <button
          onClick={regenerate}
          disabled={busy || generating}
          className="ml-auto rounded border border-neutral-300 px-2 py-1 text-neutral-700 disabled:opacity-40"
        >
          {generating ? "⏳ 생성 중..." : "🔄 재생성"}
        </button>
      </div>

      {error && <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">{error}</p>}

      <div className="bg-white">
        <WireframeRenderer doc={doc} screenId={screenId} onScreenChange={setScreenId} />
      </div>

      <p className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-400">
        와이어프레임은 읽기 전용입니다. 화면을 바꾸려면 스펙 탭에서 PRD를 수정하세요.
      </p>
    </div>
  );
}
