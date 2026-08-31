# 파일 스펙

산출물은 전부 파일이다. 형식이 계약이고, 각 단계는 앞 단계 파일만 읽는다.

---

## 왜 파일인가

벡터 인덱스를 쓰지 않는다. 화면 생성이 필요로 하는 건 **검색이 아니라 추출**이다 —
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
자리는 화면 생성이 아니라 사람의 탐색 쪽이다.

---

## 자산 — `projects/{slug}/`

프로젝트당 1회 추출 + 코드 변경 시 증분. **두 층으로 나눈다.**

```
추출층 (*.json)   기계가 쓴다. 손대지 마라. 재추출하면 덮인다
규칙층 (*.md)     사람이 쓴다. 재추출에 안 덮인다
```

추출은 사실, 규칙은 판단이다. `design.json`이 "색이 41개 있다"면
`design.md`가 "그중 5개만 쓴다"이다. **추출만으론 화면이 안 나온다.**

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

### shell.html

`design.json` + `design.md`에서 나온 공통 골격. 화면은 이걸 참조만 하고
컴포넌트를 새로 정의하지 않는다. **셸이 화면 간 일관성과 병렬 생성을 동시에
가능하게 한다.**

---

## 소모품 — `wireFrame/`

### index.json — 레지스트리

```json
{ "projects": [
  { "no": "01", "slug": "crm_frontend", "title": "CRM Frontend",
    "prds": [
      { "prdNo": "PRD-001", "feature": "growth-pause", "title": "일시정지 연장 현황",
        "status": "draft", "screenCount": 3 }
    ] }
] }
```

`status` — `draft` 작업중 / `confirmed` 확정. 확정본이 개발자에게 간다.

### spec/{feature}.domain.json — 구조 판정

**스키마가 아니라 판정이다.** 원시 스키마를 넘기면 재생성마다 구조가 흔들린다.

```json
{
  "entities": ["member", "pause", "extension"],
  "relations": [
    { "from": "member", "to": "pause",     "kind": "1:N" },
    { "from": "pause",  "to": "extension", "kind": "1:N" }
  ],
  "judgements": [
    { "screen": "detail", "rule": "회원정보 + 정지이력(표) + 정지 선택 시 연장이력(중첩 표)" },
    { "screen": "list",   "rule": "pause 120만건 → 검색 필수, 전체 나열 금지" },
    { "screen": "list",   "rule": "status 6종 → 상단 필터 탭. 기본값은 EXPIRED 제외" },
    { "screen": "form",   "rule": "extension.reason NOT NULL → 필수 필드" }
  ]
}
```

DB를 못 읽었으면 `entities: []`로 두고 진행한다. 실패로 처리하지 않는다.

### spec/{feature}.manifest.json

```json
{
  "projectNo": "01",
  "projectSlug": "crm_frontend",
  "prdNo": "PRD-001",
  "feature": "growth-pause",
  "title": "일시정지 연장 현황",
  "mode": "existing",
  "status": "draft",
  "createdAt": "2026-08-31",
  "updatedAt": "2026-08-31T14:02:11+09:00",

  "assumptions": [
    { "text": "정지 상태에서만 연장할 수 있다고 가정",
      "reason": "PRD에 조건이 없어 status 코드값에서 추론" }
  ],

  "screens": [
    {
      "id": "01-list", "no": 1, "label": "목록",
      "file": "01-list.html",
      "route": "/growth/pause-status",
      "type": "new",
      "locked": true,
      "updatedAt": "2026-08-31T13:40:02+09:00",
      "covers": ["목록에서 이름·이메일·상태로 검색"],
      "instructions": []
    },
    {
      "id": "02-detail", "no": 2, "label": "상세",
      "file": "02-detail.html",
      "route": "/growth/pause-status/:id",
      "type": "modify",
      "related": "growthColumns",
      "locked": false,
      "updatedAt": "2026-08-31T14:02:11+09:00",
      "covers": ["상세에서 상태를 변경"],
      "instructions": [
        { "at": "2026-08-31T13:55:00+09:00", "text": "연장 이력을 표로 아래에 추가" },
        { "at": "2026-08-31T14:02:11+09:00", "text": "취소 버튼은 빼라 — 취소는 목록에서만" }
      ]
    }
  ],

  "diff": { "new": 2, "modify": 1, "extend": 0 }
}
```

| 필드 | 뜻 |
| --- | --- |
| `locked` | `true`면 재생성이 건드리지 않는다. 전체 재생성에도 유지 |
| `instructions[]` | 요청자 지시 로그. **개발자에게 가는 실제 명세** |
| `covers[]` | 요구사항 ↔ 화면 매핑. "이 요구사항 어느 화면에 반영됐나"의 답 |
| `type` | `new` 신규 / `modify` 기존 화면 수정 / `extend` 기존 확장 |
| `assumptions[]` | 에이전트가 채운 것. 요청자가 "내가 말한 것"과 구분할 수 있어야 한다 |

### issue/{feature}/{id}.html

화면 하나 = 파일 하나. 셸을 참조한다. 언제든 버려도 되는 소모품이다.

---

## 마이그레이션

현재 `issue/*.html`이 feature 구분 없이 평평하다. feature가 늘면 충돌하므로
`issue/{feature}/{id}.html`로 옮긴다. 뷰어의 `loadHtml` 경로도 같이 바뀐다
(`src/lib/data.ts`).

현재 `manifest.screens[]`에 `locked` · `updatedAt` · `instructions[]` · `covers[]`가
없다. 반복 루프의 전제이므로 생성부를 만들 때 함께 넣는다 — **나중에 붙일 수 없다.**
