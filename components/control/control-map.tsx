"use client"

import { useEffect, useRef, useState } from "react"
import type { LayerGroup, Map as LeafletMap } from "leaflet"
import "leaflet/dist/leaflet.css"

export type FarmType = "shrimp" | "agriculture"

export type ControlFarm = {
  id: string
  name: string
  owner: string
  location: string
  farm_type: FarmType
  // 서버가 3단계(농가 입력 → 장비 평균 → 주소 지오코딩)로 채운 좌표.
  latitude: number | null
  longitude: number | null
  coord_source: "farm" | "device" | "address" | null
  coord_precision?: "address" | "region"
  has_sensor: boolean   // active 수질센서가 1대 이상
  tanks: number
  danger: number
  warning: number
  devices: number
  offline: number
  // 대표 수조(가장 급한 수조) 1개의 최신 수질 — 지도 위에 바로 보여 준다.
  rep_tank?: string | null
  wq?: {
    temperature: number | null; ph: number | null
    do_level: number | null; salinity: number | null; recorded_at: string
  } | null
}

/** 측정 시각을 "n분 전" 으로. 관제 화면은 한국어 전용이다. */
function agoLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "방금 전"
  if (mins < 60) return `${mins}분 전`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

/** 지도 위에 상시 표시할 요약(수온·DO). 숫자는 코드가 만드는 값이라 안전하다. */
function wqSummary(f: ControlFarm): string | null {
  const w = f.wq
  if (!w) return null
  const parts: string[] = []
  if (typeof w.temperature === "number") parts.push(`${w.temperature.toFixed(1)}°C`)
  if (typeof w.do_level === "number") parts.push(`DO ${w.do_level.toFixed(1)}`)
  return parts.length ? parts.join(" · ") : null
}

/** 팝업 내용을 DOM 으로 만든다. 사용자 입력(이름·주소)은 textContent 로만
 *  넣어 HTML 로 해석되지 않게 한다. 색·숫자는 코드가 만드는 값이라 그대로 쓴다. */
function buildPopup(f: ControlFarm): HTMLElement {
  const root = document.createElement("div")
  root.style.lineHeight = "1.5"

  const head = document.createElement("div")
  const name = document.createElement("b")
  name.textContent = f.name            // 사용자 입력 — 이스케이프
  head.appendChild(name)
  const owner = document.createElement("span")
  owner.style.color = "#64748B"
  owner.textContent = ` · ${f.owner}`  // 사용자 입력 — 이스케이프
  head.appendChild(owner)
  root.appendChild(head)

  // 유형 · 센서 유무 — 코드가 정한 문구만.
  const kind = document.createElement("div")
  kind.style.color = "#64748B"
  kind.style.fontSize = "11px"
  kind.textContent = TYPE_LABEL[f.farm_type] + (f.has_sensor ? "" : " · 수질센서 미설치")
  root.appendChild(kind)

  const line1 = document.createElement("div")
  line1.append(`${f.farm_type === "agriculture" ? "베드" : "수조"} ${f.tanks}개`)
  if (f.danger) {
    const s = document.createElement("span"); s.style.color = "#DC2626"
    s.textContent = ` · 위험 ${f.danger}`; line1.appendChild(s)
  }
  if (f.warning) {
    const s = document.createElement("span"); s.style.color = "#D97706"
    s.textContent = ` · 주의 ${f.warning}`; line1.appendChild(s)
  }
  root.appendChild(line1)

  // 센서가 없는 농장에 "기기 0대 · 모두 정상" 은 틀린 말이다 — 위 유형 줄이 대신 말한다.
  if (f.has_sensor) {
    const line2 = document.createElement("div")
    line2.append(`기기 ${f.devices}대`)
    if (f.offline) {
      const s = document.createElement("span"); s.style.color = "#DC2626"
      s.textContent = ` · 끊김 ${f.offline}`; line2.appendChild(s)
    } else {
      line2.append(" · 모두 정상")
    }
    root.appendChild(line2)
  }

  // 대표 수조의 최신 수질 — 있는 값만 골라 한 줄로.
  if (f.wq) {
    const w = f.wq
    const wqLine = document.createElement("div")
    wqLine.style.marginTop = "4px"
    const vals: string[] = []
    if (typeof w.temperature === "number") vals.push(`수온 ${w.temperature.toFixed(1)}°C`)
    if (typeof w.ph === "number") vals.push(`pH ${w.ph.toFixed(2)}`)
    if (typeof w.do_level === "number") vals.push(`DO ${w.do_level.toFixed(2)}`)
    if (typeof w.salinity === "number") vals.push(`염도 ${w.salinity.toFixed(1)}‰`)
    if (vals.length) {
      const b = document.createElement("b")
      b.textContent = vals.join(" · ")   // 숫자 — 코드가 만든 값
      wqLine.appendChild(b)
      const meta = document.createElement("div")
      meta.style.color = "#64748B"
      meta.style.fontSize = "11px"
      // 대표 수조 이름은 사용자 입력 — textContent 로만 넣는다.
      meta.textContent = `${f.rep_tank ?? ""} · ${agoLabel(w.recorded_at)}`
      root.appendChild(wqLine)
      root.appendChild(meta)
    }
  }

  if (f.location) {
    const loc = document.createElement("div")
    loc.style.color = "#64748B"
    loc.textContent = f.location        // 사용자 입력 — 이스케이프
    root.appendChild(loc)
  }

  // 위치 출처 — "이 점을 얼마나 믿어도 되나".
  const src = sourceLabel(f)
  if (src) {
    const el = document.createElement("div")
    el.style.color = f.coord_source === "address" ? "#B45309" : "#64748B"
    el.style.fontSize = "11px"
    el.style.marginTop = "2px"
    el.textContent = src
    root.appendChild(el)
  }
  return root
}

