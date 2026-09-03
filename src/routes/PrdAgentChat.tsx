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
  openQuestions?: Array<{ id: string; question: string }>;
  error?: string;
  trace?: string[];
};

function storageKey(runId?: string): string {
  return runId ? `wf-prd-agent:${runId}` : "wf-prd-agent:new";
}

function loadSession(runId?: string): { messages: Msg[]; runId?: string; status?: string } {
  try {
    const raw = localStorage.getItem(storageKey(runId));
    if (!raw) return { messages: [], runId };
    return JSON.parse(raw) as { messages: Msg[]; runId?: string; status?: string };
  } catch {
    return { messages: [], runId };
  }
}

const DEFAULT_ASSISTANT: Msg = {
  role: "assistant",
  content:
    "① PRD를 붙여 넣어 주세요. 모호한 결정을 쉬운 말로 묻고, 승인되면 와이어프레임을 바로 생성합니다.",
};

const CONTINUE_ASSISTANT: Msg = {
  role: "assistant",
  content: "이 PRD 보완을 이어갑니다. 바꾸고 싶은 점이나 보완 답을 적어 주세요. 확정(ready)되면 와이어프레임을 생성합니다.",
};

export function PrdAgentChat() {
  const [searchParams] = useSearchParams();
  const queryRunId = searchParams.get("runId") || undefined;

  const initial = useMemo(() => loadSession(queryRunId), [queryRunId]);
  const [messages, setMessages] = useState<Msg[]>(
    initial.messages.length
      ? initial.messages
      : [queryRunId ? CONTINUE_ASSISTANT : DEFAULT_ASSISTANT],
  );
  const [runId, setRunId] = useState<string | undefined>(queryRunId || initial.runId);
  const [status, setStatus] = useState<string | undefined>(initial.status);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildNotice, setBuildNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<{ openai: boolean; model: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const builtForReady = useRef<string | null>(null);

  useEffect(() => {
    if (!queryRunId) return;
    const session = loadSession(queryRunId);
    setRunId(queryRunId);
    setStatus(session.status);
    setMessages(session.messages.length ? session.messages : [CONTINUE_ASSISTANT]);
  }, [queryRunId]);

  useEffect(() => {
    localStorage.setItem(storageKey(runId || queryRunId), JSON.stringify({ messages, runId, status }));
  }, [messages, runId, status, queryRunId]);

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
    setBuildNotice("PRD 확정됨 → 와이어프레임 생성 중…");
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
        screens?: unknown[];
        artifactCount?: number;
      };
      if (!res.ok || j.ok === false) throw new Error(j.error || "빌드 실패");
      const n = Array.isArray(j.screens) ? j.screens.length : j.artifactCount || 0;
      setBuildNotice(`와이어프레임 ${n}개 화면 생성 완료.`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `PRD가 확정되어 와이어프레임을 생성했습니다 (${n}개 화면). 「와이어프레임」 탭에서 화면 이름 링크를 누르면 새 창으로 열립니다.`,
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
          runId,
          project: "crm",
        }),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const nextRunId = data.runId || runId;
      if (data.runId) setRunId(data.runId);
      if (data.status) setStatus(data.status);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.assistantMessage || "(빈 응답)" },
      ]);

      if (
        data.status === "ready" &&
        nextRunId &&
        builtForReady.current !== `${nextRunId}:ready`
      ) {
        builtForReady.current = `${nextRunId}:ready`;
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
    setError(null);
    setBuildNotice(null);
    builtForReady.current = null;
  }

  return (
    <div className="wfs-prd-chat">
      <header className="wfs-header">
        <h1>{queryRunId ? "PRD 보완 채팅" : "새 PRD"}</h1>
        <span className="wfs-badge">{statusLabel(status)}</span>
        {runId ? <span className="wfs-badge">{runId}</span> : null}
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
        {(status === "ready" || status === "confirmed") && runId ? (
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
          placeholder="PRD를 붙여 넣거나, 보완 질문에 답하세요. (Shift+Enter 줄바꿈)"
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
