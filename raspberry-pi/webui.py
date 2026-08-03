"""라즈베리파이 화면에 띄우는 로컬 상태 페이지.

공식 7인치 터치스크린(800×480)에 맞춰 만들었다. 크로미움을 키오스크 모드로
이 페이지에 붙여 두면 장비 자체가 하나의 계기판이 된다.

이 페이지를 따로 두는 이유
  · 페어링 코드와 측정값을 같은 화면에서 보여줘야 한다. 브라우저가 Shrimp365를
    바로 띄우면 아직 연결되지 않은 기기는 코드를 표시할 자리가 없다.
  · 인터넷이 끊겨도 현재 수질값은 계속 보여야 한다. 정작 값이 필요한 순간이
    회선이 죽었을 때다.

127.0.0.1 에만 바인딩한다. 장비 화면 전용이라 밖으로 열 이유가 없다.
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("shrimp365.webui")


class State:
    """수집기와 화면이 함께 보는 상태. 갱신이 잦지 않아 잠금 하나로 충분하다."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict = {
            "mode": "starting",      # starting | pairing | running
            "values": {},
            "status": "",
            "pair_code": None,
            "pair_url": "",
            "serial": "",
            "tank": "",
            "updated_at": None,
            "errors": {},
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
    -webkit-user-select:none;user-select:none;cursor:none;
  }
  header{
    display:flex;align-items:center;gap:10px;
    padding:10px 18px;border-bottom:1px solid #22304C;background:#111A2E;
  }
  .mark{width:26px;height:26px;border-radius:7px;background:#1E40AF;
    display:flex;align-items:center;justify-content:center}
  .brand{font-weight:800;letter-spacing:-.02em;font-size:17px}
  .serial{margin-left:auto;font:500 12px ui-monospace,monospace;color:#64748B}

  main{flex:1;display:flex;align-items:center;justify-content:center;padding:10px 18px;min-height:0}

  /* 측정값 — 2×2 */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;height:100%}
  .cell{
    background:#111A2E;border:1px solid #22304C;border-radius:14px;
    padding:12px 18px;display:flex;flex-direction:column;justify-content:center;
  }
  .k{font-size:15px;color:#94A3B8;font-weight:600}
  .v{font:800 58px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;
     margin-top:4px;letter-spacing:-.02em}
  .v small{font-size:22px;font-weight:600;color:#94A3B8;margin-left:6px}
  .cell.warn{border-color:#D97706}
  .cell.warn .v{color:#F59E0B}
  .cell.crit{border-color:#DC2626}
  .cell.crit .v{color:#F87171}

  /* 페어링 */
  .pair{text-align:center}
  .pair h1{font-size:22px;font-weight:700;margin-bottom:4px}
  .pair p{color:#94A3B8;font-size:15px;line-height:1.5}
  .code{
    font:800 76px/1 ui-monospace,monospace;letter-spacing:18px;
    color:#60A5FA;margin:14px 0 10px;padding-left:18px;
    white-space:nowrap;
  }
  .steps{
    margin-top:10px;text-align:left;display:inline-block;
    background:#111A2E;border:1px solid #22304C;border-radius:12px;padding:12px 22px;
  }
  .steps li{color:#CBD5E1;font-size:14px;margin:3px 0;line-height:1.45}

  .msg{text-align:center;color:#94A3B8;font-size:18px}

  footer{
    display:flex;align-items:center;gap:14px;
    padding:8px 18px;border-top:1px solid #22304C;background:#111A2E;font-size:13px;
  }
  .dot{width:8px;height:8px;border-radius:50%;background:#64748B}
  .dot.ok{background:#10B981}
  .dot.bad{background:#DC2626}
  .status{color:#94A3B8}
  .time{margin-left:auto;color:#64748B;font:500 13px ui-monospace,monospace}
</style>

<header>
  <span class="mark">
    <svg width="15" height="15" viewBox="0 0 32 32" fill="#fff" aria-hidden="true">
      <path d="M13.4 25.4C7.4 24.8 3.6 19.6 4.6 14.0C5.8 7.6 12.4 3.9 19.0 6.1C21.2 6.9 23.1 8.2 24.4 9.9L20.1 13.5C19.3 12.5 18.2 11.7 17.0 11.3C13.4 10.1 10.1 12.2 9.6 15.3C9.1 18.0 11.0 20.6 14.0 21.1Z"/>
      <path d="M23.2 8.6L29.0 5.8L27.2 11.0L29.2 14.8L20.6 13.4Z"/>
    </svg>
  </span>
  <span class="brand">Shrimp365</span>
  <span class="serial" id="serial"></span>
</header>

<main id="main"><div class="msg">시작하는 중…</div></main>

<footer>
  <span class="dot" id="dot"></span>
  <span class="status" id="status">연결 확인 중</span>
  <span class="time" id="time"></span>
</footer>

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

function renderValues(d){
  var cells = ORDER.map(function(key){
    var r = RANGES[key];
    var has = d.values && typeof d.values[key] === "number";
    var v = has ? d.values[key].toFixed(r.digits) : "--";
    var cls = has ? level(key, d.values[key]) : "";
    return '<div class="cell ' + cls + '"><div class="k">' + r.label + '</div>' +
           '<div class="v">' + v + (r.unit ? '<small>' + r.unit + '</small>' : '') + '</div></div>';
  }).join("");
  return '<div class="grid">' + cells + '</div>';
}

function renderPairing(d){
  var code = String(d.pair_code || "");
  return '<div class="pair">' +
    '<h1>기기를 연결해 주세요</h1>' +
    '<p>Shrimp365에 로그인한 뒤 아래 코드를 입력하세요</p>' +
    '<div class="code">' + esc(code) + '</div>' +
    '<div class="steps"><ol>' +
      '<li>휴대폰이나 이 화면에서 <b>' + esc(d.pair_url || "www.shrimp365.kr") + '</b> 접속</li>' +
      '<li>로그인 → 양식장·수조 관리</li>' +
      '<li>수조의 <b>센서 기기</b> → <b>코드로 기기 연결</b></li>' +
      '<li>위 6자리 코드 입력</li>' +
    '</ol></div></div>';
}

function render(d){
  document.getElementById("serial").textContent = d.serial || "";

  var main = document.getElementById("main");
  if (d.mode === "pairing" && d.pair_code) main.innerHTML = renderPairing(d);
  else if (d.mode === "running")           main.innerHTML = renderValues(d);
  else main.innerHTML = '<div class="msg">' + esc(d.status || "시작하는 중…") + '</div>';

  var dot = document.getElementById("dot");
  var st  = d.status || "";
  dot.className = "dot" + (/FAIL|ERROR|실패|오류/i.test(st) ? " bad" : (d.mode === "running" ? " ok" : ""));
  document.getElementById("status").textContent = st || (d.mode === "pairing" ? "연결 대기 중" : "");
  document.getElementById("time").textContent = d.updated_at || "";
}

function tick(){
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


def serve(state: State, port: int = 8080) -> ThreadingHTTPServer | None:
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
            elif self.path in ("/", "/index.html"):
                self._send(200, PAGE.encode(), "text/html; charset=utf-8")
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
