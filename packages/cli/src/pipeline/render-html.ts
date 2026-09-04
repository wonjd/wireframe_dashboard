import type {
  BlueprintField,
  DomainSpec,
  FieldBlueprint,
  ManifestArtifact,
  ProjectAssets,
} from "./build-pipeline.js";
import type {
  FeatureChild,
  FeatureGroup,
  FeaturesDoc,
  FlowDoc,
} from "./build-docs.js";
import type { StepSpec } from "./prd-parser.js";

export type RenderHints = {
  forceChoiceCards?: boolean;
  forceDropzone?: boolean;
  forceFullWidth?: boolean;
  forceRepeat?: boolean;
  showErrors?: boolean;
  preferList?: boolean;
  note?: string;
};

function polishLabel(label: string, column?: string): string {
  const keys = [column, label, label.replace(/\s+/g, "_")]
    .filter(Boolean)
    .map((v) => String(v).toUpperCase());
  const map: Record<string, string> = {
    CONTENT_DIV_CD: "콘텐츠 유형",
    CONTENT_DIV: "콘텐츠 유형",
    PROD_METHOD: "제작 방식",
    REF_TYPE: "레퍼런스 전달",
    REF_LINK: "레퍼런스 링크",
    CONTENT_STATE_CD: "진행 상태",
    CONTENT_STATE: "진행 상태",
    LANDING_URL: "랜딩페이지",
    END_TYPE: "종료 유형",
    END_REASON: "종료 사유",
    CONTRACT_TYPE_AT_END: "종료 시 계약 유형",
    JUDGMENT_TYPE: "판정 유형",
    STATUS: "상태",
  };
  for (const key of keys) {
    if (map[key]) return map[key]!;
    if (map[key.replace(/_CD$/, "")]) return map[key.replace(/_CD$/, "")]!;
  }
  if (/^[A-Z0-9_ ]{3,}$/.test(label) && !/[가-힣]/.test(label)) {
    return label
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return label;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wireframePageStyles(shellStyles: string): string {
  return `${shellStyles}
    html, body {
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--text, #333);
      background: #e8eaed;
    }
    .wfs-stage {
      height: 100%;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-sizing: border-box;
      padding: 16px;
    }
    .wfs-stage-frame {
      width: min(1100px, 94vw);
      height: min(720px, 90vh);
      max-width: 100%;
      max-height: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      background: var(--bg, #f5f6f8);
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(45, 53, 57, 0.14);
    }
    .wfs-stage-frame--modal {
      width: min(720px, 92vw);
      height: min(640px, 88vh);
      aspect-ratio: 5 / 4;
      background: transparent;
      box-shadow: none;
    }
    .wfs-stage-frame--modal .wfs-dlg-backdrop {
      flex: 1;
      min-height: 0;
      height: 100%;
      border-radius: 8px;
    }
    .wfs-main {
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 16px 20px 14px;
      background: var(--bg, #f5f6f8);
    }
    .wfs-page-head { flex-shrink: 0; margin-bottom: 12px; }
    .wfs-card {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .wfs-card > form {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .wfs-section { flex: 1; min-height: 0; overflow: hidden; }
    .wfs-form-grid, .wfs-dl-grid { overflow: hidden; }
    .wfs-actions { flex-shrink: 0; }
    .wfs-page-desc, .wfs-note, .wfs-field-hint { display: none !important; }
  `;
}

function parseInstructionHints(instructions: Array<{ text: string }> | undefined): RenderHints {
  const texts = (instructions ?? []).map((i) => i.text).join("\n");
  if (!texts.trim()) return {};
  const hints: RenderHints = {
    note: texts.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 120),
  };
  if (/카드|choice\s*card|선택\s*카드|카드형/.test(texts)) hints.forceChoiceCards = true;
  if (/드롭존|dropzone|첨부\s*영역|파일\s*영역|업로드\s*드롭|파일\s*첨부/.test(texts)) {
    hints.forceDropzone = true;
  }
  if (/전체\s*폭|한\s*줄|full\s*width|가로로\s*넓/.test(texts)) hints.forceFullWidth = true;
  if (/행\s*추가|반복\s*행|추가\s*\/\s*삭제|리스트\s*입력|여러\s*줄\s*추가/.test(texts)) {
    hints.forceRepeat = true;
  }
  if (/에러|오류|검증\s*문구|validation|빨간|필수\s*표시|필수\s*마크|\*/.test(texts)) {
    hints.showErrors = true;
  }
  if (/목록\s*화면|리스트\s*화면|표\s*목록으로|테이블로/.test(texts)) hints.preferList = true;
  return hints;
}

/** One artifact = one screen page (no CRM topnav/sidenav chrome). */
function chrome(input: {
  main: string;
  styles: string;
  pageTitle: string;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
  extraStyles?: string;
}): string {
  const pattern = input.uiPattern ?? "page";
  const isModal = pattern === "modal";
  const inner = isModal
    ? `<div class="wfs-dlg-backdrop"><div class="wfs-dlg" role="dialog" aria-modal="true">${input.main}</div></div>`
    : `<main class="wfs-main">${input.main}</main>`;

  // Deliberately NOT named .wfs-modal: in the extracted app shell that class is the fixed
  // full-viewport backdrop (position:fixed; inset:0; display:none) and .wfs-modal-panel is the
  // panel. Reusing the name let the shell's positioning survive here, pulling the dialog out of
  // the backdrop's flex flow so it pinned to the top-left instead of centering.
  const modalCss = `
    .wfs-dlg-backdrop {
      position: relative;
      inset: auto;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      background: rgba(45, 53, 57, 0.45);
      overflow: hidden;
    }
    .wfs-dlg {
      position: relative;
      inset: auto;
      z-index: auto;
      margin: 0;
      width: min(640px, 100%);
      max-height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--surface, #fff);
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      padding: 16px 20px 14px;
      box-sizing: border-box;
    }
    .wfs-dlg .wfs-page-head { margin-bottom: 12px; }
    .wfs-dlg .wfs-card {
      border: 0;
      box-shadow: none;
      padding: 0;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  `;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.pageTitle)}</title>
  <style>${wireframePageStyles(input.styles)}${modalCss}${input.extraStyles ?? ""}</style>
</head>
<body>
  <div class="wfs-stage">
    <div class="wfs-stage-frame${isModal ? " wfs-stage-frame--modal" : ""}">${inner}</div>
  </div>
