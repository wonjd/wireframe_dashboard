# 파일 스펙

산출물은 전부 파일이다. 형식이 계약이고, 각 단계는 앞 단계 파일만 읽는다.

와이어프레임은 **첫 번째 vertical**이다. 최종 목표는 사내 도메인별 에이전트를 탭으로
관리하는 것이라, 이름은 처음부터 산출물 종류에 중립적으로 둔다 — [확장](#확장) 참고.

---

## 용어

| | |
| --- | --- |
| **run** | 요청 하나. 입력 + 산출물 묶음. 반복과 확정의 단위 |
| **artifact** | 산출물 하나. 잠금과 재생성의 단위. 와이어프레임에서는 화면 하나 |
| **kind** | vertical 종류. 지금은 `wireframe` 하나 |
| **자산** | 회사 현실에서 뽑은 규격. 오래 간다 |
| **소모품** | 생성된 산출물. 얼마든지 갈아엎는다 |

---

## 왜 파일인가

벡터 인덱스를 쓰지 않는다. 생성이 필요로 하는 건 **검색이 아니라 추출**이다 —
질문이 매번 같다(색 · 컴포넌트 · 라우트 · 엔드포인트 · 관계). 질문이 고정이면 한 번
뽑아 굳히는 게 맞다.

| | 추출 파일 | 벡터 인덱스 |
| --- | --- | --- |
| 낡았는지 | `git diff`에 보인다 | 안 보인다 |
| 틀렸는지 | 열어서 읽으면 안다 | 검색해봐야 안다 |
| 고치기 | 파일 수정 | 재인덱싱 파이프라인 |
| 리뷰 | PR에서 된다 | 안 된다 |
| 같은 입력 → | 항상 같은 결과 | 매번 다를 수 있다 |

그리고 인덱스는 선택지를 늘리고 규격은 선택지를 줄인다. 색 41개를 다 보여주면
매번 다른 5개를 고른다. **요청자가 20번 돌려도 안 흔들리게 만드는 건 후자다.**

벡터는 프로젝트가 늘고 추출로 못 덮는 자유 질의가 생길 때 검토한다. 그때도 붙는
자리는 생성이 아니라 사람의 탐색 쪽이다.

---

## 자산 — `projects/{slug}/`

프로젝트당 1회 추출 + 코드 변경 시 증분. **두 층으로 나눈다.**

```
추출층 (*.json)   기계가 쓴다. 손대지 마라. 재추출하면 덮인다
규칙층 (*.md)     사람이 쓴다. 재추출에 안 덮인다
```

추출은 사실, 규칙은 판단이다. `design.json`이 "색이 41개 있다"면
`design.md`가 "그중 5개만 쓴다"이다. **추출만으론 산출물이 안 나온다.**

| 파일 | 층 | 공유 |
| --- | --- | --- |
| `db.json` | 추출 | 모든 vertical |
| `api.json` | 추출 | 모든 vertical |
| `routes.json` | 추출 | 모든 vertical |
| `glossary.md` | 규칙 | 모든 vertical |
| `domain.md` | 규칙 | 모든 vertical |
| `design.json` | 추출 | wireframe 전용 |
| `design.md` | 규칙 | wireframe 전용 |
| `shell.html` | 파생 | wireframe 전용 |

### glossary.md — 용어사전

**vertical이 늘수록 이게 제일 값어치 있는 파일이 된다.** PRD 용어와 DB 컬럼명과
화면 라벨은 서로 다르다. 이걸 안 적어두면 vertical마다 새로 추측하고, 그러면
사내 에이전트가 아니라 그냥 LLM이다.

```md
| 업무 용어 | DB | 화면 라벨 | 비고 |
| --- | --- | --- | --- |
| 일시정지 | pause | 정지 | 연장은 extension |
| 성장 컬럼 | growth_column | 성장 지표 | |
```

### design.json

```json
{
  "color":     { "brand-500": "#2b7fff", "ink": "#23262e", "...": "..." },
  "spacing":   [4, 8, 12, 16, 24, 32],
  "radius":    { "card": "10px", "control": "7px" },
  "type":      { "family": "...", "scale": [11, 12, 13, 15, 20] },
  "component": [
    { "name": "Button", "variant": ["primary", "ghost", "danger"], "file": "..." },
    { "name": "Table",  "file": "..." }
  ]
}
```

### design.md — 규칙층

무엇을 쓰고 무엇을 쓰지 않는지, 그리고 **디테일 상한**.

```md
- 색은 brand / ink / line 3계열만. 나머지는 무시
- 목록은 항상 Table 컴포넌트. div로 표를 만들지 않는다
- 모달은 확인/취소 2버튼 고정
- 샘플 데이터는 실제처럼, 표는 3행
- 아이콘 · 애니메이션 · 호버 효과 없음
- 로딩 / 빈 상태 화면은 만들지 않는다
```

### routes.json

```json
{ "routes": [
  { "path": "/growth/pause-status", "file": "src/pages/PauseStatus.tsx", "label": "일시정지 현황" }
] }
```

### api.json

```json
{ "endpoints": [
  { "method": "GET", "path": "/api/pause", "fields": ["id", "memberId", "status", "endAt"] }
] }
```

### db.json — 추출층

스키마 사실만. 판정은 `domain.json`에서 한다.

```json
{ "tables": [
  { "name": "pause", "rows": 1204331,
    "columns": [
      { "name": "id",        "type": "bigint",  "null": false },
      { "name": "member_id", "type": "bigint",  "null": false, "fk": "member.id" },
      { "name": "status",    "type": "varchar", "null": false,
        "codes": [
          { "value": "PAUSED",  "count": 4021 },
          { "value": "EXPIRED", "count": 1180450 }
        ] }
    ] }
] }
```

`codes[].count`까지 뽑는다 — 분포를 보면 목록 기본 필터가 정해진다.

### shell.html — wireframe 전용

`design.json` + `design.md`에서 나온 공통 골격. 화면은 이걸 참조만 하고
컴포넌트를 새로 정의하지 않는다. **셸이 화면 간 일관성과 병렬 생성을 동시에
가능하게 한다.**

---

## 소모품 — `wireFrame/`

### index.json — 레지스트리

```json
{ "projects": [
  { "no": "01", "slug": "crm", "title": "CRM",
    "runs": [
      { "runId": "creative-request-form", "kind": "wireframe", "no": "PRD-001",
        "title": "소재 요청", "status": "ready", "artifactCount": 5 }
    ] }
] }
```

`status` — PRD: `clarifying` / `ready`. 와이어프레임: `draft` / `confirmed`.

### runs/{runId}/

```
input/v1.md                 PRD 원문 + ## 확인된 결정
spec/clarifications.json    open/resolved 질문 (비개발자용)
spec/domain.json            구조 판정 + uiPattern + fieldBlueprints
spec/manifest.json          artifacts[] · locked · instructions
spec/build-context.json     triple context (PRD / JSON / live DB)
artifacts/{id}.html         화면 1장 = 파일 1개
```

### domain.json — 구조 판정

**스키마가 아니라 판정이다.**

```json
{
  "uiPattern": "wizard",
  "entities": ["content", "file"],
  "tables": ["CONTENT_MT"],
  "stepSpecs": [{ "no": 1, "title": "콘텐츠 유형 선택", "controls": [] }],
  "fieldBlueprints": [{ "stepNo": 1, "screenKind": "wizard-step", "fields": [] }],
  "judgements": [{ "target": "wizard", "rule": "단계별 화면 분리" }],
  "assumptions": [],
  "sources": {
    "prd": { "path": "…", "chars": 1200 },
    "jsonAssets": { "projectSlug": "crm", "files": ["design.json", "db.json"] },
    "liveDb": { "ok": true, "tables": ["CONTENT_MT"] }
  }
}
```

`uiPattern` — `page` | `modal` | `list` | `wizard` | `detail`  
(PRD 확정 시 화면 양식 답에서 파생. 없으면 가정 + `assumptions[]`)

### manifest.json

```json
{
  "runId": "…",
  "kind": "wireframe",
  "projectSlug": "crm",
  "title": "소재 요청",
  "status": "draft",
  "artifacts": [
    {
      "id": "01-step-1", "no": 1, "label": "콘텐츠 유형 선택",
      "file": "01-step-1.html",
      "locked": false,
      "covers": ["1단계"],
      "instructions": [],
      "wireframe": { "route": "/wireframe/…/step-1", "type": "new", "uiPattern": "wizard" }
    }
  ]
}
```

| 필드 | 뜻 |
| --- | --- |
| `locked` | `true`면 재생성이 건드리지 않음 |
| `instructions[]` | 요청자 지시 = 개발자 명세 |
| `covers[]` | 요구사항 ↔ 산출물 |
| `wireframe.uiPattern` | 화면 양식 |

### artifacts/{id}.html

- 한 파일 = 한 플로우 단계. CRM 탑바·사이드 메뉴 금지.
- 셸 CSS만. 설명/노트 금지 — UI·컨트롤·버튼만.
- `uiPattern=modal` → `wfs-modal-backdrop` + `wfs-modal`.
- 뷰포트 맞춤, 스크롤 없이 자름.

---

## 확장

최종 목표는 도메인별 에이전트 탭. 와이어프레임은 첫 vertical.
`run` · `artifacts[]` · `kind` · `locked` · `instructions[]` 계약은 유지.

| kind | 산출물 | 인계 |
| --- | --- | --- |
| `wireframe` | 화면 HTML | 개발자 |

### 대시보드 OpenAI 에이전트와의 역할

| | `/prd` 에이전트 | CLI |
| --- | --- | --- |
| 모드 | PRD 확정·보완 (화면 양식 포함) | domain · manifest · HTML |
| 키 | `OPENAI_API_KEY` | 동일 레포 툴 호출 |
| 결과 | `확인된 결정` · `ready` | 파일 산출 |

에이전트는 CLI(`prd review` / `prd answer`)만 부르고, 생성 규칙은 CLI가 SSOT다.
