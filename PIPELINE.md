# 파이프라인 — 로컬 구현안

사람 입력은 **PRD 하나**. 프론트·백·DB·디자인은 미리 뽑아 둔 자산을 읽고, 화면 HTML을 만든다.  
DB 엔진은 **MySQL만** 쓴다. SQLite 금지 — 로컬 편의로 넣으면 배포 때 스키마·락·동시성이 갈라진다.

관련 계약: [AGENTS.md](./AGENTS.md) · [SPEC.md](./SPEC.md) · [WORKFLOW.md](./WORKFLOW.md)

---

## 0. 로컬 배치

```
Documents/
  crm_frontend/              ← 읽기 전용 소스
  crm_backend/               ← 읽기 전용 소스
  wireframe_dashboard/       ← 본진 (이 레포)
    projects/crm/            ← 추출 스냅샷 + 규칙 (SSOT for 생성)
    wireFrame/               ← PRD · manifest · HTML (소모품)
    packages/cli/            ← wireframe 명령
    apps/api/                ← MySQL 붙는 얇은 API (공유·확정용)
  WONJD_CHAT_BOT/            ← DB 조회 도구 (또는 그 HTTP/CLI)
```

경로는 `wireframe.config.json` 한곳에서만 본다.

```json
{
  "projectSlug": "crm",
  "sources": {
    "frontend": "../crm_frontend",
    "backend": "../crm_backend",
    "wonjd": { "type": "cli", "command": "wonjd-query" }
  },
  "mysql": {
    "urlEnv": "WIREFRAME_DATABASE_URL"
  }
}
```

로컬 MySQL: 팀과 같은 엔진. Docker면 `mysql:8` 하나.  
`WIREFRAME_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/wireframe`

---

## 1. 무엇이 어디에 사는지 (SSOT)

| 층 | 위치 | 역할 |
| --- | --- | --- |
| 원천 | crm_frontend / crm_backend / CRM DB(via WONJD) | 사실. 생성기가 직접 안 읽음 |
| 생성 규격 | `projects/crm/*.json` + 선택적 `*.md` | 에이전트가 읽는 SSOT |
| 사람 입력 | `wireFrame/input/{run}.md` | **PRD만** |
| run 상태 | `manifest.json` + MySQL `wireframe_run` | 잠금·지시·status·확정 |
| 화면 | `wireFrame/artifacts/{run}/{id}.html` | 소모품. **DB에 HTML 넣지 않음** |

MySQL에는 메타만 둔다. 본문(HTML·PRD·json)은 파일.  
이유: git diff·리뷰·로컬 오프라인 생성. DB는 공유·동시성·확정 알림용.

---

## 2. 두 트랙

```
[A] 자산 트랙 ── 코드/스키마 바뀔 때만 (사람 PRD와 무관)
[B] Run 트랙  ── PRD 넣을 때마다 (사람 접점 = PRD + 화면 지시 + 확정)
```

### A. 자산 트랙 (프로젝트당 1회 + 증분)

```
crm_frontend ──extract:design──► design.json
             ──extract:routes──► routes.json
crm_backend  ──extract:api─────► api.json
WONJD(DB)    ──extract:db──────► db.json
                                    │
design.json + design.md(있으면) ──► shell.html
```

| 명령 | 하는 일 |
| --- | --- |
| `wireframe extract design` | 토큰·컴포넌트·간격 스캔 → `design.json` |
| `wireframe extract routes` | 라우터 테이블 → `routes.json` |
| `wireframe extract api` | 컨트롤러/DTO → `api.json` |
| `wireframe extract db --entities …` | WONJD로 테이블·FK 1~2홉·코드값·row count → `db.json` |
| `wireframe shell` | `design.json`(+규칙 md) → `shell.html` |

규칙:

