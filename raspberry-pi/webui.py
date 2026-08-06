"""라즈베리파이 화면에 띄우는 로컬 상태 페이지.

공식 7인치 터치스크린(800×480)에 맞춰 만들었다. 크로미움을 키오스크 모드로
이 페이지에 붙여 두면 장비 자체가 하나의 계기판이 된다.

화면 원칙
  · 기본 화면은 **항상 측정값**이다. 서버에 연결됐든 아니든, 인터넷이 있든
    없든 눈앞의 수질값이 먼저다. 값이 정말 급한 순간이 회선이 죽었을 때다.
  · 페어링 코드는 **버튼을 눌렀을 때만** 뜬다. 아직 연결하지 않은 장비도
    계측기로는 멀쩡히 쓸 수 있어야 한다.
  · 연결된 뒤에는 **어느 계정·수조에 붙어 있는지**를 화면에 남긴다.

127.0.0.1 에만 바인딩한다. 장비 화면 전용이라 밖으로 열 이유가 없다.
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

log = logging.getLogger("shrimp365.webui")


class State:
    """수집기와 화면이 함께 보는 상태. 갱신이 잦지 않아 잠금 하나로 충분하다."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict = {
            "values": {},          # 측정값 — 연결 여부와 무관하게 항상 갱신
            "status": "",          # 하단에 뜨는 한 줄
            "updated_at": None,
            "errors": {},
            "serial": "",
            "pending": 0,          # 아직 못 올린 보관 건수

            "linked": False,       # 서버에 연결된 기기인가
            "account": None,       # 연결된 계정 (일부 가림)
            "tank": None,          # 연결된 수조 이름
            "farm": None,

            "pairing": False,      # 연결 화면을 띄우는 중인가
            "pair_code": None,
            "pair_url": "",
            "pair_error": None,
        }

    def update(self, **kwargs) -> None:
        with self._lock:
            self._data.update(kwargs)

    def snapshot(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._data))


