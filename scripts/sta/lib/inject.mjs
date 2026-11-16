// 모사 사례의 이상 주입 — 한 건이 시각 t 에 더하는 값.
//   계단  「시각」부터 끝까지 「크기」
//   경사  「시작」~「끝」 사이에 0 → 「크기」로 곧게, 그 뒤는 「크기」 유지
//   구간  「시작」~「끝」 사이에만 「크기」
import { parseTime } from "./cases.mjs"

export function injectionOffset(inj, t) {
  const size = Number(inj["크기"])
  if (!Number.isFinite(size)) throw new Error(`주입 크기가 숫자가 아닙니다: ${JSON.stringify(inj)}`)
  if (inj["종류"] === "계단") return t >= parseTime(inj["시각"]) ? size : 0
  const a = parseTime(inj["시작"]), b = parseTime(inj["끝"])
  if (!(b > a)) throw new Error(`주입 구간의 끝이 시작보다 뒤여야 합니다: ${JSON.stringify(inj)}`)
  if (inj["종류"] === "경사") return t <= a ? 0 : t >= b ? size : size * (t - a) / (b - a)
  if (inj["종류"] === "구간") return t >= a && t <= b ? size : 0
  throw new Error(`주입 종류는 계단/경사/구간 중 하나여야 합니다: ${JSON.stringify(inj["종류"])}`)
}
