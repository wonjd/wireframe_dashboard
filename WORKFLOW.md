# 워크플로우

유저가 할 일: **PRD만 준다.**
기존 프로젝트인지, 새 프로젝트인지는 묻지 않는다.

```
1. PRD 입력
2. (자동) 기존 코드베이스면 도메인·DB 파악
   (자동) 새 프로젝트면 바로 구성
3. issue/{id}.html 생성 (화면 1개 = 이슈 1개)
```

## 실행

```bash
pnpm wf                    # PRD 경로만 물어봄
pnpm wf start --prd ./prd.md
pnpm wf start --prd ./prd.md --repo ../crm   # 폴더를 알 때만
```

## 산출물 — `wireFrame/` 하나

```
wireFrame/
├── index.json
├── spec/                 # 스캔·스펙
│   ├── {id}.md
│   ├── {id}.json         # 기존 프로젝트일 때만
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
