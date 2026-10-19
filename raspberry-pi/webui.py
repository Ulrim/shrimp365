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

import limits

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

            # 장비가 스스로 낸 판단. 통신과 무관하게 여기서 끝난다.
            "advice": [],          # 설비 운전 권고 (advice.py)
            "anomalies": [],       # 추세 이상징후 (anomaly.py)

            # 탄소 MRV 전력 수기 입력. 수질 쪽 연결(linked/pairing)과 **별개**다 —
            # 키도 창구도 다르고, 한쪽만 연결된 상태가 정상적으로 존재한다.
            "mrv_linked": False,    # MRV 수집 키를 들고 있는가
            "mrv_site_id": None,    # 연결된 사이트 번호
            "mrv_pairing": False,   # MRV 연결 화면을 띄우는 중인가
            "mrv_pair_code": None,
            "mrv_pair_error": None,
            "mrv_meters": [],       # 전력 계측기 목록(서버가 준 것만)
            # 화면에 띄울 계측기 id. **비어 있으면 전부 띄운다**(빈 목록이
            # "아무것도 안 띄운다" 면 업데이트 직후 작업자가 전력을 못 넣는다).
            "mrv_visible": [],
            # 고른 계측기 가운데 서버 목록에 없는 것. 조용히 감추지 않고 알린다.
            "mrv_meters_missing": [],
            # 한 번에 고를 수 있는 계측기 수의 상한(shrimp365_sensor.MRV_VISIBLE_MAX).
            # **정본은 저쪽 상수 하나**다 — 화면이 토글 시점에 막기 위해 받아 둔다.
            # 0 이면 화면은 막지 않고 저장 때 서버가 막는다(수집기가 안 넣어 준 경우).
            "mrv_vis_max": 0,
            "mrv_pending": 0,       # 아직 못 올린 전력 입력 건수
            "mrv_last": None,       # 마지막 전송 결과 한 줄
            "mrv_clock_ok": True,   # 장비 시계를 믿을 수 있는가
            "mrv_recent": [],       # 계측기별 마지막으로 보낸 지침(값·시각)
            "mrv_today": 0,         # 오늘 서버까지 올라간 건수
            # 재전송에서 서버가 **받지 않은** 보관 건수와 그 사유. 조용히 지우지
            # 않고 화면으로 알린다 — 사람이 적은 지침을 장비가 버리면 안 된다.
            "mrv_blocked": 0,
            "mrv_blocked_reason": None,
            # MRV 안내문에 적을 주소. 수질 페어링만 채우는 pair_url 과 다르다 —
            # [server] endpoint 가 다른 호스트인 장비에서 틀린 주소를 안내하지 않도록
            # MRV 창구의 호스트를 따로 둔다.
            "mrv_pair_url": "",

            # 운전 모드 — 이 장비가 무엇을 하는 기계인가(modes.py).
            # mrv 모드에서는 **기본 화면이 전력 입력 단말**이 된다.
            "mode": "aquaculture",
            # 설정에 켜 둔 수질 센서가 있는가. MRV 모드에서 수질 칸을 보일지 정한다 —
            # 기계실 단말에는 센서가 아예 안 붙어 있을 수 있고, 그 때 '--' 로 채운
            # 칸을 기본 화면에 두면 보여 줄 것이 없는 화면이 된다.
            "sensors_on": True,
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
  /* 칩은 줄이지 않는다(.chip flex:0 0 auto). 그러면 줄어들 수 있는 것이 계정·사이트
     이름뿐이라, 칩이 길어진 날 그 이름이 **세로 한 글자씩**으로 무너지고 헤더가 세
     줄이 된다 — 영어 「The device clock is wrong …」 에서 실제로 그렇게 됐고, 그
     바람에 헤더가 화면 높이를 먹어 **마지막 지침 두 번째 줄이 화면 밖으로 밀렸다**.
     이름은 한 줄로 두고 모자라면 … 로 줄인다. 이름은 줄여도 되지만 지침은 아니다. */
  .link > span:not(.chip){
    min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
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

  /* 설비 운전 권고 — 값 격자 바로 아래. "무엇을 돌릴까" 가 값보다 아래이되
     양액 안내보다는 위다(폐사까지의 시간이 짧은 쪽을 먼저 읽게 한다). */
  .adv{
    flex:0 0 auto;margin-top:9px;padding:8px 13px;border-radius:12px;
    background:#111A2E;border:1px solid #22304C;
  }
  .adv.danger{border-color:#DC2626;background:#DC262618}
  .adv.warn{border-color:#D97706;background:#D9770618}
  .adv.save{border-color:#10B981;background:#10B98112}
  .adv .head{
    font-size:11.5px;font-weight:800;letter-spacing:.04em;color:#94A3B8;
    text-transform:uppercase;margin-bottom:4px;
  }
  .adv .row{display:flex;align-items:baseline;gap:9px;line-height:1.35}
  .adv .row + .row{margin-top:5px;padding-top:5px;border-top:1px solid #1E293B}
  .adv .act{font-size:15px;font-weight:800;color:#E8EDF7}
  .adv .row.danger .act{color:#F87171}
  .adv .row.warn .act{color:#FBBF24}
  .adv .row.save .act{color:#34D399}
  .adv .why{font-size:12.5px;color:#94A3B8;margin-left:auto;text-align:right;flex:0 0 auto}

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
  /* 센서 테스트 결과 */
  .trow{margin-top:8px;padding-top:7px;border-top:1px solid #22304C;line-height:1.7}
  .trow:first-of-type{border-top:0;margin-top:4px}
  .tfield{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12px;margin-top:2px}
  .tname{min-width:96px;color:#94A3B8;font-family:ui-monospace,monospace}
  .tval{min-width:92px;color:#E8EDF7;font-weight:700;font-family:ui-monospace,monospace}
  .traw{margin-left:auto}
  .okv{color:#34D399;font-weight:700}
  .badv{color:#F87171;font-weight:700}
  .dim{color:#64748B;font-weight:500}
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
  /* 패널 머리의 [뒤로]·[닫기]. 손가락으로 누르는 화면인데 기본 <button> 그대로라
     19~22px 이었다 — 설정·언어·보정·양액·운전 모드·MRV·전력 패널의 나가는 길이
     전부 이 버튼이다. .ranges button 과 같은 치수로 맞춘다. */
  .chead button{
    font:700 13px/1 inherit;padding:8px 14px;min-height:40px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;
  }
  .chead button:active{background:#1E40AF;border-color:#1E40AF;color:#fff}
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

  /* 전력 입력 패널 — 기계실에서 장갑 낀 손가락으로 누른다.
     800×480 전체를 덮고, 닫으면 측정값으로 돌아온다(화면 원칙). */
  .power{
    position:fixed;inset:0;background:#0B1120;z-index:40;
    display:flex;flex-direction:column;padding:10px 16px 12px;
  }
  .pbody{flex:1;display:flex;gap:12px;min-height:0}
  .pcol{flex:1;display:flex;flex-direction:column;min-width:0}
  .plist{flex:1;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch}
  /* 계측기 한 줄. 손가락으로 누르므로 세로 52px 이상 잡는다. */
  .prow{
    display:flex;align-items:center;gap:10px;min-height:52px;
    padding:9px 13px;margin-bottom:7px;cursor:pointer;
    background:#111A2E;border:1px solid #22304C;border-radius:11px;
  }
  .prow:active{background:#16223C}
  .prow .pname{font-size:16px;font-weight:700;flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* 알 수 없는 unit 토큰이 길게 와도 줄이 무너지지 않게 한 줄로 두고 … 로 줄인다.
     이름(.pname)과 달리 이 칸은 줄어들지 않으므로(flex:0 0 auto) 상한을 둔다. */
  .prow .punit{font-size:12px;color:#64748B;font-family:ui-monospace,monospace;flex:0 0 auto;
    max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* 폭기 여부 — 폭기 EI 가 이 플래그로 갈린다. 목록에서 반드시 보여야 한다. */
  .aer{
    font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;flex:0 0 auto;
    border:1px solid #3B82F6;color:#60A5FA;
  }
  /* 숫자 키패드 — 한 칸 최소 44px(실제로는 더 크다). */
  .pkeys{
    flex:0 0 330px;display:grid;gap:6px;
    grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);
  }
  .pkeys button{
    min-height:44px;font:800 26px/1 ui-monospace,monospace;
    background:#16223C;color:#E8EDF7;border:1px solid #22304C;border-radius:10px;cursor:pointer;
  }
  .pkeys button:active{background:#1E40AF}
  .pbig{
    font:800 46px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;
    background:#0B1120;border:1px solid #2B3A57;border-radius:11px;
    padding:12px 14px;margin:7px 0;min-height:64px;
    display:flex;align-items:center;justify-content:flex-end;gap:8px;
  }
  .pbig small{font-size:16px;font-weight:700;color:#94A3B8}
  .pbig.ph{color:#475569}
  /* 지침 / 사용량 — 둘을 섞으면 구간값이 어긋난다. 무엇을 넣는지 늘 보이게 둔다. */
  .pseg{display:flex;gap:6px}
  .pseg button{
    flex:1;min-height:48px;padding:7px 9px;border-radius:10px;cursor:pointer;
    background:transparent;border:1px solid #22304C;color:#94A3B8;
    font:700 14px/1.25 inherit;text-align:left;
  }
  .pseg button .ssub{display:block;font-size:11px;font-weight:500;color:#64748B;margin-top:3px}
  .pseg button[aria-pressed="true"]{background:#1E40AF;border-color:#1E40AF;color:#fff}
  .pseg button[aria-pressed="true"] .ssub{color:#C7D7FE}
  .pnote{font-size:12px;color:#94A3B8;line-height:1.55;margin-bottom:6px}
  .pnote b{color:#E8EDF7}
  .pwarn{
    font-size:13px;font-weight:700;line-height:1.5;padding:9px 12px;border-radius:10px;
    margin-bottom:7px;background:#DC262618;color:#F87171;border:1px solid #DC2626;
  }
  .pbtns{display:flex;gap:8px;flex:0 0 auto;padding-top:8px}
  .pbtns button{
    flex:1;min-height:52px;border-radius:10px;cursor:pointer;
    font:800 16px/1 inherit;background:#1E40AF;color:#fff;border:0;
  }
  .pbtns button.ghost{background:transparent;border:1px solid #22304C;color:#94A3B8}
  .pbtns button:disabled{opacity:.45}
  .pres{
    flex:1;display:flex;flex-direction:column;justify-content:center;gap:9px;
    background:#111A2E;border:1px solid #22304C;border-radius:13px;padding:14px 18px;
  }
  .pres.ok{border-color:#10B981}
  .pres.hold{border-color:#D97706}
  .pres.bad{border-color:#DC2626}
  .pres h2{font-size:23px;font-weight:800}
  .pres.ok h2{color:#34D399}
  .pres.hold h2{color:#F59E0B}
  .pres.bad h2{color:#F87171}
  .pres .line{font-size:13.5px;color:#CBD5E1;line-height:1.5}
  .pres .line b{font-family:ui-monospace,monospace;color:#E8EDF7}
  /* MRV 기본 화면 — 이 장비의 본업이 전력 입력이라 버튼이 가장 크다. */
  .mhome{flex:1;display:flex;flex-direction:column;min-height:0;gap:8px}
  .mhead{font-size:11.5px;font-weight:800;letter-spacing:.04em;color:#94A3B8;
    text-transform:uppercase}
  .mval{margin-left:auto;font:800 23px/1 ui-monospace,monospace;
    font-variant-numeric:tabular-nums;flex:0 0 auto}
  .mval small{font-size:12px;font-weight:600;color:#94A3B8;margin-left:4px}
  .mcount{display:flex;align-items:center;gap:9px;flex:0 0 auto;font-size:13px;
    color:#CBD5E1;font-weight:700;flex-wrap:wrap}
  .mcount span{padding:5px 11px;border-radius:999px;border:1px solid #22304C;
    background:#111A2E}
  .mcount span.hold{border-color:#D97706;color:#F59E0B}
  .mcount span.dim{border:0;background:transparent;color:#64748B;font-weight:500}
  .mbig{
    flex:0 0 auto;width:100%;min-height:72px;border:0;border-radius:13px;
    background:#047857;color:#fff;font:800 25px/1 inherit;cursor:pointer;
  }
  .mbig:active{opacity:.8}
  .mbig.ghost{background:transparent;border:1px solid #22304C;color:#94A3B8;
    font-size:18px;min-height:60px}

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
<div id="power"></div>

<script>
// 값 칸의 표시 형식. **판정 숫자는 여기 없다** — limits.py 가 주입하는 BANDS 를
// 쓴다(화면·운전 권고·서버 알림이 같은 기준이어야 하므로 한 곳에 모았다).
var RANGES = {
  temperature: {unit:"\\u00B0C", digits:1},
  ph:          {unit:"",          digits:2},
  do_level:    {unit:"ppm",       digits:2},
  salinity:    {unit:"\u2030",    digits:1},
  // 전도도는 쓰는 곳마다 적정값이 달라(해수 약 50,000 uS/cm, 양액 1~3 mS/cm)
  // 좋고 나쁨을 코드가 정하지 않는다. 값만 그대로 보여 준다.
  conductivity:{unit:"uS/cm",     digits:0}
};
var BANDS = __BANDS__;
var NUT_BANDS = __NUT_BANDS__;
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
// 양액 관리를 켠 장비에서는 NUT_BANDS 로 바꿔 본다(둘 다 limits.py 가 준다).
var nutMode = false;   // 계기판이 매번 갱신할 때 함께 정한다

// 밴드의 한쪽 끝이 null 이면 그쪽은 보지 않는다 — 용존산소에 상한이 없는 것이
// 그 예다. 예전에는 상한 자리에 20 을 박아 두어, 과포화를 "위험"으로 찍었다.
function within(pair, v){
  if (!pair) return false;
  if (pair[0] !== null && v < pair[0]) return false;
  if (pair[1] !== null && v > pair[1]) return false;
  return true;
}

function level(key, v){
  var b = (nutMode && NUT_BANDS[key]) ? NUT_BANDS[key] : BANDS[key];
  if(!b) return "";
  if(within(b.ok, v)) return "";
  return within(b.warn, v) ? "warn" : "crit";
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
  m_ph_label:{ko:"pH",en:"pH",vi:"pH",id:"pH"},
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
  test_btn:{ko:"센서 테스트",en:"Test sensors",vi:"Kiểm tra cảm biến",id:"Uji sensor"},
  test_running:{ko:"센서를 읽는 중… 최대 20초",en:"Reading sensors… up to 20s",vi:"Đang đọc cảm biến… tối đa 20 giây",id:"Membaca sensor… hingga 20 dtk"},
  test_fail:{ko:"테스트하지 못했습니다.",en:"Test failed.",vi:"Không kiểm tra được.",id:"Uji gagal."},
  test_title:{ko:"센서 테스트 결과",en:"Sensor test result",vi:"Kết quả kiểm tra",id:"Hasil uji sensor"},
  test_comm_ok:{ko:"통신 정상",en:"Comms OK",vi:"Giao tiếp tốt",id:"Komunikasi OK"},
  test_no_reply:{ko:"응답 없음 — 배선·전원·ID 확인",en:"No reply — check wiring, power, ID",vi:"Không phản hồi — kiểm tra dây, nguồn, ID",id:"Tak merespons — cek kabel, daya, ID"},
  v_ok:{ko:"정상",en:"OK",vi:"Tốt",id:"OK"},
  v_probe:{ko:"전극 이상 — 값을 내지 못함",en:"Probe fault — no value",vi:"Lỗi đầu dò — không có giá trị",id:"Probe bermasalah — tanpa nilai"},
  v_range:{ko:"범위 벗어남",en:"Out of range",vi:"Ngoài khoảng",id:"Di luar rentang"},
  v_supersat:{ko:"포화도 {{p}}% — 물에 안 잠겼거나 보정 필요",en:"{{p}}% saturation — not submerged or needs calibration",vi:"Bão hòa {{p}}% — chưa ngập hoặc cần hiệu chuẩn",id:"Saturasi {{p}}% — belum terendam atau perlu kalibrasi"},
  v_undecodable:{ko:"해석 불가",en:"Cannot decode",vi:"Không giải mã được",id:"Tak terbaca"},
  test_none:{ko:"켜져 있는 센서가 없습니다.",en:"No sensors enabled.",vi:"Không có cảm biến bật.",id:"Tak ada sensor aktif."},
  sen_temp_off:{ko:"전극이 물 밖에 있는 듯",en:"Probe seems out of water",vi:"Đầu dò như ngoài nước",id:"Probe tampak di luar air"},
  sen_temp_off_sub:{ko:"이 센서 수온 {{a}}℃ / 다른 센서 {{b}}℃ — 같은 물이라면 이렇게 다를 수 없습니다. 전극을 물에 담그세요",en:"This sensor reads {{a}}℃ vs {{b}}℃ on the others — same water cannot differ this much. Submerge the probe",vi:"Cảm biến này {{a}}℃ so với {{b}}℃ ở cảm biến khác — cùng một nước không thể chênh vậy. Hãy nhúng đầu dò",id:"Sensor ini {{a}}℃ vs {{b}}℃ pada yang lain — air yang sama tak mungkin sebeda itu. Rendam probe"},
  sen_do_air:{ko:"전극이 물 밖에 있는 듯",en:"Probe seems out of water",vi:"Đầu dò như đang ngoài nước",id:"Probe tampak di luar air"},
  sen_do_air_sub:{ko:"포화도 {{p}}% — 센서도 산소가 많다고 보고합니다. 전극을 물에 완전히 담그세요",en:"{{p}}% saturation — the sensor also reports high oxygen. Submerge the probe fully",vi:"Bão hòa {{p}}% — cảm biến cũng báo oxy cao. Hãy nhúng ngập đầu dò",id:"Saturasi {{p}}% — sensor juga melaporkan oksigen tinggi. Rendam probe sepenuhnya"},
  sen_do_scale:{ko:"보정 필요 — 눈금이 어긋남",en:"Needs calibration — scale is off",vi:"Cần hiệu chuẩn — thang đo lệch",id:"Perlu kalibrasi — skala meleset"},
  sen_do_scale_sub:{ko:"mg/L 은 포화 {{p}}% 인데 센서 보고 포화도는 {{r}}% 입니다 — 물에는 잠겨 있으니 보정만 하면 됩니다",en:"mg/L implies {{p}}% but the sensor reports {{r}}% — it is submerged; only calibration is needed",vi:"mg/L cho ra {{p}}% nhưng cảm biến báo {{r}}% — đã ngập nước, chỉ cần hiệu chuẩn",id:"mg/L menunjukkan {{p}}% tetapi sensor melaporkan {{r}}% — sudah terendam, cukup kalibrasi"},
  sen_supersat:{ko:"물에서 나올 수 없는 값",en:"Impossible for water",vi:"Không thể có trong nước",id:"Mustahil untuk air"},
  sen_supersat_sub:{ko:"포화도 {{p}}% — 전극이 물에 잠겼는지, 보정이 되어 있는지 확인하세요",en:"{{p}}% saturation — check the probe is submerged and calibrated",vi:"Bão hòa {{p}}% — kiểm tra đầu dò đã ngập nước và đã hiệu chuẩn",id:"Saturasi {{p}}% — pastikan probe terendam dan terkalibrasi"},
  // 양액
  menu_cal:{ko:"보정 설정",en:"Calibration",vi:"Hiệu chuẩn",id:"Kalibrasi"},
  menu_cal_sub:{ko:"휴대용 측정기 값에 맞추기",en:"Match a handheld meter",vi:"Khớp với máy đo cầm tay",id:"Samakan dengan meter genggam"},
  cal_now:{ko:"센서값",en:"Sensor",vi:"Cảm biến",id:"Sensor"},
  cal_offset:{ko:"보정",en:"Offset",vi:"Bù",id:"Offset"},
  cal_result:{ko:"보정 후",en:"Corrected",vi:"Sau hiệu chuẩn",id:"Terkoreksi"},
  cal_set:{ko:"실측값 입력",en:"Enter actual",vi:"Nhập giá trị thực",id:"Masukkan nilai nyata"},
  cal_reset:{ko:"보정 해제",en:"Clear",vi:"Xóa",id:"Hapus"},
  cal_ask:{ko:"휴대용 측정기로 잰 값을 넣으세요",en:"Enter the value from your handheld meter",vi:"Nhập giá trị đo bằng máy cầm tay",id:"Masukkan nilai dari meter genggam"},
  cal_none:{ko:"지금 읽히는 값이 없어 보정할 수 없습니다",en:"No current reading — cannot calibrate",vi:"Không có giá trị hiện tại — không thể hiệu chuẩn",id:"Tak ada nilai saat ini — tak bisa kalibrasi"},
  cal_saved:{ko:"보정했습니다.",en:"Calibrated.",vi:"Đã hiệu chuẩn.",id:"Terkalibrasi."},
  cal_note:{ko:"1점 보정입니다 — 잰 그 지점에서만 정확합니다. 어긋남이 크면 보정으로 덮지 말고 전극을 먼저 손보세요.",en:"One-point correction — accurate only near the point you set. If the gap is large, fix the probe instead of masking it.",vi:"Hiệu chuẩn 1 điểm — chỉ chính xác quanh điểm đã đặt. Nếu lệch nhiều, hãy sửa đầu dò.",id:"Kalibrasi satu titik — akurat hanya di sekitar titik itu. Jika selisih besar, perbaiki probe."},
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
  restart_fail:{ko:"다시 시작하지 못했습니다.",en:"Couldn't restart.",vi:"Không khởi động lại được.",id:"Gagal memulai ulang."},
  // 설비 운전 권고 — advice.py 가 코드만 보내고 문장은 여기서 만든다.
  // 한 줄에 "무엇을 하라" 만 적는다. 왜 그런지는 옆의 값이 말한다.
  adv_head:{ko:"설비 운전 권고",en:"Equipment action",vi:"Khuyến nghị vận hành",id:"Rekomendasi operasi"},
  adv_do_critical:{ko:"산소공급기·브로워 즉시 최대 가동 · 급이 중단",en:"Run aerator/blower at full now · stop feeding",vi:"Chạy máy sục/quạt khí hết công suất · ngừng cho ăn",id:"Jalankan aerator/blower penuh · hentikan pakan"},
  adv_do_low:{ko:"브로워 가동 — 폭기량 20~30% 증대",en:"Start blower — raise aeration 20–30%",vi:"Bật quạt khí — tăng sục 20–30%",id:"Nyalakan blower — naikkan aerasi 20–30%"},
  adv_do_falling:{ko:"용존산소 하락 중 — 폭기 증대 준비",en:"DO falling — be ready to raise aeration",vi:"DO đang giảm — chuẩn bị tăng sục",id:"DO menurun — siap menaikkan aerasi"},
  adv_do_surplus:{ko:"과잉 폭기 — 브로워 출력·가동시간 점검",en:"Over-aeration — check blower output and run time",vi:"Sục quá mức — kiểm tra công suất và giờ chạy",id:"Aerasi berlebih — periksa daya dan jam operasi"},
  adv_ph_critical:{ko:"즉시 환수 · 알칼리도 점검",en:"Exchange water now · check alkalinity",vi:"Thay nước ngay · kiểm tra độ kiềm",id:"Ganti air sekarang · periksa alkalinitas"},
  adv_ph_shift:{ko:"pH 급변 — 환수·알칼리도 점검",en:"pH shift — exchange water, check alkalinity",vi:"pH biến động — thay nước, kiểm tra độ kiềm",id:"pH bergeser — ganti air, periksa alkalinitas"},
  adv_turbidity_high:{ko:"순환펌프·여과장치 점검 · 역세척",en:"Check circulation pump and filter · backwash",vi:"Kiểm tra bơm tuần hoàn và lọc · rửa ngược",id:"Periksa pompa sirkulasi dan filter · backwash"},
  adv_turbidity_up:{ko:"탁도 상승 — 여과 효율 점검",en:"Turbidity rising — check filtration",vi:"Độ đục tăng — kiểm tra hiệu suất lọc",id:"Kekeruhan naik — periksa efisiensi filter"},
  adv_temp_high:{ko:"차광·냉각 가동 · 폭기 증대",en:"Shade/cool now · raise aeration",vi:"Che nắng/làm mát · tăng sục khí",id:"Naungi/dinginkan · naikkan aerasi"},
  adv_temp_low:{ko:"히터 가동 점검",en:"Check the heater",vi:"Kiểm tra máy sưởi",id:"Periksa pemanas"},
  adv_temp_swing:{ko:"수온 급변 — 환수량·외기 유입 점검",en:"Temperature swing — check exchange volume and outside air",vi:"Nhiệt độ biến động — kiểm tra lượng thay nước và khí trời",id:"Suhu berayun — periksa volume ganti air dan udara luar"},
  adv_salinity_critical:{ko:"환수 중단 · 원수 염도 확인",en:"Stop water exchange · check source salinity",vi:"Ngừng thay nước · kiểm tra độ mặn nguồn",id:"Hentikan ganti air · periksa salinitas sumber"},
  adv_salinity_shift:{ko:"염도 급변 — 환수량·원수 점검",en:"Salinity shift — check exchange volume and source",vi:"Độ mặn biến động — kiểm tra lượng thay nước và nguồn",id:"Salinitas bergeser — periksa volume ganti air dan sumber"},
  // ── 탄소 MRV 전력 수기 입력 ───────────────────────────────────────────────
  // 이 화면도 4언어 전부 있어야 한다. 하나만 빠져도 그 언어에서는 키 이름이
  // 그대로 노출돼 화면이 깨진 것처럼 보인다.
  menu_mrv:{ko:"MRV 연결",en:"MRV link",vi:"Kết nối MRV",id:"Koneksi MRV"},
  menu_mrv_sub:{ko:"탄소 MRV 전력 입력 연결",en:"Link for carbon MRV power entry",vi:"Kết nối nhập điện MRV",id:"Koneksi input daya MRV"},
  mrv_title:{ko:"MRV 연결",en:"MRV link",vi:"Kết nối MRV",id:"Koneksi MRV"},
  mrv_status:{ko:"연결 상태",en:"Status",vi:"Trạng thái",id:"Status"},
  mrv_site:{ko:"사이트",en:"Site",vi:"Cơ sở",id:"Lokasi"},
  mrv_hint:{ko:"전력(kWh)은 사람이 계량기를 읽어 넣습니다. 연결하면 이 화면에서 바로 넣을 수 있습니다.",en:"Power (kWh) is read off the meter by hand. Once linked, you can enter it right here.",vi:"Điện (kWh) do người đọc từ đồng hồ. Sau khi kết nối, có thể nhập ngay tại đây.",id:"Daya (kWh) dibaca dari meter oleh orang. Setelah tertaut, bisa diinput langsung di sini."},
  mrv_get_code:{ko:"코드 받기",en:"Get a code",vi:"Lấy mã",id:"Ambil kode"},
  mrv_unlink:{ko:"연결 해제",en:"Unlink",vi:"Ngắt kết nối",id:"Putuskan"},
  mrv_unlink_ask:{ko:"MRV 연결을 끊습니다.<br>보관해 둔 전력 입력은 지우지 않고, 다시 연결하면 그대로 올라갑니다.",en:"This unlinks MRV.<br>Held power entries are kept and uploaded once linked again.",vi:"Ngắt kết nối MRV.<br>Các số liệu điện đang lưu vẫn được giữ và sẽ tải lên khi kết nối lại.",id:"Memutus koneksi MRV.<br>Input daya yang tersimpan tetap ada dan diunggah saat tertaut kembali."},
  mrv_unlink_yes:{ko:"네, 연결 해제",en:"Yes, unlink",vi:"Vâng, ngắt",id:"Ya, putuskan"},
  mrv_pair_title:{ko:"현장 장비를 연결해 주세요",en:"Link this field device",vi:"Vui lòng kết nối thiết bị hiện trường",id:"Hubungkan perangkat lapangan ini"},
  mrv_pair_desc:{ko:"Shrimp365 웹에 로그인한 뒤 아래 코드를 입력하세요",en:"Log in to Shrimp365 on the web and enter the code below",vi:"Đăng nhập Shrimp365 trên web rồi nhập mã bên dưới",id:"Masuk ke Shrimp365 di web lalu masukkan kode di bawah"},
  mrv_step1:{ko:"<b>{url}</b> 접속 → 로그인",en:"Open <b>{url}</b> → log in",vi:"Mở <b>{url}</b> → đăng nhập",id:"Buka <b>{url}</b> → masuk"},
  mrv_step2:{ko:"탄소 MRV → 설정",en:"Carbon MRV → Settings",vi:"MRV carbon → Cài đặt",id:"MRV karbon → Pengaturan"},
  mrv_step3:{ko:"「현장 장비 연결」 카드 열기",en:"Open the “Field device link” card",vi:"Mở thẻ “Kết nối thiết bị hiện trường”",id:"Buka kartu “Koneksi perangkat lapangan”"},
  mrv_step4:{ko:"위 6자리 코드 입력",en:"Enter the 6-digit code above",vi:"Nhập mã 6 số ở trên",id:"Masukkan kode 6 digit di atas"},
  mrv_getting:{ko:"연결 코드를 받는 중…",en:"Getting a pairing code…",vi:"Đang lấy mã kết nối…",id:"Mengambil kode…"},
  mrv_pair_fail:{ko:"연결 코드를 받지 못했습니다",en:"Couldn't get a pairing code",vi:"Không lấy được mã kết nối",id:"Gagal mendapatkan kode"},
  // ── 이 장비가 읽을 계측기(화면 거르개) ────────────────────────────────────
  // 전력 계측기가 15대인 현장에서 전부 띄우면 한 화면에 5대만 보이고, 키오스크에는
  // 스크롤바가 없어 몇 대가 있는지 어디에도 적히지 않는다. 매일 읽는 1~3대만 띄운다.
  mrv_vis:{ko:"이 장비가 읽을 계측기",en:"Meters this device reads",vi:"Thiết bị đo máy này đọc",id:"Meter yang dibaca perangkat ini"},
  mrv_vis_all:{ko:"전부 표시 — {n}대",en:"Showing all — {n}",vi:"Hiện tất cả — {n}",id:"Tampil semua — {n}"},
  mrv_vis_some:{ko:"{total}대 중 {n}대 표시",en:"Showing {n} of {total}",vi:"Hiện {n}/{total}",id:"Tampil {n} dari {total}"},
  mrv_vis_open:{ko:"고르기",en:"Choose",vi:"Chọn",id:"Pilih"},
  mrv_vis_hint:{ko:"매일 사람이 읽는 1~3대만 켜 두세요. 나머지 기기는 웹에서 CSV 로 월 1회 올립니다.",en:"Leave on only the 1–3 meters someone reads every day. Upload the rest once a month by CSV on the web.",vi:"Chỉ bật 1–3 thiết bị đo mà người đọc hằng ngày. Các máy còn lại tải lên bằng CSV mỗi tháng một lần trên web.",id:"Aktifkan hanya 1–3 meter yang dibaca orang setiap hari. Sisanya diunggah lewat CSV sekali sebulan di web."},
  mrv_vis_why:{ko:"EI 계산에는 기기별 계측기가 필요하지 않습니다. 등록이 늘수록 기준선 잠금에 필요한 입력 횟수(계측기·일당 0.8건)를 맞추기 어려워집니다 — 15대면 7일에 84건입니다.",en:"The EI formula does not need per-equipment meters. The more meters registered, the harder the baseline lock's entry rate (0.8 per meter-day) gets — 15 meters means 84 entries in 7 days.",vi:"Công thức EI không cần thiết bị đo riêng cho từng máy. Càng đăng ký nhiều, càng khó đạt mật độ nhập của khoá đường cơ sở (0,8 lần/thiết bị/ngày) — 15 thiết bị là 84 lần trong 7 ngày.",id:"Rumus EI tidak memerlukan meter per peralatan. Makin banyak meter terdaftar, makin sulit memenuhi laju input kunci baseline (0,8 per meter per hari) — 15 meter berarti 84 input dalam 7 hari."},
  mrv_vis_none:{ko:"아무것도 고르지 않으면 전부 보입니다.",en:"With nothing chosen, every meter is shown.",vi:"Nếu không chọn gì, tất cả đều hiện.",id:"Jika tidak ada yang dipilih, semua meter ditampilkan."},
  mrv_vis_filter_note:{ko:"이것은 <b>이 장비 화면의 거르개</b>일 뿐입니다. 서버가 받는 값은 달라지지 않습니다.",en:"This filters <b>this device's screen</b> only. What the server accepts does not change.",vi:"Đây chỉ là bộ lọc cho <b>màn hình của thiết bị này</b>. Những gì máy chủ nhận không thay đổi.",id:"Ini hanya menyaring <b>layar perangkat ini</b>. Apa yang diterima server tidak berubah."},
  mrv_vis_saved:{ko:"저장했습니다. 전력 화면에 바로 적용됩니다.",en:"Saved. It applies to the power screen right away.",vi:"Đã lưu. Áp dụng ngay cho màn hình nhập điện.",id:"Tersimpan. Langsung berlaku di layar input daya."},
  mrv_vis_gone:{ko:"고른 계측기 {n}대가 서버 목록에 없습니다",en:"{n} chosen meter(s) are not in the server list",vi:"{n} thiết bị đo đã chọn không có trong danh sách máy chủ",id:"{n} meter pilihan tidak ada di daftar server"},
  mrv_vis_gone_sub:{ko:"웹에서 지워졌을 수 있습니다. [설정] → [MRV 연결] → [이 장비가 읽을 계측기] 에서 다시 고르세요.",en:"They may have been deleted on the web. Choose again in Settings → MRV link → Meters this device reads.",vi:"Có thể đã bị xoá trên web. Hãy chọn lại ở Cài đặt → Kết nối MRV → Thiết bị đo máy này đọc.",id:"Mungkin sudah dihapus di web. Pilih ulang di Pengaturan → Koneksi MRV → Meter yang dibaca perangkat ini."},
  pw_btn:{ko:"전력 입력",en:"Power entry",vi:"Nhập điện",id:"Input daya"},
  pw_title:{ko:"전력 수기 입력",en:"Manual power entry",vi:"Nhập điện thủ công",id:"Input daya manual"},
  pw_pick:{ko:"계측기를 고르세요",en:"Choose a meter",vi:"Chọn thiết bị đo",id:"Pilih meter"},
  pw_aeration:{ko:"폭기",en:"Aeration",vi:"Sục khí",id:"Aerasi"},
  pw_none:{ko:"웹 설정에서 전력 계측기를 먼저 등록하세요",en:"Register a power meter in the web settings first",vi:"Hãy đăng ký thiết bị đo điện trong cài đặt web trước",id:"Daftarkan meter listrik di pengaturan web terlebih dahulu"},
  pw_count:{ko:"{n}대",en:"{n} meters",vi:"{n} thiết bị",id:"{n} meter"},
  pw_show_all:{ko:"전체 보기",en:"Show all",vi:"Xem tất cả",id:"Tampilkan semua"},
  pw_show_picked:{ko:"고른 것만",en:"Chosen only",vi:"Chỉ mục đã chọn",id:"Hanya pilihan"},
  pw_show_all_note:{ko:"[전체 보기] 는 이 화면에서만 적용됩니다 — 설정은 바뀌지 않습니다.",en:"“Show all” applies to this screen only — the setting is unchanged.",vi:"“Xem tất cả” chỉ áp dụng cho màn hình này — cài đặt không đổi.",id:"“Tampilkan semua” hanya untuk layar ini — pengaturan tidak berubah."},
  pw_reload:{ko:"목록 다시 받기",en:"Reload list",vi:"Tải lại danh sách",id:"Muat ulang daftar"},
  pw_meter:{ko:"계측기",en:"Meter",vi:"Thiết bị đo",id:"Meter"},
  pw_kind:{ko:"입력 종류",en:"Entry type",vi:"Loại nhập",id:"Jenis input"},
  pw_value:{ko:"값",en:"Value",vi:"Giá trị",id:"Nilai"},
  pw_kind_cum:{ko:"계량기 지침",en:"Meter reading",vi:"Chỉ số đồng hồ",id:"Angka meter"},
  pw_kind_cum_sub:{ko:"계량기에 찍힌 누적 숫자",en:"The cumulative number on the meter",vi:"Số luỹ kế trên đồng hồ",id:"Angka kumulatif pada meter"},
  pw_kind_int:{ko:"구간 사용량",en:"Interval usage",vi:"Lượng dùng trong kỳ",id:"Pemakaian periode"},
  pw_kind_int_sub:{ko:"그 구간에 쓴 양",en:"Energy used in that span",vi:"Lượng điện dùng trong khoảng đó",id:"Energi yang dipakai pada rentang itu"},
  pw_delta_note:{ko:"지침은 <b>직전 지침과의 차이</b>로 사용량이 됩니다. 장비가 직전 지침을 함께 보냅니다.",en:"A reading becomes usage as the <b>difference from the previous reading</b>. The device sends the previous one along.",vi:"Chỉ số trở thành lượng dùng bằng <b>hiệu với chỉ số trước</b>. Thiết bị gửi kèm chỉ số trước đó.",id:"Angka meter menjadi pemakaian sebagai <b>selisih dari angka sebelumnya</b>. Perangkat mengirimkannya sekalian."},
  pw_first_note:{ko:"첫 지침은 기준점으로만 쓰이고 사용량은 다음 입력부터 계산됩니다",en:"The first reading is only a reference point — usage is calculated from the next entry on",vi:"Chỉ số đầu tiên chỉ là điểm mốc — lượng dùng được tính từ lần nhập sau",id:"Angka pertama hanya titik acuan — pemakaian dihitung dari input berikutnya"},
  pw_zero_hint:{ko:"0 도 넣을 수 있습니다(돌리지 않은 구간). 음수는 받지 않습니다.",en:"0 is allowed (a span you did not run). Negative values are not.",vi:"Có thể nhập 0 (khoảng không chạy). Không nhận số âm.",id:"0 boleh (periode tanpa operasi). Nilai negatif tidak diterima."},
  pw_empty:{ko:"값을 넣으세요",en:"Enter a value",vi:"Hãy nhập giá trị",id:"Masukkan nilai"},
  pw_check:{ko:"입력값 확인",en:"Check the value",vi:"Kiểm tra giá trị",id:"Periksa nilai"},
  pw_send:{ko:"전송",en:"Send",vi:"Gửi",id:"Kirim"},
  pw_send_now:{ko:"보내기",en:"Send it",vi:"Gửi đi",id:"Kirim"},
  pw_fix:{ko:"고치기",en:"Edit",vi:"Sửa",id:"Ubah"},
  pw_sending:{ko:"보내는 중…",en:"Sending…",vi:"Đang gửi…",id:"Mengirim…"},
  pw_sent:{ko:"전송했습니다",en:"Sent",vi:"Đã gửi",id:"Terkirim"},
  pw_heldt:{ko:"보관했습니다",en:"Held on the device",vi:"Đã lưu trên thiết bị",id:"Disimpan di perangkat"},
  pw_failed:{ko:"보내지 못했습니다",en:"Couldn't send",vi:"Không gửi được",id:"Gagal mengirim"},
  pw_more:{ko:"계속 입력",en:"Enter another",vi:"Nhập tiếp",id:"Input lagi"},
  pw_pending:{ko:"미전송 {n}건",en:"{n} not sent",vi:"{n} chưa gửi",id:"{n} belum terkirim"},
  pw_pending_note:{ko:"회선이 돌아오면 넣은 순서대로 올라갑니다",en:"They upload in the order entered once the line is back",vi:"Sẽ tải lên theo đúng thứ tự khi có mạng lại",id:"Akan terunggah sesuai urutan saat koneksi kembali"},
  pw_clock_bad:{ko:"장비 시계가 맞지 않아 보내지 않습니다 — 시각 확인 필요",en:"The device clock is wrong — not sending until the time is checked",vi:"Đồng hồ thiết bị sai — chưa gửi, cần kiểm tra thời gian",id:"Jam perangkat salah — tidak dikirim, periksa waktu"},
  pw_clock_bad_chip:{ko:"시계 확인 필요",en:"Clock wrong",vi:"Đồng hồ sai",id:"Jam salah"},
  pw_clock_bad_sub:{ko:"정전 뒤 인터넷 없이 재부팅하면 시계가 틀어집니다. 틀린 시각의 전력은 기준선 기간을 오염시키므로 보내지 않습니다.",en:"Rebooting after a power cut with no internet leaves the clock wrong. Power stamped with a wrong time would contaminate the baseline period, so it is not sent.",vi:"Khởi động lại sau mất điện mà không có internet làm đồng hồ sai. Điện ghi sai thời gian sẽ làm nhiễm kỳ đường cơ sở, nên không gửi.",id:"Reboot setelah listrik mati tanpa internet membuat jam salah. Daya dengan waktu salah akan mencemari periode baseline, jadi tidak dikirim."},
  pw_countable:{ko:"사용량으로 산입됩니다",en:"Counted as usage",vi:"Được tính vào lượng dùng",id:"Dihitung sebagai pemakaian"},
  pw_suspect:{ko:"이 건은 KPI 산입에서 빠집니다 — 구간 사용량을 낼 수 없었습니다",en:"This entry is left out of the KPIs — interval usage could not be derived",vi:"Mục này bị loại khỏi KPI — không tính được lượng dùng trong kỳ",id:"Entri ini tidak masuk KPI — pemakaian periode tak bisa dihitung"},
  pw_dedup:{ko:"직전 지침 {n}건은 중복으로 흡수되었습니다",en:"{n} previous reading(s) were absorbed as duplicates",vi:"{n} chỉ số trước đã được hợp nhất vì trùng",id:"{n} angka sebelumnya diserap sebagai duplikat"},
  pw_accepted:{ko:"저장 {n}건",en:"{n} stored",vi:"Đã lưu {n}",id:"{n} tersimpan"},
  pw_rejected:{ko:"거부 {n}건",en:"{n} rejected",vi:"{n} bị từ chối",id:"{n} ditolak"},
  pw_err_nan:{ko:"숫자가 아닙니다",en:"Not a number",vi:"Không phải số",id:"Bukan angka"},
  pw_err_negative:{ko:"전력은 음수가 될 수 없습니다",en:"Power cannot be negative",vi:"Điện không thể là số âm",id:"Daya tidak bisa negatif"},
  pw_err_clock:{ko:"장비 시계가 맞지 않아 보내지 않았습니다",en:"Not sent — the device clock is wrong",vi:"Chưa gửi — đồng hồ thiết bị sai",id:"Tidak dikirim — jam perangkat salah"},
  pw_err_unlinked:{ko:"MRV 에 연결되지 않았습니다",en:"Not linked to MRV",vi:"Chưa kết nối MRV",id:"Belum tertaut ke MRV"},
  pw_err_offline:{ko:"서버에 닿지 못했습니다",en:"Couldn't reach the server",vi:"Không tới được máy chủ",id:"Tak bisa menjangkau server"},
  pw_err_backlog:{ko:"먼저 보관된 입력이 올라간 뒤에 보냅니다 — 순서를 지켜야 지침의 차이가 맞습니다",en:"Held until earlier entries upload — the order must hold for readings to differ correctly",vi:"Giữ lại đến khi các mục trước được tải lên — phải đúng thứ tự để hiệu số chỉ đúng",id:"Ditahan sampai input sebelumnya terunggah — urutan harus benar agar selisih tepat"},
  pw_err_no_meters:{ko:"계측기 목록을 먼저 받아 주세요",en:"Load the meter list first",vi:"Hãy tải danh sách thiết bị đo trước",id:"Muat daftar meter dulu"},
  pw_err_unknown_meter:{ko:"목록에 없는 계측기입니다",en:"That meter is not in the list",vi:"Thiết bị đo không có trong danh sách",id:"Meter itu tidak ada di daftar"},
  pw_err_vis_payload:{ko:"보낸 값이 계측기 목록이 아닙니다",en:"That is not a meter list",vi:"Giá trị gửi lên không phải danh sách thiết bị đo",id:"Nilai yang dikirim bukan daftar meter"},
  pw_err_vis_max:{ko:"한 번에 {max}대까지만 고를 수 있습니다",en:"You can choose up to {max} meters",vi:"Chỉ có thể chọn tối đa {max} thiết bị đo",id:"Hanya bisa memilih maksimal {max} meter"},
  pw_err_kind:{ko:"알 수 없는 입력 종류입니다",en:"Unknown entry type",vi:"Loại nhập không xác định",id:"Jenis input tak dikenal"},
  // 200 을 받았어도 서버가 아무것도 저장하지 않은 경우. 초록 「전송했습니다」로
  // 적으면 사람은 들어가지 않은 값을 들어갔다고 믿는다.
  pw_err_refused:{ko:"서버가 받지 않았습니다",en:"The server did not accept it",vi:"Máy chủ không nhận",id:"Server tidak menerimanya"},
  // 재전송에서 거부가 확정된 보관 건. 지우는 것은 사람이 결정한다.
  pw_blocked:{ko:"서버가 받지 않은 보관 {n}건 — 전송이 멈췄습니다",en:"{n} held entr(ies) the server refused — uploading is stopped",vi:"{n} mục đang lưu bị máy chủ từ chối — việc tải lên đã dừng",id:"{n} input tersimpan ditolak server — pengunggahan terhenti"},
  pw_blocked_note:{ko:"계측기가 지워졌거나 다른 사이트로 다시 연결한 뒤라면 이 건들은 다시 보내도 들어가지 않고, 뒤의 입력까지 막습니다. 값을 따로 적어 두신 뒤 치우세요.",en:"If the meter was deleted or this device was re-linked to another site, these can never be accepted and they block the entries behind them. Write the values down, then clear them.",vi:"Nếu thiết bị đo đã bị xoá hoặc thiết bị này được kết nối lại sang cơ sở khác, các mục này sẽ không bao giờ được nhận và còn chặn các mục sau. Hãy ghi lại giá trị rồi xoá.",id:"Jika meter sudah dihapus atau perangkat ini ditautkan ke lokasi lain, input ini tak akan pernah diterima dan menghambat input berikutnya. Catat nilainya lalu bersihkan."},
  pw_blocked_clear:{ko:"거부된 {n}건 치우기",en:"Clear the {n} refused",vi:"Xoá {n} mục bị từ chối",id:"Bersihkan {n} yang ditolak"},
  pw_blocked_ask:{ko:"서버가 받지 않은 보관 {n}건을 장비에서 지웁니다.<br>이 값은 되돌릴 수 없습니다 — 필요하면 먼저 적어 두세요.",en:"This deletes the {n} refused entries from the device.<br>They cannot be recovered — write them down first if you need them.",vi:"Thao tác này xoá {n} mục bị từ chối khỏi thiết bị.<br>Không thể phục hồi — hãy ghi lại trước nếu cần.",id:"Ini menghapus {n} input yang ditolak dari perangkat.<br>Tidak bisa dipulihkan — catat dulu bila perlu."},
  pw_blocked_yes:{ko:"네, 치우기",en:"Yes, clear them",vi:"Vâng, xoá",id:"Ya, bersihkan"},
  pw_blocked_done:{ko:"치웠습니다 — 남은 보관분부터 다시 올립니다",en:"Cleared — the remaining held entries upload next",vi:"Đã xoá — các mục còn lại sẽ được tải lên",id:"Sudah dibersihkan — input tersisa akan diunggah"},
  // ── 운전 모드 ─────────────────────────────────────────────────────────────
  menu_mode:{ko:"운전 모드",en:"Operating mode",vi:"Chế độ vận hành",id:"Mode operasi"},
  menu_mode_sub:{ko:"양식장 · 스마트팜 · 탄소 MRV",en:"Aquaculture · Smart farm · Carbon MRV",vi:"Nuôi tôm · Nông trại thông minh · MRV carbon",id:"Budidaya · Smart farm · MRV karbon"},
  mode_title:{ko:"운전 모드",en:"Operating mode",vi:"Chế độ vận hành",id:"Mode operasi"},
  mode_hint:{ko:"이 장비가 무엇을 하는 기계인지 고르세요. 한 번에 하나만 고를 수 있습니다.",en:"Choose what this device is for. Only one at a time.",vi:"Chọn thiết bị này dùng để làm gì. Mỗi lần chỉ một chế độ.",id:"Pilih fungsi perangkat ini. Hanya satu sekaligus."},
  mode_aquaculture:{ko:"양식장",en:"Aquaculture",vi:"Nuôi tôm",id:"Budidaya"},
  mode_aquaculture_sub:{ko:"수질 측정이 본업 · 기본 화면은 수온·pH·용존산소·염도",en:"Water quality first · dashboard shows temp, pH, DO, salinity",vi:"Ưu tiên chất lượng nước · hiển thị nhiệt độ, pH, DO, độ mặn",id:"Utamakan kualitas air · tampilkan suhu, pH, DO, salinitas"},
  mode_smartfarm:{ko:"스마트팜",en:"Smart farm",vi:"Nông trại thông minh",id:"Smart farm"},
  mode_smartfarm_sub:{ko:"수경재배 · EC 로 양액 농도를 보고 보충량을 띄웁니다",en:"Hydroponics · shows nutrient dosing from EC",vi:"Thuỷ canh · hiện lượng bổ sung dinh dưỡng theo EC",id:"Hidroponik · tampilkan dosis nutrisi dari EC"},
  mode_mrv:{ko:"탄소 MRV",en:"Carbon MRV",vi:"MRV carbon",id:"MRV karbon"},
  mode_mrv_sub:{ko:"기계실 전력 입력 단말 · 기본 화면이 전력 입력이 됩니다",en:"Power entry terminal · the dashboard becomes power entry",vi:"Thiết bị nhập điện · màn hình chính thành nhập điện",id:"Terminal input daya · dasbor menjadi input daya"},
  mode_water_note:{ko:"수질 수집과 전송은 모드와 무관하게 계속됩니다. 모드가 바꾸는 것은 화면입니다.",en:"Water readings keep being collected and uploaded in every mode. The mode changes the screen, not the collection.",vi:"Dữ liệu nước vẫn được thu và tải lên ở mọi chế độ. Chế độ chỉ đổi màn hình.",id:"Data air tetap dikumpulkan dan diunggah di semua mode. Mode hanya mengubah tampilan."},
  mode_mrv_note:{ko:"MRV 모드에서는 양액 안내와 설비 운전 권고를 끕니다. 수질 칸은 센서를 켜 두었을 때만 보입니다.",en:"In MRV mode nutrient dosing and equipment advice are off. Water tiles appear only if sensors are enabled.",vi:"Ở chế độ MRV, dinh dưỡng và khuyến nghị vận hành tắt. Ô nước chỉ hiện khi cảm biến được bật.",id:"Pada mode MRV, dosis nutrisi dan rekomendasi operasi dimatikan. Kotak air muncul hanya bila sensor aktif."},
  mode_fail:{ko:"모드를 바꾸지 못했습니다.",en:"Couldn't change the mode.",vi:"Không đổi được chế độ.",id:"Gagal mengubah mode."},
  // MRV 기본 화면
  mrv_home_last:{ko:"마지막 지침",en:"Last readings",vi:"Chỉ số gần nhất",id:"Angka terakhir"},
  mrv_home_none:{ko:"아직 보낸 지침이 없습니다",en:"No readings sent yet",vi:"Chưa gửi chỉ số nào",id:"Belum ada angka terkirim"},
  mrv_home_today:{ko:"오늘 {n}건 보냄",en:"{n} sent today",vi:"Hôm nay đã gửi {n}",id:"{n} terkirim hari ini"},
  mrv_home_link:{ko:"먼저 MRV 에 연결하세요",en:"Link to MRV first",vi:"Hãy kết nối MRV trước",id:"Tautkan ke MRV dulu"}
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
// (MRV 모드에서는 격자만 떼어 쓰므로 renderGrid 로 나눠 두었다.)
function renderValues(d){
  return renderGrid(d) + renderAdvice(d) + renderNutrient(d);
}

function renderGrid(d){
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
  return '<div class="grid">' + cells + '</div>';
}

// 설비 운전 권고 — "지금 무엇을 돌릴까" 한 줄.
//
// 값과 색만으로는 새벽 세 시에 한 번 더 생각해야 한다. 장비가 대신 답한다.
// **두 줄까지만** 띄운다. 800×480 에 더 넣으면 값 격자가 눌리고, 급한 것과
// 덜 급한 것이 같은 무게로 보여 결국 아무것도 읽히지 않는다.
function renderAdvice(d){
  var list = (d && d.advice) || [];
  if (!list.length) return "";
  var top = list.slice(0, 2);
  var rows = top.map(function(a){
    var val = (typeof a.value === "number")
      ? '<span class="why">' + a.value.toFixed(a.digits || 1) + '</span>' : "";
    return '<div class="row ' + esc(a.level) + '">' +
           '<span class="act">' + t("adv_" + a.code) + '</span>' + val + '</div>';
  }).join("");
  // 테두리 색은 가장 급한 것을 따른다 — 목록은 이미 급한 순이다.
  return '<div class="adv ' + esc(top[0].level) + '">' +
         '<div class="head">' + t("adv_head") + '</div>' + rows + '</div>';
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
  if (has && why0) {
    var w = String(why0);
    if (w.indexOf("temp_off:") === 0) {
      var tp = w.slice(9).split("/");
      return '<div class="sub2 bad">' + t("sen_temp_off") +
             '<div class="dim">' + t("sen_temp_off_sub")
               .replace("{{a}}", esc(tp[0])).replace("{{b}}", esc(tp[1] || "?")) + '</div></div>';
    }
    if (w.indexOf("do_air:") === 0) {
      return '<div class="sub2 bad">' + t("sen_do_air") +
             '<div class="dim">' + t("sen_do_air_sub").replace("{{p}}", esc(w.slice(7))) + '</div></div>';
    }
    if (w.indexOf("do_scale:") === 0) {
      var parts = w.slice(9).split("/");
      return '<div class="sub2 bad">' + t("sen_do_scale") +
             '<div class="dim">' + t("sen_do_scale_sub")
               .replace("{{p}}", esc(parts[0])).replace("{{r}}", esc(parts[1] || "?")) + '</div></div>';
    }
    if (w.indexOf("supersat:") === 0) {
      return '<div class="sub2 bad">' + t("sen_supersat") +
             '<div class="dim">' + t("sen_supersat_sub").replace("{{p}}", esc(w.slice(9))) + '</div></div>';
    }
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
  // 전력 입력은 독립 경로다. 수질이 잘 올라가는 중에도 전력만 밀려 있을 수 있어
  // 따로 센다. 시계가 수상하면 전력을 아예 보내지 않으므로 그것부터 알린다.
  // 헤더 칩은 **짧은 말**로 적는다. 같은 내용을 바로 아래 띠가 온전한 문장으로 말하고
  // 있고, 긴 문장을 칩에 넣으면 헤더가 800px 을 넘어 「연결됨」 칩이 잘린다.
  if (d.mrv_clock_ok === false) hold += '<span class="chip off">' + t("pw_clock_bad_chip") + '</span>';
  else if (d.mrv_blocked) hold += '<span class="chip off">' +
    t("pw_rejected", {n: d.mrv_blocked}) + '</span>';
  else if (d.mrv_pending) hold += '<span class="chip hold">' +
    t("pw_btn") + ' ' + t("pw_pending", {n:d.mrv_pending}) + '</span>';
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

// 첫 /api/state 가 오기 전에도 기본 화면을 맞게 그리기 위한 모드. 서버가 새겨 준다.
var lastState = {mode: "__MODE__"};

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
  if (!chartKey) document.getElementById("main").innerHTML = renderMain(d);
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
  mrvOpen = false;
  if (mrvTimer) { clearTimeout(mrvTimer); mrvTimer = null; }
  setupData = null;
  document.getElementById("setup").innerHTML = "";
  document.getElementById("wifi").innerHTML = "";
  tick();
}

function drawSettingsMenu(){
  document.getElementById("wifi").innerHTML = "";
  // 모드가 항목을 가른다. 세 모드는 상호 배타이므로, 지금 모드에서 쓰지 않는
  // 항목은 아예 두지 않는다 — 열어서 고쳐도 아무 일이 없는 화면이 가장 나쁘다.
  var mode = (lastState && lastState.mode) || "aquaculture";
  var items = [
    {t:"menu_mode",    sub:"menu_mode_sub",    fn:"openMode()"},
    {t:"menu_sensors", sub:"menu_sensors_sub", fn:"openSensors()"},
    {t:"menu_wifi",    sub:"menu_wifi_sub",    fn:"openWifi()"},
    {t:"menu_lang",    sub:"menu_lang_sub",    fn:"openLang()"},
    {t:"menu_cal",      sub:"menu_cal_sub",      fn:"openCal()"}
  ];
  // 양액 설정은 MRV 단말에 둘 이유가 없다. 양식장 모드에서는 남겨 둔다 —
  // [양액 관리 사용] 을 켜는 것이 스마트팜으로 넘어가는 길이기도 하다.
  if (mode !== "mrv") items.push({t:"menu_nutrient", sub:"menu_nutrient_sub", fn:"openNutrient()"});
  // MRV 페어링은 그 모드의 주요 항목이다. 다른 모드에서 연결해 두어도 전력 입력
  // 창구가 열리지 않으므로(모드가 가른다) 그 모드에서만 보여 준다.
  if (mode === "mrv") items.push({t:"menu_mrv", sub:"menu_mrv_sub", fn:"openMrv()"});
  items.push({t:"menu_restart", sub:"menu_restart_sub", fn:"openRestart()"});
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

// ── 보정 설정 ────────────────────────────────────────────────────────────────
// 사람이 오프셋을 계산하게 하지 않는다. 휴대용 측정기로 잰 값을 넣으면
// 장비가 지금 센서값과의 차이를 구해 저장한다.
var calData = null, calMsg = null, calEdit = null, calBuf = "";

var CAL_ITEMS = [
  {k:"temperature",  t:"m_temperature", unit:"\u00B0C"},
  {k:"ph",           t:"m_ph_label",    unit:""},
  {k:"do_level",     t:"m_do",          unit:"ppm"},
  {k:"conductivity", t:"n_ec_only",     unit:"uS/cm"}
];

function openCal(){
  calMsg = null; calEdit = null;
  fetch("/api/calibration", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ calData = d; drawCal(); })
    .catch(function(){ alert(t("load_fail")); });
}

function fmt(v){ return (v === null || v === undefined) ? "--" : v; }

function drawCal(){
  if (!calData) return;
  document.getElementById("wifi").innerHTML = "";
  var body;

  if (calEdit){
    var it = CAL_ITEMS.filter(function(x){ return x.k === calEdit; })[0];
    var keys = ["1","2","3","4","5","6","7","8","9",".","0","back"];
    var pad = keys.map(function(k){
      return '<button onclick="calKey(&quot;' + k + '&quot;)">' + (k === "back" ? "\u232B" : k) + '</button>';
    });
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="krow">' + pad.slice(i*3, i*3+3).join("") + '</div>';
    body =
      '<div class="wcur">' + t(it.t) + ' — ' + t("cal_ask") + '<br>' +
        '<span class="sub">' + t("cal_now") + ' ' + fmt(calData.raw[it.k]) + ' ' + it.unit + '</span><br>' +
        '<b style="font-size:24px;font-family:ui-monospace,monospace">' + (calBuf || "0") + '</b> ' + it.unit +
      '</div>' +
      '<div class="kbd" style="max-width:330px">' + rows +
        '<div class="krow">' +
          '<button class="wide" onclick="calCancel()">' + t("cancel") + '</button>' +
          '<button class="go" onclick="calApply()">' + t("save") + '</button>' +
        '</div></div>';
  } else {
    var msg = calMsg ? '<div class="msg ' + calMsg.kind + '">' + esc(calMsg.text) + '</div>' : "";
    var list = CAL_ITEMS.map(function(it){
      var raw = calData.raw[it.k], off = calData.offsets[it.k] || 0, cor = calData.corrected[it.k];
      var offTxt = off ? (off > 0 ? "+" + off : String(off)) : "0";
      return '<div class="srow">' +
        '<div class="sname">' + t(it.t) +
          '<div class="sub">' + t("cal_now") + ' ' + fmt(raw) + ' ' + it.unit +
            (off ? '  \u2192  ' + t("cal_result") + ' <b>' + fmt(cor) + '</b>' : '') +
          '</div></div>' +
        '<div class="num" style="width:auto;padding:0 10px">' + offTxt + '</div>' +
        '<button class="toggle" onclick="calOpen(&quot;' + it.k + '&quot;)">' + t("cal_set") + '</button>' +
        (off ? '<button class="toggle" onclick="calClear(&quot;' + it.k + '&quot;)">' + t("cal_reset") + '</button>' : '') +
      '</div>';
    }).join("");
    body = msg + list + '<div class="msg err" style="margin-top:8px">' + t("cal_note") + '</div>';
  }

  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("menu_cal") + '</span>' +
        '<button style="margin-left:auto" onclick="' +
          (calEdit ? "calCancel()" : "drawSettingsMenu()") + '">' +
          (calEdit ? t("back_list") : t("back_menu")) + '</button>' +
      '</div>' +
      '<div class="sbody">' + body + '</div>' +
    '</div>';
}

function calOpen(k){
  if (calData.raw[k] === null || calData.raw[k] === undefined){
    calMsg = {kind:"err", text:t("cal_none")}; drawCal(); return;
  }
  calEdit = k; calBuf = String(calData.raw[k]); drawCal();
}
function calCancel(){ calEdit = null; calBuf = ""; drawCal(); }
function calKey(k){
  if (k === "back") calBuf = calBuf.slice(0, -1);
  else if (k === "."){ if (calBuf.indexOf(".") < 0) calBuf += "."; }
  else calBuf = (calBuf === "0" ? "" : calBuf) + k;
  if (calBuf.length > 9) calBuf = calBuf.slice(0, 9);
  drawCal();
}
function calApply(){ calSend({name: calEdit, actual: parseFloat(calBuf || "0")}); }
function calClear(k){ calSend({name: k, offset: 0}); }

function calSend(payload){
  fetch("/api/calibration/save", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      calEdit = null; calBuf = "";
      calMsg = d && d.ok ? {kind:"ok", text:t("cal_saved")}
                         : {kind:"err", text:(d && d.error) || t("save_fail")};
      openCalRefresh();
    })
    .catch(function(){ calMsg = {kind:"err", text:t("save_fail")}; drawCal(); });
}

function openCalRefresh(){
  fetch("/api/calibration", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ calData = d; drawCal(); })
    .catch(function(){ drawCal(); });
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

// ── MRV 모드 기본 화면 ───────────────────────────────────────────────────────
// 이 모드에서는 **기본 화면이 전력 입력 단말**이다. 기계실 계량기 옆에 놓이는
// 장비라 RS-485 수질 센서가 아예 없을 수 있어, 수온·pH 칸을 '--' 로 채워 두면
// 보여 줄 것이 없는 화면이 기본이 된다. 그래서 센서를 켜 둔 장비에서만 값 격자를
// 함께 띄우고, 아래에 마지막 지침·오늘 보낸 건수·미전송 건수와 큰 버튼을 둔다.
function fmtKwh(v){
  try { return Number(v).toLocaleString(undefined, {maximumFractionDigits:1}); }
  catch(e){ return String(v); }
}

function renderMrvCounts(d){
  return '<div class="mcount">' +
    '<span>' + t("mrv_home_today", {n: d.mrv_today || 0}) + '</span>' +
    '<span' + (d.mrv_pending ? ' class="hold"' : '') + '>' +
      t("pw_pending", {n: d.mrv_pending || 0}) + '</span>' +
    (d.mrv_last ? '<span class="dim">' + esc(d.mrv_last) + '</span>' : '') +
    '</div>';
}

// 연결되지 않았으면 전력 입력 버튼을 띄우지 않는다 — 누르고 나서야 못 쓴다는 것을
// 알게 하지 않고, 바로 연결 화면으로 보낸다.
function renderMrvButton(d){
  if (!d.mrv_linked) {
    return '<button class="mbig ghost" onclick="openMrvSetup()">' +
      t("mrv_home_link") + ' ›</button>';
  }
  return '<button class="mbig" onclick="openPower()">' + t("pw_btn") + '</button>';
}

// 서버가 받지 않아 멈춘 보관분. 치우는 버튼은 전력 입력 패널 한 곳에만 두고(같은
// 판단을 두 곳에 두지 않는다), 기본 화면은 그 사실과 사유만 적는다.
function renderMrvBlocked(d){
  if (!d.mrv_blocked) return "";
  return '<div class="pwarn">' + t("pw_blocked", {n: d.mrv_blocked}) +
    (d.mrv_blocked_reason
      ? '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
          esc(d.mrv_blocked_reason) + '</div>'
      : '') + '</div>';
}

function renderMrvHome(d){
  var warn = ((d.mrv_clock_ok === false)
    ? '<div class="pwarn">' + t("pw_clock_bad") + '</div>' : "") + renderMrvBlocked(d);
  // 센서를 켜 둔 장비에서는 수질 값이 먼저다. 800×480 에 목록까지 넣으면 값 격자가
  // 눌리므로, 그 때는 마지막 지침 목록을 접고 건수와 버튼만 남긴다.
  if (d.sensors_on) {
    return renderGrid(d) + '<div class="mhome" style="flex:0 0 auto;margin-top:9px">' +
      warn + renderMrvCounts(d) + renderMrvButton(d) + '</div>';
  }
  var rows = d.mrv_recent || [];
  var list = rows.length
    ? rows.map(function(r){
        return '<div class="prow" style="cursor:default;margin-bottom:6px">' +
          '<span class="pname">' + esc(r.label) + '</span>' +
          (r.is_aeration ? '<span class="aer">' + t("pw_aeration") + '</span>' : '') +
          '<span class="mval">' + fmtKwh(r.value) + '<small>kWh</small></span>' +
          '<span class="punit">' + esc(r.at || "") + '</span>' +
          '</div>';
      }).join("")
    : '<div class="pnote">' + t("mrv_home_none") + '</div>';
  return '<div class="mhome">' + warn +
    '<div class="mhead">' + t("mrv_home_last") + '</div>' +
    '<div class="plist">' + list + '</div>' +
    renderMrvCounts(d) + renderMrvButton(d) +
    '</div>';
}

// 기본 화면은 모드가 정한다. 수질 수집·전송은 모드와 무관하게 계속되므로,
// 여기서 갈리는 것은 **무엇을 먼저 보여 주는가** 뿐이다.
function renderMain(d){
  return (d.mode === "mrv") ? renderMrvHome(d) : renderValues(d);
}


// ── 운전 모드 설정 ──────────────────────────────────────────────────────────
var modeBusy = false;

function openMode(){ modeBusy = false; drawMode(); }

function drawMode(){
  document.getElementById("wifi").innerHTML = "";
  var cur = (lastState && lastState.mode) || "aquaculture";
  var rows = ["aquaculture", "smartfarm", "mrv"].map(function(m){
    return '<div class="wrow' + (m === cur ? " cur" : "") + '"' +
      ' onclick="setMode(&quot;' + m + '&quot;)">' +
      '<div class="sname">' + t("mode_" + m) +
        '<div class="sub">' + t("mode_" + m + "_sub") + '</div></div>' +
      (m === cur ? '<span class="wlock" style="color:#10B981">✓</span>' : '') +
    '</div>';
  }).join("");
  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("mode_title") + '</span>' +
        '<button style="margin-left:auto" onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' +
        '<div class="sub" style="margin:2px 0 8px">' + t("mode_hint") + '</div>' +
        rows +
        '<div class="pnote" style="margin-top:8px">' + t("mode_water_note") + '<br>' +
          t("mode_mrv_note") + '</div>' +
      '</div>' +
    '</div>';
}

function setMode(m){
  if (modeBusy) return;
  modeBusy = true;
  fetch("/api/mode", {method:"POST", headers:{"Content-Type":"application/json"},
                      body: JSON.stringify({mode:m})})
    .then(function(r){ return r.json(); })
    .then(function(d){
      modeBusy = false;
      if (!d || !d.ok) { alert(t("mode_fail")); return; }
      if (lastState) lastState.mode = m;
      // 메뉴 구성이 모드에 따라 달라지므로(전력·양액 항목) 메뉴로 돌아간다.
      drawSettingsMenu();
    })
    .catch(function(){ modeBusy = false; alert(t("mode_fail")); });
}

// MRV 기본 화면에서 연결 화면으로 바로 들어가는 길. 이 모드의 장비는 연결하지
// 않으면 아무것도 못 하므로, 설정 메뉴를 거치게 하지 않는다.
function openMrvSetup(){ settingsOpen = true; openMrv(); }

// ── MRV 연결 (설정 메뉴) ─────────────────────────────────────────────────────
// 수질 연결과 **따로**다. 한쪽만 연결된 상태가 정상적으로 존재하므로 화면도
// 둘을 섞지 않는다 — 여기서 하는 일은 탄소 MRV 수집 키를 받아 두는 것뿐이다.
var mrvOpen = false, mrvAsk = false, mrvTimer = null;

function openMrv(){ mrvOpen = true; mrvAsk = false; mrvVisOpen = false; drawMrv(); mrvPoll(); }

function mrvBack(){
  mrvOpen = false; mrvVisOpen = false;
  if (mrvTimer) { clearTimeout(mrvTimer); mrvTimer = null; }
  drawSettingsMenu();
}

// 설정 화면이 떠 있는 동안 tick() 은 멈춘다. 페어링은 승인을 기다리는 화면이라
// 스스로 갱신해야 코드가 승인된 순간 화면이 바뀐다.
function mrvPoll(){
  if (!mrvOpen) return;
  fetch("/api/state", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ lastState = d; if (mrvOpen) drawMrv(); })
    .catch(function(){})
    .then(function(){ if (mrvOpen) mrvTimer = setTimeout(mrvPoll, 3000); });
}

function mrvStart(){ mrvAsk = false; fetch("/api/mrv/pair/start", {method:"POST"}).then(drawMrv); }
function mrvCancel(){ fetch("/api/mrv/pair/cancel", {method:"POST"}).then(drawMrv); }
function mrvAskUnlink(){ mrvAsk = true; drawMrv(); }
function mrvAskBack(){ mrvAsk = false; drawMrv(); }
function mrvUnlink(){
  mrvAsk = false;
  fetch("/api/mrv/unlink", {method:"POST"}).then(drawMrv).catch(drawMrv);
}

// ── 이 장비가 읽을 계측기 ────────────────────────────────────────────────────
// 센서 토글 화면(drawSettings)과 **같은 모양**이다 — 작업자가 이미 아는 조작이다.
// 고른 것만 전력 화면 목록에 뜬다. 지켜야 하는 것 셋:
//   · 표시용 거르개일 뿐이다. 서버가 받는 것·거부하는 것은 하나도 달라지지 않는다.
//   · 아무것도 고르지 않으면 **전부** 보인다(빈 목록이 "아무것도 안 보인다" 면
//     업데이트 직후 작업자가 전력을 넣을 방법이 없다).
//   · 고른 계측기가 서버 목록에서 사라졌으면 조용히 감추지 않고 알린다.
var mrvVisOpen = false, mrvVisItems = [], mrvVisSel = [];
var mrvVisMsg = null, mrvVisBusy = false, mrvVisTouched = false;

// 화면이 들고 있는 고른 목록은 **언제나 지금 목록 안의 id 뿐**이다.
//
// 저장된 목록을 통째로 들고 있으면, 서버 목록에서 사라진 id(장비를 다른 사이트로
// 재페어링하면 옛 사이트 id 전부가 그렇게 된다)를 **끌 토글이 화면에 없다** —
// 토글은 mrvVisItems 의 줄만 다룬다. 그런데 저장은 그 유령 id 까지 보내고 서버는
// 목록 밖 id 를 거부하므로(그 규칙은 낡은 id 가 설정에 굳는 것을 막는다),
// 무엇을 켜고 끄든 **저장이 100% 실패하고 경고는 영구히 남는다.** 그러면 고치는
// 길은 root 로 설정 파일을 손보는 것뿐인데, 경고문은 바로 이 화면에서 다시 고르라고
// 지시하고 있다. 그래서 거르개를 **보내기 전이 아니라 받는 자리에** 둔다 — 세는
// 것(mrvVisCount)과 토글과 저장이 같은 목록을 보게 된다.
//
// 목록을 아직 받지 못했으면(mrvVisItems 가 빔) 거르지 않는다. 그 상태에서 비우면
// [저장] 이 거르개를 통째로 꺼 버린다 — 그때는 저장 버튼 자체를 막는다.
function mrvVisKeep(ids){
  ids = ids || [];
  if (!mrvVisItems.length) return ids.slice();
  var known = mrvVisItems.map(function(m){ return m.id; });
  return ids.filter(function(id){ return known.indexOf(id) >= 0; });
}

// 상한의 정본은 shrimp365_sensor.MRV_VISIBLE_MAX 다. 수집기가 안 넣어 주면 0 이고,
// 그때는 화면에서 막지 않는다(저장 때 서버가 막는다 — 판정을 둘로 베끼지 않는다).
function mrvVisMax(){
  var n = (lastState || {}).mrv_vis_max;
  return (typeof n === "number" && n > 0) ? n : 0;
}

function mrvVisStart(){
  var d = lastState || {};
  mrvVisOpen = true; mrvVisMsg = null; mrvVisBusy = true; mrvVisTouched = false;
  mrvVisItems = d.mrv_meters || [];
  mrvVisSel = mrvVisKeep(d.mrv_visible);
  drawMrv();
  // 열 때 목록을 다시 받는다. 낡은 목록으로 고르면 웹에서 방금 등록한 계측기를
  // 고를 수 없고, 저장은 목록에 있는 id 만 받으므로 그 자리에서 거부된다.
  fetch("/api/mrv/meters", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(r){
      mrvVisBusy = false;
      if (r.items) mrvVisItems = r.items;
      // 응답이 오기까지 최대 10초다. 회선이 느린 현장에서 그 사이 누른 토글을
      // 저장된 값으로 덮으면, 작업자가 켠 것이 **아무 안내도 없이** 꺼진다.
      // 한 번이라도 눌렀으면 누른 쪽을 남기고, 새 목록으로만 거른다.
      mrvVisSel = mrvVisTouched ? mrvVisKeep(mrvVisSel) : mrvVisKeep(r.visible);
      if (!r.ok) mrvVisMsg = {kind:"err", text:errText(r, "pw_failed")};
      drawMrv();
    })
    .catch(function(){
      mrvVisBusy = false;
      mrvVisMsg = {kind:"err", text:t("pw_err_offline")};
      drawMrv();
    });
}

function mrvVisClose(){ mrvVisOpen = false; mrvVisMsg = null; drawMrv(); }

function mrvVisToggle(i){
  var m = mrvVisItems[i];
  if (!m) return;
  var at = mrvVisSel.indexOf(m.id);
  if (at >= 0) {
    mrvVisSel.splice(at, 1);
  } else {
    // 상한은 **켜는 순간** 막는다. [저장] 에서 처음 막으면 작업자는 스크롤도 없는
    // 화면에서 무엇을 빼야 하는지 알 수 없고, 고른 것이 전부 날아간 것처럼 보인다.
    var cap = mrvVisMax();
    if (cap && mrvVisSel.length >= cap) {
      mrvVisMsg = {kind:"err", text:t("pw_err_vis_max", {max:cap})};
      drawMrv();
      return;
    }
    mrvVisSel.push(m.id);
  }
  mrvVisTouched = true;
  mrvVisMsg = null;
  drawMrv();
}

function mrvVisSave(){
  // 목록을 모르는 상태에서는 저장하지 않는다. 그 상태의 빈 목록은 "거르개를
  // 끈다" 와 구분되지 않아, 회선이 끊긴 사이에 누른 [저장] 이 고른 것을 통째로
  // 지운다. 버튼도 함께 막아 두지만(drawMrvVisFoot) 여기서 한 번 더 받는다.
  if (mrvVisBusy || !mrvVisItems.length) return;
  mrvVisBusy = true; drawMrv();
  fetch("/api/mrv/visible", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ids: mrvVisSel})
  })
    .then(function(r){ return r.json(); })
    .then(function(r){
      mrvVisBusy = false;
      if (r && r.ok) {
        mrvVisMsg = {kind:"ok", text: r.saved ? t("mrv_vis_saved") : t("saved_mem")};
        mrvVisTouched = false;
        // 전력 패널이 아직 열려 있을 수 있다. 그쪽이 쓰는 값도 맞춰 둔다.
        pwrVis = (r.visible || []).slice();
        pwrShowAll = false;
        // 유령 id 는 방금 설정에서 빠졌다. 경고를 들고 있는 값도 함께 비운다 —
        // 다음 /api/state 가 올 때까지 "사라졌다" 가 남아 있으면, 작업자는
        // 저장이 된 것인지 안 된 것인지 알 수 없다.
        pwrGone = [];
        if (lastState) lastState.mrv_meters_missing = [];
      } else {
        mrvVisMsg = {kind:"err", text: errText(r, "save_fail")};
      }
      drawMrv();
    })
    .catch(function(){
      mrvVisBusy = false;
      mrvVisMsg = {kind:"err", text:t("save_fail")};
      drawMrv();
    });
}

// 「전체 15대 중 3대」. 거르개를 켜 두었는지 한 줄로 보이게 한다.
function mrvVisCount(total, picked){
  return picked ? t("mrv_vis_some", {n:picked, total:total})
                : t("mrv_vis_all", {n:total});
}

// 세는 것은 **지금 목록에 있는 것만**이다. 서버 목록에서 사라진 id 를 함께 세면
// 「15대 중 3대」인데 켜진 줄은 2개가 되어, 세어 보는 작업자마다 어긋난다.
// (거르개가 목록을 비우면 전력 화면은 거르지 않으므로 0 = 「전부 표시」가 맞다.)
function mrvVisPicked(d){
  var sel = d.mrv_visible || [], gone = d.mrv_meters_missing || [];
  return sel.filter(function(id){ return gone.indexOf(id) < 0; }).length;
}

// 고른 계측기가 서버 목록에서 사라졌을 때. 운영자가 웹에서 지웠다는 뜻이고,
// 작업자는 "어제 넣던 것이 없어졌다" 를 알아야 한다 — 조용히 감추지 않는다.
function mrvVisGone(ids){
  if (!ids || !ids.length) return "";
  return '<div class="pwarn">' + t("mrv_vis_gone", {n:ids.length}) +
    '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
      esc(ids.join(", ")) + '</div>' +
    '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
      t("mrv_vis_gone_sub") + '</div></div>';
}

function drawMrvVis(){
  var d = lastState || {};
  var rows = mrvVisItems.map(function(m, i){
    var on = mrvVisSel.indexOf(m.id) >= 0;
    return '<div class="srow">' +
      '<div class="sname">' + esc(m.label) +
        (m.is_aeration ? ' <span class="aer">' + t("pw_aeration") + '</span>' : '') +
        '<div class="sub">' + esc(m.id) + '</div></div>' +
      '<button class="toggle' + (on ? " on" : "") + '" ' +
        'onclick="mrvVisToggle(' + i + ')">' + (on ? t("on") : t("off")) + '</button>' +
    '</div>';
  }).join("");
  var msg = mrvVisMsg
    ? '<div class="msg ' + mrvVisMsg.kind + '">' + esc(mrvVisMsg.text) + '</div>' : "";
  var body = mrvVisItems.length
    ? '<div class="sub" style="margin:2px 0 6px">' +
        mrvVisCount(mrvVisItems.length, mrvVisSel.length) + ' · ' + t("mrv_vis_hint") +
      '</div>' + rows +
      '<div class="sub" style="margin:8px 0 0">' + t("mrv_vis_none") + '<br>' +
        t("mrv_vis_filter_note") + '<br>' + t("mrv_vis_why") + '</div>'
    : '<div class="sub">' + (mrvVisBusy ? t("wifi_loading") : t("pw_none")) + '</div>';
  return mrvVisGone(d.mrv_meters_missing) + msg + body;
}

// [저장] 은 **고정 바닥**에 둔다. 계측기가 15대면 목록 안에 둔 버튼은 열다섯
// 줄 아래로 밀려나는데, 키오스크에는 스크롤바가 없어 거기에 버튼이 있다는 것을
// 아무도 모른다 — 센서 설정 화면(.sfoot)이 이미 그렇게 되어 있다.
function drawMrvVisFoot(){
  // 목록을 아직 모르면 [저장] 을 막는다 — 그 상태의 저장은 거르개를 끄는 것과
  // 같아져, 고른 것이 조용히 전부 지워진다(mrvVisSave 머리말).
  var block = mrvVisBusy || !mrvVisItems.length;
  return '<button onclick="mrvVisClose()">' + t("cancel") + '</button>' +
    '<button aria-pressed="true" onclick="mrvVisSave()"' +
      (block ? " disabled" : "") + '>' + t("save") + '</button>';
}

function drawMrv(){
  if (!mrvOpen) return;
  document.getElementById("wifi").innerHTML = "";
  var d = lastState || {};
  var body, foot = "";
  // 고르기 화면이 떠 있는 동안 연결이 풀릴 수 있다(다른 사람이 웹에서 해제, 또는
  // 이 화면에서 해제). 그때 제목만 「이 장비가 읽을 계측기」로 남으면 본문은 연결
  // 안내인데 제목은 고르기 화면이라 어느 화면인지 읽을 수 없다. **제목과 본문과
  // 뒤로가기가 같은 값을 본다.**
  var visOn = mrvVisOpen && d.mrv_linked;

  if (d.mrv_pairing && d.mrv_pair_error) {
    body = '<div class="sname">' + t("mrv_pair_fail") + '</div>' +
      '<div class="msg err">' + esc(d.mrv_pair_error) + '</div>' +
      '<div class="ranges">' +
        '<button aria-pressed="true" onclick="mrvStart()">' + t("retry") + '</button>' +
        '<button onclick="mrvCancel()">' + t("close") + '</button>' +
      '</div>';
  } else if (d.mrv_pairing && !d.mrv_pair_code) {
    body = '<div class="wcur">' + t("mrv_getting") + '</div>' +
      '<div class="ranges"><button onclick="mrvCancel()">' + t("cancel") + '</button></div>';
  } else if (d.mrv_pairing) {
    body =
      '<div class="sname">' + t("mrv_pair_title") + '</div>' +
      '<div class="sub" style="margin:2px 0 4px">' + t("mrv_pair_desc") + '</div>' +
      '<div class="code" style="font-size:52px;letter-spacing:12px;padding-left:12px;' +
        'margin:4px 0 8px;text-align:center">' + esc(d.mrv_pair_code) + '</div>' +
      '<div class="steps" style="display:block"><ol>' +
        '<li>' + t("mrv_step1",
          {url: esc(d.mrv_pair_url || d.pair_url || "www.shrimp365.kr")}) + '</li>' +
        '<li>' + t("mrv_step2") + '</li>' +
        '<li>' + t("mrv_step3") + '</li>' +
        '<li>' + t("mrv_step4") + '</li>' +
      '</ol></div>' +
      '<div class="ranges" style="margin-top:8px">' +
        '<button onclick="mrvCancel()">' + t("cancel") + '</button></div>';
  } else if (visOn) {
    body = drawMrvVis();
    foot = drawMrvVisFoot();
  } else if (mrvAsk) {
    body = '<div class="wcur">' + t("mrv_unlink_ask") + '</div>' +
      '<div class="ranges" style="margin-top:8px">' +
        '<button aria-pressed="true" onclick="mrvUnlink()">' + t("mrv_unlink_yes") + '</button>' +
        '<button onclick="mrvAskBack()">' + t("cancel") + '</button>' +
      '</div>';
  } else if (d.mrv_linked) {
    body =
      '<div class="srow"><div class="sname">' + t("mrv_status") +
        '<div class="sub">' + t("mrv_site") + ' ' +
        esc(d.mrv_site_id || "--") + '</div></div>' +
        '<span class="chip on">' + t("connected") + '</span></div>' +
      '<div class="srow"><div class="sname">' + t("mrv_vis") +
        '<div class="sub">' +
          mrvVisCount((d.mrv_meters || []).length, mrvVisPicked(d)) +
        '</div></div>' +
        '<button class="toggle" onclick="mrvVisStart()">' + t("mrv_vis_open") + '</button>' +
      '</div>' +
      mrvVisGone(d.mrv_meters_missing) +
      (d.mrv_pending ? '<div class="srow"><div class="sname">' +
        t("pw_pending", {n:d.mrv_pending}) +
        '<div class="sub">' + t("pw_pending_note") + '</div></div></div>' : '') +
      '<div class="ranges" style="margin-top:8px">' +
        '<button onclick="mrvAskUnlink()">' + t("mrv_unlink") + '</button></div>';
  } else {
    body =
      '<div class="srow"><div class="sname">' + t("mrv_status") +
        '<div class="sub">' + t("mrv_hint") + '</div></div>' +
        '<span class="chip off">' + t("not_connected") + '</span></div>' +
      '<div class="ranges" style="margin-top:8px">' +
        '<button aria-pressed="true" onclick="mrvStart()">' + t("mrv_get_code") + '</button></div>';
  }

  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' +
          (visOn ? t("mrv_vis") : t("mrv_title")) + '</span>' +
        // 고르기 화면에서는 [‹ MRV 연결] 로 한 단계만 돌아간다.
        '<button style="margin-left:auto" onclick="' +
          (visOn ? 'mrvVisClose()' : 'mrvBack()') + '">' +
          (visOn ? '‹ ' + t("mrv_title") : t("back_menu")) + '</button>' +
      '</div>' +
      '<div class="sbody">' + body + '</div>' +
      (foot ? '<div class="ranges sfoot">' + foot + '</div>' : '') +
    '</div>';
}


// ── 전력 수기 입력 패널 ──────────────────────────────────────────────────────
// 계측기 선택 → 지침/사용량 → 큰 숫자 키패드 → 입력값 확인 → 전송 → 결과.
// 패널로 덮고, 닫으면 측정값으로 돌아온다(파일 머리말의 화면 원칙).
var pwrOpen = false, pwrStep = "list", pwrMeters = [], pwrMeter = null;
var pwrKind = "cumulative_kwh", pwrBuf = "", pwrRes = null;
var pwrBusy = false, pwrMsg = null, pwrClock = true, pwrPending = 0;
var pwrBlocked = 0, pwrBlockedReason = null, pwrBlockAsk = false;
// 「이 장비가 읽을 계측기」 거르개. pwrVis 가 비어 있으면 거르지 않는다.
// pwrShowAll 은 **화면 상태일 뿐**이고 설정을 바꾸지 않는다 — 거르개 때문에
// 영영 닿을 수 없는 계측기가 생기면 안 되므로 목록에 되돌리는 길을 둔다.
var pwrVis = [], pwrShowAll = false, pwrGone = [];

// 입력 종류의 기본값은 **계량기 지침**이다. 이 전역이 패널·계측기를 넘어 남으면,
// 한 번 [구간 사용량] 을 쓴 뒤 다음에 계량기 누적 숫자(예: 128450.6)를 넣었을 때
// 서버가 그것을 구간 사용량으로 보고 quality_flag='ok' 로 저장한다 — 약 128 MWh 가
// 경고 없이 EI 분자에 들어간다. 그래서 패널을 열 때와 계측기를 고를 때 되돌린다.
function pwrResetKind(){ pwrKind = "cumulative_kwh"; }

function openPower(){
  var d = lastState || {};
  pwrOpen = true; pwrStep = "list"; pwrMeter = null; pwrBuf = "";
  pwrRes = null; pwrMsg = null; pwrBusy = false; pwrBlockAsk = false;
  pwrResetKind();
  pwrMeters = d.mrv_meters || [];
  pwrVis = d.mrv_visible || [];
  pwrGone = d.mrv_meters_missing || [];
  pwrShowAll = false;
  pwrPending = d.mrv_pending || 0;
  pwrBlocked = d.mrv_blocked || 0;
  pwrBlockedReason = d.mrv_blocked_reason || null;
  pwrClock = d.mrv_clock_ok !== false;
  drawPower();
  loadMeters();
}

// 열 때마다 목록을 다시 받는다. 웹에서 방금 등록한 계측기가 보이지 않으면
// 작업자는 그 계측기의 전력을 넣을 방법이 없다.
function loadMeters(){
  pwrBusy = true; drawPower();
  fetch("/api/mrv/meters", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      pwrBusy = false;
      if (d.items) pwrMeters = d.items;
      if (d.visible) pwrVis = d.visible;
      pwrGone = d.missing || [];
      pwrPending = d.pending || 0;
      pwrBlocked = d.blocked || 0;
      pwrBlockedReason = d.blocked_reason || null;
      pwrClock = d.clock_ok !== false;
      pwrMsg = d.ok ? null : (d.error || null);
      drawPower();
    })
    .catch(function(){ pwrBusy = false; pwrMsg = t("pw_err_offline"); drawPower(); });
}

function closePower(){
  pwrOpen = false;
  document.getElementById("power").innerHTML = "";
  tick();
}

// 목록에 그려진 순서로 받는다 — pwrMeters 로 세면 거르개가 켜진 화면에서
// 누른 줄과 다른 계측기가 열린다.
function pwrPick(i){
  pwrMeter = pwrShown()[i] || null;
  if (!pwrMeter) return;
  // 다른 계측기를 고르면 앞 계측기에서 고른 종류를 끌고 가지 않는다.
  pwrResetKind();
  pwrBuf = ""; pwrStep = "entry"; drawPower();
}
function pwrSetKind(k){ pwrKind = k; drawPower(); }
function pwrToList(){ pwrStep = "list"; pwrMeter = null; pwrBuf = ""; pwrRes = null; drawPower(); }
function pwrToEntry(){ pwrStep = "entry"; pwrRes = null; drawPower(); }
function pwrToCheck(){ if (pwrNum() === null) return; pwrStep = "check"; drawPower(); }

// 키패드 입력. 숫자와 소수점만 들어온다 — 음수 기호 키는 두지 않는다(③).
function pwrKey(c){
  if (c === "<") pwrBuf = pwrBuf.slice(0, -1);
  else if (c === ".") { if (pwrBuf.indexOf(".") < 0) pwrBuf = (pwrBuf || "0") + "."; }
  else if (pwrBuf.replace(".", "").length < 10) pwrBuf = (pwrBuf === "0" ? "" : pwrBuf) + c;
  drawPower();
}

function pwrNum(){
  if (!pwrBuf || pwrBuf === "." ) return null;
  var v = parseFloat(pwrBuf);
  return isFinite(v) ? v : null;
}

function pwrSend(){
  var v = pwrNum();
  if (v === null || !pwrMeter || pwrBusy) return;
  pwrBusy = true; drawPower();
  fetch("/api/mrv/power", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({meter_id: pwrMeter.id, value: v, kind: pwrKind})
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      pwrBusy = false; pwrRes = d || {};
      if (typeof d.pending === "number") pwrPending = d.pending;
      if (typeof d.blocked === "number") pwrBlocked = d.blocked;
      // 지침이 들어갔으면 이 계측기는 더 이상 "첫 지침" 이 아니다.
      if (pwrKind === "cumulative_kwh" && (d.ok || d.queued) && pwrMeter) pwrMeter.has_prev = true;
      pwrStep = "result"; drawPower();
    })
    .catch(function(){
      // 응답을 못 받았다. 장비가 보냈는지 아닌지 화면이 단정하면 안 된다.
      pwrBusy = false;
      pwrRes = {ok:false, queued:false, error:t("pw_err_offline")};
      pwrStep = "result"; drawPower();
    });
}

// 서버가 준 사유(code)를 4언어로 옮긴다. **번역 키가 없을 때만** 서버의 한국어
// 원문을 쓴다 — 원문을 그대로 찍으면 베트남어·인도네시아어 작업자는 왜 실패했는지
// 읽을 수 없다. 응답 전체를 치환 변수로 넘기므로 {max} 같은 자리도 메워진다.
// 전력 패널과 「이 장비가 읽을 계측기」가 같은 함수를 쓴다 — 규약을 둘로 두면
// 한쪽에만 번역이 붙는다(거르개 저장 실패가 한국어로만 뜨던 것이 그 경우다).
function errText(res, fallbackKey){
  res = res || {};
  var key = "pw_err_" + (res.code || "");
  return I18N[key] ? t(key, res) : (res.error || t(fallbackKey));
}

function pwrErrText(res){ return errText(res, "pw_failed"); }

function pwrHead(title, back){
  return '<div class="chead">' +
    '<span class="ctitle">' + title + '</span>' +
    (pwrPending ? '<span class="chip hold" style="margin-left:8px">' +
      t("pw_pending", {n:pwrPending}) + '</span>' : '') +
    '<button style="margin-left:auto" onclick="' + back + '">' + t("close") + '</button>' +
    '</div>';
}

// 서버가 받지 않은 보관 건은 **조용히 사라지지 않는다.** 사유를 적고, 사람이
// 눌렀을 때만 치운다. 치우지 않으면 뒤의 입력까지 올라가지 못하므로 사유와 함께
// 그 사실도 적는다.
function pwrBlockWarn(){
  if (!pwrBlocked) return "";
  if (pwrBlockAsk) {
    return '<div class="pwarn">' + t("pw_blocked_ask", {n: pwrBlocked}) +
      '<div class="pbtns" style="margin-top:8px">' +
        '<button aria-pressed="true" onclick="pwrDiscard()">' + t("pw_blocked_yes") + '</button>' +
        '<button class="ghost" onclick="pwrBlockCancel()">' + t("cancel") + '</button>' +
      '</div></div>';
  }
  return '<div class="pwarn">' + t("pw_blocked", {n: pwrBlocked}) +
    (pwrBlockedReason ? '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
      esc(pwrBlockedReason) + '</div>' : '') +
    '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
      t("pw_blocked_note") + '</div>' +
    '<div class="pbtns" style="margin-top:8px">' +
      '<button class="ghost" onclick="pwrBlockAskOn()">' +
        t("pw_blocked_clear", {n: pwrBlocked}) + '</button>' +
    '</div></div>';
}

function pwrBlockAskOn(){ pwrBlockAsk = true; drawPower(); }
function pwrBlockCancel(){ pwrBlockAsk = false; drawPower(); }

function pwrDiscard(){
  pwrBlockAsk = false; pwrBusy = true; drawPower();
  fetch("/api/mrv/discard", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      pwrBusy = false;
      if (d && d.ok) {
        pwrBlocked = 0; pwrBlockedReason = null;
        pwrMsg = t("pw_blocked_done");
        if (typeof d.pending === "number") pwrPending = d.pending;
      }
      drawPower();
    })
    .catch(function(){ pwrBusy = false; pwrMsg = t("pw_err_offline"); drawPower(); });
}

// 시계가 틀어진 장비는 아무 단계에서도 보낼 수 없다. 누르고 나서 알게 하지 않고
// 먼저 띄운다 — 틀린 시각의 전력은 기준선 기간을 조용히 오염시킨다(②).
function pwrClockWarn(){
  if (pwrClock) return "";
  return '<div class="pwarn">' + t("pw_clock_bad") +
         '<div style="font-weight:500;font-size:12px;margin-top:4px;color:#FCA5A5">' +
         t("pw_clock_bad_sub") + '</div></div>';
}

// 계측기의 unit 은 **내부 저장 규약**이다(mrv_meters.unit 기본값 'kWh_interval' —
// 이미 구간 증분으로 정규화됐다는 표시). 그것을 기계실 화면에 그대로 찍으면 바로
// 옆 키패드가 적은 'kWh' 와 달라 보이고, 4언어 어디에도 번역이 없다. 사람이 읽을
// 단위로 바꿔 보여 준다. 모르는 토큰은 그대로 둔다 — 틀린 단위를 지어내지 않는다.
var PWR_UNIT_LABEL = {
  kWh_interval:"kWh", kWh:"kWh", Wh:"Wh", MWh:"MWh",
  mg_l:"mg/L", "mg/L":"mg/L", degC:"°C", pH:"pH", mV:"mV", mS_cm:"mS/cm"
};
function pwrUnitLabel(u){
  u = String(u == null ? "" : u);
  if (!u) return "kWh";
  if (PWR_UNIT_LABEL[u]) return PWR_UNIT_LABEL[u];
  // 'xxx_interval' 꼴은 뒤의 규약 표시만 떼면 단위가 남는다.
  var base = u.replace(/_interval$/, "");
  return PWR_UNIT_LABEL[base] || base;
}

function pwrMeterLine(m){
  return '<span class="pname">' + esc(m.label) + '</span>' +
    (m.is_aeration ? '<span class="aer">' + t("pw_aeration") + '</span>' : '') +
    '<span class="punit">' + esc(pwrUnitLabel(m.unit)) + '</span>';
}

// 이 화면에 그릴 계측기. 거르개는 **화면에만** 적용한다 — 서버가 받는 것은
// 달라지지 않는다(전송 가드는 여전히 서버 목록 전체를 본다).
function pwrKeep(){
  if (!pwrVis.length) return pwrMeters;
  var keep = pwrMeters.filter(function(m){ return pwrVis.indexOf(m.id) >= 0; });
  // 고른 계측기가 전부 지워진 뒤라면 거르개가 목록을 비워 버린다. 빈 목록은
  // 「웹에서 먼저 등록하세요」 와 구분되지 않으므로, 그때는 거르지 않는다.
  return keep.length ? keep : pwrMeters;
}

// 거르개가 지금 **목록을 실제로 줄이고 있는가.** 줄이지 않는 동안(고른 것이
// 전부 지워져 무력화된 상태) [전체 보기] 를 두면, 눌러도 목록이 그대로이고
// 라벨만 바뀌어 "버튼이 안 먹는다" 로 보인다. 그래서 버튼과 안내문을 이 값으로
// 가린다 — pwrVis 가 비었는지로 보면 무력화된 상태를 가려내지 못한다.
function pwrFiltering(){ return pwrKeep().length !== pwrMeters.length; }

function pwrShown(){ return pwrShowAll ? pwrMeters : pwrKeep(); }

function pwrToggleShowAll(){ pwrShowAll = !pwrShowAll; drawPower(); }

function drawPowerList(){
  var shown = pwrShown();
  var filtered = shown.length !== pwrMeters.length;   // 지금 거르고 있는가
  var body;
  if (!pwrMeters.length) {
    body = '<div class="pnote">' + (pwrBusy ? t("wifi_loading") : t("pw_none")) + '</div>' +
      (pwrMsg ? '<div class="msg err">' + esc(pwrMsg) + '</div>' : '');
  } else {
    // **목록에 몇 대가 있는지 적는다.** 한 화면에 5대만 보이고 키오스크에는
    // 스크롤바가 없어, 적지 않으면 작업자는 보이는 것이 전부라고 믿는다.
    // 거르는 중이면 둘(전체·표시)을 함께 적는다.
    body = '<div class="pnote">' + t("pw_pick") + ' · ' +
        (filtered ? t("mrv_vis_some", {n: shown.length, total: pwrMeters.length})
                  : t("pw_count", {n: pwrMeters.length})) + '</div>' +
      (pwrMsg ? '<div class="msg err">' + esc(pwrMsg) + '</div>' : '') +
      '<div class="plist">' + shown.map(function(m, i){
        return '<div class="prow" onclick="pwrPick(' + i + ')">' + pwrMeterLine(m) +
          '<span style="color:#64748B;font-size:20px;flex:0 0 auto">›</span></div>';
      }).join("") + '</div>' +
      (pwrFiltering()
        ? '<div class="pnote" style="margin-top:6px">' + t("pw_show_all_note") + '</div>' : '');
  }
  return pwrClockWarn() + pwrBlockWarn() + mrvVisGone(pwrGone) + body +
    (pwrPending ? '<div class="pnote" style="margin-top:6px">' + t("pw_pending_note") + '</div>' : '') +
    '<div class="pbtns">' +
      // 거르개가 **실제로 줄이고 있을 때만** 둔다. 거르지 않는 화면에서
      // [전체 보기] 는 아무 뜻이 없고, 눌러도 아무 일이 없는 버튼이 된다.
      (pwrFiltering()
        ? '<button class="ghost" aria-pressed="' + pwrShowAll + '" onclick="pwrToggleShowAll()">' +
            (pwrShowAll ? t("pw_show_picked") : t("pw_show_all")) + '</button>' : '') +
      '<button class="ghost" onclick="loadMeters()"' + (pwrBusy ? " disabled" : "") + '>' +
        t("pw_reload") + '</button>' +
      '<button class="ghost" onclick="closePower()">' + t("close") + '</button>' +
    '</div>';
}

function drawPowerEntry(){
  var cum = pwrKind === "cumulative_kwh";
  var hint = cum
    ? t("pw_delta_note") + (pwrMeter && pwrMeter.has_prev === false
        ? '<br><b>' + t("pw_first_note") + '</b>' : '')
    : t("pw_zero_hint");
  var keys = ["1","2","3","4","5","6","7","8","9",".","0","<"];
  return pwrClockWarn() +
    '<div class="pbody">' +
      '<div class="pcol">' +
        '<div class="prow" style="cursor:default">' + pwrMeterLine(pwrMeter) + '</div>' +
        '<div class="pseg">' +
          '<button aria-pressed="' + cum + '" onclick="pwrSetKind(&quot;cumulative_kwh&quot;)">' +
            t("pw_kind_cum") + '<span class="ssub">' + t("pw_kind_cum_sub") + '</span></button>' +
          '<button aria-pressed="' + (!cum) + '" onclick="pwrSetKind(&quot;interval_kwh&quot;)">' +
            t("pw_kind_int") + '<span class="ssub">' + t("pw_kind_int_sub") + '</span></button>' +
        '</div>' +
        '<div class="pbig' + (pwrBuf ? '' : ' ph') + '">' +
          (pwrBuf || "0") + '<small>kWh</small></div>' +
        '<div class="pnote">' + (pwrBuf ? hint : '<b>' + t("pw_empty") + '</b> · ' + hint) +
        '</div>' +
      '</div>' +
      '<div class="pkeys">' + keys.map(function(k){
        return '<button onclick="pwrKey(&quot;' + (k === "<" ? "<" : k) + '&quot;)">' +
          (k === "<" ? "⌫" : k) + '</button>';
      }).join("") + '</div>' +
    '</div>' +
    '<div class="pbtns">' +
      '<button class="ghost" onclick="pwrToList()">' + t("back_list") + '</button>' +
      '<button onclick="pwrToCheck()"' +
        ((pwrNum() === null || !pwrClock) ? " disabled" : "") + '>' + t("pw_send") + '</button>' +
    '</div>';
}

function drawPowerCheck(){
  var cum = pwrKind === "cumulative_kwh";
  return pwrClockWarn() +
    '<div class="pres">' +
      '<div class="line">' + t("pw_meter") + ' <b>' + esc(pwrMeter.label) + '</b>' +
        (pwrMeter.is_aeration ? ' <span class="aer">' + t("pw_aeration") + '</span>' : '') + '</div>' +
      '<div class="line">' + t("pw_kind") + ' <b>' +
        t(cum ? "pw_kind_cum" : "pw_kind_int") + '</b></div>' +
      '<div class="line">' + t("pw_value") + '</div>' +
      '<div class="pbig" style="margin:0">' + esc(pwrBuf) + '<small>kWh</small></div>' +
      (cum && pwrMeter.has_prev === false
        ? '<div class="line">' + t("pw_first_note") + '</div>' : '') +
    '</div>' +
    '<div class="pbtns">' +
      '<button class="ghost" onclick="pwrToEntry()">' + t("pw_fix") + '</button>' +
      '<button onclick="pwrSend()"' + ((pwrBusy || !pwrClock) ? " disabled" : "") + '>' +
        (pwrBusy ? t("pw_sending") : t("pw_send_now")) + '</button>' +
    '</div>';
}

function drawPowerResult(){
  var r = pwrRes || {};
  var cls = r.ok ? "ok" : (r.queued ? "hold" : "bad");
  var title = r.ok ? t("pw_sent") : (r.queued ? t("pw_heldt") : t("pw_failed"));
  var lines = [];
  if (r.ok) {
    lines.push(t("pw_accepted", {n: r.accepted || 0}));
    if (r.deduped) lines.push(t("pw_dedup", {n: r.deduped}));
    // "저장은 됐는데 EI 가 그대로" 를 화면에서 바로 알 수 있어야 한다.
    lines.push(r.countable ? t("pw_countable") : t("pw_suspect"));
    if (r.baseline) lines.push(t("pw_first_note"));
    if (r.rejected) lines.push(t("pw_rejected", {n: r.rejected}) +
      (r.rejected_reason ? " — " + esc(r.rejected_reason) : ""));
  } else {
    lines.push(pwrErrText(r));
    // 서버가 받지 않은 경우(code: refused). 사유를 그대로 보여 준다 — "저장했는데
    // KPI 가 안 변한다" 를 화면 앞에서 바로 알 수 있어야 한다.
    if (r.rejected) lines.push(t("pw_rejected", {n: r.rejected}) +
      (r.rejected_reason ? " — " + esc(r.rejected_reason) : ""));
    if (r.queued) lines.push(t("pw_pending_note"));
  }
  if (pwrPending) lines.push(t("pw_pending", {n: pwrPending}));
  return '<div class="pres ' + cls + '">' +
      '<h2>' + title + '</h2>' +
      '<div class="line">' + t("pw_meter") + ' <b>' + esc(pwrMeter ? pwrMeter.label : "") +
        '</b> · <b>' + esc(pwrBuf) + ' kWh</b></div>' +
      lines.map(function(l){ return '<div class="line">' + l + '</div>'; }).join("") +
    '</div>' +
    '<div class="pbtns">' +
      '<button onclick="pwrToList()">' + t("pw_more") + '</button>' +
      '<button class="ghost" onclick="closePower()">' + t("close") + '</button>' +
    '</div>';
}

function drawPower(){
  if (!pwrOpen) return;
  var body;
  if (pwrStep === "entry" && pwrMeter) body = drawPowerEntry();
  else if (pwrStep === "check" && pwrMeter) body = drawPowerCheck();
  else if (pwrStep === "result") body = drawPowerResult();
  else body = drawPowerList();
  var title = pwrStep === "check" ? t("pw_check") : t("pw_title");
  document.getElementById("power").innerHTML =
    '<div class="power">' + pwrHead(title, "closePower()") + body + '</div>';
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
  var test = d.test ? renderTest(d.test) : "";

  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("menu_sensors") + '</span>' +
        '<span class="cstats"><span>' + (d.port || "") + '</span></span>' +
        '<button onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' +
        msg + test + found +
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
        '<button onclick="testSensors()">' + t("test_btn") + '</button>' +
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

// 센서 테스트 결과 — 통신 / 전극 / 값 세 층을 나눠 보여 준다.
// 셋은 고쳐야 할 곳이 서로 다르므로 뭉뚱그리면 헛수고를 시킨다.
function verdictText(f){
  if (f.verdict === "ok") return {cls:"okv", txt:t("v_ok")};
  if (f.verdict === "probe") return {cls:"badv", txt:t("v_probe")};
  if (f.verdict === "range") return {cls:"badv", txt:t("v_range")};
  if (f.verdict === "supersat")
    return {cls:"badv", txt:t("v_supersat").replace("{{p}}", String(f.saturation))};
  return {cls:"badv", txt:t("v_undecodable")};
}

function renderTest(list){
  if (!list.length) return '<div class="msg err">' + t("test_none") + '</div>';
  var blocks = list.map(function(sen){
    var head = '<b>' + esc(sen.label || sen.key) + '</b> <span class="dim">ID ' + sen.slave_id + '</span> — ' +
      (sen.ok ? '<span class="okv">' + t("test_comm_ok") + '</span>'
              : '<span class="badv">' + t("test_no_reply") + '</span>');
    if (!sen.ok) return '<div class="trow">' + head + '</div>';
    var rows = (sen.fields || []).map(function(f){
      var v = verdictText(f);
      var shown = (f.value === null || f.value === undefined) ? "--" : f.value;
      return '<div class="tfield">' +
        '<span class="tname">' + esc(f.name) + '</span>' +
        '<span class="tval">' + esc(String(shown)) + ' <span class="dim">' + esc(f.unit || "") + '</span></span>' +
        '<span class="' + v.cls + '">' + v.txt + '</span>' +
        '<span class="dim traw">원시 ' + (f.raw === null ? "-" : f.raw) + '</span>' +
      '</div>';
    }).join("");
    return '<div class="trow">' + head + rows + '</div>';
  }).join("");
  return '<div class="found" style="max-height:none">' +
    '<b>' + t("test_title") + '</b>' + blocks + '</div>';
}

function testSensors(){
  setupMsg = {kind:"ok", text:t("test_running")};
  setupData.test = null;
  drawSettings();
  fetch("/api/sensors/test", {method:"POST"})
    .then(function(r){ return r.json(); })
    .then(function(d){
      setupData.test = d.result || [];
      setupMsg = null;
      drawSettings();
    })
    .catch(function(){
      setupMsg = {kind:"err", text:t("test_fail")};
      drawSettings();
    });
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
  // 설정·Wi‑Fi·전력 입력 중에는 뒤 화면을 다시 그리지 않는다.
  // 3초마다 갱신하면 조작 중에 깜빡이고 눌림이 씹힌다.
  if (settingsOpen || wifiOpen || pwrOpen) return;
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
    on_test=None,
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
    get_calibration=None,
    on_save_calibration=None,
    get_nutrient=None,
    on_save_nutrient=None,
    on_mrv_pair_start=None,
    on_mrv_pair_cancel=None,
    on_mrv_unlink=None,
    get_mrv_meters=None,
    # 이 장비 화면에 띄울 계측기를 고른다. **표시용 거르개일 뿐**이다 —
    # 서버가 받는 것·거부하는 것은 달라지지 않는다.
    on_mrv_visible=None,
    on_mrv_power=None,
    # 서버가 받지 않아 멈춘 보관분을 사람의 확인을 받아 치운다.
    on_mrv_discard=None,
    mode="aquaculture",
    on_set_mode=None,
) -> ThreadingHTTPServer | None:
    """상태 페이지를 띄운다. 실패해도 수집은 계속되어야 하므로 None 을 돌려준다."""

    # 첫 화면 언어를 페이지에 새겨 둔다(웹페이지와 같은 4종). 화면에서 바꾸면
    # JS 가 즉시 다시 그리고 서버에도 남기므로, 다음에 열 때 그 언어로 뜬다.
    lang = language if language in ("ko", "en", "vi", "id") else "ko"
    # 판정 숫자는 limits.py 한 곳에서만 온다 — 화면에 같은 값을 또 적어 두면
    # 한쪽만 고쳐져 수조 옆 색과 서버 알림이 어긋난다(실제로 수온이 그랬다).
    page_bytes = (PAGE
                  .replace("__MODE__", mode if mode in ("aquaculture", "smartfarm", "mrv")
                           else "aquaculture")
                  .replace("__LANG__", lang)
                  .replace("__BANDS__", json.dumps(limits.BANDS))
                  .replace("__NUT_BANDS__", json.dumps(limits.NUTRIENT_BANDS))).encode()

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
            elif self.path == "/api/calibration" and get_calibration is not None:
                self._send(200, json.dumps(get_calibration()).encode(), "application/json")
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
            if self.path == "/api/sensors/test" and on_test is not None:
                # 센서를 실제로 읽으므로 몇 초 걸릴 수 있다.
                self._send(200, json.dumps({"result": on_test()}).encode(), "application/json")
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
            if self.path == "/api/calibration/save" and on_save_calibration is not None:
                self._send(200, json.dumps(on_save_calibration(self._body())).encode(),
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
            # ── MRV 전력 수기 입력 ──────────────────────────────────────
            # 수질 경로(/api/pair/*, /api/unlink)와 **별개**다. 한 창구로 합치면
            # 전력 입력이 수질 연결을 끊는 일이 생긴다.
            if self.path == "/api/mode" and on_set_mode is not None:
                body = self._body()
                picked = body.get("mode")
                if not isinstance(picked, str):
                    self._send(200, json.dumps({"ok": False, "error": "모드가 없습니다"}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_set_mode(picked)).encode(), "application/json")
                return
            if self.path == "/api/mrv/pair/start" and on_mrv_pair_start is not None:
                self._send(200, json.dumps(on_mrv_pair_start()).encode(), "application/json")
                return
            if self.path == "/api/mrv/pair/cancel" and on_mrv_pair_cancel is not None:
                self._send(200, json.dumps(on_mrv_pair_cancel()).encode(), "application/json")
                return
            if self.path == "/api/mrv/unlink" and on_mrv_unlink is not None:
                self._send(200, json.dumps(on_mrv_unlink()).encode(), "application/json")
                return
            if self.path == "/api/mrv/meters" and get_mrv_meters is not None:
                # 서버에 물어보므로 몇 초 걸릴 수 있다.
                self._send(200, json.dumps(get_mrv_meters()).encode(), "application/json")
                return
            if self.path == "/api/mrv/visible" and on_mrv_visible is not None:
                self._send(200, json.dumps(on_mrv_visible(self._body())).encode(),
                           "application/json")
                return
            if self.path == "/api/mrv/discard" and on_mrv_discard is not None:
                self._send(200, json.dumps(on_mrv_discard()).encode(), "application/json")
                return
            if self.path == "/api/mrv/power" and on_mrv_power is not None:
                body = self._body()
                if not isinstance(body.get("meter_id"), str):
                    self._send(200, json.dumps(
                        {"ok": False, "error": "계측기를 고르세요", "code": "unknown_meter"}
                    ).encode(), "application/json")
                    return
                self._send(200, json.dumps(on_mrv_power(body)).encode(), "application/json")
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
