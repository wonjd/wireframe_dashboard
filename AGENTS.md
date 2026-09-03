# 에이전트

클론 후 이 파일만 보면 된다. 파일 형식은 [SPEC.md](./SPEC.md).

## 목적

**비개발자**가 본인 업무 지식 + PRD로 와이어프레임을 만든다.  
**개발자**는 이미 확정된 화면·결정 로그를 받아 **시간 단축**한다.

요청자가 먼저 보고 고친 뒤 넘긴다. 개발은 “그림 없는 이메일 요청”으로 시작하지 않는다.

---

## 사람 흐름 (제품 SSOT)

```
① PRD
   사용자 입력 → 모호한 부분 확정·보완 → 사용자 승인(ready)
   → (승인 후) 화면 양식만 확정 (phase=layout)
   → PRD 탭에 저장 (wireFrame/runs/{run}/input/v*.md)

② 1차 생성
   projects/{slug} JSON 자산 + 승인된 PRD
   → 와이어프레임 1차 HTML (domain → plan → render)

③ 멀티턴 다듬기
   사용자 지시 → 해당 화면만 재생성 → 승인할 때까지 반복
   → 와이어프레임 생성 완료 (confirmed)
```

게이트:
- ① 미승인(ready 아님) → ② 금지
- ready여도 화면 양식 미답 → ② 금지
- ② 없이 ③만 하는 건 가능(이미 HTML 있을 때)
- 파이프라인 내부(domain 이후 가정)에서는 사람에게 되묻지 않는다. 가정은 `assumptions[]`.

---

## 단계

각 단계는 **앞 단계가 남긴 파일만** 읽는다. 그래서 중간부터 다시 돌릴 수 있다.

### 0. 자산 추출 — 프로젝트당 1회 + 증분

옆에 실제 서비스 코드가 있으면 `existing`, 없으면 `new`. 이 레포 자신은 기존
프로젝트가 아니다.

```
crm_frontend  →  projects/{slug}/design.json   색 · 간격 · 타이포 · 컴포넌트
              →  projects/{slug}/routes.json   라우트 ↔ 파일 ↔ 화면
crm_backend   →  projects/{slug}/api.json      엔드포인트 · 필드
서비스 DB      →  projects/{slug}/db.json       테이블 · FK · 코드값 · 규모
```

전체 스키마를 뜨지 마라. PRD에서 나온 엔티티에서 FK를 1~2홉만 따라간다.

재추출은 `*.json`만 덮는다. `*.md`(규칙층)는 사람이 쓴 판단이라 절대 덮지 않는다.
재추출로 없어진 항목이 규칙층에서 참조되고 있으면 diff를 남긴다.

### 0-1. 셸 — 자산이 바뀔 때만

`design.json` + `design.md` → `projects/{slug}/shell.html`

레이아웃 골격, 컴포넌트 CSS, 버튼·표·모달·상태 뱃지 스타일을 여기서 확정한다.
**화면은 셸을 참조만 하고 컴포넌트를 새로 정의하지 않는다.**

### 1. PRD 확정·보완 (+ 승인 게이트)

자연어 PRD → `wireFrame/runs/{run}/input/v*.md` (원문 보존) + `## 확인된 결정`

**PRD는 개발 문서가 아니다.** 비개발자가 업무 말로 쓰고, AI가 빈칸·애매한 결정을
**쉬운 말로 물어 보완**하고, 사용자가 **승인(ready)** 하면 PRD 탭에 확정본이 남는다.
컬럼·코드·API 이름을 사용자에게 말하지 않는다.

**화면 양식**(`page` / `modal` / `list` / `wizard`) 질문은
애매한 업무 결정이 모두 끝나고 **PRD가 ready(승인)된 뒤**에만 한다 (`phase=layout`).
양식 미답이면 `run build` 금지.

대시보드 `/prd` OpenAI 에이전트 → CLI `prd review` / `prd answer`.
`status: ready` + 화면 양식 확정 전에는 ② 와이어프레임 생성을 돌리지 않는다.

### 2. 구조 판정 — PRD당 1회 (승인 후)

`db.json` + PRD → `wireFrame/spec/{run}.domain.json`

스키마 덤프를 넘기지 마라. **화면 구조를 결정하는 판정까지 해서** 넘긴다.

| 인자 | 화면에서 갈리는 것 |
| --- | --- |
| 카디널리티 1:1 / 1:N / N:M | 단일 필드 · 하위 표 · 별도 연결 화면 |
| 자기참조 FK | 트리 |
| 상태 코드값 개수 | 필터 형태와 탭 수 |
| 이력 테이블 존재 | 이력 탭 유무 |
| NOT NULL | 폼 필수 표시 |
| 행 수 규모 | 표 하나 vs 검색 · 페이징 필수 |

