# README — Claude Code 사용법

이 폴더는 **컬리버 통합관리 + 탄소 MRV 플랫폼**을 Claude Code로 개발하기 위한 패키지입니다.

## 폴더 구성
```
CULIVER-MRV-Platform/
├── 00_개발의뢰서_MASTER.md      ← 최상위 사양서(PRD). 단일 진실 공급원.
├── CLAUDE.md                    ← Claude Code가 매 세션 자동 로드하는 프로젝트 규칙.
├── README_사용법.md             ← (이 파일)
└── .claude/agents/              ← 전담 팀(서브에이전트) 6명
    ├── architect.md             기술 리드 / 설계 / ADR / 작업분해
    ├── data-kpi-engineer.md     KPI·MRV·추천 산식 단독 책임 (핵심 IP)
    ├── backend-engineer.md      FastAPI · DB/Timescale · MQTT 수집 · 인증
    ├── frontend-engineer.md     React 대시보드 · 차트 · 리포트 뷰어
    ├── ui-ux-designer.md        디자인 시스템 · 시각화 표준 · 온보딩
    └── qa-reviewer.md           머지 전 검증 게이트키퍼
```

## 설치 (3단계)
1. 새 프로젝트 폴더를 만들고 이 4가지를 그 폴더 **루트**에 둡니다:
   `00_개발의뢰서_MASTER.md`, `CLAUDE.md`, `README_사용법.md`, `.claude/` 폴더.
2. 해당 폴더에서 터미널을 열고 `claude` 실행.
3. Claude Code는 `CLAUDE.md`와 `.claude/agents/`를 자동 인식합니다. (확인: `/agents`)

> `.claude` 는 숨김 폴더입니다. 안 보이면 `ls -a` 또는 탐색기 "숨김 항목 보기"로 확인하세요.

## 팀(서브에이전트) 작동 방식
- 메인 Claude Code 세션이 **오케스트레이터**입니다: 계획 → 위임 → 통합 → 검증.
- 큰 일은 `architect`에게 설계를 받고, 구현을 FE/BE/KPI에게 나눠 위임합니다.
- **KPI/MRV/추천 산식은 `data-kpi-engineer`만** 손댑니다(나머지는 호출만).
- "끝났다" 싶으면 **반드시 `qa-reviewer`가 마지막 검증**을 합니다.

## 착수 프롬프트 (Claude Code에 그대로 붙여넣기)
```
프로젝트 루트의 00_개발의뢰서_MASTER.md 와 CLAUDE.md 를 정독해라.
너는 오케스트레이터다. 직접 코딩 전에 architect에게 위임해 다음을 받아라:

1) 모노레포 디렉터리 구조 확정안 (/apps/web, /apps/api, /packages/kpi, /infra)
2) 스프린트 0 작업 분해 (MASTER 10장) — 각 작업의 수용 기준 포함
3) DB→API→UI를 끝까지 관통하는 첫 수직 슬라이스 제안
   (가상 양식장 시드 → readings 더미 → EI 1개 산출 → 대시보드 카드 1개 표시)

그 다음 스프린트 0을 실제로 구현하되:
- KPI 함수는 data-kpi-engineer가 /packages/kpi 에 순수 함수 + 단위테스트로.
- DB/마이그레이션/수집/인증 골격은 backend-engineer가.
- 대시보드 셸과 첫 차트는 frontend-engineer가 (디자인 토큰은 ui-ux-designer 규약 사용).
- 완료 판단 전 qa-reviewer가 멀티테넌시 격리·결정론·그린빌드를 검증.

Docker Compose로 `make dev` 한 번에 뜨는 것이 스프린트 0의 완료 기준이다.
막히면 추측하지 말고 MASTER 문서를 재확인하고, 그래도 불명확하면 나에게 질문해라.
```

## 권장 진행 순서
1. **스프린트 0**: 부팅 + 수직 슬라이스(위 프롬프트).
2. **Phase 1(4~5월)**: 데이터 파이프라인 + 기준선 잠금 + KPI 엔진 v1 + 테스트.
3. **Phase 2(6~8월)**: START 대시보드 → 알림 → PRO 추천 보드 → A/B 비교.
4. **Phase 3(9~10월)**: MRV 리포트 자동생성 → SOP → ENTERPRISE(제어·멀티사이트) → 온보딩.

## 팁
- 한 번에 하나의 수직 슬라이스만. "대시보드 전체"가 아니라 "EI 카드 1개 끝까지".
- 산식을 바꾸고 싶으면 항상 data-kpi-engineer + 단위테스트 + kpi_config 버전.
- OEI 산식은 제안값입니다. 실증 데이터가 모이면 보정하고 버전을 남기세요.
- 전력 배출계수는 환경부/온실가스종합정보센터(GIR) 최신 공표값을 설정 테이블에 넣고 출처를 함께 저장하세요(MRV 검증성).
