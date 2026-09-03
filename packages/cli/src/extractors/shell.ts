import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedProject } from "../lib/config.js";
import { writeProjectText } from "../lib/paths.js";

type DesignJson = {
  color?: Record<string, string>;
  layout?: {
    sideNavWidth?: string;
    topNavHeight?: string;
  };
  radius?: {
    card?: string;
    control?: string;
  };
  type?: {
    family?: string;
  };
};

type RoutesJson = {
  routes?: Array<{ path: string; label?: string; screenKind?: string }>;
};

function pickColors(color: Record<string, string> | undefined) {
  return {
    brand: color?.brand ?? color?.["token-1"] ?? "#246beb",
    ink: color?.ink ?? color?.["token-11"] ?? "#001E3C",
    text: color?.text ?? color?.["token-5"] ?? "#333333",
    line: color?.line ?? color?.["token-14"] ?? "#d9d9d9",
    muted: color?.muted ?? color?.["token-6"] ?? "#666666",
    danger: color?.danger ?? color?.["token-8"] ?? "#e74c3c",
    success: color?.success ?? color?.["token-10"] ?? "#217346",
    topnav: color?.topnav ?? "#2d3539",
    sidenav: color?.sidenav ?? "#465464",
    bg: color?.bg ?? "#f5f6f8",
    surface: color?.surface ?? "#ffffff",
  };
}

function sidenavFromRoutes(routes: RoutesJson | null, fallbackTitle: string): string {
  const items = (routes?.routes ?? []).slice(0, 12);
  if (items.length === 0) {
    return `
      <div class="wfs-nav-group">
        <div class="wfs-nav-group-title">업무</div>
        <a class="wfs-nav-item is-active" href="#">목록</a>
        <a class="wfs-nav-item" href="#">상세</a>
        <a class="wfs-nav-item" href="#">${fallbackTitle}</a>
      </div>`;
  }

  const groups: Array<{ title: string; items: typeof items }> = [
    { title: "콘텐츠", items: [] },
    { title: "계정·업체", items: [] },
    { title: "기타", items: [] },
  ];
  for (const route of items) {
    const blob = `${route.path} ${route.label ?? ""}`.toLowerCase();
    if (/content|creative|소재|제작|이미지|영상/.test(blob)) groups[0]!.items.push(route);
    else if (/account|ent|업체|계정/.test(blob)) groups[1]!.items.push(route);
    else groups[2]!.items.push(route);
  }

  let first = true;
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => {
      const links = g.items
        .map((route) => {
          const label = route.label ?? route.path;
          const active = first;
          first = false;
          return `<a class="wfs-nav-item${active ? " is-active" : ""}" href="#">${label}</a>`;
        })
        .join("\n        ");
      return `<div class="wfs-nav-group">
        <div class="wfs-nav-group-title">${g.title}</div>
        ${links}
      </div>`;
    })
    .join("\n      ");
}

async function designMdNote(project: ResolvedProject): Promise<string> {
  const mdPath = path.join(path.dirname(project.outputs.design), "design.md");
  try {
    await access(mdPath);
    return "<!-- design.md present: human rule layer — do not overwrite on extract -->";
  } catch {
    return "<!-- design.md missing: add projects/{slug}/design.md for publishing recipes -->";
  }
}

