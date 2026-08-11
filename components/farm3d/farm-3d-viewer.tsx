"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib"
import { FarmScene } from "@/components/farm3d/scene"
import type { Farm3DLayout } from "@/lib/farm3d/layout"
import type { Tank } from "@/types"

// ─── 시점 ─────────────────────────────────────────────────────────────────────

export type ViewKey = "overview" | "top" | "front"

/** 미리 잡아 둔 시점. 63 × 27 m 대지가 화면에 꽉 차게 맞춘 값이다. */
const VIEWS: Record<ViewKey, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [40, 29, 42], target: [0, 1.5, 0] },
  // 정확히 수직으로 내려다보면 카메라 up 벡터가 시선과 나란해져 회전각이
  // 정해지지 않는다 — 건물이 제멋대로 기울어 보인다. 살짝 뒤로 뺀다.
  top: { pos: [0, 62, 21], target: [0, 0, 0] },
  // 처마·용마루 높이가 보이도록 건물 전체가 화면에 들어오게 뺀다.
  front: { pos: [0, 15, 68], target: [0, 3, 0] },
}

/** 버튼으로 시점을 바꾸면 카메라를 그 자리까지 부드럽게 옮긴다.
 *
 *  사용자가 마우스를 잡는 순간 이동을 멈춘다 — 안 그러면 끌고 있는 화면을
 *  코드가 도로 뺏어 간다. */
function CameraRig({
  view,
  controlsRef,
  movingRef,
}: {
  view: ViewKey
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  movingRef: React.RefObject<boolean>
}) {
  const { camera } = useThree()
  const goalPosRef = useRef(new THREE.Vector3())
  const goalTargetRef = useRef(new THREE.Vector3())

  useEffect(() => {
    goalPosRef.current.set(...VIEWS[view].pos)
    goalTargetRef.current.set(...VIEWS[view].target)
    movingRef.current = true
  }, [view, movingRef])

  useFrame((_, dt) => {
    if (!movingRef.current) return
    // 프레임레이트가 달라도 같은 속도로 붙게 지수 감쇠를 쓴다.
    const k = 1 - Math.pow(0.002, Math.min(dt, 0.1))
    camera.position.lerp(goalPosRef.current, k)
    const c = controlsRef.current
    if (c) {
      c.target.lerp(goalTargetRef.current, k)
      c.update()
    }
    if (camera.position.distanceTo(goalPosRef.current) < 0.4) movingRef.current = false
  })

  return null
}

// ─── 뷰어 ─────────────────────────────────────────────────────────────────────

export interface Farm3DViewerProps {
  layout: Farm3DLayout
  tankBySlot: Record<string, Tank>
  selected: string | null
  hovered: string | null
  onSelect: (slot: string | null) => void
  onHover: (slot: string | null) => void
  showRoof: boolean
  view: ViewKey
}

/** 3D 캔버스. three.js 는 브라우저 전용이라 이 파일은 반드시 클라이언트에서만
 *  불러야 한다 — 쓰는 쪽에서 next/dynamic 의 ssr:false 로 감싼다. */
export default function Farm3DViewer({
  layout,
  tankBySlot,
  selected,
  hovered,
  onSelect,
  onHover,
  showRoof,
  view,
}: Farm3DViewerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const movingRef = useRef(false)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ fov: 45, near: 0.5, far: 600, position: VIEWS.overview.pos }}
      // 빈 곳을 누르면 선택이 풀린다.
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#020617"]} />
      <fog attach="fog" args={["#020617", 95, 280]} />

      <FarmScene
        layout={layout}
        tankBySlot={tankBySlot}
        selected={selected}
        hovered={hovered}
        onSelect={onSelect}
        onHover={onHover}
        showRoof={showRoof}
      />

      <CameraRig view={view} controlsRef={controlsRef} movingRef={movingRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={12}
        maxDistance={170}
        // 지면 아래로 내려가면 건물이 뒤집혀 보인다. 수평 조금 위에서 멈춘다.
        maxPolarAngle={Math.PI / 2 - 0.04}
        onStart={() => {
          movingRef.current = false
        }}
      />
    </Canvas>
  )
}
