import { useEffect, useMemo, useState } from "react";
import { NotFoundPage } from "../components/NotFoundPage";

const ASSETS = [
  { id: "design", file: "design.json", label: "디자인 (프론트)" },
  { id: "routes", file: "routes.json", label: "라우트 (프론트)" },
  { id: "api", file: "api.json", label: "API (백엔드)" },
  { id: "db", file: "db.json", label: "DB 스냅샷" },
  { id: "shell", file: "shell.html", label: "셸 HTML" },
  { id: "design-md", file: "design.md", label: "디자인 규칙 (md)" },
] as const;

type ProjectOption = { slug: string; title: string };

export function AssetsJsonTab() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [slug, setSlug] = useState("");
  const [assetId, setAssetId] = useState<(typeof ASSETS)[number]["id"]>("design");
  const [text, setText] = useState("");
  const [missingAsset, setMissingAsset] = useState(false);
  const [noProjects, setNoProjects] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bootDone, setBootDone] = useState(false);

  const asset = useMemo(() => ASSETS.find((a) => a.id === assetId) ?? ASSETS[0], [assetId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/index.json");
        if (res.ok) {
          const j = (await res.json()) as {
            projects?: Array<{ slug: string; title: string }>;
          };
          if (j?.projects?.length) {
            if (cancelled) return;
            setProjects(j.projects.map((p) => ({ slug: p.slug, title: p.title })));
            setSlug(j.projects[0]!.slug);
            setNoProjects(false);
            setBootDone(true);
            return;
          }
        }
      } catch {
        /* fall through */
      }

      // Probe common slugs if index has no projects
      const probes = ["crm"];
      const found: ProjectOption[] = [];
      for (const s of probes) {
        const hit = await fetch(`/projects/${s}/design.json`, { method: "GET" });
        if (hit.ok) found.push({ slug: s, title: s.toUpperCase() });
      }
      if (cancelled) return;
      if (found.length) {
        setProjects(found);
        setSlug(found[0]!.slug);
        setNoProjects(false);
      } else {
        setProjects([]);
        setSlug("");
        setNoProjects(true);
      }
      setBootDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootDone || !slug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMissingAsset(false);
    fetch(`/projects/${slug}/${asset.file}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("missing");
        return res.text();
      })
      .then((body) => {
        if (cancelled) return;
        if (asset.file.endsWith(".json")) {
          try {
            setText(JSON.stringify(JSON.parse(body), null, 2));
          } catch {
            setText(body);
          }
        } else {
          setText(body);
        }
        setMissingAsset(false);
      })
      .catch(() => {
        if (!cancelled) {
          setText("");
          setMissingAsset(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, asset, bootDone]);

  if (bootDone && noProjects) {
    return (
      <div className="wfs-assets">
        <header className="wfs-header">
          <h1>JSON 자산</h1>
          <span className="wfs-badge">프론트 · 백엔드 extract</span>
        </header>
        <NotFoundPage
          title="JSON 자산이 없습니다"
          detail="projects/{slug}/ 아래에 design·routes·api·db 등을 extract하면 여기에 표시됩니다."
        />
      </div>
    );
  }

  return (
    <div className="wfs-assets">
      <header className="wfs-header">
        <h1>JSON 자산</h1>
        <span className="wfs-badge">프론트 · 백엔드 extract</span>
        <span className="wfs-spacer" />
        {projects.length ? (
          <label className="wfs-assets-select">
            프로젝트
            <select value={slug} onChange={(e) => setSlug(e.target.value)}>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title} ({p.slug})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      <div className="wfs-assets-body">
        <aside className="wfs-assets-nav">
          {ASSETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`wfs-assets-item${item.id === assetId ? " is-active" : ""}`}
              onClick={() => setAssetId(item.id)}
            >
              <span>{item.label}</span>
              <code>{item.file}</code>
            </button>
          ))}
          <p className="wfs-assets-hint">
            extract 스냅샷만 봅니다. 라이브 조회는 DB 조회 탭을 쓰세요. 접속 정보는 `.env`의
            SSH_* / DB_* 만 사용합니다.
          </p>
        </aside>
        <div className="wfs-assets-pane">
          {loading ? <div className="wfs-empty">불러오는 중…</div> : null}
          {!loading && missingAsset ? (
            <NotFoundPage
              title="JSON 자산이 없습니다"
              detail={`projects/${slug}/${asset.file} 파일이 없습니다. extract를 먼저 실행하세요.`}
            />
          ) : null}
          {!loading && !missingAsset ? (
            <pre className="wfs-assets-code">{text || "(비어 있음)"}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
