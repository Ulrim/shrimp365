# 농업 모드 UI 시안 — 입력 폼과 모니터링 내용물 (개정 2)

- 작성: 수아 (디자이너)
- 작성일: 2026-08-19
- 상위 문서: `docs/plans/agriculture-forms.md` (민준, 개정 2) — 5-A 산출물 7개
- 이어가는 문서: `docs/plans/agriculture-mode-ui.md` (수아, 개정 1 시안) — 톤·색·컴포넌트 결 그대로
- 분기 축: `docs/plans/agriculture-mode.md` 개정 1 7장 — URL(`isAgri`) / `farm.farm_type` / 서버 `farms.farm_type`
- 대상 독자: 서연 (이 문서만 보고 구현 가능해야 한다)

## 0. 이 문서의 범위와 절대 원칙

| # | 산출물 | 대상 파일 | 이 문서의 장 |
|---|---|---|---|
| 1 | 측정 입력 폼 농업판 | `components/record/water-quality-record-view.tsx` | §2 |
| 2 | 일지 입력 폼 농업판 | `components/record/journal-record-view.tsx` | §3 |
| 3 | 대시보드 농업판 | `components/dashboard/dashboard-view.tsx` | §4 |
| 4 | 베드 카드·요약 스트립 | `farms-view.tsx:1449-1494`, `water-quality-view.tsx:846-865` | §5 |
| 5 | 항목별 상태 카드 | `water-quality-view.tsx:960-988` | §6 |
| 6 | 중립 상태 스타일 신규 | 공통 토큰 | **§1** (3·5가 참조하므로 먼저 읽는다) |
| 7 | agri-ko `journalX`·`recordX` 신규 + 하드코딩 추출 | `lib/i18n/*` | §7 |

**절대 원칙 (재확인).**

1. **새우 양식 화면은 픽셀 하나 바뀌지 않는다.** 모든 항목은 "농업 조건일 때만 추가/치환"이다.
   새우 분기는 **현재 코드를 그대로 옮기기만** 한다 — diff가 들여쓰기뿐이어야 한다.
2. **기준이 없으면 색을 칠하지 않는다** (민준 3-4). 지금 농업 화면이 빨간 이유는 기준이
   없어서가 아니라 **틀린 기준이 있어서**다. 없는 것보다 나쁘다.
3. **색만으로 의미를 전달하지 않는다.** 상태는 언제나 `색 + 점 모양 + 텍스트` 3중 표기.
4. 새 색·새 컴포넌트를 만들지 않는다. `components/ui/`(Radix 15종)와 기존 팔레트 안에서 푼다.
5. 화면 문구는 하드코딩하지 않는다 — `lib/i18n/{ko,en,vi,id}.ts` 4파일 + `types.ts` 전부.

> `ui-ux-pro-max` 스킬은 검색 스크립트 실행(Bash)이 필요해 이번에는 돌리지 못했다.
> 대신 스킬의 정적 규칙표(우선순위 1 접근성 대비 4.5:1·2 터치 44px·8 폼 피드백·
> 10 차트에서 색만으로 의미 전달 금지)와 이 앱의 기존 결을 기준으로 삼았다.
> 스킬 DB 매칭이 아니라 내장 규칙 기반임을 명시한다.

---

## 1. 【산출물 6】 상태 표현 4종 — 중립 신규

### 1-1. 왜 3색으로는 모자라는가

현재 표현 수단은 두 벌뿐이다.

- 대시보드 최신값 타일(`dashboard-view.tsx:314-322`): `ok ? emerald : red` — **2색**
- 항목별 배지(`water-quality-view.tsx:48-52` `STATUS_STYLES`): 정상/주의/위험 — **3색**

농업에는 **"판정할 기준이 아예 없는 항목"** 이 구조적으로 존재한다.

| 상황 | 예 |
|---|---|
| 전역 기준선을 긋지 않기로 한 항목 | EC (레시피 없는 베드), 유량, 차압 |
| 값이 아직 안 들어온 항목 | 센서 미설치 베드의 유량·차압, 첫 측정 전 EC |

이 둘을 emerald로 칠하면 **거짓 안심**이고, red로 칠하면 **지금 그대로의 오탐**이다.
그래서 네 번째 표현이 필요하다.

### 1-2. 토큰 정의

**기존 3색의 값은 한 글자도 바꾸지 않는다.** 농업 분기에서만 쓸 상수를 새로 둔다.

```ts
// components/water-quality/water-quality-view.tsx (또는 서연 판단으로 공용 위치)
// 농업 상태 4종. "기준없음" 은 색이 아니라 색의 부재로 말한다.
export type AgriStatusLevel = "정상" | "주의" | "위험" | "기준없음"

export const AGRI_STATUS_STYLES: Record<AgriStatusLevel, {
  dot: string; text: string; bg: string
}> = {
  정상:   { dot: "bg-emerald-500",                                 text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  주의:   { dot: "bg-amber-500",                                   text: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10 border-amber-500/20" },
  위험:   { dot: "bg-red-500",                                     text: "text-red-600 dark:text-red-400",         bg: "bg-red-500/10 border-red-500/20" },
  기준없음:{ dot: "bg-transparent border border-muted-foreground/50", text: "text-muted-foreground",                bg: "bg-muted border-border" },
}
```

세 가지 구분 수단을 **동시에** 쓴다:

| 수단 | 정상 | 주의 | 위험 | 기준없음 |
|---|---|---|---|---|
| 색 | emerald | amber | red | 무채색(muted) |
| 점 모양 | **꽉 찬 원** | 꽉 찬 원 + `animate-pulse` | 꽉 찬 원 + `animate-pulse` | **속 빈 원(테두리만)** |
| 텍스트 | `정상` | `주의` | `위험` | **`기준 없음`** 또는 **`미측정`** |

- 속 빈 원은 색맹·흑백 인쇄·저대비 환경에서도 "다른 종류"임이 즉시 보인다. 색이 유일한
  단서가 되지 않게 하는 것이 목적이다(스킬 규칙 1·10).
- `animate-pulse`는 **주의·위험에만.** 중립이 깜빡이면 "뭔가 문제"로 읽힌다.
- 텍스트 두 종류의 구분:
  - **`기준 없음`** — 값은 있는데 판정 기준이 없다 (레시피 미설정 EC, 유량, 차압).
  - **`미측정`** — 값 자체가 없다 (`null` 또는 `0`).
  값이 없으면서 기준도 없으면 **`미측정`이 우선**이다. 사용자가 먼저 할 일이 측정이기 때문.

### 1-3. 대비 — 새우와 다른 명도를 쓰는 이유

새우 배지는 `text-emerald-500` / `text-amber-500` / `text-red-500`이다. `amber-500`(#f59e0b)은
밝은 배경에서 대비가 약 2.1:1로 4.5:1 기준에 못 미친다. 농업 표현은 신규이므로 여기서만
**`-600 dark:-400` 쌍**으로 올린다. 새우 상수는 그대로 두므로 회귀가 아니다.

**서연·태양에게:** 농업 배지가 새우 배지보다 약간 진해 보이는 것은 **의도된 차이**다.
같게 맞추라는 리뷰를 하지 말 것. 새우 쪽 대비 개선은 별건(로드맵).

### 1-4. 두 가지 렌더 형태

**(a) 배지형** — 항목별 상태 카드(§6), 가로 나열용.

```tsx
<div
  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${s.bg} ${s.text}`}
  role="status"
  aria-label={`${label} ${t.waterQualityX.statusLabel}: ${statusText}`}
>
  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot} ${pulse ? "animate-pulse" : ""}`} aria-hidden="true" />
  <span>{label}</span>
  <span className="opacity-50" aria-hidden="true">·</span>
  <span className="tabular-nums">{valueText}</span>
  <span className="opacity-50" aria-hidden="true">·</span>
  <span>{statusText}</span>
</div>
```

새우 배지(`항목 · 상태`)와 달리 **값을 함께 넣는다**(`EC · 1.85 mS/cm · 정상`).
"기준 없음"일 때 상태 문구만 있으면 카드가 아무 정보도 주지 못하기 때문이다.
수치는 `tabular-nums` — 값이 갱신될 때 글자폭이 흔들리지 않는다.

**(b) 타일형** — 대시보드 최신값 타일(§4-4). 기존 마크업 구조(`dashboard-view.tsx:318-324`)
그대로, 클래스만 4종 토큰에서 뽑는다.

```tsx
<div className={`flex items-center gap-2 p-3 rounded-xl border ${s.bg}`}>
  <span className={s.text} aria-hidden="true">{icon}</span>
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground truncate">{label}</p>
    <p className={`text-sm font-bold tabular-nums ${s.text}`}>{value}<span className="font-medium ml-0.5">{unit}</span></p>
    <p className="text-[10px] text-muted-foreground">{statusText}</p>   {/* 신규 3번째 줄 */}
  </div>
</div>
```

3번째 줄(`statusText`)이 신규다. 새우 타일에는 없다 — 새우는 2색이라 색만으로도
읽히지만, 4종으로 늘어나면 텍스트 없이는 구분이 안 된다.

---

## 2. 【산출물 1】 측정 입력 폼 농업판

`components/record/water-quality-record-view.tsx` · `isAgri === true` 일 때만.

### 2-1. 전체 모습