const TYPE_LABEL: Record<FarmType, string> = { shrimp: "양식장", agriculture: "스마트팜" }

function sourceLabel(f: ControlFarm): string | null {
  if (f.coord_source === "farm") return "위치: 농가 입력 좌표"
  if (f.coord_source === "device") return "위치: 장비 위치 기준"
  if (f.coord_source === "address") {
    return f.coord_precision === "region" ? "위치: 주소 기준 대략 위치(읍·면 수준)" : "위치: 주소 기준 대략 위치"
  }
  return null
}

export type DeviceMarker = {
  id: string
  name: string
  latitude: number
  longitude: number
  online: boolean
  last_seen_at: string | null
  tank_name: string
  farm_name: string
  farm_id: string | null
  farm_type: FarmType
}

// ── 표시 필터(순수 함수) ─────────────────────────────────────────────────────
// 지도는 표식을 (종류 × 유형 × 문제 여부) 8개 묶음의 layerGroup 으로 나눠 들고,
// 필터가 바뀌면 묶음을 켜고 끄기만 한다(지도를 다시 만들지 않는다 — 확대 유지).
// 툴바의 숫자도 같은 함수로 센다. 그래야 숫자와 지도 위 표식 수가 늘 같다.

export type MapView = "all" | "farms" | "sensors"
export type MapTypeFilter = "all" | FarmType
export type MapFilter = { view: MapView; type: MapTypeFilter; issuesOnly: boolean }

export type MarkerBucket = { kind: "farm" | "device"; farmType: FarmType; issue: boolean }

export const isLocated = (f: ControlFarm) => f.latitude !== null && f.longitude !== null

/** 문제 있는 농장: 위험·주의 수조가 있거나 기기가 끊김. */
export function farmBucket(f: ControlFarm): MarkerBucket {
  return { kind: "farm", farmType: f.farm_type, issue: f.danger > 0 || f.warning > 0 || f.offline > 0 }
}

/** 문제 있는 센서: 끊김. 유형은 소속 농장의 것. */
export function deviceBucket(d: DeviceMarker): MarkerBucket {
  return { kind: "device", farmType: d.farm_type ?? "shrimp", issue: !d.online }
}

export function bucketVisible(b: MarkerBucket, f: MapFilter): boolean {
  if (f.view === "farms" && b.kind !== "farm") return false
  if (f.view === "sensors" && b.kind !== "device") return false
  if (f.type !== "all" && f.type !== b.farmType) return false
  if (f.issuesOnly && !b.issue) return false
  return true
}

