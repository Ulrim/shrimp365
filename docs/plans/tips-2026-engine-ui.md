# 엔진 1·2·3 결과 화면 설계서 (수아)

- 작성: 수아 (디자이너)
- 작성일: 2026-10-02
- 상위 문서: `docs/plans/tips-2026-gap-and-plan.md` 6절 2-2 · 2-3 / `docs/plans/tips-2026-dataset-assessment.md`
- 대상 독자: **서연** (이 문서만 보고 구현 가능해야 한다) · 검수 **태양**
- 범위: `app/(dashboard)/production/page.tsx` 위에 올리는 추가분. **기존 화면 전면 재설계 아님.**
- 참조 스킬: `ui-ux-pro-max` — `references/quick-reference.md` §1 접근성 · §5 레이아웃 · §6 타이포·색 · §10 차트, `references/pro-rules.md` 사전인도 체크리스트
  (이 세션에서는 `Bash` 가 없어 `scripts/search.py` 를 돌리지 못했다. 스킬의 규칙 DB 를 파일로 직접 읽어 적용했고, 인용한 규칙 ID 는 전부 `quick-reference.md` 의 것이다.)

---

## 0. 이 설계서가 답하는 질문 네 개

엔진 셋은 이미 수를 돌려준다. 화면이 해야 하는 일은 **그 수를 크게 띄우는 것이 아니다.**

| # | 요구 | 이 설계서의 답 | 어디 |
|---|---|---|---|
| ① | 모르는 것을 모른다고 보여줄 것 | 금액을 **점이 아니라 축**으로 그린다. 8건의 경고가 그 축의 기하 자체가 된다 | 2-3 · 4-2 · 5-1 |
| ② | 추천은 점이 아니라 구간 | 달력 띠 + 모바일은 날짜 리본. **점 마커를 찍지 않는다** | 4-4 · 5-3 |
| ③ | 왜 그런지 보일 것 | 상쇄 분해(발산 막대) + 같은 데이터의 `<table>` 토글 | 4-5 · 5-4 |
| ④ | 생존율이 손익을 지배한다는 것 | 실측 ↔ 손익분기 **거리**를 한 줄로 쓰고, 그 거리를 차트에 음영으로 그린다 | 4-6 · 5-5 |

네 답 전부의 밑에 깔린 규칙 하나:

> **엔진이 `null` 을 돌려준 자리에 화면이 `0` 이나 `-` 를 쓰지 않는다.**
> 엔진 2 는 「0 원」과 「미입력」을 다른 사건으로 구분하려고 합계 필드 이름을 `totalKrw` 가 아니라
> `knownTotalKrw` 로 지었다(`lib/profitability/cost.ts` 머리주석). 화면에서 둘을 다시 뭉개면
> 그 설계가 통째로 무의미해진다. 미입력은 **빈 자리로 그리고, 그 자리를 채우는 버튼을 붙인다.**

---

## 1. 남기는 것 / 바꾸는 것 / 더하는 것

`app/(dashboard)/production/page.tsx` 는 735줄이고 전부 `"use client"` 다. **파일을 쪼개지 않는다.**
새 컴포넌트는 전부 `components/production/` (신규 디렉터리)에 두고 page.tsx 는 import 만 늘린다.

### 1-1. 남긴다 — 손대지 않음

| 대상 | 이유 |
|---|---|
| 사이클 목록 패널(616~716행) 전체 | 변경 없음 |
| 상단 요약 4카드(618~643행) | 변경 없음. **5번째 카드를 넣지 않는다** — `grid-cols-2 sm:grid-cols-4` 리듬이 깨진다 |
| `CycleDetail` 헤더·KPI 4카드(364~400행) | 변경 없음 |
| 모달 4종(`NewCycleDialog`·`NewSampleDialog`·`NewCostDialog`·`NewHarvestDialog`) | 변경 없음. 새 모달도 만들지 않는다 |
| `tabGrowth` 의 샘플 기록 리스트(437~454행) | 변경 없음 |
| `tabCost` 의 항목 리스트·카테고리 칩(467~500행) | 변경 없음 |
| **`tabFinance` 의 기존 6 KPI 카드**(505~532행) — `totalRevenue`·`totalCost`·`profit`·`roi`·`fcr`·`costPerKg` | **지우지 않는다.** 엔진 2 머리주석이 명시했다: 사후 집계 산식은 예측값의 **검증 기준**으로 남는다. 새 카드 아래로 밀리기만 한다 |
| `COST_CATEGORY_META` 색상 6종 | 비용 구성 막대가 **이 색을 그대로 쓴다.** 새 팔레트를 만들지 않는다 |

### 1-2. 바꾼다 — 최소 diff 3곳

| # | 위치 | 변경 | 분량 |
|---|---|---|---|
| B-1 | 404~408행 `TabsList` | `grid-cols-3` → `grid-cols-4`, `TabsTrigger value="harvest"` 추가. 트리거 글자는 `text-xs sm:text-sm` (375px 에서 4칸 = 칸당 약 85px) | 2줄 |
| B-2 | 43~54행 `localeTag`·`fmt`·`fmtKRW` | `components/production/format.ts` 로 **이동**하고 page.tsx 는 import. 새 컴포넌트 10개가 금액 포맷을 각자 복제하는 것을 막는다. 함수 본문은 그대로 | 이동 + import 1줄 |
| B-3 | 516·520행 손익·ROI 색상 | 색만으로 부호를 말한다(`profit >= 0 ? emerald : red`). `quick-reference.md` §1 `color-not-only` 위반이다. **부호 글리프(▲/▼)와 `aria-label` 을 덧붙인다.** 색은 그대로 둔다 | 2줄 |

> B-3 은 기존 코드의 결함이지 새 기능이 아니다. 새 컴포넌트가 이 패턴을 **복제하지 않도록** 같이 고친다.
> 복제되면 적록색약 사용자에게 손익 부호가 보이지 않는 자리가 10군데로 늘어난다.

### 1-3. 더한다

```
CycleDetail
├─ 헤더                              (무변)
├─ KPI 4카드                         (무변)
├─ ★ DecisionStrip                   ← 신규 1줄. KPI 와 Tabs 사이
├─ Tabs  [성장 | 비용 | 수익 | ★출하]
│   ├─ growth   : ★GrowthCurveChart 로 기존 LineChart 치환 + ★EngineEmptyState
│   │             (아래 샘플 기록 리스트는 무변)
│   ├─ cost     : ★CostCompositionBar 를 맨 위에 삽입
│   │             (아래 항목 리스트는 무변)
│   ├─ finance  : ★PriceBasisPicker → ★ProfitHeadline → ★SurvivalSensitivity
│   │             → [기존 6 KPI 카드] → [기존 수확 기록]
│   └─ ★harvest : ★HarvestWindowBand/Strip → ★MarginalBreakdown → ★SizePremiumLadder
└─ 모달 4종                          (무변)
```

**탭을 하나만 늘린 이유.** 엔진 3 의 산출물(구간·한계분석·크기 프리미엄)은 서로를 설명하는 한 덩어리다.
수익 탭에 밀어 넣으면 스크롤이 길어져 ④ 생존율이 화면 밖으로 밀리고, 탭을 두 개 늘리면 375px 에서
트리거가 5칸이 되어 `bottom-nav-limit`(§9) 과 같은 이유로 글자가 깨진다. **네 칸이 상한이다.**

---

## 2. 요구 ① — 금액과 불확실성을 같은 무게로

### 2-1. 하지 않을 것

| 안 | 왜 버렸나 |
|---|---|
| 「영업이익 −2,921만원」 + 작은 경고 배지 | 숫자가 확정으로 읽힌다. 과제가 지적한 그 사고 그대로다 |
| 경고 8줄을 금액 위에 나열 | 금액이 안 보인다. 농가는 스크롤하지 않고 닫는다 |
| 경고를 아코디언에 접기 | **금지 조건.** 접힌 것은 없는 것이다 |
| 금액에 "±30%" 같은 단일 오차율 | **엔진에 그런 수가 없다.** 지어내면 엔진 1 이 R² 를 안 내보낸 이유를 화면이 되돌리는 것이다 |

### 2-2. 핵심 관찰 — 폭은 좌우로 대칭이 아니다

천황수산 실적을 엔진 2 에 넣으면 나오는 8건을 **금액축 위의 위치로** 분류하면 이렇게 갈린다.

| 그룹 | 경고 | 금액축에서 | 폭 |
|---|---|---|---|
| **A. 아는 폭 (위쪽)** | `revenue_unsold_inventory` 1,221 kg · `harvest_not_in_event_ledger` 209 kg | 손익을 **올린다** | **계산된다.** kg × 사용자가 고른 단가. 도매 17,000 기준 각 +2,076만 / +355만 |
| **B. 모르는 폭 (아래쪽)** | `cost_not_recorded` ×3(인건·약품·기타) · `cost_depreciation_not_modeled` · `electricity_billing_incomplete` 2개월 | 손익을 **내린다** | **모른다.** 엔진이 추정을 거부한다(전기는 월별 3배 계절성, 감가는 모델에 없음) |
| **C. 분모 경고** | `cycle_boundary_derived_label` | 금액이 아니다 | 생존율 44.8% · FCR 3.21 의 **분모 신뢰도**를 흔든다 |

→ **기록된 −2,921만원은 비관 끝값이 아니다. 위로 아는 폭이 있고, 아래로는 폭을 모르는 구간이 열려 있는, 축 중간의 한 점이다.**

