# Wireframe

비개발자가 자연어 PRD를 넣으면 상세한 화면 HTML이 나온다.
마음에 들 때까지 직접 돌리고, 확정한 걸 개발자에게 넘긴다.

팀은 프론트 도메인의 `/wireFrame`에서 본다. 도메인은 상관없다.

## 왜

화면 디자이너가 없다. 요청이 이메일로 들어오고, 화면 없이 개발이 시작되니
UX가 어긋난다. 요청자가 **먼저 화면을 보고 고쳐서** 넘기면 그게 사라진다.

## 어디로 가나

와이어프레임은 **첫 번째 vertical**이다. 최종 목표는 도메인별 에이전트를 탭으로
관리하는 사내 도구고, 루프는 산출물 종류가 바뀌어도 같다 — 입력 · 무인 생성 ·
단위별 반복 · 확정 · 인계. 그래서 이름을 처음부터 중립적으로 뒀다
(`run` · `artifact` · `kind`). 자세한 건 [SPEC.md 확장](./SPEC.md#확장).

## 핵심 두 가지

**자산과 소모품을 나눈다.**
기존 코드베이스와 DB에서 뽑은 규격(`projects/{slug}/`)은 오래 간다.
화면 HTML은 소모품이라 얼마든지 갈아엎는다.
자산이 안 흔들리니 20번을 돌려도 톤과 구조가 유지된다.

**생성 단위는 산출물 1개다.**
지시한 화면만 다시 그리고 나머지는 건드리지 않는다.
셋 중 하나 고쳐달랬는데 셋 다 바뀌면 그 도구는 두 번째 시도에서 버려진다.

## 문서

| | |
| --- | --- |
| [AGENTS.md](./AGENTS.md) | 에이전트 계약 — 단계별 입출력과 하드 룰 |
| [WORKFLOW.md](./WORKFLOW.md) | 사람 흐름 — 요청자 반복, 개발자 인계 |
| [SPEC.md](./SPEC.md) | 파일 스펙 — 자산 · manifest · 규칙층 |

## 폴더

```
projects/{slug}/          자산 — 프로젝트당 1회 + 증분
  design.json               추출층: 색 · 간격 · 타이포 · 컴포넌트
  routes.json               추출층: 라우트 ↔ 파일 ↔ 화면
  api.json                  추출층: 엔드포인트 · 필드
  db.json                   추출층: 테이블 · FK · 코드값 · 규모
  design.md                 규칙층: 사람이 쓴다. 재추출에 안 덮인다
  domain.md                 규칙층
  glossary.md               규칙층: 업무 용어 ↔ DB ↔ 화면 라벨
  shell.html                공통 골격

wireFrame/                소모품 — PRD마다
  index.json                프로젝트 · run 레지스트리
  input/{run}.md            PRD 원문
  spec/{run}.manifest.json       산출물 목록 · 잠금 · 지시 로그
  spec/{run}.domain.json         구조 판정
  artifacts/{run}/{id}.html      산출물 (화면 HTML)
```

## 이 레포는 DB를 갖지 않는다

산출물은 전부 파일이고 git에 들어간다.
벡터 인덱스도 쓰지 않는다 — 이유는 [SPEC.md](./SPEC.md#왜-파일인가).

## 뷰어

```bash
npm install
npm run dev      # http://localhost:5173/wireFrame
```
