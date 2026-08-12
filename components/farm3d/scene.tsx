"use client"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import type { Farm3DLayout, Point2, TankSpec } from "@/lib/farm3d/layout"
import { insetPolygon, spansToPositions } from "@/lib/farm3d/layout"
import type { Tank } from "@/types"

// ─── 색 ───────────────────────────────────────────────────────────────────────

/** 씬이 수조 한 기를 그리는 데 실제로 필요한 것 전부.
 *
 *  DB 의 Tank 행을 통째로 넘기지 않는다. 로그인 없이 보는 공개 페이지에는
 *  사육 마릿수나 수질 같은 값이 아예 없고, 있어서도 안 된다. */
export interface TankDisplay {
  name: string
  status: Tank["status"]
}

/** 수조 상태 색. farm-map.tsx 의 지도 마커와 같은 값을 쓴다 — 두 화면에서
 *  같은 수조가 다른 색으로 보이면 안 된다. */
export const STATUS_COLOR: Record<Tank["status"], string> = {
  active: "#10B981",
  warning: "#D97706",
  danger: "#DC2626",
  inactive: "#64748B",
}

const COLOR = {
  ground: "#0f172a",
  // 대지는 지면보다 확실히 밝아야 한다. 안 그러면 대지 밖에 선 기둥이
  // 허공에 뜬 것처럼 보인다.
  sitePad: "#243449",
  slab: "#3d4f68",
  column: "#94a3b8",
  roof: "#cbd5e1",
  // 벽체를 순백에 가깝게 두면 빈 수조에서 안쪽 벽이 정면으로 빛을 받아
  // 하얗게 날아간다. 한 단계 낮춘다.
  tankWall: "#cbd5e1",
  water: "#0e7490",
  /** 물을 뺀 수조 바닥. 물색과 확실히 달라야 비었다는 게 읽힌다. */
  dryFloor: "#5b6b82",
  tankFloor: "#475569",
} as const

/** 수조 테두리로 상태 색을 두르는 띠의 높이. */
const RIM = 0.12

// ─── 지오메트리 헬퍼 ──────────────────────────────────────────────────────────

/** XZ 폴리곤을 Shape 로 바꾼다.
 *
 *  THREE.Shape 는 XY 평면에서 만들어지고 ExtrudeGeometry 는 +Z 로 뽑는다.
 *  만든 뒤 X축으로 -90° 돌리면 shape 의 Y 가 월드 -Z 로 가므로, 애초에 z 를
 *  뒤집어 넣어야 도면과 같은 방향으로 선다.
 */
function toVec2(points: Point2[]): THREE.Vector2[] {
  return points.map(p => new THREE.Vector2(p.x, -p.z))
}

/** XZ 폴리곤을 얇은 판으로 뽑는다. y = 0 에서 위로 thickness 만큼 차지한다. */
function slabGeometry(points: Point2[], thickness: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(toVec2(points)), {
    depth: thickness,
    bevelEnabled: false,
  })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** 속이 빈 벽체. 바깥 윤곽에서 안쪽 윤곽을 도려내고 위로 뽑는다. */
function wallGeometry(outer: Point2[], inner: Point2[], height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(toVec2(outer))
  shape.holes.push(new THREE.Path(toVec2(inner)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  return geo
}

/** 비닐하우스 지붕 한 동(棟). 반타원 아치를 길이 방향으로 뽑아 만든다.
 *
 *  단면을 XY 평면에 그리고 +Z 로 뽑은 뒤 Y축으로 90° 돌려서, 아치가 건물
 *  깊이 방향으로 걸치고 길이 방향으로 이어지게 한다.
 */
function vaultGeometry(span: number, rise: number, length: number, thickness: number): THREE.ExtrudeGeometry {
  const rx = span / 2
  const ry = rise
  const seg = 48
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (Math.PI * i) / seg
    pts.push(new THREE.Vector2(rx * Math.cos(a), ry * Math.sin(a)))
  }
  for (let i = seg; i >= 0; i--) {
    const a = (Math.PI * i) / seg
    pts.push(new THREE.Vector2((rx - thickness) * Math.cos(a), (ry - thickness) * Math.sin(a)))
  }
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: length, bevelEnabled: false })
  geo.rotateY(Math.PI / 2)
  geo.translate(-length / 2, 0, 0)
  return geo
}

/** 모서리를 자른 팔각형 대지 윤곽. */
function octagon(width: number, depth: number, cut: number): Point2[] {
  const hw = width / 2
  const hd = depth / 2
  return [
    { x: -hw + cut, z: -hd },
    { x: hw - cut, z: -hd },
    { x: hw, z: -hd + cut },
    { x: hw, z: hd - cut },
    { x: hw - cut, z: hd },
    { x: -hw + cut, z: hd },
    { x: -hw, z: hd - cut },
    { x: -hw, z: -hd + cut },
  ]
}