/** Full publishing-level shell CSS (CRM chrome + page patterns). Shared by artifacts. */
export function shellCssKit(colors: ReturnType<typeof pickColors>, opts: {
  sideNavWidth: string;
  topNavHeight: string;
  radius: string;
  font: string;
}): string {
  return `
    :root {
      --brand: ${colors.brand};
      --ink: ${colors.ink};
      --text: ${colors.text};
      --line: ${colors.line};
      --muted: ${colors.muted};
      --danger: ${colors.danger};
      --success: ${colors.success};
      --topnav: ${colors.topnav};
      --sidenav: ${colors.sidenav};
      --radius: ${opts.radius};
      --font: ${opts.font};
      --topnav-h: ${opts.topNavHeight};
      --sidenav-w: ${opts.sideNavWidth};
      --bg: ${colors.bg};
      --surface: ${colors.surface};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      color: var(--text);
      background: var(--bg);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: default; }

    /* —— App chrome (CRM TopNav / SideNav) —— */
    .wfs-app {
      display: grid;
      grid-template-columns: var(--sidenav-w) 1fr;
      grid-template-rows: var(--topnav-h) 1fr;
      min-height: 100vh;
      background: var(--bg);
    }
    .wfs-topnav {
      grid-column: 1 / -1;
      height: var(--topnav-h);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 16px 0 12px;
      background: var(--topnav);
      color: #fff;
      z-index: 20;
    }
    .wfs-topnav-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: var(--sidenav-w);
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.02em;
    }
    .wfs-topnav-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      padding: 0 10px;
      border-radius: 4px;
      background: rgba(255,255,255,0.12);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    .wfs-topnav-right {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: auto;
    }
    .wfs-topnav-chip {
      display: inline-flex;
      align-items: center;
      height: 28px;
      padding: 0 10px;
      border-radius: 8px;
      border: 1px solid #ddd;
      background: #fff;
      color: #333;
      font-size: 13px;
    }
    .wfs-topnav-user {
      font-size: 14px;
      color: #fff;
      opacity: 0.95;
    }
    .wfs-sidenav {
      background: var(--sidenav);
      color: rgba(235, 240, 247, 0.82);
      padding: 8px 8px 24px;
      overflow: auto;
      scrollbar-width: none;
    }
    .wfs-sidenav::-webkit-scrollbar { display: none; }
    .wfs-nav-group { margin-bottom: 8px; }
    .wfs-nav-group-title {
      display: flex;
      align-items: center;
      height: 44px;
      padding: 0 12px;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      letter-spacing: 0.02em;
      user-select: none;
    }
    .wfs-nav-item {
      display: flex;
      align-items: center;
      height: 36px;
      margin: 2px 4px;
      padding: 0 12px 0 18px;
      border-radius: 6px;
      color: rgba(235, 240, 247, 0.82);
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wfs-nav-item:hover {
      background: rgba(255,255,255,0.06);
      color: #fff;
    }
    .wfs-nav-item.is-active {
      background: rgba(230, 234, 245, 0.18);
      color: #fff;
      font-weight: 600;
    }
    .wfs-main {
      padding: 20px 24px 32px;
      min-width: 0;
      color: var(--text);
      background: var(--bg);
    }

    /* —— Page chrome —— */
    .wfs-page-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    .wfs-page-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.02em;
    }
    .wfs-page-desc {
      margin: 6px 0 0;
      font-size: 13px;
      color: var(--muted);
    }
    .wfs-page-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
    }
    .wfs-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .wfs-card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 20px;
      background: var(--surface);
      margin-bottom: 12px;
    }
    .wfs-card + .wfs-card { margin-top: 0; }
    .wfs-card--spaced { margin-top: 24px; }
    .wfs-note {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: #fafbfc;
      color: var(--muted);
      font-size: 12px;
    }
    .wfs-stack { display: flex; flex-direction: column; gap: 12px; }

    /* —— Buttons —— */
    .wfs-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 14px;
      border-radius: var(--radius);
      border: 1px solid var(--brand);
      background: var(--brand);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }
    .wfs-btn--ghost {
      background: var(--surface);
      color: var(--brand);
    }
    .wfs-btn--muted {
      background: var(--surface);
      border-color: var(--line);
      color: var(--text);
      font-weight: 500;
    }
    .wfs-btn--danger {
      background: var(--surface);
      border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
      color: var(--danger);
    }
    .wfs-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .wfs-actions--end { justify-content: flex-end; }
    .wfs-actions--split { justify-content: space-between; }
    .wfs-spacer { flex: 1; }

    /* —— Badges / chips —— */
    .wfs-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 12px;
      background: #f3f4f6;
      color: var(--text);
    }
    .wfs-badge--ok { background: #e8f7ee; border-color: #b7e0c5; color: var(--success); }
    .wfs-badge--warn { background: #fff6e5; border-color: #f0d9a8; color: #8a5a00; }
    .wfs-badge--muted { background: #f3f4f6; color: var(--muted); }
    .wfs-chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
    .wfs-chip {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
    }
    .wfs-chip.is-selected,
    .wfs-chip input:checked + span {
      border-color: var(--brand);
      background: #eef4ff;
      color: var(--brand);
      font-weight: 600;
    }
    .wfs-chip input { margin-right: 6px; }

    /* —— Tabs —— */
    .wfs-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--line);
      margin-bottom: 14px;
      background: transparent;
    }
    .wfs-tab {
      padding: 10px 16px;
      border: 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      color: var(--muted);
      background: transparent;
      font-size: 13px;
    }
    .wfs-tab.is-active {
      color: var(--brand);
      font-weight: 700;
      border-bottom-color: var(--brand);
    }

    /* —— Filters / list —— */
    .wfs-filters {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 12px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .wfs-filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
    }
    .wfs-filter-field { min-width: 160px; flex: 1 1 160px; max-width: 240px; }
    .wfs-search { min-width: 220px; flex: 1 1 220px; max-width: 360px; }
    .wfs-data-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .wfs-data-bar strong { color: var(--ink); font-weight: 700; }
    .wfs-table-wrap {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: auto;
      background: var(--surface);
    }
    .wfs-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
    }
    .wfs-table th,
    .wfs-table td {
      padding: 10px 12px;
      text-align: left;
      vertical-align: middle;
      border-bottom: 1px solid var(--line);
    }
    .wfs-table th {
      position: sticky;
      top: 0;
      background: #f9fafb;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
      font-size: 12px;
      z-index: 1;
    }
    .wfs-table tbody tr:hover td { background: #f7f9fc; }
    .wfs-table tbody tr:last-child td { border-bottom: 0; }
    .wfs-paging {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .wfs-empty {
      padding: 48px 16px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }

    /* —— Form / wizard —— */
    .wfs-steps {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .wfs-step-dot {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      color: var(--muted);
      background: var(--surface);
    }
    .wfs-step-dot.is-done {
      border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
      color: var(--brand);
      background: #f3f7ff;
    }
    .wfs-step-dot.is-active {
      background: var(--brand);
      color: #fff;
      border-color: var(--brand);
      font-weight: 700;
    }
    .wfs-section {
      margin-bottom: 20px;
      padding-bottom: 4px;
    }
    .wfs-section-title {
      margin: 0 0 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
      font-weight: 700;
      color: var(--ink);
    }
    .wfs-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 18px;
    }
    .wfs-field { margin: 0; min-width: 0; }
    .wfs-field--full { grid-column: 1 / -1; }
    .wfs-field-label {
      display: block;
      margin-bottom: 6px;
      font-weight: 700;
      font-size: 13px;
      color: var(--ink);
    }
    .wfs-field-label .req { color: var(--danger); margin-left: 3px; }
    .wfs-field-hint {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
    }
    .wfs-field-error {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: var(--danger);
    }
    .wfs-char-count {
      display: block;
      margin-top: 4px;
      text-align: right;
      font-size: 11px;
      color: var(--muted);
    }
    .wfs-input,
    .wfs-select,
    .wfs-textarea {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 7px 10px;
      background: var(--surface);
      color: var(--text);
    }
    .wfs-input:focus,
    .wfs-select:focus,
    .wfs-textarea:focus {
      outline: none;
      border-color: var(--brand);
      box-shadow: 0 0 0 3px rgba(36, 107, 235, 0.12);
    }
    .wfs-textarea { min-height: 88px; resize: vertical; }
    .wfs-radio-group { display: flex; flex-direction: column; gap: 8px; }
    .wfs-radio,
    .wfs-check {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .wfs-choice-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }
    .wfs-choice-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      text-align: left;
    }
    .wfs-choice-card strong { font-size: 14px; color: var(--ink); }
    .wfs-choice-card span { font-size: 12px; color: var(--muted); }
    .wfs-choice-card.is-selected {
      border-color: var(--brand);
      background: #eef4ff;
      box-shadow: inset 0 0 0 1px var(--brand);
    }
    .wfs-dropzone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 120px;
      padding: 20px;
      border: 1px dashed color-mix(in srgb, var(--brand) 40%, var(--line));
      border-radius: 8px;
      background: #f7f9fc;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .wfs-dropzone strong { color: var(--brand); font-weight: 700; }
    .wfs-file-list {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .wfs-file-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: 12px;
    }
    .wfs-repeat-list { display: flex; flex-direction: column; gap: 8px; }
    .wfs-repeat-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      align-items: end;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: #fafbfc;
    }

    /* —— Detail —— */
    .wfs-dl-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--surface);
    }
    .wfs-dl-item {
      display: grid;
      grid-template-columns: 140px 1fr;
      border-bottom: 1px solid var(--line);
      border-right: 1px solid var(--line);
      min-height: 44px;
    }
    .wfs-dl-item:nth-child(2n) { border-right: 0; }
    .wfs-dl-item:nth-last-child(-n+2) { border-bottom: 0; }
    .wfs-dl-label {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      background: #f9fafb;
      font-weight: 700;
      font-size: 12px;
      color: var(--ink);
    }
    .wfs-dl-value {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      color: var(--text);
    }

    /* —— Modal / toast —— */
    .wfs-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.35);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 50;
    }
    .wfs-modal.is-open { display: flex; }
    .wfs-modal-panel {
      width: min(480px, 100%);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 12px 40px rgba(0,0,0,.18);
    }
    .wfs-modal-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 700;
      color: var(--ink);
    }
    .wfs-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--ink);
      color: #fff;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2);
      z-index: 60;
    }

    @media (max-width: 900px) {
      .wfs-app { grid-template-columns: 1fr; }
      .wfs-sidenav { display: none; }
      .wfs-form-grid { grid-template-columns: 1fr; }
      .wfs-dl-grid { grid-template-columns: 1fr; }
      .wfs-dl-item { border-right: 0; }
      .wfs-repeat-row { grid-template-columns: 1fr; }
    }
  `.trim();
}

