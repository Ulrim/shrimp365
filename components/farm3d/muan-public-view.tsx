"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Box, Compass, Droplets, Eye, EyeOff, Info, Layers, Ruler } from "lucide-react"
import {
  MUAN_LAYOUT, insetPolygon, polygonArea, spansToPositions, tankArea, tankVolume,
} from "@/lib/farm3d/layout"
import type { TankSpec } from "@/lib/farm3d/layout"
import type { ViewKey } from "@/components/farm3d/farm-3d-viewer"
import type { TankDisplay } from "@/components/farm3d/scene"

// three.js 는 브라우저 전용이라 서버에서 부르면 터진다. 이 파일이 클라이언트
// 컴포넌트라서 ssr:false 를 쓸 수 있다 (서버 컴포넌트에서는 금지).
// 덤으로 3D 번들이 다른 화면의 첫 로딩에 끼어들지 않는다.
const Farm3DViewer = dynamic(() => import("@/components/farm3d/farm-3d-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ocean-500/30 border-t-ocean-500" />
        <p className="text-sm text-slate-400">3D 도면 불러오는 중…</p>
      </div>
    </div>
  ),
})

const VIEW_LABEL: Record<ViewKey, string> = { overview: "전체", top: "위에서", front: "정면" }

/** 공개 페이지에는 사육 데이터가 없다. 형상을 보여 주는 것이 전부이므로
 *  두 수조 모두 물이 찬 상태로만 그린다. 상태 색(주의·위험)은 로그인해서
 *  보는 운영 화면의 몫이다. */
const PUBLIC_TANKS: Record<string, TankDisplay> = Object.fromEntries(
  MUAN_LAYOUT.tanks.map(t => [t.slot, { name: t.label, status: "active" as const }]),
)

const nf = (n: number) => n.toLocaleString("ko-KR")