- `*.json`만 덮는다. `design.md` / `glossary.md`가 있으면 보존.
- 없어도 진행. 없으면 추출값 그대로 + 생성 시 `assumptions[]`.
- **전체 스키마 금지.** PRD/엔티티 목록 기준으로 FK 1~2홉.
- 추출 diff(사라진 컬럼이 규칙층에 참조되면) 리포트만 남긴다.

로컬 첫날: 한 번 `extract *` + `shell` 돌리면 A는 끝.

### B. Run 트랙 (PRD만 입력)

```
PRD 텍스트
   │
   ▼
① intake   → wireFrame/input/{run}.md 보존
             MySQL wireframe_run row 생성 (status=draft)
   │
   ▼
② domain   → db.json + PRD → wireFrame/spec/{run}.domain.json
             (카디널리티·코드값 수·규모·NOT NULL → 화면 구조 판정)
             ※ 이 단계만 DB 자산을 본다. 이후 DB 질의 0회
   │
   ▼
③ plan     → PRD + domain + routes/design → manifest.json
             artifacts[] · covers[] · assumptions[] · locked:false
   │
   ▼
④ render   → shell + domain + manifest → artifacts/{run}/{id}.html 병렬
             MySQL에 artifact 메타 sync (path, locked, updatedAt)
   │
   ▼
⑤ iterate  → 지시 1건 → 해당 artifact만 locked=false로 재 render
             instructions[] 누적 (명세)
   │
   ▼
⑥ confirm  → status=confirmed · 스냅샷 고정 · 개발자 링크
```

사람 입력 파일은 끝까지 **`input/{run}.md` 하나**.

```bash
# 신규
wireframe run create --project crm --title "일시정지 연장" --prd ./tmp/prd.md

# 파이프 한 방 (로컬 기본)
wireframe run build {run}          # intake 이후면 domain→plan→render

# 화면 하나만
wireframe render {run} --artifact 02-detail --instruction "연장 이력을 표로"

# 확정
wireframe run confirm {run}
```

---

## 3. 단계별 입출력 (구현 계약)

### ① intake

| in | out |
| --- | --- |
| PRD 원문, projectSlug, title | `input/{run}.md`, MySQL `wireframe_run` |

되묻지 않는다. 빈칸은 ②③에서 가정.

### ② domain

| in | out |
| --- | --- |
| `input/{run}.md`, `projects/crm/db.json`, (있으면) `api.json` | `spec/{run}.domain.json` |

판정만 남긴다. 스키마 덤프 금지. `db.json` 없거나 테이블 못 찾으면 `entities: []` + assumption 남기고 진행.

### ③ plan

| in | out |
| --- | --- |
| PRD, domain, routes, design.md(옵션) | `spec/{run}.manifest.json` |

화면 목록 · `type`(new/modify/extend) · route · `covers[]` · `assumptions[]`.

### ④ render

| in | out |
| --- | --- |
| shell.html, domain, manifest의 해당 artifact, instructions[] | `artifacts/{run}/{id}.html` |

- 셸 CSS/컴포넌트만 사용. 화면 안 토큰 신규 정의 금지.
- 샘플 행은 합성값. 코드값(enum)만 실제.
- `locked: true`는 스킵.

### ⑤ iterate

지시 → `instructions[]` append → 그 id만 render.  
도메인 재실행 없음. PRD 자체가 바뀌면 새 run.

### ⑥ confirm

`status=confirmed`. 이후 파일이 바뀌면 뷰어에 "확정본과 다름".

---

## 4. MySQL 스키마 (파일과 역할 분리)

기존 `wireframe_issue.sql`은 HTML을 DB에 넣는 구형이다. **폐기 방향.**  
로컬=배포 동일 스키마. HTML은 파일, MySQL은 메타만.

