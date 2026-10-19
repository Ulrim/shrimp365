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

import limits  # noqa: E402  — 경로를 넣은 뒤에 불러와야 한다
import webui  # noqa: E402

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "kiosk-preview.html"

VALUES = {"temperature": 28.4, "ph": 7.85, "do_level": 6.42, "salinity": 20.4}
NOW = 1770000000  # 고정 시각 — 돌릴 때마다 결과가 달라지면 비교가 어렵다
STAMP = "2026-08-06 14:32:05"


def base_state(**over) -> dict:
    """미리보기 한 장면.

    `_open` 은 **그 장면에서 열어 둘 패널**이다("power" 또는 "mrv"). 패널은 화면
    코드가 사람 손가락으로 여는 것이라 상태만 바꿔서는 열리지 않는다 — 그런데
    탭 이름은 「전력 입력 패널」, 「연결 코드」라고 적혀 있었다. **이름이 말하는
    화면과 보이는 화면이 다른 미리보기는 없는 것만 못하다**(사람이 그것을 보고
    "되는구나" 라고 판단한다). `main()` 이 이 키를 떼어 `__OPENERS__` 로 넘기므로
    장비가 받는 상태에는 남지 않는다.
    """
    state = {
        "values": dict(VALUES), "status": "sent 14:32", "updated_at": STAMP,
        "errors": {}, "serial": "10000000c0ffee01", "pending": 0,
        "linked": True, "account": "ky****4@gmail.com", "tank": "A-1조", "farm": "1양식장",
        "pairing": False, "pair_code": None, "pair_url": "", "pair_error": None,
        "advice": [], "anomalies": [],
        # 탄소 MRV 전력 수기 입력. 수질 연결과 별개라 기본값은 미연결이다.
        "mrv_linked": False, "mrv_site_id": None,
        "mrv_pairing": False, "mrv_pair_code": None, "mrv_pair_error": None,
        "mrv_meters": [], "mrv_pending": 0, "mrv_last": None, "mrv_clock_ok": True,
        "mrv_recent": [], "mrv_today": 0,
        # 화면에 띄울 계측기(거르개). 비어 있으면 전부 띄운다 — 기본은 거르지 않는다.
        "mrv_visible": [], "mrv_meters_missing": [],
        "mrv_blocked": 0, "mrv_blocked_reason": None, "mrv_pair_url": "",
        # 운전 모드. 기본은 양식장이고, 센서를 켜 둔 장비로 본다.
        "mode": "aquaculture", "sensors_on": True,
    }
    state.update(over)
    return state