> **구현에서 A 그룹이 둘로 갈렸다(2026-10-03).** 이 표는 A 두 건이 모두
> 「kg × 사용자가 고른 단가」로 계산된다고 적었는데, **원장 누락 출하는 계산되지
> 않는다.** 엔진 2 가 거부한다 — `outOfLedgerHarvestKg` 는 중량만 받고 매출로
> 환산하지 않는다(`performance.ts` 58~64행: 「엔진이 매출로 환산하지 않는다 —
> 단가를 모른다」). 출하 시점·채널·크기를 모르는 중량에 단가를 곱하면 그것은
> 관측이 아니라 **가정**이고, 그 가정이 손익에 그대로 들어간다.
>
> 그래서 띠의 상한은 **재고 평가분만**이다(설계서의 +2,431만이 아니라 재고 몫
> 하나). 원장 누락분은 중량만 보이는 행으로 남고 금액 자리에 「폭 미상」이
> 들어간다. **설계서보다 좁은 폭을 그리는 쪽이 맞다** — 폭을 넓게 그려 놓고 그
> 끝이 가정이면, 폭을 그린 목적(모르는 것을 모른다고 보이기)이 뒤집힌다.

이 한 문장이 설계의 전부다. 그러면 그래픽이 결정된다.

### 2-3. `ProfitUncertaintyBar` — 축 하나가 경고 8건이다

```
       ◀┄┄┄┄┄┄┄┄┄┬───────────────────────────────┬──────┐
        폭 모름    │                               │      │
        (B · 5건)  ●  기록된 값                     ▲      │ 0원
                −2,921만              A 를 반영하면 −490만  │
       └─ 아래로 열려 있음 ──┘└─ 아는 폭 +2,431만 ──┘
       ──────────────────────────────────────────────────
       ⚠ 생존율·FCR 의 분모가 사람이 복원한 라벨이다  (C · 1건)
```

- **왼쪽 끝이 닫히지 않는다.** `◀┄┄` 로 열어 두고 그 구간에 `B` 5건의 개수와 항목명을 적는다. 축이 닫히지 않는 것 자체가 경고다 — 접을 수 있는 UI 요소가 아니다.
- **기록된 값은 `●` 점 하나다.** 글자 크기 `text-2xl`(기존 KPI 카드와 같은 급). **`text-5xl` 로 띄우지 않는다.**
- **아는 폭은 채워진 띠**로 그리고 끝에 `▲` + 그 끝값. 띠 길이가 금액 비율에 비례한다(2,431 / 2,921 ≈ 0.83 → 띠가 점 왼쪽 구간과 비슷한 길이로 보여 "재고 하나가 손익의 70% 를 움직인다"가 눈에 들어온다).
- **C 는 축 밖 별도 줄.** 금액축에 올리면 금액 경고로 오독된다.
- 폭의 끝값은 **사용자가 고른 단가로 다시 계산된다**(2-4). 바뀌면 `aria-live="polite"` 로 알린다.

**구현 — 차트 라이브러리를 쓰지 않는다.** flex div 3개 + `tabular-nums` 로 끝난다. recharts 를 쓰면
① 열린 왼쪽 끝을 표현할 축이 없고 ② 375px 에서 축 라벨이 겹치고 ③ 인쇄에서 `recharts-wrapper`
폭 보정(`globals.css` 190~199행)에 걸린다. `quick-reference.md` §10 `trend-emphasis` — 장식이
데이터를 가리지 않는다.

```tsx
// 형태만. 색·토큰은 3절.
<div className="relative h-14" role="img" aria-label={ariaSummary}>
  {/* 왼쪽 열린 구간 — 점선 + 왼쪽으로 페이드 */}
  <div className="absolute inset-y-0 left-0 border-y border-dashed border-border
                  bg-[repeating-linear-gradient(135deg,transparent_0_5px,hsl(var(--muted-foreground)/0.12)_5px_7px)]
                  [mask-image:linear-gradient(to_right,transparent,black_40%)]" style={{ width: openPct }} />
  {/* 아는 폭 — 채워진 띠 */}
  <div className="absolute inset-y-3 bg-ocean-200 dark:bg-ocean-900 rounded-sm" style={{ left: pointPct, width: knownPct }} />
  {/* 기록된 점 */}
  <span className="absolute -translate-x-1/2 ..." style={{ left: pointPct }}>●</span>
</div>
```

### 2-4. 「아는 폭」을 계산하려면 사용자에게 두 개를 물어야 한다

엔진 2 는 재고 평가를 **인자로 받는다** — 「사이클이 안 닫혔을 때 재고를 얼마로 잡느냐는 사람이
정할 일이지 엔진이 0 으로 가정할 일이 아니다」(`lib/profitability/index.ts` 51~53행).
그래서 화면이 묻는다. 묻기 전에는 폭을 그리지 않는다.

**`computeActuals` 를 두 번 호출한다.** 새 계산을 만드는 것이 아니라 같은 함수를 두 입력으로 부른다.

| 호출 | `revenue.unsoldInventory.valuation` | `revenue.outOfLedgerHarvestKg` | 쓰임 |
|---|---|---|---|
| ① 기록대로 | 생략 | 생략 | `●` 기록된 값 |
| ② 아는 폭 반영 | 사용자가 고른 `PriceBasis` | 입력된 kg | `▲` 띠 끝값 |

두 호출의 `operatingProfitKrw` 차이가 띠 길이다. **화면이 산식을 새로 쓰지 않는다.**

> 서연 — 이 두 번 호출은 `components/production/use-cycle-engines.ts` 의 `useMemo` 안에서 한다.
> 호출 ②가 `null` 을 돌려주면(단가 미선택) 띠를 그리지 않고 "단가를 고르면 폭이 계산됩니다" 를
> 띠 자리에 넣는다. **0 폭으로 그리지 않는다** — 폭 0 과 폭 미계산은 다른 사건이다.

### 2-5. `UncertaintyList` — 8건을 3줄로, 접지 않고

축 바로 아래 **항상 보이는 3줄.** 토글로 사라지는 것은 각 건의 설명 문장뿐이다.

```
A  아는 폭  2건   냉동 재고 1,221 kg · 원장 누락 209 kg          +2,431만  [자세히 ▾]
B  폭 모름  5건   인건비·약품비·기타 미입력 · 감가 미모델 · 전기 2개월   폭 미상  [자세히 ▾]
C  분모     1건   회차 경계가 사람이 복원한 라벨                              [자세히 ▾]
```

- 줄마다 **그룹명 · 건수 · 항목 요약 · 금액(또는 「폭 미상」)** 이 전부 상시 노출. 이것이 접히지 않는다.
- `[자세히]` 가 펼치는 것은 건별 **한 줄 설명과 조치 경로**다.
- **B 그룹의 각 건에는 그 자리에서 고칠 버튼이 붙는다.** `cost_not_recorded` + `item: "labor"` → 「인건비 입력」 버튼 → 기존 `NewCostDialog` 를 `category="labor"` 로 미리 채워 연다. **새 모달을 만들지 않는다.** 경고가 작업으로 바뀌는 자리가 여기다(§8 `error-recovery`).
- `electricity_billing_incomplete` 는 금액을 추정해 주지 않는다. 대신 `ELECTRICITY_BILLS_2024` 의 **관측 월별 범위**(최저~최고)를 참고값으로만 보여주고 「엔진이 추정하지 않습니다 — 넣으려면 기타 비용으로」라고 적는다. 월별 3배 차이를 평균으로 뭉개면 고지서와 추정치가 구분되지 않는다(`cost.ts` 69~79행).

---

## 3. 디자인 토큰 — 새 것을 만들지 않는다

### 3-1. 색

| 역할 | 토큰 | 값 | 근거 |
|---|---|---|---|
| 강조면·CTA | `ocean-700` / `ocean-800` | `#1d4ed8` / `#1e40af` | 카드뉴스 브랜드 남색 `#1B3FBF` 의 역할을 앱에서 이 램프가 맡고 있다(`tailwind.config.ts` 13~15행 주석: 셸·랜딩이 `#1E40AF`). **`#1B3FBF` 를 raw hex 로 컴포넌트에 쓰지 않는다** — §6 `color-semantic` 안티패턴 |
| 본문 | `text-foreground` | 라이트 `222 84% 4.9%` | 짙은 남색 역할. 토큰 그대로 |
| 보조 텍스트 | `text-muted-foreground` | — | |
| 면 | `bg-muted` / `bg-card` | `210 40% 96.1%` / `#fff` | 밝은 배경 `#F2F5FB` 역할. `--background` 가 이미 `210 40% 98%` 다 |
| 데이터 계열(실측) | `ocean-600` `#2563eb` | | |
| 데이터 계열(예측) | `ocean-400` `#60a5fa` + `strokeDasharray="5 4"` | | 점선이 "예측"을 색 없이 말한다 |
| 밴드·리본 | `ocean-500` @ `fillOpacity 0.10` | | |
| 주의·부족 구간 | `amber-500` @ `fillOpacity 0.12` | | |
| 비용 6항목 | `COST_CATEGORY_META` 의 기존 6색 | | 재사용 |
| 손익 부호 | `emerald` / `red` + **반드시 ▲/▼ + 텍스트** | | 저장소 관례 유지. 단 §1 `color-not-only` 때문에 색 단독 금지 |

**차트 안에서는 녹/적 쌍을 쓰지 않는다.** §10 `color-guidance`. 발산 막대(4-5)처럼 행마다
글자를 쓸 자리가 있는 곳에서만 emerald/red 를 쓰고, 축·면으로만 구분되는 곳(민감도·윈도우)은
`ocean` ↔ `amber` 로 간다.

### 3-2. 타이포·수치

- 본문 한글 Pretendard — `globals.css` 76~82행이 이미 `body` 에 걸어 두었다. **새로 선언하지 않는다.**
- **금액·g·%·kg·미/kg 은 전부 `tabular-nums`.** 저장소 관례(`app/(dashboard)/control/page.tsx:42`, `components/home/home-view.tsx:128`)이고 §6 `number-tabular` 다. 밴드 끝값이 흔들릴 때 자리가 밀리지 않아야 한다.
- 금액 단위는 **만원**. 농가는 만원 단위로 말한다. 기존 `fmtKRW` 는 `백만원` 단위라 `−29.2백만원` 이 되는데 이것은 그대로 두고(기존 화면 표시 변경 금지), `format.ts` 에 `fmtKRWMan()` 을 **추가**한다. i18n 키 `tenThousandWon` 신규.
- 숫자 크기 상한 `text-2xl`. 기존 KPI 카드와 같은 급이다. **금액을 키워서 확신을 주지 않는다.**
- 반올림은 렌더 시점에만. **반올림된 값에서 다른 값을 다시 계산하지 않는다**(엔진 설계 규칙 4의 화면 쪽 대응).