```sql
CREATE TABLE IF NOT EXISTS wireframe_run (
  run_id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  project_slug    VARCHAR(128) NOT NULL,
  kind            VARCHAR(32)  NOT NULL DEFAULT 'wireframe',
  title           VARCHAR(255) NOT NULL,
  status          ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  prd_path        VARCHAR(512) NOT NULL,
  manifest_path   VARCHAR(512) NOT NULL,
  domain_path     VARCHAR(512) NULL,
  confirmed_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_slug, status)
);

CREATE TABLE IF NOT EXISTS wireframe_artifact (
  run_id          VARCHAR(64)  NOT NULL,
  artifact_id     VARCHAR(64)  NOT NULL,
  label           VARCHAR(255) NOT NULL,
  file_path       VARCHAR(512) NOT NULL,
  locked          TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order      INT          NOT NULL DEFAULT 0,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, artifact_id),
  CONSTRAINT fk_art_run FOREIGN KEY (run_id) REFERENCES wireframe_run(run_id)
);

CREATE TABLE IF NOT EXISTS wireframe_instruction (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id          VARCHAR(64)  NOT NULL,
  artifact_id     VARCHAR(64)  NOT NULL,
  body            TEXT         NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_run_art (run_id, artifact_id)
);
```

생성은 파일만으로 돈다. MySQL은 목록·잠금·확정·API 공유용. **SQLite 없음.**

오프라인: CLI는 파일만 쓰고 `wireframe sync`로 메타 push.  
배포: API가 쓰기 시점에 파일+MySQL을 맞춘다.

---

## 5. WONJD · DB 조회

- **실시간** = extract/domain 때 필요한 테이블만 조회.
- **아님** = 화면 재생성마다 라이브 쿼리.

CRM DB 자격증명은 이 레포에 안 둔다. WONJD가 들고 툴 호출만.

---

## 6. 프로세스 구성 (로컬)

```
뷰어(Vite) → apps/api(MySQL) → CLI(extract|domain|plan|render)
                                ├─ crm_* 파일
                                ├─ projects/ · wireFrame/
                                └─ WONJD
```

Hermes는 CLI 껍데기만. 채팅·폼·로컬이 같은 CLI.

---

## 7. LLM 컨텍스트 (단계마다 최소)

| 단계 | 컨텍스트 |
| --- | --- |
| domain | PRD + `db.json` 중 관련 테이블만 (전체 금지) |
| plan | PRD + domain + routes 요약 + design 규칙 요약 |
| render | shell 요약 + 해당 artifact + domain judgements + instructions + 코드값 |
| iterate | 기존 HTML + 새 instruction + shell 제약 |

하드 룰: 셸 우회 금지 · 개인정보 금지 · locked 무시 금지 · 가정은 assumptions.

---

## 8. 로컬 구현 순서

| 순서 | 산출 | 완료 기준 |
| --- | --- | --- |
| 1 | config + 폴더 골격 | 경로 해석 |
| 2 | MySQL 스키마 | SQLite 경로 없음 |
| 3 | extract 샘플 json | 자산 존재 |
| 4 | shell | 셸 참조만 |
| 5 | run create → domain → plan → render | PRD → HTML |
| 6 | artifact 단위 재생성 | instructions |
| 7 | 뷰어 SPEC 맞춤 | runs/artifacts |
| 8 | API로 CLI 래핑 | Hermes 동일 경로 |

1~5면 로컬 목표 달성.

---

## 9. 실패·열화 (멈추지 않음)

| 상황 | 동작 |
| --- | --- |
| CRM 경로 없음 | `mode: new`, 회색 와이어 셸 |
| WONJD/DB 실패 | `db.json` 비우거나 유지, domain 최소 판정, assumption |
| 테이블 미매칭 | entities 빈 배열, 목록+상세 기본 템플릿 |
| LLM 실패 | 재시도 1회 후 플레이스홀더 HTML + assumption |

---

## 10. 한 줄 요약

**원천(프론트·백·DB) → 추출 스냅샷 → (PRD만) → domain 판정 → plan → shell 위 병렬 render.**  
상태는 파일 SSOT + MySQL 메타. SQLite 없음. DB 질의는 자산/domain 밖 금지.
