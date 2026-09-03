import { useEffect, useMemo, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

type QueryPane = {
  sql: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  ms: number;
};

type MatchedTerm = {
  word: string;
  meaning: string;
  aliases?: string[];
  table?: string | null;
  column?: string | null;
  source?: string;
};

type ChatResponse = {
  ok: boolean;
  assistantMessage?: string;
  lastQuery?: QueryPane;
  matchedTerms?: MatchedTerm[];
  error?: string;
  trace?: string[];
};

type Health = {
  ok?: boolean;
  openai?: boolean;
  model?: string;
  missing?: string[];
  useSshTunnel?: boolean;
  selectOnly?: boolean;
};

const STORAGE_KEY = "wf-db-agent-v1";

function loadSession(): { messages: Msg[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [] };
    return JSON.parse(raw) as { messages: Msg[] };
  } catch {
    return { messages: [] };
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function DbQueryTab() {
  const initial = useMemo(() => loadSession(), []);
  const [messages, setMessages] = useState<Msg[]>(
    initial.messages.length
      ? initial.messages
      : [
          {
            role: "assistant",
            content:
              "업무 말로 물어보세요. 예: 「광고주 몇 명?」, 「세금계산서 최근 요청」, 「크리에이티브 관련 뭐가 있어?」. 조회만 가능합니다.",
          },
        ],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [query, setQuery] = useState<QueryPane | null>(null);
  const [matched, setMatched] = useState<MatchedTerm[]>([]);
  const [termQ, setTermQ] = useState("");
  const [termHits, setTermHits] = useState<MatchedTerm[]>([]);
  const [termBusy, setTermBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const termTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages }));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    fetch("/api/db/health")
      .then((r) => r.json())
      .then((j: Health) => setHealth(j))
      .catch(() => setHealth({ ok: false, openai: false, missing: ["연결 실패"] }));
  }, []);

  useEffect(() => {
    if (termTimer.current) clearTimeout(termTimer.current);
    const q = termQ.trim();
    if (!q) {
      setTermHits([]);
      setTermBusy(false);
      return;
    }
    setTermBusy(true);
    termTimer.current = setTimeout(() => {
      fetch(`/api/db/terms?q=${encodeURIComponent(q)}&project=crm`)
        .then((r) => r.json())
        .then((j: { ok?: boolean; terms?: MatchedTerm[] }) => {
          setTermHits(j.ok && Array.isArray(j.terms) ? j.terms : []);
        })
        .catch(() => setTermHits([]))
        .finally(() => setTermBusy(false));
    }, 280);
    return () => {
      if (termTimer.current) clearTimeout(termTimer.current);
    };
  }, [termQ]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await fetch("/api/db/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.filter((m) => m.role === "user" || m.role === "assistant"),
          project: "crm",
        }),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.lastQuery) setQuery(data.lastQuery);
      if (data.matchedTerms?.length) setMatched(data.matchedTerms);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.assistantMessage || "(빈 응답)" },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([
      {
        role: "assistant",
        content: "새 조회를 시작합니다. 보고 싶은 데이터를 업무 말로 말해 주세요.",
      },
    ]);
    setQuery(null);
    setMatched([]);
    setTermQ("");
    setTermHits([]);
    setError(null);
  }

  function askAboutTerm(term: MatchedTerm) {
    const hint = term.meaning || term.word;
    setInput(`${term.word} (${hint}) 관련 데이터 보여줘`);
  }

  const dbReady = health?.ok === true;
  const openaiReady = health?.openai === true;
  const displayTerms = termQ.trim() ? termHits : matched;

  return (
    <div className="wfs-db">
      <header className="wfs-header">
        <h1>DB 조회</h1>
        <span className="wfs-badge">SELECT only</span>
        <span className="wfs-badge">단어 · 의미</span>
        <span className="wfs-spacer" />
        <button type="button" className="wfs-chat-reset" onClick={reset} disabled={busy}>
          새 대화
        </button>
      </header>

      {!openaiReady && health ? (
        <div className="wfs-chat-banner is-warn">
          OPENAI_API_KEY가 없습니다. 레포 루트 <code>.env</code>에 키를 넣고{" "}
          <code>npm run dev</code>를 다시 실행하세요.
        </div>
      ) : null}
      {health && !dbReady ? (
        <div className="wfs-chat-banner is-warn">
          DB env 부족: {(health.missing || []).join(", ") || "확인 필요"}.{" "}
          <code>SSH_*</code> / <code>DB_*</code>만 사용합니다.
        </div>
      ) : null}
      {dbReady && openaiReady ? (
        <div className="wfs-chat-banner">
          OpenAI · {health?.model} · DB env OK
          {health?.useSshTunnel ? " · SSH 터널" : ""} · 조회 전용 · 용어 검색
        </div>
      ) : null}
      {error ? <div className="wfs-chat-banner is-error">{error}</div> : null}

      <div className="wfs-db-body">
        <div className="wfs-db-chat">
          <div className="wfs-chat-log">
            {messages.map((m, i) => (
              <div key={`${i}-${m.role}`} className={`wfs-chat-bubble is-${m.role}`}>
                <div className="wfs-chat-role">{m.role === "user" ? "나" : "에이전트"}</div>
                <div className="wfs-chat-text">{m.content}</div>
              </div>
            ))}
            {busy ? <div className="wfs-chat-busy">조회 중…</div> : null}
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
              placeholder="예: 광고주 몇 명? / 세금계산서 최근 요청 (Shift+Enter 줄바꿈)"
              rows={3}
              disabled={busy}
            />
            <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
              보내기
            </button>
          </div>
        </div>

        <aside className="wfs-db-result" aria-label="조회 결과">
          <div className="wfs-db-terms">
            <div className="wfs-db-terms-head">
              <strong>단어 · 의미</strong>
              {termBusy ? <span className="wfs-prd-meta">검색 중…</span> : null}
            </div>
            <input
              className="wfs-db-term-input"
              value={termQ}
              onChange={(e) => setTermQ(e.target.value)}
              placeholder="용어 검색: 광고주, 세금계산서…"
            />
            {displayTerms.length ? (
              <ul className="wfs-db-term-list">
                {displayTerms.map((t, i) => (
                  <li key={`${t.word}-${t.table ?? ""}-${t.column ?? ""}-${i}`}>
                    <button type="button" className="wfs-db-term-chip" onClick={() => askAboutTerm(t)}>
                      <span className="wfs-db-term-word">{t.word}</span>
                      <span className="wfs-db-term-meaning">{t.meaning}</span>
                      {t.table ? <code className="wfs-db-term-table">{t.table}</code> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wfs-db-terms-empty">
                {termQ.trim()
                  ? "맞는 용어가 없습니다. 다른 말을 시도해 보세요."
                  : "채팅하거나 위에서 용어를 검색하면 여기에 단어·의미가 뜹니다."}
              </p>
            )}
          </div>

          <div className="wfs-db-result-head">
            <strong>결과</strong>
            {query ? (
              <span className="wfs-prd-meta">
                {query.rowCount}행 · {query.ms}ms
                {query.truncated ? " · truncated" : ""}
              </span>
            ) : (
              <span className="wfs-prd-meta">아직 없음</span>
            )}
          </div>
          {query ? (
            <>
              <pre className="wfs-db-sql">{query.sql}</pre>
              <div className="wfs-db-table-wrap">
                <table className="wfs-db-table">
                  <thead>
                    <tr>
                      {query.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>{cellText(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="wfs-db-empty">채팅으로 물으면 여기 조회 결과가 표시됩니다.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
