// Gompertz 성장곡선의 적합·예측·역산.
//
//     W = Winf · exp(−b · exp(−k · x))        x = 적산수온(℃·일), W = ABW(g)
//
// 참조 구현은 scripts/analysis/growth_curve_feasibility.py 이고, 그쪽 수치가
// docs/plans/tips-2026-dataset-assessment.md 2절의 근거다. 이 파일은 그 검증된
// 처방을 제품 코드로 옮긴 것이다 — **처방을 바꾸지 않는다.**
//
// ── 적합 방법 ────────────────────────────────────────────────────────────
// Winf 가 고정이면 남는 파라미터가 b·k 두 개뿐이라 곡선을 선형화할 수 있다.
//
//     ln(W / Winf)            = −b · exp(−k·x)
//     ln( −ln(W / Winf) )     = ln(b) − k·x
//
// 즉 y = ln(−ln(W/Winf)) 를 x 에 대해 단순 최소제곱 직선 적합하면 절편이 ln(b),
// 기울기가 −k 다. 반복 최적화도 의존성도 필요 없고 결과가 결정적이다.
//
// **선형화만으로는 참조 구현과 수치가 맞지 않아 Gauss-Newton 보정을 붙였다.**
// 선형화는 변환 공간의 오차를 줄이는데, y = ln(−ln(W/Winf)) 는 W 가 Winf 에
// 가까워질수록 −∞ 로 발산하므로 출하 직전 표본 한 점이 적합 전체를 끌고 간다.
// 우리 데이터의 7.5 g 이상 구간은 W/Winf 가 0.3~0.93 이라 바로 그 영역이다.
// 참조 구현(scipy curve_fit)은 원 공간에서 푼다.
//
// 실데이터 홀드아웃으로 둘을 재면 —
//
//     선형화만        전 수조 0.707 g · 수조{1,2,3} 0.744 g
//     보정 포함       전 수조 0.895 g · 수조{1,2,3} 0.986 g   ← 채택
//     참조 구현       전 수조 0.90  g · 수조{1,2,3} 0.99  g
//
// **선형화 쪽이 숫자가 더 낮은데도 보정을 채택한다.** 수용 기준은 "MAE 를 더
// 낮춰라"가 아니라 "검증된 참조 구현과 ±0.1 g 안에서 같은 수를 내라"이고,
// 선형화만 쓰면 0.19~0.25 g 벗어난다 — 즉 **다른 추정량**이다. 농가 5개 수조
// 하나의 홀드아웃에서 우연히 낮게 나온 것을 근거로 검증을 안 거친 추정량으로
// 바꾸면, 그 0.707 g 이 다른 농가에서도 유지되는지 아무도 모르는 상태가 된다.
// 성능 주장을 바꾸려면 참조 구현 쪽을 먼저 바꿔 다시 검증해야 한다.
//
// 보정을 켜면 수조별 MAE 가 참조 구현과 소수 둘째 자리까지 같다
// (0.56 / 1.74 / 0.66 / 1.27 / 0.24). 대조는 scripts/growth/verify.mjs 가 한다.
//
// ── ABW >= Winf 인 표본을 어떻게 다루는가 ─────────────────────────────────
// 선형화는 그 표본에서 정의되지 않는다 — W/Winf >= 1 이면 ln(W/Winf) >= 0 이라
// ln(−ln(…)) 이 ln(0) 또는 ln(음수)가 된다.
//
// **조용히 떨어뜨리지 않는다.** 떨어뜨리면 Winf 를 넘긴 큰 개체가 적합과 오차
// 계산에서 함께 사라져 평균이 좋아 보이고, 정작 중요한 신호("상한을 25 g 로
// 잡은 것이 틀렸다")가 지워진다.
//
// 그래서 두 갈래로 다룬다.
//   · 보정을 쓰는 기본 경로 — 원 공간 Gauss-Newton 은 그 표본도 그대로 쓸 수
//     있다. 선형화 가능한 표본으로 시작점만 잡고, 보정은 전 표본으로 돈다.
//     선형화 가능한 표본이 2건 미만이면 참조 구현의 p0 에서 시작한다.
//   · 보정을 끈 경로 — 정말로 쓸 수 없으므로 excluded 에 이유를 달아 돌려준다.
//
// 어느 쪽이든 atOrAboveWinfCount 로 **표본 수를 항상 돌려준다.** 호출자가
// 화면에 띄워 "Winf 를 올려야 한다"를 사람이 판단할 수 있게 하는 쪽이, 엔진이
// 혼자 Winf 를 올리는 것보다 낫다 — 그건 설계 규칙 1 을 우회하는 자유 적합이다.

