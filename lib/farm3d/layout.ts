/** 무안 양식장 3D 레이아웃 — 길이 단위는 전부 미터(m).
 *
 *  출처: 「지상 1층 평면도 · 가설건축물(새우양식장)」 건축허가 도면.
 *  도면에서 직접 읽은 값과 도면에 없어 임시로 채운 값을 구분해 두었다.
 *  임시값은 `TODO(도면)` 주석이 붙어 있고, 실측이 들어오면 이 파일의
 *  숫자만 고치면 된다 — 씬 코드는 손대지 않는다.
 *
 *  좌표계는 three.js 기준이다. 평면도를 그대로 눕힌 모양이라고 보면 된다.
 *    +X = 도면 오른쪽 (건물 길이 방향, 55~57 m)
 *    +Z = 도면 아래쪽 (건물 깊이 방향, 24 m)
 *    +Y = 위
 *  원점은 대지 한가운데다.
 */

// ─── 타입 ─────────────────────────────────────────────────────────────────────

/** XZ 평면 위의 점. 바닥 폴리곤을 만들 때 쓴다. */
export interface Point2 {
  x: number
  z: number
}

export interface SiteSpec {
  /** 대지 가로 (도면 상·하단 63,000). */
  width: number
  /** 대지 세로 (도면 우측 27,000). */
  depth: number
  /** 네 귀퉁이 모접기 길이 (도면 2,000 + 2,000). */
  cornerCut: number
}

export interface BuildingSpec {
  /** 건축면적 산정 외곽선. 도면의 굵은 실선을 그대로 옮긴 폴리곤. */
  footprint: Point2[]
  /** 도면에 적힌 연면적. 폴리곤 넓이와 맞는지 자체 검산에 쓴다. */
  floorAreaFromDrawing: number
  /** 처마 높이. TODO(도면): 단면도가 없어 추정값이다. */
  eaveHeight: number
  /** 용마루 높이(지붕 꼭대기). TODO(도면): 단면도가 없어 추정값이다. */
  ridgeHeight: number
}

export interface ColumnGridSpec {
  /** X 방향 기둥 간격 (도면 하단 치수선). 누적합이 site.width 와 같아야 한다. */
  xSpans: number[]
  /** Z 방향 기둥 간격 (도면 우측 치수선). 누적합이 site.depth 와 같아야 한다. */
  zSpans: number[]
  /** 파이프 기둥 반지름. TODO(도면): 도면에 관경 표기가 없어 추정값이다. */
  radius: number
}

/** 사각 수조 한 기. 도면의 면적 산식 한 줄이 수조 하나에 대응한다. */
export interface TankSpec {
  /** 씬 안에서만 쓰는 자리 번호. DB 의 tank.id 와는 별개다. */
  slot: string
  /** 화면에 띄우는 기본 이름. DB 수조가 연결되면 그쪽 이름으로 덮어쓴다. */
  label: string
  /** 수조 벽체 바깥면 윤곽. */
  outline: Point2[]
  /** 도면에 적힌 면적. outline 넓이와 대조하는 검산용. */
  areaFromDrawing: number
  /** 벽체 두께. TODO(도면): 표기가 없어 추정값이다. */
  wallThickness: number
  /** 벽체 높이. TODO(도면): 단면도가 없어 추정값이다. */
  wallHeight: number
  /** 담기는 물 깊이. TODO(도면): 단면도가 없어 추정값이다. */
  waterDepth: number
}

export interface Farm3DLayout {
  name: string
  site: SiteSpec
  building: BuildingSpec
  columns: ColumnGridSpec
  tanks: TankSpec[]
  /** 도면에서 못 읽어 추정으로 채운 항목들 — 화면에 그대로 고지한다. */
  assumptions: string[]
}

// ─── 폴리곤 계산 ──────────────────────────────────────────────────────────────