```
┌──────────────────────────────────────────────┐
│              측정 기록                        │   ← t.record.waterQuality (agri-ko)
│              Step 2 / 4                      │
│  ████████████░░░░░░░░░░░░                    │   ← 기존 진행바 (bg-ocean-500)
│                                              │
│  ⓘ 센서가 자동으로 기록하고 있습니다. 이 화면은   │   ← 신규 notice (스텝 1에서만)
│    휴대용 측정기로 잰 값을 함께 남겨 센서와      │
│    대조하는 곳입니다.                          │
│  ┌────────────────────────────────────────┐  │
│  │ 날짜                                    │  │
│  │ [ 2026-08-19            ]              │  │
│  │                                        │  │
│  │ EC (mS/cm) (선택)                       │  │
│  │ [ 1.85                  ]              │  │
│  │ ┌────────────────────────────────────┐ │  │
│  │ │ 이 베드 목표 1.80 ±0.10 mS/cm ·      │ │  │
│  │ │ 1,850 µS/cm 로 저장됩니다            │ │  │
│  │ └────────────────────────────────────┘ │  │
│  │                                        │  │
│  │ pH (선택)                               │  │
│  │ [ 6.0                   ]              │  │
│  │ ┌ 이 베드 목표 6.0 ±0.5 ──────────────┐ │  │
│  └────────────────────────────────────────┘  │
│  [ ◀ 이전 ]            [ 다음 ▶ ]             │
└──────────────────────────────────────────────┘
```

**기존 폼의 결을 그대로 쓴다.** `StepWizard`(`components/wizard/step-wizard.tsx`)의
진행바·카드·힌트 박스·하단 버튼 2개는 손대지 않는다. 신규는 notice 슬롯 하나뿐이다.

### 2-2. 4스텝 구성

| 스텝 | key | 라벨 | type | unit | optional | placeholder | 힌트 |
|---|---|---|---|---|---|---|---|
| 1 | `tank_id` | `t.wizard.tankLabel`(신규) → agri **베드 선택** | `tank` | — | 필수 | — | — |
| 2 | `date` | `t.wizard.date` | `date` | — | 필수 | — | — |
| 2 | `conductivity` | **`EC`** (기호 — 사전 키 없음) | `number` | `mS/cm` | ○ | `예: 1.85` | §2-4 EC 힌트 |
| 2 | `ph` | **`pH`** (기호) | `number` | — | ○ | `예: 6.0` | §2-4 pH 힌트 |
| 3 | `temperature` | `t.waterQuality.temperature` → agri **양액 온도** | `number` | `°C` | ○ | `예: 21.5` | `t.agri.recordTempHint` |
| 3 | `do_level` | **`DO`** (기호) | `number` | `ppm` | ○ | `예: 7.0` | `t.agri.recordDoHint` |
| 4 | `flow_rate` | `t.waterQualityX.flowRate` **유량** | `number` | `L/min` | ○ | `예: 12` | `t.agri.recordFlowHint` |
| 4 | `diff_pressure` | `t.waterQualityX.diffPressure` **차압** | `number` | `kPa` | ○ | `예: 15` | `t.agri.recordDpHint` |

- 스텝 4의 `title`은 `t.wizard.confirmTitle` (기존 마지막 스텝 규칙 유지).
- **EC를 첫 입력 항목으로.** 사업 KPI가 EC 제어 정확도다.
- `pH`·`DO`·`EC`는 언어 무관 기호이므로 문자열 리터럴로 둔다 —
  `water-quality-view.tsx:66-71` `paramLabel()`의 기존 선례를 따른다. 새 i18n 키를 만들지 않는다.
- **새우 6항목(염도·암모니아·아질산염·질산염·알칼리도·탁도)은 폼에서 사라진다.** 접지 않는다.
  저장 시 `0`을 보낸다(민준 3-1).
- 전 항목 `optional: true` — 휴대용 미터가 재는 항목이 사람마다 다르다. `tank_id`·`date`만 필수.

### 2-3. 상단 안내 한 줄 — `StepWizard`에 `notice` prop 신규

수동 입력의 용도가 **센서 대체가 아니라 센서 대조**라는 것을 농가가 모르면
"센서가 있는데 왜 또 적나"가 된다. 폼을 여는 순간 한 번만 말한다.

```tsx
// step-wizard.tsx — Props 에 추가 (선택 prop, 새우는 넘기지 않으므로 렌더 결과 동일)
notice?: string

// 진행바(95행) 아래, 스텝 카드(98행) 위. 첫 스텝에서만.
{notice && step === 0 && (
  <p className="text-xs text-muted-foreground leading-relaxed bg-ocean-500/5 border border-ocean-500/20 rounded-xl px-3 py-2 mb-4 flex items-start gap-2">
    <Info className="w-3.5 h-3.5 text-ocean-600 shrink-0 mt-0.5" aria-hidden="true" />
    <span>{notice}</span>
  </p>
)}
```

- 문안 `t.agri.recordNotice`:
  **"센서가 자동으로 기록하고 있습니다. 이 화면은 휴대용 측정기로 잰 값을 함께 남겨
  센서와 대조하는 곳입니다."**
- 배경을 힌트 박스(`bg-muted/50`)와 다른 `bg-ocean-500/5`로 둔 이유: 필드에 딸린 힌트가
  아니라 **화면 전체에 대한 안내**임을 위치와 색으로 함께 구분한다.
- `Info`는 `lucide-react`. 스텝 1에서만 뜨므로 이후 스텝의 세로 공간을 먹지 않는다.
- **새우 폼은 `notice`를 넘기지 않는다** → `undefined` → 렌더 없음. 픽셀 무변.

### 2-4. 힌트 문안 — 레시피 목표값을 실제로 띄운다

`tanks` state에 `target_ec`/`ec_tolerance`/`target_ph`/`ph_tolerance`가 이미 들어 있다
(`getAllTanks()`가 `select("*")`). **추가 조회 0회.** `steps` 배열은 매 렌더 다시 만들어지므로
선택된 베드와 입력값에 따라 힌트가 살아 움직인다.

```ts
const selected = tanks.find(tk => tk.id === values.tank_id)

// EC 힌트 — 목표 + (입력 중이면) µS/cm 환산 에코
function ecHint(): string {
  const parts: string[] = []
  if (selected?.target_ec != null) {
    parts.push(
      t.agri.recordEcTarget
        .replace("{{target}}", (selected.target_ec / 1000).toFixed(2))
        .replace("{{tol}}", ((selected.ec_tolerance ?? 100) / 1000).toFixed(2))
    )
  } else {
    parts.push(t.agri.recordEcNoTarget)
  }
  const v = parseFloat(values.conductivity as string)
  if (Number.isFinite(v) && v > 0) {
    parts.push(t.agri.recordEcSaveNote.replace("{{v}}", Math.round(v * 1000).toLocaleString()))
  }
  return parts.join(" · ")
}
```

| 항목 | 레시피 있음 | 레시피 없음 |
|---|---|---|
| **EC** | `이 베드 목표 1.80 ±0.10 mS/cm` | `이 베드에 목표 EC가 없습니다 — 농장·기기 관리에서 레시피를 설정하면 여기에 목표가 표시됩니다.` |
| **pH** | `이 베드 목표 6.0 ±0.5` | `엽채류 권장 5.5~6.5` |

EC에는 **레시피가 없을 때 숫자 범위를 쓰지 않는다.** 여기에 "일반적으로 1.2~2.2" 같은 문장을
넣는 순간, 그것이 전역 EC 기준선이 된다 — 개정 1부터 지켜 온 "전역 EC 기준선 없음" 원칙이
힌트 문구로 뒷문을 통해 깨진다. pH는 민준 3-1에서 명시적으로 폴백 범위를 허용했으므로 넣는다.

고정 힌트:

| 키 | 문안 |
|---|---|
| `agri.recordTempHint` | `근권 권장 18~22 °C (칠러 가동 시)` |
| `agri.recordDoHint` | `5 ppm 이상 권장` |
| `agri.recordFlowHint` | `평소 유량과 크게 다르면 펌프·배관을 점검하세요.` |
| `agri.recordDpHint` | `평소보다 오르면 UV 살균기·필터 막힘을 의심하세요.` |

- 유량·차압 힌트에 **숫자를 넣지 않는다.** 정상 유량은 베드 규모·배관 길이마다 다르다.
  "평소와 다르면"이 유일하게 정직한 기준이고, 절대 기준은 로드맵(베드별 설정)이다.
- `근권 권장 18~22 °C`는 엽채류 수경재배의 일반 통설이며 **쪽파 실증치가 아니다**
  (민준 3-5와 같은 한계). 힌트에는 그 단서를 달지 않는다 — 힌트에 각주를 달면 아무도 안 읽는다.
  문서와 리뷰 코멘트에 남기는 것으로 충분하다.

### 2-5. mS/cm ↔ µS/cm — 농가가 오해하지 않게 하는 표기 규칙

환산 지점이 이번에 **4번째**로 늘어난다(기존 3곳: 레시피 폼 저장, 목표선 라벨, 양액 카드 —
개정 1 시안 7-4). 규칙을 한 문장으로 못 박는다.

> **사람이 읽고 쓰는 곳은 언제나 mS/cm. DB와 차트 y좌표는 언제나 µS/cm.
> 경계는 폼 저장(×1000)과 표시(÷1000) 두 방향뿐이다.**

농가에게 보이는 표기:

1. **라벨에 단위를 박는다** — `EC (mS/cm)`. `StepWizard`가 `field.unit`을 라벨 옆
   `(mS/cm)`으로 렌더하므로 `unit: t.agri.targetEcUnit`("mS/cm")를 넘기면 끝이다.
2. **placeholder가 자릿수를 말한다** — `예: 1.85`. `예: 1850`을 치는 사고를 첫 화면에서 막는다.
3. **입력 즉시 환산값을 에코한다** — 힌트 뒤에 `· 1,850 µS/cm 로 저장됩니다`.
   나중에 그래프 y축에서 `1850`을 봤을 때 "내가 적은 1.85가 이거구나"가 연결된다.
   이 한 줄이 없으면 두 단위가 서로 다른 값으로 기억된다.
