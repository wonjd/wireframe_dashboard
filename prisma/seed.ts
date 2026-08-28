/**
 * 개발용 seed — Phase 1의 "LLM 없이 하드코딩 IR로 계약 검증" (§16).
 *
 * ANTHROPIC_API_KEY 없이도 렌더러·인터랙션·버전·stale·이력 연결을 전부 확인할 수 있다.
 * 실행: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { wireframeDocSchema } from "../lib/wireframe/schema";

const db = new PrismaClient();

const SOURCE_TEXT = `# 주문 관리 어드민

## 배경
운영팀이 주문을 엑셀로 수동 관리하고 있어 누락과 중복이 자주 발생한다.

## 기능 요구사항

### 1. 주문 목록
- 주문번호, 고객명, 금액, 상태를 표로 보여준다.
- 주문번호/고객명으로 검색하고 상태로 필터링한다.
- 행을 클릭하면 주문 상세로 이동한다.

### 2. 주문 상세
- 주문 기본 정보를 보여준다.
- "주문 취소"를 누르면 확인 모달이 뜬다.
`;

const DOC = {
  version: "1",
  screens: [
    {
      id: "scr-order-list",
      name: "주문 목록",
      route: "/orders",
      layout: "sidebar-left",
      nodes: [
        {
          id: "n-sidebar",
          type: "sidebar",
          props: {
            items: [
              { label: "주문 관리", action: { type: "navigate", targetScreenId: "scr-order-list" } },
              { label: "고객 관리", action: { type: "navigate", targetScreenId: "scr-customer-list" } },
            ],
          },
        },
        { id: "n-title", type: "header", gridSpan: 12, props: { title: "주문 목록", subtitle: "전체 주문을 조회하고 상태를 관리합니다" } },
        { id: "n-search", type: "input", gridSpan: 6, props: { label: "검색", placeholder: "주문번호 또는 고객명" } },
        { id: "n-filter", type: "select", gridSpan: 3, props: { label: "상태", options: ["전체", "결제대기", "결제완료", "배송중", "배송완료", "취소"] } },
        { id: "n-search-btn", type: "button", gridSpan: 3, props: { label: "검색", variant: "primary" } },
        {
          id: "n-order-table",
          type: "table",
          gridSpan: 12,
          action: { type: "navigate", targetScreenId: "scr-order-detail" },
          props: {
            columns: ["주문번호", "고객명", "금액", "상태"],
            sampleRows: [
              ["ORD-20260828-001", "김OO", "128,000원", "결제완료"],
              ["ORD-20260828-002", "이OO", "54,000원", "배송중"],
              ["ORD-20260827-118", "박OO", "312,000원", "배송완료"],
            ],
          },
        },
        { id: "n-hint", type: "text", gridSpan: 12, props: { text: "표를 클릭하면 주문 상세로 이동합니다.", muted: true } },
      ],
    },
    {
      id: "scr-order-detail",
      name: "주문 상세",
      route: "/orders/[id]",
      layout: "sidebar-left",
      nodes: [
        {
          id: "n-sidebar-2",
          type: "sidebar",
          props: {
            items: [
              { label: "주문 관리", action: { type: "navigate", targetScreenId: "scr-order-list" } },
              { label: "고객 관리", action: { type: "navigate", targetScreenId: "scr-customer-list" } },
            ],
          },
        },
        { id: "n-detail-header", type: "header", gridSpan: 12, props: { title: "주문 상세", subtitle: "ORD-20260828-001" } },
        {
          id: "n-info-card",
          type: "card",
          gridSpan: 12,
          props: { title: "주문 정보" },
          children: [
            { id: "n-customer", type: "input", gridSpan: 6, props: { label: "고객명", placeholder: "김OO" } },
            { id: "n-phone", type: "input", gridSpan: 6, props: { label: "연락처", placeholder: "010-0000-0000" } },
            { id: "n-address", type: "input", gridSpan: 12, props: { label: "배송지", placeholder: "서울시 ..." } },
          ],
        },
        {
          id: "n-items-table",
          type: "table",
          gridSpan: 12,
          props: { columns: ["상품명", "수량", "금액"], sampleRows: [["무선 이어폰", "1", "128,000원"]] },
        },
        { id: "n-back-btn", type: "button", gridSpan: 3, action: { type: "navigate", targetScreenId: "scr-order-list" }, props: { label: "목록으로", variant: "secondary" } },
        { id: "n-cancel-btn", type: "button", gridSpan: 3, action: { type: "openModal", targetNodeId: "n-cancel-modal" }, props: { label: "주문 취소", variant: "danger" } },
        {
          id: "n-cancel-modal",
          type: "modal",
          gridSpan: 12,
          props: { title: "주문을 취소하시겠습니까?", open: false },
          children: [
            { id: "n-modal-text", type: "text", gridSpan: 12, props: { text: "취소한 주문은 되돌릴 수 없습니다." } },
            { id: "n-modal-cancel", type: "button", gridSpan: 6, action: { type: "closeModal" }, props: { label: "닫기", variant: "secondary" } },
            { id: "n-modal-confirm", type: "button", gridSpan: 6, action: { type: "closeModal" }, props: { label: "주문 취소", variant: "danger" } },
          ],
        },
      ],
    },
    {
      id: "scr-customer-list",
      name: "고객 목록",
      route: "/customers",
      layout: "sidebar-left",
      nodes: [
        {
          id: "n-sidebar-3",
          type: "sidebar",
          props: {
            items: [
              { label: "주문 관리", action: { type: "navigate", targetScreenId: "scr-order-list" } },
              { label: "고객 관리", action: { type: "navigate", targetScreenId: "scr-customer-list" } },
            ],
          },
        },
        { id: "n-cust-header", type: "header", gridSpan: 12, props: { title: "고객 목록" } },
        { id: "n-cust-search", type: "input", gridSpan: 9, props: { label: "검색", placeholder: "고객명" } },
        { id: "n-cust-search-btn", type: "button", gridSpan: 3, props: { label: "검색", variant: "primary" } },
        {
          id: "n-cust-table",
          type: "table",
          gridSpan: 12,
          props: {
            columns: ["고객명", "이메일", "가입일", "누적 주문"],
            sampleRows: [
              ["김OO", "kim@example.com", "2026-01-14", "12"],
              ["이OO", "lee@example.com", "2026-03-02", "3"],
            ],
          },
        },
      ],
    },
  ],
};

async function main() {
  // seed 데이터도 실제 저장 경로와 같은 검증을 통과해야 한다 —
  // 그래야 "렌더러가 받는 문서"의 계약이 seed와 생성 경로에서 동일해진다.
  const parsed = wireframeDocSchema.safeParse(DOC);
  if (!parsed.success) {
    console.error("seed IR이 스키마 검증에 실패했습니다:");
    for (const i of parsed.error.issues) console.error(` - ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }

  const user = await db.user.upsert({
    where: { worksUserId: "dev-stub-user" },
    update: {},
    create: { worksUserId: "dev-stub-user", email: "dev@example.com", name: "개발용 사용자" },
  });

  const contentHash = createHash("sha256").update(SOURCE_TEXT, "utf8").digest("hex");

  const prd = await db.prd.create({
    data: {
      title: "주문 관리 어드민 (seed)",
      sourceText: SOURCE_TEXT,
      contentHash,
      status: "GENERATED",
      createdById: user.id,
    },
  });

  const revision = await db.prdRevision.create({
    data: {
      prdId: prd.id,
      revision: 1,
      sourceText: SOURCE_TEXT,
      contentHash,
      source: "UPLOAD",
      authorId: user.id,
    },
  });

  const wireframe = await db.wireframe.create({
    data: {
      prdId: prd.id,
      version: 1,
      docJson: JSON.stringify(parsed.data),
      prdRevisionId: revision.id,
      model: "seed-hardcoded",
    },
  });

  await db.generationJob.create({
    data: { prdId: prd.id, status: "DONE", trigger: "T1", triggeredById: user.id, wireframeId: wireframe.id },
  });

  console.log("seed 완료");
  console.log(`  PRD: ${prd.id}`);
  console.log(`  화면: ${parsed.data.screens.map((s) => s.name).join(", ")}`);
  console.log(`  http://localhost:3000/prd/${prd.id}/wireframe`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
