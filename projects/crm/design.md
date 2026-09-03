# CRM 와이어프레임 규칙층 (퍼블 레시피)

추출 JSON(`design.json` 등)은 덮어써도 되지만, 이 파일의 판단은 사람이 유지한다.
화면 HTML은 **셸(`shell.html`) CSS 클래스만** 사용한다. 화면 안에서 색·간격·컴포넌트를 새로 정의하지 않는다.

## CRM 크롬

| 영역 | 토큰 / 값 | 클래스 |
| --- | --- | --- |
| TopNav | `#2d3539` | `wfs-topnav`, `wfs-topnav-logo`, `wfs-topnav-chip`, `wfs-topnav-user` |
| SideNav | `#465464` | `wfs-sidenav`, `wfs-nav-group`, `wfs-nav-item` |
| 본문 배경 | `#f5f6f8` | `wfs-main` / `--bg` |
| Brand | `#246beb` | `--brand`, `wfs-btn` |

실물 `crm_frontend` TopNav / SideNav 톤을 따른다. 밝은 회색 관리자 셸로 되돌리지 않는다.

## 화면 레시피

### 목록
`wfs-page-head` → `wfs-filters`(+ `wfs-search`) → `wfs-data-bar` → `wfs-table-wrap`/`wfs-table` → `wfs-paging`  
샘플 행 3~5개, 합성값만. 빈 목록은 `wfs-empty`.

### 폼 / 위자드
`wfs-page-head` → `wfs-section` → 필드 → `wfs-actions`  
- 유형·제작방식(옵션 2~3): `wfs-choice-card`  
- 옵션 ≤5: radio / `wfs-chip`  
- 옵션 >5: `wfs-select`  
- 첨부·레퍼런스: `wfs-dropzone`  
- 복수 행: `wfs-repeat-list`  
- 액션: `wfs-actions` (이전 / 다음 / 제출 / 임시저장)  
필수 `*`, 전체폭 `wfs-field--full`, 글자수 `wfs-char-count`.

### 모달
PRD `화면 양식=모달/팝업`이면 `wfs-modal-backdrop` + `wfs-modal` 안에 위 폼만. 설명 문구 금지.

### 목록
`화면 양식=목록 표`이면 필터·표·페이징.

### 상세
`wfs-page-head` → `wfs-dl-grid` → `wfs-actions`

### 개요
요청 요약·단계 목록만. DB 테이블 덤프·요구사항 문장 카드 나열 금지.

## 라벨

- 화면에 **한글 업무명**만 쓴다. (`콘텐츠 유형`, `제작 방식`, `레퍼런스` …)
- raw 코드(`C025A`), `db · TABLE`, 컬럼명(`CONTENT_DIV_CD`)을 와이어에 넣지 않는다. (domain JSON 내부만)
- enum / `*_CD`: 실제 codes의 **표시 라벨**을 radio·select·chip에 쓴다.

## 컨트롤

- NOT NULL → 필수 `*`
- FK → 연결 선택/표시
- free-text codes·감사 필드(`CREATED_*` 등)·비밀번호: 화면 제외

## 금지

- 셸 CSS 밖 인라인 스타일·신규 컴포넌트 정의
- PRD 단계 문단·요구사항·설명 문장을 카드/노트로 나열 (화면·컨트롤·버튼만)
- 개인정보·실명·실연락처 샘플 (합성값만)
- 아이콘·애니메이션·그림자 스택으로 “자세히” 흉내 내기
- 화면 안 스크롤 — 뷰포트에 맞추고 넘치는 내용은 자른다

## AI 생성 규칙

- 한 HTML = 한 플로우 단계. 설명 문구 금지, UI·동작만.
- 상단 플로우 전환은 대시보드가 담당. HTML 안에 전체 앱 셸·사이드바를 넣지 않는다.

## 디테일 상한

데이터·배치가 자세한 것이지 시각 효과가 자세한 것이 아니다.
