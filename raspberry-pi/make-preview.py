#!/usr/bin/env python3
"""터치스크린 화면 미리보기(단일 HTML)를 만든다.

PC 에서 장비 화면을 그대로 보기 위한 것이다. 실제 화면을 손볼 때마다 미리보기를
따로 고치면 금세 어긋나므로, **webui.py 의 PAGE 를 그대로 가져다** 쓰고
fetch 만 가짜 데이터로 바꿔치기한다. 화면 코드를 고치면 이 스크립트를 다시
돌리는 것만으로 미리보기가 따라온다.

    python3 raspberry-pi/make-preview.py [내보낼경로.html]
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import webui  # noqa: E402  — 경로를 넣은 뒤에 불러와야 한다

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "kiosk-preview.html"

VALUES = {"temperature": 28.4, "ph": 7.85, "do_level": 6.42, "salinity": 660}
NOW = 1770000000  # 고정 시각 — 돌릴 때마다 결과가 달라지면 비교가 어렵다
STAMP = "2026-08-06 14:32:05"


def base_state(**over) -> dict:
    state = {
        "values": dict(VALUES), "status": "sent 14:32", "updated_at": STAMP,
        "errors": {}, "serial": "10000000c0ffee01", "pending": 0,
        "linked": True, "account": "ky****4@gmail.com", "tank": "A-1조", "farm": "1양식장",
        "pairing": False, "pair_code": None, "pair_url": "", "pair_error": None,
    }
    state.update(over)
    return state


STATES = [
    ("연결됨 · 정상", base_state()),
    ("미연결 (측정만)", base_state(
        linked=False, account=None, tank=None, farm=None,
        status="미연결 — 측정만 · 보관 12건", pending=12)),
    ("연결 코드", base_state(
        linked=False, account=None, tank=None, farm=None,
        pairing=True, pair_code="482100", pair_url="www.shrimp365.kr",
        status="연결 대기 중")),
    ("인터넷 끊김", base_state(status="SEND FAIL 14:32 · 보관 37건", pending=37)),
    ("복구 직후 (재전송)", base_state(status="sent +37 14:32")),
    ("용존산소 위험", base_state(
        values={**VALUES, "do_level": 3.1}, status="sent 14:32")),
    ("센서 오류", base_state(
        values={"temperature": 28.4, "ph": 7.85},
        errors={"ec": "응답 없음 (배선·전원·슬레이브 ID 확인)"},
        status="SENSOR ERROR")),
]

SENSORS = {
    "interval": 60, "port": "/dev/ttyUSB0",
    "sensors": [
        {"key": "ph", "label": "pH / ORP", "enabled": True, "slave_id": 1},
        {"key": "do", "label": "용존산소", "enabled": True, "slave_id": 3},
        {"key": "ec", "label": "전도도 / 염도", "enabled": True, "slave_id": 4},
    ],
}
SCAN = [
    {"id": 1, "kind": "pH 센서", "note": "첫 값 7.85 pH"},
    {"id": 4, "kind": "EC 센서", "note": "첫 값 1320 uS"},
    {"id": 5, "kind": "DO 센서", "note": "첫 값 6.42 mg/L"},
]
AUTO = {"assign": {"ph": 1, "do": 5, "ec": 4}, "conflicts": {}, "others": [], "missing": []}


def series(field: str) -> dict:
    """그래프용 가짜 이력. 하루 주기로 오르내리게 만든다."""
    random.seed(hash(field) & 0xFFFF)
    base, swing = {
        "temperature": (28.4, 0.6), "ph": (7.85, 0.15),
        "do_level": (6.4, 2.2), "salinity": (660, 40),
    }[field]
    out = {}
    for hours in (6, 12, 24, 168):
        points, step = [], max(1, hours * 3600 // 150)
        for i in range(150):
            ts = NOW - hours * 3600 + i * step
            h = (ts % 86400) / 3600
            avg = base + math.sin((h - 6) / 3.8) * swing + random.uniform(-swing, swing) * 0.08
            digits = 0 if field == "salinity" else 2
            points.append([ts, round(avg, digits),
                           round(avg - swing * 0.12, digits), round(avg + swing * 0.12, digits)])
        vals = [p[1] for p in points]
        out[str(hours)] = {"points": points, "min": min(vals), "max": max(vals),
                           "avg": round(sum(vals) / len(vals), 2), "count": len(vals)}
    return out


HIST = {f: series(f) for f in ("temperature", "ph", "do_level", "salinity")}

SHELL_CSS = """
  body{margin:0;background:#F1F5F9;color:#0F172A;
       font-family:'Pretendard',-apple-system,'Malgun Gothic',sans-serif;padding:22px}
  h1{font-size:19px;margin:0 0 4px}
  .lead{color:#64748B;font-size:13px;margin:0 0 14px}
  .tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .tabs button{font:600 12px/1 inherit;padding:8px 12px;border-radius:8px;
       border:1px solid #CBD5E1;background:#fff;color:#475569;cursor:pointer}
  .tabs button[aria-pressed="true"]{background:#1E40AF;border-color:#1E40AF;color:#fff}
  .bezel{width:800px;max-width:100%;border-radius:18px;background:#0B1120;
       padding:10px;box-shadow:0 10px 30px rgba(15,23,42,.22)}
  .screen{width:100%;height:480px;border:0;border-radius:10px;display:block;background:#0B1120}
  .note{max-width:800px;margin-top:12px;font-size:12.5px;color:#475569;line-height:1.75;
        background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:11px 14px}
  .note b{color:#0F172A}
  @media (max-width:860px){ .bezel{width:100%} .screen{height:60vw} }
"""

# 장비 화면은 iframe 안에서 돈다. 바깥 페이지의 스타일이 섞이지 않고,
# 실제 800x480 과 같은 크기로 볼 수 있다.
MOCK = """
<script>
var STATES = __STATES__, HIST = __HIST__, SENSORS = __SENSORS__;
var SCAN = __SCAN__, AUTO = __AUTO__;
var current = 0;

// 장비의 화면 코드는 그대로 두고 fetch 만 가로챈다.
// 이렇게 해야 미리보기가 실제 화면과 어긋나지 않는다.
window.fetch = function(url, opts){
  var body = {};
  if (url.indexOf("/api/state") === 0) body = STATES[current][1];
  else if (url.indexOf("/api/history") === 0) {
    var q = new URLSearchParams(url.split("?")[1] || "");
    body = (HIST[q.get("key")] || {})[q.get("hours") || "24"] || {points:[],count:0};
  }
  else if (url.indexOf("/api/sensors/scan") === 0) body = {found: SCAN};
  else if (url.indexOf("/api/sensors/auto") === 0) body = AUTO;
  else if (url.indexOf("/api/sensors/save") === 0) body = {ok:true, saved:true};
  else if (url.indexOf("/api/sensors") === 0) body = JSON.parse(JSON.stringify(SENSORS));
  else body = {ok:true};
  return Promise.resolve({ ok:true, json: function(){ return Promise.resolve(body); } });
};

window.addEventListener("message", function(e){
  if (e.data && typeof e.data.state === "number") {
    current = e.data.state;
    if (typeof closeSettings === "function") closeSettings();
    if (typeof closeChart === "function") closeChart();
    tick();
  }
});
</script>
"""


def main() -> int:
    page = webui.PAGE
    mock = (MOCK
            .replace("__STATES__", json.dumps(STATES, ensure_ascii=False))
            .replace("__HIST__", json.dumps(HIST))
            .replace("__SENSORS__", json.dumps(SENSORS, ensure_ascii=False))
            .replace("__SCAN__", json.dumps(SCAN, ensure_ascii=False))
            .replace("__AUTO__", json.dumps(AUTO, ensure_ascii=False)))
    # 가짜 fetch 를 화면 스크립트보다 먼저 심는다.
    device = page.replace("<script>", mock + "<script>", 1)

    tabs = "".join(
        f'<button onclick="pick({i})" aria-pressed="{str(i == 0).lower()}">{label}</button>'
        for i, (label, _) in enumerate(STATES))

    # 장비 HTML 안의 </script> 가 바깥 스크립트를 그 자리에서 끊어 버린다.
    # JSON 문자열 안에서는 <\/script> 로 써도 같은 문자열이므로 이렇게 피한다.
    device_js = json.dumps(device).replace("</", "<\\/")

    shell = f"""<!doctype html>
<html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shrimp365 터치스크린 미리보기</title>
<style>{SHELL_CSS}</style>
<h1>라즈베리파이 7인치 터치스크린 화면</h1>
<p class="lead">공식 디스플레이 실제 해상도(800×480). 실제 장비 화면 코드를 그대로 띄웁니다 — 눌러 보실 수 있습니다.</p>
<div class="tabs">{tabs}</div>
<div class="bezel"><iframe class="screen" id="dev" title="장비 화면"></iframe></div>
<div class="note">
  <b>값 칸을 눌러 보세요.</b> 6시간·12시간·24시간·일주일 그래프가 열립니다.
  녹색 띠가 적정 범위입니다. 염도는 민물·기수의 적정 범위가 완전히 달라 띠를 두지 않습니다.<br>
  <b>오른쪽 아래 [설정]</b> — 슬레이브 ID·측정 주기를 손가락으로 고칩니다.
  <b>[자동 배치]</b> 는 꽂아 둔 센서를 훑어 값이 나오는 자리를 그대로 배정합니다(이 미리보기에선 용존산소가 3→5로 바뀝니다).<br>
  단위는 <b>용존산소 ppm · 염도 ppm · 전도도 µS/cm · pH</b> 입니다.
</div>
<script>
var DEVICE_HTML = {device_js};
var frame = document.getElementById("dev");
frame.srcdoc = DEVICE_HTML;
function pick(i){{
  document.querySelectorAll(".tabs button").forEach(function(b, n){{
    b.setAttribute("aria-pressed", String(n === i));
  }});
  frame.contentWindow.postMessage({{state:i}}, "*");
}}
</script>
</html>
"""
    OUT.write_text(shell, encoding="utf-8")
    print(f"만들었습니다: {OUT}  ({len(shell):,} 바이트, 상태 {len(STATES)}개)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