4. **에러 문구도 mS/cm로** — 범위 검증(`WQ_BOUNDS.conductivity`는 µS/cm 0~20000)에서
   걸렸을 때 사용자에게는 `EC: 0~20 mS/cm 범위를 벗어났습니다.`로 보여준다.
   서연: 농업 분기 검증에서 `conductivity`만 표시 단위 변환을 한 번 태울 것.

### 2-6. 저장 payload (농업)

```ts
await insertWaterQuality(values.tank_id, {
  temperature:   parseFloat(values.temperature) || 0,
  ph:            parseFloat(values.ph) || 0,
  do_level:      parseFloat(values.do_level) || 0,
  conductivity:  values.conductivity ? Math.round(parseFloat(values.conductivity) * 1000) : 0, // mS/cm → µS/cm
  flow_rate:     parseFloat(values.flow_rate) || 0,
  diff_pressure: parseFloat(values.diff_pressure) || 0,
  // 새우 6항목 — 농업에서는 받지 않는다. 0 이면 checkThresholds 가 건너뛴다(thresholds.ts:42).
  salinity: 0, ammonia: 0, nitrite: 0, nitrate: 0, alkalinity: 0, turbidity: 0,
  recorded_at: new Date(`${values.date}T12:00:00`).toISOString(),
})
```

### 2-7. 빈 상태·에러 상태 (농업)

문구만 i18n으로 갈린다. **레이아웃·색·아이콘은 기존 그대로.**

| 상태 | 현재(하드코딩) | 신규 키 | 농업 문안 (agri-ko) |
|---|---|---|---|
| 로드 실패 (140행) | `수조 목록을 불러오지 못했습니다.` | `recordX.tankLoadFailed` | `베드 목록을 불러오지 못했습니다.` |
| 재시도 버튼 (145행) | `다시 시도` | **`t.common.retry` 재사용** (ko.ts:747) | — |
| 빈 상태 제목 (158행) | `등록된 수조가 없습니다` | `recordX.noTanksTitle` | `등록된 베드가 없습니다` |
| 빈 상태 본문 (159행) | `수질 기록을 시작하려면…` | `recordX.noTanksWqMsg` | `측정 기록을 시작하려면 먼저 농장과 베드를 등록해 주세요.` |
| 빈 상태 CTA (166행) | `양식장 등록하기` | `recordX.registerFarmCta` | `농장 등록하기` |
| 저장 실패 (90행) | `저장에 실패했습니다…` | `recordX.saveFailed` | (동일 — 오버라이드 없음) |
| 숫자 검증 (64행) | `유효한 숫자를 입력해주세요.` | **`t.journalX.errInvalidNumber` 재사용** (ko.ts:824) | — |
| 범위 검증 (66행) | `범위를 벗어났습니다.` | **`t.journalX.errOutOfRange` 재사용** (ko.ts:825) | — |

빈 상태의 `/onboarding` 링크(162행)에는 **접두사를 붙이지 않는다** — 온보딩은 공유 화면
(설계서 4-4의 의도된 예외).

---

## 3. 【산출물 2】 일지 입력 폼 농업판

`components/record/journal-record-view.tsx` · `isAgri === true` 일 때만.

### 3-1. 어휘 치환 — 무엇이 무엇이 되는가

새우 어휘가 남으면 농가는 화면을 못 믿는다. **전부** 바꾼다.

| 새우 어휘 | 어디에 | 농업 어휘 | 이유 |
|---|---|---|---|
| **PHOCA 9071~9075** (사료 상품명) | `FEED_TYPES` (`record-actions.ts:7-10`) | **`AGRI_NUTRIENT_TYPES`** = `["A/B 표준 배양액", "자가 배양액", "추비(단비)", "기타"]` | 새우 사료 상품명이 양액 선택지에 있을 이유가 없다 |
| **컬리버 1~3호** (미생물 제품명) | `MICROBIAL_TYPES` (`:11`) | **`AGRI_INPUT_TYPES`** = `["미생물제", "칼슘·규산 보충제", "천적", "기타"]` | 제품명 대신 **자재 범주**로. 특정 제품에 묶이지 않는다 |
| **사료 종류** | 스텝 2 라벨 | **양액 종류** | |
| **급이량 (kg)** | 스텝 2 | **양액 보충량 (L)** | 양액은 부피로 잰다. kg 그대로 두면 데이터가 오염된다 |
| **급이 횟수 (회/일)** | 스텝 2 | **보충 횟수 (회/일)** | |
| **폐사 수 (마리)** | 스텝 3 | **폼에서 삭제** (`mortality_count = 0` 저장) | 대응물이 없다. **다른 뜻으로 재활용하지 않는다** — 컬럼명과 뜻이 어긋나면 반드시 사고 난다 |
| **일일 환수율 (%)** | 스텝 3 | **양액 교환율 (%)** | 재순환 양액을 새것으로 바꾼 비율 |
| **소독 여부 / 소독 종류** | 스텝 4 | **방제 실시 / 약제명** | 농업은 "소독"이 아니라 "방제" |
| **미생물 투여 / 종류 / 투여량** | 스텝 4 | **자재 투입 / 자재 종류 / 투입량** | 미생물 외 보충제·천적까지 담는다 |
| **폭기 장치** | 스텝 5 | **근권 냉방 칠러** | 시스템 구성이 다르다(설계서 1장) |
| **여과 장치** | 스텝 5 | **필터·UV 살균기** | |
| **순환 장치** | 스텝 5 | **순환 펌프** | |
| **급이 장치** | 스텝 5 | **생육 상태** | 점검 대상이 장비가 아니라 작물이다 |
| **양식 일지 / 양식장 / 수조** | 빈 상태 | **영농 일지 / 농장 / 베드** | |

**컬럼 재해석 매핑 (DB 무변, 마이그레이션 0건)**

| 컬럼 | 농업 의미 | 단위 | 폼 |
|---|---|---|---|
| `feed_type` | 양액 종류 | — | select `AGRI_NUTRIENT_TYPES` |
| `feeding_amount` | **양액 보충량** | **L** | number |
| `feeding_times` | 보충 횟수 | 회/일 | number |
| `water_exchange_rate` | **양액 교환율** | % | number |
| `disinfection` / `disinfection_type` | **방제 실시** / 약제명 | — | switch → text |
| `microbial_input` / `microbial_type` / `microbial_amount` | **자재 투입** / 종류 / 투입량 | kg | switch → select → number |
| `check_circulation` | 순환 펌프 점검 | — | switch |
| `check_filtration` | **필터·UV 살균기 점검** | — | switch |
| `check_aeration` | **근권 냉방 칠러 점검** | — | switch |
| `check_feeding_check` | **생육 상태 확인** | — | switch |
| `notes` | 메모 | — | textarea |
| `mortality_count` | — | — | **미노출, `0` 저장** |

### 3-2. 4스텝 구성

**스텝 1 — 베드와 날짜**

| key | 라벨 | type | 비고 |
|---|---|---|---|
| `tank_id` | `t.wizard.tankLabel` → **베드 선택** | `tank` | 필수 |
| `date` | `t.wizard.date` | `date` | 필수 |

**스텝 2 — 양액 관리** (`title: t.agri.journalStepNutrient` = `양액 관리`)

| key | 라벨 | type | unit | optional | placeholder | 힌트 |
|---|---|---|---|---|---|---|
| `feed_type` | `t.agri.nutrientType` **양액 종류** | `select` | — | — | — | — |
| `feeding_amount` | `t.agri.nutrientRefill` **양액 보충량** | `number` | `L` | ○ | `예: 40` | `t.agri.nutrientRefillHint` |
| `feeding_times` | `t.agri.refillTimes` **보충 횟수** | `number` | `회/일` | ○ | `예: 2` | — |
| `water_exchange_rate` | `t.agri.exchangeRate` **양액 교환율** | `number` | `%` | ○ | `예: 30` | `t.agri.exchangeRateHint` |

- 힌트 `nutrientRefillHint`: **`오늘 양액조에 새로 채운 양입니다.`**
- 힌트 `exchangeRateHint`: **`전량 교환이면 100. 일부만 바꿨으면 바꾼 비율을 적습니다.`**
  → 새우 폼의 `10~30% 권장`은 **가져오지 않는다.** 쪽파 NFT의 권장 교환 주기 실증치가
  우리에게 없다. 없는 숫자를 권장으로 적으면 그것이 기준이 된다.
- 새우 폼에서 `feeding_amount`·`feeding_times`는 **필수**였다. 농업에서는 **전부 선택**으로
  바꾼다 — 보충을 안 한 날 `0`을 억지로 치게 하면 "보충 안 함"과 "0 L 보충"이 구분되지 않는다.

**스텝 3 — 재배 작업** (`title: t.agri.journalStepWork` = `재배 작업`)

| key | 라벨 | type | dependsOn | 비고 |
|---|---|---|---|---|
| `disinfection` | `t.agri.pestControl` **방제 실시** | `switch` | — | |
| `disinfection_type` | `t.agri.pestAgent` **약제명** | `text` | `disinfection === true` | placeholder `t.agri.pestAgentPlaceholder` = `약제 이름을 입력하세요` |
| `microbial_input` | `t.agri.inputApplied` **자재 투입** | `switch` | — | |
| `microbial_type` | `t.agri.inputType` **자재 종류** | `select` `AGRI_INPUT_TYPES` | `microbial_input === true` | |
| `microbial_amount` | `t.agri.inputAmount` **투입량** | `number` | `microbial_input === true` | unit `kg`, placeholder `예: 0.5`, 힌트 `t.agri.inputAmountHint` |