### 3-3. 여백·모션

- 섹션 간격 `space-y-4`, 카드 내부 `p-3`~`p-4`. 기존 탭 콘텐츠(`p-4 space-y-4`)와 같은 리듬.
- **새 애니메이션을 만들지 않는다.** 차트는 `isAnimationActive={false}` 고정 — §10 `animation-optional` 가 요구하는 「데이터가 즉시 읽혀야 한다」를 만족하고, `prefers-reduced-motion` 훅을 새로 만들 필요가 없어진다. 밴드가 자라나는 연출은 없다.
- 상태 전환(펼침)은 기존 `animate-fade-in`(`tailwind.config.ts` 124행) 재사용. 0.3s.

---

## 4. 컴포넌트 목록

전부 `components/production/` 신규. 전부 `"use client"` — 부모 `CycleDetail` 이 이미 클라이언트
컴포넌트이고 `useState`/`useT()` 아래에 있다. **서버 컴포넌트로 만들면 안 된다**(Next 16.2.4,
`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`:
상태·이벤트·커스텀 훅이 필요한 쪽이 클라이언트).

`format.ts` 와 `use-cycle-engines.ts` 는 컴포넌트가 아니라 모듈이다.

### 4-0. `use-cycle-engines.ts` — 계산 한 곳

```ts
type EngineInputs = {
  cycle: ProductionCycle
  samples: GrowthSample[]            // CycleDetail 이 이미 들고 있다
  costs: CycleCost[]                 //  "
  harvests: CycleHarvest[]           //  "
  dailyTemps: DailyWaterTemp[] | null // ★ 아직 없다 — 10절 D-1
  priceBasis: PriceBasis | null      // PriceBasisPicker 의 상태
  inventoryKg: number | null         // 사용자 입력
  outOfLedgerKg: number | null       // 사용자 입력
}

type EngineResults = {
  fit: GompertzFit | null                    // 엔진 1
  cddAxis: DegreeDayAxis | null              // 엔진 1
  actualsRecorded: ActualPerformance | null  // 엔진 2 — 호출 ①
  actualsWithKnownGap: ActualPerformance | null // 엔진 2 — 호출 ②
  sensitivity: SurvivalSensitivity | null    // 엔진 2
  projection: HarvestProjection | null       // 엔진 2
  sizePrice: SizePriceEstimate | null        // 크기별 단가
  window: HarvestWindow | null               // 엔진 3 (가정 — 4-4)
  exclusions: Exclusion[]                    // mergeExclusions 로 합친 전체
}
```

- 전부 `useMemo`. 엔진은 순수 함수라 클라이언트에서 돌려도 된다.
- **DB 호출을 추가하지 않는다.** 단 하나 예외가 수온(10절 D-1).
- 엔진이 `failure` 를 돌려주면 그 자리를 `null` 로 두고 `failure` 코드를 그대로 올려 보낸다. 화면이 코드로 분기한다.

### 4-1. `DecisionStrip`

KPI 4카드와 `Tabs` 사이 **한 줄.** 모바일에서 농가가 제일 먼저 보는 것.

```ts
type DecisionStripProps = {
  window: HarvestWindow | null
  profitBand: { pointKrw: number | null; knownHighKrw: number | null; openLow: boolean }
  blockedBy: EngineBlocker[] | null   // 계산 불가 사유. 4-7
  onJumpToHarvest: () => void         // setTab("harvest")
}
```

- 내용: `추천 출하 11월 18~24일 (7일)` + `이익 −845만 ~ (아래 열림)` + `›`
- `<button>` 전체가 탭 이동. `min-h-[44px]`, `aria-label` 에 구간과 폭을 문장으로.
- `window` 가 `null` 이면 **숨기지 않는다.** 「출하 구간 계산 불가 — 단가 근거 미선택」처럼 사유를 쓴다(§9 `empty-nav-state`: 목적지가 없으면 왜 없는지 설명한다).
- 모바일 `flex-col` 2줄, `sm:` 이상 1줄.

### 4-2. `ProfitHeadline`

```ts
type ProfitHeadlineProps = {
  recorded: ActualPerformance | null      // 호출 ①
  withKnownGap: ActualPerformance | null  // 호출 ②
  exclusions: Exclusion[]                 // 합친 전체
  onFixCost: (item: CostItem) => void     // NewCostDialog 를 category 로 미리 채워 연다
  onEditInventory: () => void             // 재고 kg·평가 입력
}
```

구성: 제목 → `ProfitUncertaintyBar` → `UncertaintyList` → (접히지 않는) 단가 근거 한 줄.
`aria-live="polite"` 는 금액 텍스트를 감싼 `<p>` 에만 건다(막대 전체에 걸면 SR 이 수치를 반복 낭독한다).

### 4-3. `ExclusionChip` — 경고 표시의 유일한 원시 요소

```ts
type ExclusionChipProps = {
  exclusion: Exclusion | PricingExclusion   // 두 엔진의 목록이 한 화면에서 섞인다
  variant?: "inline" | "row"
}
```

- `code` → `t.engines.exclusion[code]` 로 제목, `t.engines.exclusionDetail[code]` 로 설명.
- `quantity` + `unit` → `t.engines.unit[unit]` 로 단위. **수치를 문구 안에 넣지 않는다**(9절).
- `code === "cost_not_recorded"` 면 `item` 으로 `t.production.costCategories[item]` 을 **재사용**한다. 비용 항목 이름을 새로 번역하지 않는다.
- `quantity === null` → 「폭 미상」. **`0` 으로 찍지 않는다.**
- 두 엔진의 `Exclusion`/`PricingExclusion` 은 필드가 같다(`lib/pricing/exclusions.ts` 103~106행). **변환 코드를 쓰지 않는다.**

### 4-4. `HarvestWindowBand` (≥sm) / `HarvestWindowStrip` (<sm)

> **정합 완료(2026-10-03).** 이 절은 원래 엔진 3 이 없을 때 과제 설명에서 역산한 **가정 타입**이었다.
> `lib/harvest/` 가 구현된 뒤 실제 반환 타입으로 고쳐 적었다 — 설계서가 엔진을 따른다(10절 D-2 의
> 약속대로). **아래 이름이 `lib/harvest/index.ts` 의 것이고, 화면은 이것만 읽는다.**
>
> 가정과 실제가 어긋난 자리 여섯 군데를 그대로 기록해 둔다. 이름만 바뀐 것이 아니라
> **설계가 바뀐 자리가 둘(③⑥)** 있다.
>
> | # | 가정했던 것 | 엔진의 실제 | 왜 다른가 |
> |---|---|---|---|
> | ① | `candidate.profitKrw` | `candidate.operatingProfitKrw` | 엔진 2 의 `ActualPerformance.operatingProfitKrw` 와 같은 이름을 쓴다. 두 엔진의 「이익」이 다른 이름이면 화면이 둘을 섞는다 |
> | ② | `window.indistinguishableWithinWindow` | `window.recommended.indistinguishableWithinWindow` | **구간이 없으면 구분 가능성도 없다.** 최상위에 두면 `recommended === null` 일 때 `false` 가 「구분된다」로 읽힌다 |
> | ③ | `MarginalRow`(요인별 금액) | `candidate.attribution.components[].code` | **이름이 아니라 구조가 다르다.** 4-5 참조 — 엔진의 `MarginalRow` 는 **후보와 후보 사이의 하루당 이익 변화**(다른 것)이고, 요인 분해는 `ProfitAttribution` 이다 |
> | ④ | `factor: "weight_gain"` | `code: "growth"` | |
> | ⑤ | `factor: "feed_cost"` / `"electricity_cost"` | `code: "cost_feed"` / `"cost_electricity"` | 템플릿 리터럴 `` `cost_${CostItem}` `` 이라 비용 6항목 전부가 올 수 있다. 화면이 다섯 요인만 하드코딩하면 `cost_labor` 가 조용히 사라진다 |
> | ⑥ | (없음) | `code: "price_size_interaction"` | **교차항이 새로 있다.** 성장×폐사·바이오매스×단가가 셋으로 나뉘지 않아 잔차로 둔 항이고, 그래서 **components 의 합이 `profitDeltaKrw` 와 정확히 같다.** 화면이 이 행을 빼면 합이 안 맞고, 그 차이를 화면이 숨기거나 꾸며야 한다 |
>
> 그리고 `marginal` 은 **null 이 아니다** — 언제나 객체이고, 못 구했으면 `sign: "indeterminate"` 다.

