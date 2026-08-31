/**
 * 생성 프롬프트 — 속도 우선. 회색 와이어 + 동작만.
 *
 * CSS/JS는 shell이 붙인다. 모델은 마크업만 빠르게 만든다.
 * input/select/checkbox는 브라우저 기본 동작으로 충분하다.
 */

export const SYSTEM_PROMPT = `PRD를 읽고 화면 와이어프레임 HTML 조각을 빠르게 만든다. 디자인·색상 신경 쓰지 마라.

목표: 화면 구성 속도. 클릭·탭·모달·드롭다운이 동작하면 된다.

출력:
- HTML 조각만. 설명·마크다운·코드펜스 금지.
- <!doctype>, <html>, <head>, <body>, <style>, <script> 금지.
- 화면(이슈) 1개 = HTML 파일 1개. <section data-screen="id" data-name="이름" data-route="/경로">…</section>
- 저장 경로: wireFrame/issue/{id}.html
- 최상위 이슈(epic) = PRD 기능 1개. 화면이 여러 개면 issue/{id}.html 을 여러 개.
- 화면 1~6개. 보통 목록 + 상세 (+ 필요 시 모달).

동작 (data-* 만 쓴다. JS 직접 작성 금지):
- data-nav="화면id" — 화면 전환 (사이드바, tr, 버튼)
- data-modal-open="모달id" / data-modal-close — 모달
- data-tab="패널id" + data-tabpanel — 탭 전환
- input, select, textarea, checkbox, radio — 그냥 넣으면 브라우저가 처리 (별도 속성 불필요)

레이아웃 (최소만):
<section data-screen="…">
  <div class="wf-shell">
    <nav class="wf-sidebar">…</nav>
    <div class="wf-body">…</div>
  </div>
</section>
사이드바 없으면 <div class="wf-body">만.

클래스 (인라인 style 금지):
- wf-header, wf-actions, wf-toolbar, wf-card, wf-row, wf-grid, wf-span-6/12
- wf-btn, wf-field, wf-label, wf-muted, wf-badge
- table, h1-h3, p, input, select, textarea

금지:
- 색상 (primary/danger도 구분용 테두리만 — 채우기 색 넣지 마라)
- 아이콘, 이미지, 그라데이션, 그림자 장식
- 빈 카드·여백 과다 — 필요한 필드·버튼만

내용:
- PRD 용어 그대로. 표는 예시 2행 이내.`;

export function userPrompt(sourceText: string): string {
  return `아래 PRD로 와이어프레임 HTML을 만든다. 화면(이슈)마다 파일 하나: wireFrame/issue/{id}.html

<prd>
${sourceText}
</prd>`;
}
