# DailyWork → Farm365 현장관리 UI 대응표 (수아)

- 대상 독자: 화면을 옮기는 서연 3명. **이 표만 보고 기계적으로 바꾼다.** 표에 없는 색 이름을 새로 만들지 않는다.
- 상위 문서: 이식 계약서 4절. 원본: `Ulrim/DailyWork` `src/**`(라이트 전용, 딥그린 `brand-50..950` + `gray-NNN` + `bg-white`).
- 이미 만들어진 것: `components/work/ui/{badge,button,card,dialog,form,misc}.tsx`, `components/work/layout/{work-nav,project-switcher,nav-icon}.tsx`, `app/globals.css` 끝의 "현장관리" 블록(`dw-*`, `no-print`, `print-plain`, `avoid-break`).

## 0. 다섯 줄 요약

1. 회색·흰색은 전부 시맨틱 토큰으로: `bg-white`→`bg-card`, `text-gray-9/8/7`→`text-foreground`, `text-gray-6/5/4`→`text-muted-foreground`, `border-gray-*`·`divide-gray-*`→`border-border`·`divide-border`, `hover:bg-gray-*`→`hover:bg-accent`.
2. `brand-NNN` 숫자 단계는 없다: 채운 면 `bg-brand`(+`hover:bg-brand-hover`), 글자 `text-brand-fg`, 틴트 `bg-brand-a10`, 테두리 `border-brand-a25`(진한 것은 `border-brand`).
3. 상태색(빨강·앰버·파랑·초록·보라·회색)의 **옅은 바탕+글자**는 `dw-tone-X`, **글자만**은 `dw-fg-X`. `dark:` 변형을 손으로 쓰지 않는다. 진한 막대·점(`bg-red-500` 등)은 그대로 둔다.
4. 인쇄 문서는 `Doc`(= `dw-paper`) 안에만 그린다. 그 안에서도 같은 토큰을 쓰면 되고, 다크 모드와 무관하게 흰 바탕·검은 글자가 된다.
5. 셸과 맞물리는 중단점은 `md:`가 아니라 `lg:`다(shrimp365 사이드바·하단 내비가 `lg` 기준). 화면 아래에 고정하는 것은 `bottom-[calc(4rem+env(safe-area-inset-bottom))]` 위로.

## 1. 래퍼 — `dw-root`

`(app)/layout.tsx` 와 `not-invited/page.tsx` 는 본문 전체를 이 래퍼로 감싼다.

```tsx
<div className="dw-root mx-auto w-full max-w-6xl pb-14 lg:pb-0 print:max-w-none print:pb-0">
  <WorkNav … />
  {children}
</div>
```

- `dw-root` 가 하는 일: 숫자 등폭(`tabular-nums`, 원본 body 의 `tnum`), 포커스 외곽선(원본 `:focus-visible`), 브랜드 틴트(`brand-a*`)를 녹색으로 다시 계산, 다크에서 네이티브 select 목록 색. **래퍼가 없으면 틴트가 파랗게 나온다.**
- `pb-14`: 모바일 플로팅 "일보 작성" 버튼이 마지막 줄을 가리지 않게 하는 여백. 셸 `<main>` 의 `pb-24` 에 더해진다.
- 원본 `<main>` 의 `max-w-6xl`·여백 클래스는 옮기지 않는다(위 래퍼와 셸이 대신한다).
- 다이얼로그는 body 포털이라 래퍼 밖이다 — `components/work/ui/dialog.tsx` 가 스스로 `dw-root` 와 `data-mode="agriculture"` 를 붙인다. **Radix 포털을 직접 쓰지 말고 이 `DialogContent` 만 쓴다.**

## 2. 표면·글자·테두리

