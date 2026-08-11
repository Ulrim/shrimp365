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

export interface TankSpec {
  /** 씬 안에서만 쓰는 자리 번호. DB 의 tank.id 와는 별개다. */
  slot: string
  /** 화면에 띄우는 기본 이름. DB 수조가 연결되면 그쪽 이름으로 덮어쓴다. */
  label: string
  x: number
  z: number
  /** 수조 바깥지름. */
  diameter: number
  /** 벽체 높이. */
  wallHeight: number
  /** 담기는 물 깊이. */
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

// ─── 무안 양식장 ───────────────────────────────────────────────────────────────

const SITE_W = 63
const SITE_D = 27

/** 건물 외곽선.
 *
 *  기본은 55 × 24 사각형인데, 우측 상단만 도면대로 튀어나와 있다.
 *  도면에 적힌 산식이 그 모양을 그대로 설명한다.
 *
 *    상부 베이  12 × 55 + 10 × 2 + (2 × 2.5)/2 = 682.5 m²
 *    하부 베이  12 × 55                        = 660.0 m²
 *    합산                                      = 1342.5 m²
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

/** 원형 수조 자리를 만든다.
 *
 *  TODO(도면): 받은 도면은 건축허가용이라 수조가 그려져 있지 않다. 아래는
 *  12 m 베이 두 줄에 Ø8 m 수조를 넣은 표준 배치다. 실제 배치도가 오면
 *  rows/cols/pitch 만 고치면 된다.
 *
 *  베이 하나가 깊이 12 m 이므로 Ø8 수조를 놓으면 앞뒤로 2 m 씩 통로가 남고,
 *  가운데 두 줄 사이에는 4 m 폭 중앙 통로가 생긴다.
 */
function buildTankSlots(): TankSpec[] {
  const diameter = 8
  const wallHeight = 1.4
  const waterDepth = 1.2
  /** 수조 중심 간격. 8 m 수조 + 1 m 사이 여유. */
  const pitch = 9
  const cols = 6
  /** 두 베이의 중심선. 건물 깊이 24 m 를 12 m 씩 나눈 가운데. */
  const rowZ = [-6, 6]
  /** 위 줄이 A, 아래 줄이 B. 현장에서 부르는 이름과 맞추기 쉬운 순서다. */
  const rowNames = ["A", "B"]

  const slots: TankSpec[] = []
  for (let r = 0; r < rowZ.length; r++) {
    for (let c = 0; c < cols; c++) {
      // 줄 전체를 건물 가운데에 맞춘다.
      const x = (c - (cols - 1) / 2) * pitch
      slots.push({
        slot: `${rowNames[r]}${c + 1}`,
        label: `${rowNames[r]}-${c + 1}조`,
        x,
        z: rowZ[r],
        diameter,
        wallHeight,
        waterDepth,
      })
    }
  }
  return slots
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

  tanks: buildTankSlots(),

  assumptions: [
    "원형 수조 배치(Ø8 m · 2열 × 6기)는 표준 배치를 임시로 넣은 것입니다. 받은 도면은 건축허가용이라 수조가 그려져 있지 않습니다.",
    "처마 3.0 m · 용마루 5.5 m 는 추정값입니다. 단면도(입면도)가 있으면 실제 높이로 맞춥니다.",
    "건물은 대지 63 × 27 m 안에 가운데 정렬로 놓았습니다. 실제 이격거리가 다르면 알려주십시오.",
    "지붕은 도면 지시선(차광막 겹마감 + 아웃도어비닐 1겹)에 따라 반투명으로 표현했습니다.",
  ],
}

// ─── 파생값 ───────────────────────────────────────────────────────────────────

/** 신발끈 공식으로 폴리곤 넓이를 낸다. 도면 기재 연면적과 대조하는 용도. */
export function polygonArea(points: Point2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.z - b.x * a.z
  }
  return Math.abs(sum) / 2
}

/** 간격 배열을 중심 기준 좌표 배열로 편다. [4,3,3] → [-5,-1,2,5] */
export function spansToPositions(spans: number[]): number[] {
  const total = spans.reduce((a, b) => a + b, 0)
  const out: number[] = [-total / 2]
  for (const s of spans) out.push(out[out.length - 1] + s)
  return out
}

/** 수조 하나에 담기는 물의 부피(m³). 사육 수량을 가늠할 때 쓴다. */
export function tankVolume(t: TankSpec): number {
  return Math.PI * (t.diameter / 2) ** 2 * t.waterDepth
}
