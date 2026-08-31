# 클론 프로젝트 통합

대상 repo 프레임워크를 자동 감지한 뒤 템플릿을 복사합니다.

```bash
# wireframe-studio 루트에서
pnpm wf detect --repo ../my-app          # 사람이 읽기 쉬운 요약
pnpm wf detect --repo ../my-app --json   # ProjectSpec JSON

pnpm wf integrate --repo ../my-app           # 템플릿 복사
pnpm wf integrate --repo ../my-app --dry-run # 복사 없이 미리보기
```

## Next.js App Router — 파일 1개

```bash
pnpm wf integrate --repo ../my-app
# → app/wireframe/[[...slug]]/page.tsx
```

또는 직접:

```tsx
// app/wireframe/[[...slug]]/page.tsx
export { default } from "@wireframe-studio/next";
```

템플릿: `integrations/next/wireframe.page.tsx`

## Next.js Pages Router — page + API

```bash
pnpm wf integrate --repo ../my-app
# → pages/wireframe/[[...slug]].tsx
# → pages/api/wireframe/[...path].ts
```

템플릿:

- `integrations/next-pages/wireframe.page.tsx`
- `integrations/next-pages/wireframe.api.ts`

패키지: `@wireframe-studio/react` + `@wireframe-studio/server`

## React (Vite / CRA / react-router)

```bash
pnpm wf integrate --repo ../my-app
# → src/routes/wireframe.tsx (react-router) 또는 src/pages/Wireframe.tsx
```

템플릿: `integrations/react/wireframe.route.tsx`

패키지: `@wireframe-studio/react` — client-only, `apiBase="/wireframe/api"` 프록시 필요

## URL

| 경로 | 설명 |
|------|------|
| `/wireframe` | 프로젝트 목록 |
| `/wireframe/01/growth-pause` | 최상위 이슈 (epic) |
| `/wireframe/01/growth-pause/screens/01-list` | 하위 이슈 (screen) |

## 데이터

- App Router: Server Actions (`@wireframe-studio/next`)
- Pages / SPA: `/wireframe/api/*` → `handleWireframeApi` (`@wireframe-studio/server/routes`)
- HTML은 iframe `srcDoc`으로 표시
- `DATABASE_URL` + `pnpm db:setup`

## 스튜디오 로컬 개발

```bash
pnpm dev   # viewer :5173/wireframe + api :3001
```
