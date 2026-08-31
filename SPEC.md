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
  { "no": "01", "slug": "crm_frontend", "title": "CRM Frontend",
    "runs": [
      { "runId": "growth-pause", "kind": "wireframe", "no": "PRD-001",
        "title": "일시정지 연장 현황", "status": "draft", "artifactCount": 3 }
    ] }
] }
```

`status` — `draft` 작업중 / `confirmed` 확정. 확정본이 다음 사람에게 간다.

### spec/{run}.domain.json — 구조 판정

**스키마가 아니라 판정이다.** 원시 스키마를 넘기면 재생성마다 구조가 흔들린다.

```json
{
  "entities": ["member", "pause", "extension"],
  "relations": [
    { "from": "member", "to": "pause",     "kind": "1:N" },
    { "from": "pause",  "to": "extension", "kind": "1:N" }
  ],
  "judgements": [
    { "target": "detail", "rule": "회원정보 + 정지이력(표) + 정지 선택 시 연장이력(중첩 표)" },
    { "target": "list",   "rule": "pause 120만건 → 검색 필수, 전체 나열 금지" },
    { "target": "list",   "rule": "status 6종 → 상단 필터 탭. 기본값은 EXPIRED 제외" },
    { "target": "form",   "rule": "extension.reason NOT NULL → 필수 필드" }
  ]
}
```

DB를 못 읽었으면 `entities: []`로 두고 진행한다. 실패로 처리하지 않는다.

### spec/{run}.manifest.json

```json
{
  "runId": "growth-pause",
  "kind": "wireframe",
  "projectNo": "01",
  "projectSlug": "crm_frontend",
  "no": "PRD-001",
  "title": "일시정지 연장 현황",
  "mode": "existing",
  "status": "draft",
  "createdAt": "2026-08-31",
  "updatedAt": "2026-08-31T14:02:11+09:00",

  "assumptions": [
    { "text": "정지 상태에서만 연장할 수 있다고 가정",
      "reason": "PRD에 조건이 없어 status 코드값에서 추론" }
  ],

  "artifacts": [
    {
      "id": "01-list", "no": 1, "label": "목록",
      "file": "01-list.html",
      "locked": true,
      "updatedAt": "2026-08-31T13:40:02+09:00",
      "covers": ["목록에서 이름·이메일·상태로 검색"],
      "instructions": [],
      "wireframe": { "route": "/growth/pause-status", "type": "new" }
    },
    {
      "id": "02-detail", "no": 2, "label": "상세",
      "file": "02-detail.html",
      "locked": false,
      "updatedAt": "2026-08-31T14:02:11+09:00",
      "covers": ["상세에서 상태를 변경"],
      "instructions": [
        { "at": "2026-08-31T13:55:00+09:00", "text": "연장 이력을 표로 아래에 추가" },
        { "at": "2026-08-31T14:02:11+09:00", "text": "취소 버튼은 빼라 — 취소는 목록에서만" }
      ],
      "wireframe": { "route": "/growth/pause-status/:id", "type": "modify", "related": "growthColumns" }
    }
  ]
}
```

**공통 필드** — 모든 vertical이 그대로 쓴다.

| 필드 | 뜻 |
| --- | --- |
| `locked` | `true`면 재생성이 건드리지 않는다. 전체 재생성에도 유지 |
| `instructions[]` | 요청자 지시 로그. **인계받는 사람에게 가는 실제 명세** |
| `covers[]` | 요구사항 ↔ 산출물 매핑. "이 요구사항 어디에 반영됐나"의 답 |
| `updatedAt` | 마지막 재생성 시각. 공유 중일 때 "언제 바뀌었나"를 보여준다 |
| `assumptions[]` | 에이전트가 채운 것. 요청자가 "내가 말한 것"과 구분할 수 있어야 한다 |

**kind별 필드** — `artifacts[].{kind}` 아래에만 둔다. 공통 필드와 섞지 않는다.

| wireframe | 뜻 |
| --- | --- |
| `route` | 실제 서비스에서의 경로 |
| `type` | `new` 신규 / `modify` 기존 화면 수정 / `extend` 기존 확장 |
| `related` | 수정 대상 기존 화면 |

### artifacts/{run}/{id}.html

산출물 하나 = 파일 하나. wireframe은 셸을 참조한다. 언제든 버려도 되는 소모품이다.
kind가 늘면 확장자가 갈린다 (`.sql` · `.md` 등).

---

## 확장

최종 목표는 도메인별 에이전트를 탭으로 관리하는 사내 도구다. 와이어프레임은
그중 하나이고, **루프는 vertical이 바뀌어도 같다.**

```
비개발자 자연어 입력
  → 회사 현실(코드 · DB · 문서)에 기반해서
  → 산출물 N개 생성
  → 사람이 단위별로 지시하며 반복
  → 확정 → 다음 사람에게 인계
