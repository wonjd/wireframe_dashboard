# Wireframe Studio

PRD만 주면 와이어프레임을 구성한다.
기존 프로젝트인지, 새 프로젝트인지는 묻지 않는다.

자세히: [WORKFLOW.md](./WORKFLOW.md) · 에이전트: [AGENTS.md](./AGENTS.md)

## 사용

```bash
pnpm install
pnpm wf
```

또는

```bash
pnpm wf start --prd ./prd.md
pnpm wf start --prd ./prd.md --repo ../crm   # 프로젝트 폴더를 알 때만
```

채팅이어도 같다. “PRD는 이거야”만 주면 된다.

## 자동 판단

| | 새 프로젝트 | 기존 프로젝트 |
|---|-----|----------|
| 언제 | 옆에 코드베이스 없음 | package.json + app/src 또는 DB |
| 하는 일 | PRD로 바로 와이어 | 도메인·DB 파악 후 와이어 |

이 스튜디오 레포 자신은 기존 프로젝트로 보지 않는다.

## 산출물

화면 1개 = `wireFrame/issue/{id}.html`

```
wireFrame/
  spec/     스캔·스펙
  issue/    HTML — 이슈 id별
  input/    PRD
  prompt/   Claude 입력
```

최상위 이슈(탭) → 하위 화면. HTML은 `wireframe_issue.html`.

## 보기

```bash
pnpm dev                  # http://localhost:5173/wireframe
```

| URL | 설명 |
|-----|------|
| `/wireframe` | 프로젝트 목록 |
| `/wireframe/01/growth-pause` | 탭 뷰어 |
| `/wireframe/01/growth-pause/screens/01-list` | 화면 딥링크 |

## DB

이 레포는 DB를 갖지 않는다. **클론한 프로젝트 MySQL**만 사용한다.

- 테이블: `wireframe_issue` 하나 (`integrations/mysql/wireframe_issue.sql`)
- `DATABASE_URL` = 클론 프로젝트 MySQL (SSH 터널이면 로컬 포트)
- 없으면 뷰어는 `wireFrame/` 파일만 본다

## 클론 프로젝트에 뷰어 붙이기

```bash
pnpm wf detect --repo ../my-app
pnpm wf integrate --repo ../my-app
```

| 감지 결과 | 복사 파일 |
|-----------|-----------|
| Next App Router | `app/wireframe/[[...slug]]/page.tsx` |
| Next Pages | `pages/wireframe/[[...slug]].tsx` + API |
| React SPA | `src/routes/wireframe.tsx` 등 |

자세한 내용: `integrations/README.md`
