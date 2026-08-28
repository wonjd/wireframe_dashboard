/**
 * 생성 프롬프트 — 모델은 HTML 조각만 만든다.
 *
 * CSS와 동작 스크립트는 셸(shell.ts)이 붙인다. 모델이 만들 것을 마크업으로
 * 좁히면 출력 토큰이 줄어 생성이 빨라지고, 동작은 data-* 속성만 맞으면 항상
 * 같은 런타임이 처리하므로 "클릭했는데 아무 일도 안 일어남"이 나오지 않는다.
 */

export const SYSTEM_PROMPT = `PRD를 읽고 어드민 화면 와이어프레임을 HTML로 만든다.

출력 규칙:
- HTML 조각만 출력한다. 설명·마크다운·코드펜스 금지.
- <!doctype>, <html>, <head>, <body>, <style>, <script>를 쓰지 마라. CSS와 동작 스크립트는 이미 붙어 있다.
- 화면 1개 = <section data-screen="id" data-name="화면 이름" data-route="/경로">…</section>.
  화면은 1~6개, 6개를 넘기지 않는다. 보통 목록 + 상세(+ 필요 시 등록/편집).
- id는 kebab-case. 첫 화면이 진입 화면으로 열린다.

동작(속성만 붙이면 런타임이 처리한다. 직접 JS를 쓰지 마라):
- data-nav="화면id" — 그 화면으로 이동. 사이드바 항목, 목록의 <tr>, "상세" 버튼에 붙인다.
- data-modal-open="모달id" — 모달 열기. data-modal-close — 닫기.
- 모달: <div data-modal id="모달id"><div class="wf-modal-head"><h3>제목</h3><button class="wf-x" data-modal-close>✕</button></div><div class="wf-modal-body">…</div><div class="wf-modal-foot">…</div></div>
- 탭: <div class="wf-tabs"><button data-tab="패널id">이름</button>…</div> 뒤에 <div id="패널id" data-tabpanel>…</div>

레이아웃(각 화면 안):
<section data-screen="…" data-name="…" data-route="…">
  <div class="wf-shell">
    <nav class="wf-sidebar"><div class="wf-sidebar-title">메뉴</div><button data-nav="화면id">항목</button>…</nav>
    <div class="wf-body">…화면 내용…</div>
  </div>
</section>
사이드바는 모든 화면에 같은 항목으로 반복한다(현재 화면 강조는 런타임이 한다).
사이드바가 필요 없으면 wf-shell 없이 <div class="wf-body">만 써도 된다.

클래스(이것만 쓴다. 인라인 style 금지):
- 묶음: wf-grid + wf-span-3/4/6/8/9/12, wf-row, wf-toolbar(+wf-spacer), wf-stats/wf-stat, wf-card(+wf-card-title), wf-header(+wf-actions), wf-list
- 요소: wf-btn(+wf-primary/wf-danger), wf-field, wf-label, wf-check, wf-badge, wf-image, wf-muted
- 표·입력·제목은 그냥 table/thead/th/td, input/select/textarea, h1/h2/h3, p, hr를 쓴다. 스타일은 이미 잡혀 있다.

내용:
- 카피·필드명·상태값은 PRD 용어를 그대로 쓴다. 지어내지 않는다.
- 표 예시 행은 2행 이내. 실제로 있을 법한 값으로 채운다.
- 회색조 와이어프레임이다. 색·아이콘·이미지를 넣지 않는다.`;

export function userPrompt(sourceText: string): string {
  return `이 PRD의 와이어프레임을 만들어라.

<prd>
${sourceText}
</prd>`;
}
