#!/usr/bin/env python3
"""STA 시험 — 수기 수질일지(xlsx)를 사례 도구가 읽는 정규화 CSV 로 옮긴다.

    python3 scripts/sta/normalize-log.py <수질일지.xlsx> <정규화.csv> [--prefix 천황]

읽는 것: 이름이 「…_수온_pH_DO_사료량」 으로 끝나는 시트(수조마다 하나).
    열 = 날짜 · 시간 · 수온(°C) · pH(pH) · DO(ppm)   (DO 의 ppm 은 mg/L 과 같다)
쓰는 것: 수조, 시각, 장치, 수온(℃), pH, DO(mg/L), 비고  — UTF-8 BOM CSV, 수조·시각순.

값은 바꾸지 않는다. 엑셀이 붙인 부동소수 꼬리(27.899999999999999)만 소수 셋째 자리로 정리한다.
세 항목이 모두 비었거나 0 인 줄(안 잰 시각)은 뺀다. 0 은 일지 양식의 기본값이라 "안 쟀다" 로 본다 —
플랫폼도 0 을 미측정으로 본다. 외부 패키지 없이 표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import csv
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SUFFIX = "_수온_pH_DO_사료량"
COLUMNS = {"수온(°C)": "수온(℃)", "pH(pH)": "pH", "DO(ppm)": "DO(mg/L)"}
OUT_HEADER = ["수조", "시각", "장치", "수온(℃)", "pH", "DO(mg/L)", "비고"]
EPOCH = datetime(1899, 12, 30)   # 엑셀 날짜 일련번호의 기준일


def sheets(path: str):
    """(시트 이름, [행: {열 글자: 값}]) 를 차례로 돌려준다."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{{{M}}}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{M}}}t")))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find(f"{{{M}}}sheets"):
        target = rels[s.get(f"{{{R}}}id")].lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(f"{{{M}}}row"):
            cells = {}
            for c in row.findall(f"{{{M}}}c"):
                col = re.match(r"[A-Z]+", c.get("r")).group()
                v = c.find(f"{{{M}}}v")
                if c.get("t") == "inlineStr":
                    cells[col] = "".join(t.text or "" for t in c.iter(f"{{{M}}}t"))
                elif v is not None and v.text is not None:
                    cells[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
            rows.append(cells)
        yield s.get("name"), rows


def number(text):
    """측정값 한 칸 → 정리한 문자열. 비었거나 숫자가 아니거나 0 이면 ""."""
    try:
        v = float(text)
    except (TypeError, ValueError):
        return ""
    if v == 0:
        return ""
    return f"{round(v, 3):g}"


def main() -> int:
    args = sys.argv[1:]
    prefix = ""
    if "--prefix" in args:
        i = args.index("--prefix")
        prefix = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        print(__doc__)
        return 3
    src, dst = args

    out = []
    for name, rows in sheets(src):
        if not name.endswith(SUFFIX) or not rows:
            continue
        tank = prefix + name[: -len(SUFFIX)]
        head = {v: k for k, v in rows[0].items()}          # 열 이름 → 열 글자
        need = ["날짜", "시간", *COLUMNS]
        if any(h not in head for h in need):
            print(f"건너뜀: 시트 「{name}」 에 필요한 열이 없습니다", file=sys.stderr)
            continue
        for r in rows[1:]:
            try:
                when = EPOCH + timedelta(days=round((float(r[head["날짜"]]) + float(r[head["시간"]])) * 1440) / 1440)
            except (KeyError, ValueError):
                continue                                    # 날짜·시간이 없는 줄
            vals = [number(r.get(head[c])) for c in COLUMNS]
            if not any(vals):
                continue
            note = (r.get(head.get("기타", ""), "") or "").replace("\n", " ").strip()
            out.append([tank, when.strftime("%Y-%m-%dT%H:%M:%S+09:00"), "", *vals, note])

    out.sort(key=lambda x: (x[0], x[1]))
    with open(dst, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow(OUT_HEADER)
        w.writerows(out)
    tanks = sorted({r[0] for r in out})
    print(f"{dst}: {len(out)}행 · 수조 {len(tanks)}개 ({', '.join(tanks)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
