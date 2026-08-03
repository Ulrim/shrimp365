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
  <button class="act" id="action" type="button"></button>
</footer>

<div id="overlay"></div>

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
    return '<div class="cell ' + cls + '"><div class="k">' + r.label + '</div>' +
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

function render(d){
  document.getElementById("link").innerHTML = renderLink(d);
  document.getElementById("main").innerHTML = renderValues(d);
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


def serve(
    state: State,
    port: int = 8080,
    on_pair_start=None,
    on_pair_cancel=None,
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
            elif self.path in ("/", "/index.html"):
                self._send(200, PAGE.encode(), "text/html; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self) -> None:
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
