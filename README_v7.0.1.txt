SEUL-POLICE v7.0.1

- 근무로직을 engine/workEngine.js로 분리
- 회전 규칙을 오른쪽 회전으로 고정: 1234 → 4123 → 3412 → 2341
- C반 1발전 기준 패턴만 1432 적용
- A/B/D 및 C반 2발전 기준 패턴은 1234 유지
- C반은 A/D/N 근무별 독립 카운트 유지
- app.js는 engine 결과를 받아 화면에 표시하도록 연결
- 기존 UI/Firebase/관리자설정은 유지
