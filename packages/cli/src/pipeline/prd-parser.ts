export type FieldControl =
  | { kind: "radio"; label: string; options: string[]; required: boolean }
  | { kind: "select"; label: string; options: string[]; required: boolean; hint?: string }
  | { kind: "text"; label: string; required: boolean; hint?: string }
  | { kind: "textarea"; label: string; required: boolean; hint?: string; maxLength?: number }
  | { kind: "file"; label: string; required: boolean; hint?: string }
  | { kind: "note"; text: string };

export type StepSpec = {
  no: number;
  title: string;
  hint?: string;
  controls: FieldControl[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripStepMeta(label: string): {
  title: string;
  hint?: string;
  required: boolean;
  singleSelect: boolean;
  options: string[];
} {
  const required = /필수/.test(label);
  const singleSelect = /단일선택/.test(label);

  let title = label;
  let options: string[] = [];

  const colonParts = label.split(/[:：]/);
  if (colonParts.length > 1) {
    title = colonParts[0].replace(/^\d+단계\s*/, "").trim();
    options = colonParts
      .slice(1)
      .join(":")
      .split(/\s*\/\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  } else {
    title = label.replace(/^\d+단계\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  const paren = label.match(/\(([^)]+)\)/);

  return { title, hint: paren?.[1], required, singleSelect, options };
}

function extractSection(prd: string, startPattern: RegExp, endPattern?: RegExp): string {
  const start = prd.search(startPattern);
  if (start === -1) return "";
  const slice = prd.slice(start);
  if (!endPattern) return slice;
  const end = slice.search(endPattern);
  if (end <= 0) return slice;
  return slice.slice(0, end);
}

function parseFieldLines(block: string, required: boolean): FieldControl[] {
  const controls: FieldControl[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || /^(필수|선택|포함|제외|참고)[:：]?$/.test(line)) continue;
    if (/^(\d+)단계/.test(line)) break;
    if (/^FR-|^NFR-|^·/.test(line)) continue;
    if (line.length < 2) continue;

    const short = line.replace(/^·\s*/, "");
    const label = short.split("(")[0]?.trim() ?? short;
    if (!label || label.length > 36) continue;

    if (/레퍼런스 전달/.test(line)) {
      controls.push({
        kind: "radio",
        label: "레퍼런스 전달 방식",
        options: ["링크 첨부", "파일 첨부", "없음"],
        required,
      });
      continue;
    }

    if (/레퍼런스|파일 첨부|업로드/.test(line)) {
      controls.push({
        kind: "file",
        label,
        required,
        hint: line.includes("200MB") ? "개당 최대 200MB" : undefined,
      });
      continue;
    }

    if (/랜딩페이지/.test(line)) {
      controls.push({
        kind: "select",
        label,
        options: ["(기존 이력 없음 — 직접 입력)", "직접 입력"],
        required,
        hint: "동일 광고주 기존 값 드롭다운 (FR-2)",
      });
      continue;
    }

    if (/기획의도/.test(line)) {
      controls.push({
        kind: "radio",
        label,
        options: ["신규 테스트", "피벗", "디벨롭", "기타"],
        required,
      });
      continue;
    }

    if (/200자/.test(line)) {
      controls.push({ kind: "textarea", label, required, maxLength: 200, hint: "최대 200자" });
      continue;
    }

    controls.push({ kind: "text", label, required });
  }
  return controls;
}

function parseCommonFields(prd: string): { required: FieldControl[]; optional: FieldControl[] } {
  const section = extractSection(prd, /공통 정보 입력 항목/, /\n\s*유형별 추가 입력|\n\s*기능 요구|\n\s*FR-/);
  const requiredBlock = section.split(/선택\s*$/m)[0]?.split(/필수\s*$/m)[1] ?? "";
  const optionalBlock = section.split(/선택\s*$/m)[1]?.split(/유형별|기능 요구|FR-/)[0] ?? "";

  return {
    required: parseFieldLines(requiredBlock, true),
    optional: parseFieldLines(optionalBlock, false),
  };
}

function parseConditionalMatrix(prd: string): FieldControl[] {
  const section = extractSection(prd, /유형별 추가 입력/, /\n\s*기능 요구|\n\s*FR-/);
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("+") && line.includes(":"));

  if (lines.length === 0) {
    return [
      {
        kind: "note",
        text: "1·3단계 선택값(콘텐츠 유형 × 제작방식)에 따라 추가 입력 항목이 조건부로 노출됩니다.",
      },
    ];
  }

  const rows = lines
    .map((line) => {
      const [left, ...rest] = line.split(":");
      return `<tr><td>${escapeHtml(left?.trim() ?? line)}</td><td>${escapeHtml(rest.join(":").trim() || "—")}</td></tr>`;
    })
    .join("");

  return [
    {
      kind: "note",
      text: `<table class="wfs-table"><thead><tr><th>조합</th><th>추가 입력</th></tr></thead><tbody>${rows}</tbody></table>`,
    },
  ];
}

export function parsePrdSteps(prdContent: string): StepSpec[] {
  const flowSection = extractSection(
    prdContent,
    /사용자 플로우/,
    /\n\s*공통 정보 입력 항목/,
  );
  const steps: Array<{ no: number; raw: string }> = [];
  const stepRe = /^(\d+)단계\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = stepRe.exec(flowSection)) !== null) {
    steps.push({ no: Number(match[1]), raw: match[2].trim() });
  }

  const common = parseCommonFields(prdContent);
  const conditional = parseConditionalMatrix(prdContent);

  return steps.map(({ no, raw }) => {
    const meta = stripStepMeta(`${no}단계 ${raw}`);
    const controls: FieldControl[] = [];

    if (meta.singleSelect && meta.options.length >= 2) {
      controls.push({
        kind: "radio",
        label: meta.title.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        options: meta.options,
        required: meta.required,
      });
    } else if (no === 2) {
      if (common.required.length > 0) {
        controls.push({ kind: "note", text: "<strong>필수</strong>" });
        controls.push(...common.required);
      }
      if (common.optional.length > 0) {
        controls.push({ kind: "note", text: "<strong>선택</strong>" });
        controls.push(...common.optional);
      }
    } else if (no === 4) {
      controls.push(...conditional);
    } else if (no === 5) {
      controls.push(
        { kind: "note", text: "입력 내용을 확인한 뒤 요청을 제출합니다." },
        { kind: "note", text: "필수값 · 조건부 필드 · 파일 용량(200MB) 검증 후 제출 (FR-5)" },
      );
    }

    if (controls.length === 0) {
      controls.push({ kind: "note", text: meta.hint ?? "이 단계의 입력 항목은 PRD를 참고합니다." });
    }

    return { no, title: meta.title, hint: meta.hint, controls };
  });
}

export function parseStepSummaries(prdContent: string): Array<{ no: number; label: string }> {
  return parsePrdSteps(prdContent).map((step) => ({ no: step.no, label: step.title }));
}
