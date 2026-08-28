# Wireframe Generator

PRD 파일(또는 붙여넣은 텍스트)을 넣으면 Cursor Cloud agent가 와이어프레임 IR(JSON)을
만들고, 브라우저가 그것을 화면으로 그린다. **그게 전부다.**

DB도, 로그인도, 잡 큐도, cron도 없다. 상태는 Cursor 쪽 run에만 있다.

## 동작

```
[브라우저]  PRD 파일 드롭 / 텍스트 붙여넣기
    │  POST /api/generate         { sourceText, model }
    ▼
[Vercel]    Cursor API 로 agent 착수  →  { agentId, runId } 즉시 반환
    │
    │  GET /api/generate?agentId=..&runId=..   (2초마다 폴링)
    ▼
[Vercel]    Cursor run 조회 → FINISHED 면 결과 텍스트에서 JSON 추출 → IR 반환
    │
    ▼
[브라우저]  WireframeRenderer 가 IR을 React 컴포넌트로 렌더
```

폴링을 클라이언트가 하므로 서버 함수는 매 요청 몇 초 안에 끝난다.
Vercel 함수 실행 시간 제한과 무관하게 몇 분짜리 생성도 견딘다.

## 환경 변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `CURSOR_API_KEY` | ✅ | `crsr_...` 형태의 Cursor API 키. 서버 전용 |
| `CURSOR_API_BASE_URL` | — | 기본 `https://api.cursor.com` |

로컬은 `.env.local`, 배포는 Vercel 프로젝트 환경 변수에 넣는다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3210
npm run typecheck
npm run build
```

## 구조

```
app/
  page.tsx                    입력 → 생성 → 결과, 화면 하나
  api/generate/route.ts       POST 착수 / GET 폴링 / DELETE 중단
components/
  generator.tsx               입력 폼 + 폴링 + 결과 헤더 (클라이언트)
  wireframe/renderer.tsx      IR → 화면 (내비게이션·모달 상태 머신)
  wireframe/node-view.tsx     노드 타입별 렌더링
lib/
  cursor-cloud.ts             Cursor REST (착수 / 조회 / 취소)
  constants.ts                모델, 상한값
  wireframe/prompt.ts         시스템·유저 프롬프트
  wireframe/generate.ts       프롬프트 조립, 응답에서 JSON 추출
  wireframe/coerce.ts         모델이 뱉은 JSON → 렌더 가능한 IR (관대하게 보정)
  wireframe/schema.ts         IR 정의 (Zod, 타입의 단일 소스)
```

## IR 원칙

모델은 HTML이 아니라 JSON(IR)을 만든다. 렌더러는 화이트리스트된 노드 타입과
액션(`navigate` / `openModal` / `closeModal`)만 실행하므로 스크립트 주입 경로가 없다.
모델 출력이 스키마에서 어긋나도 `coerce.ts`가 렌더 가능한 형태로 깎아 낸다 — 생성이
통째로 실패하는 것보다 낫다.

---

이전 버전(프로젝트 목록 / PRD 편집 / 버전 이력 / Prisma+Turso / Vercel Cron 잡 큐)은
`backup/pre-cleanup` 브랜치에 있다.
