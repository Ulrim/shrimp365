#!/usr/bin/env python3
"""로그만으로 최종값을 다시 계산한다 — 시험성적서용 독립 검산.

왜 따로 있나
------------
`eval_detect.py --log-dir` 가 남긴 **데이터별 로그**(예측 박스 한 개마다 한 줄,
정답 박스 한 개마다 한 줄)만 읽어 mAP@0.5 · mAP@0.5:0.95 · Precision · Recall ·
F1 · 계수 오차율을 처음부터 다시 계산하고, `03_최종결과.json` 의 값과 견준다.

* 모델도, 시험 이미지도, 라벨 파일도 읽지 않는다. **CSV 와 JSON 만** 읽는다.
* `eval_detect.py` 의 함수를 하나도 불러 쓰지 않는다. 같은 식을 여기에 따로 적었다.
  측정 프로그램에 계산 실수가 있으면 두 값이 어긋나 드러난다.
* 하나라도 다르면 종료 코드 1 로 끝난다(허용오차 1e-6).

쓰는 법
-------
    python ai/trainer/recompute_detect.py --dir <로그 폴더>

필요한 것: python 3.11+, numpy (그 밖에는 표준 라이브러리만)

읽는 파일
---------
    02_예측별_결과.csv   계산의 재료 ①  — 예측 박스 1개 = 1줄
    02_정답별_결과.csv   계산의 재료 ②  — 정답 박스 1개 = 1줄
    02_이미지별_결과.csv 교차 확인용     — 위 둘에서 센 이미지별 값과 같은지 본다.
                         예측도 정답도 없는 이미지는 위 둘에 줄이 없으므로,
                         이미지 **이름 목록**만은 여기서 가져온다(값은 쓰지 않는다)
    03_최종결과.json     견줄 상대       — 측정 프로그램이 낸 최종값

계산식
------
[1] 정답 총수  N = 02_정답별_결과.csv 의 줄 수

[2] AP (IoU 기준 t 마다)
    ① 모든 이미지의 예측을 신뢰도 내림차순으로 한 줄로 세운다.
       신뢰도가 똑같은 예측끼리는 측정 프로그램이 쓴 순서('전체순위' 열)를 따른다.
    ② k 번째까지의 누적 TP(k), 누적 FP(k) 를 센다. ('TP@t' 열이 1 이면 TP, 0 이면 FP)
    ③ 재현율 R(k) = TP(k) / N,  정밀도 P(k) = TP(k) / (TP(k) + FP(k))
    ④ 정밀도를 뒤에서부터 누적 최대값으로 덮는다:  P'(k) = max(P(k), P(k+1), …)
    ⑤ r = 0.00, 0.01, …, 1.00 (101점) 각각에서, R(k) ≥ r 인 첫 k 의 P'(k) 를 읽는다.
       그런 k 가 없으면(재현율이 r 에 못 미치면) 0.
    ⑥ AP = 그 101개 값의 평균   (COCO 101점 보간)

[3] mAP@0.5      = IoU 0.50 의 AP   (클래스가 하나이므로 AP 가 곧 mAP)
    mAP@0.5:0.95 = IoU 0.50, 0.55, …, 0.95 의 AP 10개의 평균

[4] 운영 임계값에서의 탐지 성능 (IoU 0.5)
    TP = 02_정답별_결과.csv 에서 '운영임계값에서_탐지' 가 1 인 줄 수
    FP = 02_예측별_결과.csv 에서 '운영임계값_이상' 이 1 인 줄 수 − TP
    FN = N − TP
    Precision = TP / (TP + FP),  Recall = TP / (TP + FN),  F1 = 2PR / (P + R)

[5] 계수 오차율 (이미지마다)
    검출 수 = 그 이미지에서 '운영임계값_이상' 이 1 인 예측 수
    정답 수 = 그 이미지의 정답 줄 수
    오차율  = |검출 수 − 정답 수| ÷ 정답 수        (정답 0마리 이미지는 제외)
    → 평균 · 중앙값 · 최대 · 허용오차(±20%) 이내인 이미지의 비율

다시 계산하지 않는 것
---------------------
예측과 정답의 짝짓기(IoU 매칭) 자체는 다시 하지 않는다. 좌표에서 IoU 를 새로
구하지 않고, 로그에 적힌 예측별 TP(0/1)·정답별 탐지(0/1)에서 출발해 그 뒤의
집계(누적·곡선·보간·평균·비율)를 모두 다시 한다.
부트스트랩 신뢰구간, 탐지율 95% 하한, 추론시간은 시험 기준이 아닌 참고값이라
여기서 다시 내지 않는다.

숫자 정밀도에 대하여
--------------------
측정 프로그램은 재현율·정밀도를 단정밀도(float32)로 계산한다. 여기서도 같은
정밀도로 계산해, 반올림 경계에서 소수 넷째 자리가 갈리는 일이 없게 했다.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from bisect import bisect_left
from pathlib import Path

import numpy as np

F_PRED = "02_예측별_결과.csv"
F_GT = "02_정답별_결과.csv"
F_IMAGE = "02_이미지별_결과.csv"
F_JSON = "03_최종결과.json"
F_OUT = "04_재계산_결과.txt"
TOLERANCE = 1e-6          # 견줄 때의 허용오차
DIGITS = 4                # 최종값은 소수 넷째 자리까지 적는다(측정 프로그램과 같다)


class LogError(Exception):
    """로그 파일 자체가 잘못됐다(열이 없다, 순위가 어긋난다 등)."""


# ── 읽기 ───────────────────────────────────────────────────────────────────
def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise LogError(f"파일이 없습니다: {path}")
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def column(rows_header: list[str], prefix: str) -> str:
    """'운영임계값_이상(0/1)' 처럼 단위가 붙은 열 이름을 앞부분으로 찾는다."""
    for name in rows_header:
        if name == prefix or name.startswith(prefix + "("):
            return name
    raise LogError(f"열이 없습니다: {prefix}")


def header_of(path: Path) -> list[str]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return next(csv.reader(fh), [])


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ── 계산 ───────────────────────────────────────────────────────────────────
def ap_101(tp_sorted: list[int], n_gt: int) -> float:
    """신뢰도 내림차순으로 놓인 TP(1)/FP(0) 줄에서 101점 보간 AP 를 낸다. 식 [2]."""
    if n_gt == 0:
        return float("nan")            # 찾을 것이 없으면 AP 는 정의되지 않는다
    if not tp_sorted:
        return 0.0                     # 예측이 하나도 없으면 0
    f32 = np.float32
    tp = np.asarray(tp_sorted, dtype=f32)
    cum_tp = np.cumsum(tp, dtype=f32)                      # ② 누적 TP
    cum_fp = np.cumsum(f32(1.0) - tp, dtype=f32)           #    누적 FP
    recall = cum_tp / f32(n_gt)                            # ③ R(k)
    precision = cum_tp / np.maximum(cum_tp + cum_fp, f32(1e-9))   # P(k)
    envelope = precision.copy()                            # ④ 뒤에서부터 최대값
    for k in range(len(envelope) - 2, -1, -1):
        if envelope[k + 1] > envelope[k]:
            envelope[k] = envelope[k + 1]
    recall_list = [float(r) for r in recall]               # 오름차순(누적이므로)
    sampled = np.zeros(101, dtype=f32)
    for j, r in enumerate(np.linspace(0, 1, 101)):         # ⑤ r = 0.00 … 1.00
        k = bisect_left(recall_list, float(r))             #    R(k) ≥ r 인 첫 k
        if k < len(envelope):
            sampled[j] = envelope[k]
    return float(sampled.mean())                           # ⑥ 평균


def recompute(log_dir: Path, tolerance: float = 0.20) -> dict:
    """로그 두 개(예측별·정답별)만으로 최종값을 다시 낸다."""
    pred_path, gt_path = log_dir / F_PRED, log_dir / F_GT
    preds, gts = read_csv(pred_path), read_csv(gt_path)
    ph, gh = header_of(pred_path), header_of(gt_path)
    c_img, c_conf, c_rank = column(ph, "이미지"), column(ph, "신뢰도"), column(ph, "전체순위")
    c_op = column(ph, "운영임계값_이상")
    c_gt_img, c_hit = column(gh, "이미지"), column(gh, "운영임계값에서_탐지")
    tp_columns = {m.group(1): name for name in ph
                  if (m := re.match(r"^TP@(\d\.\d\d)", name))}
    if not tp_columns:
        raise LogError("TP@0.50 … 열이 없습니다")

    # [1] 정답 총수
    n_gt = len(gts)

    # [2]-① 신뢰도 내림차순으로 세운다. 동점은 '전체순위' 를 따른다.
    conf = [float(np.float32(float(r[c_conf]))) for r in preds]
    rank = [int(r[c_rank]) for r in preds]
    if sorted(rank) != list(range(1, len(preds) + 1)):
        raise LogError("'전체순위' 가 1부터 빠짐없이 이어지지 않습니다")
    order = sorted(range(len(preds)), key=lambda i: (-conf[i], rank[i]))
    if [rank[i] for i in order] != list(range(1, len(preds) + 1)):
        raise LogError("'전체순위' 가 신뢰도 내림차순과 어긋납니다")

    # [2]·[3] IoU 기준마다 AP
    aps: dict[str, float] = {}
    for thr in sorted(tp_columns):
        name = tp_columns[thr]
        aps[thr] = ap_101([int(preds[i][name]) for i in order], n_gt)
    known = [v for v in aps.values() if v == v]            # nan 제외
    map_50 = aps["0.50"]
    map_50_95 = float(np.mean(known)) if known else float("nan")

    # [4] 운영 임계값에서의 TP·FP·FN → P·R·F1
    n_op = sum(1 for r in preds if r[c_op] == "1")
    tp = sum(1 for r in gts if r[c_hit] == "1")
    fp = n_op - tp
    fn = n_gt - tp
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)

    # [5] 이미지별 검출 수·정답 수 → 계수 오차율
    images: dict[str, list[int]] = {}                      # 이름 → [정답 수, 검출 수]
    image_log = log_dir / F_IMAGE
    if image_log.exists():                                 # 예측도 정답도 없는 이미지까지 센다
        c_name = column(header_of(image_log), "이미지")
        for r in read_csv(image_log):
            images.setdefault(r[c_name], [0, 0])
    for r in gts:
        images.setdefault(r[c_gt_img], [0, 0])[0] += 1
    for r in preds:
        entry = images.setdefault(r[c_img], [0, 0])
        if r[c_op] == "1":
            entry[1] += 1
    errors = [abs(pred - gt) / gt for gt, pred in images.values() if gt > 0]
    background = [pred for gt, pred in images.values() if gt == 0]

    result: dict = {
        "이미지_수": len(images),
        "정답_박스_수": n_gt,
        "예측_수": len(preds),
        "mAP@0.5": map_50,
        "mAP@0.5:0.95": map_50_95,
        "IoU별_AP": aps,
        "TP": tp, "FP": fp, "FN": fn,
        "Precision": precision, "Recall": recall, "F1": f1,
        "계수_대상_이미지_수": len(errors),
        "배경이미지_수": len(background),
        "허용오차": tolerance,
        "_images": images,
        # 운영 임계값 이상인 예측 가운데 'TP@0.50' 이 1 인 것 — TP 와 같아야 정상
        "_교차_TP": sum(1 for r in preds if r[c_op] == "1" and r[tp_columns["0.50"]] == "1"),
    }
    if errors:
        result["평균_오차율"] = float(np.mean(errors))
        result["중앙값_오차율"] = float(np.median(errors))
        result["최대_오차율"] = float(np.max(errors))
        result["이내_비율"] = sum(1 for e in errors if e <= tolerance) / len(errors)
    return result


# ── 견주기 ─────────────────────────────────────────────────────────────────
def compare(result: dict, final: dict, log_dir: Path) -> tuple[list[tuple], list[str]]:
    """(비교표, 문제 목록). 문제 목록이 비어 있으면 모두 일치."""
    table: list[tuple] = []
    problems: list[str] = []

    def add(label: str, mine, theirs, exact: bool = False) -> None:  # noqa: ANN001
        if mine is not None and mine != mine:          # nan = 정의되지 않음
            mine = None
        if theirs is not None and theirs != theirs:
            theirs = None
        if mine is None or theirs is None:
            same = mine is None and theirs is None
            shown = "-" if mine is None else mine
        elif exact:
            same, shown = mine == theirs, mine
        else:
            shown = round(mine, DIGITS)
            same = abs(shown - theirs) <= TOLERANCE
        table.append((label, shown, theirs, "일치" if same else "불일치"))
        if not same:
            problems.append(f"{label}: 재계산 {shown} ≠ 최종결과 {theirs}")

    add("이미지 수", result["이미지_수"], final.get("이미지_수"), exact=True)
    add("정답 박스 수", result["정답_박스_수"], final.get("정답_박스_수"), exact=True)
    add("mAP@0.5", result["mAP@0.5"], final.get("mAP@0.5"))
    add("mAP@0.5:0.95", result["mAP@0.5:0.95"], final.get("mAP@0.5:0.95"))
    for thr, value in result["IoU별_AP"].items():
        add(f"AP@{thr}", value, final.get("IoU별_AP", {}).get(thr))
    add("TP", result["TP"], final.get("TP"), exact=True)
    add("FP", result["FP"], final.get("FP"), exact=True)
    add("FN", result["FN"], final.get("FN"), exact=True)
    add("Precision", result["Precision"], final.get("Precision"))
    add("Recall", result["Recall"], final.get("Recall"))
    add("F1", result["F1"], final.get("F1"))
    c = final.get("계수_오차율", {})
    pct = int(result["허용오차"] * 100)
    add("계수 대상 이미지 수", result["계수_대상_이미지_수"], c.get("대상_이미지_수"), exact=True)
    add("계수 오차율 평균", result.get("평균_오차율"), c.get("평균_오차율"))
    add("계수 오차율 중앙값", result.get("중앙값_오차율"), c.get("중앙값_오차율"))
    add("계수 오차율 최대", result.get("최대_오차율"), c.get("최대_오차율"))
    add(f"±{pct}% 이내 비율", result.get("이내_비율"), c.get(f"±{pct}%_이내_비율"))
    add("정답 0마리 이미지 수", result["배경이미지_수"], c.get("배경이미지_수"), exact=True)

    # 로그 파일이 측정 직후 그대로인가
    for name, digest in final.get("로그_sha256", {}).items():
        path = log_dir / name
        if not path.exists():
            problems.append(f"로그 파일이 없습니다: {name}")
        elif sha256_of(path) != digest:
            problems.append(f"로그 파일이 측정 뒤에 바뀌었습니다(sha256 불일치): {name}")


    # 이미지별 로그와 교차 확인
    image_log = log_dir / F_IMAGE
    if image_log.exists():
        h = header_of(image_log)
        c_name, c_gt, c_pred = column(h, "이미지"), column(h, "정답수"), column(h, "검출수")
        seen = set()
        for r in read_csv(image_log):
            seen.add(r[c_name])
            gt, pred = result["_images"].get(r[c_name], [0, 0])
            if (int(r[c_gt]), int(r[c_pred])) != (gt, pred):
                problems.append(
                    f"이미지별 로그와 다릅니다: {r[c_name]} — 이미지별 "
                    f"(정답 {r[c_gt]}, 검출 {r[c_pred]}) ≠ 다시 센 값 (정답 {gt}, 검출 {pred})")
        for name in sorted(set(result["_images"]) - seen):
            problems.append(f"이미지별 로그에 없는 이미지입니다: {name}")
    return table, problems


def render(result: dict, final: dict, table: list[tuple], problems: list[str],
           log_dir: Path) -> str:
    lines = [
        "로그만으로 다시 계산한 값과 최종결과(03_최종결과.json) 비교",
        "=" * 66,
        f"로그 폴더          {log_dir}",
        f"모델 sha256        {final.get('모델_sha256', '-')}",
        f"git 커밋           {final.get('코드', {}).get('git', {}).get('커밋') or '-'}",
        f"측정 실행 시각     {final.get('실행_시각', '-')}",
        f"읽은 로그          {F_PRED} ({result['예측_수']:,} 줄)",
        f"                   {F_GT} ({result['정답_박스_수']:,} 줄)",
        "-" * 66,
        f"{'항목':<22}{'재계산':>12}{'최종결과':>12}   판정",
        "-" * 66,
    ]
    for label, mine, theirs, verdict in table:
        pad = 22 - sum(1 for ch in label if ord(ch) > 0x2E80)   # 한글은 두 칸을 차지한다
        lines.append(f"{label:<{max(pad, 1)}}{mine!s:>12}{theirs!s:>12}   {verdict}")
    lines += ["-" * 66,
              f"허용오차 {TOLERANCE:g} · 소수 {DIGITS}째 자리까지 견줌",
              "로그 파일 sha256, 이미지별 로그와의 교차 확인 포함"]
    # 참고: 운영 임계값의 TP 를 예측별 로그에서도 세어 본다('운영임계값_이상'=1 이고
    # 'TP@0.50'=1 인 줄). 한 이미지 안에 신뢰도가 똑같은 예측이 있으면 두 매칭의
    # 순서가 달라 드물게 어긋날 수 있다 — 최종값은 정답별 로그 쪽이다.
    cross = result["_교차_TP"]
    note = ("정답별 로그와 같음" if cross == result["TP"]
            else "정답별 로그와 다름 — 동점 신뢰도 확인")
    lines += [f"참고: 예측별 로그에서 센 운영 임계값 TP {cross:,} ({note})", ""]
    if problems:
        lines.append(f"결과: 불일치 {len(problems)}건")
        lines += [f"  - {p}" for p in problems[:50]]
        if len(problems) > 50:
            lines.append(f"  … 외 {len(problems) - 50}건")
    else:
        lines.append("결과: 모두 일치 — 로그만으로 최종값이 그대로 다시 나왔습니다.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="로그만으로 탐지 성능을 다시 계산해 최종결과와 견준다")
    p.add_argument("--dir", required=True, help="eval_detect.py --log-dir 로 만든 폴더")
    p.add_argument("--out", default=None, help=f"비교 결과 저장 경로(기본: <dir>/{F_OUT})")
    for stream in (sys.stdout, sys.stderr):          # 윈도우 콘솔(cp949)에서 죽지 않게
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    args = p.parse_args(argv)
    log_dir = Path(args.dir)
    try:
        json_path = log_dir / F_JSON
        if not json_path.exists():
            raise LogError(f"파일이 없습니다: {json_path}")
        final = json.loads(json_path.read_text(encoding="utf-8"))
        tolerance = final.get("계수_오차율", {}).get("허용오차", 0.20)
        result = recompute(log_dir, tolerance)
        table, problems = compare(result, final, log_dir)
    except LogError as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        return 2
    text = render(result, final, table, problems, log_dir)
    print(text, end="")
    out_path = Path(args.out) if args.out else log_dir / F_OUT
    out_path.write_text(text, encoding="utf-8")
    print(f"저장: {out_path}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
