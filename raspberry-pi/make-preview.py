#!/usr/bin/env python3
"""터치스크린 화면 미리보기(단일 HTML)를 만든다.

PC 에서 장비 화면을 그대로 보기 위한 것이다. 실제 화면을 손볼 때마다 미리보기를
따로 고치면 금세 어긋나므로, **webui.py 의 PAGE 를 그대로 가져다** 쓰고
fetch 만 가짜 데이터로 바꿔치기한다. 화면 코드를 고치면 이 스크립트를 다시
돌리는 것만으로 미리보기가 따라온다.

    python3 raspberry-pi/make-preview.py [내보낼경로.html]
    python3 raspberry-pi/make-preview.py --agri [내보낼경로.html]   # 스마트팜(Farm365) 모드
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import limits  # noqa: E402  — 경로를 넣은 뒤에 불러와야 한다
import webui  # noqa: E402

ARGS = [a for a in sys.argv[1:] if a != "--agri"]
AGRI = "--agri" in sys.argv[1:]
MODE = "agriculture" if AGRI else "shrimp"
OUT = (Path(ARGS[0]) if ARGS
       else HERE.parent / ("kiosk-preview-agri.html" if AGRI else "kiosk-preview.html"))

VALUES = {"temperature": 28.4, "ph": 7.85, "do_level": 6.42, "salinity": 20.4}
NOW = 1770000000  # 고정 시각 — 돌릴 때마다 결과가 달라지면 비교가 어렵다
STAMP = "2026-08-06 14:32:05"


def base_state(**over) -> dict:
    state = {
        "values": dict(VALUES), "status": "sent 14:32", "updated_at": STAMP,
        "errors": {}, "serial": "10000000c0ffee01", "pending": 0,
        "linked": True, "account": "ky****4@gmail.com", "tank": "A-1조", "farm": "1양식장",
        "pairing": False, "pair_code": None, "pair_url": "", "pair_error": None,
        "advice": [], "anomalies": [],
        "ai": {"enabled": True, "window_h": 96, "interval_s": 300,
               "samples": 5742, "at": "14:30"},
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
    ("용존산소 위험 · 운전 권고", base_state(
        values={**VALUES, "do_level": 3.1}, status="sent 14:32",
        advice=[{"code": "do_critical", "level": "danger", "value": 3.1, "digits": 2}],
        anomalies=[{"parameter": "do_level", "kind": "surge", "type": "danger",
                    "value": 3.1, "reference": 5.4, "digits": 2,
                    "direction": "down", "gap_minutes": 24}])),
    ("추세 경고 (기준 안인데 내려가는 중)", base_state(
        values={**VALUES, "do_level": 5.6}, status="sent 14:32",
        advice=[{"code": "do_falling", "level": "warn", "value": 5.6, "digits": 2},
                {"code": "temp_swing", "level": "warn", "value": 28.4, "digits": 1}],
        anomalies=[{"parameter": "do_level", "kind": "drift", "type": "warning",
                    "value": 5.6, "reference": 7.1, "digits": 2,
                    "direction": "down", "span_hours": 5}])),
    ("과잉 폭기 (전력 절감)", base_state(
        values={**VALUES, "do_level": 8.7}, status="sent 14:32",
        advice=[{"code": "do_surplus", "level": "save", "value": 8.7, "digits": 2}])),
    ("센서 오류", base_state(
        values={"temperature": 28.4, "ph": 7.85},
        errors={"ec": "응답 없음 (배선·전원·슬레이브 ID 확인)"},
        status="SENSOR ERROR")),
]

# 스마트팜(양액 재배) — 값은 NUTRIENT_BANDS 적정 범위 안쪽, 전도도는 uS/cm 로 올라오고
# 화면이 mS/cm 로 나눠 보여 준다(ec_unit=ms). nutrient 는 shrimp365_sensor.nutrient_plan() 의 모양.
AGRI_VALUES = {"temperature": 21.6, "ph": 6.12, "do_level": 7.3, "conductivity": 1640}
NUT_BASE = {"ec": 1.71, "target": 1.8, "percent": 94.0, "atc": True}
# 환경·기상 — field_env.FieldEnv.read() 의 모양. 기상센서(WS90)까지 단 농장.
ENV = {
    "air_temp": {"value": 23.4, "var": "t_air", "sensors": 1, "age_min": 0},
    "humidity": {"value": 71.5, "var": "rh", "sensors": 3, "age_min": 3},
    "soil_moisture": {"value": 34.2, "var": "soil_moisture", "sensors": 2, "age_min": 4},
    "soil_temp": {"value": 19.8, "var": "soil_temp", "sensors": 2, "age_min": 4},
    "wind_speed": {"value": 3.2, "var": "wind_speed", "sensors": 1, "age_min": 0},
    "wind_gust": {"value": 6.8, "var": "wind_gust_window", "sensors": 1, "age_min": 0},
    "wind_dir": {"value": 315, "var": "wind_dir", "sensors": 1, "age_min": 0},
    "rain_day": {"value": 4.6, "var": "rain", "sensors": 1, "age_min": 0},
    "rain_rate": {"value": 1.2, "var": "rain_rate", "sensors": 1, "age_min": 0},
}


def agri_state(**over) -> dict:
    state = base_state(values=dict(AGRI_VALUES), farm="1농장", tank="딸기 B-2베드",
                       mode="agriculture", ec_mode="conductivity", ec_unit="ms", env=ENV,
                       nutrient={**NUT_BASE, "verdict": "low", "need_rise": 0.09,
                                 "dose_total": 180, "dose_a": 90, "dose_b": 90})
    state.update(over)
    return state


AGRI_STATES = [
    ("양액 보충 안내", agri_state()),
    ("양액 농도 적정", agri_state(
        values={**AGRI_VALUES, "conductivity": 1810},
        nutrient={**NUT_BASE, "ec": 1.81, "percent": 100.7, "verdict": "ok"})),
    ("농도 높음 · 원수 교환", agri_state(
        values={**AGRI_VALUES, "conductivity": 2350},
        nutrient={**NUT_BASE, "ec": 2.35, "percent": 136.7, "verdict": "high",
                  "exchange_l": 268})),
    # 스마트팜에서는 양액 관리를 꺼도 권고가 비고 값 칸은 NUTRIENT_BANDS 로 판정한다.
    ("양액 관리 꺼짐", agri_state(nutrient=None)),
    ("고온 · pH 이탈", agri_state(
        values={**AGRI_VALUES, "temperature": 29.4, "ph": 7.2})),
    ("지그비만 (기상센서 없음)", agri_state(env={
        "air_temp": {"value": 22.8, "var": "canopy_temp", "sensors": 2, "age_min": 3},
        "humidity": {"value": 74.0, "var": "rh", "sensors": 2, "age_min": 3},
        "soil_moisture": {"value": 33.9, "var": "soil_moisture", "sensors": 2, "age_min": 4},
    })),
    ("센서 끊김", agri_state(env={
        "air_temp": {"value": 23.1, "var": "t_air", "sensors": 1, "age_min": 22},
        "soil_moisture": {"value": 33.9, "var": "soil_moisture", "sensors": 1, "age_min": 6},
    })),
    ("환경 값 없음", agri_state(env={})),
    ("미연결 (측정만)", agri_state(
        linked=False, account=None, tank=None, farm=None,
        status="미연결 — 측정만 · 보관 12건", pending=12)),
    ("센서 오류", agri_state(
        values={"temperature": 21.6, "ph": 6.12, "do_level": 7.3},
        errors={"ec": "응답 없음 (배선·전원·슬레이브 ID 확인)"},
        nutrient=None, status="SENSOR ERROR")),
]
if AGRI:
    STATES = AGRI_STATES

# 설정 화면 미리보기용 — shrimp365_sensor.py 의 ui_nutrient()·ui_calibration() 모양.
# 없으면 양액·보정 화면 칸이 undefined 로 떠 실제 장비와 달라 보인다.
NUTRIENT = {"enabled": AGRI, "target_ec": 1.8, "source_ec": 0.3, "tank_liters": 1000,
            "cal_ml": 10, "cal_liters": 100, "cal_ec_rise": 0.05, "a_ratio": 50, "atc": True}
CALIBRATION = {
    "offsets": {"temperature": 0.0, "ph": -0.04, "do_level": 0.0, "conductivity": 0.0},
    "raw": {"temperature": 21.6, "ph": 6.16, "do_level": 7.3, "conductivity": 1640},
    "corrected": {"temperature": 21.6, "ph": 6.12, "do_level": 7.3, "conductivity": 1640},
}

SENSORS = {
    "interval": 60, "port": "/dev/ttyUSB0",
    # 스마트팜으로 바꾸면 장비가 EC 를 전도도(mS/cm)로 한 번 고쳐 준다(INSTALL.md).
    "ec_mode": "conductivity" if AGRI else "salinity", "ec_unit": "ms" if AGRI else "us",
    "sensors": [
        {"key": "ph", "label": "pH / ORP", "enabled": True, "slave_id": 1},
        {"key": "do", "label": "용존산소", "enabled": True, "slave_id": 3},
        {"key": "ec", "label": "전도도 / 염도", "enabled": True, "slave_id": 4},
    ],
}
SCAN = [
    {"id": 1, "kind": "pH 센서", "note": "첫 값 7.85 pH"},
    {"id": 4, "kind": "EC 센서", "note": "첫 값 45.2 mS"},
    {"id": 5, "kind": "DO 센서", "note": "첫 값 6.42 mg/L"},
]
AUTO = {"assign": {"ph": 1, "do": 5, "ec": 4}, "conflicts": {}, "others": [], "missing": []}

# Wi‑Fi 미리보기 — 실제 장비는 nmcli 로 주변을 훑지만, 여기서는 고정 목록으로
# 화면 흐름(검색 → 선택 → 화면 키보드 → 연결)을 그대로 눌러 볼 수 있게 한다.
WIFI_NETWORKS = [
    {"ssid": "CULIVER-FARM", "signal": 88, "bars": 4, "secure": True, "in_use": True},
    {"ssid": "iptime5G_2F", "signal": 66, "bars": 3, "secure": True, "in_use": False},
    {"ssid": "SmartFarm_Guest", "signal": 40, "bars": 2, "secure": False, "in_use": False},
    {"ssid": "KT_GiGA_A1B2", "signal": 22, "bars": 1, "secure": True, "in_use": False},
]
WIFI_START = "CULIVER-FARM"  # 처음 연결돼 있는 곳. [연결] 을 누르면 바뀐다.


def series(field: str) -> dict:
    """그래프용 가짜 이력. 하루 주기로 오르내리게 만든다."""
    random.seed(hash(field) & 0xFFFF)
    base, swing = {
        "temperature": (28.4, 0.6), "ph": (7.85, 0.15),
        "do_level": (6.4, 2.2), "salinity": (20.4, 0.9),
        "agri:temperature": (21.6, 1.8), "agri:ph": (6.1, 0.2),
        "agri:do_level": (7.3, 0.9), "agri:conductivity": (1700, 120),
    }[field]
    out = {}
    for hours in (6, 12, 24, 168):
        points, step = [], max(1, hours * 3600 // 150)
        for i in range(150):
            ts = NOW - hours * 3600 + i * step
            h = (ts % 86400) / 3600
            avg = base + math.sin((h - 6) / 3.8) * swing + random.uniform(-swing, swing) * 0.08
            digits = 0 if field.endswith("conductivity") else 2
            points.append([ts, round(avg, digits),
                           round(avg - swing * 0.12, digits), round(avg + swing * 0.12, digits)])
        vals = [p[1] for p in points]
        out[str(hours)] = {"points": points, "min": min(vals), "max": max(vals),
                           "avg": round(sum(vals) / len(vals), 2), "count": len(vals)}
    return out


if AGRI:
    HIST = {f: series("agri:" + f) for f in ("temperature", "ph", "do_level", "conductivity")}
else:
    HIST = {f: series(f) for f in ("temperature", "ph", "do_level", "salinity")}

SHELL_CSS = """
  body{margin:0;background:#F1F5F9;color:#0F172A;
       font-family:'Pretendard',-apple-system,'Malgun Gothic',sans-serif;padding:22px}
  h1{font-size:19px;margin:0 0 4px}
  .lead{color:#64748B;font-size:13px;margin:0 0 14px}
  .tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .tabs button{font-weight:600;font-size:12px;line-height:1;font-family:inherit;padding:8px 12px;border-radius:8px;
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
var NUTRIENT = __NUTRIENT__, CALIBRATION = __CALIBRATION__;
var SCAN = __SCAN__, AUTO = __AUTO__;
var WIFI_NETWORKS = __WIFI_NETWORKS__, wifiCur = __WIFI_START__;
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
  else if (url.indexOf("/api/nutrient/save") === 0) body = {ok:true, saved:true};
  else if (url.indexOf("/api/nutrient") === 0) body = JSON.parse(JSON.stringify(NUTRIENT));
  else if (url.indexOf("/api/calibration") === 0 && !(opts && opts.method === "POST"))
    body = JSON.parse(JSON.stringify(CALIBRATION));
  // Wi‑Fi — 더 구체적인 경로(scan·connect)를 먼저 본다.
  else if (url.indexOf("/api/wifi/scan") === 0) {
    body = {available:true, networks: WIFI_NETWORKS.map(function(n){
      return {ssid:n.ssid, signal:n.signal, bars:n.bars, secure:n.secure, in_use:(n.ssid === wifiCur)};
    })};
  }
  else if (url.indexOf("/api/wifi/connect") === 0) {
    try { var b = JSON.parse((opts && opts.body) || "{}"); if (b.ssid) wifiCur = b.ssid; } catch(e){}
    body = {ok:true};
  }
  else if (url.indexOf("/api/wifi") === 0) {
    body = {available:true, device:"wlan0", radio:true,
            connected:!!wifiCur, ssid:wifiCur, ip: wifiCur ? "192.168.0.42" : null};
  }
  else body = {ok:true};
  return Promise.resolve({ ok:true, json: function(){ return Promise.resolve(body); } });
};

window.addEventListener("message", function(e){
  if (e.data && typeof e.data.state === "number") {
    current = e.data.state;
    if (typeof closeSettings === "function") closeSettings();
    if (typeof closeChart === "function") closeChart();
    if (typeof closeWifi === "function") closeWifi();
    tick();
  }
});
</script>
"""


def main() -> int:
    # 판정 밴드는 webui.serve() 가 limits.py 에서 주입한다. 미리보기는 그 함수를
    # 거치지 않으므로 여기서 같은 치환을 해 준다 — 안 하면 화면 스크립트가
    # `var BANDS = __BANDS__;` 에서 그대로 깨진다.
    page = (webui.PAGE
            .replace("__LANG__", "ko")
            .replace("__MODE__", MODE)
            .replace("__BANDS__", json.dumps(limits.BANDS))
            .replace("__NUT_BANDS__", json.dumps(limits.NUTRIENT_BANDS)))
    mock = (MOCK
            .replace("__STATES__", json.dumps(STATES, ensure_ascii=False))
            .replace("__HIST__", json.dumps(HIST))
            .replace("__SENSORS__", json.dumps(SENSORS, ensure_ascii=False))
            .replace("__NUTRIENT__", json.dumps(NUTRIENT))
            .replace("__CALIBRATION__", json.dumps(CALIBRATION))
            .replace("__SCAN__", json.dumps(SCAN, ensure_ascii=False))
            .replace("__AUTO__", json.dumps(AUTO, ensure_ascii=False))
            .replace("__WIFI_NETWORKS__", json.dumps(WIFI_NETWORKS, ensure_ascii=False))
            .replace("__WIFI_START__", json.dumps(WIFI_START, ensure_ascii=False)))
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
<title>{"Farm365" if AGRI else "Shrimp365"} 터치스크린 미리보기</title>
<style>{SHELL_CSS}</style>
<h1>라즈베리파이 7인치 터치스크린 화면</h1>
<p class="lead">공식 디스플레이 실제 해상도(800×480). 실제 장비 화면 코드를 그대로 띄웁니다 — 눌러 보실 수 있습니다.</p>
<div class="tabs">{tabs}</div>
<div class="bezel"><iframe class="screen" id="dev" title="장비 화면"></iframe></div>
<div class="note">
  <b>값 칸을 눌러 보세요.</b> 6시간·12시간·24시간·일주일 그래프가 열립니다.
  녹색 띠가 적정 범위입니다({"양액 재배 기준" if AGRI else "흰다리새우 기준"}).<br>
  <b>오른쪽 아래 [설정]</b> — 슬레이브 ID·측정 주기를 손가락으로 고칩니다.
  <b>[자동 배치]</b> 는 꽂아 둔 센서를 훑어 값이 나오는 자리를 그대로 배정합니다(이 미리보기에선 용존산소가 3→5로 바뀝니다).<br>
  <b>[Wi‑Fi]</b> — 주변 공유기를 검색해 화면 키보드로 비밀번호를 넣고 붙입니다(이 미리보기에서도 눌러 볼 수 있습니다. 잠긴 공유기를 고르면 화면 키보드가 뜨고, [연결] 하면 위쪽 연결 표시가 그 공유기로 바뀝니다).<br>
  단위는 <b>용존산소 ppm · 염도 ‰ · 전도도 µS/cm · pH</b> 입니다.
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