import { DEFAULT_WINF_G, MIN_FIT_SAMPLES, STANZA_BREAK_G } from "./constants"

/** 적산수온 축에 올린 성장 실측 한 점. */
export type GrowthPoint = {
  /** 적산수온(℃·일). cumulativeDegreeDays 로 구한다. */
  cdd: number
  /** 개체 평균중량(g). */
  abwG: number
}

export type GompertzParams = {
  /** 상한중량(g). **적합하지 않는다** — 고정값이다. */
  winfG: number
  b: number
  k: number
}

export type ExclusionReason =
  /** cdd 나 abwG 가 숫자가 아니거나 유한하지 않다. */
  | "not_finite"
  /** ABW 가 0 이하. 로그 변환이 정의되지 않는다. */
  | "abw_not_positive"
  /** 7.5 g stanza break 아래. 설계 규칙 2 에 따른 의도적 제외. */
  | "below_stanza_break"
  /** ABW >= Winf. 선형화가 정의되지 않는다. Winf 를 올리라는 신호일 수 있다. */
  | "abw_at_or_above_winf"

export type ExcludedPoint = {
  /** 입력 배열에서의 위치. 화면에서 어느 표본인지 짚을 수 있어야 한다. */
  index: number
  cdd: number
  abwG: number
  reason: ExclusionReason
}

export type FitFailure =
  /** Winf 가 유한한 양수가 아니다. */
  | "invalid_winf"
  /** 쓸 수 있는 표본이 0 건. */
  | "no_samples"
  /** 쓸 수 있는 표본이 minSamples 미만. */
  | "insufficient_samples"
  /** 모든 표본의 적산수온이 같다 — 직선의 기울기가 정의되지 않는다. */
  | "degenerate_axis"
  /** 계산 결과가 유한하지 않다. */
  | "non_finite_params"

export type FitMethod =
  /** 선형화 닫힌 해만. */
  | "linearized"
  /** 선형화 해를 시작점으로 원 공간 Gauss-Newton 보정. 기본 경로다. */
  | "linearized+gauss-newton"
  /** 선형화 가능한 표본이 모자라 기본 시작점에서 Gauss-Newton 만. */
  | "gauss-newton"

export type GompertzFit = {
  /** 적합 실패면 null. 그때 failure 에 이유가 담긴다. */
  params: GompertzParams | null
  failure: FitFailure | null
  /** 적합에 실제로 쓴 표본 수. 화면에 이 n 을 함께 띄운다. */
  n: number
  /** 적합에 쓰지 않은 표본과 그 이유. **조용히 떨어뜨리지 않는다.** */
  excluded: ExcludedPoint[]
  /**
   * ABW >= Winf 인 표본 수. 보정을 쓰면 이 표본도 적합에 들어가므로 excluded 에
   * 나타나지 않지만, **Winf 를 올려야 한다는 신호**라서 방법과 무관하게 항상
   * 세어 돌려준다. 호출자가 화면에 띄울 수 있도록.
   */
  atOrAboveWinfCount: number
  method: FitMethod
  /** Gauss-Newton 이 받아들인 스텝 수. 0 이면 선형화 해가 그대로 남았다. */
  iterations: number
  /**
   * 적합에 쓴 표본의 원 공간 MAE(g). 학습 오차이므로 **성능 지표가 아니다** —
   * 성능은 홀드아웃 MAE 로만 본다(설계 규칙 5). 구현이 돌아가는지 보는 값이다.
   */
  trainMaeG: number | null
}

export type FitOptions = {
  /** 고정 상한중량(g). 기본 25 g. **자유 적합 경로는 없다.** */
  winfG?: number
  /** 구간 경계(g). 기본 7.5 g. null 을 넘기면 구간을 끊지 않는다(검증용). */
  stanzaBreakG?: number | null
  /** 최소 표본 수. 기본 3. */
  minSamples?: number
  /** 원 공간 Gauss-Newton 보정. 기본 켬 — 끄면 참조 구현과 수치가 맞지 않는다. */
  refine?: boolean
}

