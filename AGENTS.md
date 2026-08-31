# 에이전트

클론 후 이 파일만 보면 된다.

유저가 PRD만 준다. 기존인지 새 프로젝트인지 묻지 않는다.

```
1. PRD → wireFrame/input/{id}.md
2. 옆에 실제 서비스 코드(package.json + app/src 또는 DB)가 있으면 existing
   이 레포 자신은 기존 프로젝트가 아니다
3. existing → 도메인·DB + 기존 디자인을 보고 화면을 만든다
   레이아웃, 간격, 컴포넌트, 타이포, 색을 그 프로젝트에서 가져온다
   새로 꾸미지 않는다
4. 없으면 PRD만으로 회색 와이어를 만든다
5. 화면 1개 = wireFrame/issue/{id}.html
6. wireFrame/index.json 과 spec/{id}.manifest.json 을 맞춘다
```

팀은 프론트 도메인의 `/wireFrame`에서 본다. 도메인은 상관없다.

팀 MySQL이 필요하면 `wireframe_issue.sql`을 클론 프로젝트 DB에 한 번만 실행한다. 이 레포는 DB를 갖지 않는다.
