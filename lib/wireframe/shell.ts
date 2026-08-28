/**
 * 와이어프레임 HTML 셸 — 스타일시트와 동작 런타임.
 *
 * LLM은 화면 마크업만 만든다. 룩앤필(CSS)과 동작(JS)은 여기 고정본을 주입한다.
 * 그래서 (1) 모델이 뱉는 토큰이 줄어 생성이 빨라지고, (2) 모델이 스크립트를
 * 잘못 써도 화면 전환·모달·탭이 항상 같은 방식으로 동작한다.
 *
 * 결과물은 sandbox iframe(allow-scripts, same-origin 없음)에서만 그려진다 —
 * 모델이 만든 마크업이 부모 앱의 DOM·쿠키에 닿을 수 없는 격리 지점이다.
 */

/** 모델이 쓸 수 있는 클래스 — 프롬프트의 목록과 이 CSS가 같은 집합이어야 한다. */
const STYLES = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font: 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  color: #404040; background: #fff; -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { margin: 0; color: #262626; font-weight: 600; }
h1 { font-size: 19px; } h2 { font-size: 15px; } h3 { font-size: 13px; }
p { margin: 0; color: #525252; }
small, .wf-muted { color: #a3a3a3; font-size: 12px; }
hr { border: 0; border-top: 1px solid #e5e5e5; margin: 4px 0; }
a { color: inherit; text-decoration: none; }

/* --- 셸이 그리는 상단 크롬 --- */
.wf-chrome {
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-bottom: 1px solid #e5e5e5; background: #fafafa; font-size: 12px;
}
.wf-chrome-dots { display: flex; gap: 4px; }
.wf-chrome-dots i { width: 7px; height: 7px; border-radius: 50%; background: #d4d4d4; }
.wf-chrome-name { font-weight: 500; color: #525252; }
.wf-chrome-route {
  padding: 1px 6px; border: 1px solid #e5e5e5; border-radius: 3px;
  background: #fff; color: #a3a3a3; font-family: ui-monospace, monospace; font-size: 11px;
}
.wf-chrome-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.wf-chrome button, .wf-chrome select {
  height: 24px; padding: 0 8px; border: 1px solid #d4d4d4; border-radius: 4px;
  background: #fff; color: #525252; font: inherit; font-size: 11.5px; cursor: pointer;
}
.wf-chrome button:hover { background: #f5f5f5; }

/* --- 화면 --- */
[data-screen] { display: none; min-height: 420px; }
[data-screen].wf-active { display: block; }
.wf-shell { display: flex; min-height: 420px; }
.wf-body { flex: 1; min-width: 0; padding: 16px; display: grid; gap: 12px; align-content: start; }

/* --- 레이아웃 --- */
.wf-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.wf-row > * { flex: 1; min-width: 120px; }
.wf-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; align-items: start; }
.wf-span-2 { grid-column: span 2; } .wf-span-3 { grid-column: span 3; }
.wf-span-4 { grid-column: span 4; } .wf-span-6 { grid-column: span 6; }
.wf-span-8 { grid-column: span 8; } .wf-span-9 { grid-column: span 9; }
.wf-span-12 { grid-column: span 12; }

.wf-sidebar {
  width: 190px; flex: none; padding: 12px; border-right: 1px solid #e5e5e5; background: #fafafa;
}
.wf-sidebar-title { padding: 4px 8px 10px; color: #737373; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.wf-sidebar a, .wf-sidebar button {
  display: block; width: 100%; padding: 7px 10px; margin-bottom: 2px; border: 0; border-radius: 4px;
  background: none; color: #525252; font: inherit; text-align: left; cursor: pointer;
}
.wf-sidebar a:hover, .wf-sidebar button:hover { background: #ededed; }
.wf-sidebar .wf-on { background: #e5e5e5; color: #262626; font-weight: 500; }

.wf-topnav {
  display: flex; align-items: center; gap: 4px; padding: 8px 12px;
  border-bottom: 1px solid #e5e5e5; background: #fff;
}
.wf-topnav button, .wf-topnav a {
  padding: 5px 10px; border: 0; border-radius: 4px; background: none;
  color: #525252; font: inherit; cursor: pointer;
}
.wf-topnav button:hover, .wf-topnav a:hover { background: #f5f5f5; }
.wf-topnav .wf-on { background: #ededed; color: #262626; font-weight: 500; }

.wf-header { display: flex; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e5e5; }
.wf-header .wf-actions { margin-left: auto; display: flex; gap: 6px; }

.wf-card { padding: 14px; border: 1px solid #e5e5e5; border-radius: 6px; background: #fff; }
.wf-card > * + * { margin-top: 10px; }
.wf-card-title { font-size: 13px; font-weight: 500; color: #404040; }

/* --- 컨트롤 --- */
.wf-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px;
  border: 1px solid #d4d4d4; border-radius: 5px; background: #fff;
  color: #404040; font: inherit; cursor: pointer; white-space: nowrap;
}
.wf-btn:hover { background: #f5f5f5; }
.wf-btn.wf-primary { border-color: #404040; background: #404040; color: #fff; }
.wf-btn.wf-primary:hover { background: #262626; }
.wf-btn.wf-danger { border-color: #fca5a5; color: #dc2626; }

.wf-field { display: block; }
.wf-field > span, .wf-label { display: block; margin-bottom: 4px; color: #737373; font-size: 11.5px; }
input, select, textarea, .wf-input {
  width: 100%; min-height: 32px; padding: 6px 9px; border: 1px solid #d4d4d4; border-radius: 5px;
  background: #fff; color: #404040; font: inherit;
}
input::placeholder, textarea::placeholder { color: #a3a3a3; }
input[type="checkbox"], input[type="radio"] { width: auto; min-height: 0; margin-right: 6px; vertical-align: -1px; }
.wf-check { display: flex; align-items: center; gap: 2px; color: #525252; }
.wf-check input { flex: none; }

/* --- 데이터 --- */
table { width: 100%; border-collapse: collapse; border: 1px solid #e5e5e5; border-radius: 6px; overflow: hidden; }
thead { background: #fafafa; }
th { padding: 8px 10px; text-align: left; color: #525252; font-weight: 500; font-size: 12px; }
td { padding: 8px 10px; border-top: 1px solid #f0f0f0; color: #737373; }
tbody tr[data-nav]:hover, tbody tr[data-modal-open]:hover { background: #fafafa; }

.wf-list { border: 1px solid #e5e5e5; border-radius: 6px; overflow: hidden; }
.wf-list > * { padding: 9px 12px; border-top: 1px solid #f0f0f0; }
.wf-list > *:first-child { border-top: 0; }

.wf-stats { display: flex; flex-wrap: wrap; gap: 12px; }
.wf-stat { flex: 1; min-width: 120px; padding: 12px 14px; border: 1px solid #e5e5e5; border-radius: 6px; }
.wf-stat b { display: block; margin-top: 4px; color: #262626; font-size: 19px; font-weight: 600; }

.wf-image {
  display: flex; align-items: center; justify-content: center; min-height: 100px;
  border: 1px dashed #d4d4d4; border-radius: 6px; background: #fafafa; color: #a3a3a3; font-size: 12px;
}
.wf-badge {
  display: inline-block; padding: 1px 7px; border: 1px solid #e5e5e5; border-radius: 999px;
  background: #fafafa; color: #737373; font-size: 11.5px;
}
.wf-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.wf-toolbar .wf-spacer { margin-left: auto; }

/* --- 탭 --- */
.wf-tabs { display: flex; gap: 2px; border-bottom: 1px solid #e5e5e5; }
.wf-tabs button {
  padding: 7px 12px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  background: none; color: #737373; font: inherit; cursor: pointer;
}
.wf-tabs button:hover { color: #404040; }
.wf-tabs button.wf-on { border-bottom-color: #404040; color: #262626; font-weight: 500; }
[data-tabpanel] { display: none; }
[data-tabpanel].wf-active { display: grid; gap: 12px; align-content: start; padding-top: 12px; }

/* --- 모달 --- */
.wf-backdrop {
  position: fixed; inset: 0; z-index: 30; display: none;
  align-items: center; justify-content: center; padding: 24px; background: rgba(23, 23, 23, .38);
}
.wf-backdrop.wf-active { display: flex; }
[data-modal] { display: none; }
[data-modal].wf-active {
  display: block; width: 100%; max-width: 460px; border: 1px solid #d4d4d4; border-radius: 8px;
  background: #fff; box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
}
.wf-modal-head { display: flex; align-items: center; padding: 11px 14px; border-bottom: 1px solid #e5e5e5; }
.wf-modal-head h2, .wf-modal-head h3 { font-size: 13.5px; }
.wf-modal-head .wf-x { width: auto; min-height: 0; margin-left: auto; padding: 0 4px; border: 0; background: none; color: #a3a3a3; font-size: 15px; cursor: pointer; }
.wf-modal-body { display: grid; gap: 12px; padding: 14px; }
.wf-modal-foot { display: flex; justify-content: flex-end; gap: 6px; padding: 11px 14px; border-top: 1px solid #e5e5e5; }

[data-nav], [data-modal-open], [data-modal-close] { cursor: pointer; }
`;

/**
 * 동작 런타임 — 화면 전환 / 모달 / 탭 / 뒤로가기.
 *
 * 모델은 data-* 속성만 붙이고 상태 전이는 전부 여기서 한다. 없는 화면 id 같은
 * 잘못된 대상은 무시한다 — 죽은 클릭 하나가 화면 전체를 깨뜨리지 않도록.
 */
const RUNTIME = `(function () {
  var screens = [].slice.call(document.querySelectorAll("[data-screen]"));
  if (!screens.length) return;

  var stack = [];
  var backdrop = document.createElement("div");
  backdrop.className = "wf-backdrop";
  document.body.appendChild(backdrop);

  // 모달은 화면 안 어디에 쓰여 있든 백드롭으로 옮겨 중앙에 띄운다.
  [].slice.call(document.querySelectorAll("[data-modal]")).forEach(function (m) {
    backdrop.appendChild(m);
  });

  var chrome = document.createElement("div");
  chrome.className = "wf-chrome";
  chrome.innerHTML =
    '<span class="wf-chrome-dots"><i></i><i></i><i></i></span>' +
    '<span class="wf-chrome-name"></span><code class="wf-chrome-route"></code>' +
    '<span class="wf-chrome-right">' +
    '<button type="button" class="wf-back" hidden>\\u2190 \\uB4A4\\uB85C</button>' +
    '<select class="wf-pick" aria-label="\\uD654\\uBA74 \\uC120\\uD0DD"></select></span>';
  document.body.insertBefore(chrome, document.body.firstChild);

  var nameEl = chrome.querySelector(".wf-chrome-name");
  var routeEl = chrome.querySelector(".wf-chrome-route");
  var backEl = chrome.querySelector(".wf-back");
  var pickEl = chrome.querySelector(".wf-pick");

  screens.forEach(function (s, i) {
    if (!s.id) s.id = s.getAttribute("data-screen") || "screen-" + i;
    var opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.getAttribute("data-name") || s.id;
    pickEl.appendChild(opt);
  });

  function byId(id) {
    if (!id) return null;
    for (var i = 0; i < screens.length; i++) {
      if (screens[i].id === id || screens[i].getAttribute("data-screen") === id) return screens[i];
    }
    return null;
  }

  function closeModal() {
    backdrop.classList.remove("wf-active");
    [].slice.call(backdrop.children).forEach(function (m) { m.classList.remove("wf-active"); });
  }

  function openModal(id) {
    var m = document.getElementById(id) || backdrop.querySelector('[data-modal="' + id + '"]');
    if (!m) return;
    closeModal();
    m.classList.add("wf-active");
    backdrop.classList.add("wf-active");
  }

  function show(target, push) {
    var next = byId(target);
    if (!next) return;
    var cur = document.querySelector("[data-screen].wf-active");
    if (cur === next) return;
    if (cur && push) stack.push(cur.id);
    closeModal();
    screens.forEach(function (s) { s.classList.remove("wf-active"); });
    next.classList.add("wf-active");

    nameEl.textContent = next.getAttribute("data-name") || next.id;
    var route = next.getAttribute("data-route") || "";
    routeEl.textContent = route;
    routeEl.hidden = !route;
    backEl.hidden = stack.length === 0;
    pickEl.value = next.id;

    // 사이드바·탑네비에서 현재 화면 항목을 강조한다.
    [].slice.call(next.querySelectorAll("[data-nav]")).forEach(function (el) {
      el.classList.toggle("wf-on", el.getAttribute("data-nav") === next.id);
    });
    window.scrollTo(0, 0);
  }

  function activateTab(btn) {
    var bar = btn.parentNode;
    while (bar && !(bar.classList && bar.classList.contains("wf-tabs"))) bar = bar.parentNode;
    if (!bar) return;
    [].slice.call(bar.querySelectorAll("button")).forEach(function (b) { b.classList.remove("wf-on"); });
    btn.classList.add("wf-on");
    var scope = bar.parentNode || document;
    [].slice.call(scope.querySelectorAll("[data-tabpanel]")).forEach(function (p) { p.classList.remove("wf-active"); });
    var panel = document.getElementById(btn.getAttribute("data-tab"));
    if (panel) panel.classList.add("wf-active");
  }

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest
      ? e.target.closest("[data-tab],[data-modal-close],[data-modal-open],[data-nav]")
      : null;
    if (!el) return;
    e.preventDefault();
    if (el.hasAttribute("data-tab")) return activateTab(el);
    if (el.hasAttribute("data-modal-close")) return closeModal();
    if (el.hasAttribute("data-modal-open")) return openModal(el.getAttribute("data-modal-open"));
    show(el.getAttribute("data-nav"), true);
  });

  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  document.addEventListener("submit", function (e) { e.preventDefault(); });

  backEl.addEventListener("click", function () {
    var prev = stack.pop();
    if (prev) show(prev, false);
    backEl.hidden = stack.length === 0;
  });
  pickEl.addEventListener("change", function () { show(pickEl.value, true); });

  // 탭 그룹마다 첫 탭을 열어 둔다.
  [].slice.call(document.querySelectorAll(".wf-tabs")).forEach(function (bar) {
    var first = bar.querySelector("button[data-tab]");
    if (first) activateTab(first);
  });

  show(screens[0].getAttribute("data-screen") || screens[0].id, false);
})();`;

/** 모델이 만든 마크업을 그대로 그릴 수 있는 완결된 문서로 감싼다. */
export function buildDocument(markup: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>와이어프레임</title>
<style>${STYLES}</style>
</head>
<body>
${stripDocumentWrapper(markup)}
<script>${RUNTIME}</script>
</body>
</html>`;
}

/**
 * 모델이 지시를 어기고 문서 전체를 만들어 왔을 때 본문만 꺼낸다.
 *
 * 모델이 딸려 보낸 style·script는 버린다. 셸이 주는 것과 겹쳐 동작이 두 번
 * 걸리거나 레이아웃이 어긋나느니, 한쪽으로 통일하는 편이 결과가 일정하다.
 */
function stripDocumentWrapper(markup: string): string {
  let out = markup.trim();

  const bodyOpen = out.search(/<body[^>]*>/i);
  if (bodyOpen !== -1) {
    const start = out.indexOf(">", bodyOpen) + 1;
    const end = out.search(/<\/body>/i);
    out = out.slice(start, end === -1 ? undefined : end);
  } else {
    out = out.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(html|head)[^>]*>/gi, "");
  }

  return out
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .trim();
}

/** 문서에 담긴 화면 수 — 헤더 표시에 쓴다. */
export function countScreens(html: string): number {
  return (html.match(/data-screen=/gi) ?? []).length;
}