| 원본 | 이식 |
|---|---|
| `bg-white` | `bg-card` |
| `bg-white/95` | `bg-card/95` |
| `bg-gray-50`, `bg-gray-100` (표 머리·칩·비활성 면) | `bg-muted` |
| `bg-gray-50/70` (달력의 다른 달 칸) | `bg-muted/50` |
| `bg-gray-200` (진행 막대 바탕) | `bg-border` |
| `bg-gray-300` (간트 계획 막대, 읽은 알림 점, 세로 구분선) | `bg-muted-foreground/40` |
| `bg-gray-400` (회색 점·막대) | `bg-muted-foreground` |
| `bg-gray-900`, `bg-gray-900/80` (오늘 선·계획 표시선) | `bg-foreground`, `bg-foreground/80` |
| `bg-gray-100` (간트 월 눈금선 `w-px`) | `bg-border` |
| `text-gray-900`, `text-gray-800`, `text-gray-700` | `text-foreground` |
| `text-gray-600`, `text-gray-500`, `text-gray-400` | `text-muted-foreground` |
| `placeholder:text-gray-400` | `placeholder:text-muted-foreground` |
| `border-gray-100`, `border-gray-200`, `border-gray-300` | `border-border` (입력 컨트롤은 `border-input`) |
| `border-gray-900` (문서 제목 밑줄) | `border-foreground` |
| `divide-gray-100`, `divide-gray-200` | `divide-border` |
| `hover:bg-gray-50`, `hover:bg-gray-100` | `hover:bg-accent` |
| `ring-gray-200` | `ring-border` |
| `ring-white` (점 둘레 띠) | `ring-card` |
| `disabled:bg-gray-100 disabled:text-gray-500` | `disabled:bg-muted disabled:text-muted-foreground` |
| `shadow-xs`, `shadow-lg`, `shadow-xl`, `rounded-*` | 그대로 |
| `bg-black/40` (오버레이) | 그대로 |
| `text-white` (채운 브랜드·빨강 면 위) | 그대로 |

예외: `text-gray-700` 가 "값", `text-gray-500` 가 "라벨"로 나란히 쓰인 곳도 위 표대로 하면 `foreground`/`muted-foreground` 로 갈려 위계가 유지된다. 따로 판단할 것 없다.

## 3. 브랜드

| 원본 | 이식 |
|---|---|
| `bg-brand-700` (주 버튼·활성 칩·오늘 날짜 원) | `bg-brand` |
| `hover:bg-brand-800`, `active:bg-brand-800`, `active:bg-brand-900` | `hover:bg-brand-hover`, `active:bg-brand-hover` |
| `bg-brand-800`, `bg-brand-900` | `bg-brand` |
| `bg-brand-500`, `bg-brand-600` (막대·점) | `bg-brand` |
| `bg-brand-50` | `bg-brand-a10` |
| `bg-brand-50/60` (안 읽은 알림 행) | `bg-brand-a5` |
| `bg-brand-100`, `hover:bg-brand-100` | `bg-brand-a20`, `hover:bg-brand-a20` |
| `text-brand-700`, `text-brand-800` | `text-brand-fg` |
| `border-brand-200`, `border-brand-300` | `border-brand-a25` |
| `hover:border-brand-300` | `hover:border-brand-a40` |
| `border-brand-700` (활성 칩 테두리, 문서 절 제목 왼쪽 띠) | `border-brand` |
| `ring-brand-500` (달력 선택 칸) | `ring-brand` |
| `focus:border-brand-500`, `focus:ring-brand-500/20` | `focus:border-brand`, `focus:ring-brand-a20` |
| `accent-brand-700` (체크박스·range) | `accent-brand` |

- 글자에는 `text-brand` 가 아니라 **`text-brand-fg`**. 다크에서 밝은 녹색으로 올라가는 쪽은 `-fg` 뿐이다.
- 틴트에 `bg-brand/10` 같은 `/숫자` 수식어를 쓰지 않는다. `brand-a4·a5·a10·a20·a25·a30·a40·a50` 중에서 고른다(`app/globals.css` 머리 주석).
- 활성/비활성 칩(달력·작업일보·업무·보고서의 필터): `border-brand bg-brand text-white` / `border-border bg-card text-foreground`.

## 4. 상태색

옅은 면과 글자는 `app/globals.css` 의 `dw-*` 클래스가 라이트·다크 값을 함께 가진다. 이름은 원본 `Tone` 과 같다: `gray | green | blue | amber | red | purple`.