/** 보기별 개수 — 지금의 유형·문제 필터 기준으로 지도에 찍히는(찍힐) 표식 수. */
export function countMarkers(
  farms: ControlFarm[],
  devices: DeviceMarker[],
  f: { type: MapTypeFilter; issuesOnly: boolean },
): { all: number; farms: number; sensors: number } {
  const probe: MapFilter = { view: "all", type: f.type, issuesOnly: f.issuesOnly }
  const nFarms = farms.filter(x => isLocated(x) && bucketVisible(farmBucket(x), probe)).length
  const nSensors = devices.filter(x => bucketVisible(deviceBucket(x), probe)).length
  return { all: nFarms + nSensors, farms: nFarms, sensors: nSensors }
}

const bucketKey = (b: MarkerBucket) => `${b.kind}:${b.farmType}:${b.issue ? 1 : 0}`

// ── 농장 핀(divIcon) ─────────────────────────────────────────────────────────
// divIcon 의 HTML 문자열에는 코드 상수(색·SVG)만 들어간다. 농장명 같은 사용자
// 입력은 절대 여기에 넣지 않는다 — 툴팁·팝업·aria-label 은 DOM API 로 넣는다.

type Tone = "danger" | "warning" | "normal" | "nosensor"
const TONE: Record<Tone, { border: string; bg: string; ink: string }> = {
  danger:   { border: "#DC2626", bg: "#FEE2E2", ink: "#B91C1C" },
  warning:  { border: "#D97706", bg: "#FEF3C7", ink: "#B45309" },
  normal:   { border: "#10B981", bg: "#D1FAE5", ink: "#047857" },
  nosensor: { border: "#64748B", bg: "#F1F5F9", ink: "#475569" },
}

function farmTone(f: ControlFarm): Tone {
  if (f.danger) return "danger"
  if (f.warning) return "warning"
  if (!f.has_sensor) return "nosensor"
  return "normal"
}

// lucide "waves"·"sprout" 를 줄인 인라인 SVG.
const SVG_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
const TYPE_ICON: Record<FarmType, string> = {
  shrimp: SVG_OPEN
    + '<path d="M2 7c.6.5 1.2 1 2.5 1C7 8 7 6 9.5 6c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'
    + '<path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'
    + '<path d="M2 17c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>',
  agriculture: SVG_OPEN
    + '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/>'
    + '<path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/>'
    + '<path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>',
}

const PIN_W = 26, PIN_H = 34   // 둥근 사각 26px + 아래 꼬리(꼬리 끝이 좌표)

/** 핀 HTML. 인자는 모두 코드가 정한 열거값이다. */
function pinHtml(tone: Tone, type: FarmType, dashed: boolean): string {
  const c = TONE[tone]
  return `<div style="position:relative;width:${PIN_W}px;height:${PIN_H}px">`
    + `<div style="box-sizing:border-box;width:${PIN_W}px;height:${PIN_W}px;border-radius:8px;`
    + `border:2px ${dashed ? "dashed" : "solid"} ${c.border};background:${c.bg};color:${c.ink};`
    + `display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(15,23,42,.35)">`
    + TYPE_ICON[type] + `</div>`
    + `<div style="position:absolute;left:${PIN_W / 2 - 5}px;top:${PIN_W - 1}px;width:0;height:0;`
    + `border-left:5px solid transparent;border-right:5px solid transparent;border-top:${PIN_H - PIN_W + 1}px solid ${c.border}"></div>`
    + `</div>`
}

/** 같은 자리(약 10m 격자)에 장비가 여럿이면 점이 완전히 겹쳐 하나로 보인다.
 *  같은 곳에서 연달아 페어링하면 좌표가 사실상 동일하기 때문이다.
 *  겹치는 무리를 찾아 중심 둘레에 작은 원형으로 벌려 그린다(표시용 오프셋
 *  약 12m — 실제 좌표는 그대로 저장돼 있고 화면 배치만 벌린다). */