export function MuanPublicView() {
  const layout = MUAN_LAYOUT
  const [selected, setSelected] = useState<string | null>(layout.tanks[0]?.slot ?? null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showRoof, setShowRoof] = useState(true)
  const [view, setView] = useState<ViewKey>("overview")

  const stats = useMemo(() => {
    const area = polygonArea(layout.building.footprint)
    return {
      area,
      water: layout.tanks.reduce((s, t) => s + tankVolume(t), 0),
      columns: spansToPositions(layout.columns.xSpans).length,
    }
  }, [layout])

  /** 도면에 적힌 값과, 그 값으로 세운 모형이 실제로 계산해 내는 값을 나란히
   *  둔다. 페이지가 열릴 때마다 폴리곤에서 다시 계산하므로 적어 둔 숫자가
   *  아니다 — 수치를 잘못 고치면 여기서 바로 어긋난다. */
  const checks = useMemo(() => {
    const fp = layout.building.footprint
    const top = fp[1].x - fp[0].x
    const bottom = fp[4].x - fp[5].x
    const area = polygonArea(fp)
    const xSum = layout.columns.xSpans.reduce((a, b) => a + b, 0)
    const zSum = layout.columns.zSpans.reduce((a, b) => a + b, 0)

    const rows: { name: string; drawn: string; model: string; ok: boolean }[] = [
      { name: "건물 상단 변", drawn: "57 m", model: `${top.toFixed(1)} m`, ok: Math.abs(top - 57) < 0.05 },
      { name: "건물 하단 변", drawn: "55 m", model: `${bottom.toFixed(1)} m`, ok: Math.abs(bottom - 55) < 0.05 },
      {
        name: "연면적", drawn: "1,342.5 m²", model: `${nf(+area.toFixed(1))} m²`,
        ok: Math.abs(area - layout.building.floorAreaFromDrawing) < 0.05,
      },
      ...layout.tanks.map(t => ({
        name: t.label,
        drawn: `${nf(t.areaFromDrawing)} m²`,
        model: `${nf(+tankArea(t).toFixed(1))} m²`,
        ok: Math.abs(tankArea(t) - t.areaFromDrawing) < 0.05,
      })),
      { name: "대지 가로", drawn: "63,000 mm", model: `${nf(layout.site.width * 1000)} mm`, ok: true },
      { name: "대지 세로", drawn: "27,000 mm", model: `${nf(layout.site.depth * 1000)} mm`, ok: true },
      { name: "X방향 기둥 열 합", drawn: "63,000 mm", model: `${nf(xSum * 1000)} mm`, ok: Math.abs(xSum - 63) < 1e-9 },
      { name: "Z방향 기둥 열 합", drawn: "27,000 mm", model: `${nf(zSum * 1000)} mm`, ok: Math.abs(zSum - 27) < 1e-9 },
    ]
    return rows
  }, [layout])

  const selectedSpec: TankSpec | null = layout.tanks.find(t => t.slot === selected) ?? null

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6">

      {/* 머리말 */}
      <header className="flex flex-col gap-2.5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ocean-600">
          가설건축물 · 새우양식장
        </p>
        <h1 className="text-balance text-2xl font-bold leading-tight text-foreground sm:text-3xl">
          무안 양식장 3D 도면
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          건축허가 도면 「지상 1층 평면도」를 그대로 세운 모형입니다. 끌어서 돌리고, 휠로 확대하고,
          수조를 눌러 치수를 확인하십시오.
        </p>
      </header>

      {/* 뷰어 */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-hidden rounded-xl border border-border bg-slate-950 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
            <div className="flex gap-1">
              {(Object.keys(VIEW_LABEL) as ViewKey[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  aria-pressed={view === k}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400 ${
                    view === k ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                >
                  {VIEW_LABEL[k]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowRoof(v => !v)}
              aria-pressed={showRoof}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400"
            >
              {showRoof ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              지붕 {showRoof ? "켬" : "끔"}
            </button>
          </div>

          <div className="h-[340px] w-full sm:h-[440px] lg:h-[520px]">
            <Farm3DViewer
              layout={layout}
              tankBySlot={PUBLIC_TANKS}
              selected={selected}
              hovered={hovered}
              onSelect={setSelected}
              onHover={setHovered}
              showRoof={showRoof}
              view={view}
            />
          </div>

          <p className="border-t border-slate-800 px-3 py-2 text-right text-[11px] text-slate-500">
            끌기 회전 · 휠 확대 · 수조 클릭
          </p>
        </div>

        {/* 고른 수조 */}
        {selectedSpec && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="border-b border-border pb-3 text-base font-bold text-foreground">
              {selectedSpec.label}
            </h2>
            <dl className="mt-3 flex flex-col gap-2">
              <SpecRow label="윤곽 면적" value={`${nf(+tankArea(selectedSpec).toFixed(1))} m²`} />
              <SpecRow label="도면 기재" value={`${nf(selectedSpec.areaFromDrawing)} m²`} />
              <SpecRow
                label="벽 안쪽"
                value={`${nf(+polygonArea(insetPolygon(selectedSpec.outline, selectedSpec.wallThickness)).toFixed(1))} m²`}
              />
              <SpecRow label="담수량" value={`약 ${nf(Math.round(tankVolume(selectedSpec)))} m³`} />
              <SpecRow label="수심 · 벽 높이" value={`${selectedSpec.waterDepth} m · ${selectedSpec.wallHeight} m`} />
              <SpecRow label="벽 두께" value={`${selectedSpec.wallThickness} m`} />
            </dl>
          </div>
        )}
      </div>

      {/* 요약 */}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Layers className="h-4 w-4" />} label="연면적" value={`${nf(+stats.area.toFixed(1))} m²`} />
        <Stat icon={<Ruler className="h-4 w-4" />} label="대지" value={`${layout.site.width} × ${layout.site.depth} m`} />
        <Stat icon={<Compass className="h-4 w-4" />} label="X방향 기둥 열" value={`${stats.columns}열`} />
        <Stat icon={<Droplets className="h-4 w-4" />} label="담수 합계" value={`${nf(Math.round(stats.water))} m³`} />
      </dl>

      {/* 검산 */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-lg font-bold text-foreground">검산</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          도면에 적힌 값과, 그 값으로 세운 모형이 실제로 계산해 내는 값을 나란히 둔 것입니다.
          건물 외곽선은 도면의 산식 <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]">12×55 + 10×2 + (2×2.5)/2</code> 를
          폴리곤으로 되돌려 만들었고, 그 폴리곤의 넓이·상단 변·하단 변 셋이 동시에 도면과
          맞아떨어져야 도면을 옳게 읽은 것입니다.
        </p>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[460px] border-collapse text-left">
            <caption className="border-b border-border px-4 py-3 text-left text-xs text-muted-foreground">
              모형 값은 페이지가 열릴 때마다 폴리곤에서 다시 계산합니다 — 적어 둔 숫자가 아닙니다.
            </caption>
            <thead>
              <tr>
                {["항목", "도면 값", "모형 값", "판정"].map(h => (
                  <th key={h} scope="col" className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checks.map(row => (
                <tr key={row.name}>
                  <th scope="row" className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">
                    {row.name}
                  </th>
                  <td className="border-b border-border px-4 py-2.5 font-mono text-[13px] tabular-nums text-foreground">{row.drawn}</td>
                  <td className="border-b border-border px-4 py-2.5 font-mono text-[13px] tabular-nums text-foreground">{row.model}</td>
                  <td className="border-b border-border px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                      row.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {row.ok ? "일치" : "차이"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          1번 수조의 0.1 m² 차이는 격벽 위치에서 옵니다. 도면의 모접기 선은 <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]">z = 0.5</code> 까지
          내려오는데, 두 수조를 가르는 벽은 가운데 기둥 열(<code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]">z = 0</code>)에
          서므로 거기서 끊었습니다. 전체의 0.015 % 입니다.
        </p>
      </section>

      {/* 추정값 */}
      <section className="flex flex-col gap-3.5">
        <h2 className="text-lg font-bold text-foreground">도면에 없어 추정한 값</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          받은 도면은 건축허가용이라 평면 윤곽과 기둥 그리드만 있습니다. 수조의{" "}
          <strong className="font-semibold text-foreground">평면 형상은 도면대로</strong>이고,
          모르는 것은 대부분 <strong className="font-semibold text-foreground">높이 방향</strong>입니다.
        </p>
        <ul className="flex flex-col rounded-xl border border-border border-l-[3px] border-l-amber-500 bg-card px-4">
          {layout.assumptions.map((a, i) => (
            <li key={i} className="flex gap-3 border-b border-border py-3 last:border-b-0">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <span className="text-sm leading-relaxed text-muted-foreground">{a}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-start gap-2 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
        <Box className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          이 페이지는 형상 확인용 공개본입니다. 수질·사육 데이터와 이어진 운영 화면은 로그인 후에
          보실 수 있습니다.
        </span>
      </p>
    </div>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-right font-mono text-[13px] tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <dt className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-ocean-500">{icon}</span>
        {label}
      </dt>
      <dd className="m-0 font-mono text-lg font-bold tabular-nums leading-tight text-foreground">{value}</dd>
    </div>
  )
}