| 원본 | 이식 |
|---|---|
| `bg-red-50 text-red-700` (칩·안내) | `dw-tone-red` |
| `bg-amber-50 text-amber-800/900` | `dw-tone-amber` |
| `bg-sky-50 text-sky-800` | `dw-tone-blue` |
| `bg-emerald-50 text-emerald-800` | `dw-tone-green` |
| `bg-violet-50 text-violet-800` | `dw-tone-purple` |
| `bg-gray-100 text-gray-700` (**상태 칩으로 쓸 때만**) | `dw-tone-gray` |
| 위에 `border border-X-200` 가 붙은 안내 상자 | `border dw-tone-X dw-line` |
| 위에 `ring-1 ring-inset ring-X-200` | `dw-tone-X dw-ring` |
| `text-red-600`, `text-red-700` | `dw-fg-red` |
| `text-amber-700` | `dw-fg-amber` |
| `text-sky-700` | `dw-fg-blue` |
| `text-emerald-700` | `dw-fg-green` |
| `bg-red-50/60` (지연 행·간트 지연 트랙) | `bg-red-500/10` |
| `hover:bg-red-50` | `hover:bg-red-500/10` |
| `border-red-300` + `text-red-700` | `border dw-fg-red dw-line` |
| `bg-red-500`, `bg-amber-500`, `bg-sky-500`, `bg-emerald-500`, `bg-violet-500` (점·막대) | 그대로 |
| `bg-red-600 text-white`, `hover:bg-red-700` (삭제 버튼·건수 배지) | 그대로 |
| `bg-amber-400 text-brand-950` (원본 사이드바 건수) | 쓰지 않는다 — 건수 배지는 `WorkNav` 가 그린다 |

값(참고): 라이트는 원본 그대로 50 바탕 / 700~800 글자 / 200 선. 다크는 500 계열 15% 바탕 / 300 글자 / 500 계열 35~40% 선.

- **`dw-tone-*`·`dw-fg-*` 가 있는 요소에는 `text-*`·`bg-*` 색 유틸리티를 같이 쓰지 않는다.** `dw-*` 는 레이어 밖이라 항상 이긴다. 그래서 `<Button variant="ghost" className="dw-fg-red">` 처럼 변형 위에 덧씌우는 것은 뜻대로 된다(원본의 `className="text-red-600"` 자리).
- `hover:`·`md:` 같은 변형을 `dw-*` 앞에 붙일 수 없다(일반 CSS 클래스다). 조건은 원본처럼 `cn(cond && "dw-fg-red")` 로 건다.
- 조건부 글자색은 양쪽을 다 바꾼다: `late ? "font-semibold text-red-700" : "text-gray-500"` → `late ? "font-semibold dw-fg-red" : "text-muted-foreground"`.

### 화면별로 한 번씩 나오는 것

| 곳 | 원본 | 이식 |
|---|---|---|
| 달력 `DOT` 맵 | `gray: "bg-gray-400"`, 나머지 `bg-X-500` | `gray: "bg-muted-foreground"`, 나머지 그대로 |
| 달력 `CHIP` 맵 | `bg-X-50 text-X-800` 6종 | `dw-tone-gray/green/blue/amber/red/purple` |
| 달력 요일·날짜 | 토 `text-sky-700`, 일 `text-red-600`, 다른 달 `text-gray-400` | `dw-fg-blue`, `dw-fg-red`, `text-muted-foreground/60` |
| 달력 선택 칸 | `bg-brand-50 ring-2 ring-inset ring-brand-500` | `bg-brand-a10 ring-2 ring-inset ring-brand` |
| 간트 범례·막대 | 계획 `bg-gray-300` / 실적 `bg-brand-600` / 지연 `bg-red-500` / 오늘 `bg-gray-900` | `bg-muted-foreground/40` / `bg-brand` / `bg-red-500` / `bg-foreground` |
| 간트 고정 열(sticky) | `bg-white`, 머리 `bg-gray-50` | `bg-card`, `bg-muted` (반투명 금지 — 뒤 막대가 비친다) |
| 공정률·업무 진행 막대 | `ProgressBar` | 그대로 호출(`tone="brand" \| "red" \| "gray"`) |
| `StatCard` 수치 | `default/alert/warn/good` = `text-gray-900/red-700/amber-700/brand-700` | `text-foreground` / `dw-fg-red` / `dw-fg-amber` / `text-brand-fg` |
| 검토함 집계 | `text-sky-700`, `text-emerald-700`, `text-red-600` | `dw-fg-blue`, `dw-fg-green`, `dw-fg-red` |
| 알림 점 | 안 읽음 `bg-red-500` / 읽음 `bg-gray-300` | `bg-red-500` / `bg-muted-foreground/40` |

큰 수치(`text-2xl` 이상: `StatCard` 값, 대시보드 실적 %, 공정 관리 KPI)에는 `font-mono` 를 더한다 — Farm365 홈 요약 숫자와 같은 결. 그 밖의 숫자는 `dw-root` 의 등폭 숫자로 충분하다.

## 5. 인쇄 문서 — `dw-paper`