function spreadOverlaps(markers: DeviceMarker[]): (DeviceMarker & { showLat: number; showLng: number })[] {
  const groups = new Map<string, DeviceMarker[]>()
  for (const d of markers) {
    const key = `${d.latitude.toFixed(4)}:${d.longitude.toFixed(4)}`
    const list = groups.get(key) ?? []
    list.push(d)
    groups.set(key, list)
  }
  const out: (DeviceMarker & { showLat: number; showLng: number })[] = []
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push({ ...list[0], showLat: list[0].latitude, showLng: list[0].longitude })
      continue
    }
    const r = 0.00012   // 위도 기준 약 13m
    list.forEach((d, i) => {
      const a = (2 * Math.PI * i) / list.length
      out.push({
        ...d,
        showLat: d.latitude + r * Math.cos(a),
        showLng: d.longitude + (r * Math.sin(a)) / Math.cos((d.latitude * Math.PI) / 180),
      })
    })
  }
  return out
}

/** 관제센터 지도 — 플랫폼의 모든 농장을 한 판에 찍는다.
 *
 *  양식장 관리의 지도와 목적이 다르다. 저쪽은 "내 농장", 여기는 "전체 중
 *  어디가 급한가" 다. 그래서 표식이 상태를 크게 말해야 한다 — 위험 농장은
 *  붉게 위로, 기기가 끊긴 농장은 테두리를 점선으로, 센서 없는 농장은 회색으로.
 *  주소로만 찾은 농장은 바깥 점선 고리로 "대략 위치" 임을 드러낸다.
 *
 *  좌표가 기록된 장비(페어링 때 휴대폰 위치)는 작은 점으로 함께 찍는다 —
 *  농장을 확대하면 장비가 수조별로 어디 있는지 보인다.
 *
 *  지도는 데이터(farms/deviceMarkers)가 바뀔 때만 새로 만든다. 표시 필터
 *  (view·type·issuesOnly)는 layerGroup 을 켜고 끄기만 해서 확대 상태가 유지된다.
 *  fitSignal 이 바뀌면 지금 보이는 표식에 지도를 맞춘다(첫 로드는 전체에 맞춘다).
 */
