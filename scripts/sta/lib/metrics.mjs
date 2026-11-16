// 사례별 결과 → 혼동행렬·최종값.
//
// 측정(eval-anomaly.mjs)과 재계산(recompute.mjs)이 **같은 이 함수**를 쓴다.
// 셈법이 두 벌이면 반올림 한 자리 차이로 "불일치" 가 난다.
//
// 정의 (양성 = 이상)
//   TP  정답 이상 · 판정 이상      FN  정답 이상 · 판정 정상
//   FP  정답 정상 · 판정 이상      TN  정답 정상 · 판정 정상
//   재현율(탐지율) = TP / (TP + FN)
//   정밀도         = TP / (TP + FP)
//   F1             = 2 × 정밀도 × 재현율 / (정밀도 + 재현율) = 2TP / (2TP + FP + FN)
//   정확도         = (TP + TN) / 전체
//   오경보율       = FP / (FP + TN)
// 분모가 0 이면 값은 null(계산 불가)이다. 값은 소수 넷째 자리로 반올림해 적는다.

export const ABNORMAL = "이상"
export const NORMAL = "정상"

/** 소수 넷째 자리 반올림. 분모 0 이면 null. */
export function ratio(num, den) {
  if (!den) return null
  return Math.round((num / den) * 1e4) / 1e4
}

/** rows: [{ 정답, 판정 }] — 값은 "이상" | "정상". */
export function summarize(rows) {
  let TP = 0, FN = 0, FP = 0, TN = 0
  for (const r of rows) {
    const truth = r["정답"], got = r["판정"]
    if (truth !== ABNORMAL && truth !== NORMAL) throw new Error(`정답 값이 이상/정상이 아닙니다: ${JSON.stringify(truth)}`)
    if (got !== ABNORMAL && got !== NORMAL) throw new Error(`판정 값이 이상/정상이 아닙니다: ${JSON.stringify(got)}`)
    if (truth === ABNORMAL) { if (got === ABNORMAL) TP++; else FN++ }
    else if (got === ABNORMAL) FP++; else TN++
  }
  return {
    "사례수": { "전체": rows.length, "이상": TP + FN, "정상": FP + TN },
    "혼동행렬": { TP, FN, FP, TN },
    "재현율": ratio(TP, TP + FN),
    "정밀도": ratio(TP, TP + FP),
    "F1": ratio(2 * TP, 2 * TP + FP + FN),
    "정확도": ratio(TP + TN, rows.length),
    "오경보율": ratio(FP, FP + TN),
  }
}

/** 전체 + 출처별(실측·모사) 값. 출처 순서는 고정한다. */
export function summarizeAll(rows) {
  const out = { "전체": summarize(rows), "출처별": {} }
  for (const src of ["실측", "모사"]) {
    out["출처별"][src] = summarize(rows.filter(r => r["출처"] === src))
  }
  return out
}

/** 기준 판정. 재현율은 반올림 전 값(TP/(TP+FN))으로 비교한다 — 반올림으로 통과하지 않게. */
export function verdict(confusion, threshold) {
  if (threshold === null || threshold === undefined) return "보류(기준값 미설정)"
  const den = confusion.TP + confusion.FN
  if (!den) return "판정 불가(이상 사례 없음)"
  // TP/den >= threshold  ⇔  TP >= threshold × den (부동소수 오차는 1e-9 로 흡수)
  return confusion.TP + 1e-9 >= threshold * den ? "적합" : "부적합"
}
