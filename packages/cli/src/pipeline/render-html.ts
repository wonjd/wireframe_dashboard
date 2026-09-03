import type {
  BlueprintField,
  DomainSpec,
  FieldBlueprint,
  ManifestArtifact,
  ProjectAssets,
} from "./build-pipeline.js";
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
    .wfs-stage-frame--modal .wfs-modal-backdrop {
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
  if (/드롭존|dropzone|첨부\s*영역|파일\s*영역|업로드\s*드롭/.test(texts)) hints.forceDropzone = true;
  if (/전체\s*폭|한\s*줄|full\s*width/.test(texts)) hints.forceFullWidth = true;
  if (/행\s*추가|반복\s*행|추가\s*\/\s*삭제|리스트\s*입력/.test(texts)) hints.forceRepeat = true;
  if (/에러|오류|검증\s*문구|validation/.test(texts)) hints.showErrors = true;
  if (/목록\s*화면|리스트\s*화면|표\s*목록으로/.test(texts)) hints.preferList = true;
  return hints;
}

/** One artifact = one screen page (no CRM topnav/sidenav chrome). */
function chrome(input: {
  main: string;
  styles: string;
  pageTitle: string;
  uiPattern?: "page" | "modal" | "list" | "wizard" | "detail";
}): string {
  const pattern = input.uiPattern ?? "page";
  const isModal = pattern === "modal";
  const inner = isModal
    ? `<div class="wfs-modal-backdrop"><div class="wfs-modal" role="dialog" aria-modal="true">${input.main}</div></div>`
    : `<main class="wfs-main">${input.main}</main>`;

  const modalCss = `
    .wfs-modal-backdrop {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      background: rgba(45, 53, 57, 0.45);
      overflow: hidden;
    }
    .wfs-modal {
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
    .wfs-modal .wfs-page-head { margin-bottom: 12px; }
    .wfs-modal .wfs-card {
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
  <style>${wireframePageStyles(input.styles)}${modalCss}</style>
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
}): string {
  const hints = parseInstructionHints(input.artifact.instructions);
  const uiPattern =
    input.artifact.wireframe?.uiPattern ??
    input.domain.uiPattern ??
    "page";

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
    allSteps: input.domain.stepSpecs.length
      ? input.domain.stepSpecs
      : input.domain.steps.map((s) => ({ no: s.no, title: s.label, controls: [] })),
    assets: input.assets,
    styles: input.assets.shellStyles,
    hints,
    uiPattern,
  });
}
