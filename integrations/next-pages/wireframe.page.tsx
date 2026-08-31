/**
 * Next.js Pages Router — page + API route 2개
 *
 * 복사 위치:
 *   pages/wireframe/[[...slug]].tsx
 *   pages/api/wireframe/[...path].ts  (wireframe.api.ts 템플릿)
 *
 * 필요:
 *   - @wireframe-studio/react, @wireframe-studio/server workspace 의존성
 *   - 클론 프로젝트 MySQL에 wireframe_issue (integrations/mysql/wireframe_issue.sql)
 *   - DATABASE_URL = 클론 프로젝트 MySQL
 */
export { default } from "@wireframe-studio/react";
