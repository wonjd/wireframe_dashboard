# Wireframe

PRD를 주면 와이어프레임 HTML을 만들고, 팀은 `/wireFrame`에서 본다.

기존 프로젝트인지 새 프로젝트인지는 묻지 않는다. 에이전트가 판단한다.

에이전트: [AGENTS.md](./AGENTS.md)

## 팀

```bash
npm install
npm run dev
```

브라우저: http://localhost:5173/wireFrame

## 하는 일

1. PRD를 준다
2. 기존 코드가 있으면 도메인·DB를 보고, 없으면 PRD만으로 화면을 만든다
3. `wireFrame/issue/{id}.html` 에 저장한다
4. 팀이 `/wireFrame`에서 확인한다

## 폴더

```
wireFrame/
  issue/    화면 HTML
  input/    PRD
  spec/     목록
```