- 힌트 `inputAmountHint`: **`액상 자재는 L 단위로 적습니다 (1 L = 1 kg 로 봅니다).`**
  컬럼이 단위 없는 `NUMERIC` 하나뿐이라 섞이는 것을 문구로 막는다.
- `dependsOn` 조건부 노출은 기존 폼의 패턴 그대로 — 새 상호작용을 만들지 않는다
  (점진적 공개, 스킬 규칙 8).

**스텝 4 — 설비 점검 + 메모** (`title: t.wizard.confirmTitle` — 마지막 스텝 규칙 유지)

| key | 라벨 | type |
|---|---|---|
| `check_circulation` | `t.agri.checkPump` **순환 펌프** | `switch` |
| `check_filtration` | `t.agri.checkFilterUv` **필터·UV 살균기** | `switch` |
| `check_aeration` | `t.agri.checkChiller` **근권 냉방 칠러** | `switch` |
| `check_feeding_check` | `t.agri.checkGrowth` **생육 상태** | `switch` |
| `notes` | `t.journal.notes` **메모** | `textarea`, placeholder `t.agri.journalNotesPlaceholder` |

- **순서가 새우와 다르다.** 새우는 폭기→여과→순환→급이, 농업은 **순환→필터/UV→칠러→생육**.
  양액이 도는 순서(펌프 → 필터 → 냉각)를 따라간 것이라 현장에서 점검하는 동선과 같다.
- `journalNotesPlaceholder`: **`특이사항을 적어 주세요. 수확량도 여기에 적습니다.`**
  → 수확 실적 칸은 이번 범위 밖(`/production` 재설계와 함께, 민준 3-2). 그때까지 어디에
  적어야 하는지를 폼이 알려 준다. 안 알려 주면 농가는 적을 곳이 없다고 판단하고 안 적는다.

### 3-3. localStorage 기본값 키 분리

```ts
export const JOURNAL_DEFAULTS_KEY      = "journal_form_defaults"       // 새우 (무변)
export const JOURNAL_DEFAULTS_KEY_AGRI = "journal_form_defaults_agri"  // 신규
```

혼합 계정이 두 폼을 오가면 새우 폼 "사료 종류"에 `A/B 표준 배양액`이 떠 있게 된다.
`loadJournalDefaults(agri: boolean)` / `saveJournalDefaults(form, agri: boolean)` 로
두 번째 인자 기본값 `false` — **기존 호출부는 한 글자도 안 고친다.**

### 3-4. 일지 목록 카드 타일 4개 (`journal/journal-view.tsx:189-209`)

`0 마리` 폐사 타일이 농업 일지 목록에 남아 있으면 §5와 같은 문제다.

| # | 새우 | 농업 | 값 | 아이콘 · 색 |
|---|---|---|---|---|
| 1 | 급이량 `kg` | **양액 보충량 `L`** | `entry.feeding_amount` | `Droplets` · `text-ocean-500` |
| 2 | **폐사 `N 마리`** | **보충 횟수 `회/일`** | `entry.feeding_times` | `Repeat`(신규 import) · `text-amber-500` |
| 3 | 환수율 `%` | **양액 교환율 `%`** | 무변 | `RefreshCw` · `text-teal-500` (무변) |
| 4 | 미생물 | **자재** | 무변 | `FlaskConical` · `text-purple-500` (무변) |

- 2번 타일에 amber를 그대로 물려준 이유: 그리드 4칸의 색 리듬(ocean-amber-teal-purple)이
  유지되어 새우/농업 화면이 같은 앱처럼 보인다.
- 하단 요약 줄(213~214행) `사료: PHOCA 9073S · 4회/일` → 농업은 **`양액: A/B 표준 배양액`**.
  보충 횟수가 2번 타일로 올라갔으므로 여기서는 뺀다(중복 제거).
  라벨 `t.journalX.feed` → agri-ko `양액`.

### 3-5. 빈 상태 (농업)

| 위치 | 현재 | 신규 키 | 농업 문안 |
|---|---|---|---|
| 145행 | `수조 목록을 불러오지 못했습니다.` | `recordX.tankLoadFailed` (§2-7과 공유) | `베드 목록을 불러오지 못했습니다.` |
| 163행 | `등록된 수조가 없습니다` | `recordX.noTanksTitle` (공유) | `등록된 베드가 없습니다` |
| 164행 | `양식 일지를 작성하려면…` | `recordX.noTanksJournalMsg` | `영농 일지를 쓰려면 먼저 농장과 베드를 등록해 주세요.` |
| 171행 | `양식장 등록하기` | `recordX.registerFarmCta` (공유) | `농장 등록하기` |
| 82행 | `저장에 실패했습니다…` | `recordX.saveFailed` (공유) | (동일) |

빈 상태 아이콘·색(emerald 계열)은 **그대로 둔다.** 일지 화면의 기존 정체성이다.

---

## 4. 【산출물 3】 대시보드 농업판

`components/dashboard/dashboard-view.tsx` · `isAgri === true` 일 때만.

### 4-1. 화면 전체 배치

```
┌ 알림 배너 (있을 때) ─────────────────────────────────────────┐
└──────────────────────────────────────────────────────────────┘
   ✕ 저재고 배너 — 농업에서는 배너째 렌더 안 함 (현재는 버튼만 숨김)

바로가기:  [양액 관리]  [영농 일지]                    ← 이미 필터됨

┌ 운영 농장 ┐┌ 가동 베드 ┐┌ 오늘 알림 ┐┌ EC 이탈 알림 ┐      ← StatCard 4
└──────────┘└──────────┘└──────────┘└──────────────┘         4번째만 교체

┌───────────── EC 추이 (24h) ─────────┐┌─ 가동 베드 목록 ──┐
│  [베드 선택 ▾]            전체 보기 →││ 1번 베드 (NFT-A)  │
│  ┌────────────────────────────────┐ ││ EC 1.80  · 정상   │
│  │ ░░░░ 허용밴드 ░░░░              │ ││ 2번 베드 (NFT-B)  │
│  │ ─ ─ ─ ─ 목표 1.80 ─ ─ ─ ─      │ ││ EC 1.80  · 주의   │
│  │    ╱‾‾╲___╱‾╲                  │ │└──────────────────┘
│  └────────────────────────────────┘ │┌─ 날씨 카드 (무변) ─┐
│  ┌ EC ─┐┌ pH ─┐┌ 양액온도 ┐┌ 유량 ┐ │└──────────────────┘
│  │1.85 ││ 6.0 ││ 21.5 °C ││ 12   │ │┌─ 차압 추세 (신규) ─┐
│  │정상  ││정상  ││  정상    ││기준없음│ ││ 15.2 kPa  ▲ +3.1  │
│  └─────┘└─────┘└─────────┘└──────┘ ││ ▁▂▂▃▄▅▆▆          │
└─────────────────────────────────────┘│ 올라가는 추세…     │
                                        └──────────────────┘
   ✕ 진단 표 — 농업에서 숨김 (개정 1 완료). 그 자리에 차압 카드가 들어간다.
```

### 4-2. 저재고 배너 — 배너째 숨김 (205~225행)

현재는 버튼(217행)만 `!isAgri`다. 배너 본체는 그대로 떠서 농업 농가가
"재고 부족 3건"을 보고 **갈 곳 없는 경고**를 받는다. 205행 블록 전체를 `!isAgri &&`로 감싼다.

### 4-3. StatCard 4장 (259~264행)

| # | 새우 | 농업 | 값 | 부제 | 아이콘 · 색 |
|---|---|---|---|---|---|
| 1 | 운영 농장 | 무변 | `farms.length` | `전체 N` | `Building2` · ocean |
| 2 | 가동 베드 | 무변 (라벨은 agri-ko `가동 베드`) | `statusCounts.active` | `주의 N / 위험 N` | `Layers` · teal |
| 3 | 오늘 알림 | 무변 | `alerts.length` | `t.dashboard.alertsNone` | `AlertTriangle` · amber |
| 4 | **최근 진단(비브리오)** | **EC 이탈 알림** | `alerts.filter(a => a.parameter === "EC").length` | `목표 ±0.10 mS/cm` | **`FlaskConical` · `text-ocean-500` / `bg-ocean-500/20`** |

- **`parameter === "EC"`가 정확한 필터 값이다.** `lib/thresholds.ts:119`의 `checkRecipe`가
  `parameter: "EC"`를 그대로 넣고, `Alert` 타입에 `parameter: string`이 있다
  (`types/index.ts:127`). **추가 조회 0회** — `alerts`는 이미 로드돼 있다.
- 아이콘은 진단 카드가 쓰던 `FlaskConical`을 **그대로 재사용**하되 색만
  purple → **ocean**으로 바꾼다. 새 아이콘 import가 없고, ocean은 이 앱에서 "양액·측정"의 색이다.
