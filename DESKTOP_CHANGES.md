# Desktop 폴더 적용된 변경사항

## 완료된 항목
1. ✅ 실행 가능 여부 체크박스 제거 - renderer.js:698-704
2. ✅ 필터를 다중 선택 카드 형태로 변경 - index.html, renderer.js, styles.css

## 진행중인 항목
3-10번 항목들은 코드 양이 방대하여 주요 파일들만 부분적으로 수정됨

주요 수정 필요 파일:
- renderer.js: 할일/노트 연결 허용, ESC 키, Cmd+Z, 제목 편집, 패널 간소화
- styles.css: 선택된 카드 강조, 글씨 크기, 제목 input 스타일
- index.html: 온보딩 모달 업데이트

## 참고사항
desktop 버전은 Markdown 파일 기반이므로 루트 버전과 달리:
- localStorage 대신 파일 시스템 사용
- Cmd+S는 이미 구현되어 있음 (renderer.js:863-880)
- 파일 저장 로직이 복잡함 (frontmatter 파싱 필요)