**이 단계는 반복 루프 안에서 절대 돌지 않는다.** 요청자가 재생성을 20번 눌러도
DB 질의는 0회다.

### 3. 화면 설계 (② 1차 생성)

PRD + `domain.json` + `design.md` → `manifest.json`

화면 목록, `type`(new/modify/extend), 라우트, 그리고 **요구사항 ↔ 화면 매핑**.

### 4. 화면 1차 생성 (②)

**빌드 1회에 세 소스를 함께 참조한다 (triple context):**

1. PRD — `wireFrame/runs/{run}/input/v*.md` (승인본)
2. JSON 자산 — `projects/{slug}/{design,routes,api,db}.json` + `shell.html`
3. live DB — `.env` SSH/DB로 SELECT 조회 후 JSON `db`와 병합

CLI `run build`가 SSOT. `spec/build-context.json`과 `domain.sources`에 기록한다.

셸 위에서 화면 HTML을 만든다. `wireFrame/runs/{run}/artifacts/{id}.html`
화면끼리 서로 몰라도 되므로 **병렬로 생성한다.**

**렌더 하드 룰 (AI 생성):**
- 한 HTML = 한 플로우 단계. 설명 문구 없이 UI·동작만.
- CRM 전체 크롬(탑바·사이드) 넣지 않음. `uiPattern=modal`이면 모달 프레임만.
- 모든 양식은 `wfs-stage`로 **가운데·비율 맞춤**. 스크롤하지 않음.

### 5. 멀티턴 다듬기 (③) — 승인할 때까지

지시가 들어온 화면 **하나만** 다시 그린다. 나머지는 파일을 그대로 둔다.
재생성은 **domain.json 재사용** — live DB를 다시 치지 않는다.

```
locked: true   → 건드리지 않는다. 기존 HTML 재사용
locked: false  → 이번 지시 대상
```

지시는 `artifacts[].instructions[]`에 누적된다. **이 로그가 개발자에게 가는 실제
명세다** — 화면은 그림이고, 로그가 "왜 이렇게 생겼나"다.

사용자가 승인하면 `confirmed` — 와이어프레임 생성 완료.

---

## 하드 룰

**파이프라인 내부에서는 멈추지 않는다.** ② 생성 중 정보가 모자라면 대기가 아니라
열화(degrade)하고 `assumptions[]`에 남긴다. (①·③의 사람 승인과는 별개)

| 상황 | 하는 것 | 하지 않는 것 |
| --- | --- | --- |
| 정보 부족 | 가정 세우고 진행, `assumptions[]`에 기록 | 되묻고 대기 |
| 테이블 못 찾음 | `domain.json` 비운 채 진행 | 실패 처리 |
| 기존 코드 없음 | `new` 모드, 회색 와이어 | 중단 |

**셸을 우회하지 않는다.** 화면 안에서 색·간격·컴포넌트를 새로 정의하면 화면마다
톤이 달라진다. 요청자가 제일 먼저 잡아내는 오류다.

**잠긴 화면을 건드리지 않는다.** 전체 재생성이어도 `locked: true`는 유지한다.

**디테일의 상한은 규칙층이 정한다.** "자세히"는 데이터와 배치가 자세한 것이지
시각 효과가 자세한 게 아니다. 상한을 안 박으면 피드백이 그쪽으로 흘러간다.

**개인정보를 넣지 않는다.** 코드값(enum)은 실제 값을 쓰되, 표의 샘플 행은 합성값을
쓴다. 대시보드(루트 도메인)는 팀 전체가 본다.

**라이브 DB는 환경변수만 쓴다.** SSH·DB 계정은 `.env`의 `SSH_*` / `DB_*` 만.
config·UI·채팅에 접속 정보를 두지 않는다. 계정은 **SELECT 전용**.
`server/db-env.ts`가 유일한 읽기 지점이다.

---

## 실행

파이프라인 SSOT는 **이 레포 CLI**다. 대시보드 OpenAI 에이전트는 CLI를 툴로 호출한다
(`prd review` / `prd answer` / 이후 `run build`). 채팅과 CLI가 같은 경로를 탄다.

로컬:

```bash
# .env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini   # optional

# Live DB — SSH + SELECT 계정 (필수 키는 .env.example)
SSH_HOST=...
SSH_USER=...
SSH_KEY_PATH=...            # or SSH_PASSWORD
DB_NAME=...
DB_USER=...                 # SELECT only
DB_PASSWORD=...

npm run dev                 # http://localhost:5173/prd
```

CLI:

```
wireframe run create|update …
wireframe prd review|answer …
wireframe run build …
wireframe render …
```

`--artifact` 없는 `render`는 `locked: false`인 산출물 전부를 병렬로 다시 그린다.