```ts
// lib/harvest/index.ts 의 실제 타입. 화면이 읽는 필드만 발췌했다.
type HarvestCandidate = {
  dayOffset: number
  date: string | null              // 기준일을 안 받으면 null. **지어내지 않는다**
  abwG: number | null
  countPerKg: number | null        // 농가가 등급으로 읽는 표기
  operatingProfitKrw: number | null
  profitBandKrw: { low: number; high: number } | null   // 탄력성 0.63~0.73 폭
  profitDeltaFromNowKrw: number | null                  // "지금 출하" 대비 차액
  profitDeltaBandKrw: { low: number; high: number } | null
  priceKrwPerKg: number | null
  priceRatioFromAnchor: number | null                   // 1.0655 면 +6.55%
  priceOutsideObservedSize: boolean                     // 사다리 관측 범위(23.5~33.3 g) 밖
  abwAtWinfCeiling: boolean
  attribution: ProfitAttribution | null                 // 4-5
  failure: CandidateFailure | null
  exclusions: HarvestExclusion[]
}

type RecommendedWindow = {
  startDayOffset: number; endDayOffset: number
  startDate: string | null; endDate: string | null      // 기준일 없으면 null
  candidateCount: number
  indistinguishableWithinWindow: boolean                // ★ 구간 안에 있다(위 ②)
  includesNow: boolean
}

type HarvestWindow = {
  asOfDate: string | null
  stepDays: number | null
  horizonDays: number
  candidates: readonly HarvestCandidate[]
  unevaluableCandidateCount: number                     // 0 이 아니면 최대가 그 뒤일 수 있다
  best: { index: number; dayOffset: number; date: string | null
          operatingProfitKrw: number
          profitBandKrw: { low: number; high: number } | null } | null
  recommended: RecommendedWindow | null                 // ★ 점이 아니라 구간
  decision: HarvestDecisionCode | null                  // 문장이 아니다
  band: { sources: readonly ("price_elasticity" | "abw_uncertainty")[]
          priceElasticity: { low: number; high: number }
          abwUncertaintyG: number }                     // 「신뢰구간」이 아니다
  marginal: MarginalAnalysis                            // ★ null 이 아니다
  survival: { dailySurvivalRate: number | null; dailyMortalityRate: number | null
              source: DailySurvivalSource }
  price: { stage: DistributionStage | null; form: ProductForm | null
           anchorKrwPerKg: number | null; anchorAbwG: number | null
           elasticity: SizeElasticity
           convertedFrom: DistributionStage | null; conversionMultiplier: number | null }
  failure: HarvestWindowFailure | null
  exclusions: HarvestExclusion[]
}
```

- **점 마커를 찍지 않는다.** `recommended` 는 `ReferenceArea x1/x2` 로만 그린다. `Line` 의 `dot` 은 `false`.
- 추천 구간에 **해칭 패턴**을 깐다 — SVG `<defs><pattern>` 로 45° 사선. §10 `pattern-texture`: 색 없이도 구간이 구분돼야 한다.
- 농가의 수동 입력 `cycle.target_harvest_date` 는 `ReferenceLine` 으로 **병기**한다(계획서 2-3: 「수동 입력을 추천값과 병기」). 추천과 다르면 그 사실이 눈에 보여야 한다.
- 구간 폭 텍스트를 차트 밖에 항상 쓴다: `11월 18일 ~ 24일 · 7일` + `이 구간 안에서는 차이가 구분되지 않습니다`.
- `recommended.startDate` 가 `null` 이면(기준일 미지정) **일수로 쓴다** — `지금부터 14~21일`. 날짜를 지어내지 않는다.
- `decision` 다섯 코드가 각각 다른 문장이다. 특히 `hold_beyond_horizon` 과 `indeterminate` 를 `hold` 와 같은 문구로 처리하면 **보지 않은 날을 보고 고른 것처럼 읽힌다**(엔진 주석). `unevaluableCandidateCount > 0` 이면 그 수를 같이 쓴다.

### 4-5. `MarginalBreakdown` — 요구 ③

> **정합 완료(2026-10-03).** 이 절의 가정 타입(`MarginalRow.factor`)은 엔진에 없다. 그리고 이것은
> 이름 문제가 아니다 — **엔진에는 `MarginalRow` 라는 타입이 실제로 있는데, 뜻이 다르다.**
>
> | 엔진의 타입 | 무엇인가 | 이 컴포넌트가 쓰는가 |
> |---|---|---|
> | `ProfitAttribution.components[]` | **요인별 금액 분해**(크기 프리미엄·성장·폐사·교차항·비용). 후보 하나를 "지금" 과 비교한 것 | **이것이다.** 발산 막대의 행 |
> | `MarginalAnalysis.rows[]` (`MarginalRow`) | **후보와 후보 사이의 하루당 이익 변화**(원/일). 0 을 지나는 지점이 경제적 출하 적기 | 같은 컴포넌트의 **아래쪽 보조 표**. 요인 분해가 아니다 |
>
> 둘을 섞으면 안 된다. 하나는 「왜 이익이 바뀌나」이고 하나는 「언제 바뀜이 멈추나」다.

```ts
// 요인 분해 — 발산 막대의 행. candidate.attribution 을 그대로 읽는다.
type AttributionCode =
  | "size_premium"            // 큰 개체의 kg당 단가 프리미엄
  | "growth"                  // ★ "weight_gain" 이 아니다
  | "mortality"               // ★ "mortality_loss" 가 아니다. 음수다
  | "price_size_interaction"  // ★ 새로 있다. 교차항(성장×폐사, 바이오매스×단가)
  | `cost_${CostItem}`        // ★ cost_feed · cost_electricity · cost_pl · cost_labor
                              //    · cost_chemicals · cost_other. 음수다
type AttributionComponent = { code: AttributionCode; krw: number }
type ProfitAttribution = {
  baselineDayOffset: number
  revenueDeltaKrw: number
  costDeltaKrw: number
  profitDeltaKrw: number
  components: readonly AttributionComponent[]
  dominantGainCode: AttributionCode | null   // 가장 큰 플러스. 화면이 강조한다
  dominantLossCode: AttributionCode | null   // 가장 큰 마이너스
}

// 하루당 변화 — 보조 표. window.marginal 을 읽는다. **null 이 아니다**
type MarginalRow = {
  fromDayOffset: number; toDayOffset: number; days: number
  deltaProfitKrw: number | null
  perDayKrw: number | null                               // 0 을 지나는 지점이 적기다
  perDayBandKrw: { low: number; high: number } | null
  signCertain: boolean                                   // 밴드가 0 을 품지 않는가
}
type MarginalAnalysis = {
  rows: readonly MarginalRow[]
  sign: "always_positive" | "always_negative" | "crosses" | "mixed" | "indeterminate"
  crossing: { fromDayOffset: number; toDayOffset: number } | null
  zeroCrossingDayOffset: number | null                    // 선형보간한 0 통과 일수
}
```

- **발산 수평 막대.** 중앙 0선에서 오른쪽(이익↑) / 왼쪽(이익↓). 행 끝에 `tabular-nums` 금액 + `▲`/`▼` + 텍스트. **recharts 를 쓰지 않는다** — waterfall 이 없고, div 20줄로 더 잘 된다.
- **행 목록을 하드코딩하지 않는다.** `components` 를 순회한다. 가정 타입의 다섯 요인만 적으면 `cost_labor`·`cost_chemicals`·`price_size_interaction` 이 **조용히 사라지고, 그러면 막대의 합이 `profitDeltaKrw` 와 안 맞는다.** 엔진이 교차항을 잔차로 둔 이유가 「합이 정확히 같게」 하려는 것이므로(`candidate.ts` 172~178행) 그 성질을 화면이 깨면 안 된다.
- **합계 행은 `profitDeltaKrw` 를 그대로 쓴다.** 막대를 더해 만들지 않는다 — 반올림된 값에서 다시 계산하지 않는다는 3-2 규칙.
- 행마다 **출처 태그**를 작게 붙인다. 계획서 2-3 검증 조건이 「근거 수치가 화면에 모두 노출(블랙박스 금지)」다. 코드 → 출처 매핑: `size_premium`·`price_size_interaction` → `pricing` / `growth`·`mortality` → `growth` / `cost_*` → `profitability`.
- **「미산정」 상태는 엔진의 `null` 로 판정한다.** 가정 타입의 `state` 필드는 엔진에 없다. 화면이 세운다 —
  `candidate.additionalCostKrw === null` 이면 비용 행 전체가 미산정이고(`projectHarvestScenarios` 는 잔여 급이량을 안 받으면 0 으로 채우지 않고 `remaining_period_cost_not_estimated` 를 올린다), `candidate.attribution === null` 이면 분해 자체가 없다. **비용 행을 0 으로 그리면 "2주 더 키워라" 쪽으로 이익이 부풀고, 그것이 이 화면에서 가장 위험한 착각이다.**
- 미산정 행이 하나라도 있으면 합계 행의 **아래쪽 끝을 열어 둔다**(2-3 의 `◀┄` 와 같은 처방).
- `mortality` 행은 거의 항상 `survival_rate_assumed`(또는 `harvest_daily_survival_default`)를 달고 온다 — 엔진 1 은 ABW 만 예측하고 생존율을 예측하지 않는다. 그 칩을 그 행에 붙인다.
- `[수치 표 ▾]` 토글 → 같은 데이터를 `<table>` 로. §10 `data-table`(차트만으로는 SR 접근 불가) 과 블랙박스 금지를 한 번에 만족한다. 이 표에 `marginal.rows`(하루당 변화)도 같이 넣는다.

```ts
type SurvivalSensitivityProps = {
  sensitivity: SurvivalSensitivity | null   // lib/profitability 의 반환 타입 그대로
}
```

세로 순서가 중요하다. **문장이 차트보다 위다.**

1. **거리 한 줄** — `지금 44.8% → 손익분기 74.0% · 29.2%p 부족`. `text-base`, `tabular-nums`.
   - `breakEven.survivalRate > 1` 이면 **그대로 112% 로 쓴다.** 100% 로 자르지 않는다 — 엔진이 1 을 안 자르는 이유가 「입식한 전부가 살아도 적자」라는 신호를 지우지 않으려는 것이다(`sensitivity.ts` 136~140행). 그 경우 문구를 `breakEvenAboveOne` 로 바꾼다.
   - `breakEven.failure` 가 있으면 거리 대신 실패 사유를 쓴다.
