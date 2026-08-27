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
            "version": "",         # 지금 도는 프로그램 버전. 원격 업데이트로 바뀌면
                                   # 화면이 스스로 새로고침해 새 UI 를 띄운다.
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

            "ec_unit": "us",       # 전도도 표시 단위(us|ms). 화면이 값을 바꿔 보여 준다.
            "nutrient": None,      # 양액 보충 안내(켜 둔 경우에만)
        }

    def update(self, **kwargs) -> None:
        with self._lock:
            self._data.update(kwargs)

    def snapshot(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._data))


PAGE = """<!doctype html>
<html lang="__LANG__">
<meta charset="utf-8">
<meta name="viewport" content="width=800,initial-scale=1">
<title>Shrimp365</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden}
  body{
    background:#0B1120;color:#E8EDF7;
    font:500 16px/1.4 system-ui,-apple-system,"Noto Sans CJK KR","Noto Sans KR","Nanum Gothic",sans-serif;
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
  .ver{font-size:11px;color:#64748B;font-weight:600;flex:0 0 auto}
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

  main{flex:1;display:flex;flex-direction:column;justify-content:center;padding:10px 16px;min-height:0}

  /* 측정값 — 2×2 */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;width:100%;flex:1;min-height:0}
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

  /* 값 칸 아래 보조 줄 (전도도 → 양액 계산에 쓴 EC) */
  .sub2{margin-top:5px;font-size:13px;color:#94A3B8;font-weight:600}
  .sub2 b{color:#E8EDF7;font-family:ui-monospace,monospace;font-weight:800}
  .sub2 .dim{color:#64748B;font-weight:500;font-size:12px}
  .sub2.bad{color:#F87171}
  .sub2.bad .dim{color:#94A3B8;display:block;margin-top:2px}

  /* 양액 안내 띠 — 계기판 아래 한 줄 */
  .nut{
    flex:0 0 auto;margin-top:9px;padding:9px 14px;border-radius:12px;
    display:flex;align-items:center;gap:12px;
    background:#111A2E;border:1px solid #22304C;
  }
  .nut.low{border-color:#1E40AF;background:#1E40AF18}
  .nut.high{border-color:#D97706;background:#D9770618}
  .nut.ok{border-color:#10B981;background:#10B98112}
  .nut .head{font-size:14px;font-weight:800;flex:0 0 auto}
  .nut .dose{font:800 26px/1 ui-monospace,monospace;letter-spacing:-.01em}
  .nut .dose small{font-size:13px;font-weight:600;color:#94A3B8;margin-left:3px}
  .nut .meta{margin-left:auto;font-size:12px;color:#94A3B8;text-align:right;line-height:1.5}

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

  /* Wi‑Fi 화면 — 설정 화면과 같은 틀을 쓴다 */
  .wrow{
    display:flex;align-items:center;gap:11px;
    padding:11px 13px;margin-bottom:6px;cursor:pointer;
    background:#111A2E;border:1px solid #22304C;border-radius:11px;
  }
  .wrow:active{background:#16223C}
  .wrow.cur{border-color:#10B981;background:#10B98112}
  .wname{font-size:15px;font-weight:700;flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .wlock{font-size:12px;color:#64748B;flex:0 0 auto}
  /* 신호 막대 4칸 */
  .bars{display:flex;align-items:flex-end;gap:2px;height:18px;flex:0 0 auto}
  .bars i{width:4px;background:#334155;border-radius:1px}
  .bars i.on{background:#60A5FA}
  .bars i:nth-child(1){height:6px}
  .bars i:nth-child(2){height:10px}
  .bars i:nth-child(3){height:14px}
  .bars i:nth-child(4){height:18px}
  .wcur{
    font-size:13px;color:#94A3B8;line-height:1.6;
    background:#111A2E;border:1px solid #22304C;border-radius:11px;
    padding:9px 13px;margin-bottom:8px;
  }
  .wcur b{color:#E8EDF7;font-weight:700}
  /* 비밀번호 입력 + 화면 키보드 */
  .pwbox{margin-bottom:8px}
  .pwf{
    display:flex;align-items:center;gap:8px;
    background:#0B1120;border:1px solid #2B3A57;border-radius:10px;padding:4px 6px 4px 12px;
  }
  .pwf input{
    flex:1;min-width:0;background:transparent;border:0;outline:0;color:#E8EDF7;
    font:600 18px/1 ui-monospace,monospace;letter-spacing:2px;padding:10px 0;
  }
  .pwf .eye{
    font:600 12px/1 inherit;padding:9px 11px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;flex:0 0 auto;
  }
  .kbd{margin-top:8px;display:flex;flex-direction:column;gap:5px}
  .krow{display:flex;gap:5px;justify-content:center}
  .kbd button{
    flex:1 1 0;min-width:0;height:44px;
    font:700 16px/1 inherit;color:#E8EDF7;
    background:#16223C;border:1px solid #22304C;border-radius:8px;cursor:pointer;
  }
  .kbd button:active{background:#1E40AF}
  .kbd button.wide{flex:1.6 1 0}
  .kbd button.go{flex:2 1 0;background:#1E40AF;border-color:#1E40AF;color:#fff}
  .kbd button.k-shift.on{background:#334155;border-color:#475569}

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
  /* 푸터 버튼은 오른쪽에 한 덩어리로 모은다. 첫 버튼(설정)만 밀어 두고
     나머지는 붙여, 설정이 [연결 정보]/[기기 연결] 바로 옆에 오게 한다. */
  footer #action{margin-left:0}

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
  <span class="ver" id="ver"></span>
  <span class="link" id="link"></span>
</header>

<main id="main"></main>

<footer>
  <span class="dot" id="dot"></span>
  <span class="status" id="status">…</span>
  <span class="time" id="time"></span>
  <button class="act ghost" id="settings" type="button" onclick="openSettings()">설정</button>
  <button class="act" id="action" type="button"></button>
</footer>

<div id="overlay"></div>
<div id="chart"></div>
<div id="setup"></div>
<div id="wifi"></div>
<div id="account"></div>

<script>
// 흰다리새우 적정 범위. 화면에서 바로 이상을 알아보기 위한 것으로,
// 실제 알림 판정은 서버가 한다.
var RANGES = {
  temperature: {label:"수온", unit:"\\u00B0C", digits:1, ok:[28,32],  warn:[26,34]},
  ph:          {label:"pH",   unit:"",         digits:2, ok:[7.5,8.5], warn:[7,9]},
  do_level:    {label:"용존산소", unit:"ppm",  digits:2, ok:[5,20],   warn:[4,20]},
  // 흰다리새우 해수 양식 기준.
  salinity:    {label:"염도", unit:"\u2030",  digits:1, ok:[15,35],   warn:[10,40]},
  // 전도도는 쓰는 곳마다 적정값이 달라(해수 약 50,000 uS/cm, 양액 1~3 mS/cm)
  // 좋고 나쁨을 코드가 정하지 않는다. 값만 그대로 보여 준다.
  conductivity:{label:"전도도", unit:"uS/cm", digits:0, ok:null, warn:null}
};
// 네 번째 칸은 EC 센서 설정을 따라간다. 염도 환산을 쓰면 염도가,
// 전도도 모드면 전도도가 올라오므로 값이 있는 쪽을 보여 준다.
function orderFor(d){
  var v = (d && d.values) || {};
  var fourth = (typeof v.salinity === "number") ? "salinity"
             : (typeof v.conductivity === "number") ? "conductivity"
             : "salinity";
  return ["temperature","ph","do_level",fourth];
}

// 양액(수경재배)에서는 적정 범위가 새우와 전혀 다르다. 새우 기준을 그대로
// 쓰면 정상값(수온 24℃, pH 6.2)이 온통 빨갛게 떠 경고가 무의미해진다.
// 양액 관리를 켠 장비에서는 이 기준으로 바꿔 본다.
var NUT_RANGES = {
  temperature: {ok:[18,26], warn:[15,30]},
  ph:          {ok:[5.5,6.5], warn:[5.0,7.0]}
};
var nutMode = false;   // 계기판이 매번 갱신할 때 함께 정한다

function level(key, v){
  var r = (nutMode && NUT_RANGES[key]) ? NUT_RANGES[key] : RANGES[key];
  if(!r || !r.ok) return "";
  if(v >= r.ok[0] && v <= r.ok[1]) return "";
  if(v >= r.warn[0] && v <= r.warn[1]) return "warn";
  return "crit";
}

function esc(s){ return String(s).replace(/[&<>]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }

// ── 화면 언어 ────────────────────────────────────────────────────────────────
// 웹페이지와 같은 4종(ko/en/vi/id). 서버가 첫 언어를 __LANG__ 자리에 새겨 준다.
// [설정] → [언어 설정] 에서 바꾸면 즉시 다시 그리고 서버에도 남긴다.
var LANG = "__LANG__";
if (!/^(ko|en|vi|id)$/.test(LANG)) LANG = "ko";

// 언어 이름은 어느 언어에서 보든 그 언어 그대로 적는다(현지 표기).
var LANG_NAMES = {ko:"한국어", en:"English", vi:"Tiếng Việt", id:"Bahasa Indonesia"};
var LANG_ORDER = ["ko","en","vi","id"];

var I18N = {
  // 측정 항목
  m_temperature:{ko:"수온",en:"Temperature",vi:"Nhiệt độ",id:"Suhu"},
  m_do:{ko:"용존산소",en:"Dissolved O₂",vi:"Oxy hòa tan",id:"Oksigen"},
  m_salinity:{ko:"염도",en:"Salinity",vi:"Độ mặn",id:"Salinitas"},
  graph:{ko:"그래프",en:"Graph",vi:"Biểu đồ",id:"Grafik"},
  // 공통
  close:{ko:"닫기",en:"Close",vi:"Đóng",id:"Tutup"},
  cancel:{ko:"취소",en:"Cancel",vi:"Hủy",id:"Batal"},
  retry:{ko:"다시 시도",en:"Retry",vi:"Thử lại",id:"Coba lagi"},
  back_list:{ko:"‹ 목록",en:"‹ List",vi:"‹ Danh sách",id:"‹ Daftar"},
  back_menu:{ko:"‹ 설정",en:"‹ Settings",vi:"‹ Cài đặt",id:"‹ Pengaturan"},
  // 푸터 · 연결 상태
  settings:{ko:"설정",en:"Settings",vi:"Cài đặt",id:"Pengaturan"},
  info:{ko:"연결 정보",en:"Account",vi:"Thông tin",id:"Info"},
  link_device:{ko:"기기 연결",en:"Link device",vi:"Kết nối",id:"Hubungkan"},
  connected:{ko:"연결됨",en:"Connected",vi:"Đã kết nối",id:"Terhubung"},
  not_connected:{ko:"미연결",en:"Not linked",vi:"Chưa kết nối",id:"Belum"},
  not_linked_msg:{ko:"이 장비는 계정에 연결되지 않았습니다",en:"This device is not linked to an account",vi:"Thiết bị chưa liên kết với tài khoản",id:"Perangkat belum ditautkan ke akun"},
  held:{ko:"보관 {n}건",en:"{n} held",vi:"Đã lưu {n}",id:"{n} tersimpan"},
  starting:{ko:"시작하는 중…",en:"Starting…",vi:"Đang khởi động…",id:"Memulai…"},
  no_collector:{ko:"수집기 응답 없음",en:"No response from collector",vi:"Bộ thu không phản hồi",id:"Kolektor tak merespons"},
  // 그래프
  r_6h:{ko:"6시간",en:"6 h",vi:"6 giờ",id:"6 jam"},
  r_12h:{ko:"12시간",en:"12 h",vi:"12 giờ",id:"12 jam"},
  r_24h:{ko:"24시간",en:"24 h",vi:"24 giờ",id:"24 jam"},
  r_week:{ko:"일주일",en:"1 week",vi:"1 tuần",id:"1 minggu"},
  stat_min:{ko:"최저",en:"Min",vi:"Thấp",id:"Min"},
  stat_avg:{ko:"평균",en:"Avg",vi:"TB",id:"Rata"},
  stat_max:{ko:"최고",en:"Max",vi:"Cao",id:"Maks"},
  no_data:{ko:"이 구간에 기록된 값이 없습니다",en:"No data recorded for this range",vi:"Không có dữ liệu trong khoảng này",id:"Tidak ada data pada rentang ini"},
  // 페어링
  pair_fail_title:{ko:"연결 코드를 받지 못했습니다",en:"Couldn't get a pairing code",vi:"Không lấy được mã kết nối",id:"Gagal mendapatkan kode"},
  pair_getting:{ko:"연결 코드를 받는 중…",en:"Getting a pairing code…",vi:"Đang lấy mã kết nối…",id:"Mengambil kode…"},
  pair_title:{ko:"기기를 연결해 주세요",en:"Link this device",vi:"Vui lòng kết nối thiết bị",id:"Hubungkan perangkat ini"},
  pair_desc:{ko:"Shrimp365에 로그인한 뒤 아래 코드를 입력하세요<br>연결 전 측정값도 저장해 두었다가 함께 올립니다",en:"Log in to Shrimp365 and enter the code below<br>Readings taken before linking are stored and uploaded too",vi:"Đăng nhập Shrimp365 và nhập mã bên dưới<br>Số liệu trước khi kết nối cũng được lưu và tải lên cùng",id:"Masuk ke Shrimp365 lalu masukkan kode di bawah<br>Data sebelum ditautkan disimpan dan diunggah bersama"},
  pair_step1:{ko:"휴대폰이나 이 화면에서 <b>{url}</b> 접속",en:"Open <b>{url}</b> on your phone or this screen",vi:"Mở <b>{url}</b> trên điện thoại hoặc màn hình này",id:"Buka <b>{url}</b> di ponsel atau layar ini"},
  pair_step2:{ko:"로그인 → 양식장·수조 관리",en:"Log in → Farm & tank management",vi:"Đăng nhập → Quản lý trại & bể",id:"Masuk → Kelola tambak & kolam"},
  pair_step3:{ko:"수조의 <b>센서 기기</b> → <b>코드로 기기 연결</b>",en:"Tank's <b>Sensor devices</b> → <b>Link by code</b>",vi:"<b>Thiết bị cảm biến</b> của bể → <b>Kết nối bằng mã</b>",id:"<b>Perangkat sensor</b> kolam → <b>Hubungkan via kode</b>"},
  pair_step4:{ko:"위 6자리 코드 입력",en:"Enter the 6-digit code above",vi:"Nhập mã 6 số ở trên",id:"Masukkan kode 6 digit di atas"},
  // 계정
  acct_title:{ko:"연결된 계정",en:"Linked account",vi:"Tài khoản đã kết nối",id:"Akun tertaut"},
  acct_change:{ko:"계정 변경",en:"Change account",vi:"Đổi tài khoản",id:"Ganti akun"},
  acct_confirm:{ko:"지금 계정 연결을 끊고 <b>다른 계정에 새로 연결</b>합니다.<br>측정은 계속되고, 못 올린 값은 보관했다가 새 계정에 함께 올립니다.",en:"This unlinks the current account and <b>links a new one</b>.<br>Measuring continues; pending readings are kept and uploaded to the new account.",vi:"Ngắt tài khoản hiện tại và <b>kết nối tài khoản mới</b>.<br>Việc đo vẫn tiếp tục; số liệu chưa tải được giữ và tải lên tài khoản mới.",id:"Memutus akun saat ini dan <b>menautkan akun baru</b>.<br>Pengukuran berlanjut; data tertunda disimpan dan diunggah ke akun baru."},
  acct_confirm_yes:{ko:"네, 계정 변경",en:"Yes, change",vi:"Vâng, đổi",id:"Ya, ganti"},
  // 설정 메뉴
  menu_sensors:{ko:"센서 설정",en:"Sensor settings",vi:"Cài đặt cảm biến",id:"Pengaturan sensor"},
  menu_wifi:{ko:"Wi‑Fi 설정",en:"Wi‑Fi settings",vi:"Cài đặt Wi‑Fi",id:"Pengaturan Wi‑Fi"},
  menu_lang:{ko:"언어 설정",en:"Language",vi:"Ngôn ngữ",id:"Bahasa"},
  menu_sensors_sub:{ko:"센서 켜기·끄기, 슬레이브 ID, 측정 주기",en:"Sensors on/off, slave IDs, interval",vi:"Bật/tắt cảm biến, ID, chu kỳ đo",id:"Sensor on/off, ID, interval"},
  menu_wifi_sub:{ko:"공유기에 붙이기",en:"Connect to a router",vi:"Kết nối router",id:"Sambungkan ke router"},
  menu_lang_sub:{ko:"화면 언어 고르기",en:"Choose display language",vi:"Chọn ngôn ngữ hiển thị",id:"Pilih bahasa tampilan"},
  // 센서 설정
  version:{ko:"버전",en:"Version",vi:"Phiên bản",id:"Versi"},
  checking:{ko:"확인 중",en:"checking",vi:"đang kiểm tra",id:"memeriksa"},
  in_use:{ko:"사용 중",en:"In use",vi:"Đang dùng",id:"Dipakai"},
  not_used:{ko:"사용 안 함",en:"Not used",vi:"Không dùng",id:"Tidak dipakai"},
  on:{ko:"켬",en:"On",vi:"Bật",id:"Nyala"},
  off:{ko:"끔",en:"Off",vi:"Tắt",id:"Mati"},
  slave_hint:{ko:"센서마다 슬레이브 ID 가 달라야 합니다",en:"Each sensor needs a unique slave ID",vi:"Mỗi cảm biến cần ID riêng",id:"Setiap sensor perlu ID unik"},
  interval:{ko:"측정 주기",en:"Interval",vi:"Chu kỳ đo",id:"Interval"},
  interval_sub:{ko:"초 · 60보다 짧게는 권하지 않습니다",en:"seconds · 60 or more recommended",vi:"giây · nên từ 60 trở lên",id:"detik · disarankan ≥ 60"},
  auto_assign:{ko:"자동 배치",en:"Auto-assign",vi:"Tự sắp xếp",id:"Atur otomatis"},
  scan_bus:{ko:"선 훑기",en:"Scan bus",vi:"Quét đường",id:"Pindai bus"},
  save:{ko:"저장",en:"Save",vi:"Lưu",id:"Simpan"},
  scanning:{ko:"훑는 중… 최대 30초 걸립니다.",en:"Scanning… up to 30s.",vi:"Đang quét… tối đa 30 giây.",id:"Memindai… hingga 30 dtk."},
  scan_fail:{ko:"훑지 못했습니다.",en:"Couldn't scan.",vi:"Không quét được.",id:"Gagal memindai."},
  finding:{ko:"센서를 찾는 중… 최대 30초 걸립니다.",en:"Detecting sensors… up to 30s.",vi:"Đang tìm cảm biến… tối đa 30 giây.",id:"Mendeteksi sensor… hingga 30 dtk."},
  none_responding:{ko:"응답하는 센서가 없습니다. 전원과 A/B 배선을 확인하세요.",en:"No sensors responding. Check power and A/B wiring.",vi:"Không có cảm biến phản hồi. Kiểm tra nguồn và dây A/B.",id:"Tak ada sensor merespons. Periksa daya dan kabel A/B."},
  found_on_bus:{ko:"선에서 찾은 센서",en:"Sensors found on the bus",vi:"Cảm biến tìm thấy trên đường",id:"Sensor ditemukan pada bus"},
  find_fail:{ko:"찾지 못했습니다.",en:"Couldn't detect.",vi:"Không tìm được.",id:"Gagal mendeteksi."},
  conflict_resp:{ko:"{name} 가 {ids} 번에서 응답",en:"{name} responds at {ids}",vi:"{name} phản hồi tại {ids}",id:"{name} merespons di {ids}"},
  conflict_pick:{ko:"{list} — 어느 쪽을 쓸지 직접 골라 주세요.",en:"{list} — please choose which to use.",vi:"{list} — vui lòng chọn dùng cái nào.",id:"{list} — silakan pilih yang dipakai."},
  auto_done:{ko:"{done} — 확인하고 [저장] 을 누르세요.",en:"{done} — review and tap [Save].",vi:"{done} — kiểm tra rồi nhấn [Lưu].",id:"{done} — periksa lalu tekan [Simpan]."},
  auto_done_missing:{ko:"{done} · 못 찾음: {missing} — 확인하고 [저장] 을 누르세요.",en:"{done} · not found: {missing} — review and tap [Save].",vi:"{done} · không thấy: {missing} — kiểm tra rồi nhấn [Lưu].",id:"{done} · tak ada: {missing} — periksa lalu tekan [Simpan]."},
  saved_ok:{ko:"저장했습니다. 다음 측정부터 적용됩니다.",en:"Saved. Applies from the next reading.",vi:"Đã lưu. Áp dụng từ lần đo tới.",id:"Tersimpan. Berlaku mulai pengukuran berikutnya."},
  saved_mem:{ko:"적용했지만 파일에 저장하지 못했습니다(재부팅하면 되돌아갑니다).",en:"Applied but couldn't save to file (reverts on reboot).",vi:"Đã áp dụng nhưng không lưu được (mất khi khởi động lại).",id:"Diterapkan tapi gagal disimpan (kembali saat reboot)."},
  save_fail:{ko:"저장하지 못했습니다.",en:"Couldn't save.",vi:"Không lưu được.",id:"Gagal menyimpan."},
  load_fail:{ko:"설정을 불러오지 못했습니다.",en:"Couldn't load settings.",vi:"Không tải được cài đặt.",id:"Gagal memuat pengaturan."},
  n_do:{ko:"용존산소",en:"Dissolved O₂",vi:"Oxy hòa tan",id:"Oksigen"},
  n_ec:{ko:"전도도 / 염도",en:"Conductivity / Salinity",vi:"Độ dẫn / Độ mặn",id:"Konduktivitas / Salinitas"},
  n_ec_only:{ko:"전도도",en:"Conductivity",vi:"Độ dẫn",id:"Konduktivitas"},
  sen_noreply:{ko:"센서 응답 없음",en:"No sensor response",vi:"Cảm biến không phản hồi",id:"Sensor tak merespons"},
  sen_check:{ko:"설정 → 센서 설정 → 선 훑기",en:"Settings → Sensors → Scan bus",vi:"Cài đặt → Cảm biến → Quét",id:"Pengaturan → Sensor → Pindai"},
  sen_probe:{ko:"전극 확인 필요",en:"Check the probe",vi:"Kiểm tra đầu dò",id:"Periksa probe"},
  sen_probe_sub:{ko:"센서는 응답하지만 값을 내지 못합니다 — 전극 연결·상태를 확인하세요",en:"The sensor replies but reports no value — check the probe connection",vi:"Cảm biến phản hồi nhưng không có giá trị — kiểm tra kết nối đầu dò",id:"Sensor merespons tetapi tanpa nilai — periksa sambungan probe"},
  sen_range:{ko:"값이 범위를 벗어남",en:"Value out of range",vi:"Giá trị ngoài khoảng",id:"Nilai di luar rentang"},
  sen_supersat:{ko:"물에서 나올 수 없는 값",en:"Impossible for water",vi:"Không thể có trong nước",id:"Mustahil untuk air"},
  sen_supersat_sub:{ko:"포화도 {{p}}% — 전극이 물에 잠겼는지, 보정이 되어 있는지 확인하세요",en:"{{p}}% saturation — check the probe is submerged and calibrated",vi:"Bão hòa {{p}}% — kiểm tra đầu dò đã ngập nước và đã hiệu chuẩn",id:"Saturasi {{p}}% — pastikan probe terendam dan terkalibrasi"},
  // 양액
  menu_nutrient:{ko:"양액 설정",en:"Nutrient solution",vi:"Dung dịch dinh dưỡng",id:"Larutan nutrisi"},
  menu_nutrient_sub:{ko:"EC 로 농도 보고 보충량 계산",en:"Dosing from EC readings",vi:"Tính lượng bổ sung theo EC",id:"Hitung dosis dari EC"},
  nut_use:{ko:"양액 관리 사용",en:"Use nutrient management",vi:"Dùng quản lý dinh dưỡng",id:"Pakai manajemen nutrisi"},
  nut_use_sub:{ko:"켜면 계기판에 보충량이 뜹니다",en:"Shows dosing on the dashboard",vi:"Hiện lượng bổ sung trên bảng đo",id:"Menampilkan dosis di dasbor"},
  nut_target:{ko:"목표 EC",en:"Target EC",vi:"EC mục tiêu",id:"EC target"},
  nut_source:{ko:"원수 EC",en:"Source water EC",vi:"EC nước nguồn",id:"EC air baku"},
  nut_tank:{ko:"탱크 용량",en:"Tank volume",vi:"Dung tích bể",id:"Volume tangki"},
  nut_cal_ml:{ko:"교정 투입량",en:"Calibration dose",vi:"Lượng hiệu chuẩn",id:"Dosis kalibrasi"},
  nut_cal_l:{ko:"교정 기준수량",en:"Calibration volume",vi:"Thể tích hiệu chuẩn",id:"Volume kalibrasi"},
  nut_cal_rise:{ko:"교정 EC 상승폭",en:"Calibration EC rise",vi:"Mức tăng EC hiệu chuẩn",id:"Kenaikan EC kalibrasi"},
  nut_a_ratio:{ko:"A액 비율",en:"A-solution ratio",vi:"Tỉ lệ dung dịch A",id:"Rasio larutan A"},
  nut_atc:{ko:"수온 보정(25℃)",en:"Temp. compensation (25℃)",vi:"Bù nhiệt (25℃)",id:"Kompensasi suhu (25℃)"},
  nut_atc_sub:{ko:"센서가 스스로 보정하면 끄세요",en:"Turn off if the sensor already compensates",vi:"Tắt nếu cảm biến đã tự bù",id:"Matikan bila sensor sudah mengompensasi"},
  nut_cal_hint:{ko:"교정값은 실제 원액·원수로 재서 넣어야 보충량이 맞습니다. 시험 수조에 원수를 담고 원액을 정량 투입해 오른 EC 를 재세요.",en:"Calibration must be measured with your own stock solution and source water, or the dose will be off. Dose a test tank and measure the EC rise.",vi:"Phải hiệu chuẩn bằng dung dịch và nước thực tế, nếu không lượng bổ sung sẽ sai. Đo mức tăng EC trong bể thử.",id:"Kalibrasi harus diukur dengan larutan dan air Anda sendiri, jika tidak dosis akan meleset. Ukur kenaikan EC di tangki uji."},
  nut_ec_note:{ko:"EC 는 전체 이온의 대리지표라 N·P·K 개별 농도를 뜻하지 않습니다.",en:"EC is a proxy for total ions — it does not give individual N/P/K levels.",vi:"EC chỉ là chỉ số tổng ion — không cho biết N/P/K riêng lẻ.",id:"EC hanya proksi total ion — bukan kadar N/P/K masing-masing."},
  nut_saved:{ko:"저장했습니다.",en:"Saved.",vi:"Đã lưu.",id:"Tersimpan."},
  // 계기판 안내
  nut_low:{ko:"양액 보충",en:"Add nutrient",vi:"Bổ sung dinh dưỡng",id:"Tambah nutrisi"},
  nut_high:{ko:"농도 높음 — 원수 교환",en:"Too strong — exchange with source water",vi:"Quá đậm — thay bằng nước nguồn",id:"Terlalu pekat — tukar air baku"},
  nut_ok:{ko:"양액 농도 적정",en:"Nutrient level OK",vi:"Nồng độ đạt",id:"Konsentrasi pas"},
  nut_conc:{ko:"농도",en:"Conc.",vi:"Nồng độ",id:"Konsentrasi"},
  nut_ec_calc:{ko:"양액 EC",en:"Nutrient EC",vi:"EC dinh dưỡng",id:"EC nutrisi"},
  nut_ec_atc:{ko:"25℃ 환산",en:"at 25℃",vi:"quy về 25℃",id:"pada 25℃"},
  nut_need_cal:{ko:"교정값을 확인하세요",en:"Check calibration values",vi:"Kiểm tra giá trị hiệu chuẩn",id:"Periksa nilai kalibrasi"},
  nut_bad_cfg:{ko:"목표 EC 가 원수 EC 보다 커야 합니다",en:"Target EC must exceed source EC",vi:"EC mục tiêu phải lớn hơn EC nguồn",id:"EC target harus melebihi EC baku"},
  ec_measure:{ko:"EC 센서 측정 항목",en:"EC sensor measures",vi:"Cảm biến EC đo",id:"Sensor EC mengukur"},
  ec_measure_sub:{ko:"이 센서로 무엇을 잴지 고릅니다",en:"Choose what this sensor reports",vi:"Chọn giá trị cảm biến báo về",id:"Pilih nilai yang dilaporkan"},
  ec_salinity:{ko:"염도",en:"Salinity",vi:"Độ mặn",id:"Salinitas"},
  ec_conductivity:{ko:"전도도",en:"Conductivity",vi:"Độ dẫn",id:"Konduktivitas"},
  ec_unit_label:{ko:"전도도 단위",en:"Conductivity unit",vi:"Đơn vị độ dẫn",id:"Satuan konduktivitas"},
  ec_hint_sal:{ko:"전도도에서 염도(‰)로 환산해 기록합니다 — 해수 양식 기본",en:"Converts conductivity to salinity (‰) — default for seawater",vi:"Quy đổi độ dẫn sang độ mặn (‰) — mặc định nước biển",id:"Mengonversi ke salinitas (‰) — bawaan air laut"},
  ec_hint_ec:{ko:"환산 없이 전도도(EC)를 그대로 씁니다 — 양액·민물에 적합",en:"Uses conductivity (EC) as-is — for nutrient solution or fresh water",vi:"Dùng độ dẫn (EC) trực tiếp — cho dung dịch dinh dưỡng, nước ngọt",id:"Memakai konduktivitas (EC) langsung — untuk nutrisi atau air tawar"},
  // Wi‑Fi
  wifi_loading:{ko:"불러오는 중…",en:"Loading…",vi:"Đang tải…",id:"Memuat…"},
  wifi_now:{ko:"지금 연결됨 · <b>{ssid}</b>{ip}",en:"Connected · <b>{ssid}</b>{ip}",vi:"Đã kết nối · <b>{ssid}</b>{ip}",id:"Terhubung · <b>{ssid}</b>{ip}"},
  wifi_none_conn:{ko:"연결된 Wi‑Fi 가 없습니다.",en:"Not connected to Wi‑Fi.",vi:"Chưa kết nối Wi‑Fi.",id:"Belum terhubung Wi‑Fi."},
  wifi_locked:{ko:"잠금",en:"Locked",vi:"Khóa",id:"Terkunci"},
  wifi_rescan:{ko:"다시 검색",en:"Rescan",vi:"Quét lại",id:"Pindai ulang"},
  wifi_searching:{ko:"검색 중…",en:"Searching…",vi:"Đang tìm…",id:"Mencari…"},
  wifi_none_found:{ko:"주변에 잡히는 Wi‑Fi 가 없습니다.",en:"No Wi‑Fi networks nearby.",vi:"Không tìm thấy Wi‑Fi.",id:"Tak ada Wi‑Fi terdekat."},
  wifi_load_fail:{ko:"Wi‑Fi 정보를 불러오지 못했습니다.",en:"Couldn't load Wi‑Fi info.",vi:"Không tải được thông tin Wi‑Fi.",id:"Gagal memuat info Wi‑Fi."},
  wifi_pw_ph:{ko:"비밀번호 입력",en:"Enter password",vi:"Nhập mật khẩu",id:"Masukkan kata sandi"},
  wifi_show:{ko:"표시",en:"Show",vi:"Hiện",id:"Tampil"},
  wifi_hide:{ko:"숨김",en:"Hide",vi:"Ẩn",id:"Sembunyi"},
  wifi_space:{ko:"공백",en:"Space",vi:"Cách",id:"Spasi"},
  wifi_connect:{ko:"연결",en:"Connect",vi:"Kết nối",id:"Sambung"},
  wifi_connecting:{ko:"연결 중…",en:"Connecting…",vi:"Đang kết nối…",id:"Menyambung…"},
  wifi_connecting_to:{ko:"{ssid} 에 연결하는 중… 최대 30초",en:"Connecting to {ssid}… up to 30s",vi:"Đang kết nối {ssid}… tối đa 30 giây",id:"Menyambung ke {ssid}… hingga 30 dtk"},
  wifi_connected:{ko:"연결되었습니다.",en:"Connected.",vi:"Đã kết nối.",id:"Terhubung."},
  wifi_connect_fail:{ko:"연결하지 못했습니다.",en:"Couldn't connect.",vi:"Không kết nối được.",id:"Gagal menyambung."},
  // 언어 설정
  lang_title:{ko:"언어 설정",en:"Language",vi:"Ngôn ngữ",id:"Bahasa"},
  lang_hint:{ko:"화면 언어를 고르세요",en:"Choose the display language",vi:"Chọn ngôn ngữ hiển thị",id:"Pilih bahasa tampilan"},
  // 재시작
  menu_restart:{ko:"재시작",en:"Restart",vi:"Khởi động lại",id:"Mulai ulang"},
  menu_restart_sub:{ko:"프로그램 다시 시작 · 기기 재부팅",en:"Restart program · Reboot device",vi:"Khởi động lại chương trình · thiết bị",id:"Mulai ulang program · perangkat"},
  restart_app:{ko:"프로그램 다시 시작",en:"Restart program",vi:"Khởi động lại chương trình",id:"Mulai ulang program"},
  restart_app_sub:{ko:"측정 프로그램만 다시 켭니다 · 약 15초",en:"Restarts the measuring program only · about 15s",vi:"Chỉ khởi động lại chương trình đo · khoảng 15 giây",id:"Hanya program pengukuran · sekitar 15 detik"},
  reboot_dev:{ko:"기기 재부팅",en:"Reboot device",vi:"Khởi động lại thiết bị",id:"Mulai ulang perangkat"},
  reboot_dev_sub:{ko:"기기 전체를 다시 켭니다 · 약 1분",en:"Restarts the whole device · about 1 min",vi:"Khởi động lại toàn bộ thiết bị · khoảng 1 phút",id:"Mulai ulang seluruh perangkat · sekitar 1 menit"},
  restart_hint:{ko:"측정 기록과 연결 정보는 그대로 유지됩니다.",en:"Measurements and account link are kept.",vi:"Dữ liệu đo và kết nối tài khoản được giữ nguyên.",id:"Data pengukuran dan tautan akun tetap tersimpan."},
  restart_confirm:{ko:"정말 다시 시작할까요?",en:"Restart now?",vi:"Khởi động lại ngay?",id:"Mulai ulang sekarang?"},
  restart_yes:{ko:"네, 다시 시작",en:"Yes, restart",vi:"Vâng, khởi động lại",id:"Ya, mulai ulang"},
  restarting:{ko:"다시 시작하는 중… 잠시 뒤 화면이 돌아옵니다",en:"Restarting… the screen will return shortly",vi:"Đang khởi động lại… màn hình sẽ trở lại",id:"Memulai ulang… layar akan kembali"},
  rebooting:{ko:"재부팅하는 중… 약 1분 뒤 화면이 돌아옵니다",en:"Rebooting… the screen returns in about a minute",vi:"Đang khởi động lại… khoảng 1 phút",id:"Memulai ulang… sekitar 1 menit"},
  restart_fail:{ko:"다시 시작하지 못했습니다.",en:"Couldn't restart.",vi:"Không khởi động lại được.",id:"Gagal memulai ulang."}
};

function t(key, vars){
  var e = I18N[key];
  var s = (e && (e[LANG] || e.ko)) || key;
  if (vars) for (var k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

// 측정 항목 이름 — pH 는 어느 언어에서나 그대로.
function mlabel(key){
  if (key === "ph") return "pH";
  if (key === "temperature") return t("m_temperature");
  if (key === "do_level") return t("m_do");
  if (key === "salinity") return t("m_salinity");
  if (key === "conductivity") return t("n_ec_only");
  return key;
}

// 측정값은 언제나 이 화면이다. 연결 여부와 무관하다.
function renderValues(d){
  nutMode = !!d.nutrient;
  var cells = orderFor(d).map(function(key){
    var r = RANGES[key];
    var has = d.values && typeof d.values[key] === "number";
    // 전도도를 mS/cm 로 보기로 했으면 나눠서 보여 준다(보내는 값은 uS/cm 그대로).
    var ms = (key === "conductivity" && d.ec_unit === "ms");
    var raw = has ? (ms ? d.values[key] / 1000 : d.values[key]) : null;
    var v = has ? raw.toFixed(ms ? 2 : r.digits) : "--";
    var cls = has ? level(key, d.values[key]) : "none";
    // 따옴표 이스케이프를 피하려고 &quot; 를 쓴다. PAGE 가 파이썬 문자열이라
    // 백슬래시가 한 번 더 벗겨져 JS 가 깨지기 쉽다.
    return '<div class="cell ' + cls + '" onclick="openChart(&quot;' + key + '&quot;)">' +
           '<div class="k">' + mlabel(key) + ' <span class="tap">' + t("graph") + ' ›</span></div>' +
           '<div class="v">' + v + (r.unit ? '<small>' + (ms ? "mS/cm" : r.unit) + '</small>' : '') + '</div>' +
           subLine(key, d) + '</div>';
  }).join("");
  return '<div class="grid">' + cells + '</div>' + renderNutrient(d);
}

// 값 칸이 비었을 때 "어느 센서 탓인지" 를 짚어 준다. 화면에 -- 만 뜨면
// 사람이 원인을 알 길이 없어, 배선을 뜯기 전에 무엇부터 볼지 알려 준다.
function ownerSensor(key){
  if (key === "ph") return "ph";
  if (key === "do_level") return "do";
  if (key === "salinity" || key === "conductivity") return "ec";
  return null;   // 수온은 세 센서 중 아무거나 대므로 특정하지 않는다
}

// 값 칸 아래 보조 줄. 지금은 전도도 칸에만 쓴다 —
// 양액 계산은 25℃ 로 환산한 EC 로 하므로, 실제로 쓰인 값을 같이 보여 준다.
// (보정을 끄면 잰 값과 같지만, 어느 값으로 계산했는지 눈에 보이는 편이 낫다.)
function subLine(key, d){
  var has = d.values && typeof d.values[key] === "number";
  var who0 = ownerSensor(key);
  var why0 = who0 && d.errors ? d.errors[who0] : null;

  // 값이 나왔더라도 그 값이 말이 안 되면 그대로 믿게 두어서는 안 된다.
  // (예: 전극이 공기 중에 있으면 용존산소가 포화도 200% 넘게 나온다)
  if (has && why0 && String(why0).indexOf("supersat:") === 0) {
    var pct = String(why0).slice(9);
    return '<div class="sub2 bad">' + t("sen_supersat") +
           '<div class="dim">' + t("sen_supersat_sub").replace("{{p}}", esc(pct)) + '</div></div>';
  }

  // 값이 없는데 담당 센서가 오류를 냈으면 그 사실을 먼저 알린다.
  if (!has) {
    var who = who0;
    var why = why0;
    if (why) {
      // 원인마다 봐야 할 곳이 다르다. 응답이 아예 없으면 배선·ID,
      // 응답은 하는데 값이 없으면 전극이다. 둘을 뭉뚱그리면 헛수고를 시킨다.
      if (why === "probe") {
        return '<div class="sub2 bad">' + t("sen_probe") +
               '<div class="dim">' + t("sen_probe_sub") + '</div></div>';
      }
      if (String(why).indexOf("range:") === 0) {
        return '<div class="sub2 bad">' + t("sen_range") +
               '<div class="dim">' + esc(String(why).slice(6)) + '</div></div>';
      }
      return '<div class="sub2 bad">' + t("sen_noreply") +
             '<div class="dim">' + t("sen_check") + '</div></div>';
    }
    return "";
  }
  if (key !== "conductivity") return "";
  var n = d.nutrient;
  if (!n || typeof n.ec !== "number") return "";
  return '<div class="sub2">' + t("nut_ec_calc") + ' <b>' + n.ec + '</b> mS/cm' +
         (n.atc ? ' <span class="dim">' + t("nut_ec_atc") + '</span>' : '') + '</div>';
}

// 양액 안내 — 켜 두었을 때만. "지금 얼마를 넣어야 하는가" 를 한 줄로 답한다.
function renderNutrient(d){
  var n = d.nutrient;
  if (!n) return "";
  if (n.error === "target_lte_source") {
    return '<div class="nut high"><span class="head">' + t("nut_bad_cfg") + '</span></div>';
  }
  var meta = '<span class="meta">EC ' + n.ec + ' / ' + n.target + ' mS/cm<br>' +
             t("nut_conc") + ' ' + n.percent + '%</span>';
  if (n.verdict === "low") {
    if (n.error === "bad_calibration") {
      return '<div class="nut high"><span class="head">' + t("nut_need_cal") + '</span>' + meta + '</div>';
    }
    return '<div class="nut low">' +
      '<span class="head">' + t("nut_low") + '</span>' +
      '<span class="dose">A ' + n.dose_a + '<small>mL</small></span>' +
      '<span class="dose">B ' + n.dose_b + '<small>mL</small></span>' +
      meta + '</div>';
  }
  if (n.verdict === "high") {
    return '<div class="nut high">' +
      '<span class="head">' + t("nut_high") + '</span>' +
      '<span class="dose">' + (n.exchange_l !== undefined ? n.exchange_l : "--") + '<small>L</small></span>' +
      meta + '</div>';
  }
  return '<div class="nut ok"><span class="head">' + t("nut_ok") + '</span>' + meta + '</div>';
}

// 연결 상태 — 어느 계정·수조에 붙어 있는지
function renderLink(d){
  // 아직 못 올린 값이 있으면 몇 건인지 먼저 알린다.
  var hold = d.pending ? '<span class="chip hold">' + t("held", {n:d.pending}) + '</span>' : "";
  if (d.linked) {
    var where = [d.farm, d.tank].filter(Boolean).join(" · ");
    return (d.account ? '<span><b>' + esc(d.account) + '</b></span>' : "") +
           (where ? '<span>' + esc(where) + '</span>' : "") +
           hold + '<span class="chip on">' + t("connected") + '</span>';
  }
  return '<span>' + t("not_linked_msg") + '</span>' +
         hold + '<span class="chip off">' + t("not_connected") + '</span>';
}

function renderOverlay(d){
  if (!d.pairing) return "";
  if (d.pair_error) {
    return '<div class="overlay"><h1>' + t("pair_fail_title") + '</h1>' +
      '<p>' + esc(d.pair_error) + '</p>' +
      '<div class="ovbtns">' +
        '<button class="act" onclick="startPair()">' + t("retry") + '</button>' +
        '<button class="act ghost" onclick="cancelPair()">' + t("close") + '</button>' +
      '</div></div>';
  }
  if (!d.pair_code) {
    return '<div class="overlay"><h1>' + t("pair_getting") + '</h1>' +
      '<div class="ovbtns"><button class="act ghost" onclick="cancelPair()">' + t("cancel") + '</button></div></div>';
  }
  return '<div class="overlay">' +
    '<h1>' + t("pair_title") + '</h1>' +
    '<p>' + t("pair_desc") + '</p>' +
    '<div class="code">' + esc(d.pair_code) + '</div>' +
    '<div class="steps"><ol>' +
      '<li>' + t("pair_step1", {url: esc(d.pair_url || "www.shrimp365.kr")}) + '</li>' +
      '<li>' + t("pair_step2") + '</li>' +
      '<li>' + t("pair_step3") + '</li>' +
      '<li>' + t("pair_step4") + '</li>' +
    '</ol></div>' +
    '<div class="ovbtns"><button class="act ghost" onclick="cancelPair()">' + t("cancel") + '</button></div>' +
    '</div>';
}


// ── 그래프 ──────────────────────────────────────────────────────────────────
// 6시간·12시간·24시간·일주일. 파이가 자체 보관한 이력으로 그리므로
// 인터넷이 끊겨 있어도 볼 수 있다.
var RANGE_OPTIONS = [
  {hours:6,   k:"r_6h"},
  {hours:12,  k:"r_12h"},
  {hours:24,  k:"r_24h"},
  {hours:168, k:"r_week"}
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
      (o.hours === hours) + '">' + t(o.k) + '</button>';
  }).join("");

  var head =
    '<div class="chead">' +
      '<span class="ctitle">' + mlabel(key) + '</span>' +
      (d.count ? '<span class="cnow">' + d.points[d.points.length-1][1].toFixed(r.digits) +
                 (r.unit ? '<small style="font-size:13px;color:#94A3B8"> ' + r.unit + '</small>' : '') + '</span>' : '') +
      (d.count ? '<span class="cstats">' +
        '<span>' + t("stat_min") + ' <b>' + d.min.toFixed(r.digits) + '</b></span>' +
        '<span>' + t("stat_avg") + ' <b>' + d.avg.toFixed(r.digits) + '</b></span>' +
        '<span>' + t("stat_max") + ' <b>' + d.max.toFixed(r.digits) + '</b></span>' +
      '</span>' : '') +
    '</div>' +
    '<div class="ranges">' + buttons +
      '<button class="close" onclick="closeChart()">' + t("close") + '</button>' +
    '</div>';

  if (!d.count) {
    document.getElementById("chart").innerHTML =
      '<div class="chart">' + head +
      '<div class="nodata">' + t("no_data") + '</div></div>';
    return;
  }

  // 세로 범위 — 값이 화면을 채우되 적정 범위 경계도 보이게 잡는다.
  // 적정 범위를 통째로 포함시키면(예: DO 상한 20) 실제 곡선이 아래에
  // 눌려 붙어 변화를 읽을 수 없다. 그래서 데이터 폭의 25% 안에서만
  // 경계 쪽으로 넓힌다.
  var span = Math.max(d.max - d.min, Math.pow(10, -r.digits));
  var margin = span * 0.25;
  // 적정 범위가 없는 항목(염도)은 데이터 폭만 보고 잡는다.
  var lo = r.ok ? Math.min(d.min, Math.max(r.ok[0], d.min - margin)) : d.min - margin;
  var hi = r.ok ? Math.max(d.max, Math.min(r.ok[1], d.max + margin)) : d.max + margin;
  var pad = Math.max((hi - lo) * 0.08, Math.pow(10, -r.digits));
  lo -= pad; hi += pad;

  var t0 = d.points[0][0], t1 = Math.max(d.points[d.points.length-1][0], t0 + 1);
  var x = function(t){ return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
  var y = function(v){ return padT + (hi - v) / (hi - lo) * (H - padT - padB); };

  // 적정 범위 띠 — 범위를 정해 둔 항목에만 깐다.
  var band = "";
  if (r.ok) {
    var bandTop = y(Math.min(r.ok[1], hi)), bandBottom = y(Math.max(r.ok[0], lo));
    band = '<rect x="' + padL + '" y="' + bandTop + '" width="' + (W-padL-padR) +
           '" height="' + Math.max(0, bandBottom - bandTop) +
           '" fill="#10B981" opacity="0.10"/>';
  }

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

// 이 페이지가 처음 붙었을 때의 프로그램 버전. 원격 업데이트로 서비스가
// 재시작되면 새 버전이 내려오는데, 브라우저는 옛 페이지를 그대로 들고 있다.
// 버전이 바뀐 것을 감지하면 스스로 새로고침해 새 UI 를 띄운다.
var bootVersion = null;

var lastState = null;

function render(d){
  lastState = d;
  if (d.version) {
    if (bootVersion === null) bootVersion = d.version;
    else if (d.version !== bootVersion) { location.reload(); return; }
  }
  document.getElementById("link").innerHTML = renderLink(d);
  document.getElementById("ver").textContent = d.version ? "v" + d.version : "";
  // 그래프를 보고 있는 중에는 뒤 화면을 다시 그리지 않는다.
  // 3초마다 갱신하면 조작 중에 깜빡이고 눌림이 씹힌다.
  if (!chartKey) document.getElementById("main").innerHTML = renderValues(d);
  document.getElementById("overlay").innerHTML = renderOverlay(d);

  var st = d.status || "";
  var bad = /FAIL|ERROR|실패|오류/i.test(st);
  document.getElementById("dot").className = "dot" + (bad ? " bad" : (d.linked ? " ok" : ""));
  document.getElementById("status").textContent = st;
  document.getElementById("time").textContent = d.updated_at || "";

  document.getElementById("settings").textContent = t("settings");
  var btn = document.getElementById("action");
  btn.textContent = d.linked ? t("info") : t("link_device");
  btn.className = "act" + (d.linked ? " ghost" : "");
  btn.onclick = d.linked ? showInfo : startPair;
}

// 연결된 계정을 보여 주고, 화면에서 바로 다른 계정으로 옮길 수 있게 한다.
// (예전에는 SSH 로 설정 파일을 고쳐야 했다. 소비자는 명령을 쓰지 않는다.)
var infoOpen = false, infoConfirm = false;

function showInfo(){ infoOpen = true; infoConfirm = false; drawInfo(); }
function closeInfo(){ infoOpen = false; document.getElementById("account").innerHTML = ""; tick(); }
function askUnlink(){ infoConfirm = true; drawInfo(); }
function infoBack(){ infoConfirm = false; drawInfo(); }

function drawInfo(){
  if (!infoOpen) return;
  var d = lastState || {};
  var where = [d.farm, d.tank].filter(Boolean).join(" · ");
  var body;
  if (infoConfirm) {
    body =
      '<p>' + t("acct_confirm") + '</p>' +
      '<div class="ovbtns">' +
        '<button class="act" onclick="doUnlink()">' + t("acct_confirm_yes") + '</button>' +
        '<button class="act ghost" onclick="infoBack()">' + t("cancel") + '</button>' +
      '</div>';
  } else {
    body =
      (d.account ? '<p><b>' + esc(d.account) + '</b></p>' : '') +
      (where ? '<p>' + esc(where) + '</p>' : '') +
      '<div class="ovbtns">' +
        '<button class="act" onclick="askUnlink()">' + t("acct_change") + '</button>' +
        '<button class="act ghost" onclick="closeInfo()">' + t("close") + '</button>' +
      '</div>';
  }
  document.getElementById("account").innerHTML =
    '<div class="overlay"><h1>' + t("acct_title") + '</h1>' + body + '</div>';
}

function doUnlink(){
  fetch("/api/unlink", {method:"POST"})
    .then(function(){
      infoOpen = false;
      document.getElementById("account").innerHTML = "";
      tick();   // 서버가 새 연결 코드를 띄우면 다음 갱신 때 화면에 뜬다
    })
    .catch(function(){ infoConfirm = false; drawInfo(); });
}

function startPair(){ fetch("/api/pair/start", {method:"POST"}).then(tick); }
function cancelPair(){ fetch("/api/pair/cancel", {method:"POST"}).then(tick); }


// ── 설정 화면 ───────────────────────────────────────────────────────────────
// SSH 로 설정 파일을 고치던 것들을 화면에서 하게 한다. 현장에서는 수조 옆에
// 선 채로 고쳐야지, 노트북을 들고 와 접속할 일이 아니다.
var setupData = null, setupMsg = null;
var settingsOpen = false;   // 설정(메뉴·센서·언어) 화면이 떠 있는가

// [설정] 은 이제 메뉴다 — 센서·Wi‑Fi·언어로 들어간다.
function openSettings(){ settingsOpen = true; drawSettingsMenu(); }

function closeSettings(){
  settingsOpen = false;
  setupData = null;
  document.getElementById("setup").innerHTML = "";
  document.getElementById("wifi").innerHTML = "";
  tick();
}

function drawSettingsMenu(){
  document.getElementById("wifi").innerHTML = "";
  var items = [
    {t:"menu_sensors", sub:"menu_sensors_sub", fn:"openSensors()"},
    {t:"menu_wifi",    sub:"menu_wifi_sub",    fn:"openWifi()"},
    {t:"menu_lang",    sub:"menu_lang_sub",    fn:"openLang()"},
    {t:"menu_nutrient", sub:"menu_nutrient_sub", fn:"openNutrient()"},
    {t:"menu_restart", sub:"menu_restart_sub", fn:"openRestart()"}
  ];
  var rows = items.map(function(it){
    return '<div class="srow" style="cursor:pointer" onclick="' + it.fn + '">' +
      '<div class="sname">' + t(it.t) +
        '<div class="sub">' + t(it.sub) + '</div></div>' +
      '<span style="color:#64748B;font-size:20px;flex:0 0 auto">›</span>' +
    '</div>';
  }).join("");
  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("settings") + '</span>' +
        '<span class="cstats"><span>' + t("version") + ' ' + (bootVersion || t("checking")) + '</span></span>' +
        '<button onclick="closeSettings()">' + t("close") + '</button>' +
      '</div>' +
      '<div class="sbody">' + rows + '</div>' +
    '</div>';
}

function openSensors(){
  fetch("/api/sensors", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ setupData = d; setupMsg = null; drawSettings(); })
    .catch(function(){ alert(t("load_fail")); });
}

// ── 언어 설정 ────────────────────────────────────────────────────────────────
function openLang(){ drawLang(); }

function drawLang(){
  document.getElementById("wifi").innerHTML = "";
  var rows = LANG_ORDER.map(function(l){
    return '<div class="wrow' + (l === LANG ? " cur" : "") + '" onclick="setLang(&quot;' + l + '&quot;)">' +
      '<span class="wname">' + LANG_NAMES[l] + '</span>' +
      (l === LANG ? '<span class="wlock" style="color:#10B981">✓</span>' : '') +
    '</div>';
  }).join("");
  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("lang_title") + '</span>' +
        '<button style="margin-left:auto" onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' +
        '<div class="sub" style="margin:2px 0 8px">' + t("lang_hint") + '</div>' +
        rows +
      '</div>' +
    '</div>';
}

// ── 양액 설정 ────────────────────────────────────────────────────────────────
// 수경재배용. EC 로 양액 농도를 보고 보충량을 계산해 계기판에 띄운다.
// 숫자는 소수점까지 자유롭게 넣어야 해서(1.8, 0.05 …) 스테퍼 대신 숫자판을 쓴다.
var nutData = null, nutMsg = null, nutEdit = null, nutBuf = "";

var NUT_FIELDS = [
  {k:"target_ec",   t:"nut_target",   unit:"mS/cm"},
  {k:"source_ec",   t:"nut_source",   unit:"mS/cm"},
  {k:"tank_liters", t:"nut_tank",     unit:"L"},
  {k:"cal_ml",      t:"nut_cal_ml",   unit:"mL"},
  {k:"cal_liters",  t:"nut_cal_l",    unit:"L"},
  {k:"cal_ec_rise", t:"nut_cal_rise", unit:"mS/cm"},
  {k:"a_ratio",     t:"nut_a_ratio",  unit:"%"}
];

function openNutrient(){
  nutMsg = null; nutEdit = null;
  fetch("/api/nutrient", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ nutData = d; drawNutrient(); })
    .catch(function(){ alert(t("load_fail")); });
}

function drawNutrient(){
  if (!nutData) return;
  document.getElementById("wifi").innerHTML = "";
  var body;

  if (nutEdit){
    // 숫자판 — 고른 항목 하나만 고친다.
    var f = NUT_FIELDS.filter(function(x){ return x.k === nutEdit; })[0];
    var keys = ["1","2","3","4","5","6","7","8","9",".","0","back"];
    var pad = keys.map(function(k){
      var label = k === "back" ? "\u232B" : k;
      return '<button onclick="nutKey(&quot;' + k + '&quot;)">' + label + '</button>';
    });
    var rows = "";
    for (var i = 0; i < 4; i++){
      rows += '<div class="krow">' + pad.slice(i*3, i*3+3).join("") + '</div>';
    }
    body =
      '<div class="wcur">' + t(f.t) + ' <span class="sub">' + f.unit + '</span><br>' +
        '<b style="font-size:24px;font-family:ui-monospace,monospace">' +
          (nutBuf || "0") + '</b></div>' +
      '<div class="kbd" style="max-width:330px">' + rows +
        '<div class="krow">' +
          '<button class="wide" onclick="nutCancel()">' + t("cancel") + '</button>' +
          '<button class="go" onclick="nutApply()">' + t("save") + '</button>' +
        '</div>' +
      '</div>';
  } else {
    var msg = nutMsg ? '<div class="msg ' + nutMsg.kind + '">' + esc(nutMsg.text) + '</div>' : "";
    var onoff = function(key, label, sub){
      var on = !!nutData[key];
      return '<div class="srow">' +
        '<div class="sname">' + t(label) +
          (sub ? '<div class="sub">' + t(sub) + '</div>' : '') + '</div>' +
        '<button class="toggle' + (on ? " on" : "") + '" onclick="nutToggle(&quot;' + key + '&quot;)">' +
          (on ? t("on") : t("off")) + '</button>' +
      '</div>';
    };
    var rows2 = NUT_FIELDS.map(function(f){
      var v = nutData[f.k];
      return '<div class="srow" style="cursor:pointer" onclick="nutOpenKey(&quot;' + f.k + '&quot;)">' +
        '<div class="sname">' + t(f.t) + '</div>' +
        '<div class="num" style="width:auto;padding:0 12px">' + v + '</div>' +
        '<span class="sub" style="width:52px">' + f.unit + '</span>' +
      '</div>';
    }).join("");
    body = msg + onoff("enabled", "nut_use", "nut_use_sub") + rows2 +
      onoff("atc", "nut_atc", "nut_atc_sub") +
      '<div class="msg err" style="margin-top:8px">' + t("nut_cal_hint") + '</div>' +
      '<div class="sub">' + t("nut_ec_note") + '</div>';
  }

  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("menu_nutrient") + '</span>' +
        '<button style="margin-left:auto" onclick="' +
          (nutEdit ? "nutCancel()" : "drawSettingsMenu()") + '">' +
          (nutEdit ? t("back_list") : t("back_menu")) + '</button>' +
      '</div>' +
      '<div class="sbody">' + body + '</div>' +
      (nutEdit ? '' :
        '<div class="ranges sfoot">' +
          '<button onclick="saveNutrient()" aria-pressed="true">' + t("save") + '</button>' +
        '</div>') +
    '</div>';
}

function nutToggle(key){ nutData[key] = !nutData[key]; drawNutrient(); }
function nutOpenKey(k){ nutEdit = k; nutBuf = String(nutData[k]); drawNutrient(); }
function nutCancel(){ nutEdit = null; nutBuf = ""; drawNutrient(); }
function nutKey(k){
  if (k === "back") nutBuf = nutBuf.slice(0, -1);
  else if (k === "." ) { if (nutBuf.indexOf(".") < 0) nutBuf += (nutBuf || "0") === "0" && !nutBuf ? "0." : "."; }
  else nutBuf = (nutBuf === "0" ? "" : nutBuf) + k;
  if (nutBuf.length > 9) nutBuf = nutBuf.slice(0, 9);
  drawNutrient();
}
function nutApply(){
  var v = parseFloat(nutBuf);
  if (!isNaN(v)) nutData[nutEdit] = v;
  nutEdit = null; nutBuf = "";
  drawNutrient();
}

function saveNutrient(){
  fetch("/api/nutrient/save", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(nutData)
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      nutMsg = d && d.ok
        ? {kind:"ok", text: d.saved ? t("nut_saved") : t("saved_mem")}
        : {kind:"err", text:(d && d.error) || t("save_fail")};
      drawNutrient();
    })
    .catch(function(){ nutMsg = {kind:"err", text:t("save_fail")}; drawNutrient(); });
}

// ── 재시작 ───────────────────────────────────────────────────────────────────
// 현장에서 뭔가 멎었을 때 사람이 전원을 뽑지 않고 화면에서 되살릴 수 있게 한다.
// 전원을 뽑으면 보관 중인 값이 상할 수 있어, 곱게 끝내는 길을 열어 둔다.
var restartAsk = null;   // null | "app" | "dev"

function openRestart(){ restartAsk = null; drawRestart(); }

function drawRestart(){
  document.getElementById("wifi").innerHTML = "";
  var body;
  if (restartAsk){
    var isDev = restartAsk === "dev";
    body =
      '<div class="wcur">' + t(isDev ? "reboot_dev" : "restart_app") + '<br>' +
        '<b>' + t("restart_confirm") + '</b></div>' +
      '<div class="ranges" style="margin-top:8px">' +
        '<button aria-pressed="true" onclick="doRestart(&quot;' + restartAsk + '&quot;)">' +
          t("restart_yes") + '</button>' +
        '<button onclick="restartBack()">' + t("cancel") + '</button>' +
      '</div>';
  } else {
    var rows = [
      {k:"app", t:"restart_app", sub:"restart_app_sub"},
      {k:"dev", t:"reboot_dev",  sub:"reboot_dev_sub"}
    ].map(function(it){
      return '<div class="srow" style="cursor:pointer" onclick="askRestart(&quot;' + it.k + '&quot;)">' +
        '<div class="sname">' + t(it.t) + '<div class="sub">' + t(it.sub) + '</div></div>' +
        '<span style="color:#64748B;font-size:20px;flex:0 0 auto">\u203A</span>' +
      '</div>';
    }).join("");
    body = rows + '<div class="sub" style="margin-top:8px">' + t("restart_hint") + '</div>';
  }
  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("menu_restart") + '</span>' +
        '<button style="margin-left:auto" onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' + body + '</div>' +
    '</div>';
}

function askRestart(kind){ restartAsk = kind; drawRestart(); }
function restartBack(){ restartAsk = null; drawRestart(); }

function doRestart(kind){
  var dev = kind === "dev";
  // 요청을 보내는 순간 프로그램이 끝나므로 응답을 못 받을 수 있다.
  // 그래서 성공 화면을 먼저 띄우고, 실패했을 때만 되돌린다.
  document.getElementById("setup").innerHTML =
    '<div class="overlay"><h1>' + t(dev ? "rebooting" : "restarting") + '</h1></div>';
  fetch(dev ? "/api/reboot" : "/api/restart", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok === false){
        restartAsk = null;
        drawRestart();
        setupMsg = null;
        document.getElementById("setup").innerHTML =
          '<div class="setup"><div class="chead">' +
            '<span class="ctitle">' + t("menu_restart") + '</span>' +
            '<button style="margin-left:auto" onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
          '</div><div class="sbody"><div class="msg err">' +
            esc(d.error || t("restart_fail")) + '</div></div></div>';
        return;
      }
      // 되살아나면 화면을 새로 읽는다. 프로그램 재시작은 약 15초, 재부팅은 약 1분.
      setTimeout(function(){ location.reload(); }, dev ? 60000 : 18000);
    })
    .catch(function(){
      // 응답을 못 받은 것은 대개 프로그램이 이미 끝났다는 뜻이다 — 정상이다.
      setTimeout(function(){ location.reload(); }, dev ? 60000 : 18000);
    });
}

function setLang(l){
  if (!/^(ko|en|vi|id)$/.test(l)) return;
  LANG = l;
  try { document.documentElement.lang = l; } catch(e){}
  fetch("/api/lang", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({lang:l})}).catch(function(){});
  if (lastState) render(lastState);   // 뒤 화면·푸터도 새 언어로
  drawLang();                          // 언어 화면을 새 언어로 다시 그린다(선택 표시)
}

function drawSettings(){
  if (!setupData) return;
  var d = setupData;

  var rows = d.sensors.map(function(sn, i){
    return '<div class="srow">' +
      '<div class="sname">' + senName(sn.key) +
        '<div class="sub">' + (sn.enabled ? t("in_use") : t("not_used")) + '</div></div>' +
      '<button class="toggle' + (sn.enabled ? " on" : "") + '" ' +
        'onclick="toggleSensor(' + i + ')">' + (sn.enabled ? t("on") : t("off")) + '</button>' +
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
        '<span class="ctitle">' + t("menu_sensors") + '</span>' +
        '<span class="cstats"><span>' + (d.port || "") + '</span></span>' +
        '<button onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' +
        msg + found +
        '<div class="sub" style="margin:2px 0 6px">' + t("slave_hint") + '</div>' +
        rows +
        ecRow(d) +
        '<div class="srow">' +
          '<div class="sname">' + t("interval") + '<div class="sub">' + t("interval_sub") + '</div></div>' +
          '<div class="step">' +
            '<button onclick="bumpInterval(-60)">−</button>' +
            '<div class="num">' + d.interval + '</div>' +
            '<button onclick="bumpInterval(60)">+</button>' +
          '</div></div>' +
      '</div>' +
      '<div class="ranges sfoot">' +
        '<button onclick="autoAssign()">' + t("auto_assign") + '</button>' +
        '<button onclick="scanBus()">' + t("scan_bus") + '</button>' +
        '<button onclick="saveSettings()" aria-pressed="true">' + t("save") + '</button>' +
      '</div>' +
    '</div>';
}

// EC 센서 측정 항목 — 같은 센서로 염도와 전도도 둘 다 낼 수 있어 고르게 한다.
// 양액처럼 EC 자체가 관리 대상인 곳에서는 염도로 바꾼 값이 뜻을 흐린다.
function ecRow(d){
  var mode = d.ec_mode || "salinity";
  var unit = d.ec_unit || "us";
  var pick = function(val, label){
    return '<button class="toggle' + (mode === val ? " on" : "") + '" ' +
      'onclick="setEcMode(&quot;' + val + '&quot;)">' + t(label) + '</button>';
  };
  var row =
    '<div class="srow">' +
      '<div class="sname">' + t("ec_measure") +
        '<div class="sub">' + t(mode === "conductivity" ? "ec_hint_ec" : "ec_hint_sal") + '</div></div>' +
      pick("salinity", "ec_salinity") + pick("conductivity", "ec_conductivity") +
    '</div>';
  // 단위는 전도도로 볼 때만 뜻이 있다.
  if (mode === "conductivity"){
    var u = function(val, label){
      return '<button class="toggle' + (unit === val ? " on" : "") + '" ' +
        'onclick="setEcUnit(&quot;' + val + '&quot;)">' + label + '</button>';
    };
    row += '<div class="srow">' +
      '<div class="sname">' + t("ec_unit_label") + '</div>' +
      u("us", "uS/cm") + u("ms", "mS/cm") +
    '</div>';
  }
  return row;
}

function setEcMode(v){ setupData.ec_mode = v; drawSettings(); }
function setEcUnit(v){ setupData.ec_unit = v; drawSettings(); }

// 센서 이름 — 서버가 준 한국어 이름 대신 화면 언어로 보여 준다.
function senName(key){
  if (key === "ph") return "pH / ORP";
  if (key === "do") return t("n_do");
  if (key === "ec") return t("n_ec");
  return key;
}

function renderFound(found){
  if (!found.length) return '<div class="msg err">' + t("none_responding") + '</div>';
  if (found[0].error) return '<div class="msg err">' + found[0].error + '</div>';
  var list = found.map(function(f){
    return 'ID <b>' + f.id + '</b> — ' + f.kind + ' (' + f.note + ')';
  }).join("<br>");
  return '<div class="found">' + t("found_on_bus") + '<br>' + list + '</div>';
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
  setupMsg = {kind:"ok", text:t("scanning")};
  drawSettings();
  fetch("/api/sensors/scan", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      setupData.found = d.found || [];
      setupMsg = null;
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:t("scan_fail")};
      drawSettings();
    });
}

// 꽂아 둔 센서를 훑어 "값이 나오는 자리" 를 그대로 배치한다.
// 바로 저장하지 않고 화면의 숫자만 채운다 — 확인하고 저장은 사람이 누른다.
function autoAssign(){
  setupMsg = {kind:"ok", text:t("finding")};
  drawSettings();
  fetch("/api/sensors/auto", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { setupMsg = {kind:"err", text:d.error}; drawSettings(); return; }

      var names = {ph:"pH / ORP", do:t("n_do"), ec:t("n_ec")};
      var conflictKeys = Object.keys(d.conflicts || {});
      if (conflictKeys.length) {
        var c = conflictKeys.map(function(k){
          return t("conflict_resp", {name: names[k], ids: d.conflicts[k].join(", ")});
        }).join(" / ");
        setupMsg = {kind:"err", text: t("conflict_pick", {list: c})};
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
        setupMsg = {kind:"err", text:t("none_responding")};
      } else {
        setupMsg = {kind:"ok", text: missing.length
          ? t("auto_done_missing", {done: done.join(", "), missing: missing.join(", ")})
          : t("auto_done", {done: done.join(", ")})};
      }
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:t("find_fail")};
      drawSettings();
    });
}

function saveSettings(){
  var payload = {interval: setupData.interval,
                 ec_mode: setupData.ec_mode, ec_unit: setupData.ec_unit};
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
        setupMsg = {kind:"ok", text: d.saved ? t("saved_ok") : t("saved_mem")};
      } else {
        setupMsg = {kind:"err", text: d.error || t("save_fail")};
      }
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:t("save_fail")};
      drawSettings();
    });
}

// ── Wi‑Fi ────────────────────────────────────────────────────────────────────
// 수조 옆에서 화면만 보고 공유기를 바꿔 붙일 수 있게 한다. 키오스크에는
// 물리 키보드가 없으므로 비밀번호 입력용 화면 키보드를 페이지 안에 둔다.
var wifiOpen = false, wifiData = null, wifiMsg = null;
var wifiSel = null, wifiPw = "", wifiShowPw = false, wifiShift = false, wifiLayer = "abc";
var wifiBusy = false;

function openWifi(){
  wifiOpen = true; wifiData = null; wifiMsg = {kind:"ok", text:t("wifi_loading")};
  wifiSel = null; wifiPw = ""; wifiShowPw = false; wifiShift = false; wifiLayer = "abc";
  drawWifi();
  loadWifi(true);
}

function closeWifi(){
  wifiOpen = false; wifiData = null; wifiSel = null; wifiPw = "";
  document.getElementById("wifi").innerHTML = "";
  // [설정] 메뉴에서 들어왔으면 메뉴로 돌아가고, 아니면 기본 화면으로.
  if (settingsOpen) drawSettingsMenu(); else tick();
}

function loadWifi(rescan){
  wifiBusy = true;
  Promise.all([
    fetch("/api/wifi", {cache:"no-store"}).then(function(r){ return r.json(); }),
    fetch("/api/wifi/scan" + (rescan ? "?rescan=1" : ""), {method:"POST"})
      .then(function(r){ return r.json(); })
  ]).then(function(res){
    wifiBusy = false;
    var st = res[0], sc = res[1];
    if (st && st.available === false){
      wifiData = {available:false, reason: st.reason || "Wi‑Fi 를 쓸 수 없습니다."};
      wifiMsg = null; drawWifi(); return;
    }
    wifiData = {
      available: true,
      status: st,
      networks: (sc && sc.networks) || [],
      scanError: sc && sc.error
    };
    wifiMsg = wifiData.networks.length ? null
      : {kind:"err", text: wifiData.scanError || t("wifi_none_found")};
    drawWifi();
  }).catch(function(){
    wifiBusy = false;
    wifiMsg = {kind:"err", text:t("wifi_load_fail")};
    drawWifi();
  });
}

function barsHtml(n){
  var s = "";
  for (var i = 1; i <= 4; i++) s += '<i class="' + (i <= n ? "on" : "") + '"></i>';
  return '<span class="bars">' + s + '</span>';
}

function drawWifi(){
  if (!wifiOpen) return;
  var body;

  if (wifiData && wifiData.available === false){
    body = '<div class="wcur">' + esc(wifiData.reason) + '</div>';
  } else if (wifiSel){
    body = drawWifiPassword();
  } else {
    body = drawWifiList();
  }

  document.getElementById("wifi").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + (wifiSel ? esc(wifiSel.ssid) : "Wi‑Fi") + '</span>' +
        (wifiSel
          ? '<button style="margin-left:auto" onclick="wifiBack()">' + t("back_list") + '</button>'
          : '<span class="cstats"><span>' +
              (wifiData && wifiData.status && wifiData.status.ip ? esc(wifiData.status.ip) : "") +
            '</span></span><button onclick="closeWifi()">' + t("back_menu") + '</button>') +
      '</div>' +
      '<div class="sbody">' + body + '</div>' +
    '</div>';
}

function drawWifiList(){
  var d = wifiData;
  var cur = "";
  if (d && d.status && d.status.connected){
    var ipx = d.status.ip ? ' · ' + esc(d.status.ip) : '';
    cur = '<div class="wcur">' + t("wifi_now", {ssid: esc(d.status.ssid || ""), ip: ipx}) + '</div>';
  } else if (d && d.status){
    cur = '<div class="wcur">' + t("wifi_none_conn") + '</div>';
  }

  var msg = wifiMsg ? '<div class="msg ' + wifiMsg.kind + '">' + esc(wifiMsg.text) + '</div>' : "";

  var rows = (d && d.networks ? d.networks : []).map(function(n, i){
    return '<div class="wrow' + (n.in_use ? " cur" : "") + '" onclick="pickNet(' + i + ')">' +
      '<span class="wname">' + esc(n.ssid) + '</span>' +
      (n.secure ? '<span class="wlock">' + t("wifi_locked") + '</span>' : '') +
      barsHtml(n.bars) +
    '</div>';
  }).join("");

  var foot = '<div class="ranges sfoot" style="margin-top:8px">' +
    '<button onclick="loadWifi(true)"' + (wifiBusy ? ' disabled' : '') + '>' +
      (wifiBusy ? t("wifi_searching") : t("wifi_rescan")) + '</button>' +
    '</div>';

  return cur + msg + rows + foot;
}

function pickNet(i){
  var n = wifiData.networks[i];
  if (!n) return;
  if (!n.secure){ wifiSel = n; wifiPw = ""; doConnect(); return; }
  wifiSel = n; wifiPw = ""; wifiShowPw = false; wifiShift = false; wifiLayer = "abc";
  wifiMsg = null;
  drawWifi();
}

function wifiBack(){
  wifiSel = null; wifiPw = ""; wifiMsg = null;
  drawWifi();
}

var K_ABC = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l"],
  ["z","x","c","v","b","n","m"]
];
var K_SYM = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["!","@","#","$","%","^","&","*","(",")"],
  ["-","_","=","+","[","]","{","}",";",":"],
  ["~","\\\\","`","'",'"',",",".","?","/","|"]
];

function drawWifiPassword(){
  var msg = wifiMsg ? '<div class="msg ' + wifiMsg.kind + '">' + esc(wifiMsg.text) + '</div>' : "";

  var shown = wifiShowPw ? esc(wifiPw) : new Array(wifiPw.length + 1).join("\\u2022");
  var field =
    '<div class="pwbox"><div class="pwf">' +
      '<div style="flex:1;min-width:0;font:600 18px/1 ui-monospace,monospace;' +
        'letter-spacing:2px;padding:10px 0;color:' + (wifiPw ? "#E8EDF7" : "#475569") + '">' +
        (wifiPw ? shown : t("wifi_pw_ph")) + '</div>' +
      '<button class="eye" onclick="wifiTogglePw()">' + (wifiShowPw ? t("wifi_hide") : t("wifi_show")) + '</button>' +
    '</div></div>';

  var rows = (wifiLayer === "sym" ? K_SYM : K_ABC).map(function(row, ri){
    var keys = row.map(function(ch, ci){
      var label = (wifiLayer === "abc" && wifiShift) ? ch.toUpperCase() : ch;
      // 따옴표·특수문자가 onclick 안에서 깨지지 않게 인덱스로 넘긴다.
      return '<button onclick="kTap(' + ri + ',' + ci + ')">' + esc(label) + '</button>';
    }).join("");
    // 마지막 글자 줄에 Shift(왼쪽)·지움(오른쪽)을 붙인다.
    if (ri === 3){
      var shiftBtn = wifiLayer === "abc"
        ? '<button class="k-shift wide' + (wifiShift ? " on" : "") + '" onclick="kShift()">⇧</button>'
        : '';
      return '<div class="krow">' + shiftBtn + keys +
             '<button class="wide" onclick="kBack()">⌫</button></div>';
    }
    return '<div class="krow">' + keys + '</div>';
  }).join("");

  var bottom =
    '<div class="krow">' +
      '<button class="wide" onclick="kLayer()">' + (wifiLayer === "sym" ? "ABC" : "?123") + '</button>' +
      '<button class="wide" onclick="kSpace()">' + t("wifi_space") + '</button>' +
      '<button class="go" onclick="doConnect()"' + (wifiBusy ? ' disabled' : '') + '>' +
        (wifiBusy ? t("wifi_connecting") : t("wifi_connect")) + '</button>' +
    '</div>';

  return msg + field + '<div class="kbd">' + rows + bottom + '</div>';
}

function kTap(ri, ci){
  var set = wifiLayer === "sym" ? K_SYM : K_ABC;
  var ch = set[ri][ci];
  if (wifiLayer === "abc" && wifiShift) ch = ch.toUpperCase();
  wifiPw += ch;
  drawWifi();
}
function kBack(){ wifiPw = wifiPw.slice(0, -1); drawWifi(); }
function kSpace(){ wifiPw += " "; drawWifi(); }
function kShift(){ wifiShift = !wifiShift; drawWifi(); }
function kLayer(){ wifiLayer = wifiLayer === "sym" ? "abc" : "sym"; drawWifi(); }
function wifiTogglePw(){ wifiShowPw = !wifiShowPw; drawWifi(); }

function doConnect(){
  if (!wifiSel) return;
  wifiBusy = true;
  wifiMsg = {kind:"ok", text: t("wifi_connecting_to", {ssid: esc(wifiSel.ssid)})};
  drawWifi();
  fetch("/api/wifi/connect", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ssid: wifiSel.ssid, password: wifiPw})
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      wifiBusy = false;
      if (d && d.ok){
        // 연결됐으면 목록으로 돌아가 상태를 새로 읽는다.
        wifiSel = null; wifiPw = "";
        wifiMsg = {kind:"ok", text:t("wifi_connected")};
        loadWifi(false);
      } else {
        wifiMsg = {kind:"err", text: (d && d.error) || t("wifi_connect_fail")};
        drawWifi();
      }
    })
    .catch(function(){
      wifiBusy = false;
      wifiMsg = {kind:"err", text:t("wifi_connect_fail")};
      drawWifi();
    });
}

function tick(){
  if (settingsOpen || wifiOpen) return;   // 설정·Wi‑Fi 중에는 뒤 화면을 다시 그리지 않는다
  fetch("/api/state", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(render)
    .catch(function(){
      // 수집기가 재시작 중일 수 있다. 다음 주기에 다시 시도한다.
      document.getElementById("status").textContent = t("no_collector");
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
    on_unlink=None,
    history=None,
    on_scan=None,
    on_save_sensors=None,
    on_set_id=None,
    on_auto=None,
    get_sensors=None,
    get_wifi=None,
    on_wifi_scan=None,
    on_wifi_connect=None,
    language="ko",
    on_set_lang=None,
    on_restart=None,
    on_reboot=None,
    get_nutrient=None,
    on_save_nutrient=None,
) -> ThreadingHTTPServer | None:
    """상태 페이지를 띄운다. 실패해도 수집은 계속되어야 하므로 None 을 돌려준다."""

    # 첫 화면 언어를 페이지에 새겨 둔다(웹페이지와 같은 4종). 화면에서 바꾸면
    # JS 가 즉시 다시 그리고 서버에도 남기므로, 다음에 열 때 그 언어로 뜬다.
    lang = language if language in ("ko", "en", "vi", "id") else "ko"
    page_bytes = PAGE.replace("__LANG__", lang).encode()

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
            elif self.path == "/api/nutrient" and get_nutrient is not None:
                self._send(200, json.dumps(get_nutrient()).encode(), "application/json")
            elif self.path == "/api/wifi" and get_wifi is not None:
                self._send(200, json.dumps(get_wifi()).encode(), "application/json")
            elif self.path in ("/", "/index.html"):
                self._send(200, page_bytes, "text/html; charset=utf-8")
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
            if self.path.startswith("/api/wifi/scan") and on_wifi_scan is not None:
                query = parse_qs(urlparse(self.path).query)
                rescan = (query.get("rescan") or ["0"])[0] not in ("0", "", "false")
                self._send(200, json.dumps(on_wifi_scan(rescan)).encode(), "application/json")
                return
            if self.path == "/api/wifi/connect" and on_wifi_connect is not None:
                body = self._body()
                ssid = body.get("ssid")
                password = body.get("password", "")
                if not isinstance(ssid, str) or not isinstance(password, str):
                    self._send(200, json.dumps({"ok": False, "error": "요청이 올바르지 않습니다."}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_wifi_connect(ssid, password)).encode(),
                           "application/json")
                return
            if self.path == "/api/nutrient/save" and on_save_nutrient is not None:
                self._send(200, json.dumps(on_save_nutrient(self._body())).encode(),
                           "application/json")
                return
            if self.path == "/api/restart" and on_restart is not None:
                self._send(200, json.dumps(on_restart()).encode(), "application/json")
                return
            if self.path == "/api/reboot" and on_reboot is not None:
                self._send(200, json.dumps(on_reboot()).encode(), "application/json")
                return
            if self.path == "/api/lang" and on_set_lang is not None:
                body = self._body()
                lang_sel = body.get("lang")
                ok = on_set_lang(lang_sel) if isinstance(lang_sel, str) else False
                self._send(200, json.dumps({"ok": bool(ok)}).encode(), "application/json")
                return
            if self.path == "/api/pair/start" and on_pair_start is not None:
                on_pair_start()
                self._send(200, b'{"ok":true}', "application/json")
            elif self.path == "/api/pair/cancel" and on_pair_cancel is not None:
                on_pair_cancel()
                self._send(200, b'{"ok":true}', "application/json")
            elif self.path == "/api/unlink" and on_unlink is not None:
                on_unlink()
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