보고서(`outputs`)와 통합일보(`consolidated`)의 문서 본문은 둘 다 `components/work/outputs/doc.tsx` 의 `Doc` 을 거친다. **`Doc` 한 곳에만 `dw-paper` 를 붙인다.**

```tsx
<article className="dw-paper print-plain rounded-xl border border-border p-4 shadow-xs md:p-8">{children}</article>
```

- `dw-paper` 안에서는 시맨틱 토큰이 라이트 값으로 되돌아간다. 문서 조각(`DocTitle`, `DocSection`, `DocTable`, `Td`, `StatGrid`, `NoteList`)과 페이지의 문서 내용은 **2~4장 표대로 똑같이** 바꾸면 된다. 따로 흰색·검은색을 하드코딩하지 않는다.
- `dw-paper` 안에서 금지: `dark:` 변형(끌 수 없다), `bg-card/NN` 같은 반투명 면.
- `Badge`·`dw-tone-*`·`dw-fg-*` 는 문서 안에서 자동으로 라이트 값이다.
- 문서 안 표 괘선 `border-gray-300` → `border-border` (문서 안의 `--border` 는 더 진하게 잡혀 있다).
- `DocTitle` 의 `CULIVER` 글자 `text-brand-700` → `text-brand-fg`. 절 제목 `border-l-4 border-brand-700` → `border-brand`.
- 문서 밖의 것(페이지 머리, 종류 탭, 날짜·기간 폼, 관리 폼)은 원본대로 `no-print`.
- `print:overflow-visible`, `print:!min-w-0`, `print:text-[11px]`, `print:grid-cols-3` 는 그대로 둔다.

## 6. `globals.css` — 무엇을 어디로

| 원본 규칙 | 처리 |
|---|---|
| `@theme` 의 `--font-sans`, body `font-family` | 옮기지 않는다. shrimp365 body 가 이미 Pretendard 다 |
| `@theme` 의 `--color-brand-50..950` | 옮기지 않는다. 3장 표로 대체 |
| body `background: #f5f6f5`, `color: #1f2937` | 옮기지 않는다. 셸의 `bg-background`·`text-foreground` |
| body `font-feature-settings: "tnum"` | `.dw-root { font-variant-numeric: tabular-nums }` |
| body `-webkit-tap-highlight-color` | `.dw-root` |
| `html { -webkit-text-size-adjust }`, `-webkit-font-smoothing` | 옮기지 않는다 |
| `:focus-visible { outline … }` | `.dw-root :focus-visible { outline: 2px solid var(--brand-fg) }` (구역 한정) |
| print `@page { A4; 12mm }`, body 흰 바탕 | 이미 있다(기존 인쇄 블록) |
| print body `font-size: 11px` | `.dw-paper` 에만 |
| `.no-print`, `.print-plain`, `.avoid-break` | 같은 이름으로 추가했다. 그대로 쓴다 |

기존 인쇄 블록이 이미 하는 일(다시 쓰지 말 것): `main` 여백 제거, `overflow-*` 해제, `.fixed` 숨김(플로팅 버튼·저장 막대·다이얼로그가 인쇄에서 빠진다), 셸(사이드바·헤더·하단 내비) 숨김.

## 7. 페이지 머리

- 모든 페이지는 `PageHeader`(`components/work/ui/misc.tsx`)로 시작한다. props 는 원본 그대로 `title`, `description?`, `action?`.
- 배치: 제목 왼쪽(`text-xl sm:text-2xl font-bold`), 설명 그 아래(`text-sm text-muted-foreground`), 액션 오른쪽 아래 정렬. 640px 미만에서는 액션이 제목 아래 줄로 내려온다. Farm365 `AgriPageHeader` 와 같은 자리·크기다.
- 페이지에서 `h1` 을 직접 쓰지 않는다. 예외 둘: 문서 안의 `DocTitle`(문서 제목), 작업일보 상세처럼 뒤로 가기 링크가 제목 왼쪽에 붙는 머리 — 이때 `h1` 클래스는 `text-xl font-bold tracking-tight text-foreground sm:text-2xl`, 뒤로 가기는 `flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent`.
- "일보 작성" 진입은 `WorkNav` 가 가진다. 페이지 머리 액션에 같은 버튼을 또 두지 않는다(대시보드의 "오늘 작업일보" 카드는 상태를 보여 주는 카드라 유지).
- `PageHeader` 를 감싼 `<div className="no-print">`(보고서·통합일보)는 그대로 둔다.
- 카드 안 "전체 보기" 링크: `text-xs font-medium text-brand-fg hover:underline`.

