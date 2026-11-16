#!/usr/bin/env python3
"""STA 시험 — AI허브 「스마트양식장 통합 데이터(흰다리새우)」 환경시계열을 정규화 CSV 로 옮긴다.

    python3 scripts/sta/normalize-aihub.py <환경시계열 데이터 폴더> <정규화.csv> [--tanks wt11,wt12,wt13,wt14]

읽는 것: <폴더>/<수조>/*_TEMP.csv · *_DO.csv  (열: dataType, deviceId, measValue, sensingDateTime)
쓰는 것: 수조, 시각, 장치, 수온(℃), DO(mg/L) — UTF-8 BOM CSV, 수조·시각순.
    시각은 분 단위로 맞추고(초 버림) 같은 분의 수온·DO 를 한 줄로 합친다. 같은 분에 값이 둘이면 뒤의 값을 쓴다.

pH·염도는 옮기지 않는다. 이 자료의 pH(수조 wt11~14 에서 5.4~6.9, 다른 수조는 최대 16)와
염도(대부분 1 미만)는 양식 수질 범위를 벗어나 있어 시험 사례에 쓰지 않는다(라벨기준.md 1절).
값은 바꾸지 않고 소수 셋째 자리로만 정리한다. 0 이하는 미측정으로 보고 뺀다.
"""

from __future__ import annotations

import csv
import glob
import os
import sys

ITEMS = {"TEMP": "수온(℃)", "DO": "DO(mg/L)"}


def main() -> int:
    args = sys.argv[1:]
    tanks = ["wt11", "wt12", "wt13", "wt14"]
    if "--tanks" in args:
        i = args.index("--tanks")
        tanks = args[i + 1].split(",")
        del args[i:i + 2]
    if len(args) != 2:
        print(__doc__)
        return 3
    root, dst = args

    out = []
    for tank in sorted(tanks):
        merged: dict[str, dict[str, str]] = {}
        for item, col in ITEMS.items():
            files = sorted(glob.glob(os.path.join(root, tank, f"*_{item}.csv")))
            if len(files) != 1:
                print(f"{tank}: *_{item}.csv 파일이 {len(files)}개입니다", file=sys.stderr)
                return 3
            with open(files[0], encoding="utf-8-sig", newline="") as f:
                for r in csv.DictReader(f):
                    try:
                        v = float(r["measValue"])
                    except (KeyError, ValueError):
                        continue
                    if v <= 0:
                        continue
                    # 센서마다 기록 시각이 몇 초씩 어긋난다 — 분 단위로 맞춰 한 줄로 합친다.
                    when = r["sensingDateTime"].strip().replace(" ", "T")[:16] + ":00+09:00"
                    merged.setdefault(when, {})[col] = f"{round(v, 3):g}"
        for when in sorted(merged):
            out.append([tank, when, "", merged[when].get("수온(℃)", ""), merged[when].get("DO(mg/L)", "")])

    with open(dst, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(["수조", "시각", "장치", "수온(℃)", "DO(mg/L)"])
        w.writerows(out)
    print(f"{dst}: {len(out)}행 · 수조 {len(tanks)}개 ({', '.join(sorted(tanks))})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