PAGE = """<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=800,initial-scale=1">
<title>Shrimp365</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden}
  body{
    background:#0B1120;color:#E8EDF7;
    font:500 16px/1.4 system-ui,-apple-system,"Noto Sans KR",sans-serif;
    display:flex;flex-direction:column;
    -webkit-user-select:none;user-select:none;
  }
  header{
    display:flex;align-items:center;gap:10px;
    padding:9px 16px;border-bottom:1px solid #22304C;background:#111A2E;
  }
  .mark{width:24px;height:24px;border-radius:6px;background:#1E40AF;
    display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .brand{font-weight:800;letter-spacing:-.02em;font-size:16px}
  .link{
    margin-left:auto;display:flex;align-items:center;gap:7px;
    font-size:13px;color:#94A3B8;min-width:0;
  }
  .link b{color:#E8EDF7;font-weight:600}
  .chip{
    font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;
    border:1px solid #22304C;color:#94A3B8;white-space:nowrap;flex:0 0 auto;
  }
  .chip.on{border-color:#10B981;color:#10B981}
  .chip.off{border-color:#D97706;color:#F59E0B}
  .chip.hold{border-color:#3B82F6;color:#60A5FA}

  main{flex:1;display:flex;align-items:center;justify-content:center;padding:10px 16px;min-height:0}

  /* 측정값 — 2×2 */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;width:100%;height:100%}
  .cell{
    background:#111A2E;border:1px solid #22304C;border-radius:14px;
    padding:10px 18px;display:flex;flex-direction:column;justify-content:center;
  }
  .k{font-size:15px;color:#94A3B8;font-weight:600}
  .v{font:800 56px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;
     margin-top:4px;letter-spacing:-.02em}
  .v small{font-size:21px;font-weight:600;color:#94A3B8;margin-left:6px}
  .cell.warn{border-color:#D97706}
  .cell.warn .v{color:#F59E0B}
  .cell.crit{border-color:#DC2626}
  .cell.crit .v{color:#F87171}
  .cell.none .v{color:#475569}
  .cell{cursor:pointer}
  .cell:active{background:#16223C}
  .tap{font-size:11px;color:#475569;font-weight:600}

  /* 설정 화면 */
  .setup{
    position:fixed;inset:0;background:#0B1120;z-index:30;
    display:flex;flex-direction:column;padding:10px 16px 12px;
  }
  /* 목록만 스크롤한다. 저장 버튼이 화면 밖으로 밀리면 안 된다. */
  .sbody{flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch}
  .sfoot{flex:0 0 auto;padding-top:8px}
  .srow{
    display:flex;align-items:center;gap:10px;
    padding:7px 12px;margin-bottom:6px;
    background:#111A2E;border:1px solid #22304C;border-radius:11px;
  }
  .sname{font-size:15px;font-weight:700;flex:1;min-width:0}
  .sub{font-size:11px;color:#64748B;font-weight:500}
  .toggle{
    font:700 12px/1 inherit;padding:9px 13px;min-height:38px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#64748B;cursor:pointer;
  }
  .toggle.on{border-color:#10B981;color:#10B981;background:#10B98115}
  .step{display:flex;align-items:center;gap:0}
  .step button{
    width:40px;height:38px;font:800 18px/1 inherit;
    background:#16223C;color:#93A4BF;border:1px solid #22304C;cursor:pointer;
  }
  .step button:first-child{border-radius:8px 0 0 8px}
  .step button:last-child{border-radius:0 8px 8px 0}
  .step button:active{background:#1E40AF;color:#fff}
  .step .num{
    width:46px;height:38px;display:flex;align-items:center;justify-content:center;
    background:#0B1120;border-top:1px solid #22304C;border-bottom:1px solid #22304C;
    font:800 16px/1 ui-monospace,monospace;
  }
  .found{
    font-size:12px;color:#94A3B8;line-height:1.75;max-height:118px;overflow-y:auto;
    background:#111A2E;border:1px solid #22304C;border-radius:11px;
    padding:9px 12px;margin-bottom:7px;
  }
  .found b{color:#60A5FA;font-family:ui-monospace,monospace}
  .msg{font-size:12px;padding:8px 12px;border-radius:9px;margin-bottom:7px}
  .msg.ok{background:#10B98118;color:#34D399}
  .msg.err{background:#DC262618;color:#F87171}

  /* 그래프 화면 */
  .chart{
    position:fixed;inset:0;background:#0B1120;z-index:20;
    display:flex;flex-direction:column;padding:10px 16px 12px;
  }
  .chead{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .ctitle{font-size:18px;font-weight:800}
  .cnow{font:800 22px/1 ui-monospace,monospace;color:#60A5FA}
  .cstats{margin-left:auto;display:flex;gap:12px;font-size:12px;color:#94A3B8}
  .cstats b{color:#E8EDF7;font-weight:700;font-family:ui-monospace,monospace}
  .ranges{display:flex;gap:6px;margin-bottom:6px}
  .ranges button{
    font:700 13px/1 inherit;padding:8px 14px;min-height:36px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;
  }
  .ranges button[aria-pressed="true"]{background:#1E40AF;border-color:#1E40AF;color:#fff}
  .ranges .close{margin-left:auto;border-color:#22304C}
  .plot{flex:1;min-height:0;background:#111A2E;border:1px solid #22304C;border-radius:12px}
  .plot svg{display:block;width:100%;height:100%}
  .nodata{
    flex:1;display:flex;align-items:center;justify-content:center;
    background:#111A2E;border:1px solid #22304C;border-radius:12px;color:#64748B;font-size:15px;
  }

  footer{
    display:flex;align-items:center;gap:12px;
    padding:7px 16px;border-top:1px solid #22304C;background:#111A2E;font-size:13px;
  }
  .dot{width:8px;height:8px;border-radius:50%;background:#64748B;flex:0 0 auto}
  .dot.ok{background:#10B981}
  .dot.bad{background:#DC2626}
  .status{color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .time{color:#64748B;font:500 13px ui-monospace,monospace;flex:0 0 auto}
  button.act{
    margin-left:auto;flex:0 0 auto;
    font:700 13px/1 inherit;padding:9px 16px;min-height:38px;border-radius:8px;
    background:#1E40AF;color:#fff;border:0;cursor:pointer;
  }
  button.act.ghost{background:transparent;border:1px solid #22304C;color:#94A3B8}
  button.act:active{opacity:.75}

  /* 연결 화면 — 버튼을 눌렀을 때만 덮는다 */
  .overlay{
    position:fixed;inset:0;background:#0B1120;z-index:10;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:14px 20px;text-align:center;
  }
  .overlay h1{font-size:21px;font-weight:700;margin-bottom:4px}
  .overlay p{color:#94A3B8;font-size:14px;line-height:1.5}
  .code{
    font:800 74px/1 ui-monospace,monospace;letter-spacing:18px;
    color:#60A5FA;margin:12px 0 8px;padding-left:18px;white-space:nowrap;
  }
  .steps{
    text-align:left;display:inline-block;margin-top:6px;
    background:#111A2E;border:1px solid #22304C;border-radius:12px;padding:10px 20px;
  }
  .steps li{color:#CBD5E1;font-size:13.5px;margin:2px 0;line-height:1.45}
  .ovbtns{display:flex;gap:10px;margin-top:14px}
  .err{color:#F87171;font-size:14px;margin-top:10px}
</style>

<header>
  <span class="mark">
    <svg width="14" height="14" viewBox="0 0 32 32" fill="#fff" aria-hidden="true">
      <path d="M13.4 25.4C7.4 24.8 3.6 19.6 4.6 14.0C5.8 7.6 12.4 3.9 19.0 6.1C21.2 6.9 23.1 8.2 24.4 9.9L20.1 13.5C19.3 12.5 18.2 11.7 17.0 11.3C13.4 10.1 10.1 12.2 9.6 15.3C9.1 18.0 11.0 20.6 14.0 21.1Z"/>
      <path d="M23.2 8.6L29.0 5.8L27.2 11.0L29.2 14.8L20.6 13.4Z"/>
    </svg>
  </span>
  <span class="brand">Shrimp365</span>
  <span class="link" id="link"></span>
</header>

<main id="main"></main>

<footer>
  <span class="dot" id="dot"></span>
  <span class="status" id="status">시작하는 중…</span>
  <span class="time" id="time"></span>
  <button class="act ghost" id="settings" type="button" onclick="openSettings()">설정</button>
  <button class="act" id="action" type="button"></button>
</footer>

<div id="overlay"></div>
<div id="chart"></div>
<div id="setup"></div>

<script>
// 흰다리새우 적정 범위. 화면에서 바로 이상을 알아보기 위한 것으로,
// 실제 알림 판정은 서버가 한다.
var RANGES = {
  temperature: {label:"수온", unit:"\\u00B0C", digits:1, ok:[28,32],  warn:[26,34]},
  ph:          {label:"pH",   unit:"",         digits:2, ok:[7.5,8.5], warn:[7,9]},
  do_level:    {label:"용존산소", unit:"mg/L", digits:2, ok:[5,20],   warn:[4,20]},
  salinity:    {label:"염도", unit:"ppt",      digits:1, ok:[5,35],   warn:[3,40]}
};
var ORDER = ["temperature","ph","do_level","salinity"];

function level(key, v){
  var r = RANGES[key]; if(!r) return "";
  if(v >= r.ok[0] && v <= r.ok[1]) return "";
  if(v >= r.warn[0] && v <= r.warn[1]) return "warn";
  return "crit";
}

function esc(s){ return String(s).replace(/[&<>]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }

// 측정값은 언제나 이 화면이다. 연결 여부와 무관하다.
function renderValues(d){
  var cells = ORDER.map(function(key){
    var r = RANGES[key];
    var has = d.values && typeof d.values[key] === "number";
    var v = has ? d.values[key].toFixed(r.digits) : "--";
    var cls = has ? level(key, d.values[key]) : "none";
    // 따옴표 이스케이프를 피하려고 &quot; 를 쓴다. PAGE 가 파이썬 문자열이라
    // 백슬래시가 한 번 더 벗겨져 JS 가 깨지기 쉽다.
    return '<div class="cell ' + cls + '" onclick="openChart(&quot;' + key + '&quot;)">' +
           '<div class="k">' + r.label + ' <span class="tap">그래프 ›</span></div>' +
           '<div class="v">' + v + (r.unit ? '<small>' + r.unit + '</small>' : '') + '</div></div>';
  }).join("");
  return '<div class="grid">' + cells + '</div>';
}

// 연결 상태 — 어느 계정·수조에 붙어 있는지
function renderLink(d){
  // 아직 못 올린 값이 있으면 몇 건인지 먼저 알린다.
  var hold = d.pending ? '<span class="chip hold">보관 ' + d.pending + '건</span>' : "";
  if (d.linked) {
    var where = [d.farm, d.tank].filter(Boolean).join(" · ");
    return (d.account ? '<span><b>' + esc(d.account) + '</b></span>' : "") +
           (where ? '<span>' + esc(where) + '</span>' : "") +
           hold + '<span class="chip on">연결됨</span>';
  }
  return '<span>이 장비는 계정에 연결되지 않았습니다</span>' +
         hold + '<span class="chip off">미연결</span>';
}

function renderOverlay(d){
  if (!d.pairing) return "";
  if (d.pair_error) {
    return '<div class="overlay"><h1>연결 코드를 받지 못했습니다</h1>' +
      '<p>' + esc(d.pair_error) + '</p>' +
      '<div class="ovbtns">' +
        '<button class="act" onclick="startPair()">다시 시도</button>' +
        '<button class="act ghost" onclick="cancelPair()">닫기</button>' +
      '</div></div>';
  }
  if (!d.pair_code) {
    return '<div class="overlay"><h1>연결 코드를 받는 중…</h1>' +
      '<div class="ovbtns"><button class="act ghost" onclick="cancelPair()">취소</button></div></div>';
  }
  return '<div class="overlay">' +
    '<h1>기기를 연결해 주세요</h1>' +
    '<p>Shrimp365에 로그인한 뒤 아래 코드를 입력하세요<br>' +
    '연결 전 측정값도 저장해 두었다가 함께 올립니다</p>' +
    '<div class="code">' + esc(d.pair_code) + '</div>' +
    '<div class="steps"><ol>' +
      '<li>휴대폰이나 이 화면에서 <b>' + esc(d.pair_url || "www.shrimp365.kr") + '</b> 접속</li>' +
      '<li>로그인 → 양식장·수조 관리</li>' +
      '<li>수조의 <b>센서 기기</b> → <b>코드로 기기 연결</b></li>' +
      '<li>위 6자리 코드 입력</li>' +
    '</ol></div>' +
    '<div class="ovbtns"><button class="act ghost" onclick="cancelPair()">취소</button></div>' +
    '</div>';
}


// ── 그래프 ──────────────────────────────────────────────────────────────────
// 6시간·12시간·24시간·일주일. 파이가 자체 보관한 이력으로 그리므로
// 인터넷이 끊겨 있어도 볼 수 있다.
var RANGE_OPTIONS = [
  {hours:6,   label:"6시간"},
  {hours:12,  label:"12시간"},
  {hours:24,  label:"24시간"},
  {hours:168, label:"일주일"}
];
var chartKey = null;
var chartHours = 24;

function openChart(key){
  chartKey = key;
  chartHours = 24;
  loadChart();
}
function closeChart(){
  chartKey = null;
  document.getElementById("chart").innerHTML = "";
}
function setRange(h){
  chartHours = h;
  loadChart();
}

function loadChart(){
  if (!chartKey) return;
  var key = chartKey, hours = chartHours;
  fetch("/api/history?key=" + key + "&hours=" + hours, {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      // 응답이 늦게 왔는데 그새 닫혔거나 다른 항목을 열었으면 버린다.
      if (chartKey !== key || chartHours !== hours) return;
      drawChart(key, hours, d);
    })
    .catch(function(){ drawChart(key, hours, {points:[], count:0}); });
}

function fmtTick(ts, hours){
  var d = new Date(ts * 1000);
  var p = function(n){ return (n < 10 ? "0" : "") + n; };
  // 하루가 넘어가면 시각만으로는 구분이 안 된다.
  return hours > 24 ? (d.getMonth()+1) + "/" + d.getDate()
                    : p(d.getHours()) + ":" + p(d.getMinutes());
}

function drawChart(key, hours, d){
  var r = RANGES[key];
  var W = 768, H = 250, padL = 52, padR = 12, padT = 12, padB = 26;

  var buttons = RANGE_OPTIONS.map(function(o){
    return '<button onclick="setRange(' + o.hours + ')" aria-pressed="' +
      (o.hours === hours) + '">' + o.label + '</button>';
  }).join("");

  var head =
    '<div class="chead">' +
      '<span class="ctitle">' + r.label + '</span>' +
      (d.count ? '<span class="cnow">' + d.points[d.points.length-1][1].toFixed(r.digits) +
                 (r.unit ? '<small style="font-size:13px;color:#94A3B8"> ' + r.unit + '</small>' : '') + '</span>' : '') +
      (d.count ? '<span class="cstats">' +
        '<span>최저 <b>' + d.min.toFixed(r.digits) + '</b></span>' +
        '<span>평균 <b>' + d.avg.toFixed(r.digits) + '</b></span>' +
        '<span>최고 <b>' + d.max.toFixed(r.digits) + '</b></span>' +
      '</span>' : '') +
    '</div>' +
    '<div class="ranges">' + buttons +
      '<button class="close" onclick="closeChart()">닫기</button>' +
    '</div>';

  if (!d.count) {
    document.getElementById("chart").innerHTML =
      '<div class="chart">' + head +
      '<div class="nodata">이 구간에 기록된 값이 없습니다</div></div>';
    return;
  }

  // 세로 범위 — 값이 화면을 채우되 적정 범위 경계도 보이게 잡는다.
  // 적정 범위를 통째로 포함시키면(예: DO 상한 20) 실제 곡선이 아래에
  // 눌려 붙어 변화를 읽을 수 없다. 그래서 데이터 폭의 25% 안에서만
  // 경계 쪽으로 넓힌다.
  var span = Math.max(d.max - d.min, Math.pow(10, -r.digits));
  var margin = span * 0.25;
  var lo = Math.min(d.min, Math.max(r.ok[0], d.min - margin));
  var hi = Math.max(d.max, Math.min(r.ok[1], d.max + margin));
  var pad = Math.max((hi - lo) * 0.08, Math.pow(10, -r.digits));
  lo -= pad; hi += pad;

  var t0 = d.points[0][0], t1 = Math.max(d.points[d.points.length-1][0], t0 + 1);
  var x = function(t){ return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
  var y = function(v){ return padT + (hi - v) / (hi - lo) * (H - padT - padB); };

  // 적정 범위 띠
  var bandTop = y(Math.min(r.ok[1], hi)), bandBottom = y(Math.max(r.ok[0], lo));
  var band = '<rect x="' + padL + '" y="' + bandTop + '" width="' + (W-padL-padR) +
             '" height="' + Math.max(0, bandBottom - bandTop) +
             '" fill="#10B981" opacity="0.10"/>';

  // 최저~최고 범위(칸마다)를 옅게 깔고 그 위에 평균선을 얹는다.
  var top = d.points.map(function(p){ return x(p[0]) + "," + y(p[3]); });
  var bot = d.points.map(function(p){ return x(p[0]) + "," + y(p[2]); }).reverse();
  var spread = '<polygon points="' + top.concat(bot).join(" ") +
               '" fill="#60A5FA" opacity="0.18"/>';

  var line = '<polyline fill="none" stroke="#60A5FA" stroke-width="2" ' +
             'stroke-linejoin="round" stroke-linecap="round" points="' +
             d.points.map(function(p){ return x(p[0]) + "," + y(p[1]); }).join(" ") + '"/>';

  // 가로 눈금 4개
  var gridY = "", labelsY = "";
  for (var i = 0; i <= 3; i++) {
    var v = lo + (hi - lo) * i / 3, gy = y(v);
    gridY += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W-padR) + '" y2="' + gy +
             '" stroke="#22304C" stroke-width="1"/>';
    labelsY += '<text x="' + (padL-8) + '" y="' + (gy+4) + '" text-anchor="end" ' +
               'fill="#64748B" font-size="11" font-family="ui-monospace,monospace">' +
               v.toFixed(r.digits) + '</text>';
  }

  // 세로 눈금 — 시각
  var labelsX = "";
  [0, 0.5, 1].forEach(function(f){
    var t = t0 + (t1 - t0) * f;
    labelsX += '<text x="' + x(t) + '" y="' + (H-8) + '" text-anchor="' +
      (f === 0 ? "start" : f === 1 ? "end" : "middle") +
      '" fill="#64748B" font-size="11" font-family="ui-monospace,monospace">' +
      fmtTick(t, hours) + '</text>';
  });

  var last = d.points[d.points.length-1];
  var dot = '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="4" fill="#60A5FA"/>';

  document.getElementById("chart").innerHTML =
    '<div class="chart">' + head +
    '<div class="plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      gridY + band + spread + line + dot + labelsY + labelsX +
    '</svg></div></div>';
}

function render(d){
  document.getElementById("link").innerHTML = renderLink(d);
  // 그래프를 보고 있는 중에는 뒤 화면을 다시 그리지 않는다.
  // 3초마다 갱신하면 조작 중에 깜빡이고 눌림이 씹힌다.
  if (!chartKey) document.getElementById("main").innerHTML = renderValues(d);
  document.getElementById("overlay").innerHTML = renderOverlay(d);

  var st = d.status || "";
  var bad = /FAIL|ERROR|실패|오류/i.test(st);
  document.getElementById("dot").className = "dot" + (bad ? " bad" : (d.linked ? " ok" : ""));
  document.getElementById("status").textContent = st;
  document.getElementById("time").textContent = d.updated_at || "";

  var btn = document.getElementById("action");
  btn.textContent = d.linked ? "연결 정보" : "기기 연결";
  btn.className = "act" + (d.linked ? " ghost" : "");
  btn.onclick = d.linked ? showInfo : startPair;
}

function showInfo(){
  // 이미 연결된 장비에서 다시 연결하면 기존 기기와 중복된다.
  // 어디에 붙어 있는지만 알려 주고, 다시 연결은 초기화 절차를 거치게 한다.
  alert("연결된 계정 정보는 화면 오른쪽 위에 표시됩니다.\\n"
      + "다른 계정으로 옮기려면 설정 파일의 device_key 를 비우고 재시작하세요.");
}

function startPair(){ fetch("/api/pair/start", {method:"POST"}).then(tick); }
function cancelPair(){ fetch("/api/pair/cancel", {method:"POST"}).then(tick); }


// ── 설정 화면 ───────────────────────────────────────────────────────────────
// SSH 로 설정 파일을 고치던 것들을 화면에서 하게 한다. 현장에서는 수조 옆에
// 선 채로 고쳐야지, 노트북을 들고 와 접속할 일이 아니다.
var setupData = null, setupMsg = null;

function openSettings(){
  fetch("/api/sensors", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ setupData = d; setupMsg = null; drawSettings(); })
    .catch(function(){ alert("설정을 불러오지 못했습니다."); });
}

function closeSettings(){
  setupData = null;
  document.getElementById("setup").innerHTML = "";
  tick();
}

function drawSettings(){
  if (!setupData) return;
  var d = setupData;

  var rows = d.sensors.map(function(sn, i){
    return '<div class="srow">' +
      '<div class="sname">' + sn.label +
        '<div class="sub">' + (sn.enabled ? "사용 중" : "사용 안 함") + '</div></div>' +
      '<button class="toggle' + (sn.enabled ? " on" : "") + '" ' +
        'onclick="toggleSensor(' + i + ')">' + (sn.enabled ? "켬" : "끔") + '</button>' +
      '<div class="step">' +
        '<button onclick="bumpId(' + i + ',-1)">−</button>' +
        '<div class="num">' + sn.slave_id + '</div>' +
        '<button onclick="bumpId(' + i + ',1)">+</button>' +
      '</div></div>';
  }).join("");

  var msg = setupMsg
    ? '<div class="msg ' + setupMsg.kind + '">' + setupMsg.text + '</div>' : "";

  var found = d.found ? renderFound(d.found) : "";

  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">센서 설정</span>' +
        '<span class="cstats"><span>' + (d.port || "") + '</span></span>' +
        '<button onclick="closeSettings()">닫기</button>' +
      '</div>' +
      '<div class="sbody">' +
        msg + found +
        '<div class="sub" style="margin:2px 0 6px">센서마다 슬레이브 ID 가 달라야 합니다</div>' +
        rows +
        '<div class="srow">' +
          '<div class="sname">측정 주기<div class="sub">초 · 60보다 짧게는 권하지 않습니다</div></div>' +
          '<div class="step">' +
            '<button onclick="bumpInterval(-60)">−</button>' +
            '<div class="num">' + d.interval + '</div>' +
            '<button onclick="bumpInterval(60)">+</button>' +
          '</div></div>' +
      '</div>' +
      '<div class="ranges sfoot">' +
        '<button onclick="autoAssign()">자동 배치</button>' +
        '<button onclick="scanBus()">선 훑기</button>' +
        '<button onclick="saveSettings()" aria-pressed="true">저장</button>' +
      '</div>' +
    '</div>';
}

function renderFound(found){
  if (!found.length) return '<div class="msg err">응답하는 센서가 없습니다. 전원과 A/B 배선을 확인하세요.</div>';
  if (found[0].error) return '<div class="msg err">' + found[0].error + '</div>';
  var list = found.map(function(f){
    return 'ID <b>' + f.id + '</b> — ' + f.kind + ' (' + f.note + ')';
  }).join("<br>");
  return '<div class="found">선에서 찾은 센서<br>' + list + '</div>';
}

function toggleSensor(i){
  setupData.sensors[i].enabled = !setupData.sensors[i].enabled;
  drawSettings();
}

function bumpId(i, delta){
  var v = setupData.sensors[i].slave_id + delta;
  if (v < 1) v = 1;
  if (v > 247) v = 247;
  setupData.sensors[i].slave_id = v;
  drawSettings();
}

function bumpInterval(delta){
  var v = setupData.interval + delta;
  if (v < 60) v = 60;
  if (v > 3600) v = 3600;
  setupData.interval = v;
  drawSettings();
}

function scanBus(){
  setupMsg = {kind:"ok", text:"훑는 중… 최대 30초 걸립니다."};
  drawSettings();
  fetch("/api/sensors/scan", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      setupData.found = d.found || [];
      setupMsg = null;
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:"훑지 못했습니다."};
      drawSettings();
    });
}

// 꽂아 둔 센서를 훑어 "값이 나오는 자리" 를 그대로 배치한다.
// 바로 저장하지 않고 화면의 숫자만 채운다 — 확인하고 저장은 사람이 누른다.
function autoAssign(){
  setupMsg = {kind:"ok", text:"센서를 찾는 중… 최대 30초 걸립니다."};
  drawSettings();
  fetch("/api/sensors/auto", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { setupMsg = {kind:"err", text:d.error}; drawSettings(); return; }

      var names = {ph:"pH / ORP", do:"용존산소", ec:"전도도 / 염도"};
      var conflictKeys = Object.keys(d.conflicts || {});
      if (conflictKeys.length) {
        var c = conflictKeys.map(function(k){
          return names[k] + " 가 " + d.conflicts[k].join(", ") + " 번에서 응답";
        }).join(" / ");
        setupMsg = {kind:"err", text: c + " — 어느 쪽을 쓸지 직접 골라 주세요."};
        drawSettings();
        return;
      }

      var done = [], missing = [];
      setupData.sensors.forEach(function(sn){
        if (d.assign && d.assign[sn.key] !== undefined) {
          sn.slave_id = d.assign[sn.key];
          sn.enabled = true;
          done.push(names[sn.key] + " → " + sn.slave_id);
        } else {
          sn.enabled = false;
          missing.push(names[sn.key]);
        }
      });

      if (!done.length) {
        setupMsg = {kind:"err", text:"응답하는 센서가 없습니다. 전원과 A/B 배선을 확인하세요."};
      } else {
        setupMsg = {kind:"ok", text: done.join(", ")
          + (missing.length ? " · 못 찾음: " + missing.join(", ") : "")
          + " — 확인하고 [저장] 을 누르세요."};
      }
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:"찾지 못했습니다."};
      drawSettings();
    });
}

function saveSettings(){
  var payload = {interval: setupData.interval};
  setupData.sensors.forEach(function(sn){
    payload[sn.key] = {enabled: sn.enabled, slave_id: sn.slave_id};
  });
  fetch("/api/sensors/save", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.ok) {
        setupMsg = {kind:"ok", text: d.saved
          ? "저장했습니다. 다음 측정부터 적용됩니다."
          : "적용했지만 파일에 저장하지 못했습니다(재부팅하면 되돌아갑니다)."};
      } else {
        setupMsg = {kind:"err", text: d.error || "저장하지 못했습니다."};
      }
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:"저장하지 못했습니다."};
      drawSettings();
    });
}

function tick(){
  if (setupData) return;   // 설정 중에는 뒤 화면을 다시 그리지 않는다
  fetch("/api/state", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(render)
    .catch(function(){
      // 수집기가 재시작 중일 수 있다. 다음 주기에 다시 시도한다.
      document.getElementById("status").textContent = "수집기 응답 없음";
      document.getElementById("dot").className = "dot bad";
    });
}
tick();
setInterval(tick, 3000);
</script>
</html>
"""