2. **차트**(5-5).
3. **고정 가정 4줄** — `assumptions.meanHarvestWeightG` / `feedKgHeldFixed` / `costHeldFixedKrw` / `priceKrwPerKg`. 엔진 주석이 못을 박았다: 「금액만 보고 '생존율만 고치면 된다' 로 읽지 않도록」. 특히 **평균 개체중 9.5 g 은 11월 출하분 28.6 g 과 5~7월 소형 반출이 섞인 값**이라는 문구(`survivalMixedWeight`)를 그 줄에 붙인다.
4. **행 표** — `isReference` 행만 `bg-ocean-500/10` + `실측` 배지. 나머지 행은 `survival_rate_assumed` 칩. 가정 행과 실측 행이 같은 모양이면 표 전체가 예측으로 읽힌다.

### 4-7. `EngineEmptyState`

```ts
type EngineBlocker =
  | { kind: "no_samples" }
  | { kind: "samples_below_min"; have: number; need: number }           // need = MIN_FIT_SAMPLES(3)
  | { kind: "samples_below_stanza"; eligible: number; total: number; thresholdG: number } // 7.5 g
  | { kind: "fit_failure"; failure: FitFailure }
  | { kind: "no_price_basis" }
  | { kind: "no_cost"; missing: CostItem[] }
  | { kind: "no_temp_series" }
  | { kind: "engine3_failure"; failure: string }
type EngineEmptyStateProps = { blockers: EngineBlocker[]; onAction?: (b: EngineBlocker) => void }
```

- **빈 차트 축을 그리지 않는다.** §10 `empty-data-state`.
- 체크리스트 형태(✓ 갖춰진 것 / ○ 없는 것) + 없는 것마다 조치 버튼. 기존 `noSamples` 빈 상태(429~435행)의 결(아이콘 + 문구 + CTA)을 그대로 따른다.

### 4-8. 나머지

| 컴포넌트 | 역할 | 핵심 props |
|---|---|---|
| `PriceBasisPicker` | 단가 근거 선택. **기본 선택 없음** | `value: PriceBasis \| null`, `onChange`, `observed: ResolvedPrice["observed"]`, `realizedKrwPerKg` |
| `GrowthCurveChart` | 엔진 1 (5-2) | `fit`, `cddAxis`, `samples`, `axis: "date" \| "cdd"`, `onAxisChange` |
| `CostCompositionBar` | 비용 구성 (5-6) | `cost: CostBreakdown`, `onFixCost` |
| `SizePremiumLadder` | 크기 → 단가 밴드 표 | `estimates: SizePriceEstimate[]` (`sizePriceTable` 결과 그대로) |
| `format.ts` | `localeTag`·`fmt`·`fmtKRW`(이동) + `fmtKRWMan`·`fmtPct`·`fmtG`(신규) | — |

`PriceBasisPicker` 가 이 화면에서 두 번째로 중요한 컴포넌트다. 도매 17,000 과 소매 활새우
26,500 이 **56% 벌어지고**, 엔진은 기본 채널로 떨어지지 않는다(`channel.ts` 1~16행).
→ 세 채널을 **중앙값과 관측 폭(n · 최저~최고)과 함께 나란히** 보여주고 아무것도 미리 고르지 않는다.
고르는 순간 56% 가 결정된다는 것이 선택 지점에서 보여야 한다. `role="radiogroup"`, 각 선택지 `min-h-[44px]`.

---

## 5. 차트 명세 — recharts

저장소는 `recharts` 를 쓴다(`page.tsx` 24~26행, `app/(dashboard)/reports/page.tsx`,
`components/water-quality/water-quality-view.tsx`). **새 차트 라이브러리를 넣지 않는다.**

모든 차트 공통:

- `<ResponsiveContainer width="100%" height={H}>` — `H` 는 `180`(<sm) / `220`(≥sm). 모바일 180 은 기존 성장 차트 200 보다 낮다. 폰 화면에서 차트 아래 문장이 접히지 않아야 한다.
- 축·격자 색은 전부 토큰: `stroke="hsl(var(--border))"`, `tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}`. 기존 코드(420~422행)와 동일.
- `<Tooltip contentStyle={...}>` 도 기존 스타일 복사. **직접 하드코딩한 hex 를 쓰지 않는다.**
- `isAnimationActive={false}` (3-3).
- 래퍼에 `role="img"` + `aria-label={요약 문장}` — 기존 `abwChartAria` 패턴(417행).
- `<Legend>` 는 `≥sm` 에서만. 모바일은 **직접 라벨링**(§10 `direct-labeling`).
- 데이터 점 1000개 넘기지 않는다. 사이클 9개월 × 일별 = 270점이면 충분(§10 `large-dataset`).

### 5-1. 금액 불확실성 — **차트 아님** (2-3)

div. 사유는 2-3 에 적었다.

### 5-2. 성장곡선 — `ComposedChart`

| 시리즈 | 요소 | 색/형태 |
|---|---|---|
| 실측 ABW | `<Scatter>` 또는 `<Line dot={{r:4}} strokeWidth={0}>` | `ocean-600` 점 |
| 적합 구간 곡선 | `<Line type="monotone" dot={false}>` | `ocean-600` 실선 2px |
| 예측 구간 곡선 | `<Line type="monotone" dot={false} strokeDasharray="5 4">` | `ocean-400` 점선 |
| 오차 리본 | `<Area>` 2장 (range band 패턴) | `ocean-500` `fillOpacity 0.10` |
| 제외된 점 | `<Scatter>` | `muted-foreground` 중공 원 + 범례 「7.5 g 미만 제외」 |
| 목표 중량 | `<ReferenceLine y={cycle.target_weight_g}>` | `border` 점선 |

**세 가지 못 — 어기면 엔진 설계가 무효가 된다.**

1. **리본을 「신뢰구간」이라고 쓰지 않는다.** 엔진 1 은 예측구간을 돌려주지 않는다 — `trainMaeG` 와 홀드아웃 MAE 0.895 g 뿐이고, **R² 함수를 의도적으로 내보내지 않았다**(`lib/growth/index.ts` 설계 규칙 5). 리본은 `±(홀드아웃 MAE)` 이고 라벨도 **그렇게** 쓴다. i18n 키 이름까지 `growthBandMae` 로 박아 둔다. 「95% 신뢰구간」은 우리가 갖지 않은 정밀도의 주장이다.
2. **제외된 점을 숨기지 않는다.** `fit.excluded` 에 `below_stanza_break` 로 빠진 점이 들어 있다. 농가가 입력한 샘플이 차트에서 사라지면 「내가 넣은 게 어디 갔나」가 된다. 중공 원으로 그리고 왜 빠졌는지 범례에 적는다.
3. **x축이 날짜면 예측선을 그릴 수 없을 때가 있다.** 엔진 1 의 시간축은 적산수온(TGC)이고, 엔진 1 은 **적산수온을 날짜로 바꾸지 않는다**(설계 규칙 4 + `projection.ts` 10~12행: 그것은 수온 전망이 필요하고 엔진 3 의 몫이다).
   - **실측 구간**은 날짜·CDD 둘 다 있다 → 날짜축 OK.
   - **예측 구간**은 날짜축에 올리려면 미래 수온 전망이 필요하다.
   → **규칙: 기본 x축 = 날짜. 수온 전망이 없으면 예측선을 날짜축에 그리지 않고, 축을 적산수온으로 바꾸고 그 사실을 한 줄 적는다.** 축 토글(`날짜 / 적산수온`)을 차트 우상단에 둔다(`aria-pressed`, `min-h-[44px]`).

**range band 의 recharts 함정.** `<Area dataKey={d => [d.low, d.high]}>` 는 이 버전에서 불안정하다.
표준 처방을 쓴다 — `low` 를 투명 `Area` 로 깔고 그 위에 `span = high - low` 를 같은 `stackId` 로 쌓는다.

```tsx
<Area dataKey="bandLow"  stackId="band" stroke="none" fill="none" isAnimationActive={false} legendType="none" />
<Area dataKey="bandSpan" stackId="band" stroke="none" fill="#3b82f6" fillOpacity={0.1} isAnimationActive={false} />
```

### 5-3. 출하 윈도우 — `ComposedChart` (≥sm) + 날짜 리본 (<sm)

**≥sm:**

- x: `date`(`type="category"`, `MM/dd`). 모바일 겹침은 `interval="preserveStartEnd"` + `minTickGap={32}`.
- y: 영업이익(만원).
- `<ReferenceArea x1={recommended.startDate} x2={recommended.endDate} fill="url(#hatch)" />` — 추천 구간. **해칭.**
- 이익 밴드: 5-2 와 같은 2장 `Area` 처방.
- 이익 중앙선: `<Line dot={false}>`.
- `<ReferenceLine y={0}>` — 손익 0. `stroke="hsl(var(--foreground))" strokeOpacity={0.4} strokeDasharray="4 4"`.
- `<ReferenceLine x={cycle.target_harvest_date} label="농가 입력">` — 병기.

```tsx
<defs>
  <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y="0" x2="0" y2="6" stroke="#1d4ed8" strokeWidth="2" strokeOpacity="0.28" />
  </pattern>
</defs>
```

**<sm — `HarvestWindowStrip`. 차트가 아니다.**

```
10/20        11/1         11/18 ▓▓▓▓▓▓▓ 11/24        12/1
───────────────────────────┤▓▓▓▓▓▓▓▓▓▓▓├────────────────────
                           추천 11월 18~24일 · 7일
                           이 구간 안에서는 차이가 구분되지 않습니다
```

가로 1줄 div 리본 + 날짜 눈금 3~4개 + 채워진 구간(해칭 동일). 폭 375px 에서 **범위를 전달하는 데
차트가 필요하지 않다.** 상세 차트는 `[이익 곡선 보기 ▾]` 로 그 아래. §5 `content-priority`.

### 5-4. 한계분석 — **차트 아님** (4-5)

발산 div 막대 + `<table>` 토글. 사유는 4-5 에 적었다.

### 5-5. 생존율 민감도 — `ComposedChart`

