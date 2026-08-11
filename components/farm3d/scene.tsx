"use client"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html } from "@react-three/drei"
import type { Farm3DLayout, TankSpec } from "@/lib/farm3d/layout"
import { spansToPositions } from "@/lib/farm3d/layout"
import type { Tank } from "@/types"

// ─── 색 ───────────────────────────────────────────────────────────────────────

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

// ─── 지오메트리 헬퍼 ──────────────────────────────────────────────────────────

/** XZ 폴리곤을 바닥판(얇은 판)으로 만든다.
 *
 *  THREE.Shape 는 XY 평면에서 만들어지고 ExtrudeGeometry 는 +Z 로 뽑는다.
 *  우리가 원하는 건 XZ 평면에 눕힌 판이라, 만든 뒤 X축으로 -90° 돌린다.
 *  이때 shape 의 Y 가 월드 Z 로 가므로 Z 부호가 뒤집힌다. 그래서 shape 를
 *  만들 때 z 를 그대로 넣고 회전으로 맞추는 대신, -z 로 넣어 두 번 뒤집히지
 *  않게 한다.
 */
function slabGeometry(points: { x: number; z: number }[], thickness: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
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
function octagon(width: number, depth: number, cut: number): { x: number; z: number }[] {
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

// ─── 수조 ─────────────────────────────────────────────────────────────────────

interface TankMeshProps {
  spec: TankSpec
  /** 이 자리에 연결된 DB 수조. 아직 안 만든 자리면 null. */
  tank: Tank | null
  selected: boolean
  hovered: boolean
  onSelect: (slot: string) => void
  onHover: (slot: string | null) => void
}

function TankMesh({ spec, tank, selected, hovered, onSelect, onHover }: TankMeshProps) {
  const ring = useRef<THREE.Mesh>(null)
  const r = spec.diameter / 2
  const status = tank?.status ?? "inactive"
  const color = STATUS_COLOR[status]
  const filled = status !== "inactive"

  const wallGeo = useMemo(
    () => new THREE.CylinderGeometry(r, r, spec.wallHeight, 40, 1, true),
    [r, spec.wallHeight],
  )
  const waterGeo = useMemo(
    () => new THREE.CylinderGeometry(r - 0.08, r - 0.08, spec.waterDepth, 40),
    [r, spec.waterDepth],
  )
  const floorGeo = useMemo(() => new THREE.CircleGeometry(r, 40), [r])
  const rimGeo = useMemo(() => new THREE.TorusGeometry(r, 0.07, 8, 48), [r])
  const haloGeo = useMemo(() => new THREE.RingGeometry(r + 0.25, r + 0.75, 48), [r])

  // 선택한 수조만 링을 천천히 뛰게 한다. 12기 중 어느 걸 보고 있는지
  // 시선을 잡아 주는 용도라, 나머지는 가만히 둔다.
  useFrame(({ clock }) => {
    if (!ring.current) return
    const m = ring.current.material as THREE.MeshBasicMaterial
    m.opacity = 0.35 + 0.25 * Math.sin(clock.elapsedTime * 2.5)
  })

  return (
    <group
      position={[spec.x, 0, spec.z]}
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
      {/* 바닥 */}
      <mesh geometry={floorGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <meshStandardMaterial color={filled ? COLOR.tankFloor : COLOR.dryFloor} roughness={0.95} />
      </mesh>

      {/* 물 — 비어 있는 수조는 아예 그리지 않는다. 높이 0 인 물을 놓으면
          원기둥이 바닥을 뚫고 나와 부풀어 보인다. */}
      {filled && (
        <mesh geometry={waterGeo} position={[0, spec.waterDepth / 2, 0]}>
          <meshStandardMaterial color={COLOR.water} transparent opacity={0.85} roughness={0.15} metalness={0.1} />
        </mesh>
      )}

      {/* 벽체 */}
      <mesh geometry={wallGeo} position={[0, spec.wallHeight / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial
          color={COLOR.tankWall}
          roughness={0.65}
          side={THREE.DoubleSide}
          emissive={hovered ? color : "#000000"}
          emissiveIntensity={hovered ? 0.25 : 0}
        />
      </mesh>

      {/* 상단 테두리 — 상태 색을 여기에 입힌다. 위에서 내려다볼 때 가장 잘 보인다 */}
      <mesh geometry={rimGeo} position={[0, spec.wallHeight, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.4} />
      </mesh>

      {/* 선택 표시 */}
      {selected && (
        <mesh ref={ring} geometry={haloGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      <Html center position={[0, spec.wallHeight + 0.9, 0]} distanceFactor={26} zIndexRange={[10, 0]}>
        <div
          className="pointer-events-none select-none whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            background: selected || hovered ? color : "rgba(15,23,42,0.75)",
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
  /** 자리 번호 → DB 수조. 연결 안 된 자리는 키가 없다. */
  tankBySlot: Record<string, Tank>
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
   *  가운데 열이 하나 더 있다. 가운데 열이 두 동 지붕이 만나는 골을 받는다. */
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={COLOR.ground} roughness={1} />
      </mesh>

      {/* 대지 */}
      <mesh geometry={sitePadGeo} position={[0, -0.15, 0]} receiveShadow>
        <meshStandardMaterial color={COLOR.sitePad} roughness={0.95} />
      </mesh>

      {/* 건물 바닥 슬래브 */}
      <mesh geometry={slabGeo} position={[0, 0, 0]} receiveShadow>
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
        // 수조 벽 같은 곡면에 제 그림자가 줄무늬로 얼룩진다(shadow acne).
        shadow-normalBias={0.08}
      />
      <directionalLight position={[-30, 20, -20]} intensity={0.35} />
    </group>
  )
}