/** 폴리곤을 감싸는 사각형의 한가운데. 이름표를 띄울 자리로 쓴다. */
function boundsCenter(points: Point2[]): { x: number; z: number } {
  const xs = points.map(p => p.x)
  const zs = points.map(p => p.z)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  }
}

// ─── 수조 ─────────────────────────────────────────────────────────────────────

interface TankMeshProps {
  spec: TankSpec
  /** 이 자리에 연결된 수조. 아직 안 만든 자리면 null. */
  tank: TankDisplay | null
  selected: boolean
  hovered: boolean
  onSelect: (slot: string) => void
  onHover: (slot: string | null) => void
}

function TankMesh({ spec, tank, selected, hovered, onSelect, onHover }: TankMeshProps) {
  const rim = useRef<THREE.Mesh>(null)
  const status = tank?.status ?? "inactive"
  const color = STATUS_COLOR[status]
  const filled = status !== "inactive"

  const inner = useMemo(
    () => insetPolygon(spec.outline, spec.wallThickness),
    [spec.outline, spec.wallThickness],
  )
  const floorGeo = useMemo(() => slabGeometry(spec.outline, 0.06), [spec.outline])
  const wallGeo = useMemo(
    () => wallGeometry(spec.outline, inner, spec.wallHeight - RIM),
    [spec.outline, inner, spec.wallHeight],
  )
  const rimGeo = useMemo(() => wallGeometry(spec.outline, inner, RIM), [spec.outline, inner])
  const waterGeo = useMemo(() => slabGeometry(inner, spec.waterDepth), [inner, spec.waterDepth])

  const center = useMemo(() => boundsCenter(spec.outline), [spec.outline])

  // 선택 표시는 벽 윗면 띠를 뛰게 해서 준다. 수조 두 기가 건물 바닥을 꽉
  // 채우고 있어서, 바닥에 테두리를 깔면 수조 밑에 들어가 보이지 않는다.
  useFrame(({ clock }) => {
    if (!rim.current) return
    const m = rim.current.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = selected ? 0.75 + 0.55 * Math.sin(clock.elapsedTime * 2.5) : 0.45
  })

  return (
    <group
      onClick={e => {
        e.stopPropagation()
        onSelect(spec.slot)
      }}
      onPointerOver={e => {
        e.stopPropagation()
        onHover(spec.slot)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        onHover(null)
        document.body.style.cursor = "auto"
      }}
    >
      {/* 수조 바닥 */}
      <mesh geometry={floorGeo} receiveShadow>
        <meshStandardMaterial color={filled ? COLOR.tankFloor : COLOR.dryFloor} roughness={0.95} />
      </mesh>

      {/* 물 — 비어 있는 수조는 아예 그리지 않는다. 깊이 0 인 물을 놓으면
          바닥을 뚫고 나와 부풀어 보인다. */}
      {filled && (
        <mesh geometry={waterGeo} position={[0, 0.06, 0]}>
          {/* 660 m² 짜리 평면이라 거칠기를 낮추면 태양 반사가 흰 얼룩으로
              크게 번진다. 잔물결이 있는 실제 수면에 가깝게 올린다. */}
          <meshStandardMaterial color={COLOR.water} transparent opacity={0.9} roughness={0.42} metalness={0} />
        </mesh>
      )}

      {/* 벽체 */}
      <mesh geometry={wallGeo} castShadow receiveShadow>
        <meshStandardMaterial
          color={COLOR.tankWall}
          roughness={0.7}
          emissive={hovered ? color : "#000000"}
          emissiveIntensity={hovered ? 0.3 : 0}
        />
      </mesh>

      {/* 벽 윗면 띠 — 상태 색을 여기에 입힌다. 위에서 내려다볼 때 가장 잘
          보이고, 선택하면 이 띠가 뛴다 */}
      <mesh ref={rim} geometry={rimGeo} position={[0, spec.wallHeight - RIM, 0]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.5} />
      </mesh>

      <Html
        center
        position={[center.x, spec.wallHeight + 1.6, center.z]}
        distanceFactor={34}
        zIndexRange={[10, 0]}
      >
        <div
          className="pointer-events-none select-none whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            background: selected || hovered ? color : "rgba(15,23,42,0.8)",
            color: selected || hovered ? "#ffffff" : "#cbd5e1",
            border: `1px solid ${color}`,
          }}
        >
          {tank?.name ?? spec.label}
        </div>
      </Html>
    </group>
  )
}

// ─── 씬 ───────────────────────────────────────────────────────────────────────

export interface SceneProps {
  layout: Farm3DLayout
  /** 자리 번호 → 표시할 수조. 연결 안 된 자리는 키가 없다. */
  tankBySlot: Record<string, TankDisplay>
  selected: string | null
  hovered: string | null
  onSelect: (slot: string | null) => void
  onHover: (slot: string | null) => void
  showRoof: boolean
}