```

| kind | 산출물 단위 | 인계 대상 |
| --- | --- | --- |
| `wireframe` | 화면 HTML | 개발자 |
| `report` | 쿼리 + 표 | 요청 부서 |
| `apispec` | 엔드포인트 | 개발자 |
| `runbook` | 문서 섹션 | 팀 |

### vertical이 바뀌어도 그대로인 것

- 자산(추출) / 소모품(생성) 분리
- 추출층 json / 규칙층 md 2층
- 단위별 `locked` + 단위별 재생성
- `instructions[]` = 인계받는 사람의 명세
- `assumptions[]` = 에이전트가 채운 것 표시
- 입력 이후 무인, 막히면 열화
- run 상태와 잠금이 서버에 있어야 공유가 성립

### wireframe 전용

- `shell.html` · `design.json` · `design.md`
- 산출물이 iframe으로 렌더된다는 것
- `artifacts[].wireframe.*`

### 지금은 플러그인 구조를 만들지 않는다

**두 번째 vertical이 실제로 나오기 전에 추상화하면 반드시 틀린다.**
vertical 하나만 보고 설계한 확장 지점은 두 번째가 붙을 때 안 맞는다.

지금 하는 건 이름을 막지 않는 것뿐이다 — `run` · `artifacts[]` · `kind`.
공통을 실제로 뽑아내는 건 두 번째 vertical을 만들 때 한다.

### Hermes와의 역할

| | Hermes Workspace | 이 도구 |
| --- | --- | --- |
| 모드 | 대화형 탐색 | 반복 가능한 산출물 생산 |
| 결과 | 채팅 기록 | 파일 · 확정본 · 인계 |
| 쓰는 사람 | 개발자 | 요청 부서 |

합치지 않는다. Hermes에는 CLI를 부르는 껍데기 툴만 등록해서, 탐색하다 "이거
산출물로 뽑자" 싶을 때 run을 만들 수 있게 한다.

---

## 마이그레이션

현재 구현과 이 스펙의 차이. 구현할 때 함께 처리한다.

| 지금 | 스펙 | 영향 |
| --- | --- | --- |
| `index.json`의 `prds[]` · `feature` | `runs[]` · `runId` · `kind` | 뷰어 `types.ts` · `data.ts` |
| `manifest.screens[]` | `manifest.artifacts[]` | 뷰어 `Sidebar` · `WireframeFeature` |
| 라우트 `:feature` | `:run` | `WireframeApp.tsx` |
| `issue/*.html` (평평함) | `artifacts/{run}/{id}.html` | `data.ts`의 `loadHtml` |
| `screens[]`에 `route` · `type` 직접 | `artifacts[].wireframe.*` | 생성부 |

`locked` · `instructions[]` · `covers[]` · `updatedAt`은 지금 아예 없다.
반복 루프의 전제이므로 생성부를 만들 때 함께 넣는다 — **나중에 붙일 수 없다.**