// Gauss-Newton 의 반복 상한·감쇠. 전부 고정값이라 같은 입력이면 같은 결과가 난다.
const GN_MAX_ATTEMPTS = 200
const GN_LAMBDA0 = 1e-3
const GN_LAMBDA_MAX = 1e12
const GN_REL_TOLERANCE = 1e-14

// 선형화할 표본이 모자랄 때의 시작점. 참조 구현 curve_fit 의 p0 와 같다.
const GN_FALLBACK_SEED = { b: 5, k: 0.002 }

/** 적산수온 한 점의 예측 ABW(g). */
export function predictAbw(params: GompertzParams, cdd: number): number {
  return params.winfG * Math.exp(-params.b * Math.exp(-params.k * cdd))
}

export type CddForAbwFailure =
  | "invalid_params"
  | "target_not_positive"
  /** 곡선이 Winf 를 넘지 못하므로 그 목표에는 영원히 도달하지 않는다. */
  | "target_at_or_above_winf"
  | "non_finite_result"

export type CddForAbwResult = { cdd: number | null; failure: CddForAbwFailure | null }

/**
 * 역산 — 목표 ABW 에 도달하는 적산수온.
 *
 *     x = −ln( −ln(W/Winf) / b ) / k
 *
 * 엔진 3(출하 윈도우)이 "며칠 뒤 25 g" 을 물을 때 쓴다. 적산수온을 날짜로 바꾸는
 * 것은 이 모듈의 일이 아니다 — 남은 적산수온을 예상 수온으로 나누는 쪽은 수온
 * 전망이 필요하고, 그건 엔진 3 의 몫이다.
 *
 * **음수가 나올 수 있다.** 목표 ABW 가 축의 원점(입식) 시점보다 앞서 도달하는
 * 값이면 수학적으로 음수가 나오고, 그대로 돌려준다. 호출자가 현재 적산수온과
 * 비교해 "이미 지났다"로 읽으면 된다 — 0 으로 잘라 주면 그 구분이 사라진다.
 */
export function cddForAbw(params: GompertzParams, targetAbwG: number): CddForAbwResult {
  const { winfG, b, k } = params
  const paramsOk =
    Number.isFinite(winfG) && winfG > 0 && Number.isFinite(b) && b > 0 && Number.isFinite(k) && k > 0
  if (!paramsOk) return { cdd: null, failure: "invalid_params" }
  if (!Number.isFinite(targetAbwG) || targetAbwG <= 0) {
    return { cdd: null, failure: "target_not_positive" }
  }
  if (targetAbwG >= winfG) return { cdd: null, failure: "target_at_or_above_winf" }

  const cdd = -Math.log(-Math.log(targetAbwG / winfG) / b) / k
  if (!Number.isFinite(cdd)) return { cdd: null, failure: "non_finite_result" }
  return { cdd, failure: null }
}

/**
 * 홀드아웃 MAE(g) — **엔진 1 의 유일한 성능 지표다**(설계 규칙 5).
 *
 * R² 를 돌려주는 함수는 두지 않는다. 전 구간 R² 0.99 와 홀드아웃 MAE 32 g 이
 * 동시에 나온 적이 있고, R² 를 쥐어 주면 그 수가 화면에 올라간다.
 */
export function meanAbsoluteErrorG(
  params: GompertzParams,
  points: readonly GrowthPoint[],
): { maeG: number | null; n: number } {
  let sum = 0
  let n = 0
  for (const p of points) {
    if (!Number.isFinite(p.cdd) || !Number.isFinite(p.abwG)) continue
    const err = Math.abs(predictAbw(params, p.cdd) - p.abwG)
    if (!Number.isFinite(err)) continue
    sum += err
    n++
  }
  return { maeG: n > 0 ? sum / n : null, n }
}

/** 선형화 닫힌 해. 0 < abwG < winfG 인 표본만 들어와야 한다. */
function linearizedSolution(
  points: readonly GrowthPoint[],
  winfG: number,
): { b: number; k: number } | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  const ys: number[] = []
  for (const p of points) {
    const y = Math.log(-Math.log(p.abwG / winfG))
    if (!Number.isFinite(y)) return null
    ys.push(y)
    sx += p.cdd
    sy += y
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = points[i].cdd - mx
    sxx += dx * dx
    sxy += dx * (ys[i] - my)
  }
  if (!(sxx > 0)) return null
  const slope = sxy / sxx
  const b = Math.exp(my - slope * mx)
  const k = -slope
  if (!Number.isFinite(b) || !Number.isFinite(k)) return null
  return { b, k }
}