/** 신발끈 공식으로 폴리곤 넓이를 낸다. 도면 기재 면적과 대조하는 용도. */
export function polygonArea(points: Point2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.z - b.x * a.z
  }
  return Math.abs(sum) / 2
}

/** 폴리곤을 안쪽으로 t 만큼 민다. t 가 음수면 바깥으로 민다.
 *
 *  꼭짓점을 중심 쪽으로 당기는 방식은 못 쓴다 — 55 × 12 처럼 길쭉한 도형에서
 *  짧은 변과 긴 변의 두께가 완전히 달라진다. 각 변을 평행하게 민 직선을
 *  만들고 이웃한 두 직선의 교점을 새 꼭짓점으로 잡아야 두께가 고르다.
 *
 *  여기 쓰는 수조 윤곽은 모두 볼록해서 이 방법으로 충분하다.
 */
export function insetPolygon(points: Point2[], t: number): Point2[] {
  const n = points.length
  // 감김 방향에 따라 안쪽 법선이 뒤집힌다. 부호를 먼저 정한다.
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    s += a.x * b.z - b.x * a.z
  }
  const sign = s > 0 ? 1 : -1

  const lines = points.map((a, i) => {
    const b = points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const ux = (b.x - a.x) / len
    const uz = (b.z - a.z) / len
    // 신발끈 부호가 양수인 감김에서는 (-uz, ux) 가 도형 안쪽을 가리킨다.
    return { px: a.x - sign * uz * t, pz: a.z + sign * ux * t, ux, uz }
  })

  const out: Point2[] = []
  for (let i = 0; i < n; i++) {
    const p = lines[(i - 1 + n) % n]
    const q = lines[i]
    const det = q.ux * p.uz - q.uz * p.ux
    if (Math.abs(det) < 1e-9) {
      // 두 변이 나란하면 교점이 없다. 민 점을 그대로 쓴다.
      out.push({ x: q.px, z: q.pz })
      continue
    }
    const dx = q.px - p.px
    const dz = q.pz - p.pz
    const k = (q.ux * dz - q.uz * dx) / det
    out.push({ x: p.px + p.ux * k, z: p.pz + p.uz * k })
  }
  return out
}

/** 간격 배열을 중심 기준 좌표 배열로 편다. [4,3,3] → [-5,-1,2,5] */
export function spansToPositions(spans: number[]): number[] {
  const total = spans.reduce((a, b) => a + b, 0)
  const out: number[] = [-total / 2]
  for (const s of spans) out.push(out[out.length - 1] + s)
  return out
}

/** 수조에 담기는 물의 부피(m³). 벽 안쪽 넓이 × 수심. */
export function tankVolume(t: TankSpec): number {
  return polygonArea(insetPolygon(t.outline, t.wallThickness)) * t.waterDepth
}

/** 수조 바닥 넓이(m²) — 벽체 바깥면 기준. 도면 면적과 같은 기준이다. */
export function tankArea(t: TankSpec): number {
  return polygonArea(t.outline)
}

// ─── 무안 양식장 ───────────────────────────────────────────────────────────────

const SITE_W = 63
const SITE_D = 27

/** 건물 외곽선.
 *
 *  기본은 55 × 24 사각형인데, 우측 상단만 도면대로 튀어나와 있다.
 *  도면에 적힌 산식이 그 모양을 그대로 설명한다.
 *
 *    상부(1번 수조)  12 × 55 + 10 × 2 + (2 × 2.5)/2 = 682.5 m²
 *    하부(2번 수조)  12 × 55                        = 660.0 m²
 *    합산                                           = 1342.5 m²
 *
 *  아래 폴리곤의 넓이가 정확히 1342.5 가 되고, 상단 변 57 m · 하단 변 55 m 도
 *  도면 라벨과 일치한다. 도면을 옳게 읽었다는 확인이다.
 */