| 요소 | 내용 |
|---|---|
| x | 생존율(%). `rows` 의 입력 순서를 **정렬하지 말 것** — 엔진이 호출자의 비교 순서를 지키려고 일부러 정렬하지 않는다(`sensitivity.ts` 165~167행). 차트용 배열만 따로 정렬한다 |
| y | 영업이익(만원) |
| 본선 | `<Line dot={{r:3}}>` `ocean-600` |
| 0선 | `<ReferenceLine y={0}>` `foreground/40` 점선 + 라벨 「손익분기」 |
| 손익분기 생존율 | `<ReferenceLine x={74.0}>` `ocean-700` 실선 + 라벨 |
| 실측 생존율 | `<ReferenceLine x={44.8} strokeDasharray="2 3">` + 라벨 「실측」 |
| **부족 구간** | `<ReferenceArea x1={44.8} x2={74.0} fill="amber-500" fillOpacity={0.12} />` — 「메워야 하는 거리」가 면적으로 보인다 |
| 실측 점 | `<Scatter>` 로 한 점 강조. `isReference` 행 |

**녹/적을 쓰지 않는다.** 흑자/적자를 색으로 가르지 않고 **0선과 음영**으로 가른다(§10 `color-guidance`).

### 5-6. 비용 구성 — **차트 아님**

**파이를 쓰지 않는다.** 항목이 6개라 §10 `no-pie-overuse` 경계이고, 더 중요한 이유는
**파이에는 「미입력」을 그릴 자리가 없다**는 것이다. 조각 합이 100% 가 되는 그래픽에서 미입력은
사라진다. 금액 기준 가로 100% 적층 막대 + **오른쪽 끝을 점선으로 열어 둔다.**

```
┌────────────┬──────────────────────┬────────┬ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ▸
│ 종묘 1,200 │ 사료 3,767           │ 전기 2,439 │  인건·약품·기타·감가 미입력
└────────────┴──────────────────────┴────────┴ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ▸
```

- 세그먼트 색은 `COST_CATEGORY_META` 의 기존 6색 그대로.
- `missingItems` 는 **폭 없는 점선 구간**으로 막대 오른쪽에 붙인다. 폭을 임의로 주면 모르는 금액을 주장하게 되므로 `flex-1` + 오른쪽 `▸` 로 **열려 있음**만 표현한다.
- `complete === true` 면 점선 구간이 사라지고 막대가 닫힌다. **막대가 닫혔다는 것이 "전부 입력됐다"는 신호**가 된다.
- 세그먼트마다 `aria-label="사료 3,767만원 (51%)"`. 색만으로 구분하지 않도록 범례에 항목명 텍스트 병기.

---

## 6. 모바일 — 농가는 수조 옆에서 폰으로 본다

기준 폭 **375px**. 상세 패널은 모바일에서 전체 폭을 쓴다(목록이 `hidden lg:flex` 로 빠짐, 616행).

### 6-1. 우선순위 — 위에서부터 이 순서

| 순위 | 무엇 | 왜 |
|---|---|---|
| 1 | `DecisionStrip` — 추천 구간 + 이익 폭 1줄 | 수조 옆에서 필요한 정보는 「지금 건질까, 2주 더?」 하나다 |
| 2 | 금액 폭(`ProfitUncertaintyBar`) + 3줄 그룹 | 확정이 아니라는 것을 금액과 동시에 |
| 3 | 생존율 거리 한 줄 | 「무엇을 고치면」의 답 |
| 4 | 차트 전부 | 접지는 않지만 아래로 |

### 6-2. 좁은 화면 규칙

- `grid-cols-2` 상한. **모바일에 3열 이상을 만들지 않는다.** 기존 비용 카테고리 칩(468행)의 `grid-cols-3` 은 이미 있는 것이므로 두고, 새 블록은 2열까지.
- 차트 높이 `180`, 틱 `fontSize 11`, Legend 없음(5절).
- 긴 수치 표는 `overflow-x-auto` + 첫 열 `sticky left-0 bg-card`. **페이지 전체에 가로 스크롤을 만들지 않는다**(§5 `horizontal-scroll`). `globals.css` 152~159행이 인쇄 때 이 overflow 를 풀어 준다.
- `HarvestWindowStrip` ↔ `HarvestWindowBand` 는 **CSS 로 갈라서는 안 된다.** 둘 다 렌더해서 `hidden sm:block` 으로 감추면 recharts 가 폭 0 에서 한 번 계산해 차트가 사라진다(`globals.css` 186~189행에 같은 함정이 기록돼 있다). `window.matchMedia("(min-width: 640px)")` 상태로 **조건부 렌더**한다.
- 모든 토글·선택지 `min-h-[44px]`, 간격 `gap-2`(8px) 이상. §2 `touch-target-size`·`touch-spacing`.
- 탭 트리거 4칸: `text-xs sm:text-sm`. 라벨은 **2글자**(`성장`/`비용`/`수익`/`출하`) — 기존 3개도 이미 2글자다.

---

## 7. 빈 상태 · 실패 상태

**규칙 셋.** ① 빈 축을 그리지 않는다 ② 왜 없는지 쓴다 ③ 고칠 버튼을 붙인다.

| 상황 | 판정 | 화면 | 조치 버튼 |
|---|---|---|---|
| 사이클 없음 | `cycles.length === 0` | **기존 빈 상태 그대로**(662~668행). 변경 없음 | 기존 |
| 성장 샘플 0건 | `samples.length === 0` | **기존 `noSamples` 그대로**(429~435행) | 기존 |
| 샘플 1~2건 | `< MIN_FIT_SAMPLES(3)` | 실측 점만 찍고 **곡선·예측 없음.** 「샘플 3건부터 곡선이 나옵니다 — 현재 2건」 | 샘플 입력 |
| **샘플 3건 이상인데 전부 7.5 g 미만** | `fit.failure === "insufficient_samples"` + `fit.excluded` 전건 `below_stanza_break` | **별도 문구가 반드시 필요하다.** 「7.5 g 이상 샘플이 3건 필요합니다 — 현재 0건 / 전체 5건」. 입식 초기 사이클에서 **흔하게** 걸린다. 이 경우를 `no_samples` 와 같은 문구로 처리하면 농가는 자기가 입력한 5건이 무시됐다고 읽는다 | 샘플 입력 |
| 적합 실패(그 외) | `fit.failure` | 실패 코드별 문구(9절 `fitFailure`) | — |
| 수온 시계열 없음 | `dailyTemps === null` | 성장 탭: 실측 점만. 적산수온축 비활성. 「적산수온을 만들 수온 기록이 없습니다」 | — (10절 D-1) |
| **단가 근거 미선택** | `price.failure === "price_basis_not_selected"` | **`PriceBasisPicker` 자체가 빈 상태다.** 수익·출하 탭의 금액 자리에 3채널 비교(중앙값 + n + 최저~최고)를 띄우고 「채널을 고르면 금액이 계산됩니다」. **미리 고르지 않는다** | 채널 선택 |
| 비용 전건 미입력 | `missingItems.length === 6` | **「0원」을 쓰지 않는다.** 금액은 `—`, 아래 「비용 6개 항목 전부 미입력」 + 항목별 입력 버튼 6개 | 항목별 입력 |
| 비용 일부 미입력 | `complete === false` | 금액은 보여주되 **`knownTotalKrw` 라는 사실을 라벨에**: 「입력된 항목 합계」. `총비용` 이라고 쓰지 않는다 | 항목별 입력 |
| 손익분기 산출 불가 | `breakEven.failure` | 거리 문장 대신 실패 사유(9절 `breakEvenFailure`) | 해당 입력 |
| 엔진 3 불가 | `window === null` | 출하 탭에 **체크리스트**(✓ 성장곡선 / ✓ 비용 / ○ 단가 근거 / ○ 수온 전망). 빈 달력을 그리지 않는다 | 항목별 |
| 로딩 | — | 기존 스피너(607~611행) 재사용. 차트 자리에는 `bg-muted animate-pulse` 스켈레톤(§3 `progressive-loading`·`content-jumping`). **빈 축 프레임을 먼저 그리지 않는다** |

---

## 8. 접근성

`quick-reference.md` §1(CRITICAL) 전수 + §10 차트 규칙.

| 항목 | 처방 |
|---|---|
| **색만으로 손익 금지** | 모든 손익 표시 = **색 + 부호 글리프(▲/▼) + 텍스트(이익/손실)**. 적록색약 사용자에게 emerald/red 는 같은 색이다. 차트 안에서는 녹/적 쌍 자체를 쓰지 않고 `ocean`↔`amber`+0선+해칭으로 간다. 기존 516·520행도 같이 고친다(B-3) |
| **색만으로 구간 금지** | 추천 구간·부족 구간은 색 + **해칭 패턴** + 바깥 텍스트 3중 |
| 차트 대체 텍스트 | 래퍼에 `role="img"` + `aria-label` **요약 1문장**(수치 포함). 기존 `abwChartAria` 패턴 유지. §10 `screen-reader-summary` |
| 차트 대체 표 | 한계분석·민감도는 `<table>` 토글 제공. §10 `data-table` |
| 수치 비교 | 금액·g·% 전부 `tabular-nums` |
| 터치 44px | 탭 트리거·채널 선택지·펼침 버튼·입력 버튼 전부 `min-h-[44px]`. 기존 코드 관례와 동일 |
| 펼침 | `<button aria-expanded={open} aria-controls="...">` + 대상에 `id`. `<div onClick>` 금지 |
| 금액 변경 고지 | 채널·재고 변경 시 금액 `<p>` 에 `aria-live="polite"`. 막대 전체에는 걸지 않는다(반복 낭독) |
| 채널 선택 | `role="radiogroup"` + `aria-checked`. **미선택이 유효한 초기 상태**임이 SR 에도 전달돼야 한다 |
| 제목 계층 | 탭 내부는 `h3` → `h4`. 기존 구조(413·438행)를 따르고 레벨을 뛰지 않는다 |
| 포커스 링 | 제거 금지. 기존 `focus:border-ocean-500` 관례 유지 |
| 모션 | 차트 애니메이션 자체를 끈다(3-3). `prefers-reduced-motion` 분기가 필요 없어진다 |
| 아이콘 | `lucide-react` 만. 이모지 금지(§4 `no-emoji-icons`). 신규: `CalendarRange`(출하 탭), `TriangleAlert`(폭 모름), `Scale`(한계분석). 글리프 `▲▼●◀` 는 아이콘이 아니라 **텍스트**이므로 `aria-hidden` 처리하고 의미는 옆 텍스트가 진다 |
| 다크모드 | 해칭 `strokeOpacity`·리본 `fillOpacity` 를 **다크에서 따로 확인**한다. `ocean-200` 배경 띠는 다크에서 `ocean-900` 으로 바꿔야 보인다(4-2 스니펫에 반영) |