export function ControlMap({
  farms, deviceMarkers = [], height = 420,
  view = "all", type = "all", issuesOnly = false, fitSignal = 0,
}: {
  farms: ControlFarm[]
  deviceMarkers?: DeviceMarker[]
  height?: number
  view?: MapView
  type?: MapTypeFilter
  issuesOnly?: boolean
  fitSignal?: number
}) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const groups = useRef<Map<string, { bucket: MarkerBucket; layer: LayerGroup; pts: [number, number][] }> | null>(null)
  const filterRef = useRef<MapFilter>({ view, type, issuesOnly })
  // 범례 — 모바일(640px 미만)은 접어서 시작한다. 이 컴포넌트는 데이터를 받은 뒤
  // 브라우저에서만 그려지므로 matchMedia 를 첫 상태에 써도 하이드레이션이 어긋나지 않는다.
  const [legendOpen, setLegendOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  )

  const located = farms.filter(isLocated)

  /** 현재 필터대로 묶음을 켜고 끈다. 지도는 그대로 둔다. */
  const applyFilter = () => {
    const m = map.current, gs = groups.current
    if (!m || !gs) return
    for (const g of gs.values()) {
      const show = bucketVisible(g.bucket, filterRef.current)
      if (show && !m.hasLayer(g.layer)) g.layer.addTo(m)
      else if (!show && m.hasLayer(g.layer)) m.removeLayer(g.layer)
    }
  }

  /** 점들에 지도를 맞춘다. 하나면 그 자리로, 여럿이면 다 보이게. */
  const fitTo = (pts: [number, number][]) => {
    const m = map.current
    if (!m || pts.length === 0) return
    if (pts.length === 1) m.setView(pts[0], 12)
    else m.fitBounds(pts, { padding: [40, 40], maxZoom: 12 })
  }

  useEffect(() => {
    if ((located.length === 0 && deviceMarkers.length === 0) || !holder.current) return
    let alive = true

    ;(async () => {
      const L = (await import("leaflet")).default
      if (!alive || !holder.current) return
      if (map.current) { map.current.remove(); map.current = null }

      const m = L.map(holder.current, { scrollWheelZoom: true, attributionControl: true })
      map.current = m

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m)

      // 장비 점은 농장 핀(markerPane 600) 위에 그린다 — 장비 한 대뿐인 농장은 핀 꼬리
      // 끝과 장비 점이 같은 자리라, 아래에 깔리면 점을 누를 수 없다.
      m.createPane("controlDevices").style.zIndex = "640"

      const gs = new Map<string, { bucket: MarkerBucket; layer: LayerGroup; pts: [number, number][] }>()
      const groupFor = (b: MarkerBucket) => {
        const k = bucketKey(b)
        let g = gs.get(k)
        if (!g) { g = { bucket: b, layer: L.layerGroup(), pts: [] }; gs.set(k, g) }
        return g
      }

      for (const f of located) {
        const g = groupFor(farmBucket(f))
        const at: [number, number] = [f.latitude!, f.longitude!]
        g.pts.push(at)
        const tone = farmTone(f)

        // 주소로만 찾은 농장 — 바깥 점선 고리(읍·면 수준이면 3km, 상세 주소면 300m).
        if (f.coord_source === "address") {
          L.circle(at, {
            radius: f.coord_precision === "region" ? 3000 : 300,
            color: TONE[tone].border,
            weight: 1.5,
            dashArray: "4 6",
            fill: false,
            interactive: false,
          }).addTo(g.layer)
        }

        const marker = L.marker(at, {
          icon: L.divIcon({
            className: "",   // leaflet-div-icon 의 흰 상자 스타일을 쓰지 않는다
            // 기기가 끊긴 농장은 점선 — "지금 값이 안 오고 있다" 는 표시.
            html: pinHtml(tone, f.farm_type, f.offline > 0),
            iconSize: [PIN_W, PIN_H],
            iconAnchor: [PIN_W / 2, PIN_H],
            popupAnchor: [0, -PIN_H + 2],
            tooltipAnchor: [0, -PIN_H + 2],
          }),
          // 급한 곳일수록 위에 — 겹쳐도 위험 농장이 먼저 보인다.
          zIndexOffset: f.danger ? 1000 : f.warning ? 500 : 0,
          keyboard: true,
        })
          // 팝업은 DOM 노드로 조립한다. 농장명·소유자명·주소는 일반 사용자가
          // 자유 입력하는 값이라, HTML 문자열로 이어 붙이면 저장형 XSS 가 된다.
          // 관제센터는 최고 권한 사용자가 여는 화면이므로, 그 세션에서 남의
          // 스크립트가 도는 순간 권한 탈취로 이어진다. 사용자 값은 textContent
          // 로만 넣고, 숫자·색은 코드가 만드는 것이라 안전하다.
          .bindPopup(buildPopup(f))
          .addTo(g.layer)
        // 키보드·스크린리더용 이름 — setAttribute 는 HTML 로 해석되지 않는다.
        marker.on("add", () => marker.getElement()?.setAttribute("aria-label", `${f.name} 농장`))

        // 대표 수조의 핵심 수질(수온·DO)을 표식 위에 상시 표시한다 — 센서 있는
        // 농장만. 클릭 없이도 지도만 보고 상황을 읽을 수 있어야 관제 화면이다.
        const summary = f.has_sensor ? wqSummary(f) : null
        if (summary) {
          marker.bindTooltip(summary, { permanent: true, direction: "top", opacity: 0.92 })
        }
      }

      // 장비별 마커 — 작은 점. 이름과 소속(농장·수조), 마지막 수신을 팝업으로.
      // 같은 자리의 장비들은 spreadOverlaps 가 벌려 배치한다.
      for (const d of spreadOverlaps(deviceMarkers)) {
        const g = groupFor(deviceBucket(d))
        g.pts.push([d.latitude, d.longitude])
        const dColor = d.online ? "#3B82F6" : "#94A3B8"
        const dm = L.circleMarker([d.showLat, d.showLng], {
          pane: "controlDevices",
          radius: 5,
          color: dColor,
          fillColor: dColor,
          fillOpacity: 0.85,
          weight: 1.5,
          dashArray: d.online ? undefined : "2 3",
        }).addTo(g.layer)
        dm.bindTooltip(d.name, { direction: "top", offset: L.point(0, -6) })
        const pop = document.createElement("div")
        pop.style.lineHeight = "1.5"
        const nm = document.createElement("b"); nm.textContent = d.name; pop.appendChild(nm)
        const wh = document.createElement("div")
        wh.style.color = "#64748B"
        wh.textContent = [d.farm_name, d.tank_name].filter(Boolean).join(" · ")   // 사용자 입력 — 이스케이프
        pop.appendChild(wh)
        const st = document.createElement("div")
        st.textContent = d.online
          ? "온라인"
          : d.last_seen_at ? `끊김 · ${agoLabel(d.last_seen_at)}` : "수신 기록 없음"
        st.style.color = d.online ? "#10B981" : "#DC2626"
        pop.appendChild(st)
        dm.bindPopup(pop)
      }

      groups.current = gs
      applyFilter()

      // 첫 로드는 전체(필터와 무관하게 모든 표식)에 맞춘다.
      fitTo([...gs.values()].flatMap(g => g.pts))
    })()

    return () => {
      alive = false
      groups.current = null
      if (map.current) { map.current.remove(); map.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.map(f => `${f.id}:${f.latitude},${f.longitude}:${f.danger}:${f.warning}:${f.offline}:${f.has_sensor}:${f.farm_type}:${f.coord_source}:${f.coord_precision ?? ""}`).join("|")
    + "#" + deviceMarkers.map(d => `${d.id}:${d.latitude},${d.longitude}:${d.online}:${d.farm_type}`).join("|")])

  // 필터 전환 — 묶음만 켜고 끈다. 지도가 아직 만들어지는 중이면 만든 쪽이 마지막에
  // filterRef 를 읽어 적용한다.
  useEffect(() => {
    filterRef.current = { view, type, issuesOnly }
    applyFilter()
  }, [view, type, issuesOnly])

  // "전체 맞춤" — 지금 보이는 묶음의 점에 맞춘다.
  useEffect(() => {
    if (!fitSignal || !groups.current) return
    fitTo([...groups.current.values()].filter(g => bucketVisible(g.bucket, filterRef.current)).flatMap(g => g.pts))
  }, [fitSignal])

  if (located.length === 0 && deviceMarkers.length === 0) {
    return (
      <div
        className="w-full rounded-xl border border-border bg-muted flex items-center justify-center px-4 text-center text-sm text-muted-foreground"
        style={{ height }}
      >
        지도에 표시할 농장·수질센서가 없습니다. 농장 좌표·장비 위치·주소 중 하나가 확인되면 여기에 표시됩니다.
      </div>
    )
  }

  const visible = countMarkers(located, deviceMarkers, { type, issuesOnly })
  const shown = view === "farms" ? visible.farms : view === "sensors" ? visible.sensors : visible.all

  return (
    // isolate — 범례(z-500)가 모달 위로 튀어 오르지 않도록 이 안에 가둔다.
    <div className="relative isolate z-0">
      <div ref={holder} style={{ height }} className="w-full rounded-xl overflow-hidden bg-muted" role="img" aria-label="전체 농장 관제 지도" />

      {shown === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center px-3">
          <p className="rounded-lg bg-card/95 border border-border px-3 py-1.5 text-xs text-muted-foreground shadow">
            조건에 맞는 표식이 없습니다
          </p>
        </div>
      )}

      {/* 범례 — 관제 화면은 교대 근무자도 본다. 색의 뜻을 화면에 적어 둔다. */}
      <div className="absolute bottom-3 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-lg bg-card/95 border border-border text-[11px] leading-relaxed shadow">
        <button
          type="button"
          onClick={() => setLegendOpen(o => !o)}
          aria-expanded={legendOpen}
          className="w-full min-h-[36px] px-3 text-left font-semibold text-foreground"
        >
          범례 {legendOpen ? "접기" : "보기"}
        </button>
        {legendOpen && (
          <div className="px-3 pb-2 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted-foreground">농장</span>
              <LegendPin className="border-emerald-500 bg-emerald-100" label="정상" />
              <LegendPin className="border-amber-600 bg-amber-100" label="주의" />
              <LegendPin className="border-red-600 bg-red-100" label="위험" />
              <LegendPin className="border-slate-500 bg-slate-100" label="센서 없음" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted-foreground">수질센서</span>
              <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] inline-block" /> 온라인</span>
              <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> 끊김</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-[3px] border-2 border-dashed border-slate-500 inline-block" /> 점선 핀 = 기기 끊김</span>
              <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-full border border-dashed border-slate-500 inline-block" /> 점선 고리 = 주소 기준 대략 위치</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LegendPin({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className={`w-3 h-3 rounded-[3px] border-2 inline-block ${className}`} /> {label}
    </span>
  )
}
