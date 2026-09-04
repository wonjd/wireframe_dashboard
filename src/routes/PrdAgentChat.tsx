import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { statusLabel } from "./PrdList";

type Msg = { role: "user" | "assistant"; content: string };

type ChatResponse = {
  ok: boolean;
  assistantMessage?: string;
  runId?: string;
  project?: string;
  status?: string;
  phase?: string;
  built?: boolean;
  artifactCount?: number;
  openQuestions?: Array<{ id: string; question: string }>;
  pendingPrd?: boolean;
  pendingSummary?: string[];
  error?: string;
  trace?: string[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  usageCalls?: number;
};

function storageKey(runId?: string): string {
  return runId ? `wf-prd-agent:${runId}` : "wf-prd-agent:new";
}

function loadSession(runId?: string): {
  messages: Msg[];
  runId?: string;
  status?: string;
  phase?: string;
} {
  try {
    const raw = localStorage.getItem(storageKey(runId));
    if (!raw) return { messages: [], runId };
    return JSON.parse(raw) as {
      messages: Msg[];
      runId?: string;
      status?: string;
      phase?: string;
    };
  } catch {
    return { messages: [], runId };
  }
}

const DEFAULT_ASSISTANT: Msg = {
  role: "assistant",
  content:
    "① PRD를 붙여 넣어 주세요. 모호한 부분을 먼저 확정하고, ② 화면 형태(모달/표/페이지 등)를 물은 뒤, ③ 1차 와이어프레임을 만들고 화면마다 수정·승인합니다.",
};

const CONTINUE_ASSISTANT: Msg = {
  role: "assistant",
  content:
    "이 PRD 보완을 이어갑니다. 애매한 부분 → 화면 형태 → 와이어프레임 수정·승인 순으로 진행합니다.",
};

/**
 * chatOnly: the studio embeds this chat as the single mutation path for a run. A direct
 * "generate wireframe" button there would rewrite artifacts without the intent ever reaching
 * the model, so every change must be asked for in the conversation instead.
 */
export function PrdAgentChat({
  runId: runIdProp,
  chatOnly = false,
}: { runId?: string; chatOnly?: boolean } = {}) {
  const [searchParams] = useSearchParams();
  const queryRunId = runIdProp || searchParams.get("runId") || undefined;

  const initial = useMemo(() => loadSession(queryRunId), [queryRunId]);
  const [messages, setMessages] = useState<Msg[]>(
    initial.messages.length
      ? initial.messages
      : [queryRunId ? CONTINUE_ASSISTANT : DEFAULT_ASSISTANT],
  );
  const [runId, setRunId] = useState<string | undefined>(queryRunId || initial.runId);
  const [status, setStatus] = useState<string | undefined>(initial.status);
  const [phase, setPhase] = useState<string | undefined>(initial.phase);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildNotice, setBuildNotice] = useState<string | null>(null);
  // Read-only reminder that an edit is staged. The approval itself happens in the chat —
  // a button here would be a second way to mutate the PRD, which the studio must not have.
  const [pendingSummary, setPendingSummary] = useState<string[] | null>(null);
  const [health, setHealth] = useState<{ openai: boolean; model: string } | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{
    last?: { prompt: number; completion: number; total: number; calls: number };
    session: { prompt: number; completion: number; total: number };
  }>({ session: { prompt: 0, completion: 0, total: 0 } });
  const bottomRef = useRef<HTMLDivElement>(null);
  const builtForReady = useRef<string | null>(null);
  const runIdRef = useRef<string | undefined>(queryRunId || initial.runId);

  useEffect(() => {
    runIdRef.current = runId;
  }, [runId]);

  useEffect(() => {
    if (!queryRunId) return;
    const session = loadSession(queryRunId);
    setRunId(queryRunId);
    runIdRef.current = queryRunId;
    setStatus(session.status);
    setPhase(session.phase);
    setMessages(session.messages.length ? session.messages : [CONTINUE_ASSISTANT]);
  }, [queryRunId]);

  useEffect(() => {
    const payload = JSON.stringify({ messages, runId, status, phase });
    localStorage.setItem(storageKey(runId || queryRunId), payload);
    // The "new" slot is only a scratchpad for a request that has no id yet. Once the run exists
    // its history belongs to that run's key, and "새 PRD" must open an empty chat — mirroring
    // the session here made 새 PRD resume the previous conversation instead of starting one.
    // A refresh that loses runId is recovered server-side by recoverRunId(), not from here.
    if (runId && !queryRunId) localStorage.removeItem(storageKey());
  }, [messages, runId, status, phase, queryRunId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, buildNotice]);

  useEffect(() => {
    fetch("/api/agent/health")
      .then((r) => r.json())
      .then((j: { openai?: boolean; model?: string }) =>
        setHealth({ openai: Boolean(j.openai), model: j.model || "gpt-4.1-mini" }),
      )
      .catch(() => setHealth({ openai: false, model: "?" }));
  }, []);

  async function generateWireframe(targetRunId: string) {
    if (building) return;
    setBuilding(true);
    setBuildNotice("화면 형태 확정됨 → 와이어프레임 생성 중…");
    setError(null);
    try {
      const res = await fetch(`/api/prd/${encodeURIComponent(targetRunId)}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: "crm" }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        phase?: string;
        screens?: unknown[];
        artifactCount?: number;
      };
      if (!res.ok || j.ok === false) {
        if (typeof j.phase === "string") setPhase(j.phase);
        throw new Error(j.error || "빌드 실패");
      }
      setPhase("ready");
      const n = Array.isArray(j.screens) ? j.screens.length : j.artifactCount || 0;
      setBuildNotice(`와이어프레임 ${n}개 화면 생성 완료.`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `화면 형태까지 확정되어 1차 와이어프레임을 만들었습니다 (${n}개 화면). 「와이어프레임」 탭에서 화면을 보고, 고칠 점을 보내 다듬은 뒤 「승인 완료」를 눌러 주세요.`,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBuildNotice(null);
    } finally {
      setBuilding(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || building) return;
    setInput("");
    setError(null);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.filter((m) => m.role === "user" || m.role === "assistant"),
          runId: runIdRef.current,
          project: "crm",
        }),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const nextRunId = data.runId || runIdRef.current;
      if (nextRunId) {
        runIdRef.current = nextRunId;
        setRunId(nextRunId);
      }
      if (data.status) setStatus(data.status);
      if (data.phase) setPhase(data.phase);
      setPendingSummary(data.pendingPrd ? (data.pendingSummary ?? []) : null);
      if (data.usage) {
        const prompt = data.usage.prompt_tokens || 0;
        const completion = data.usage.completion_tokens || 0;
        const total = data.usage.total_tokens || prompt + completion;
        const calls = data.usageCalls || 1;
        setTokenUsage((prev) => ({
          last: { prompt, completion, total, calls },
          session: {
            prompt: prev.session.prompt + prompt,
            completion: prev.session.completion + completion,
            total: prev.session.total + total,
          },
        }));
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.assistantMessage || "(빈 응답)" },
      ]);

      // Agent already built in this turn
      if (data.built && nextRunId) {
        builtForReady.current = `${nextRunId}:phase-ready`;
        const n = data.artifactCount || 0;
        setBuildNotice(n ? `와이어프레임 ${n}개 화면 생성 완료.` : "와이어프레임 생성 완료.");
        setPhase("ready");
        return;
      }

      // Backup: UI auto-build when phase becomes ready
      const nextPhase = data.phase || phase;
      const layoutStillOpen = (data.openQuestions ?? []).some(
        (q) =>
          /화면\s*(형태|양식)/.test(q.question) ||
          /모달|팝업|목록\s*표|전체\s*페이지|단계별/.test(q.question),
      );
      if (
        nextPhase === "ready" &&
        data.status === "ready" &&
        !layoutStillOpen &&
        nextRunId &&
        builtForReady.current !== `${nextRunId}:phase-ready`
      ) {
        builtForReady.current = `${nextRunId}:phase-ready`;
        setBusy(false);
        await generateWireframe(nextRunId);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    localStorage.removeItem(storageKey(undefined));
    setMessages([DEFAULT_ASSISTANT]);
    setRunId(undefined);
    setStatus(undefined);
    setPhase(undefined);
    setError(null);
    setBuildNotice(null);
    setPendingSummary(null);
    setTokenUsage({ session: { prompt: 0, completion: 0, total: 0 } });
    builtForReady.current = null;
  }

  const canBuild = phase === "ready" && (status === "ready" || status === "confirmed");

  return (
    <div className="wfs-prd-chat">
      <header className="wfs-header">
        <h1>{queryRunId ? "PRD 보완 채팅" : "새 PRD"}</h1>
        <span className="wfs-badge">{statusLabel(status)}</span>
        <span className="wfs-spacer" />
        <Link className="wfs-chat-reset" to="/prd" style={{ display: "inline-flex", alignItems: "center" }}>
          목록
        </Link>
        {runId ? (
          <Link
            className="wfs-chat-reset"
            to={`/prd/${encodeURIComponent(runId)}`}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            상세
          </Link>
        ) : null}
        {canBuild && runId && !chatOnly ? (
          <button
            type="button"
            className="wfs-btn-primary"
            onClick={() => void generateWireframe(runId)}
            disabled={busy || building}
          >
            {building ? "생성 중…" : "와이어프레임 생성"}
          </button>
        ) : null}
        <Link className="wfs-chat-reset" to="/wireframes" style={{ display: "inline-flex", alignItems: "center" }}>
          와이어프레임
        </Link>
        {!queryRunId ? (
          <button type="button" className="wfs-chat-reset" onClick={reset} disabled={busy || building}>
            새 대화
          </button>
        ) : null}
      </header>

      {health && !health.openai ? (
        <div className="wfs-chat-banner is-warn">
          OPENAI_API_KEY가 없습니다. 레포 루트 <code>.env</code>에 키를 넣고{" "}
          <code>npm run dev</code>를 다시 실행하세요.
        </div>
      ) : null}
      {health?.openai ? (
        <div className="wfs-chat-banner">OpenAI 연결됨 · model {health.model}</div>
      ) : null}
      {tokenUsage.last ? (
        <div className="wfs-chat-banner">
          tokens 이번 턴 in {tokenUsage.last.prompt.toLocaleString()} / out{" "}
          {tokenUsage.last.completion.toLocaleString()} / total{" "}
          {tokenUsage.last.total.toLocaleString()}
          {tokenUsage.last.calls > 1 ? ` (${tokenUsage.last.calls}회 호출)` : ""}
          {" · "}세션 Σ {tokenUsage.session.total.toLocaleString()}
        </div>
      ) : null}
      {phase === "layout" ? (
        <div className="wfs-chat-banner is-warn">
          PRD는 확정됐습니다. 화면 형태(모달/표/페이지 등)를 답한 뒤에만 와이어프레임을 생성합니다.
        </div>
      ) : null}
      {pendingSummary ? (
        <div className="wfs-chat-banner is-warn">
          저장 대기 중 — 아직 요청서에 반영하지 않았습니다. 승인하시면 반영합니다.
          {pendingSummary.length ? ` (${pendingSummary.join(" · ")})` : ""}
        </div>
      ) : null}
      {buildNotice ? <div className="wfs-chat-banner">{buildNotice}</div> : null}
      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}

      <div className="wfs-chat-log">
        {messages.map((m, i) => (
          <div key={`${i}-${m.role}`} className={`wfs-chat-bubble is-${m.role}`}>
            <div className="wfs-chat-role">{m.role === "user" ? "나" : "에이전트"}</div>
            <div className="wfs-chat-text">{m.content}</div>
          </div>
        ))}
        {busy || building ? (
          <div className="wfs-chat-busy">{building ? "와이어프레임 생성 중…" : "생각 중…"}</div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="wfs-chat-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="PRD를 붙여 넣거나, 보완·화면 형태 질문에 답하세요. (Shift+Enter 줄바꿈)"
          rows={4}
          disabled={busy || building}
        />
        <button type="button" onClick={() => void send()} disabled={busy || building || !input.trim()}>
          보내기
        </button>
      </div>
    </div>
  );
}