export function FarmScene({ layout, tankBySlot, selected, hovered, onSelect, onHover, showRoof }: SceneProps) {
  const { site, building, columns, tanks } = layout

  const sitePadGeo = useMemo(
    () => slabGeometry(octagon(site.width, site.depth, site.cornerCut), 0.15),
    [site.width, site.depth, site.cornerCut],
  )
  const slabGeo = useMemo(() => slabGeometry(building.footprint, 0.25), [building.footprint])

  const columnGeo = useMemo(
    () => new THREE.CylinderGeometry(columns.radius, columns.radius, building.eaveHeight, 8),
    [columns.radius, building.eaveHeight],
  )

  /** 기둥 자리. 도면의 원(圓) 표기를 그대로 옮긴 것이다 — 바깥 둘레 한 바퀴에
   *  가운데 열이 하나 더 있다. 가운데 열은 두 수조를 가르는 벽 위에 선다. */
  const columnPositions = useMemo(() => {
    const xs = spansToPositions(columns.xSpans)
    const zs = spansToPositions(columns.zSpans)
    const zFront = zs[0]
    const zBack = zs[zs.length - 1]
    const zMid = zs[Math.floor(zs.length / 2)]
    const out: [number, number][] = []

    for (const x of xs) {
      out.push([x, zFront], [x, zBack], [x, zMid])
    }
    // 좌우 마구리는 위에서 이미 양 끝을 넣었으니 사이 열만 채운다.
    for (const z of zs.slice(1, -1)) {
      if (z === zMid) continue
      out.push([xs[0], z], [xs[xs.length - 1], z])
    }
    return out
  }, [columns.xSpans, columns.zSpans])

  /** 지붕 두 동. 대지 깊이를 반씩 나눠 걸친다. */
  const vaultGeo = useMemo(
    () =>
      vaultGeometry(
        site.depth / 2,
        building.ridgeHeight - building.eaveHeight,
        site.width,
        0.06,
      ),
    [site.depth, site.width, building.ridgeHeight, building.eaveHeight],
  )
  const vaultZ = useMemo(() => [-site.depth / 4, site.depth / 4], [site.depth])

  return (
    <group>
      {/* 배경 지면 — 대지 밖은 넓게 깔아 지평선을 만든다 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={COLOR.ground} roughness={1} />
      </mesh>

      {/* 대지 — 윗면이 y = -0.25 에 오게 놓는다 */}
      <mesh geometry={sitePadGeo} position={[0, -0.4, 0]} receiveShadow>
        <meshStandardMaterial color={COLOR.sitePad} roughness={0.95} />
      </mesh>

      {/* 건물 바닥 슬래브 — 윗면이 y = 0. 수조는 이 위에 선다 */}
      <mesh geometry={slabGeo} position={[0, -0.25, 0]} receiveShadow>
        <meshStandardMaterial color={COLOR.slab} roughness={0.9} />
      </mesh>

      {/* 기둥 */}
      {columnPositions.map(([x, z], i) => (
        <mesh
          key={i}
          geometry={columnGeo}
          position={[x, building.eaveHeight / 2, z]}
          castShadow
        >
          <meshStandardMaterial color={COLOR.column} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}

      {/* 지붕 — 차광막 겹마감 + 비닐 1겹이라 반투명으로 둔다.
          안을 보려고 끄는 경우가 많아 토글로 뺐다.
          그림자는 일부러 끈다. 비닐·차광막은 빛을 통과시키는데 castShadow 를
          켜면 불투명체처럼 실내 전체를 덮어 바닥과 수조가 죽는다. */}
      {showRoof &&
        vaultZ.map((z, i) => (
          <mesh key={i} geometry={vaultGeo} position={[0, building.eaveHeight, z]}>
            <meshStandardMaterial
              color={COLOR.roof}
              transparent
              opacity={0.22}
              roughness={0.4}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}

      {/* 수조 */}
      {tanks.map(spec => (
        <TankMesh
          key={spec.slot}
          spec={spec}
          tank={tankBySlot[spec.slot] ?? null}
          selected={selected === spec.slot}
          hovered={hovered === spec.slot}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}

      {/* 조명 — 하늘/땅 반사광에 태양 하나. HDRI 를 받아오지 않으므로
          외부 네트워크 없이 렌더된다. */}
      <hemisphereLight args={["#bcd4ff", "#0b1220", 1.1]} />
      <directionalLight
        position={[38, 46, 26]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={140}
        // 90 m 를 덮는 그림자맵이라 픽셀 하나가 4 cm 를 넘는다. 그대로 두면
        // 벽 같은 면에 제 그림자가 줄무늬로 얼룩진다(shadow acne).
        shadow-normalBias={0.08}
      />
      <directionalLight position={[-30, 20, -20]} intensity={0.35} />
    </group>
  )
}
