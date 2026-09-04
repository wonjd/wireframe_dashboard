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

/** How the wireframe screen is framed — from PRD ## 확인된 결정 / clarify answers. */
export type UiPattern = "page" | "modal" | "list" | "wizard" | "detail";

export function parseUiPattern(prd: string, fallbackFlow = false): UiPattern {
  const section = prd.match(/(?:^|\n)#+\s*확인된\s*결정([\s\S]*)$/m)?.[1] ?? "";
  const blob = `${section}\n${prd}`;

  // Prefer explicit decision language near layout keywords
  if (/모달|팝업|띄우(는|서)|다이얼로그/.test(blob)) return "modal";
  if (/목록\s*표|표\s*형태|테이블\s*형태|리스트\s*화면|현황\s*목록/.test(blob)) return "list";
  if (/상세\s*화면|디테일\s*화면|상세\s*보기/.test(blob) && !/요청|등록|작성/.test(blob)) {
    return "detail";
  }
  if (/단계별|위자드|스텝\s*화면|플로우\s*화면|단계로\s*넘어/.test(blob)) return "wizard";
  if (/전체\s*페이지|페이지\s*입력|입력\s*폼|폼\s*화면/.test(blob)) return "page";

  if (fallbackFlow && /①|②|\d+\s*단계|요청\s*구조|플로우/.test(prd)) return "wizard";
  return "page";
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

function circledToNo(ch: string): number | null {
  const index = CIRCLED.indexOf(ch);
  return index >= 0 ? index + 1 : null;
}

function stripStepMeta(label: string): {
  title: string;
  hint?: string;
  required: boolean;
  singleSelect: boolean;
  options: string[];
} {
  const required = /필수/.test(label);
  const singleSelect = /단일선택|선택형/.test(label);

  let title = label;
  let options: string[] = [];

  const colonParts = label.split(/[:：]/);
  if (colonParts.length > 1) {
    title = colonParts[0].replace(/^\d+단계\s*/, "").replace(/^[①-⑮]\s*/, "").trim();
    options = colonParts
      .slice(1)
      .join(":")
      .split(/\s*\/\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/\s*\([^)]*\)\s*$/, "").trim())
      .filter(Boolean);
  } else {
    title = label
      .replace(/^\d+단계\s*/, "")
      .replace(/^[①-⑮]\s*/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
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

/** Heading end: allow "## 2. 유형별" / "## 3. 개발 확인" prefixes */
const HEADING_END =
  /(?:^|\n)#+\s*(?:\d+[.-]\s*)?(?:유형별|개발\s*확인|추후|최종\s*요청|기능\s*요구|비기능|확인된|참고|가정|FR-|NFR-)/;

/** Prefer flow / 요청 구조 / step headings; never harvest FR-* prose as steps */
function extractFlowSection(prd: string): string {
  const patterns: Array<[RegExp, RegExp]> = [
    [
      /(?:^|\n)#+\s*사용자\s*플로우|(?:^|\n)##\s*플로우|(?:^|\n)#+\s*.*플로우/,
      HEADING_END,
    ],
    [
      /(?:^|\n)#+\s*[^\n]*요청\s*구조/,
      HEADING_END,
    ],
    [
      /(?:^|\n)#+\s*[^\n]*최종\s*요청\s*구조/,
      /(?:^|\n)#+\s*(?:\d+[.-]\s*)?(?:확인된|추후|참고|FR-)/,
    ],
  ];
  for (const [start, end] of patterns) {
    const section = extractSection(prd, start, end);
    if (section.trim()) return section;
  }

  const firstCircled = prd.search(/(?:^|\n)#+\s*[①-⑮]|(?:^|\n)[①-⑮]\s+/);
  if (firstCircled !== -1) {
    const rest = prd.slice(firstCircled);
    const end = rest.search(HEADING_END);
    return end > 0 ? rest.slice(0, end) : rest;
  }

  const firstStep = prd.search(/(?:^|\n)#+\s*\d+\s*단계|(?:^|\n)\d+단계\s+/);
  if (firstStep === -1) return "";
  const rest = prd.slice(firstStep);
  const end = rest.search(/(?:^|\n)#+\s*(?:\d+[.-]\s*)?(?:기능\s*요구|비기능|확인된)|(?:^|\n)FR-\d+/m);
  return end > 0 ? rest.slice(0, end) : rest;
}

function parseFieldLines(block: string, required: boolean): FieldControl[] {
  const controls: FieldControl[] = [];
  // "ㄴ" sub-bullets are options of the nearest preceding field, never fields of their own.
  const optionsByOwner = new Map<FieldControl, string[]>();
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || /^(필수|선택|포함|제외|참고)[:：]?$/.test(line)) continue;
    if (/^#{1,6}\s*[①-⑮]/.test(line) || /^#{1,6}\s*\d+단계/.test(line)) break;
    if (/^[①-⑮]\s/.test(line) || (/^(\d+)단계\s/.test(line) && !line.includes(":"))) break;
    if (/^FR-|^NFR-/.test(line)) continue;
    if (/^\|/.test(line)) continue;
    if (line.length < 2) continue;

    const subOption = line.match(/^[ㄴ└]\s*(.+)$/);
    if (subOption) {
      const owner = [...controls].reverse().find((control) => control.kind !== "note");
      const option = subOption[1]
        .replace(/\s*(?:→|⇒)[^\n]*$/, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim();
      if (owner && option) {
        const bucket = optionsByOwner.get(owner) ?? [];
        if (!bucket.includes(option)) bucket.push(option);
        optionsByOwner.set(owner, bucket);
      }
      continue;
    }

    // "※ ..." remarks are notes, not input fields.
    if (line.startsWith("※")) {
      const text = line.replace(/^※\s*/, "").trim();
      if (text) controls.push({ kind: "note", text: `※ ${text}` });
      continue;
    }

    const short = line
      .replace(/^[-*·]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^\*\*/, "")
      .replace(/\*\*$/, "");
    const label = short.split(/[(:：]/)[0]?.trim() ?? short;
    if (!label || label.length > 48) continue;
    if (/^(조합|항목|구분|비고|※)/.test(label)) continue;

    if (/레퍼런스\s*전달|전달\s*방식/.test(line)) {
      controls.push({
        kind: "radio",
        label: "레퍼런스 전달 방식",
        options: ["링크 첨부", "파일 첨부", "브랜드 웍스방 직접 전달", "없음"],
        required,
      });
      continue;
    }

    if (/레퍼런스|파일\s*첨부|업로드|첨부\s*파일|웍스방/.test(line) && /첨부|업로드|전달/.test(line)) {
      controls.push({
        kind: /웍스|링크|URL/i.test(line) ? "text" : "file",
        label: /웍스|링크|URL/i.test(line) ? "웍스방 링크 URL" : label || "파일 첨부",
        required,
      });
      continue;
    }

    if (/랜딩/.test(line)) {
      controls.push({
        kind: "select",
        label: label.includes("랜딩") ? label : "랜딩페이지",
        options: ["(동일 광고주 최다 사용값)", "직접 입력"],
        required,
        hint: "동일 광고주 최다 사용값 자동 호출",
      });
      continue;
    }

    if (/기획\s*의도|PLAN_INTENT|테스트\s*목적/i.test(line)) {
      controls.push({
        kind: "radio",
        label: "기획의도 / 테스트 목적",
        options: ["기존 고성과 소구 확장", "탐색 목적 테스트", "기타"],
        required: false,
      });
      continue;
    }

    if (/200자|textarea|장문|설명|메모|카피|대본|리스트/.test(line)) {
      controls.push({
        kind: "textarea",
        label,
        required,
        maxLength: /200자/.test(line) ? 200 : undefined,
        hint: /200자/.test(line)
          ? "최대 200자 · 초과 시 저장 차단"
          : /리스트/.test(line)
            ? "복수 항목 리스트"
            : undefined,
      });
      continue;
    }

    if (short.includes("/") && short.split(/[:：]/)[1]) {
      const options = short
        .split(/[:：]/)[1]
        .split(/\s*\/\s*/)
        .map((p) => p.trim().replace(/\s*\([^)]*\)\s*$/, ""))
        .filter(Boolean);
      if (options.length >= 2) {
        controls.push({
          kind: options.length <= 5 ? "radio" : "select",
          label,
          options,
          required,
        });
        continue;
      }
    }

    // Nested bullets under 레퍼런스 already handled; plain list items as text
    if (/^(링크\s*첨부|파일\s*첨부|없음|기존|탐색|기타)/.test(label)) continue;

    controls.push({ kind: "text", label, required });
  }

  // Apply collected "ㄴ" options: 2+ options turn the owner into a radio/select, and
  // PRD-derived options win over any hardcoded fallback list.
  for (const [owner, options] of optionsByOwner) {
    if (options.length < 2) continue;
    const index = controls.indexOf(owner);
    if (index < 0 || owner.kind === "note") continue;
    controls[index] = {
      kind: owner.kind === "select" || options.length > 5 ? "select" : "radio",
      label: owner.label,
      options,
      required: owner.required,
    };
  }
  return controls;
}

function parseRequiredOptionalBlocks(section: string): {
  required: FieldControl[];
  optional: FieldControl[];
} {
  // Block headers may carry trailing prose after a delimiter — e.g.
  // "필수 / 미기입 시 , 다음 단계 넘어가지 못하도록" — but a field label that merely
  // starts with 필수/선택 ("필수 반영사항") must not split.
  const requiredSplit = section.split(
    /(?:^|\n)\s*\*{0,2}필수\*{0,2}\s*(?:\([^)]*\))?\s*(?:[:：][^\n]*|[/,·—][^\n]*)?(?:\n|$)/m,
  );
  const afterRequired = requiredSplit[1] ?? section;
  const optionalSplit = afterRequired.split(
    /(?:^|\n)\s*\*{0,2}선택\*{0,2}\s*(?:\([^)]*\))?\s*(?:[:：][^\n]*|[/,·—][^\n]*)?(?:\n|$)/m,
  );
  const requiredBlock = optionalSplit[0] ?? "";
  const optionalBlock = optionalSplit[1] ?? "";

  return {
    required: parseFieldLines(requiredBlock, true),
    optional: parseFieldLines(optionalBlock, false),
  };
}

function parseCommonFields(prd: string): { required: FieldControl[]; optional: FieldControl[] } {
  const section =
    extractSection(
      prd,
      /(?:#+\s*)?(?:[①-⑮]\s*)?(?:\d+단계\s*)?공통\s*정보|(?:#+\s*)?공통\s*정보\s*입력/,
      /(?:^|\n)#+\s*[①-⑮]|(?:^|\n)#+\s*\d+단계|(?:^|\n)#+\s*유형별|(?:^|\n)#+\s*제작|(?:^|\n)#+\s*기능\s*요구|(?:^|\n)FR-\d+|(?:^|\n)##\s*2\./,
    ) || extractSection(prd, /공통 정보 입력/, /\n\s*유형별 추가 입력|\n\s*③|\n\s*제작방식|\n\s*기능 요구|\n\s*FR-/);

  return parseRequiredOptionalBlocks(section);
}

function parseStepBodySection(prd: string, stepNo: number, titleHint: string): string {
  const circled = CIRCLED[stepNo - 1] ?? "";
  const escapedTitle = titleHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40);
  const patterns = [
    circled
      ? new RegExp(`(?:^|\\n)#+\\s*${circled}\\s*[^\\n]*${escapedTitle}[^\\n]*\\n`, "i")
      : null,
    circled ? new RegExp(`(?:^|\\n)#+\\s*${circled}\\s*[^\\n]*\\n`, "i") : null,
    new RegExp(`(?:^|\\n)#+\\s*${stepNo}\\s*단계[^\\n]*${escapedTitle}[^\\n]*\\n`, "i"),
    new RegExp(`(?:^|\\n)#+\\s*${stepNo}\\s*단계[^\\n]*\\n`, "i"),
    new RegExp(`(?:^|\\n)${stepNo}단계\\s+[^\\n]+\\n`, "i"),
  ].filter(Boolean) as RegExp[];

  for (const pattern of patterns) {
    const start = prd.search(pattern);
    if (start === -1) continue;
    const slice = prd.slice(start);
    const nextCircled = CIRCLED[stepNo] ?? "";
    const end = slice.search(
      new RegExp(
        `(?:^|\\n)#+\\s*${nextCircled}|(?:^|\\n)#+\\s*${stepNo + 1}\\s*단계|(?:^|\\n)${stepNo + 1}단계\\s+|(?:^|\\n)#+\\s*유형별|(?:^|\\n)#+\\s*개발\\s*확인|(?:^|\\n)#+\\s*확인된|(?:^|\\n)##\\s*2\\.|(?:^|\\n)FR-\\d+`,
        "m",
      ),
    );
    return end > 0 ? slice.slice(0, end) : slice;
  }
  return "";
}

function parseMarkdownMatrix(section: string): FieldControl[] {
  const rows = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|\s*-+/.test(line));

  if (rows.length >= 2) {
    const controls: FieldControl[] = [
      {
        kind: "note",
        text: "콘텐츠 유형 × 제작방식 선택값에 따라 아래 추가 항목이 조건부로 노출됩니다.",
      },
    ];
    for (const row of rows.slice(1)) {
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;
      const combo = cells[0];
      const fields = cells.slice(1).join(" / ");
      if (/조합|항목|구분|콘텐츠\s*유형/.test(combo)) continue;
      // Prefer field labels from last cell when table is 유형|방식|노출항목
      const fieldCell = cells[cells.length - 1] ?? fields;
      if (/공통\s*항목만|없음/.test(fieldCell)) {
        controls.push({
          kind: "note",
          text: `${cells.slice(0, -1).join(" + ")} → 추가 입력 없음`,
        });
        continue;
      }
      for (const part of fieldCell.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean)) {
        if (/노출|항목/.test(part)) continue;
        controls.push({
          kind: /대본|카피|문장/.test(part) ? "textarea" : "text",
          label: `${cells.slice(0, -1).join(" · ")} — ${part.replace(/\s*추가\s*노출/, "")}`,
          required: /메인\s*카피|최종\s*대본|필수\s*유지/.test(part),
          hint: part,
        });
      }
    }
    if (controls.length > 1) return controls;
  }

  return [
    {
      kind: "note",
      text: "이미지/영상 × 가이드/자유 제작에 따라 추가 입력 항목이 조건부로 노출됩니다.",
    },
  ];
}

/**
 * Prose form of the conditional matrix — "2-1. 이미지 요청 / ① 자유 제작 / ② 가이드 제작"
 * subsections whose field lines carry inline markers: "메인 카피 필수 / 미기입 시 요청 불가".
 */
function parseConditionalProse(section: string): FieldControl[] | null {
  const controls: FieldControl[] = [
    {
      kind: "note",
      text: "콘텐츠 유형 × 제작방식 선택값에 따라 아래 추가 항목이 조건부로 노출됩니다.",
    },
  ];
  let contentType = "";
  let method = "";
  const seen = new Set<string>();

  for (const raw of section.split("\n")) {
    const line = raw.trim().replace(/^[-*·]\s*/, "");
    if (!line || line.startsWith("※") || line.startsWith("|")) continue;

    const typeMatch = line.match(/^\d+-\d+\.?\s*(.+?)\s*(?:요청)?$/);
    if (typeMatch && /이미지|영상|배너|텍스트/.test(typeMatch[1])) {
      contentType = typeMatch[1].trim();
      method = "";
      continue;
    }
    const methodMatch = line.match(/^[①-⑮]?\s*(자유\s*제작|가이드)/);
    if (methodMatch) {
      method = line.replace(/^[①-⑮]\s*/, "").trim();
      continue;
    }
    if (/추가\s*입력\s*항목\s*없음|입력\s*없음|공통\s*항목만/.test(line)) {
      const combo = [contentType, method].filter(Boolean).join(" · ");
      if (combo) controls.push({ kind: "note", text: `${combo} → 추가 입력 없음` });
      continue;
    }

    // "메인 카피 필수 / 미기입 시 요청 불가" — label + inline 필수/선택 marker (+ rules)
    const fieldMatch = line.match(/^(.+?)\s*(필수|선택)\s*((?:[/(][^\n]*)?)$/);
    if (!fieldMatch) continue;
    const label = fieldMatch[1].trim();
    if (!label || label.length > 48) continue;
    if (/공통\s*정보|입력\s*항목|선택값|제작방식|콘텐츠\s*유형/.test(label)) continue;
    if (seen.has(label)) continue;
    seen.add(label);

    const rules = (fieldMatch[3] ?? "")
      .replace(/^\//, "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const combo = [contentType, method].filter(Boolean).join(" · ");
    const hint = [combo ? `${combo} 선택 시 노출` : "", ...rules].filter(Boolean).join(" · ");
    const required = fieldMatch[2] === "필수";
    if (/대본|카피|문장|설명|메모|리스트/.test(label)) {
      controls.push({
        kind: "textarea",
        label,
        required,
        maxLength: /200자/.test(line) ? 200 : undefined,
        hint: hint || undefined,
      });
    } else {
      controls.push({ kind: "text", label, required, hint: hint || undefined });
    }
  }

  return controls.some((control) => control.kind !== "note") ? controls : null;
}

function parseConditionalMatrix(prd: string): FieldControl[] {
  const section =
    extractSection(
      prd,
      /(?:#+\s*)?(?:\d+단계\s*)?유형별\s*추가|(?:#+\s*)?조건부|(?:#+\s*)?[①-⑮]\s*[^\n]*추가\s*입력|(?:#+\s*)?2\.\s*유형별/,
      /(?:^|\n)#+\s*[①-⑮]|(?:^|\n)#+\s*\d+단계|(?:^|\n)#+\s*개발\s*확인|(?:^|\n)#+\s*확인된|(?:^|\n)#+\s*추후|(?:^|\n)\d+\.\s*(?:개발\s*확인|추후|최종\s*요청|확인된)|(?:^|\n)FR-\d+/,
    ) || extractSection(prd, /유형별 추가 입력/, /\n\s*개발 확인|\n\s*확인된|\n\s*FR-/);

  const fromTable = parseMarkdownMatrix(section);
  // more than the generic fallback note = real markdown-table rows found
  if (fromTable.length > 1) return fromTable;
  return parseConditionalProse(section) ?? fromTable;
}

/** Apply ## 확인된 결정 Q/A onto controls (dropdown, list, URL, etc.) */
export function parseConfirmedDecisions(prd: string): FieldControl[] {
  const section = extractSection(prd, /(?:^|\n)#+\s*확인된\s*결정/, /(?:^|\n)#+\s*(?!#)/);
  if (!section.trim()) return [];

  const controls: FieldControl[] = [];
  const blocks = section.split(/(?:^|\n)###\s*Q\.\s*/).slice(1);
  for (const block of blocks) {
    const [qPart, ...aParts] = block.split(/(?:^|\n)A\.\s*/);
    const question = (qPart ?? "").trim();
    const answer = aParts.join("A. ").trim();
    if (!question || !answer) continue;

    if (/지면|타겟|핵심\s*소구/.test(question) && /드롭다운|직접\s*입력/.test(answer)) {
      const allowOther = /직접\s*입력|기타/.test(answer);
      for (const label of ["지면", "타겟", "핵심 소구 1순위"]) {
        if (
          !/지면·타겟·핵심|지면.*타겟.*핵심/.test(question) &&
          !question.includes(label) &&
          !question.includes(label.replace(/\s/g, ""))
        ) {
          continue;
        }
        controls.push({
          kind: "select",
          label,
          options: allowOther
            ? ["(목록 선택)", "기타 (직접 입력)"]
            : ["(목록 선택)"],
          required: true,
          hint: `확정: ${answer.slice(0, 60)}`,
        });
      }
      continue;
    }

    if (/추가\s*소구|필수\s*반영/.test(question) && /리스트|별도\s*테이블|별도테이블/.test(answer)) {
      controls.push({
        kind: "textarea",
        label: "추가 소구",
        required: false,
        hint: `리스트 · ${answer.slice(0, 40)}`,
      });
      controls.push({
        kind: "textarea",
        label: "필수 반영사항",
        required: false,
        hint: `리스트 · ${answer.slice(0, 40)}`,
      });
      continue;
    }

    if (
      (/레퍼런스|파일\s*직접\s*업로드|웍스방/.test(question) && /필요|URL|링크|웍스/.test(answer)) ||
      (/레퍼런스\s*전달/.test(question) && /웍스|URL|링크/.test(answer))
    ) {
      controls.push({
        kind: "radio",
        label: "레퍼런스 전달 방식",
        options: ["링크 첨부", "파일 첨부", "브랜드 웍스방 직접 전달", "없음"],
        required: true,
      });
      if (/URL|링크|웍스/.test(answer) || /필요/.test(answer)) {
        controls.push({
          kind: "text",
          label: "웍스방 링크 URL",
          required: true,
          hint: `확정: ${answer.slice(0, 40)}`,
        });
      }
      continue;
    }

    if (/기획\s*의도|PLAN_INTENT/.test(question)) {
      controls.push({
        kind: "radio",
        label: "기획의도 / 테스트 목적",
        options: ["기존 고성과 소구 확장", "탐색 목적 테스트", "기타"],
        required: false,
      });
      continue;
    }

    if (/200자|최종\s*대본/.test(question) && /차단/.test(answer)) {
      controls.push({
        kind: "textarea",
        label: "최종 대본",
        required: true,
        maxLength: 200,
        hint: "최대 200자 · 초과 시 저장 차단",
      });
      continue;
    }

    if (/단일\s*선택|이미지와\s*영상|별도로\s*요청/.test(question) && /별도/.test(answer)) {
      controls.push({
        kind: "radio",
        label: "콘텐츠 유형",
        options: ["이미지", "영상"],
        required: true,
      });
      continue;
    }
  }

  // de-dupe by label — later Q/A wins (more specific answers)
  const seen = new Map<string, FieldControl>();
  for (const control of controls) {
    if (control.kind === "note") {
      seen.set(`note:${"text" in control ? control.text : seen.size}`, control);
      continue;
    }
    const key = `${control.kind}:${control.label}`;
    seen.set(key, control);
  }
  return [...seen.values()];
}

function looksLikeConfirmStep(title: string, raw: string): boolean {
  return /확인|제출|검수|요약|review|confirm|submit/i.test(`${title} ${raw}`);
}

function looksLikeCommonStep(title: string, raw: string): boolean {
  return /공통|정보\s*입력|기본\s*정보/i.test(`${title} ${raw}`);
}

function looksLikeConditionalStep(title: string, raw: string): boolean {
  return /조건부|추가\s*입력|매트릭스|유형별|선택값에\s*따라/i.test(`${title} ${raw}`);
}

function looksLikeTypeStep(title: string, raw: string): boolean {
  return /콘텐츠\s*유형|이미지\s*\/\s*영상|유형\s*선택/i.test(`${title} ${raw}`);
}

function looksLikeMethodStep(title: string, raw: string): boolean {
  return /제작\s*방식|가이드|자유\s*제작/i.test(`${title} ${raw}`);
}

function discoverSteps(prdContent: string): Array<{ no: number; raw: string }> {
  const flowSection = extractFlowSection(prdContent);
  const steps: Array<{ no: number; raw: string }> = [];
  const seen = new Set<number>();

  const push = (no: number, raw: string) => {
    if (seen.has(no)) return;
    if (/^매트릭스|^동적|^필수값|^검증/.test(raw)) return;
    seen.add(no);
    steps.push({ no, raw: raw.trim() });
  };

  // ① title
  const circledRe = /(?:^|\n)(?:#+\s*)?([①-⑮])\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = circledRe.exec(flowSection || prdContent)) !== null) {
    const no = circledToNo(match[1]);
    if (!no) continue;
    push(no, match[2]);
  }

  // N단계
  const stepRe = /(?:^|\n)(?:#+\s*)?(\d+)\s*단계\s+(.+)/g;
  while ((match = stepRe.exec(flowSection || prdContent)) !== null) {
    push(Number(match[1]), match[2]);
  }

  if (steps.length === 0) {
    const globalRe = /(?:^|\n)#+\s*(\d+)\s*단계\s*([^\n]+)/g;
    while ((match = globalRe.exec(prdContent)) !== null) {
      push(Number(match[1]), match[2]);
    }
  }

  // Final structure tree fallback
  if (steps.length === 0 && /이미지\s*\/\s*영상|공통\s*정보\s*입력|가이드/.test(prdContent)) {
    steps.push(
      { no: 1, raw: "콘텐츠 유형 선택 (필수, 선택형): 이미지 / 영상" },
      { no: 2, raw: "공통 정보 입력" },
      { no: 3, raw: "제작방식 선택 (필수, 선택형): 가이드(대본·카피) 그대로 제작 / 자유 제작(참고용)" },
      { no: 4, raw: "선택값에 따른 추가 입력 항목 조건부 노출" },
      { no: 5, raw: "요청 내용 확인 및 제출" },
    );
  }

  return steps.sort((a, b) => a.no - b.no);
}

export function parsePrdSteps(prdContent: string): StepSpec[] {
  const steps = discoverSteps(prdContent);
  const common = parseCommonFields(prdContent);
  const conditional = parseConditionalMatrix(prdContent);
  const decisions = parseConfirmedDecisions(prdContent);

  return steps.map(({ no, raw }) => {
    const meta = stripStepMeta(raw);
    const controls: FieldControl[] = [];
    const body = parseStepBodySection(prdContent, no, meta.title);

    const isType = looksLikeTypeStep(meta.title, raw);
    const isMethod = looksLikeMethodStep(meta.title, raw);
    const isCommon = looksLikeCommonStep(meta.title, raw);
    const isConditional = looksLikeConditionalStep(meta.title, raw);
    const isConfirm = looksLikeConfirmStep(meta.title, raw);
    // Require actual 필수/선택 block headers — not "(필수 / 선택형)" in the step title
    const hasReqOptBlocks =
      Boolean(body) &&
      /(?:^|\n)\s*\*{0,2}필수\*{0,2}\s*(?:\([^)]*\))?\s*(?:[:：][^\n]*|[/,·—][^\n]*)?\n/m.test(body) &&
      !isType &&
      !isMethod &&
      !isConditional;

    if (meta.singleSelect && meta.options.length >= 2) {
      controls.push({
        kind: "radio",
        label: meta.title.replace(/\s*\([^)]*\)\s*$/, "").trim() || meta.title,
        options: meta.options,
        required: meta.required || true,
      });
    } else if (isType && controls.length === 0) {
      controls.push({
        kind: "radio",
        label: "콘텐츠 유형",
        options: ["이미지", "영상"],
        required: true,
      });
    } else if (isMethod && !meta.options.length) {
      controls.push({
        kind: "radio",
        label: "제작방식",
        options: ["가이드(대본·카피) 그대로 제작", "자유 제작(참고용)"],
        required: true,
      });
    }

    if (isCommon || hasReqOptBlocks) {
      const fromBody = body ? parseRequiredOptionalBlocks(body) : common;
      const req = fromBody.required.length > 0 ? fromBody.required : common.required;
      const opt = fromBody.optional.length > 0 ? fromBody.optional : common.optional;
      if (req.length > 0) {
        controls.push({ kind: "note", text: "<strong>필수</strong>" });
        controls.push(...req);
      }
      if (opt.length > 0) {
        controls.push({ kind: "note", text: "<strong>선택</strong>" });
        controls.push(...opt);
      }
      // Overlay confirmed decisions that refine common fields
      for (const decision of decisions) {
        if (decision.kind === "note") continue;
        const label = "label" in decision ? decision.label : "";
        const idx = controls.findIndex(
          (c) => c.kind !== "note" && "label" in c && c.label === label,
        );
        if (idx >= 0) controls[idx] = decision;
        else if (/지면|타겟|핵심|레퍼런스|웍스|추가\s*소구|필수\s*반영|기획|랜딩/.test(label)) {
          controls.push(decision);
        }
      }
    } else if (isConditional) {
      controls.push(...conditional);
      for (const decision of decisions) {
        if (decision.kind === "textarea" && /대본|카피|유지/.test("label" in decision ? decision.label : "")) {
          controls.push(decision);
        }
      }
    } else if (isConfirm) {
      // Confirm = summary of key fields from common + decisions
      const summary = [
        ...common.required,
        ...common.optional,
        ...decisions.filter((d) => d.kind !== "note"),
      ];
      const seen = new Set<string>();
      for (const control of summary) {
        if (control.kind === "note") continue;
        const key = "label" in control ? control.label : "";
        if (seen.has(key)) continue;
        seen.add(key);
        controls.push(control);
      }
      if (controls.length === 0) {
        controls.push(
          { kind: "note", text: "입력 내용을 확인한 뒤 요청을 제출합니다." },
          { kind: "note", text: "필수값 · 조건부 필드 · 파일 용량 검증 후 제출" },
        );
      }
    } else if (body && controls.length <= 1) {
      const parsed = parseFieldLines(body, false);
      if (parsed.length > 0) controls.push(...parsed);
    }

    if (controls.length === 0) {
      controls.push({
        kind: "note",
        text: meta.hint ?? "자산(db/api) 필드 블루프린트로 보강됩니다.",
      });
    }

    return { no, title: meta.title, hint: meta.hint, controls };
  });
}

export function parseStepSummaries(prdContent: string): Array<{ no: number; label: string }> {
  return parsePrdSteps(prdContent).map((step) => ({ no: step.no, label: step.title }));
}