- 부제 `t.agri.ecDeviationSub` = **`베드 레시피 기준 이탈`** (무수치).
  > **구현 중 정정 (태양 리뷰 Y-1).** 이 시안은 `목표 ±0.10 mS/cm` 로 사업 KPI 를
  > 화면에 박자고 했으나, 카운트가 전 베드 합산이라 부제의 ±0.10 이 `ec_tolerance`
  > 가 다른 베드(시드 2번 = ±0.15)와 모순된다. §1 원칙 2("기준이 없으면 색을
  > 칠하지 않는다")와 같은 뿌리 — **없는 전역 기준을 문안으로 만들지 않는다.**
  > ko/en/vi/id 4개 언어 모두 무수치 문안으로 간다.
- 값이 `0`일 때 색을 바꾸지 않는다. StatCard는 원래 판정 색을 쓰지 않는다(§1 원칙 2).

### 4-4. 메인 차트 — EC 단독 + 목표 밴드 (164~172, 289~309행)

**수온·DO·pH 3선을 EC 1선으로 바꾼다.** 축 스케일이 다르다(EC 1850 vs pH 6) —
한 차트에 섞으면 pH 선이 바닥에 붙어 아무것도 안 보인다.

```tsx
// chartData (농업)
const chartData = wqData
  .filter((_, i) => i % 4 === 0).slice(-24)
  .map(r => ({
    time: new Date(r.recorded_at).toLocaleTimeString(localeStr, { hour: "2-digit", minute: "2-digit" }),
    EC: r.conductivity ?? null,          // µS/cm 그대로. y좌표는 언제나 µS/cm
  }))
```

- 높이 `220` 유지(새우와 같은 카드 크기). `<Legend>` **제거** — 단일 계열에 범례는 잡음이다.
- 선: `stroke="#0ea5e9"` (ocean/sky — 기존 온도선 색을 EC가 물려받는다), `strokeWidth={2}`,
  `dot={false}`, **`connectNulls`** (센서 결측 구간에서 선이 끊기지 않게).
- Y축 `width={45}` — 4자리(`1850`)가 잘리지 않게 새우의 `35`에서 넓힌다.
- **목표선·허용밴드**는 `/water-quality`의 `ConductivityChart` 패턴(개정 1 시안 5-2)을
  **그대로** 가져온다. 사용자가 이미 아는 문법이라 새로 배울 것이 없다.

```tsx
{target != null && (<>
  <ReferenceArea y1={target - tol} y2={target + tol} fill="#34d399" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
  <ReferenceLine y={target} stroke="#34d399" strokeDasharray="6 3" strokeOpacity={0.9}
    label={{ value: `${t.waterQualityX.targetLabel} ${(target / 1000).toFixed(2)}`, fill: "#34d399", fontSize: 11, position: "insideTopRight" }} />
  <ReferenceLine y={target + tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
  <ReferenceLine y={target - tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
</>)}
```

- `target`/`tol`은 **지금 선택된 베드**(`tanks.find(t => t.id === selectedTankId)`)의
  `target_ec`/`ec_tolerance`. 레시피가 없으면 **아무 선도 긋지 않는다**(§1 원칙 2).
- 툴팁 `formatter`: `` [`${v.toLocaleString()} µS/cm (${(v/1000).toFixed(2)} mS/cm)`, "EC"] `` —
  §2-5의 병기 규칙이 차트에서도 유지된다.
- 빈 상태(`chartData` 없음)는 기존 결 그대로. 아이콘만 `Droplets` 유지.

### 4-5. 최신값 타일 — 3개 → 4개, 판정 4종 (311~327행)

그리드를 `sm:grid-cols-3` → **`sm:grid-cols-2 lg:grid-cols-4`** 로. 4칸이 좁은 화면에서
2×2로 접힌다.

| # | 타일 | 값 | 아이콘 | 정상 판정 | 기준이 없을 때 |
|---|---|---|---|---|---|
| 1 | **EC** | `(conductivity/1000).toFixed(2)` `mS/cm` | `Zap`(신규) | `\|EC − target_ec\| ≤ ec_tolerance` → 정상 / `≤ 2×tol` → 주의 / 그 밖 위험 | **`기준 없음`** — 레시피 미설정 시 전역 EC 기준선을 긋지 않는다 |
| 2 | **pH** | `ph.toFixed(2)` | `Droplets` | 레시피 있으면 `\|pH − target_ph\| ≤ ph_tolerance` (2배 규칙 동일) | 레시피 없으면 `AGRI_QUALITY_STANDARDS.ph` (5.5~6.5 정상 / 5.0~7.0 주의) |
| 3 | **양액 온도** | `temperature.toFixed(1)` `°C` | `ThermometerSun` | `AGRI_QUALITY_STANDARDS.temperature` (18~24 정상 / 16~26 주의) | — |
| 4 | **유량** | `flow_rate.toFixed(1)` `L/min` | `Wind` | — | **언제나 `기준 없음`** (하한 알림은 로드맵) |

- 값이 `null` 또는 `0`이면 **모든 타일이 `미측정`**(중립) — 값 자리에 `—`.
  EC `0`은 "전극이 물 밖"이라는 뜻이지 "EC 0"이 아니다(`thresholds.ts:110` 주석과 같은 판단).
- 스타일은 §1-4 (b) 타일형 그대로. **3번째 줄에 상태 텍스트를 반드시 넣는다.**
- 시드 실측값(22.3 ℃, pH 5.88, DO 7.42) 기준으로 확인:
  양액 온도 22.3 → **정상**, pH 5.88 → **정상**. **빨간 타일 0개.** 이것이 합격선이다.

### 4-6. 우측 베드 목록 부제 (352행)

```tsx
{/* 농업: 레시피 요약 > 재배일수 > (둘 다 없으면 렌더 안 함) */}
{isAgri ? (
  tank.target_ec != null
    ? <p className="text-xs text-muted-foreground tabular-nums">EC {(tank.target_ec / 1000).toFixed(2)}</p>
    : tank.stocking_date
      ? <p className="text-xs text-muted-foreground">{t.farmsX.stockingDayN.replace("{{n}}", String(computeCycleDay(tank.stocking_date)))}</p>
      : null
) : <p className="text-xs text-muted-foreground">{tank.cycle_day}</p>}
```

`cycle_day === 0`일 때 `0`이라는 알맹이 없는 숫자가 뜨는 것을 막는다. 쓸 말이 없으면 안 쓴다.

### 4-7. 차압 추세 미니 카드 (신규) — 진단 카드가 있던 자리

`wqData`에 `diff_pressure`가 이미 있다. **추가 조회 0회.**
위치: 우측 패널, 날씨 카드 아래 (= 농업에서 숨긴 진단 카드 자리).

```
┌ 🔽 차압 추세 · 최근 24시간 ──────────────┐
│                                          │
│   15.2 kPa            ▲ 24시간 전 +3.1   │
│                                          │
│   ▁▂▂▃▃▄▅▆                                │
│                                          │
│   올라가는 추세입니다 —                    │
│   UV 살균기·필터 막힘을 점검해 보세요.      │
└──────────────────────────────────────────┘
```

```tsx
<Card className="bg-card border-border">
  <CardHeader className="pb-2">
    <CardTitle className="text-foreground text-base flex items-center gap-1.5">
      <Gauge className="w-4 h-4 text-rose-500" aria-hidden="true" />
      {t.agri.dpTrendTitle}
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-2">
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-2xl font-bold text-foreground tabular-nums">
        {last.toFixed(1)}<span className="text-sm font-semibold text-muted-foreground ml-1">kPa</span>
      </p>
      <p className={`text-xs tabular-nums ${rising ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
        {delta >= 0 ? "▲" : "▼"} {t.agri.dpDelta.replace("{{v}}", Math.abs(delta).toFixed(1))}
      </p>
    </div>
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={dpData}>
        <Line type="monotone" dataKey="dp" stroke="#f43f5e" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
    <p className="text-xs text-muted-foreground leading-relaxed">
      {rising ? t.agri.dpRisingHint : t.agri.dpSteadyHint}
    </p>
  </CardContent>
</Card>
```

- 색 `#f43f5e`(rose-500) — 개정 1 시안 5-4에서 차압 차트에 이미 배정한 색. 일관.
- 축·격자·툴팁 없음(스파크라인). `isAnimationActive={false}` — 1분마다 자동갱신되므로
  매번 다시 그려지는 애니메이션이 산만하다.
- **상승 판정(표시용 휴리스틱)**: 24h 창의 `마지막 3점 평균 − 첫 3점 평균`이
  `+2 kPa 이상` **이고** `+20% 이상`이면 `rising`.
  → **이 판정은 알림을 만들지 않는다.** 화면 문구만 바꾼다. 차압 절대 기준은 없고
  (§1 원칙 2), 두 조건 AND로 잡은 것은 오탐을 줄이기 위한 표시용 장치일 뿐이다.
  베드별 차압 상한 설정은 로드맵.
- 문안:
  - `agri.dpTrendTitle`: **`차압 추세 · 최근 24시간`**
  - `agri.dpDelta`: **`24시간 전 대비 {{v}} kPa`**
  - `agri.dpRisingHint`: **`올라가는 추세입니다 — UV 살균기·필터 막힘을 점검해 보세요.`**
  - `agri.dpSteadyHint`: **`특이한 변화가 없습니다.`**
  - `agri.dpNoData`: **`차압 데이터가 아직 없습니다.`** (데이터 0건이면 카드 대신 이 문구만)
- 데이터가 3점 미만이면 `rising` 판정을 하지 않고 값과 스파크라인만 보여준다.
- `Gauge`는 `lucide-react` 신규 import.

---

## 5. 【산출물 4】 베드 카드 · 요약 스트립

### 5-1. 베드 카드 (`farms-view.tsx:1449-1494`) — 분기 축은 `farm.farm_type`

이 화면은 URL이 아니라 **farm 데이터**로 가른다(`isAgriFarm`, 1429행). 혼합 계정이
새우 URL에서 농업 농장을 열어도 `0 마리`가 보이면 안 되기 때문이다.

| 위치 | 현재 | 농업 처리 |
|---|---|---|
| 1449~1454 재배일수 칩 | `stocking_date` 없으면 `cycle_day`(=0) → **`0일차`** | `isAgriFarm && !tank.stocking_date` 면 **칩 자체를 렌더하지 않는다.** 정식일이 있으면 `t.farmsX.stockingDayN` (agri-ko → `재배 {{n}}일차`). 새우 폴백 로직은 무변 |
| 1458~1463 용량 타일 | 용량 ㎥ | 무변 (라벨은 agri-ko `양액조 용량`) |
| 1464~1469 **밀도 타일** | `0 마리/㎥` | **베드 유형**으로 교체 — 값 `tank.tank_type`, 라벨 `t.agri.bedType`, 아이콘 `Layers` 유지 |
| 1470~1475 **입식 마리수 타일** | `0 마리` (`Fish` + `t.farmsX.shrimpCount`) | **렌더하지 않는다** (`!isAgriFarm &&`) |
| 1476~1483 입식일 타일 | `t.production.stockingDate` | 라벨 **정식일** (`t.agri.plantingDate`), 아이콘 `Calendar` → **`Sprout`** |
| 1484~1493 출하일 타일 | `t.farmsX.plannedHarvest` | 라벨 **수확 예정일** (`t.agri.harvestPlanDate`), 아이콘 `ShoppingCart` → **`Calendar`**. **지난 날짜 빨강 표시는 유지** — 농업에서도 유효한 신호다 |
| 1497~1511 레시피 요약 | 개정 1에서 추가됨 | 무변 |

**결과 (농업 베드 카드):**

```
┌ ● 1번 베드 (NFT-A)                    [정상] ┐
│  📈 재배 12일차                              │   ← 정식일 있을 때만
│  ┌ 💧 양액조 용량 ─┐┌ ▤ 베드 유형 ──┐        │
│  │ 1 ㎥            ││ 실내          │        │
│  └─────────────────┘└───────────────┘        │
│  ┌ 🌱 정식일 ──────┐┌ 📅 수확 예정일 ┐        │
│  │ 2026-08-07      ││ 2026-09-15    │        │
│  └─────────────────┘└───────────────┘        │
│  ⚗ EC 1.80 ±0.10 · pH 6.0 ±0.5              │
│  ─────────────────────────────────────       │
│  등록 2026-08-01                    ✎ 🗑     │
└──────────────────────────────────────────────┘
```

2열 그리드가 2×2로 정확히 채워진다. `0 마리`가 사라지고 그 자리에 **농가가 실제로
확인하는 값**(베드 유형·정식일)이 들어간다. `Sprout`은 `lucide-react` 신규 import.

### 5-2. 양액 관리 요약 스트립 (`water-quality-view.tsx:846-865`) — 분기 축은 `isAgri`

| 현재 (4개) | 농업 (최대 4개) |
|---|---|
| 재배일수 `0일차` | **재배일수** — `stocking_date`가 있을 때만. 없으면 항목째 렌더 안 함 |
| 수용량 `1㎥` | **양액조 용량** `1 ㎥` — agri-ko `waterQualityX.capacity: "양액조 용량"` |
| **입식수 `0 마리`** | → **정식일** `2026-08-07` (있을 때만) |
| **밀도 `0 마리/㎥`** | → **레시피** `EC 1.80 ±0.10 · pH 6.0 ±0.5` / 없으면 `레시피 미설정` |

- 마크업 구조(`flex flex-wrap` + `text-xs 라벨 / font-semibold 값`)는 **그대로**.
  항목 배열만 갈린다.
- 레시피 값은 `tabular-nums` + 앞에 `FlaskConical` 12px `text-ocean-600` —
  베드 카드 레시피 요약(1497~1511행)과 **같은 표기**여야 같은 것으로 읽힌다.
- 값이 하나도 없으면(신규 베드) 스트립 전체를 렌더하지 않는다. 빈 라벨 4개보다 낫다.

---

## 6. 【산출물 5】 항목별 상태 카드 농업판

`water-quality-view.tsx:960-988` · `isAgri === true` 일 때만. 아래 `ReadingCard` 그리드
(990~996행)도 같은 항목 배열을 쓴다.

### 6-1. 항목 6종 (새우 9종 → 농업 6종)

| # | key | 라벨 | 단위 | 아이콘 | 차트색 | 판정 근거 |
|---|---|---|---|---|---|---|
| 1 | `conductivity` | `EC` | `mS/cm` (표시) | `Zap` | `#0ea5e9` | **레시피만.** 없으면 `기준 없음` |
| 2 | `ph` | `pH` | — | `Droplets` | `#a78bfa` | 레시피 우선 → 없으면 `AGRI_QUALITY_STANDARDS.ph` |
| 3 | `temperature` | `t.waterQuality.temperature` (양액 온도) | `°C` | `Thermometer` | `#0ea5e9` | `AGRI_QUALITY_STANDARDS.temperature` |
| 4 | `do_level` | `DO` | `ppm` | `Wind` | `#14b8a6` | `AGRI_QUALITY_STANDARDS.do_level` |
| 5 | `flow_rate` | `t.waterQualityX.flowRate` | `L/min` | `Waves` | `#6366f1` | **없음** → 언제나 `기준 없음` |
| 6 | `diff_pressure` | `t.waterQualityX.diffPressure` | `kPa` | `Gauge` | `#f43f5e` | **없음** → 언제나 `기준 없음` |

- 색은 개정 1 시안 5-4에서 유량 `#6366f1` / 차압 `#f43f5e`로 이미 배정했다. 그대로.
- **염도·암모니아·아질산염·질산염·알칼리도·탁도는 카드에서 사라진다.** 폼에서 안 받으므로
  값이 항상 0이고, 0을 "정상"으로 칠하는 지금이 가장 나쁜 상태다.
- 그리드(992행): `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` (새우는 `lg:grid-cols-5 xl:grid-cols-9` 무변).
- EC는 `ReadingCard`에서도 **mS/cm로 표시**한다(`value/1000`, 소수 2자리). §2-5 규칙.

### 6-2. 배지 규칙

```
┌ 항목별 현재 양액 상태 ───────────────────────────────────────┐
│ (● EC · 1.85 mS/cm · 정상) (● pH · 6.02 · 정상)              │
│ (● 양액 온도 · 21.5 °C · 정상) (● DO · 7.4 ppm · 정상)        │
│ (○ 유량 · 12.0 L/min · 기준 없음) (○ 차압 · 15.2 kPa · 기준 없음) │
└──────────────────────────────────────────────────────────────┘
```

판정 우선순위 — **위에서부터 먼저 걸리는 것이 이긴다**:

> **개정(구현 시 수정됨 — `lib/agri-standards.ts`가 실제 기준)**
> 1. `0`은 항목마다 뜻이 다르다. `AGRI_ZERO_MEANING` 참조 — EC·pH·양액 온도·DO의
>    `0`만 미측정이고, **유량·차압의 `0`은 실측값**이다(nullable 컬럼이라 "안 쟀다"와
>    구별된다). 특히 **유량 0 = 펌프 정지 → `위험`**. 아래 1번은 그 예외를 담지 못한다.
> 2. `AGRI_QUALITY_STANDARDS`는 더 이상 손으로 적은 상수가 아니라
>    `AGRI_THRESHOLDS`(알림 기준)에서 파생된다. 표시와 알림이 어긋나
>    "빨간 카드 + 알림 없음"이 나오던 것을 막기 위해서다.

1. 값이 `null` 또는 `0` → **`미측정`** (중립, 값 자리 `—`)
2. 항목에 레시피 목표가 있다 (`EC`·`pH`) → `|v − target| ≤ tol` **정상**,
   `≤ 2×tol` **주의**, 그 밖 **위험** — `checkRecipe`(`thresholds.ts:102-147`)와 **같은 규칙**.
   화면 판정과 알림 판정이 어긋나면 농가는 둘 다 안 믿는다.
3. `AGRI_QUALITY_STANDARDS`에 기준이 있다 (`pH`·`양액 온도`·`DO`) → `min~max` **정상**,
   `warning_min~warning_max` **주의**, 그 밖 **위험**
4. 그 밖 (`EC` 레시피 없음, `유량`, `차압`) → **`기준 없음`** (중립)

- 배지 마크업은 §1-4 (a). `role="status"` + `aria-label`은 기존 975~976행 패턴 유지.
- 새우 경로(`PARAM_META` + `getStatus` + `STATUS_STYLES`)는 **한 줄도 건드리지 않는다.**
  농업은 `AGRI_PARAM_DEFS` + `getAgriStatus` + `AGRI_STATUS_STYLES`라는 별도 3종 세트를 탄다.

### 6-3. 덤 — 같은 파일의 나머지 두 곳

민준 5-B 10에 있는 항목이라 문안만 확정한다.

- **센서 비교 차트 항목(1064행)**: 농업이면 `["conductivity", "ph", "temperature", "do_level"]`.
  염도를 빼고 EC를 1순위로.
- **CSV 열(690~695행)**: 농업 열 순서·헤더 —
  `측정일시, EC(mS/cm), pH, 양액온도(°C), DO(ppm), 유량(L/min), 차압(kPa)`.
  **EC 열은 mS/cm로 내보낸다** — 농가가 엑셀에서 보는 숫자가 화면과 달라지면 안 된다(§2-5).
  파일명 접두사는 agri-ko `waterQualityX.csvFilePrefix: "양액데이터"`가 이미 처리한다.

---

## 7. 【산출물 7】 i18n — 신규 키 · agri-ko 오버라이드 · 하드코딩 추출

### 7-0. 두 사전을 나누는 규칙 (서연 필독)

| 무엇 | 어디에 | 왜 |
|---|---|---|
| **새로 생기는 라벨·문안** | `lib/i18n/{ko,en,vi,id}.ts`의 **`agri` 섹션** + `types.ts` | `agri` 섹션은 merge와 무관하게 항상 본 사전에서 읽힌다 → URL 분기 화면과 `farm_type` 분기 폼이 **같은 문자열**을 쓴다. 4개 언어 전부 채운다 |
| **기존 키의 뜻이 농업에서 달라짐** | `lib/i18n/agri-ko.ts` 오버라이드 | 새우 사전을 건드리지 않고 농업 모드에서만 덮는다 |
| **공유 화면의 하드코딩 문구** | 본 사전의 해당 섹션(`recordX`·`wizard`) + agri-ko 오버라이드 | 추출하지 않으면 농업 화면에 `수조`·`양식장`이 남는다 |

vi/id는 en 문안 복사로 시작한다(농업 오버라이드 사전 자체가 후속 과제 — 설계서 4-2).

### 7-1. 본 사전 신규 키 — `agri` 섹션 추가분

기존 `agri` 섹션(`ko.ts:1353-1399`) **끝에 이어 붙인다.** 기존 키는 손대지 않는다.

```ts
agri: {
  /* … 기존 키 (bedName ~ openShrimpScreen) 무변 … */

  // ── 측정 입력 폼 (수아 시안 §2) ──
  recordNotice:      "센서가 자동으로 기록하고 있습니다. 이 화면은 휴대용 측정기로 잰 값을 함께 남겨 센서와 대조하는 곳입니다.",
  recordEcTarget:    "이 베드 목표 {{target}} ±{{tol}} mS/cm",
  recordEcNoTarget:  "이 베드에 목표 EC가 없습니다 — 농장·기기 관리에서 레시피를 설정하면 여기에 목표가 표시됩니다.",
  recordEcSaveNote:  "{{v}} µS/cm 로 저장됩니다",
  recordPhTarget:    "이 베드 목표 {{target}} ±{{tol}}",
  recordPhNoTarget:  "엽채류 권장 5.5~6.5",
  recordTempHint:    "근권 권장 18~22 °C (칠러 가동 시)",
  recordDoHint:      "5 ppm 이상 권장",
  recordFlowHint:    "평소 유량과 크게 다르면 펌프·배관을 점검하세요.",
  recordDpHint:      "평소보다 오르면 UV 살균기·필터 막힘을 의심하세요.",

  // ── 일지 폼 (§3) ──
  journalStepNutrient:   "양액 관리",
  journalStepWork:       "재배 작업",
  nutrientType:          "양액 종류",
  nutrientRefill:        "양액 보충량",
  nutrientRefillHint:    "오늘 양액조에 새로 채운 양입니다.",
  refillTimes:           "보충 횟수",
  exchangeRate:          "양액 교환율",
  exchangeRateHint:      "전량 교환이면 100. 일부만 바꿨으면 바꾼 비율을 적습니다.",
  pestControl:           "방제 실시",
  pestAgent:             "약제명",
  pestAgentPlaceholder:  "약제 이름을 입력하세요",
  inputApplied:          "자재 투입",
  inputType:             "자재 종류",
  inputAmount:           "투입량",
  inputAmountHint:       "액상 자재는 L 단위로 적습니다 (1 L = 1 kg 로 봅니다).",
  checkPump:             "순환 펌프",
  checkFilterUv:         "필터·UV 살균기",
  checkChiller:          "근권 냉방 칠러",
  checkGrowth:           "생육 상태",
  journalNotesPlaceholder: "특이사항을 적어 주세요. 수확량도 여기에 적습니다.",

  // ── 상태 표현 (§1) ──
  statusNoStandard: "기준 없음",
  statusNotMeasured: "미측정",

  // ── 대시보드 (§4) ──
  ecDeviationLabel: "EC 이탈 알림",
  ecDeviationSub:   "목표 ±0.10 mS/cm",
  dpTrendTitle:     "차압 추세 · 최근 24시간",
  dpDelta:          "24시간 전 대비 {{v}} kPa",
  dpRisingHint:     "올라가는 추세입니다 — UV 살균기·필터 막힘을 점검해 보세요.",
  dpSteadyHint:     "특이한 변화가 없습니다.",
  dpNoData:         "차압 데이터가 아직 없습니다.",

  // ── 베드 카드 (§5) ──
  plantingDate:    "정식일",
  harvestPlanDate: "수확 예정일",
},
```

**영어 문안 (en.ts — vi/id는 이것을 복사)**

| 키 | en |
|---|---|
| `recordNotice` | `Sensors are logging automatically. Use this screen to record handheld meter readings so you can cross-check the sensors.` |
| `recordEcTarget` | `Bed target {{target}} ±{{tol}} mS/cm` |
| `recordEcNoTarget` | `No target EC for this bed — set a recipe in Farm & Devices to see it here.` |
| `recordEcSaveNote` | `Stored as {{v}} µS/cm` |
| `recordPhTarget` | `Bed target {{target}} ±{{tol}}` |
| `recordPhNoTarget` | `Leafy greens: 5.5–6.5` |
| `recordTempHint` | `Root zone: 18–22 °C (with chiller)` |
| `recordDoHint` | `5 ppm or above` |
| `recordFlowHint` | `A large change from normal flow means checking the pump and pipes.` |
| `recordDpHint` | `A rise above normal suggests a clogged UV unit or filter.` |
| `journalStepNutrient` | `Nutrient solution` |
| `journalStepWork` | `Crop work` |
| `nutrientType` | `Solution type` |
| `nutrientRefill` | `Solution added` |
| `nutrientRefillHint` | `Volume added to the tank today.` |
| `refillTimes` | `Top-ups` |
| `exchangeRate` | `Solution replaced` |
| `exchangeRateHint` | `Enter 100 for a full change, or the share replaced.` |
| `pestControl` | `Pest control done` |
| `pestAgent` | `Product name` |
| `pestAgentPlaceholder` | `Enter the product name` |
| `inputApplied` | `Input applied` |
| `inputType` | `Input type` |
| `inputAmount` | `Amount` |
| `inputAmountHint` | `Enter liquids in L (1 L counted as 1 kg).` |
| `checkPump` | `Circulation pump` |
| `checkFilterUv` | `Filter & UV unit` |
| `checkChiller` | `Root-zone chiller` |
| `checkGrowth` | `Crop condition` |
| `journalNotesPlaceholder` | `Anything notable. Record harvest here too.` |
| `statusNoStandard` | `No standard` |
| `statusNotMeasured` | `Not measured` |
| `ecDeviationLabel` | `EC deviations` |
| `ecDeviationSub` | `Target ±0.10 mS/cm` |
| `dpTrendTitle` | `Diff. pressure · last 24h` |
| `dpDelta` | `{{v}} kPa vs 24h ago` |
| `dpRisingHint` | `Trending up — check the UV unit and filter for clogging.` |
| `dpSteadyHint` | `No notable change.` |
| `dpNoData` | `No differential pressure data yet.` |
| `plantingDate` | `Planting date` |
| `harvestPlanDate` | `Expected harvest` |

### 7-2. 본 사전 신규 키 — 하드코딩 추출분

| 섹션 | 키 | ko | en | 대체 대상 |
|---|---|---|---|---|
| `wizard` | `tankLabel` | `수조 선택` | `Select tank` | `water-quality-record-view.tsx:98`, `journal-record-view.tsx:92` |
| `recordX` | `tankLoadFailed` | `수조 목록을 불러오지 못했습니다.` | `Could not load the tank list.` | `wq:140`, `journal:145` |
| `recordX` | `noTanksTitle` | `등록된 수조가 없습니다` | `No tanks registered` | `wq:158`, `journal:163` |
| `recordX` | `noTanksWqMsg` | `수질 기록을 시작하려면 먼저 양식장과 수조를 등록해 주세요.` | `Register a farm and a tank first to start logging water quality.` | `wq:159` |
| `recordX` | `noTanksJournalMsg` | `양식 일지를 작성하려면 먼저 양식장과 수조를 등록해 주세요.` | `Register a farm and a tank first to start your journal.` | `journal:164` |
| `recordX` | `registerFarmCta` | `양식장 등록하기` | `Register a farm` | `wq:166`, `journal:171` |
| `recordX` | `saveFailed` | `저장에 실패했습니다. 다시 시도해주세요.` | `Save failed. Please try again.` | `wq:90`, `journal:82` |

**재사용 (신규 키 만들지 말 것)**: `t.common.retry`(ko.ts:747 `다시 시도`),
`t.journalX.errInvalidNumber`(:824), `t.journalX.errOutOfRange`(:825).

> **태양에게 미리 알림 — 이것은 의도된 diff다.**
> 위 문구들은 지금 한국어로 하드코딩돼 있어 **en/vi/id 사용자에게도 한국어로 보인다.**
> 추출 후에는 각 언어로 번역돼 보인다. 한국어 새우 화면은 **글자 하나 안 바뀌지만**,
> 영어 새우 화면의 빈 상태 문구는 영어가 된다. 회귀가 아니라 버그 수정이다.

**추출하지 않는 것 — 새우 일지 폼의 스텝 라벨** (`journal-record-view.tsx:99-101, 107-108,
114-118, 125-129`). 민준 5-A 6에 목록으로 있지만 이번에는 **미루고 로드맵으로 넘긴다.**

근거 두 가지:
1. 태양의 합격 기준이 "**새우 분기 diff가 들여쓰기뿐**"이다. 라벨을 i18n으로 바꾸면
   그 기준에 걸린다 — 회귀 심사를 흐린다.
2. 농업 분기는 이 라벨들을 **하나도 쓰지 않는다**(§3-2에서 전부 `agri` 신규 키).
   즉 지금 추출하지 않아도 **농업 화면에 새우 문구가 남지 않는다.** 급하지 않다.

새우 폼 라벨의 i18n 추출은 새우 다국어 과제로 별도 커밋에서 한다.

### 7-3. `lib/i18n/agri-ko.ts` — 신규 섹션 3개

기존 오버라이드(`nav` ~ `onboarding`)는 **손대지 않고**, 아래 3개 섹션을 이어 붙인다.

```ts
  // ── 신규: 기록 허브 (record-hub-view.tsx:33,47) ──
  recordX: {
    waterQualityAria:  "측정 기록 입력하기",
    waterQualitySub:   "EC·pH·양액 온도 등",
    journalAria:       "영농 일지 입력하기",
    journalSub:        "양액 보충·교환·설비 점검 등",
    // 아래 4개는 §7-2에서 새로 추출한 키의 농업판
    tankLoadFailed:    "베드 목록을 불러오지 못했습니다.",
    noTanksTitle:      "등록된 베드가 없습니다",
    noTanksWqMsg:      "측정 기록을 시작하려면 먼저 농장과 베드를 등록해 주세요.",
    noTanksJournalMsg: "영농 일지를 쓰려면 먼저 농장과 베드를 등록해 주세요.",
    registerFarmCta:   "농장 등록하기",
    // saveFailed 는 농업에서도 같은 문장 — 오버라이드하지 않는다
  },

  // ── 신규: 일지 어휘 (ko.ts:793-877 중 뜻이 달라지는 키만) ──
  journalX: {
    // 설비 점검 체크리스트
    checkAeration:      "근권 냉방 칠러 점검",
    checkAerationDesc:  "칠러 가동 상태와 양액 온도 유지 확인",
    checkFiltration:    "필터·UV 살균기 점검",
    checkFiltrationDesc:"필터 청결 및 UV 램프 가동 상태 확인",
    checkFeeding:       "생육 상태 확인",
    checkFeedingDesc:   "잎 색·초장·뿌리 상태 확인",
    // checkCirculation / checkCirculationDesc — 문장이 그대로 통한다. 오버라이드하지 않는다.

    // 양액
    feed:               "양액",
    feedType:           "양액 종류",
    feedingTimes:       "보충 횟수",
    waterExchangeRate:  "양액 교환율",

    // 자재
    microbial:          "자재",
    microbialInput:     "자재 투입",
    microbialInputDesc: "미생물제·보충제 등 투입 여부",
    microbialType:      "자재 종류",
    // microbialDosed("투입") / microbialNone("미투입") — 그대로 통한다.

    // 방제
    disinfectionDo:              "방제 실시",
    disinfectionDesc:            "베드·배관 방제 여부",
    disinfectionMethod:          "방제 방법/약제",
    disinfectionMethodPlaceholder: "약제 이름을 입력하세요",

    // 탭·문구
    tabWater:           "측정값",
    tabOps:             "재배 작업",
    waterQualityHint:   "측정값을 직접 입력하세요. 센서 연동 시 자동으로 불러옵니다.",

    // 수조 → 베드
    highRiskTanks:      "고위험 베드",
    riskMsgLow:         "현재 모든 베드가 정상 범위입니다.",
    riskMsgMedium:      "일부 베드에서 주의가 필요합니다. 모니터링을 강화하세요.",
  },

  // ── 신규: 양액 관리 요약 스트립 (§5-2) ──
  waterQualityX: {
    /* … 기존 7개 키 무변 … */
    capacity: "양액조 용량",
  },
```

**의도적으로 오버라이드하지 않는 `journalX` 키 — 그리고 그 이유**

| 키 | 처리 | 이유 |
|---|---|---|
| `mortality`, `mortalityCount`, `unitFish` | **오버라이드 없음 + 렌더 차단** | 농업에 대응물이 없다. 그럴듯한 농업 라벨을 씌우면 나중에 누군가 그 라벨을 믿고 새 화면에서 `mortality_count`를 쓴다. **뜻 없는 컬럼은 뜻 없는 채로 감춘다.** 태양의 `rg "unitFish"` 검수는 **렌더 경로 차단**으로 통과시킨다 |
| `vibrioCount`, `pathogenicRatio`, `diag*`, `errVibrioRange`, `selectTestType` … | 오버라이드 없음 | 진단 카드·다이얼로그가 농업에서 통째로 숨겨진다(개정 1). 안 보이는 문구를 번역하지 않는다 |
| `stock`, `usageAmount`, `noStockDeduct` | 오버라이드 없음 | 재고 연동은 농업에서 항목이 비어 자연히 건너뛴다(`record-actions.ts:101-121`) |
| `checklistHint`, `countSuffix`, `loadMore`, `aria*`, `riskGrade` … | 오버라이드 없음 | 어휘가 중립이다. 안 바꿔도 정확하다 |

**규칙: 뜻이 실제로 달라지는 키만 덮는다.** 오버라이드 표가 길수록 새우 사전과
어긋날 지점이 늘어난다.

### 7-4. `types.ts`

- `agri` 섹션에 §7-1의 키를, `wizard`에 `tankLabel`, `recordX`에 §7-2의 6키를 추가.
- `DictOverride`(types.ts:1298)는 이미 2단 `Partial`이라 agri-ko의 신규 섹션 3개는
  **타입 변경 없이** 들어간다.
- **4개 언어 파일 전부 채운다.** 하나라도 빠지면 타입 에러다 (CLAUDE.md).

---

## 8. 서연 구현 체크리스트 (UI 관점)

민준 5-B의 커밋 3분할을 그대로 따르되, UI 관점에서 놓치기 쉬운 것만 적는다.

1. **`StepWizard`에 `notice?: string` 추가**(§2-3). 선택 prop이고 새우는 넘기지 않으므로
   렌더 결과가 완전히 같아야 한다. `Info` import 추가.
2. **`steps` 배열은 렌더마다 새로 만들어진다** — 힌트에 선택 베드의 레시피와 입력 중인
   값을 넣는 것이 가능한 이유다(§2-4). `useMemo`로 굳히지 말 것. 굳히면 힌트가 안 따라온다.
3. **EC 환산 지점이 4번째로 늘어난다**(§2-5). `× 1000` 하는 자리에 한국어 주석을 남길 것.
   기존 3곳: 레시피 폼 저장 / 목표선 라벨 / 양액 카드.
4. **`WQ_BOUNDS` 기존 9항목 값 변경 금지.** 추가만 —
   `conductivity` 0~20000 µS/cm, `flow_rate` 0~500 L/min, `diff_pressure` 0~500 kPa.
   농업 EC 에러 문구는 **mS/cm로 환산해서** 보여준다(§2-5 4번).
5. **상태 토큰은 §1-2 표를 그대로.** 새우 `STATUS_STYLES`(48~52행) 값은 한 글자도 금지.
   농업이 `-600 dark:-400`을 쓰는 것은 의도된 차이다(§1-3).
6. **중립은 색의 부재 + 속 빈 점 + 텍스트 3중 표기.** 셋 중 하나라도 빠지면 안 된다.
   `animate-pulse`를 중립에 붙이지 말 것.
7. `Repeat`(§3-4), `Sprout`(§5-1), `Gauge`(§4-7·§6-1), `Zap`(§4-5·§6-1), `Info`(§2-3) —
   `lucide-react` 신규 import 5종. 그 밖의 아이콘은 기존 것을 재사용한다.
8. **`AGRI_NUTRIENT_TYPES`·`AGRI_INPUT_TYPES` 신설**, `FEED_TYPES`·`MICROBIAL_TYPES`
   변경 금지. localStorage 키 분리(§3-3), 두 번째 인자 기본값 `false`.
9. **일지 다이얼로그의 "수질 측정" 탭**(`journal-view.tsx:1226-1235`)도 §2-2와 **같은 6항목**으로.
   두 입력 경로가 다른 항목을 받으면 데이터가 갈라진다. 441~443행 검증, 492~503행 저장 함께.
10. **`0 마리`가 화면에 남았는지 마지막에 눈으로 확인.** 렌더 경로 3곳:
    `farms-view.tsx:1470-1475`, `water-quality-view.tsx:857-863`, `journal-view.tsx:195-199`.
11. 대시보드 `getDiagnoses()`·`getInventoryItems()` **호출은 그대로 두고 렌더만 막는다**
    (민준 5-B 9). 조건부 호출로 바꾸면 `reload` 의존성이 갈라진다.
12. Recharts `ReferenceArea`·`ReferenceLine`을 `dashboard-view.tsx`에 import 추가(§4-4).
13. Next.js 16.2.4 — 전부 기존 클라이언트 컴포넌트 수정이라 서버/클라이언트 경계가
    새로 생기지 않는다. `"use client"` 유지. 라우트를 만지게 되면
    `node_modules/next/dist/docs/` 부터 읽을 것.

## 9. 이번 시안에서 의도적으로 하지 않은 것

| 항목 | 이유 | 어디로 |
|---|---|---|
| EC 전역 권장 범위 힌트 | 힌트 문구가 사실상의 전역 기준선이 된다(§2-4) | 베드별 레시피로 해결 |
| 유량·차압 절대 기준·배지 색 | 정상값이 베드마다 다르다. 지금은 표시만(§6-1) | 베드별 설정 (로드맵) |
| 일지 수확량 입력 칸 | `production` 테이블과 이중 관리(민준 3-2). 지금은 메모에 안내(§3-2) | `/daumlabs/production` 재설계 |
| 새우 일지 폼 라벨 i18n 추출 | 새우 diff 최소화가 우선. 농업 화면에 영향 없음(§7-2) | 새우 다국어 별도 커밋 |
| 새우 배지 대비 개선(`-500` → `-600`) | 회귀 0 원칙 | 접근성 별도 과제 |
| 입력 필드의 `tabular-nums` | `StepWizard` `Input`을 고치면 새우 폼 픽셀이 바뀐다 | 카드·타일·배지에서만 적용 |
| en/vi/id 농업 오버라이드 사전 | 설계서 4-2에서 후속으로 확정 | 로드맵 |
