# Wireframe Studio

**워크플로우:** `git clone` → `PRD` → **[existing만 감지]** → `HTML`
자세히: [WORKFLOW.md](./WORKFLOW.md)

**이슈 트리:** 최상위(epic) → 하위(screen) · HTML은 `issue_versions`

## DB

```bash
pnpm install
pnpm db:setup          # push + seed
pnpm dev               # API :3001 + viewer :5173
```

- `/wireframe/01/growth-pause` — epic
- `/wireframe/01/growth-pause/screens/01-list` — 하위 이슈
- HTML: `GET /api/html/:projectNo/:epicSlug/:screenSlug`

API 없으면 `projects/` 정적 파일로 fallback.

## 스키마

`Workspace` → `Project` → `Issue`(epic/screen, parentId) → `IssueVersion`(html)

Turso/Postgres로 옮길 때 `packages/db/prisma/schema.prisma` datasource만 변경.

## 클론 프로젝트 통합 (detect → integrate)

대상 repo의 프레임워크·라우터·번들러를 감지하고, 맞는 템플릿을 한 번에 복사합니다.

```bash
pnpm wf detect --repo ../my-app
pnpm wf detect --repo ../my-app --json
pnpm wf integrate --repo ../my-app
pnpm wf integrate --repo ../my-app --dry-run
```

| 감지 결과 | 복사 파일 | 패키지 |
|-----------|-----------|--------|
| Next App Router | `app/wireframe/[[...slug]]/page.tsx` | `@wireframe-studio/next` |
| Next Pages | `pages/wireframe/[[...slug]].tsx` + API route | `@wireframe-studio/react` |
| React SPA | `src/routes/wireframe.tsx` 등 | `@wireframe-studio/react` |

자세한 내용: `integrations/README.md`

## 구조

```
wireframe-studio/
├── apps/viewer/          # Vite + React — /wireframe
├── packages/core/        # manifest + ProjectSpec 스키마
├── packages/scanner/     # EXISTING 모드 repo 스캔 + framework detect
├── packages/react/       # client-only WireframeApp (Vite/Pages)
├── packages/next/        # Next App Router (Server Actions)
├── packages/renderer/    # 프롬프트 + HTML shell
├── integrations/         # detect/integrate 템플릿
├── design-kit/           # NEW 프로젝트 공통 컴포넌트
├── projects/             # 산출물 (manifest + screens)
└── cli/                  # wf generate | detect | integrate
```

## 실행

```bash
pnpm install
pnpm dev                  # http://localhost:5173/wireframe
```

## 라우팅

| URL | 설명 |
|-----|------|
| `/wireframe` | 프로젝트 목록 |
| `/wireframe/01` | PRD 목록 |
| `/wireframe/01/growth-pause` | 탭 뷰어 |
| `/wireframe/01/growth-pause/screens/02-detail` | 화면 딥링크 |

## 생성 (API 키 없음)

```bash
# EXISTING — 도메인·DB·framework 감지 후 prompt.txt 생성
pnpm wf generate --project crm_frontend --feature growth-pause --prd ./prd.md --mode existing --repo ../crm_frontend

# NEW — 감지 스킵, design-kit 기준
pnpm wf generate --project new-landing --feature onboarding --prd ./prd.md --mode new
```

1. `prompt.txt`를 Claude Code / Artifact에 붙여넣기
2. `screens/*.html` 저장 (화면 1개당 파일 1개)
3. `manifest.json`의 `screens` 배열 갱신
4. 뷰어에서 확인

## NEW / EXISTING

| | NEW | EXISTING |
|---|-----|----------|
| 감지 | 스킵 | 도메인·DB·framework |
| scanner | 스킵 | `detectExistingContext` |
| design | design-kit | 프로젝트 theme 추출 |
| manifest.mode | `new` | `existing` |
| diff 탭 | 없음 | NEW/MODIFY/EXTEND |

## 샘플

- `/wireframe/01/growth-pause`