export async function buildShellHtml(project: ResolvedProject): Promise<string> {
  const raw = await readFile(project.outputs.design, "utf8");
  const design = JSON.parse(raw) as DesignJson;
  const colors = pickColors(design.color);

  let routes: RoutesJson | null = null;
  try {
    routes = JSON.parse(await readFile(project.outputs.routes, "utf8")) as RoutesJson;
  } catch {
    routes = null;
  }
  const sidenav = sidenavFromRoutes(routes, project.title);
  const mdNote = await designMdNote(project);

  const sideNavWidth = design.layout?.sideNavWidth ?? "220px";
  const topNavHeight = design.layout?.topNavHeight ?? "50px";
  const radius = design.radius?.card ?? design.radius?.control ?? "4px";
  const font = design.type?.family ?? 'Pretendard, "Malgun Gothic", sans-serif';
  const css = shellCssKit(colors, { sideNavWidth, topNavHeight, radius, font });

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${project.title} wireframe shell</title>
  ${mdNote}
  <style>
${css}
  </style>
</head>
<body>
  <div class="wfs-app">
    <header class="wfs-topnav">
      <div class="wfs-topnav-brand">
        <span class="wfs-topnav-logo">WON</span>
        <span>${project.title}</span>
      </div>
      <div class="wfs-topnav-right">
        <span class="wfs-topnav-chip">콘텐츠팀</span>
        <span class="wfs-topnav-user">김퍼블</span>
      </div>
    </header>
    <aside class="wfs-sidenav">
      ${sidenav}
    </aside>
    <main class="wfs-main">
      <div class="wfs-page-head">
        <div>
          <h1 class="wfs-page-title">소재 요청 목록</h1>
          <p class="wfs-page-desc">셸 데모 — 목록 패턴 (필터 · 표 · 페이징)</p>
        </div>
        <div class="wfs-page-actions">
          <button class="wfs-btn wfs-btn--muted" type="button">새로고침</button>
          <button class="wfs-btn" type="button">신규 요청</button>
        </div>
      </div>

      <div class="wfs-filters">
        <div class="wfs-filter-row">
          <div class="wfs-field wfs-search">
            <label class="wfs-field-label">검색</label>
            <input class="wfs-input" placeholder="요청명 · 광고주">
          </div>
          <div class="wfs-field wfs-filter-field">
            <label class="wfs-field-label">유형</label>
            <select class="wfs-select"><option>전체</option><option>이미지</option><option>영상</option></select>
          </div>
          <div class="wfs-field wfs-filter-field">
            <label class="wfs-field-label">상태</label>
            <select class="wfs-select"><option>전체</option><option>진행</option><option>완료</option></select>
          </div>
          <button class="wfs-btn wfs-btn--ghost" type="button">조회</button>
        </div>
      </div>

      <div class="wfs-data-bar"><span>총 <strong>128</strong>건</span><span class="wfs-badge wfs-badge--muted">샘플</span></div>
      <div class="wfs-table-wrap">
        <table class="wfs-table">
          <thead>
            <tr><th>요청번호</th><th>제목</th><th>유형</th><th>상태</th><th>요청일</th></tr>
          </thead>
          <tbody>
            <tr><td>CR-1001</td><td>봄 시즌 배너</td><td>이미지</td><td><span class="wfs-badge wfs-badge--ok">진행</span></td><td>2026-03-01</td></tr>
            <tr><td>CR-1002</td><td>브랜드 필름</td><td>영상</td><td><span class="wfs-badge wfs-badge--warn">대기</span></td><td>2026-03-02</td></tr>
            <tr><td>CR-1003</td><td>프로모션 컷</td><td>이미지</td><td><span class="wfs-badge wfs-badge--muted">완료</span></td><td>2026-03-03</td></tr>
          </tbody>
        </table>
      </div>
      <div class="wfs-paging"><button class="wfs-btn wfs-btn--muted" type="button">이전</button><span>1 / 13</span><button class="wfs-btn wfs-btn--muted" type="button">다음</button></div>

      <div class="wfs-card wfs-card--spaced">
        <div class="wfs-section">
          <h2 class="wfs-section-title">폼 패턴 미리보기</h2>
          <div class="wfs-steps">
            <span class="wfs-step-dot is-done">1. 유형</span>
            <span class="wfs-step-dot is-active">2. 공통 정보</span>
            <span class="wfs-step-dot">3. 확인</span>
          </div>
          <div class="wfs-choice-grid">
            <label class="wfs-choice-card is-selected"><strong>이미지</strong><span>정지 소재</span></label>
            <label class="wfs-choice-card"><strong>영상</strong><span>모션 · 필름</span></label>
          </div>
        </div>
        <div class="wfs-form-grid">
          <div class="wfs-field"><label class="wfs-field-label">랜딩페이지<span class="req">*</span></label><input class="wfs-input" placeholder="URL"></div>
          <div class="wfs-field"><label class="wfs-field-label">지면<span class="req">*</span></label><select class="wfs-select"><option>선택</option></select></div>
          <div class="wfs-field wfs-field--full">
            <label class="wfs-field-label">레퍼런스</label>
            <div class="wfs-dropzone"><strong>파일 선택</strong><span>또는 이 영역에 파일을 놓으세요</span></div>
          </div>
        </div>
        <div class="wfs-actions wfs-actions--end">
          <button class="wfs-btn wfs-btn--muted" type="button">임시저장</button>
          <button class="wfs-btn wfs-btn--ghost" type="button">이전</button>
          <button class="wfs-btn" type="button">다음</button>
        </div>
      </div>
    </main>
  </div>
</body>
</html>
`;

  return writeProjectText(project, "shell", html);
}