</body>
</html>`;
}

function isChoiceCardField(field: BlueprintField, hints: RenderHints): boolean {
  if (hints.forceChoiceCards && field.options && field.options.length <= 4) return true;
  if (!field.options || field.options.length < 2 || field.options.length > 3) return false;
  const blob = `${field.label} ${field.name} ${field.column ?? ""}`;
  return /유형|제작|방식|이미지|영상|가이드|자유|콘텐츠\s*구분|DIV|METHOD|PROD/i.test(blob);
}

function isDropzoneField(field: BlueprintField, hints: RenderHints): boolean {
  if (field.control === "file") return true;
  // A field the PRD gives choices for is a choice, whatever its label says. "레퍼런스 전달 방식"
  // (링크 첨부 / 파일 첨부 / 웍스방 / 없음) matched the upload wording below and rendered as a
  // file picker, so the four options never appeared on the screen at all.
  if ((field.options?.length ?? 0) >= 2) return false;
  if (hints.forceDropzone && /첨부|레퍼런스|파일|링크|참고/.test(field.label)) return true;
  return /첨부|레퍼런스|파일|업로드|참고\s*자료/.test(field.label);
}

function isFullWidth(field: BlueprintField, hints: RenderHints): boolean {
  if (hints.forceFullWidth) return true;
  if (field.control === "textarea" || field.control === "file") return true;
  if (isDropzoneField(field, hints) || isChoiceCardField(field, hints)) return true;
  return /의도|목적|대본|카피|필수\s*반영|추가\s*소구|설명|메모/.test(field.label);
}

function renderBlueprintField(field: BlueprintField, index: number, hints: RenderHints): string {
  const label = polishLabel(field.label, field.column);
  const req = field.required ? '<span class="req">*</span>' : "";
  const err = hints.showErrors
    ? `<span class="wfs-field-error">입력을 확인해 주세요.</span>`
    : "";
  const full = isFullWidth(field, hints) ? " wfs-field--full" : "";

  if (isChoiceCardField(field, hints) && field.options?.length) {
    const cards = field.options
      .map(
        (option, optIndex) =>
          `<label class="wfs-choice-card${optIndex === 0 ? " is-selected" : ""}"><input type="radio" name="field-${index}" ${optIndex === 0 ? "checked" : ""} hidden><strong>${escapeHtml(option)}</strong></label>`,
      )
      .join("");
    return `<div class="wfs-field${full}"><span class="wfs-field-label">${escapeHtml(label)}${req}</span><div class="wfs-choice-grid">${cards}</div>${err}</div>`;
  }

  if (isDropzoneField(field, hints)) {
    return `<div class="wfs-field${full}"><span class="wfs-field-label">${escapeHtml(label)}${req}</span><div class="wfs-dropzone"><strong>파일 선택</strong></div><ul class="wfs-file-list"><li><span>sample-ref.pdf</span></li></ul>${err}</div>`;
  }

  if (field.control === "radio" && field.options?.length) {
    if (field.options.length <= 5 && /토글|의도|목적|여부/.test(label)) {
      const chips = field.options
        .map(
          (option, optIndex) =>
            `<label class="wfs-chip${optIndex === 0 ? " is-selected" : ""}"><input type="radio" name="field-${index}" ${optIndex === 0 ? "checked" : ""}><span>${escapeHtml(option)}</span></label>`,
        )
        .join("");
      return `<div class="wfs-field${full}"><span class="wfs-field-label">${escapeHtml(label)}${req}</span><div class="wfs-chip-group">${chips}</div>${err}</div>`;
    }
    const options = field.options
      .map(
        (option, optIndex) =>
          `<label class="wfs-radio"><input type="radio" name="field-${index}" ${optIndex === 0 ? "checked" : ""}> ${escapeHtml(option)}</label>`,
      )
      .join("");
    return `<div class="wfs-field${full}"><span class="wfs-field-label">${escapeHtml(label)}${req}</span><div class="wfs-radio-group">${options}</div>${err}</div>`;
  }

  if (field.control === "select" && field.options?.length) {
    const options = field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join("");
    return `<div class="wfs-field${full}"><label class="wfs-field-label">${escapeHtml(label)}${req}</label><select class="wfs-select">${options}</select>${err}</div>`;
  }

  if (field.control === "textarea") {
    const max = /200/.test(field.hint ?? "") || /대본/.test(label) ? 200 : 0;
    const count = max
      ? `<span class="wfs-char-count">0 / ${max}</span>`
      : `<span class="wfs-char-count">0자</span>`;
    return `<div class="wfs-field${full}"><label class="wfs-field-label">${escapeHtml(label)}${req}</label><textarea class="wfs-textarea" placeholder="${escapeHtml(label)}"></textarea>${count}${err}</div>`;
  }

  if (hints.forceRepeat && /추가|소구|항목/.test(label)) {
    return `<div class="wfs-field wfs-field--full"><span class="wfs-field-label">${escapeHtml(label)}${req}</span><div class="wfs-repeat-list"><div class="wfs-repeat-row"><input class="wfs-input" placeholder="항목 1"><input class="wfs-input" placeholder="비고"><button class="wfs-btn wfs-btn--muted" type="button">삭제</button></div><div class="wfs-repeat-row"><input class="wfs-input" placeholder="항목 2"><input class="wfs-input" placeholder="비고"><button class="wfs-btn wfs-btn--muted" type="button">삭제</button></div></div><div class="wfs-actions"><button class="wfs-btn wfs-btn--ghost" type="button">행 추가</button></div>${err}</div>`;
  }

  return `<div class="wfs-field${full}"><label class="wfs-field-label">${escapeHtml(label)}${req}</label><input type="text" class="wfs-input" placeholder="${escapeHtml(label)}">${err}</div>`;
}

function isProseControlLabel(label: string): boolean {
  const t = label.trim();
  if (/(습니다|주세요|입니다|없습니다|있습니다|않습니다|됩니다|합니다)\.?$/.test(t)) {
    return t.length > 12;
  }
  return false;
}

function fieldsFromStepControls(step: StepSpec): BlueprintField[] {
  const fields: BlueprintField[] = [];
  step.controls.forEach((control, index) => {
    if (control.kind === "note") return;
    if (
      (control.kind === "text" || control.kind === "textarea") &&
      isProseControlLabel(control.label)
    ) {
      return;
    }
    const name = `prd_${index}_${control.label}`.replace(/\s+/g, "_").slice(0, 48);
    if (control.kind === "radio") {
      fields.push({
        name,
        label: control.label,
        control: "radio",
        required: control.required,
        options: control.options,
        source: "prd",
      });
      return;
    }
    if (control.kind === "select") {
      fields.push({
        name,
        label: control.label,
        control: "select",
        required: control.required,
        options: control.options,
        source: "prd",
      });
      return;
    }
    if (control.kind === "file") {
      fields.push({
        name,
        label: control.label,
        control: "file",
        required: control.required,
        source: "prd",
      });
      return;
    }
    if (control.kind === "textarea") {
      fields.push({
        name,
        label: control.label,
        control: "textarea",
        required: control.required,
        source: "prd",
        hint: control.hint,
      });
      return;
    }
    fields.push({
      name,
      label: control.label,
      control: "text",
      required: control.required,
      source: "prd",
    });
  });
  return fields;
}

function groupFields(fields: BlueprintField[]): Array<{ title: string; fields: BlueprintField[] }> {
  if (fields.length === 0) return [];
  return [{ title: "", fields }];
}

function confirmSummaryHtml(allSteps: StepSpec[]): string {
  const items: string[] = [];
  for (const step of allSteps) {
    for (const control of step.controls) {
      if (control.kind === "note") continue;
      if (
        (control.kind === "text" || control.kind === "textarea") &&
        isProseControlLabel(control.label)
      ) {
        continue;
      }
      if (!("label" in control)) continue;
      const label = polishLabel(control.label);
      let value = "—";
      if (control.kind === "radio" || control.kind === "select") {
        value = control.options[0] ?? "—";
      } else if (control.kind === "file") {
        value = "sample-ref.pdf";
      } else if (control.kind === "textarea") {
        value = "샘플 입력 내용";
      } else if (control.kind === "text") {
        value = "샘플 값";
      }
      items.push(
        `<div class="wfs-dl-item"><div class="wfs-dl-label">${escapeHtml(label)}</div><div class="wfs-dl-value">${escapeHtml(value)}</div></div>`,
      );
      if (items.length >= 10) break;
    }
    if (items.length >= 10) break;
  }
  if (items.length === 0) {
    items.push(
      `<div class="wfs-dl-item"><div class="wfs-dl-label">콘텐츠 유형</div><div class="wfs-dl-value">이미지</div></div>`,
      `<div class="wfs-dl-item"><div class="wfs-dl-label">제작 방식</div><div class="wfs-dl-value">가이드 제작</div></div>`,
      `<div class="wfs-dl-item"><div class="wfs-dl-label">상태</div><div class="wfs-dl-value">요청</div></div>`,
    );
  }
  return `<div class="wfs-dl-grid">${items.join("")}</div>`;
}

function renderOverviewPage(input: {
  runTitle: string;
  domain: DomainSpec;
  assets: ProjectAssets;
  styles: string;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
}): string {
  const steps = input.domain.stepSpecs
    .map((s) => `<tr><td>${s.no}</td><td>${escapeHtml(s.title)}</td><td>${escapeHtml(s.hint ?? "—")}</td></tr>`)
    .join("");
  const reqs = input.domain.requirements
    .slice(0, 8)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  const main = `
      <div class="wfs-page-head">
        <div>
          <h1 class="wfs-page-title">${escapeHtml(input.runTitle)}</h1>
          <p class="wfs-page-desc">와이어프레임 개요 · 단계와 범위 요약</p>
        </div>
        <div class="wfs-page-actions">
          <span class="wfs-badge">${input.domain.stepSpecs.length}단계</span>
        </div>
      </div>
      <div class="wfs-card">
        <h2 class="wfs-section-title">화면 단계</h2>
        <div class="wfs-table-wrap">
          <table class="wfs-table"><thead><tr><th>#</th><th>단계</th><th>안내</th></tr></thead><tbody>${steps || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
        </div>
      </div>
      <div class="wfs-card">
        <h2 class="wfs-section-title">확인된 범위 (요약)</h2>
        <ul class="wfs-stack">${reqs || "<li class='wfs-note'>요구사항 요약 없음</li>"}</ul>
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — 개요`,
    uiPattern: input.uiPattern,
  });
}

/** 기능 명세 (00-spec): plain-Korean control names for non-developers. */
function specControlLabel(control: BlueprintField["control"]): string {
  switch (control) {
    case "radio":
      return "택1";
    case "select":
      return "선택";
    case "textarea":
      return "긴 입력";
    case "file":
      return "파일 첨부";
    default:
      return "입력";
  }
}

/** A value that still looks like a system constant (EXPIRED_NO_RENEWAL, reward, ent). */
function isRawOptionToken(option: string): boolean {
  const value = option.trim();
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) return true;
  if (/^[a-z][a-z0-9_]{1,15}$/.test(value)) return true;
  return false;
}

function specOptionsText(options: string[] | undefined): string {
  const clean = (options ?? []).filter((option) => !isRawOptionToken(option));
  if (clean.length === 0) return "—";
  const shown = clean.slice(0, 6).join(" / ");
  return clean.length > 6 ? `${shown} / …` : shown;
}

/**
 * Rows for one feature child, from features.json. The fields were already joined there
 * from PRD-truthful sources only (blueprint source === "prd", else the step's own PRD
 * controls — never db/api fields). This renderer still drops rows a business document
 * cannot state honestly: labels with no Korean business term, and "ㄴ" sub-bullets that
 * merely repeat a preceding row's option.
 */
function specRowsForChild(child: FeatureChild): Array<{
  label: string;
  required: boolean;
  control: BlueprintField["control"];
  options?: string[];
}> {
  const rows: Array<{
    label: string;
    required: boolean;
    control: BlueprintField["control"];
    options?: string[];
  }> = [];
  for (const field of child.fields ?? []) {
    const label = polishLabel(field.label);
    // A label still all-caps/English after polishLabel has no business-language name.
    if (!/[가-힣]/.test(label)) continue;
    const subText = /^ㄴ\s*/.test(label) ? label.replace(/^ㄴ\s*/, "").trim() : null;
    if (
      subText &&
      rows.some((row) =>
        (row.options ?? []).some((option) => subText === option || subText.startsWith(option)),
      )
    ) {
      continue; // PRD sub-bullet: it is the parent's option, not a field of its own.
    }
    rows.push({
      label,
      required: field.required,
      control: field.control,
      options: field.options,
    });
  }
  return rows;
}

const SPEC_IMPORTANCE_LABEL: Record<FeatureGroup["importance"], string> = {
  high: "중요",
  medium: "보통",
  low: "범위 외",
};

const SPEC_STATUS_LABEL: Record<FeatureGroup["status"], string> = {
  confirmed: "확정",
  draft: "초안",
  assumed: "가정",
};

function specGroupBadges(group: FeatureGroup): string {
  const importanceCls =
    group.importance === "low" ? " wfs-spec-badge--out" : group.importance === "high" ? " wfs-spec-badge--hot" : "";
  const statusCls = group.status === "confirmed" ? " wfs-spec-badge--ok" : "";
  return (
    `<span class="wfs-spec-badge${importanceCls}">${SPEC_IMPORTANCE_LABEL[group.importance]}</span>` +
    `<span class="wfs-spec-badge${statusCls}">${SPEC_STATUS_LABEL[group.status]}</span>`
  );
}

// Every class is .wfs-spec- prefixed: the extracted shell's generic .wfs-* classes leak into
// artifacts (a .wfs-modal collision already caused a layout bug once) — never reuse its names.
// This is a DOCUMENT: it must scroll vertically inside the stage frame, so .wfs-spec-doc opts
// out of the screen rules' overflow:hidden with its own overflow:auto scroller.
const SPEC_PAGE_STYLES = `
    .wfs-spec-doc {
      flex: 1;
      min-height: 0;
      overflow: auto;
      box-sizing: border-box;
      padding: 2px 2px 24px;
    }
    .wfs-spec-head { margin-bottom: 16px; }
    .wfs-spec-title { margin: 0 0 4px; font-size: 20px; line-height: 1.3; }
    .wfs-spec-sub { margin: 0; font-size: 13px; color: var(--text-muted, #6b7480); }
    .wfs-spec-section { margin-bottom: 22px; }
    .wfs-spec-section-title { margin: 0 0 10px; font-size: 15px; }
    .wfs-spec-group { margin-bottom: 20px; }
    .wfs-spec-group-title {
      margin: 0 0 10px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wfs-spec-badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.7;
      background: var(--bg, #f0f2f5);
      border: 1px solid var(--line, #dfe3e8);
      color: var(--text-muted, #6b7480);
    }
    .wfs-spec-badge--hot { background: #fdf1e7; border-color: #f2d3b3; color: #a05a12; }
    .wfs-spec-badge--ok { background: #e9f5ec; border-color: #c4e3cd; color: #1f7a3d; }
    .wfs-spec-badge--out { background: #f3f4f6; border-color: #d9dde3; color: #8a929c; }
    .wfs-spec-step { margin: 0 0 14px 12px; }
    .wfs-spec-step-title { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
    .wfs-spec-step-ref {
      margin-left: 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted, #8a929c);
    }
    .wfs-spec-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line, #dfe3e8);
      border-radius: 6px;
      background: var(--surface, #fff);
    }
    .wfs-spec-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .wfs-spec-table th, .wfs-spec-table td {
      padding: 7px 10px;
      border-bottom: 1px solid var(--line, #eef1f4);
      text-align: left;
      vertical-align: top;
    }
    .wfs-spec-table thead th {
      background: var(--bg, #f5f6f8);
      font-weight: 600;
      white-space: nowrap;
    }
    .wfs-spec-table tbody tr:last-child td { border-bottom: 0; }
    .wfs-spec-list {
      margin: 0;
      padding-left: 18px;
      font-size: 12.5px;
      line-height: 1.8;
      list-style: disc;
    }
    .wfs-spec-list li { display: list-item; margin: 0 0 4px; }
    .wfs-spec-none { margin: 0; font-size: 12.5px; color: var(--text-muted, #8a929c); }
  `;

/**
 * 기능 명세: one-page handoff document generated from the PRD — what a 영업팀 person
 * hands to 개발팀. Always rendered as a scrollable page document, never as a modal,
 * regardless of domain.uiPattern.
 */
function renderSpecPage(input: {
  runTitle: string;
  domain: DomainSpec;
  styles: string;
  features?: FeaturesDoc | null;
}): string {
  const { domain } = input;
  const groups: FeatureGroup[] = input.features?.groups ?? [];

  // Conditional fields are listed twice on purpose — once under the step that shows them
  // (1.4) and once under the 유형 section that owns them (2.1 / 2.2). Count labels, not rows,
  // so the header states how many inputs the request actually has.
  const fieldLabels = new Set<string>();
  const childHtml = (child: FeatureChild): string => {
    const rows = specRowsForChild(child);
    for (const row of rows) fieldLabels.add(row.label);
    const body =
      rows.length > 0
        ? `<div class="wfs-spec-table-wrap">
            <table class="wfs-spec-table">
              <thead><tr><th>항목</th><th>필수</th><th>입력 방식</th><th>선택지</th></tr></thead>
              <tbody>${rows
                .map(
                  (row) =>
                    `<tr><td>${escapeHtml(row.label)}</td><td>${row.required ? "필수" : "선택"}</td><td>${specControlLabel(row.control)}</td><td>${escapeHtml(specOptionsText(row.options))}</td></tr>`,
                )
                .join("")}</tbody>
            </table>
          </div>`
        : `<p class="wfs-spec-none">PRD에 이 항목의 세부 입력 항목이 적혀 있지 않습니다.</p>`;
    const stepRef =
      typeof child.stepNo === "number"
        ? `<span class="wfs-spec-step-ref">${child.stepNo}단계 화면</span>`
        : "";
    return `
        <div class="wfs-spec-step">
          <h3 class="wfs-spec-step-title">${escapeHtml(child.no)} ${escapeHtml(child.label)}${stepRef}</h3>
          ${body}
        </div>`;
  };

  // Group heading → child heading → the child's field table. Childless groups (참고
  // 섹션 등) still appear so the reader sees the whole PRD shape; out-of-scope ones
  // (importance low) are marked visibly instead of being hidden.
  const groupHtml = groups
    .map((group) => {
      const body =
        group.children.length > 0
          ? group.children.map(childHtml).join("")
          : `<p class="wfs-spec-none">${
              group.importance === "low"
                ? "이번 개발 범위에 포함되지 않는 참고 섹션입니다."
                : "PRD에 이 섹션의 세부 항목이 적혀 있지 않습니다."
            }</p>`;
      return `
        <div class="wfs-spec-group">
          <h2 class="wfs-spec-group-title">${escapeHtml(group.no)}. ${escapeHtml(group.label)}${specGroupBadges(group)}</h2>
          ${body}
        </div>`;
    })
    .join("");

  const hierarchySection =
    groups.length > 0
      ? `
        <section class="wfs-spec-section">
          <h2 class="wfs-spec-section-title">기능 구조와 입력 항목</h2>
          ${groupHtml}
        </section>`
      : `
        <section class="wfs-spec-section">
          <h2 class="wfs-spec-section-title">기능 구조와 입력 항목</h2>
          <p class="wfs-spec-none">기능 구조 데이터가 아직 생성되지 않았습니다. 빌드를 다시 실행하면 채워집니다.</p>
        </section>`;

  // 이렇게 이해했어요 — drop internal/irrelevant judgements: build-context plumbing,
  // list/detail rules when the screen is neither, anything naming a raw DB table, and the
  // auto-generated per-step field counts (the tables above already say that).
  const relevantJudgements = domain.judgements.filter((judgement) => {
    if (judgement.target === "build-context") return false;
    if (judgement.target.startsWith("step-")) return false;
    if (
      (judgement.target === "list" || judgement.target === "detail") &&
      domain.uiPattern !== "list" &&
      domain.uiPattern !== "detail"
    ) {
      return false;
    }
    if (domain.tables.some((table) => table && judgement.rule.includes(table))) return false;
    return true;
  });
  const judgementSection =
    relevantJudgements.length > 0
      ? `
      <section class="wfs-spec-section">
        <h2 class="wfs-spec-section-title">이렇게 이해했어요</h2>
        <ul class="wfs-spec-list">${relevantJudgements
          .map((judgement) => `<li>${escapeHtml(judgement.rule)}</li>`)
          .join("")}</ul>
      </section>`
      : "";

  const assumptionSection =
    domain.assumptions.length > 0
      ? `
      <section class="wfs-spec-section">
        <h2 class="wfs-spec-section-title">확인이 필요해요</h2>
        <ul class="wfs-spec-list">${domain.assumptions
          .map(
            (assumption) =>
              `<li>${escapeHtml(assumption.text)} — ${escapeHtml(assumption.reason)}</li>`,
          )
          .join("")}</ul>
      </section>`
      : "";

  const main = `
      <div class="wfs-spec-doc">
        <header class="wfs-spec-head">
          <h1 class="wfs-spec-title">${escapeHtml(input.runTitle)}</h1>
          <p class="wfs-spec-sub">기능 명세 · 기능 그룹 ${groups.length}개 · 입력 항목 ${fieldLabels.size}개</p>
        </header>
        ${hierarchySection}
        ${judgementSection}
        ${assumptionSection}
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — 기능 명세`,
    uiPattern: "page",
    extraStyles: SPEC_PAGE_STYLES,
  });
}

// Every class is .wfs-flow-doc- prefixed: the extracted shell's generic .wfs-* classes leak
// into artifacts, and the React app already owns .wfs-flow-btn/.wfs-flow-nav — never reuse
// either. Like 00-spec this is a DOCUMENT: .wfs-flow-doc opts out of the screen rules'
// overflow:hidden with its own overflow:auto scroller. The canvas itself is percent-based
// with a fixed aspect-ratio, so the whole diagram (4-way branch included) scales down to
// fit the stage frame instead of clipping off the right edge — no pan/zoom/JS.
const FLOW_PAGE_STYLES = `
    .wfs-flow-doc {
      flex: 1;
      min-height: 0;
      overflow: auto;
      box-sizing: border-box;
      padding: 2px 2px 24px;
    }
    .wfs-flow-doc-head { margin-bottom: 12px; }
    .wfs-flow-doc-title { margin: 0 0 4px; font-size: 20px; line-height: 1.3; }
    .wfs-flow-doc-sub { margin: 0; font-size: 13px; color: var(--muted, #6b7480); }
    .wfs-flow-doc-legend {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin: 0 0 14px;
      font-size: 12px;
      color: var(--text, #333);
    }
    .wfs-flow-doc-legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .wfs-flow-doc-swatch {
      display: inline-block;
      width: 16px;
      height: 11px;
      border-radius: 3px;
      box-sizing: border-box;
    }
    .wfs-flow-doc-swatch--start { background: #2d3539; border-radius: 999px; }
    .wfs-flow-doc-swatch--primary { background: var(--brand, #246beb); }
    .wfs-flow-doc-swatch--page { background: var(--surface, #fff); border: 1.5px solid #8a929c; }
    .wfs-flow-doc-swatch--edge { color: #7a838d; font-weight: 700; letter-spacing: -1px; }
    .wfs-flow-doc-canvas {
      position: relative;
      width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
    }
    .wfs-flow-doc-lane {
      position: absolute;
      left: 0;
      right: 0;
      box-sizing: border-box;
      border: 1px dashed var(--line, #c9d1d9);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.45);
    }
    .wfs-flow-doc-lane-label {
      position: absolute;
      top: 6px;
      left: 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--muted, #8a929c);
    }
    .wfs-flow-doc-edges { position: absolute; inset: 0; width: 100%; height: 100%; }
    .wfs-flow-doc-node {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      line-height: 1.35;
      overflow: hidden;
      word-break: keep-all;
    }
    .wfs-flow-doc-node--start {
      background: #2d3539;
      color: #fff;
      border-radius: 999px;
      font-weight: 600;
    }
    .wfs-flow-doc-node--primary {
      background: var(--brand, #246beb);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(36, 107, 235, 0.25);
    }
    .wfs-flow-doc-node--page {
      background: var(--surface, #fff);
      border: 1.5px solid #8a929c;
      color: var(--text, #333);
    }
    .wfs-flow-doc-cond {
      position: absolute;
      transform: translate(-100%, -100%);
      background: var(--surface, #fff);
      border: 1px solid var(--line, #dfe3e8);
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 10.5px;
      color: var(--text, #333);
      white-space: nowrap;
    }
    .wfs-flow-doc-empty { margin: 0; font-size: 12.5px; color: var(--muted, #8a929c); }
  `;

type FlowPlacement = { x: number; y: number; w: number; h: number };

/**
 * 유저 플로우 (00-flow): flow.json rendered as a static left-to-right diagram — a
 * print/handoff document, not the interactive canvas. Lanes are labelled horizontal
 * bands; edges are orthogonal inline-SVG connectors with condition chips on branches.
 * Always page chrome, never modal.
 */
function renderFlowPage(input: {
  runTitle: string;
  styles: string;
  flow?: FlowDoc | null;
}): string {
  const flow = input.flow;

  const legend = `
      <div class="wfs-flow-doc-legend">
        <span class="wfs-flow-doc-legend-item"><span class="wfs-flow-doc-swatch wfs-flow-doc-swatch--start"></span>시작</span>
        <span class="wfs-flow-doc-legend-item"><span class="wfs-flow-doc-swatch wfs-flow-doc-swatch--primary"></span>주요 페이지</span>
        <span class="wfs-flow-doc-legend-item"><span class="wfs-flow-doc-swatch wfs-flow-doc-swatch--page"></span>페이지</span>
        <span class="wfs-flow-doc-legend-item"><span class="wfs-flow-doc-swatch--edge">→</span>유저 흐름</span>
      </div>`;

  let body: string;
  if (!flow || flow.nodes.length === 0) {
    body = `<p class="wfs-flow-doc-empty">유저 플로우 데이터가 아직 생성되지 않았습니다. 빌드를 다시 실행하면 채워집니다.</p>`;
  } else {
    const NODE_W = 150;
    const NODE_H = 54;
    const START_W = 96;
    const START_H = 40;
    const COL_GAP = 44;
    const BRANCH_GAP = 118; // room for elbows + condition chips before a branched column
    const ROW_GAP = 18;
    const LANE_PAD = 14;
    const LANE_LABEL_H = 24;
    const LANE_GAP = 14;
    const MARGIN = 8;

    // Column = longest path from a start node (edge-count relaxation; edges are acyclic).
    const depth = new Map<string, number>(flow.nodes.map((node) => [node.id, 0]));
    for (let pass = 0; pass < flow.nodes.length; pass++) {
      let changed = false;
      for (const edge of flow.edges) {
        const from = depth.get(edge.from);
        const to = depth.get(edge.to);
        if (from === undefined || to === undefined) continue;
        if (from + 1 > to) {
          depth.set(edge.to, from + 1);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const maxDepth = Math.max(...depth.values());

    // Columns entered by conditional edges get a wider gap for the branch fan-out.
    const branchedCols = new Set<number>();
    for (const edge of flow.edges) {
      if (edge.condition) branchedCols.add(depth.get(edge.to) ?? 0);
    }
    const colX: number[] = [];
    let cursorX = MARGIN;
    for (let col = 0; col <= maxDepth; col++) {
      if (col > 0) cursorX += branchedCols.has(col) ? BRANCH_GAP : COL_GAP;
      colX.push(cursorX);
      cursorX += NODE_W;
    }
    const width = cursorX + MARGIN;

    // Lane bands stack vertically in flow.json order; inside a band, nodes of the
    // same column stack vertically and centre on the band's content area.
    const lanes = flow.lanes.filter((lane) => flow.nodes.some((node) => node.lane === lane.id));
    const placed = new Map<string, FlowPlacement>();
    const laneBands: Array<{ label: string; top: number; height: number }> = [];
    let cursorY = MARGIN;
    for (const lane of lanes) {
      const byCol = new Map<number, FlowDoc["nodes"]>();
      for (const node of flow.nodes) {
        if (node.lane !== lane.id) continue;
        const col = depth.get(node.id) ?? 0;
        byCol.set(col, [...(byCol.get(col) ?? []), node]);
      }
      const maxRows = Math.max(1, ...[...byCol.values()].map((nodes) => nodes.length));
      const contentH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
      const bandTop = cursorY;
      const bandH = LANE_LABEL_H + contentH + LANE_PAD * 2;
      const contentTop = bandTop + LANE_LABEL_H + LANE_PAD;
      for (const [col, nodes] of byCol) {
        const groupH = nodes.length * NODE_H + (nodes.length - 1) * ROW_GAP;
        let nodeY = contentTop + (contentH - groupH) / 2;
        for (const node of nodes) {
          const w = node.kind === "start" ? START_W : NODE_W;
          const h = node.kind === "start" ? START_H : NODE_H;
          placed.set(node.id, {
            x: colX[col] + (NODE_W - w) / 2,
            y: nodeY + (NODE_H - h) / 2,
            w,
            h,
          });
          nodeY += NODE_H + ROW_GAP;
        }
      }
      laneBands.push({ label: lane.label, top: bandTop, height: bandH });
      cursorY = bandTop + bandH + LANE_GAP;
    }
    const height = cursorY - LANE_GAP + MARGIN;

    const pctX = (value: number): string => `${((value / width) * 100).toFixed(3)}%`;
    const pctY = (value: number): string => `${((value / height) * 100).toFixed(3)}%`;

    const laneHtml = laneBands
      .map(
        (band) =>
          `<div class="wfs-flow-doc-lane" style="top:${pctY(band.top)};height:${pctY(band.height)}"><span class="wfs-flow-doc-lane-label">${escapeHtml(band.label)}</span></div>`,
      )
      .join("");

    const nodeHtml = flow.nodes
      .map((node) => {
        const pos = placed.get(node.id);
        if (!pos) return "";
        return `<div class="wfs-flow-doc-node wfs-flow-doc-node--${node.kind}" style="left:${pctX(pos.x)};top:${pctY(pos.y)};width:${pctX(pos.w)};height:${pctY(pos.h)}">${escapeHtml(node.label)}</div>`;
      })
      .join("");

    // Orthogonal connectors: straight when the centres share a row, otherwise a
    // 3-segment elbow whose vertical run is offset per source node so parallel
    // branches never overlap.
    const elbowCount = new Map<string, number>();
    const edgeParts: string[] = [];
    const condChips: string[] = [];
    for (const edge of flow.edges) {
      const from = placed.get(edge.from);
      const to = placed.get(edge.to);
      if (!from || !to) continue;
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      let d: string;
      if (Math.abs(y1 - y2) < 1) {
        d = `M ${x1} ${y1} H ${x2 - 3}`;
      } else {
        const nth = elbowCount.get(edge.from) ?? 0;
        elbowCount.set(edge.from, nth + 1);
        const xm = Math.min(x1 + 16 + nth * 10, x2 - 12);
        d = `M ${x1} ${y1} H ${xm} V ${y2} H ${x2 - 3}`;
      }
      edgeParts.push(
        `<path d="${d}" fill="none" stroke="#7a838d" stroke-width="1.6" marker-end="url(#wfs-flow-doc-arrow)"/>`,
      );
      if (edge.condition) {
        condChips.push(
          `<span class="wfs-flow-doc-cond" style="left:${pctX(x2 - 8)};top:${pctY(y2 - 6)}">${escapeHtml(edge.condition)}</span>`,
        );
      }
    }

    const edgesSvg = `
        <svg class="wfs-flow-doc-edges" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="wfs-flow-doc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#7a838d"/>
            </marker>
          </defs>
          ${edgeParts.join("\n          ")}
        </svg>`;

    body = `
      <div class="wfs-flow-doc-canvas" style="max-width:${width}px;aspect-ratio:${width} / ${height}">
        ${laneHtml}
        ${edgesSvg}
        ${nodeHtml}
        ${condChips.join("\n        ")}
      </div>`;
  }

  const main = `
      <div class="wfs-flow-doc">
        <header class="wfs-flow-doc-head">
          <h1 class="wfs-flow-doc-title">${escapeHtml(input.runTitle)}</h1>
          <p class="wfs-flow-doc-sub">유저 플로우 · 화면 이동과 조건 분기</p>
        </header>
        ${legend}
        ${body}
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — 유저 플로우`,
    uiPattern: "page",
    extraStyles: FLOW_PAGE_STYLES,
  });
}

function sampleRows(columns: Array<{ name: string; label: string }>): string {
  const samples = [
    ["CR-1001", "봄 시즌 배너", "이미지", "진행", "2026-03-01"],
    ["CR-1002", "브랜드 필름", "영상", "대기", "2026-03-02"],
    ["CR-1003", "프로모션 컷", "이미지", "완료", "2026-03-03"],
  ];
  return samples
    .map((row) => {
      const cells = columns
        .map((col, i) => {
          const val = row[i] ?? row[0] ?? "—";
          if (/상태/.test(col.label)) {
            const cls =
              val === "진행" ? "wfs-badge--ok" : val === "대기" ? "wfs-badge--warn" : "wfs-badge--muted";
            return `<td><span class="wfs-badge ${cls}">${escapeHtml(val)}</span></td>`;
          }
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

function renderListPage(input: {
  runTitle: string;
  title: string;
  blueprint: FieldBlueprint;
  assets: ProjectAssets;
  styles: string;
  hints: RenderHints;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
}): string {
  const filters = (input.blueprint.filters?.length
    ? input.blueprint.filters
    : [
        { name: "q", label: "검색", control: "text" as const, required: false, source: "prd" as const },
        {
          name: "type",
          label: "유형",
          control: "select" as const,
          required: false,
          source: "prd" as const,
          options: ["전체", "이미지", "영상"],
        },
        {
          name: "status",
          label: "상태",
          control: "select" as const,
          required: false,
          source: "prd" as const,
          options: ["전체", "진행", "완료"],
        },
      ]
  ).slice(0, 5);

  const columns =
    input.blueprint.columns && input.blueprint.columns.length > 0
      ? input.blueprint.columns.slice(0, 6)
      : [
          { name: "id", label: "요청번호" },
          { name: "title", label: "제목" },
          { name: "type", label: "유형" },
          { name: "status", label: "상태" },
          { name: "date", label: "요청일" },
        ];

  const filterHtml = filters
    .map((f, i) => {
      const cls = i === 0 ? "wfs-field wfs-search" : "wfs-field wfs-filter-field";
      if (f.control === "select" && f.options?.length) {
        return `<div class="${cls}"><label class="wfs-field-label">${escapeHtml(f.label)}</label><select class="wfs-select">${f.options.map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select></div>`;
      }
      return `<div class="${cls}"><label class="wfs-field-label">${escapeHtml(f.label)}</label><input class="wfs-input" placeholder="${escapeHtml(f.label)}"></div>`;
    })
    .join("");

  const main = `
      <div class="wfs-page-head">
        <div>
          <h1 class="wfs-page-title">${escapeHtml(input.title)}</h1>
        </div>
        <div class="wfs-page-actions">
          <button class="wfs-btn wfs-btn--muted" type="button">새로고침</button>
          <button class="wfs-btn" type="button">신규</button>
        </div>
      </div>
      <div class="wfs-filters">
        <div class="wfs-filter-row">
          ${filterHtml}
          <button class="wfs-btn wfs-btn--ghost" type="button">조회</button>
        </div>
      </div>
      <div class="wfs-data-bar"><span>총 <strong>128</strong>건</span></div>
      <div class="wfs-table-wrap">
        <table class="wfs-table">
          <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
          <tbody>${sampleRows(columns)}</tbody>
        </table>
      </div>
      <div class="wfs-paging">
        <button class="wfs-btn wfs-btn--muted" type="button">이전</button>
        <span>1 / 13</span>
        <button class="wfs-btn wfs-btn--muted" type="button">다음</button>
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — ${input.title}`,
    uiPattern: input.uiPattern === "modal" ? "modal" : "page",
  });
}

function renderDetailPage(input: {
  runTitle: string;
  title: string;
  blueprint: FieldBlueprint;
  assets: ProjectAssets;
  styles: string;
  hints: RenderHints;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
}): string {
  const fields = input.blueprint.fields.slice(0, 10);
  const items =
    fields.length > 0
      ? fields
          .map(
            (f) =>
              `<div class="wfs-dl-item"><div class="wfs-dl-label">${escapeHtml(f.label)}</div><div class="wfs-dl-value">${f.options?.[0] ? escapeHtml(f.options[0]) : "—"}</div></div>`,
          )
          .join("")
      : `<div class="wfs-dl-item"><div class="wfs-dl-label">제목</div><div class="wfs-dl-value">샘플 요청</div></div>
         <div class="wfs-dl-item"><div class="wfs-dl-label">유형</div><div class="wfs-dl-value">이미지</div></div>
         <div class="wfs-dl-item"><div class="wfs-dl-label">상태</div><div class="wfs-dl-value"><span class="wfs-badge wfs-badge--ok">진행</span></div></div>
         <div class="wfs-dl-item"><div class="wfs-dl-label">요청일</div><div class="wfs-dl-value">2026-03-01</div></div>`;

  const main = `
      <div class="wfs-page-head">
        <div>
          <h1 class="wfs-page-title">${escapeHtml(input.title)}</h1>
        </div>
        <div class="wfs-page-actions">
          <button class="wfs-btn wfs-btn--muted" type="button">목록</button>
          <button class="wfs-btn wfs-btn--ghost" type="button">수정</button>
        </div>
      </div>
      <div class="wfs-dl-grid">${items}</div>
      <div class="wfs-actions wfs-actions--split">
        <button class="wfs-btn wfs-btn--danger" type="button">삭제</button>
        <button class="wfs-btn" type="button">작업 완료</button>
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — ${input.title}`,
    uiPattern: input.uiPattern === "modal" ? "modal" : "page",
  });
}

function renderFormOrWizardPage(input: {
  runTitle: string;
  step: StepSpec;
  blueprint: FieldBlueprint;
  allSteps: StepSpec[];
  assets: ProjectAssets;
  styles: string;
  hints: RenderHints;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
}): string {
  const fromStep = fieldsFromStepControls(input.step);
  const hasPrdControls = input.step.controls.length > 0;
  const useFields = hasPrdControls
    ? fromStep
    : (input.blueprint.fields ?? []).filter((f) => f.source === "prd").length > 0
      ? (input.blueprint.fields ?? []).filter((f) => f.source === "prd")
      : (input.blueprint.fields ?? []).slice(0, 8);

  const isConfirm = /확인|제출/.test(input.step.title);
  const isLast = input.step.no >= input.allSteps.length;

  let bodyHtml: string;
  if (isConfirm || (hasPrdControls && useFields.length === 0)) {
    bodyHtml = confirmSummaryHtml(input.allSteps);
  } else {
    const sections = groupFields(useFields);
    bodyHtml = sections
      .map((section) => {
        const fieldHtml = section.fields
          .map((field, index) => renderBlueprintField(field, index, input.hints))
          .join("");
        const title = section.title
          ? `<h2 class="wfs-section-title">${escapeHtml(section.title)}</h2>`
          : "";
        return `<div class="wfs-section">${title}<div class="wfs-form-grid">${fieldHtml}</div></div>`;
      })
      .join("");
    if (!bodyHtml) bodyHtml = confirmSummaryHtml(input.allSteps);
  }

  const main = `
      <div class="wfs-page-head">
        <div>
          <h1 class="wfs-page-title">${escapeHtml(input.step.title)}</h1>
        </div>
      </div>
      <div class="wfs-card">
        <form onsubmit="return false">
          ${bodyHtml}
          <div class="wfs-actions wfs-actions--end">
            <button class="wfs-btn wfs-btn--muted" type="button">임시저장</button>
            <button class="wfs-btn wfs-btn--ghost" type="button">이전</button>
            <button class="wfs-btn" type="button">${isLast || isConfirm ? "제출" : "다음"}</button>
          </div>
        </form>
      </div>`;

  return chrome({
    main,
    styles: input.styles,
    pageTitle: `${input.runTitle} — ${input.step.title}`,
    uiPattern: input.uiPattern === "modal" ? "modal" : "page",
  });
}

function resolveScreenKind(
  blueprint: FieldBlueprint,
  artifact: ManifestArtifact,
  hints: RenderHints,
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail",
): FieldBlueprint["screenKind"] {
  if (hints.preferList || uiPattern === "list") return "list";
  if (uiPattern === "detail") return "detail";
  if (blueprint.screenKind === "list" || blueprint.screenKind === "detail" || blueprint.screenKind === "form") {
    return blueprint.screenKind;
  }
  const routeType = artifact.wireframe?.type;
  const blob = `${artifact.label} ${blueprint.title}`.toLowerCase();
  if (/목록\s*화면|현황\s*리스트|^목록$/.test(blob) || /\blist\b/.test(blob)) return "list";
  if (/상세\s*화면|상세\s*보기|^상세$/.test(blob) && !/요청|등록|작성|입력/.test(blob)) return "detail";
  if (routeType === "modify" && /\/list|목록/.test(artifact.wireframe.route) && !/form|regist|request/.test(artifact.wireframe.route)) {
    return "list";
  }
  if (uiPattern === "page") return "form";
  return blueprint.screenKind === "overview" ? "overview" : "wizard-step";
}

export function renderArtifactHtml(input: {
  artifact: ManifestArtifact;
  runTitle: string;
  prdContent: string;
  domain: DomainSpec;
  assets: ProjectAssets;
  /** features.json / flow.json documents — the 00-spec/00-flow pages render from these */
  features?: FeaturesDoc | null;
  flow?: FlowDoc | null;
}): string {
  const hints = parseInstructionHints(input.artifact.instructions);
  const uiPattern =
    input.artifact.wireframe?.uiPattern ??
    input.domain.uiPattern ??
    "page";

  if (input.artifact.id === "00-spec") {
    // Handoff DOCUMENT, not an app screen: always page chrome, even when uiPattern is modal.
    return renderSpecPage({
      runTitle: input.runTitle,
      domain: input.domain,
      styles: input.assets.shellStyles,
      features: input.features,
    });
  }

  if (input.artifact.id === "00-flow") {
    // Handoff DOCUMENT as well: static diagram, page chrome, before the step lookup.
    return renderFlowPage({
      runTitle: input.runTitle,
      styles: input.assets.shellStyles,
      flow: input.flow,
    });
  }

  if (input.artifact.id === "00-overview") {
    return renderOverviewPage({
      runTitle: input.runTitle,
      domain: input.domain,
      assets: input.assets,
      styles: input.assets.shellStyles,
      uiPattern,
    });
  }

  const stepNo = input.artifact.no;
  const stepSpec =
    input.domain.stepSpecs.find((entry) => entry.no === stepNo) ??
    ({
      no: stepNo,
      title: input.artifact.label,
      controls: [],
    } as StepSpec);

  const blueprint =
    input.domain.fieldBlueprints.find((entry) => entry.stepNo === stepNo) ??
    ({
      stepNo,
      screenKind: "wizard-step",
      title: stepSpec.title,
      fields: [],
    } as FieldBlueprint);

  const kind = resolveScreenKind(blueprint, input.artifact, hints, uiPattern);

  if (kind === "list") {
    return renderListPage({
      runTitle: input.runTitle,
      title: blueprint.title || input.artifact.label,
      blueprint,
      assets: input.assets,
      styles: input.assets.shellStyles,
      hints,
      uiPattern,
    });
  }

  if (kind === "detail") {
    return renderDetailPage({
      runTitle: input.runTitle,
      title: blueprint.title || input.artifact.label,
      blueprint,
      assets: input.assets,
      styles: input.assets.shellStyles,
      hints,
      uiPattern,
    });
  }

  return renderFormOrWizardPage({
    runTitle: input.runTitle,
    step: stepSpec,
    blueprint,
    allSteps: input.domain.stepSpecs,
    assets: input.assets,
    styles: input.assets.shellStyles,
    hints,
    uiPattern,
  });
}
