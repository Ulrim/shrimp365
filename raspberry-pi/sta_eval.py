"""STA 시험 참고용 — 같은 사례를 장비 판정(anomaly.detect)에 넣어 본다.

시험 대상은 플랫폼(웹, lib/thresholds.ts)이다. 이 파일은 「장비도 같은 사례에서
같은 추세 판정을 내는가」를 참고값으로 남기려고 scripts/sta/eval-anomaly.mjs 가
부른다. anomaly.py 는 고치지 않고 그대로 import 한다.

입력(표준입력 JSON):
    {"시간대": "Asia/Seoul",
     "사례": [{"id": "A001", "rows": [{"t": 1719800000, "do_level": 6.4, ...}, ...]}]}
출력(표준출력 JSON):
    {"시간대_오프셋_시": 9.0, "결과": {"A001": [{"parameter": "do_level", "kind": "surge", "type": "danger"}]}}
"""

from __future__ import annotations

import json
import os
import sys
import time


def main() -> int:
    req = json.load(sys.stdin)

    # 날짜별 극값은 현지 날짜로 묶인다(anomaly._daily_extremes 의 time.localtime).
    # 웹과 같은 날짜 경계를 쓰도록 시간대를 맞춘다. tzset 은 윈도우에 없다 —
    # 그때는 시스템 시간대를 그대로 쓰고 오프셋만 보고한다(호출 쪽이 확인).
    tz = req.get("시간대")
    if tz and hasattr(time, "tzset"):
        os.environ["TZ"] = tz
        time.tzset()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import anomaly  # noqa: E402 — 시간대를 맞춘 뒤에 불러온다

    out = {}
    for case in req["사례"]:
        found = anomaly.detect(case["rows"])
        out[case["id"]] = [
            {"parameter": a["parameter"], "kind": a["kind"], "type": a["type"]} for a in found
        ]

    offset_h = -(time.altzone if time.localtime().tm_isdst > 0 else time.timezone) / 3600
    json.dump({"시간대_오프셋_시": offset_h, "판정_항목": sorted(anomaly.RULES), "결과": out},
              sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
