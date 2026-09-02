import { readFile } from "node:fs/promises";
import type { ResolvedProject } from "../lib/config.js";
import { writeProjectText } from "../lib/paths.js";

type DesignJson = {
  color?: Record<string, string>;
  layout?: {
    sideNavWidth?: string;
    topNavHeight?: string;
  };
};

export async function buildShellHtml(project: ResolvedProject): Promise<string> {
  const raw = await readFile(project.outputs.design, "utf8");
  const design = JSON.parse(raw) as DesignJson;

  const primary = design.color?.["token-1"] ?? "#246beb";
  const ink = design.color?.["token-2"] ?? "#333333";
  const line = design.color?.["token-3"] ?? "#dddddd";
  const sideNavWidth = design.layout?.sideNavWidth ?? "220px";
  const topNavHeight = design.layout?.topNavHeight ?? "50px";

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${project.title} wireframe shell</title>
  <style>
    :root {
      --brand: ${primary};
      --ink: ${ink};
      --line: ${line};
      --radius: 4px;
      --font: Pretendard, "Malgun Gothic", sans-serif;
      --topnav-h: ${topNavHeight};
      --sidenav-w: ${sideNavWidth};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      color: var(--ink);
      background: #fff;
      font-size: 13px;
      line-height: 1.5;
    }
    .wfs-app {
      display: grid;
      grid-template-columns: var(--sidenav-w) 1fr;
      min-height: 100vh;
    }
    .wfs-topnav {
      grid-column: 1 / -1;
      height: var(--topnav-h);
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      padding: 0 16px;
      font-weight: 600;
    }
    .wfs-sidenav {
      border-right: 1px solid var(--line);
      padding: 12px;
      background: #fafafa;
    }
    .wfs-main { padding: 16px 20px; }
    .wfs-card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      background: #fff;
    }
    .wfs-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 0 12px;
      border-radius: var(--radius);
      border: 1px solid var(--brand);
      background: var(--brand);
      color: #fff;
      font: inherit;
    }
    .wfs-btn--ghost {
      background: #fff;
      color: var(--brand);
    }
    .wfs-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
    }
    .wfs-table th,
    .wfs-table td {
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
    }
    .wfs-table th { background: #f9f9f9; }
    .wfs-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wfs-app">
    <header class="wfs-topnav">${project.title} Wireframe Shell</header>
    <aside class="wfs-sidenav">nav</aside>
    <main class="wfs-main">
      <div class="wfs-card">
        <p>shell placeholder — screens render inside artifact HTML using these classes only.</p>
        <button class="wfs-btn" type="button">primary</button>
        <button class="wfs-btn wfs-btn--ghost" type="button">ghost</button>
      </div>
    </main>
  </div>
</body>
</html>
`;

  return writeProjectText(project, "shell", html);
}