def serve(
    state: State,
    port: int = 8080,
    on_pair_start=None,
    on_pair_cancel=None,
    history=None,
    on_scan=None,
    on_save_sensors=None,
    on_set_id=None,
    on_auto=None,
    get_sensors=None,
) -> ThreadingHTTPServer | None:
    """상태 페이지를 띄운다. 실패해도 수집은 계속되어야 하므로 None 을 돌려준다."""

    class Handler(BaseHTTPRequestHandler):
        # 기본 로거는 요청마다 stderr 를 채운다. journald 가 지저분해지므로 끈다.
        def log_message(self, *args) -> None:
            pass

        def _send(self, code: int, body: bytes, content_type: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path.startswith("/api/state"):
                self._send(200, json.dumps(state.snapshot()).encode(), "application/json")
            elif self.path.startswith("/api/history"):
                self._history()
            elif self.path == "/api/sensors" and get_sensors is not None:
                self._send(200, json.dumps(get_sensors()).encode(), "application/json")
            elif self.path in ("/", "/index.html"):
                self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")

        def _history(self) -> None:
            if history is None:
                self._send(200, b'{"points":[],"count":0}', "application/json")
                return
            query = parse_qs(urlparse(self.path).query)
            key = (query.get("key") or [""])[0]
            try:
                hours = int((query.get("hours") or ["24"])[0])
            except ValueError:
                hours = 24
            # 화면에서 고를 수 있는 구간만 허용한다.
            if hours not in (6, 12, 24, 168):
                hours = 24
            self._send(200, json.dumps(history.series(key, hours)).encode(), "application/json")

        def _body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, TypeError):
                return {}

        def do_POST(self) -> None:
            if self.path == "/api/sensors/scan" and on_scan is not None:
                # 선을 훑는 동안 측정 차례가 오면 기다린다. 몇 초 걸릴 수 있다.
                self._send(200, json.dumps({"found": on_scan()}).encode(), "application/json")
                return
            if self.path == "/api/sensors/auto" and on_auto is not None:
                self._send(200, json.dumps(on_auto()).encode(), "application/json")
                return
            if self.path == "/api/sensors/save" and on_save_sensors is not None:
                self._send(200, json.dumps(on_save_sensors(self._body())).encode(),
                           "application/json")
                return
            if self.path == "/api/sensors/set-id" and on_set_id is not None:
                body = self._body()
                try:
                    old_id, new_id = int(body.get("from")), int(body.get("to"))
                except (TypeError, ValueError):
                    self._send(200, json.dumps({"ok": False, "error": "번호가 숫자가 아닙니다"}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_set_id(old_id, new_id)).encode(), "application/json")
                return
            if self.path == "/api/pair/start" and on_pair_start is not None:
                on_pair_start()
                self._send(200, b'{"ok":true}', "application/json")
            elif self.path == "/api/pair/cancel" and on_pair_cancel is not None:
                on_pair_cancel()
                self._send(200, b'{"ok":true}', "application/json")
            else:
                self._send(404, b"not found", "text/plain")

    try:
        # 장비 화면 전용이라 바깥으로 열지 않는다.
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        log.error("상태 페이지를 열지 못했습니다(%s). 화면 없이 계속합니다.", exc)
        return None

    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("상태 페이지: http://127.0.0.1:%d", port)
    return server