const BUILDING_FOOTPRINT: Point2[] = [
  { x: -27.5, z: -12 },   // 좌상
  { x: 29.5, z: -12 },   // 우상 — 여기까지 57 m
  { x: 29.5, z: -2 },   // 돌출부 10 m
  { x: 27.5, z: 0.5 },  // 모접기 (밑변 2, 높이 2.5)
  { x: 27.5, z: 12 },   // 우하
  { x: -27.5, z: 12 },   // 좌하 — 하단 변 55 m
]

/** 상부(1번 수조) 윤곽.
 *
 *  건물 외곽선의 위쪽 절반이 그대로 수조다. 도면의 모접기는 z = 0.5 까지
 *  내려오는데, 두 수조를 가르는 벽은 z = 0 (가운데 기둥 열)에 선다. 그래서
 *  모접기를 z = 0 에서 끊었다 — 도면 682.5 대비 0.1 m² 차이고, 이 값은
 *  화면의 면적 카드에 실제 계산값으로 표시된다.
 */
const TANK_UPPER: Point2[] = [
  { x: -27.5, z: -12 },
  { x: 29.5, z: -12 },
  { x: 29.5, z: -2 },
  { x: 27.9, z: 0 },    // 모접기 선이 z = 0 을 지나는 지점
  { x: -27.5, z: 0 },
]

/** 하부(2번 수조) 윤곽. 도면 산식 그대로 12 × 55 = 660 m². */
const TANK_LOWER: Point2[] = [
  { x: -27.5, z: 0 },
  { x: 27.5, z: 0 },
  { x: 27.5, z: 12 },
  { x: -27.5, z: 12 },
]

/** 수조 두 기에 공통으로 쓰는 치수. TODO(도면): 단면도가 오면 바꾼다. */
const TANK_SECTION = {
  wallThickness: 0.25,
  wallHeight: 1.4,
  waterDepth: 1.2,
}

export const MUAN_LAYOUT: Farm3DLayout = {
  name: "무안 양식장",

  site: {
    width: SITE_W,
    depth: SITE_D,
    cornerCut: 2,
  },

  building: {
    footprint: BUILDING_FOOTPRINT,
    floorAreaFromDrawing: 1342.5,
    eaveHeight: 3,      // TODO(도면): 단면도 필요
    ridgeHeight: 5.5,   // TODO(도면): 단면도 필요
  },

  columns: {
    // 도면 하단: 4,000 + 3,000×18 + 1,000 + 4,000 = 63,000
    xSpans: [4, ...Array<number>(18).fill(3), 1, 4],
    // 도면 우측: 4,000 + 4,750×4 + 4,000 = 27,000
    zSpans: [4, 4.75, 4.75, 4.75, 4.75, 4],
    radius: 0.075,      // TODO(도면): 파이프 관경 표기 없음
  },

  tanks: [
    {
      slot: "T1",
      label: "상부(1번 수조)",
      outline: TANK_UPPER,
      areaFromDrawing: 682.5,
      ...TANK_SECTION,
    },
    {
      slot: "T2",
      label: "하부(2번 수조)",
      outline: TANK_LOWER,
      areaFromDrawing: 660,
      ...TANK_SECTION,
    },
  ],

  assumptions: [
    "수조 수심 1.2 m · 벽 높이 1.4 m · 벽 두께 0.25 m 는 추정값입니다. 단면도가 있으면 실제 치수로 맞춥니다.",
    "처마 3.0 m · 용마루 5.5 m 는 추정값입니다. 단면도(입면도)가 있으면 실제 높이로 맞춥니다.",
    "두 수조를 가르는 벽은 가운데 기둥 열(z=0)에 세웠습니다. 실제 격벽 위치가 다르면 알려주십시오.",
    "건물은 대지 63 × 27 m 안에 가운데 정렬로 놓았습니다. 실제 이격거리가 다르면 알려주십시오.",
    "지붕은 도면 지시선(차광막 겹마감 + 아웃도어비닐 1겹)에 따라 반투명으로 표현했습니다.",
  ],
}