# 전력 계측기 — 실제 장비는 서버에서 받아 온다(목록에 없는 id 로는 보낼 수 없다).
# 미리보기에서는 고정 목록으로 화면 흐름(선택 → 종류 → 키패드 → 확인 → 결과)을
# 그대로 눌러 볼 수 있게 한다. 폭기 여부가 보이는지도 여기서 확인한다.
MRV_METERS = [
    {"id": "mtr_total", "label": "총전력계 (수전반)", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_blower", "label": "브로워 분전반", "unit": "kWh_interval",
     "is_aeration": True, "has_prev": True},
    {"id": "mtr_pump", "label": "순환펌프", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": False},
]

# 계측기가 많은 현장. 펌프·모터가 여러 대인 양식장은 흔하다.
#
# **왜 장면을 따로 두는가.** 기본 장면은 계측기가 3대뿐이라 목록이 한 화면에 다 들어간다.
# 그래서 "한 화면에 몇 대까지 보이는가", "더 있다는 것을 작업자가 아는가" 를 아무도 보지
# 못했다. 15대면 한 번에 5대가 보이고 여섯째 줄이 반쯤 잘린다 — 목록은 정상적으로
# 스크롤되지만(창 327px / 내용 885px), 몇 대가 있는지는 화면 어디에도 적혀 있지 않다.
#
# 덧붙여: EI 산식은 기기별 계측기를 필요로 하지 않는다(에너지 모듈은 산입된 값의 합과
# 폭기 부분합만 쓴다). 기기별 등록은 진단용이고, 등록이 늘수록 기준선 잠금 가드의
# **계측기·일당 건수**(0.8건) 를 맞추기가 어려워진다 — 15대면 7일에 84건이다.
MRV_METERS_MANY = [
    {"id": "mtr_total", "label": "총전력계 (수전반)", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_blower1", "label": "브로워 1호", "unit": "kWh_interval",
     "is_aeration": True, "has_prev": True},
    {"id": "mtr_blower2", "label": "브로워 2호", "unit": "kWh_interval",
     "is_aeration": True, "has_prev": True},
    {"id": "mtr_blower3", "label": "브로워 3호", "unit": "kWh_interval",
     "is_aeration": True, "has_prev": False},
    {"id": "mtr_pump1", "label": "순환펌프 1호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_pump2", "label": "순환펌프 2호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_pump3", "label": "순환펌프 3호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": False},
    {"id": "mtr_pump4", "label": "순환펌프 4호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": False},
    {"id": "mtr_drum", "label": "드럼필터 모터", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_skimmer", "label": "단백질 스키머", "unit": "kWh_interval",
     "is_aeration": True, "has_prev": True},
    {"id": "mtr_uv", "label": "UV 살균기", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_heat1", "label": "히터 1호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_heat2", "label": "히터 2호", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": False},
    {"id": "mtr_feeder", "label": "자동급이기", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
    {"id": "mtr_light", "label": "조명 · 기타", "unit": "kWh_interval",
     "is_aeration": False, "has_prev": True},
]

# 15대 가운데 사람이 매일 읽는 것만 고른 그림. 총전력계 + 폭기 2대.
# EI 산식은 기기별 계측기를 필요로 하지 않으므로(위 주석) 이것으로 충분하다.
MRV_VISIBLE_PICK = ["mtr_total", "mtr_blower1", "mtr_pump1"]

# MRV 기본 화면의 "마지막 지침" 줄. 보낸 적 없는 계측기는 들어가지 않는다.
MRV_RECENT = [
    {"id": "mtr_total", "label": "총전력계 (수전반)", "is_aeration": False,
     "value": 128450.6, "at": "10-18 09:12"},
    {"id": "mtr_blower", "label": "브로워 분전반", "is_aeration": True,
     "value": 41280.0, "at": "10-18 09:13"},
]

STATES = [
    ("양식장 · 정상", base_state()),
    ("양식장 · 미연결(측정만)", base_state(
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
    # ── 스마트팜(수경재배) ───────────────────────────────────────────────────
    ("스마트팜 · 양액 보충", base_state(
        mode="smartfarm",
        values={"temperature": 24.1, "ph": 6.2, "do_level": 7.1, "conductivity": 1250},
        ec_unit="ms", status="sent 14:32",
        nutrient={"ec": 1.25, "target": 1.8, "percent": 63.3, "atc": True,
                  "verdict": "low", "need_rise": 0.55, "dose_total": 1100,
                  "dose_a": 550, "dose_b": 550})),
    # ── 탄소 MRV ─────────────────────────────────────────────────────────────
    ("MRV · 미연결", base_state(
        mode="mrv", sensors_on=False, values={}, status="14:32",
        linked=False, account=None, tank=None, farm=None)),
    ("MRV · 연결 코드", base_state(
        _open="mrv",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        linked=False, account=None, tank=None, farm=None,
        # 안내 주소는 MRV 창구의 호스트다. 수질 페어링만 채우는 pair_url 을 쓰면
        # endpoint 가 다른 호스트인 장비에서 틀린 주소를 안내한다.
        mrv_pairing=True, mrv_pair_code="730412",
        mrv_pair_url="www.shrimp365.kr")),
    ("MRV · 연결 코드 실패", base_state(
        _open="mrv",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        linked=False, account=None, tank=None, farm=None,
        mrv_pairing=True, mrv_pair_code=None,
        mrv_pair_error="인터넷 연결을 확인하세요")),
    ("MRV · 기본 화면(연결됨)", base_state(
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=2,
        mrv_last="브로워 분전반 전송 완료 (14:30)")),
    ("MRV · 전력 입력 패널", base_state(
        _open="power",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    ("MRV · 지침 입력(키패드)", base_state(
        _open="power_entry",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    ("MRV · 첫 지침(기준점)", base_state(
        _open="power_entry_first",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    ("MRV · 계측기 많은 현장", base_state(
        _open="power",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS_MANY,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    # 같은 15대 현장에 거르개를 켠 그림. 「15대 중 3대 표시」가 목록 머리에 뜨고,
    # 아래 [전체 보기] 로 15대를 다시 볼 수 있다(화면 상태일 뿐 설정은 바뀌지 않는다).
    ("MRV · 거르개 켜짐(3대)", base_state(
        _open="power",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS_MANY,
        mrv_visible=MRV_VISIBLE_PICK,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    # 고른 계측기가 웹에서 지워진 그림. **조용히 감추지 않고 알린다** — 작업자는
    # "어제 넣던 것이 없어졌다" 를 알아야 한다.
    ("MRV · 고른 계측기가 사라짐", base_state(
        _open="power",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS_MANY,
        mrv_visible=MRV_VISIBLE_PICK[:2] + ["mtr_pump9"],
        mrv_meters_missing=["mtr_pump9"],
        mrv_recent=MRV_RECENT, mrv_today=2)),
    # 고르는 화면 자체. 센서 토글과 같은 모양인지 여기서 본다.
    ("MRV · 읽을 계측기 고르기", base_state(
        _open="mrv_visible",
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS_MANY,
        mrv_visible=MRV_VISIBLE_PICK,
        mrv_recent=MRV_RECENT, mrv_today=2)),
    ("MRV · 미전송 보관분", base_state(
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=1, mrv_pending=3,
        mrv_last="순환펌프 보관 — 회선 복구 시 전송 (14:28)")),
    ("MRV · 서버가 받지 않은 보관분", base_state(
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=0, mrv_pending=3, mrv_blocked=2,
        mrv_blocked_reason="meter mtr_pump is out of scope for this api key",
        mrv_last="보관분 전송 중단 — meter mtr_pump is out of scope for this api key")),
    ("MRV · 장비 시계 이상", base_state(
        mode="mrv", sensors_on=False, values={}, status="14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_clock_ok=False)),
    ("MRV · 수질 센서도 붙인 장비", base_state(
        mode="mrv", sensors_on=True, status="sent 14:32",
        mrv_linked=True, mrv_site_id="site_culiver_01", mrv_meters=MRV_METERS,
        mrv_recent=MRV_RECENT, mrv_today=2)),
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
    }[field]
    out = {}
    for hours in (6, 12, 24, 168):
        points, step = [], max(1, hours * 3600 // 150)
        for i in range(150):
            ts = NOW - hours * 3600 + i * step
            h = (ts % 86400) / 3600
            avg = base + math.sin((h - 6) / 3.8) * swing + random.uniform(-swing, swing) * 0.08
            digits = 2
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
var OPENERS = __OPENERS__;
var SCAN = __SCAN__, AUTO = __AUTO__;
var WIFI_NETWORKS = __WIFI_NETWORKS__, wifiCur = __WIFI_START__;
var MRV_HAS_PREV = __MRV_HAS_PREV__;
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
  // MRV — 전력 계측기 목록과 전송 결과. 서버가 돌려주는 모양 그대로 흉내 낸다.
  else if (url.indexOf("/api/mrv/meters") === 0) {
    var st = STATES[current][1];
    body = {ok:true, items: st.mrv_meters || [], clock_ok: st.mrv_clock_ok !== false,
            pending: st.mrv_pending || 0,
            // 거르개는 **화면이** 적용한다. 서버는 목록 전체와 고른 id 를 함께 준다.
            visible: st.mrv_visible || [], missing: st.mrv_meters_missing || []};
  }
  else if (url.indexOf("/api/mrv/visible") === 0) {
    var s3 = {};
    try { s3 = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
    STATES[current][1].mrv_visible = s3.ids || [];
    body = {ok:true, saved:true, visible: s3.ids || []};
  }
  else if (url.indexOf("/api/mrv/power") === 0) {
    var s2 = STATES[current][1];
    var sent = {};
    try { sent = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
    if (s2.mrv_clock_ok === false) {
      body = {ok:false, queued:false, code:"clock", pending:(s2.mrv_pending || 0)};
    } else if (s2.mrv_pending) {
      body = {ok:false, queued:true, code:"offline", pending:(s2.mrv_pending || 0) + 1};
    } else {
      // 지침이면 직전 1건이 중복으로 흡수되고, 새 건은 구간값이 되어 산입된다.
      var cum = sent.kind === "cumulative_kwh";
      var first = cum && (MRV_HAS_PREV[sent.meter_id] === false);
      body = {ok:true, queued:false, baseline:first,
              accepted:1, deduped:(cum && !first) ? 1 : 0, rejected:0,
              quality:{ok:first ? 0 : 1, suspect:0, bad:first ? 1 : 0},
              countable:!first, pending:0};
    }
  }
  else if (url.indexOf("/api/mrv/") === 0) body = {ok:true};
  else if (url.indexOf("/api/wifi") === 0) {
    body = {available:true, device:"wlan0", radio:true,
            connected:!!wifiCur, ssid:wifiCur, ip: wifiCur ? "192.168.0.42" : null};
  }
  else body = {ok:true};
  return Promise.resolve({ ok:true, json: function(){ return Promise.resolve(body); } });
};

// 그 장면에서 열어 둘 패널을 연다. 탭 이름이 「전력 입력 패널」인데 기본 화면이
// 보이면, 보는 사람은 없는 화면을 있다고 믿게 된다.
function openFor(i){
  var want = OPENERS[i];
  if (!want) return;
  if (want === "mrv" && typeof openMrv === "function") return openMrv();
  // 「읽을 계측기 고르기」 — MRV 연결 화면을 열고 그 안의 고르기 화면까지 들어간다.
  if (want === "mrv_visible" && typeof openMrv === "function") {
    openMrv();
    if (typeof mrvVisStart === "function") mrvVisStart();
    return;
  }
  if (typeof openPower !== "function") return;
  openPower();
  // 계측기를 고른 뒤라야 키패드와 2건 규칙 안내가 나온다. 목록 화면만 띄워 놓고
  // 「전력 입력 패널」이라고 적어 두면, 보는 사람은 입력 화면을 본 적이 없으면서
  // 봤다고 믿는다.
  //   power_entry        직전 지침이 있는 계측기 (사용량이 바로 계산된다)
  //   power_entry_first  직전 지침이 없는 계측기 (기준점으로만 쓰인다)
  if (want === "power_entry" && typeof pwrPick === "function") pwrPick(0);
  else if (want === "power_entry_first" && typeof pwrPick === "function") pwrPick(2);
}

window.addEventListener("message", function(e){
  if (e.data && typeof e.data.state === "number") {
    current = e.data.state;
    if (typeof closeSettings === "function") closeSettings();
    if (typeof closeChart === "function") closeChart();
    if (typeof closeWifi === "function") closeWifi();
    if (typeof closePower === "function") closePower();
    tick();
    openFor(current);
  }
});

// 첫 장면도 똑같이 — 0번 탭이 패널 탭일 수 있다.
setTimeout(function(){ openFor(current); }, 0);
</script>
"""


def main() -> int:
    # 판정 밴드는 webui.serve() 가 limits.py 에서 주입한다. 미리보기는 그 함수를
    # 거치지 않으므로 여기서 같은 치환을 해 준다 — 안 하면 화면 스크립트가
    # `var BANDS = __BANDS__;` 에서 그대로 깨진다.
    page = (webui.PAGE
            .replace("__MODE__", "aquaculture")
            .replace("__LANG__", "ko")
            .replace("__BANDS__", json.dumps(limits.BANDS))
            .replace("__NUT_BANDS__", json.dumps(limits.NUTRIENT_BANDS)))
    # `_open` 은 미리보기만의 것이다. 장비가 받는 상태에 남기지 않는다.
    openers = [st.pop("_open", None) for _, st in STATES]
    mock = (MOCK
            .replace("__OPENERS__", json.dumps(openers))
            .replace("__STATES__", json.dumps(STATES, ensure_ascii=False))
            .replace("__HIST__", json.dumps(HIST))
            .replace("__SENSORS__", json.dumps(SENSORS, ensure_ascii=False))
            .replace("__SCAN__", json.dumps(SCAN, ensure_ascii=False))
            .replace("__AUTO__", json.dumps(AUTO, ensure_ascii=False))
            .replace("__WIFI_NETWORKS__", json.dumps(WIFI_NETWORKS, ensure_ascii=False))
            .replace("__WIFI_START__", json.dumps(WIFI_START, ensure_ascii=False))
            .replace("__MRV_HAS_PREV__", json.dumps(
                {m["id"]: m["has_prev"] for m in MRV_METERS + MRV_METERS_MANY})))
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
  녹색 띠가 적정 범위입니다(흰다리새우 기준).<br>
  <b>오른쪽 아래 [설정]</b> — 슬레이브 ID·측정 주기를 손가락으로 고칩니다.
  <b>[자동 배치]</b> 는 꽂아 둔 센서를 훑어 값이 나오는 자리를 그대로 배정합니다(이 미리보기에선 용존산소가 3→5로 바뀝니다).<br>
  <b>[Wi‑Fi]</b> — 주변 공유기를 검색해 화면 키보드로 비밀번호를 넣고 붙입니다(이 미리보기에서도 눌러 볼 수 있습니다. 잠긴 공유기를 고르면 화면 키보드가 뜨고, [연결] 하면 위쪽 연결 표시가 그 공유기로 바뀝니다).<br>
  <b>[운전 모드]</b> — 설정 → 운전 모드에서 양식장·스마트팜·탄소 MRV 를 고릅니다. 모드는 상호
  배타이고, 무엇을 <b>먼저 보여 줄지</b>를 가릅니다(수질 수집·전송은 모드와 무관하게 계속됩니다).<br>
  <b>[전력 입력]</b> — MRV 모드의 기본 화면이 전력 입력 단말입니다. 큰 버튼을 누르면 계측기를 고르고
  지침(계량기 누적 숫자)이나 구간 사용량을 큰 키패드로 넣습니다. 지침은 직전 지침과 함께
  두 건으로 올라가 그 차이가 구간 사용량이 됩니다(한 건씩 보내면 KPI 에서 빠집니다).<br>
  단위는 <b>용존산소 ppm · 염도 ‰ · 전도도 µS/cm · pH · 전력 kWh</b> 입니다.
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
