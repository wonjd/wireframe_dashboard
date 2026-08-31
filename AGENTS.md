# Wireframe Studio — 에이전트용

클론 후 이 파일만 보면 된다.

## DB

테이블은 **`wireframe_issue` 하나**. 행 하나 = 이슈 하나.

```
parentId = null   → 최상위 이슈 (좌측 탭)
parentId = {id}   → 하위 이슈 (화면). id/slug로 구분
```

| 컬럼 | 의미 |
|------|------|
| `id` | 이슈 고유 id |
| `parentId` | 최상위면 null, 하위면 부모 id |
| `projectNo` | 프로젝트 번호 (`01`) |
| `slug` | 이슈 id (`growth-pause`, `01-list`) |
| `title` | 표시 이름 |
| `html` | 하위 이슈 와이어프레임. 최상위는 `""` |
| `sortOrder` | 정렬 |

- 좌측 탭: `parentId IS NULL`
- 하위 화면: `parentId = 최상위.id`
- 화면 HTML: 그 행의 `html`

Workspace / Member / Project / IssueVersion 테이블 없음.

스키마: `packages/db/prisma/schema.prisma`  
기존 MySQL에 이 테이블만 추가하면 됨 (`provider`를 `mysql`로).

## 산출물

```
wireFrame/
  spec/     스캔·스펙
  issue/    HTML — 이슈 id별
  input/    PRD
  prompt/   Claude 입력
```

## 워크플로우

```
0. git clone
1. PRD 입력
2. 기존 프로젝트 감지? y/n
3. y면 도메인·DB 감지 → spec
4. issue/{id}.html (화면 1개 = 이슈 1개)
```

`pnpm wf` 가 인터랙티브 진입점.
