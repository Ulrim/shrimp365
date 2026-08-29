# ADR 0004 — MRV 리포트 PDF 생성 엔진 선택 (WeasyPrint vs Playwright)

- 상태(Status): 승인(Accepted) — architect 발의. 렌더링 엔진 선택은 표현/인프라 계층 결정이라
  `data-kpi-engineer` 합의 대상이 아니다(산식 무관, Rule 1 비해당). `backend-engineer` 구현 시
  본 ADR을 전제로 착수.
- 날짜: 2026-07-07
- 작성: architect
- 관련: MASTER 5장("WeasyPrint 또는 Playwright(HTML→PDF), 한글 폰트 임베드"), MASTER 3.3(MRV
  리포트 필수 구성), CLAUDE.md 기술스택("리포트: HTML→PDF … 한글 폰트 임베드"), 과설계 금지 원칙

## 맥락 (Context)

MASTER 5장은 PDF 생성 방식을 "WeasyPrint 또는 Playwright" 양자택일로 열어 두었다(확정 미결).
Phase 3의 MRV 리포트(화면10, ★최우선)와 주/월간 리포트(화면6, 이미 START 범위)가 이 결정에
의존한다. 두 후보의 성격이 다르다:

- **WeasyPrint**: 순수 Python(cffi 바인딩) HTML/CSS → PDF 렌더러. JS 미실행. 시스템 라이브러리
  (pango/cairo/gdk-pixbuf)만 필요.
- **Playwright**: 실제 헤드리스 브라우저(Chromium)를 구동해 페이지를 렌더링 후 PDF로 인쇄.
  JS 실행 가능(React 화면을 그대로 스크린샷/인쇄 가능) 하지만 브라우저 바이너리(~300MB+)와
  다수의 시스템 의존성(libnss3, libatk 등)을 컨테이너에 설치해야 한다.

MRV 리포트는 "심사위원이 달성/미달성을 판정할 수 있는 증빙 문서"(MASTER 1장)로서 **표·수치·
산식 전문·전후 그래프**를 담는 **구조화된 문서**이지, 대시보드 UI를 그대로 인쇄하는 것이
목적이 아니다(화면10 요구사항은 표/그래프/텍스트 조합이지 인터랙티브 위젯이 아님).

## 결정 (Decision)

**WeasyPrint**를 MRV/주간·월간 리포트 PDF 생성 엔진으로 채택한다.

1. **HTML 템플릿**: Jinja2(`apps/api/app/templates/mrv_report.html` 등)로 서버가 값을 채운
   정적 HTML을 생성 → WeasyPrint가 PDF로 렌더링. 신규 의존성: `weasyprint`, `jinja2`.
2. **그래프**: ECharts(FE 대시보드용)는 사용하지 않는다. 전후 비교 막대그래프처럼 단순한
   그래프는 서버에서 **직접 SVG를 생성**(수치 2~5개 막대 수준이므로 외부 플로팅 라이브러리
   없이 결정론적으로 생성 가능)해 HTML에 인라인 삽입한다. matplotlib 등 무거운 플로팅
   의존성은 이번 범위의 그래프 복잡도에 비해 과설계이므로 추가하지 않는다.
3. **한글 폰트 임베드**: 컨테이너 베이스 이미지의 시스템 폰트에 의존하지 않고, 폰트 파일
   (예: Pretendard 또는 Noto Sans KR 서브셋 OTF/WOFF)을 저장소에 포함
   (`apps/api/app/assets/fonts/`)하고 템플릿 CSS `@font-face { src: url(...) }`로 직접
   참조한다. → 어떤 배포 환경에서도 동일한 한글 렌더링 결과 보장(재현성 NFR과 결이 같음:
   렌더링 결과가 배포 환경에 의존하지 않아야 증빙물로서 신뢰 가능).
4. **Dockerfile 추가 apt 패키지**(WeasyPrint 런타임 의존): `libpango-1.0-0`,
   `libpangocairo-1.0-0`, `libcairo2`, `libgdk-pixbuf-2.0-0`, `libffi8`(또는 slim 이미지
   기준 명칭), `shared-mime-info`. Chromium 관련 패키지·브라우저 다운로드 단계는 불필요.

## 대안 (Alternatives considered)

- **Playwright(헤드리스 Chromium)**:
  - (+) FE 컴포넌트를 그대로 렌더링해 디자인 일치도가 높고, 복잡한 인터랙티브 레이아웃도
    소화 가능.
  - (−) 브라우저 바이너리 설치로 이미지 크기·빌드 시간 대폭 증가(파일럿 규모에 과설계).
  - (−) 헤드리스 브라우저 구동은 JS 실행·폰트 로딩·네트워크 대기 등 **비결정적 요소**가
    개입할 여지가 커서(타임아웃, 레이스) MRV 증빙 문서 생성의 재현성 신뢰도가 WeasyPrint
    대비 낮다(Rule 6의 정신을 산출 로직뿐 아니라 증빙 생성 파이프라인에도 최대한 적용).
  - (−) 컨테이너 샌드박스 플래그(`--no-sandbox` 등) 운영 부담, 워커 프로세스 메모리 사용량 큼.
  - → MRV 리포트가 "실시간 대시보드 스크린샷"이 아니라 "구조화된 증빙 문서"인 이상 이 비용을
    정당화할 요구사항이 없다. 기각(단, 향후 화면13 "맞춤 리포트 빌더"가 복잡한 FE 위젯을
    WYSIWYG로 그대로 인쇄해야 하는 요구가 명확해지면 그때 재검토 — 본 문서 6절에서 해당
    기능 자체를 이번 Phase 범위에서 제외했으므로 지금 결정할 필요 없음).
- **서버사이드 없이 FE에서 `window.print()`/브라우저 인쇄**: 사용자 브라우저·OS 폰트에 따라
  결과가 달라져(재현성 NFR 위반) 배포 후 "누가 열어도 같은 리포트"를 보장 못함. 기각.

## 결과 (Consequences)

- (+) 컨테이너 이미지 크기·빌드 시간 최소화(과설계 금지 원칙 부합).
- (+) 렌더링이 결정론에 가까움 — 동일 입력 HTML/CSS/폰트 → 동일 PDF 바이트 수준의 재현성.
- (+) 한글 폰트 임베드가 배포 환경에 독립적(라이선스 확인 필요: Pretendard(OFL) 또는
  Noto Sans KR(OFL) 등 임베드 허용 라이선스 폰트 사용).
- (−) WeasyPrint의 CSS 지원은 브라우저 대비 제한적(예: 일부 flex/grid 세부 동작 차이) →
  템플릿은 단순 표/블록 레이아웃 위주로 설계해야 한다(구현 시 제약으로 인지).
- (−) 복잡한 인터랙티브 위젯을 그대로 인쇄해야 하는 요구가 향후 생기면(화면13 고도화)
  재검토 필요 — 그 시점에 별도 ADR.
- 적용 범위: MRV 리포트(화면10, 이번 Phase 신규) + 기존 주/월간 리포트(화면6, MASTER
  START 범위이나 이번 문서 작성 시점 기준 미착수 — Phase 3에서 동일 파이프라인으로 함께
  정리할지는 9절 우선순위에서 별도 판단).
