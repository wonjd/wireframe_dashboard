import type { WireframeMode } from "@wireframe-studio/core";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.js";

export type GenerateContext = {
  mode: WireframeMode;
  prdText: string;
  projectSlug: string;
  feature: string;
  scan?: Record<string, unknown>;
};

/** Claude Code / Artifact에 붙여넣을 프롬프트 (API 키 없이 로컬 생성용) */
export function buildGenerationPrompt(ctx: GenerateContext): string {
  const parts = [SYSTEM_PROMPT, "", userPrompt(ctx.prdText)];

  if (ctx.mode === "new") {
    parts.unshift(
      "[MODE: NEW]",
      "design-kit 클래스만 사용한다. 기존 프로젝트 스캔 결과는 없다.",
      ""
    );
  } else {
    parts.unshift(
      "[MODE: EXISTING]",
      "아래 감지 결과(도메인·DB·프레임워크)의 용어·레이아웃을 따른다.",
      "```json",
      JSON.stringify(ctx.scan ?? { note: "감지 미실행" }, null, 2),
      "```",
      ""
    );
  }

  parts.push(
    "",
    "출력: 화면(이슈)마다 HTML 1파일. 파일명 = 이슈 id.",
    "최상위 이슈 = epic(PRD 기능). 하위 화면 = wireFrame/issue/{id}.html",
    "색상·아이콘 없이 회색 와이어. 클릭/탭/모달/select 동작만 확인하면 된다.",
    `경로: wireFrame/issue/{id}.html`
  );

  return parts.join("\n");
}

export { buildDocument } from "./shell.js";
export { buildSpecDocument } from "./spec.js";