## 8. 모바일·중단점

shrimp365 셸: 하단 내비는 `lg` 미만에서 `fixed bottom-0 h-16 z-40`, 사이드바는 `lg` 이상. `<main>` 은 `p-4 pb-24 lg:p-6`.

| 대상 | 규칙 |
|---|---|
| 플로팅 "일보 작성" | `WorkNav` 가 그린다. `fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-30 lg:hidden`. 작성·수정 화면(`/reports/new`, `/reports/<id>/edit`)에서는 숨는다. 페이지에서 다시 만들지 않는다 |
| 작업일보 폼의 저장 막대 (`report-form.tsx`) | `fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0` — 원본의 `md:` 를 `lg:` 로, `z-20` 을 `z-30` 으로 |
| 저장 막대가 가리는 폼 끝 | 폼에 `pb-28 lg:pb-0` |
| 그 밖에 화면 아래 고정하는 것 | 만들지 않는다. 꼭 필요하면 위 `bottom-[calc(4rem+…)]`, `z-30` 이하, `lg:static` |
| z-index | 페이지 안 고정 요소는 `z-30` 이하(셸 하단 내비 `z-40`, 시트·다이얼로그 `z-50`) |
| 레이아웃용 `md:`·`sm:` (그리드 열 수, `md:px-5`, 달력의 점↔제목 전환) | 그대로 |
| 원본 `<main>`/레이아웃의 `md:pl-60`, `pb-28`, `md:pb-10` | 옮기지 않는다 |
| 터치 대상 | 44px(`h-11`/`size-11`) 유지. 원본 `Button` 크기가 이미 그렇다 |

## 9. 공통 컴포넌트 — import 만 바꾼다

`@/components/ui/*` → `@/components/work/ui/*`. export 이름·props·variant 는 원본과 같다.

| 파일 | export |
|---|---|
| `badge.tsx` | `Badge`(`tone`), `StatusBadge`(`map`, `value`) |
| `button.tsx` | `Button`(`variant`: primary·secondary·outline·ghost·danger·dangerOutline / `size`: sm·md·lg·icon / `asChild`), `ButtonProps` |
| `card.tsx` | `Card`, `CardHeader`(`title`, `description?`, `action?`), `CardBody` |
| `dialog.tsx` (`"use client"`) | `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`(`title`, `description?`) |
| `form.tsx` | `Input`, `Textarea`, `Select`, `Label`, `Field`, `FormError`, `FormNotice` |
| `misc.tsx` | `PageHeader`, `EmptyState`, `ProgressBar`, `formatPercent`, `DefinitionList` |

`Card` 에 색을 덧씌울 때: `className="border-brand-a25 bg-brand-a10"`(대시보드의 "오늘 작업일보" 카드) — `cn` 이 기본 `bg-card` 를 걷어 낸다.

## 10. 서브 내비 `WorkNav`

```tsx
<WorkNav items={navFor(session.role)} counts={counts} projects={…} currentProjectId={session.project?.id ?? null} canWrite={!!session.role} />
```

- `counts` 의 키는 `item.href` 와 같은 전체 경로(`/farm365/work/notifications`, `/farm365/work/reviews`).
- 1행: 사업장(2곳 이상이면 셀렉트 → 서버 액션 `selectProject`), `lg` 이상에서 오른쪽 "일보 작성".
- 2행: 그룹(업무 / 공정·보고 / 관리)을 세로선으로 가른 알약 탭. `lg` 미만은 가로 스크롤(활성 탭 자동 가운데 정렬), `lg` 이상은 줄바꿈. 활성 `bg-brand-a10 text-brand-fg`.
- 인쇄에서 숨는다(`no-print print:hidden`).
- 원본 `menu` 페이지(모바일 전체 메뉴)와 Topbar 의 알림 종·이름·로그아웃은 없다. 알림은 탭의 건수 배지로, 계정은 셸이 맡는다.

## 11. 옮긴 뒤 스스로 확인

- `gray-`, `brand-[0-9]`, `bg-white`, `dark:` 를 `app/(dashboard)/farm365/work`·`components/work` 에서 검색해 0건인지.
- `md:static`, `md:hidden`·`hidden md:flex` 가 **셸 유무**를 가르는 용도로 남아 있지 않은지(8장).
- `Doc` 밖에 인쇄돼야 할 내용이 없는지, `Doc` 안에 `no-print` 가 아닌 버튼·폼이 없는지.
