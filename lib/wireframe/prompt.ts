/** 빠른 초안 생성용 — 짧은 프롬프트, 화면 수 최소화. */

export const SYSTEM_PROMPT = `PRD를 읽고 어드민 와이어프레임 IR(JSON) 초안을 만든다.

규칙:
- JSON 객체만 출력한다. 설명·마크다운·코드펜스 금지.
- screens는 핵심만 1~6개, 최대 6개를 넘기지 않는다. 보통 목록 + 상세(+ 필요 시 편집).
- layout "sidebar-left" + sidebar 메뉴, 목록은 search/table, 상세는 card.
- 가능하면 sidebar·버튼에 navigate action을 붙인다. modal은 있으면 좋고 없어도 된다.
- 카피는 PRD 용어 그대로. table sampleRows는 2행 이내.
- 노드 id는 kebab-case.`;

export function userPrompt(sourceText: string): string {
  return `와이어프레임 IR을 만들어라.

<prd>
${sourceText}
</prd>`;
}
