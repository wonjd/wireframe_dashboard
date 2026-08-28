/**
 * IR 타입은 Zod 스키마(schema.ts)에서 도출된다 — 단일 소스 유지 (§5.2).
 * 이 파일은 프론트/백이 공통으로 import하는 진입점일 뿐이다.
 */
export type {
  Action,
  NavItem,
  NodeType,
  Screen,
  WireframeDoc,
  WireframeNode,
} from "./schema";