function sumSquaredError(points: readonly GrowthPoint[], winfG: number, b: number, k: number): number {
  let sse = 0
  for (const p of points) {
    const residual = winfG * Math.exp(-b * Math.exp(-k * p.cdd)) - p.abwG
    if (!Number.isFinite(residual)) return Number.POSITIVE_INFINITY
    sse += residual * residual
  }
  return sse
}

/**
 * 원 공간 제곱오차를 줄이는 Gauss-Newton. 감쇠는 Marquardt 의 대각 스케일링을
 * 쓴다 — 적산수온이 수천이고 k 가 0.001 수준이라 두 파라미터의 스케일이 1000배
 * 넘게 차이 나는데, 스칼라 감쇠(λI)는 그 차이를 전혀 보정하지 못한다.
 *
 *     ∂W/∂b = −W·u ,  ∂W/∂k = W·b·x·u  (u = exp(−k·x))
 */
function gaussNewtonRefine(
  points: readonly GrowthPoint[],
  winfG: number,
  seed: { b: number; k: number },
): { b: number; k: number; iterations: number } {
  let b = seed.b
  let k = seed.k
  let sse = sumSquaredError(points, winfG, b, k)
  let lambda = GN_LAMBDA0
  let accepted = 0

  for (let attempt = 0; attempt < GN_MAX_ATTEMPTS; attempt++) {
    if (!Number.isFinite(sse)) break

    // 정규방정식 JᵀJ · δ = −Jᵀr 를 2×2 로 쌓는다.
    let jbb = 0
    let jbk = 0
    let jkk = 0
    let gb = 0
    let gk = 0
    for (const p of points) {
      const u = Math.exp(-k * p.cdd)
      const w = winfG * Math.exp(-b * u)
      const dB = -w * u
      const dK = w * b * p.cdd * u
      const r = w - p.abwG
      if (!Number.isFinite(dB) || !Number.isFinite(dK) || !Number.isFinite(r)) return { b, k, iterations: accepted }
      jbb += dB * dB
      jbk += dB * dK
      jkk += dK * dK
      gb += dB * r
      gk += dK * r
    }

    const abb = jbb * (1 + lambda)
    const akk = jkk * (1 + lambda)
    const det = abb * akk - jbk * jbk
    if (!Number.isFinite(det) || det === 0) {
      lambda *= 10
      if (lambda > GN_LAMBDA_MAX) break
      continue
    }
    const db = (-gb * akk + gk * jbk) / det
    const dk = (-gk * abb + gb * jbk) / det
    if (!Number.isFinite(db) || !Number.isFinite(dk)) break

    const nextSse = sumSquaredError(points, winfG, b + db, k + dk)
    if (Number.isFinite(nextSse) && nextSse < sse) {
      const improvement = sse - nextSse
      b += db
      k += dk
      sse = nextSse
      accepted++
      lambda = Math.max(lambda / 10, 1e-12)
      if (improvement <= GN_REL_TOLERANCE * Math.max(sse, 1)) break
    } else {
      lambda *= 10
      if (lambda > GN_LAMBDA_MAX) break
    }
  }

  return { b, k, iterations: accepted }
}

/**
 * (적산수온, ABW) 쌍 → {b, k}. Winf 는 고정이고 적합하지 않는다.
 *
 * 기본값이 설계 규칙 1·2 를 둘 다 적용한 상태다 — Winf 25 g 고정 + 7.5 g 이상.
 * **두 규칙은 반드시 같이 쓴다.** 구간만 끊고 Winf 를 풀면 네 처방 중 가장
 * 나쁘다(15.51 g). 이 모듈에 Winf 자유 적합 경로를 두지 않는 이유다.
 *
 * 실패와 제외를 조용히 넘기지 않는다. n·excluded·atOrAboveWinfCount 를 전부
 * 돌려주므로 호출자가 화면에 띄울 수 있다. **문장은 만들지 않는다** — 다국어
 * 리포트(엔진 6)가 그 위에 올라간다.
 */
