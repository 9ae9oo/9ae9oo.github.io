# Creator Workspace 에이전트 지침

## 프로젝트 한눈에

- 웹툰·만화 창작자를 위한 브라우저 작업 도구입니다.
- 번들러와 외부 라이브러리 없이 일반 HTML, CSS, JavaScript로 동작합니다.
- 앱의 시작점은 [index.html](index.html)이고, 현재 데이터는 브라우저 LocalStorage의 `mw.v1`에 저장됩니다.
- 제품 요구사항과 진행 계획은 [README.md](README.md), [docs/prd-v1.html](docs/prd-v1.html), [docs/spec-v2.0.html](docs/spec-v2.0.html), [docs/plan-v3.md](docs/plan-v3.md)를 먼저 참고합니다.

## 작업 원칙

- 설명과 변경 이유는 초보자도 이해할 수 있게 짧고 쉬운 한국어로 작성합니다. 전문 용어가 필요하면 처음 한 번만 뜻을 덧붙입니다.
- 요청과 직접 관련된 파일만 조사하고 수정합니다. 기존 사용자 변경사항과 무관한 리팩터링은 하지 않습니다.
- 먼저 실제 동작을 결정하는 함수와 인접 호출부를 확인한 뒤, 가장 작은 수정으로 해결합니다.
- 기존 구조와 전역 네임스페이스 `MW`를 따릅니다. 새 프레임워크, 번들러, 외부 의존성은 필요성이 분명하지 않으면 추가하지 않습니다.
- HTML에서 JavaScript 파일을 불러오는 순서를 함부로 바꾸지 않습니다. 앞에서 정의된 `MW` API를 뒤의 모듈이 사용할 수 있습니다.
- 저장 데이터의 모양을 바꿀 때는 [js/store.js](js/store.js)의 기본값·마이그레이션·백업 동작을 함께 검토합니다. 파생값은 저장하지 않고 기존 데이터와의 호환성을 유지합니다.
- 사용자 입력을 HTML로 렌더링할 때는 기존 이스케이프·정제 유틸리티를 우선 사용합니다.
- `legacy/`는 참고용 PyQt6 이전 앱이므로 웹 앱 변경에 필요할 때만 건드립니다.
- 코드 주석은 꼭 필요한 경우에만 추가하며, 코드 자체로 의도가 드러나게 작성합니다.

## 검토와 확인

- 수정 전에는 어떤 코드 경로가 문제를 결정하는지, 무엇으로 가설을 확인할지 먼저 정합니다.
- 수정 후에는 다음 순서로 확인합니다.
  1. 가능한 가장 좁은 관련 테스트나 실행 확인을 합니다.
  2. 자동 테스트가 없으면 로컬 서버에서 수정한 화면과 핵심 흐름을 직접 확인합니다.
  3. 단일 파일 배포에 영향이 있으면 `py -3 scripts/build-single.py`도 실행합니다.
  4. 결과와 남은 위험을 파일 링크와 함께 간단히 보고합니다.
- 기능을 바꾸면 정상 경로뿐 아니라 빈 데이터, 잘못된 입력, 새로고침, 모바일 폭을 함께 검토합니다.
- 테스트를 실행하지 못했으면 실행한 것처럼 말하지 않고, 이유와 사용자가 실행할 명령을 적습니다.

## 실행 명령

```powershell
# 앱 확인
py -m http.server 8000
# 브라우저에서 http://localhost:8000 열기

# 단일 HTML 빌드 확인
py -3 scripts/build-single.py
py -3 scripts/build-single.py --fonts
```

`index.html`을 직접 열어도 기본 기능은 동작하지만, 브라우저 확인과 파일 가져오기 같은 흐름은 로컬 서버에서 점검하는 편이 안전합니다.

## 주요 경계

- [js/store.js](js/store.js): 단일 상태 저장소, 구독, 백업, 스키마 마이그레이션
- [js/shell.js](js/shell.js): 해시 라우팅, 패널·플로팅 창, 알림, 테마 적용
- [js/app.js](js/app.js): 부팅, 홈 대시보드, 전역 렌더링
- [js/timer.js](js/timer.js), [js/todo.js](js/todo.js), [js/memo.js](js/memo.js), [js/calendar.js](js/calendar.js), [js/work.js](js/work.js), [js/ledger.js](js/ledger.js): 각 기능의 동작 로직
- `css/tokens.css`: 색상·폰트 토큰
- `css/shell.css`: 공통 레이아웃·반응형·패널
- `scripts/build-single.py`: CSS·JavaScript·소리를 하나의 HTML로 인라인하는 표준 라이브러리 빌드