---

## 9. 다국어 — 엔진은 코드를, 화면이 문장을

**엔진은 문장을 만들지 않는다.** 네 모듈 머리주석이 모두 같은 말을 한다
(`raspberry-pi/advice.py` 의 `{"code","level","value","digits"}` 원칙). 그래서 **코드 → 문구 매핑이 i18n 의 일**이다.

### 9-1. 어디에 넣나

**`lib/i18n/types.ts` 에 새 최상위 섹션 `engines` 를 만든다.** `production` 안에 넣지 않는다 —
엔진 6(다국어 리포트, 계획서 4-1)이 **같은 코드 집합을 PDF 에서 다시 쓴다.** 화면 전용 섹션에
묻어 두면 그때 전부 옮기게 된다.

**네 파일 모두 채운다 — `ko.ts` `en.ts` `vi.ts` `id.ts`. 하나라도 빠지면 타입 에러다.**

### 9-2. 수치 보간 규칙

- **원칙: 문구에 수치를 넣지 않는다.** `ExclusionChip` 이 `{제목} · {quantity}{unit}` 으로 조립한다. 단위는 `t.engines.unit[unit]` 에서 온다.
- 불가피하게 문장 안에 수가 들어가야 하는 키만 **기존 저장소 관례** `{{n}}` 를 쓰고 `.replace("{{n}}", String(x))` 로 채운다(`lib/i18n/ko.ts:1248` `dayN`, `components/water-quality/water-quality-view.tsx:1143` 참조). **새 보간 헬퍼를 만들지 않는다.** 아래 표에서 `{{n}}` 이 들어가는 키는 `Tpl` 접미사로 구분했다.

### 9-3. `engines.exclusion` / `engines.exclusionDetail` — 엔진 2 코드 12

`exclusion[code]` = 짧은 제목(칩·요약줄), `exclusionDetail[code]` = 한 줄 설명(펼침). ko 초안:

| code | 그룹 | `exclusion` (ko) | `exclusionDetail` (ko) |
|---|---|---|---|
| `cost_not_recorded` | B | 비용 미입력 | 이 항목이 입력되지 않았습니다. 0원이 아니라 모른다는 뜻입니다. |
| `cost_depreciation_not_modeled` | B | 감가 미모델 | 시설 감가상각이 계산에 들어 있지 않습니다. 금액은 사람이 정해 기타 비용으로 넣습니다. |
| `electricity_billing_incomplete` | B | 전기 고지서 미완 | 고지서가 사이클 전 구간을 덮지 못합니다. 월별 금액이 3배까지 차이 나므로 엔진이 추정하지 않습니다. |
| `revenue_unsold_inventory` | A | 미판매 재고 | 이 중량이 매출에 잡히지 않았습니다. 평가 단가를 고르면 금액이 계산됩니다. |
| `harvest_not_in_event_ledger` | A | 원장 누락 출하 | 출하가 있었으나 기록 원장에 없습니다. 메모에만 남아 있습니다. |
| `price_from_channel_median` | — | 채널 중앙값 단가 | 실거래가 아니라 그 채널의 중앙값입니다. 다음 거래의 확정 단가가 아닙니다. |
| `price_basis_not_selected` | — | 단가 근거 미선택 | 채널도 금액도 고르지 않았습니다. 매출을 계산할 수 없습니다. |
| `remaining_period_cost_not_estimated` | B | 잔여기간 비용 미산정 | 남은 기간의 사료·전기비가 들어 있지 않습니다. 이익이 실제보다 크게 나옵니다. |
| `survival_rate_assumed` | — | 생존율 가정값 | 실측이 아니라 가정한 생존율입니다. |
| `abw_from_growth_projection` | — | 개체중 예측값 | 실측이 아니라 성장곡선의 예측값입니다. |
| `cycle_boundary_derived_label` | C | 회차 경계 파생 라벨 | 회차 구분이 원본 데이터가 아니라 사람이 메모를 읽어 복원한 것입니다. 생존율·FCR 의 분모가 여기에 걸립니다. |
| `cycle_boundary_not_resolved` | C | 회차 경계 미복원 | 회차 구분을 복원하지 못했습니다. 생존율·FCR 의 분모 자체가 정해지지 않습니다. |

### 9-4. `engines.exclusion` / `exclusionDetail` — 단가 코드 17

같은 두 객체에 이어서 넣는다(`PricingExclusion` 은 엔진 2 `Exclusion` 과 모양이 같아 한 사전으로 처리된다).

| code | `exclusion` (ko) |
|---|---|
| `price_elasticity_provisional` | 크기 탄력성 잠정값 |
| `price_elasticity_single_vendor` | 근거 판매처 1곳 |
| `price_elasticity_lower_bound` | 탄력성 하한 사용 |
| `price_elasticity_size_dependent` | 구간별 탄력성 상이 |
| `price_elasticity_form_specific` | 활·생물 전용 계수 |
| `price_seasonality_not_modeled` | 계절 보정 없음 |
| `price_ladder_vendor_mixed` | 판매처 혼재 |
| `price_ladder_premium_excluded` | 프리미엄 상품 제외 |
| `price_ladder_not_monotonic` | 사다리 단조성 어긋남 |
| `price_ladder_elasticity_implausible` | 탄력성 범위 밖 |
| `price_ladder_form_not_slope_eligible` | 기울기 근거 부적격 |
| `price_stage_multiplier_assumed` | 유통단계 배수 가정 |
| `price_stage_multiplier_ranged` | 유통단계 배수 범위 |
| `price_extrapolated_from_anchor` | 앵커 외삽 단가 |
| `price_target_outside_observed_size` | 관측 크기 범위 밖 |
| `price_official_statistics_unavailable` | 크기별 공시 통계 없음 |
| `price_anchor_not_farmgate` | 농가 수취 단계 아님 |

`exclusionDetail` 초안은 각 코드의 JSDoc(`lib/pricing/exclusions.ts` 19~101행)을 한 문장으로 줄여 쓴다.
**특히 `price_anchor_not_farmgate` 는 「이 단가는 농가가 받는 돈이 아닙니다」로 시작해야 한다** —
소매 앵커로 계산하면 같은 크기의 농가 수취가보다 약 1.9배 높게 나오고, 수가 멀쩡해 보인다.

### 9-5. 실패 코드

| 객체 | 키 | ko 초안 요지 |
|---|---|---|
| `engines.fitFailure` | `invalid_winf` / `no_samples` / `insufficient_samples` / `degenerate_axis` / `non_finite_params` | 상한중량 설정 오류 / 샘플 없음 / 샘플 부족 / 적산수온이 변하지 않음 / 적합 실패 |
| `engines.cddFailure` | `invalid_params` / `target_not_positive` / `target_at_or_above_winf` / `non_finite_result` | 곡선 계수 없음 / 목표 중량이 0 이하 / 목표 중량이 상한중량 이상 / 계산 불가 |
| `engines.priceFailure` | `price_basis_not_selected` / `invalid_price` / `no_realized_basis` | 단가 근거 미선택 / 단가가 유효하지 않음 / 실현 단가를 역산할 실적 없음 |
| `engines.sizePriceFailure` | `anchor_invalid` / `target_invalid` / `anchor_premium_excluded` / `elasticity_form_mismatch` / `elasticity_out_of_plausible_range` | 기준 단가 오류 / 목표 크기 오류 / 프리미엄 상품은 기준으로 쓸 수 없음 / 상태(활·선·냉동)가 다른 계수 / 탄력성이 설명 범위 밖 |
| `engines.breakEvenFailure` | `no_price` / `no_mean_weight` / `no_stocked_count` / `unreachable` | 단가 없음 / 평균 개체중 없음 / 입식 마리수 없음 / 어떤 생존율로도 비용을 넘지 못함 |
| `engines.growthExcluded` | `not_finite` / `abw_not_positive` / `below_stanza_break` / `abw_at_or_above_winf` | 값 오류 / 개체중 0 이하 / 7.5 g 미만 / 상한중량 이상 |

### 9-6. 어휘·단위·라벨

| 객체 | 키 | ko |
|---|---|---|
| `engines.unit` | `krw` / `krwPerKg` / `kg` / `count` / `month` / `day` / `gram` / `ratio` | `원` / `원/kg` / `kg` / `건` / `개월` / `일` / `g` / `배` |
| `engines.channel` | `wholesale` / `retail_live` / `retail_frozen` | 도매 / 소매(활) / 소매(냉동) |
| `engines.channelObservedTpl` | — | `관측 {{n}}건` |
| `engines.group` | `quantified` / `unquantified` / `denominator` | 아는 폭 / 폭 모름 / 분모 경고 |
| `engines.groupHint` | 같은 3키 | 금액이 계산됩니다 / 금액을 모릅니다 / 금액이 아니라 분모를 흔듭니다 |
| `engines.source` | `growth` / `pricing` / `profitability` / `harvest` | 성장곡선 / 단가 / 수익성 / 출하 |

### 9-7. 화면 문구 — `production` 섹션에 추가

기존 `production` 섹션(타입 872~978행)에 이어서. 화면 전용이라 여기가 맞다.