export function fitGompertz(points: readonly GrowthPoint[], options: FitOptions = {}): GompertzFit {
  const winfG = options.winfG ?? DEFAULT_WINF_G
  const stanzaBreakG = options.stanzaBreakG === undefined ? STANZA_BREAK_G : options.stanzaBreakG
  const minSamples = options.minSamples ?? MIN_FIT_SAMPLES
  const refine = options.refine ?? true

  const empty = (failure: FitFailure, excluded: ExcludedPoint[] = [], atOrAbove = 0): GompertzFit => ({
    params: null,
    failure,
    n: 0,
    excluded,
    atOrAboveWinfCount: atOrAbove,
    method: refine ? "linearized+gauss-newton" : "linearized",
    iterations: 0,
    trainMaeG: null,
  })

  if (!Number.isFinite(winfG) || winfG <= 0) return empty("invalid_winf")

  // ── 표본 분류 ────────────────────────────────────────────────────────
  // linearizable : 0 < ABW < Winf. 선형화와 보정 둘 다 쓸 수 있다.
  // atOrAbove    : ABW >= Winf. 선형화는 불가, 원 공간 보정은 가능.
  // excluded     : 쓸 수 없거나 설계상 제외한 표본.
  const linearizable: GrowthPoint[] = []
  const atOrAbove: GrowthPoint[] = []
  const excluded: ExcludedPoint[] = []

  for (let index = 0; index < points.length; index++) {
    const { cdd, abwG } = points[index]
    if (!Number.isFinite(cdd) || !Number.isFinite(abwG)) {
      excluded.push({ index, cdd, abwG, reason: "not_finite" })
    } else if (abwG <= 0) {
      excluded.push({ index, cdd, abwG, reason: "abw_not_positive" })
    } else if (stanzaBreakG !== null && abwG < stanzaBreakG) {
      excluded.push({ index, cdd, abwG, reason: "below_stanza_break" })
    } else if (abwG >= winfG) {
      atOrAbove.push({ cdd, abwG })
      // 보정을 쓰지 않으면 이 표본은 정말로 버려지므로 excluded 에도 남긴다.
      // 보정을 쓰면 적합에 들어가므로 남기지 않되, atOrAboveWinfCount 로 항상 알린다.
      if (!refine) excluded.push({ index, cdd, abwG, reason: "abw_at_or_above_winf" })
    } else {
      linearizable.push({ cdd, abwG })
    }
  }

  const atOrAboveWinfCount = atOrAbove.length
  const fitPoints = refine ? [...linearizable, ...atOrAbove] : linearizable

  if (fitPoints.length === 0) return empty("no_samples", excluded, atOrAboveWinfCount)
  if (fitPoints.length < minSamples) {
    return empty("insufficient_samples", excluded, atOrAboveWinfCount)
  }

  // 적산수온이 전부 같으면 x 가 정보를 전혀 담지 않는다. 이때는 b·k 가
  // 식별되지 않으므로 **보정을 켜도** 적합하지 않는다 — 감쇠 반복은 그럴듯한
  // 값을 하나 내놓지만 그 값에는 아무 뜻이 없다.
  if (fitPoints.every((p) => p.cdd === fitPoints[0].cdd)) {
    return empty("degenerate_axis", excluded, atOrAboveWinfCount)
  }

  // null 이면 선형화 가능한 표본이 2건 미만이거나 변환이 발산했다(ABW 가 Winf 에
  // 극히 가까우면 ln(−ln(W/Winf)) 가 −∞ 로 간다).
  const seed = linearizedSolution(linearizable, winfG)
  if (seed === null && !refine) {
    return empty("non_finite_params", excluded, atOrAboveWinfCount)
  }

  let method: FitMethod
  let b: number
  let k: number
  let iterations = 0

  if (!refine && seed !== null) {
    method = "linearized"
    b = seed.b
    k = seed.k
  } else {
    const start = seed ?? GN_FALLBACK_SEED
    method = seed === null ? "gauss-newton" : "linearized+gauss-newton"
    const refined = gaussNewtonRefine(fitPoints, winfG, start)
    b = refined.b
    k = refined.k
    iterations = refined.iterations
  }

  if (!Number.isFinite(b) || !Number.isFinite(k)) {
    return { ...empty("non_finite_params", excluded, atOrAboveWinfCount), method }
  }

  const params: GompertzParams = { winfG, b, k }
  const { maeG } = meanAbsoluteErrorG(params, fitPoints)

  return {
    params,
    failure: null,
    n: fitPoints.length,
    excluded,
    atOrAboveWinfCount,
    method,
    iterations,
    trainMaeG: maeG,
  }
}
