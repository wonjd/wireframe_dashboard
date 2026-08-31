# 워크플로우

```
0. git clone
1. PRD 입력 (필수)
2. 기존 프로젝트를 감지하시겠습니까? y/n
3. [y인 경우] 도메인 · DB 감지 → spec 작성
4. issue/{id}.html 생성 (화면 1개 = 이슈 1개)
```

## 실행

```bash
pnpm wf          # 인터랙티브
pnpm wf start    # 동일

pnpm wf start --project crm --feature growth-pause --prd ./prd.md --detect y --repo ../crm
pnpm wf start --project landing --feature onboarding --prd ./prd.md --detect n
```

## 산출물 — `wireFrame/` 하나

```
wireFrame/
├── index.json
├── spec/                 # 스캔·스펙
│   ├── {id}.md
│   ├── {id}.json         # y인 경우만
│   └── {id}.manifest.json
├── issue/                # HTML — 이슈 id별
│   ├── 01-list.html
│   └── 02-detail.html
├── input/                # PRD 원본
│   └── {id}.md
└── prompt/               # Claude 입력
    └── {id}.txt
```

**이슈 구조:** epic(최상위) = PRD 기능 · 하위 화면 = `issue/{id}.html`