| 키 | ko 초안 |
|---|---|
| `tabHarvest` | 출하 |
| `tenThousandWon` | 만원 |
| `decisionWindowTpl` | 추천 출하 {{n}} |
| `decisionWindowNone` | 출하 구간을 계산할 수 없습니다 |
| `profitHeadline` | 영업이익 |
| `profitRecorded` | 기록된 값 |
| `profitWithKnownGap` | 아는 폭을 반영하면 |
| `profitOpenLow` | 아래로 열려 있음 |
| `profitBandAria` | 영업이익 폭. 기록된 값과 계산되는 폭, 폭을 모르는 구간 |
| `widthUnknown` | 폭 미상 |
| `detailsOpen` / `detailsClose` | 자세히 / 접기 |
| `knownTotalLabel` | 입력된 항목 합계 |
| `missingItemsTpl` | 미입력 {{n}}개 항목 |
| `fixCostTpl` | {{n}} 입력 |
| `priceBasisTitle` | 단가 근거 |
| `priceBasisNone` | 채널을 고르면 금액이 계산됩니다 |
| `priceBasisGapNote` | 도매와 소매(활)가 56% 벌어집니다 |
| `priceObservedRange` | 관측 범위 |
| `priceRealized` | 실현 단가(실적 역산) |
| `priceExplicit` | 직접 입력 |
| `inventoryTitle` | 미판매 재고 |
| `inventoryKgLabel` | 재고 중량 (kg) |
| `inventoryValuationHint` | 재고를 얼마로 볼지는 사람이 정합니다 |
| `growthAxisDate` / `growthAxisCdd` | 날짜 / 적산수온 |
| `growthBandMae` | 홀드아웃 오차 ±{{n}} g |
| `growthExcludedLegendTpl` | 제외 {{n}}건 (7.5 g 미만) |
| `growthNeedSamplesTpl` | 샘플 {{n}}건부터 곡선이 나옵니다 |
| `growthHaveSamplesTpl` | 현재 {{n}}건 |
| `growthNeedStanzaTpl` | 7.5 g 이상 샘플이 {{n}}건 필요합니다 |
| `growthForecastNeedsTemp` | 예측선을 날짜축에 그리려면 수온 전망이 필요합니다 |
| `growthNoTempSeries` | 적산수온을 만들 수온 기록이 없습니다 |
| `windowRangeTpl` | {{n}} |
| `windowSpanDaysTpl` | {{n}}일 폭 |
| `windowIndistinguishable` | 이 구간 안에서는 차이가 구분되지 않습니다 |
| `windowManualTarget` | 농가 입력 |
| `windowShowChart` | 이익 곡선 보기 |
| `windowChartAria` | 출하 시점별 예상 이익과 추천 구간 |
| `marginalTitle` | 2주 더 키우면 |
| `marginalFactorSizePremium` | 크기 프리미엄 |
| `marginalFactorWeightGain` | 증체 |
| `marginalFactorMortality` | 폐사 손실 |
| `marginalFactorFeed` | 사료비 |
| `marginalFactorElectricity` | 전기비 |
| `marginalFactorNet` | 합계 |
| `marginalNotEstimated` | 미산정 |
| `marginalShowTable` | 수치 표 |
| `marginalRatioTpl` | +{{n}}% |
| `sensitivityTitle` | 생존율 민감도 |
| `sensitivityDistanceTpl` | 지금 {{n}} |
| `sensitivityBreakEven` | 손익분기 |
| `sensitivityGapTpl` | {{n}}%p 부족 |
| `sensitivityBreakEvenAboveOne` | 입식한 전부가 살아도 적자입니다 |
| `sensitivityActual` | 실측 |
| `sensitivityAssumed` | 가정 |
| `sensitivityHeldFixed` | 고정한 값 |
| `sensitivityMixedWeight` | 평균 개체중은 11월 출하분과 소형 반출이 섞인 값입니다 |
| `sensitivityChartAria` | 생존율별 영업이익과 손익분기점 |
| `costBarAria` | 비용 구성. 입력된 항목과 미입력 항목 |
| `costBarOpenEnd` | 미입력 항목이 있어 막대가 닫히지 않습니다 |
| `blockerChecklistTitle` | 계산에 필요한 것 |
| `profitPositive` / `profitNegative` | 이익 / 손실 |

> `profitPositive`·`profitNegative` 는 B-3(색 단독 금지)의 텍스트다. 이것이 빠지면 B-3 를 구현할 수 없다.

---

## 10. 서연에게 넘기는 선결 항목 — 설계로 못 메운 것

| # | 항목 | 왜 막히나 | 제안 |
|---|---|---|---|
| **D-1** | ~~**일별 평균 수온 시계열이 화면에 없다**~~ → **해소(2026-10-03)** | 엔진 1 은 `cumulativeDegreeDays(DailyWaterTemp[])` 로 적산수온축을 만든다. 그런데 `CycleDetail` 은 샘플·비용·수확만 불러온다. `lib/db.ts` 의 수온 조회는 `getWaterQuality(tankId, hours = 168)` 뿐이고 **60초 주기** 원시 행이다. 9개월 사이클이면 약 39만 행 — 클라이언트에서 받을 수 없다. 게다가 `wq_series` 는 `p_hours` 를 `LEAST(..., 24 * 60)` 으로 자르므로 **상한이 60일**이고, 버킷도 달력일이 아니라 epoch 초를 나눈 것이라 적산수온의 날짜 단위와 맞지 않는다 | **DB 함수 `wq_daily_mean(p_tank, p_from, p_to)` 를 신설했다**(`supabase/migrations/wq_daily_mean.sql`) — 달력일(Asia/Seoul) 평균. `wq_series` 를 고치지 않은 이유는 그쪽이 그래프용이고 상한을 늘리면 그래프가 느려진다는 것(마이그레이션 머리주석). 조회 경로는 `lib/db.ts` 의 `getDailyWaterTemps()`. **사람이 Supabase SQL Editor 에서 그 파일을 실행해야 동작한다** — 실행 전에는 성장 탭이 7절 「수온 시계열 없음」 상태로 렌더된다 |
| **D-2** | ~~**엔진 3 반환 타입 미확정**~~ → **해소(2026-10-03)** | `lib/harvest/` 가 없었다 | 엔진 3 이 구현됐고 **설계서를 엔진에 맞춰 고쳤다**(4-4·4-5). 가정과 어긋난 자리 여섯 군데를 4-4 의 표에 기록해 두었다. 약속한 두 조건은 둘 다 지켜졌다 — `recommended` 는 구간(`startDayOffset`·`endDayOffset` + 날짜)이고, `indistinguishableWithinWindow` 는 반환값에 있다(단, **최상위가 아니라 `recommended` 안**이다 — 구간이 없으면 구분 가능성도 없으므로) |
| **D-3** | 잔여기간 급이량 입력 경로 | `projectHarvestScenarios` 의 `additionalCost` 를 아무도 채우지 않으면 한계분석의 사료비 행이 영구히 「미산정」이다 | 엔진 5(급이 최적화, 계획서 3-4)가 채울 자리다. 그때까지 미산정 행으로 두는 것이 맞다 — **0 으로 채우는 것이 가장 위험한 선택이다** |
| **D-4** | `cycle.total_feed_kg` | FCR 이 이 값에 걸려 있다(343행) | 계획서 2-0 ①로 이미 처리됨. 확인만 |

---

## 11. 구현 순서

엔진 3 과 D-1 을 기다리지 않고 **지금 할 수 있는 것부터.**

| 단계 | 내용 | 막는 것 |
|---|---|---|
| 1 | `format.ts` 분리(B-1·B-2·B-3) + `ExclusionChip` + `engines` i18n 4파일 + `types.ts` | 없음 |
| 2 | `PriceBasisPicker` → `ProfitHeadline`(`ProfitUncertaintyBar`+`UncertaintyList`) → `CostCompositionBar` | 없음. **요구 ① 이 여기서 끝난다** |
| 3 | `SurvivalSensitivity` | 없음. **요구 ④** |
| 4 | `GrowthCurveChart` + `EngineEmptyState` | 예측선만 D-1 대기. 실측·빈 상태는 지금 가능 |
| 5 | `HarvestWindowStrip`/`Band` + `MarginalBreakdown` + `DecisionStrip` + 탭 추가 | D-2 대기. **요구 ②③** |

### 인도 전 체크 — 태양 검수 항목

- [ ] 금액이 점으로 보이는 자리가 한 곳도 없다. 폭이 없으면 폭이 없다고 적혀 있다
- [ ] 「신뢰구간」이라는 단어가 어디에도 없다. 성장 리본은 **MAE** 로 적혀 있다
- [ ] 엔진이 `null` 을 준 자리에 `0` 이나 `-` 가 없다
- [ ] 「총비용」이라고 쓴 자리가 `knownTotalKrw` 가 아니다 (`complete === false` 면 라벨이 「입력된 항목 합계」)
- [ ] 추천 출하에 점 마커가 없다. `dot={false}`
- [ ] 손익 부호가 색 단독으로 표현된 자리가 없다(기존 516·520행 포함)
- [ ] 차트 추천/부족 구간에 해칭이 들어가 있다
- [ ] 경고 그룹 3줄이 어떤 상태에서도 접히지 않는다
- [ ] 단가 채널이 미리 선택돼 있지 않다
- [ ] 375px 에서 가로 스크롤이 없고, 탭 4칸 글자가 깨지지 않는다
- [ ] 차트가 `width:0` 컨테이너에 렌더되는 경로가 없다(`hidden sm:block` 금지, 조건부 렌더)
- [ ] `ko`/`en`/`vi`/`id` + `types.ts` 다섯 파일이 모두 갱신됐다
- [ ] 다크모드에서 해칭·리본·배경 띠가 보인다
- [ ] 기존 `tabFinance` 6 KPI 카드가 그대로 있다
