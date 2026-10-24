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
            "status": "",          # 하단에 뜨는 한 줄(한국어). 아래 코드가 없을 때만 화면에 쓴다.
            # 하단 줄의 뜻 — 화면이 이 코드와 숫자로 화면 언어 문장을 만든다(1.9.2).
            #   send_fail · unlinked · sent · sensor_error · dry_run · checking ·
            #   pair_wait · paired · unlinked_by_user · restarting · rebooting
            "status_code": None,
            "status_args": {},     # {"at": "07:42", "pending": 37, "sent": 3} 중 필요한 것
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
            "env": None,           # 환경·기상(field_env.py). 끄면 None, 켰는데 값이 없으면 {}
            "power": None,         # 전력 회로 {circuits, total_w, partial, level}. 끄면 None
            "mode": "shrimp",      # 장비 모드(shrimp|agriculture). 화면 이름·라벨·색만 바꾼다.

            # 장비가 스스로 낸 판단. 통신과 무관하게 여기서 끝난다.
            "advice": [],          # 설비 운전 권고 (advice.py)
            "anomalies": [],       # 추세 이상징후 (anomaly.py)
            "ai": {},              # 위 둘이 실제로 돌고 있는지 — 화면의 "AI 모드" 표시
        }

    def update(self, **kwargs) -> None:
        # 상태 문장만 바꾸고 코드를 주지 않으면(예전 호출부) 이전 코드가 남아 화면이
        # 옛 문장을 계속 그리게 된다. 그런 경우 코드를 지워 문자열을 그대로 쓰게 한다.
        if "status" in kwargs and "status_code" not in kwargs:
            kwargs["status_code"] = None
            kwargs.setdefault("status_args", {})
        with self._lock:
            self._data.update(kwargs)

    def snapshot(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._data))


PAGE = """<!doctype html>
<html lang="__LANG__" data-mode="__MODE__">
<meta charset="utf-8">
<meta name="viewport" content="width=800,initial-scale=1">
<title>Shrimp365</title>
<style>
  /* 강조색 — 모드가 정한다. 양식장은 파랑(기존 값 그대로), 스마트팜은 녹색.
     색을 쓰는 자리는 전부 이 변수만 보므로 모드 전환은 data-mode 하나로 끝난다. */
  :root{
    --brand:#1E40AF;          /* 버튼·마크·활성 칸 */
    --brand-hover:#3B82F6;    /* 보관 칩 테두리·AI 불빛 */
    --brand-line:#2563EB;     /* AI 켜짐 테두리 */
    --brand-text:#60A5FA;     /* 밝은 강조 글자(연결 코드·그래프 현재값) */
    --brand-text2:#93C5FD;    /* AI 켜짐 글자 */
    --brand-soft:#1E40AF18;   /* 양액 보충 띠 바탕 */
    --brand-soft2:#1E40AF22;  /* AI 켜짐 바탕 */
    --brand-ring:#3B82F633;   /* AI 불빛 테 */
  }
  :root[data-mode="agriculture"]{
    --brand:#15803D;
    --brand-hover:#16A34A;
    --brand-line:#16A34A;
    --brand-text:#4ADE80;
    --brand-text2:#86EFAC;
    --brand-soft:#15803D18;
    --brand-soft2:#15803D22;
    --brand-ring:#16A34A33;
  }
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
  .mark{width:24px;height:24px;border-radius:6px;background:var(--brand);
    display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .brand{font-weight:800;letter-spacing:-.02em;font-size:16px}
  /* 부제 — 스마트팜 모드에서만 채워진다. 비어 있으면 자리도 차지하지 않아
     양식장 화면은 예전과 한 픽셀도 다르지 않다. */
  .tag{font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--brand-text);
    flex:0 0 auto;margin-left:-4px}
  .tag:empty{display:none}
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
  .chip.hold{border-color:var(--brand-hover);color:var(--brand-text)}

  /* AI 모드 표시 — 이 장비가 값만 보여 주는 계측기가 아니라는 것을 머리에 박아 둔다.
     눌러서 "무엇을 하고 있는지" 를 열 수 있으므로 누를 수 있게 보이도록 한다. */
  .ai{
    display:flex;align-items:center;gap:6px;flex:0 0 auto;cursor:pointer;
    font-size:11.5px;font-weight:800;letter-spacing:.02em;
    padding:3px 9px;border-radius:999px;
    border:1px solid #1E3A5F;background:#0F1D33;color:#64748B;
  }
  .ai.on{border-color:var(--brand-line);background:var(--brand-soft2);color:var(--brand-text2)}
  .ai .bulb{width:7px;height:7px;border-radius:50%;background:#475569;flex:0 0 auto}
  .ai.on .bulb{background:var(--brand-hover);box-shadow:0 0 0 3px var(--brand-ring)}

  /* AI 모드 설명판 */
  /* 전력 — 머리 칩(전체 kW), 과열 경고 띠, 회로판. 양식장·스마트팜 공통.
     전력을 켜지 않은 장비(power=null)는 칩도 띠도 자리를 차지하지 않는다. */
  .pw{display:flex;align-items:center;gap:5px;flex:0 0 auto;cursor:pointer;
    font-size:12px;font-weight:800;padding:3px 9px;border-radius:999px;
    border:1px solid #22304C;background:#0F1D33;color:#CBD5E1;font-variant-numeric:tabular-nums}
  .pw:empty{display:none}
  .pw .bolt{color:#FBBF24}
  .pw.warn{border-color:#D97706;color:#FBBF24}
  .pw.crit{border-color:#DC2626;color:#F87171;background:#DC262622}
  .grid.n1{grid-template-columns:1fr}
  .grid.n2{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
  .grid.n3{grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr}
  .grid.n3 .v{font-size:46px}
  .grid.tight .cell{padding:6px 16px}
  .grid.tight .v{font-size:42px}
  .grid.tight .v small{font-size:17px}
  .grid.tight .sub2{margin-top:2px}
  .grid.tighter .cell{padding:4px 14px}
  .grid.tighter .v{font-size:34px}
  .grid.tighter .v small{font-size:15px}
  .grid.tighter .sub2{display:none}
  .pwalert{flex:0 0 auto;margin-bottom:9px;padding:8px 13px;border-radius:12px;cursor:pointer;
    display:flex;align-items:center;gap:10px;font-size:14.5px;font-weight:800}
  .pwalert.warn{border:1px solid #D97706;background:#D9770618;color:#FBBF24}
  .pwalert.crit{border:1px solid #DC2626;background:#DC262622;color:#F87171}
  .pwalert .why{margin-left:auto;font-size:12.5px;font-weight:600;color:#94A3B8}
  .pwbox{max-width:720px;width:100%;margin-top:8px;background:#111A2E;border:1px solid #22304C;
    border-radius:12px;padding:4px 14px;text-align:left;max-height:318px;overflow-y:auto}
  .pwrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #1E293B}
  .pwrow:first-child{border-top:0}
  .pwrow .nm{flex:1;min-width:0;font-size:14.5px;font-weight:700;color:#E8EDF7}
  .pwrow .nm small{display:block;font-size:11.5px;font-weight:600;color:#64748B}
  .pwrow .st{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;border:1px solid #22304C;color:#64748B}
  .pwrow .st.on{border-color:#10B981;color:#34D399}
  .pwrow .num{width:78px;text-align:right;font:800 15px/1.2 ui-monospace,monospace;color:#E8EDF7}
  .pwrow .num small{display:block;font:600 10.5px/1.2 system-ui,sans-serif;color:#64748B}
  .pwrow .num.warn{color:#FBBF24}
  .pwrow .num.crit{color:#F87171}
  .pwrow .num.dim{color:#475569}
  .typegrid.four{grid-template-columns:repeat(4,1fr)}
  .pcline{display:flex;align-items:center;gap:6px;padding:0 0 8px;flex-wrap:wrap}
  .pcline .pcinfo{flex:1;min-width:180px;font-size:12px;color:#94A3B8}
  .pcline .pcbig{min-width:72px;font-weight:800}
  .pcline .pcbig.on{border-color:#F87171;color:#FCA5A5}
  .pcbox{margin-top:8px;padding:8px;border:1px solid #22304C;border-radius:10px;display:flex;flex-direction:column;gap:6px}
  .pcstep{display:flex;align-items:center;gap:6px}
  .pcstep span{flex:1;font-size:13px;color:#CBD5E1}
  .pcstep b{min-width:74px;text-align:center;font:800 16px/1 ui-monospace,monospace;color:#E8EDF7}
  .pcdays{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
  .pcdays button{min-width:42px;padding:8px 6px;border-radius:8px;border:1px solid #22304C;background:#0B1324;color:#94A3B8;font-weight:700}
  .pcdays button.on{border-color:var(--brand);color:#E8EDF7;background:#13233F}
  .pwtot{display:flex;gap:18px;justify-content:center;margin-top:6px;font-size:13px;color:#94A3B8}
  .pwtot b{font:800 20px/1 ui-monospace,monospace;color:#E8EDF7;margin-right:3px}
  .typegrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
  .wlchips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}
  .wlchips span{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid #22304C;color:#94A3B8}
  .wlchips span.ok{border-color:#10B981;color:#34D399}
  .wlchips span.bad{border-color:#B45309;color:#FBBF24}
  .wlbig{width:100%;min-height:52px;border-radius:12px;border:1px solid var(--brand-line);background:var(--brand-soft2);
    color:var(--brand-text2);font-weight:800;font-size:16px;font-family:inherit;cursor:pointer;margin:2px 0 8px}
  .wlbig.on{background:#0E2A1F;border-color:#10B981;color:#6EE7B7}
  .wlbig[disabled]{opacity:.45;cursor:default}
  .wlhead{font-size:12.5px;font-weight:800;color:#94A3B8;margin:10px 0 2px}
  .wlmeta{font-size:12px;color:#94A3B8;text-align:right;flex:0 0 auto;line-height:1.35}
  .wlmeta.old{color:#FBBF24}
  .ecoset{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:8px;font-size:14px}
  .ecoset span{color:#94A3B8}
  .ecoset b{font-family:ui-monospace,monospace;word-break:break-all}
  .typegrid.two{grid-template-columns:repeat(2,1fr)}
  .typegrid button{min-height:46px;border-radius:10px;border:1px solid #22304C;background:#111A2E;
    color:#E8EDF7;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer}
  .typegrid button.on{border-color:var(--brand-line);background:var(--brand-soft2);color:var(--brand-text2)}
  .aibox{max-width:520px;text-align:left;width:100%;margin-top:10px;
    background:#111A2E;border:1px solid #22304C;border-radius:12px;padding:4px 16px 14px}
  .aibox .layer{
    display:flex;gap:11px;align-items:flex-start;
    padding:10px 0;border-top:1px solid #1E293B;
  }
  .aibox .layer:first-of-type{border-top:0}
  .aibox .n{
    flex:0 0 auto;width:21px;height:21px;border-radius:50%;margin-top:1px;
    background:var(--brand);color:#fff;font-size:11px;font-weight:800;
    display:flex;align-items:center;justify-content:center;
  }
  .aibox .ttl{font-size:14.5px;font-weight:700;color:#E8EDF7}
  .aibox .dsc{font-size:12.5px;color:#94A3B8;line-height:1.5;margin-top:2px}
  .aibox .now{margin-left:auto;flex:0 0 auto;font-size:12px;font-weight:700;color:var(--brand-text);text-align:right}
  .aibox .foot{margin-top:11px;padding-top:10px;border-top:1px solid #1E293B;
    font-size:12px;color:#64748B;line-height:1.55}

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

  /* 환경·기상 줄 (스마트팜 · 지그비 온습도·토양수분, 기상센서) — 값 격자와 양액 띠 사이.
     수질 값보다 작게 둔다. 판정 색은 없다(작물·생육 단계마다 적정값이 달라서). */
  .env{flex:0 0 auto;margin-top:9px;display:flex;gap:11px}
  .env .e{flex:1;min-width:0;background:#111A2E;border:1px solid #22304C;border-radius:12px;
    padding:7px 13px;display:flex;flex-direction:column;gap:2px}
  .env .ek{font-size:12.5px;color:#94A3B8;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .env .ev{font:800 25px/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
  .env .ev small{font-size:13px;font-weight:600;color:#94A3B8;margin-left:3px}
  .env .em{font-size:11px;color:#64748B;font-weight:600}
  .env .e.old .em{color:#F59E0B}
  /* 수질 센서 없이 쓰는 장비(노지) — 값 격자가 없으면 환경·기상 칸이 화면을 채운다. */
  .env.big{flex:1;min-height:0;margin-top:0;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr}
  .env.big .e{padding:10px 18px;justify-content:center;gap:6px}
  .env.big .ek{font-size:16px}
  .env.big .ev{font-size:44px}
  .env.big .ev small{font-size:18px}
  .env.big .em{font-size:13px}
  .env.big.wxgrid{margin-top:8px;grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(0,1fr)}
  .env.big.wxgrid .ev{font-size:34px}
  .env.big.wxgrid .e{padding:8px 14px}
  .env .e.many{cursor:pointer;border-color:#2B3E63}
  .env .e.many .ek::after{content:" \u203A";color:#64748B}
  .eachbody{flex:1;min-height:0;display:flex;gap:10px}
  .eachbody .plot{flex:1 1 0;display:flex;align-items:center;justify-content:center}
  .eachlist{width:270px;flex:0 0 auto;overflow-y:auto;background:#111A2E;border:1px solid #22304C;
    border-radius:12px;padding:2px 12px}
  .eachrow{gap:8px}
  .eachrow .dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
  .eachrow .nm{font-size:14px}
  .eachrow .num{width:74px}
  .avgkey::before{content:"";display:inline-block;width:16px;border-top:2px dashed #E8EDF7;
    vertical-align:middle;margin-right:5px}
  .eachrow .tag{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px}
  .eachrow .tag.hi{color:#FB923C;border:1px solid #9A3412}
  .eachrow .tag.lo{color:#38BDF8;border:1px solid #075985}
  .env .e.none .ev{color:#475569}
  .env.empty{border:1px dashed #22304C;border-radius:12px;padding:9px 14px;
    font-size:13px;color:#94A3B8;font-weight:600}

  /* 양액 안내 띠 — 계기판 아래 한 줄 */
  .nut{
    flex:0 0 auto;margin-top:9px;padding:9px 14px;border-radius:12px;
    display:flex;align-items:center;gap:12px;
    background:#111A2E;border:1px solid #22304C;
  }
  .nut.low{border-color:var(--brand);background:var(--brand-soft)}
  .nut.high{border-color:#D97706;background:#D9770618}
  .nut.ok{border-color:#10B981;background:#10B98112}
  .nut .head{font-size:14px;font-weight:800;flex:0 0 auto}
  .nut .dose{font:800 26px/1 ui-monospace,monospace;letter-spacing:-.01em}
  .nut .dose small{font-size:13px;font-weight:600;color:#94A3B8;margin-left:3px}
  .nut .meta{margin-left:auto;font-size:12px;color:#94A3B8;text-align:right;line-height:1.5}
  /* 스마트팜 모드 — 양액 보충이 이 장비의 주 업무라 값 격자 바로 아래, 권고보다
     앞에 크게 놓는다. 양식장 모드는 예전 자리(맨 아래, 작게) 그대로다. */
  .nut.front{padding:12px 16px;border-width:2px;gap:16px}
  .nut.front .head{font-size:17px}
  .nut.front .dose{font-size:34px}
  .nut.front .meta{font-size:13px}
  .nut.off{border-style:dashed;color:#94A3B8;cursor:pointer}
  .nut.off .head{font-size:13.5px;font-weight:600}

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
    font-weight:700;font-size:12px;line-height:1;font-family:inherit;padding:9px 13px;min-height:38px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#64748B;cursor:pointer;
  }
  .toggle.on{border-color:#10B981;color:#10B981;background:#10B98115}
  .step{display:flex;align-items:center;gap:0}
  .step button{
    width:40px;height:38px;font-weight:800;font-size:18px;line-height:1;font-family:inherit;
    background:#16223C;color:#93A4BF;border:1px solid #22304C;cursor:pointer;
  }
  .step button:first-child{border-radius:8px 0 0 8px}
  .step button:last-child{border-radius:0 8px 8px 0}
  .step button:active{background:var(--brand);color:#fff}
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
  /* 한글 이름까지 고정폭 글꼴로 그리면 자간이 벌어진다(1.9.1). 숫자만 폭을 맞춘다. */
  .found b{color:var(--brand-text);font-variant-numeric:tabular-nums}
  /* 모드 고르기 — 두 칸 토글. 활성 칸은 강조색으로 찬다. */
  .seg{display:flex;gap:8px;margin:8px 0}
  .seg button{
    flex:1 1 0;min-width:0;min-height:68px;padding:10px 12px;border-radius:12px;
    border:1px solid #22304C;background:#111A2E;color:#94A3B8;cursor:pointer;
    font-weight:700;font-size:16px;line-height:1.3;font-family:inherit;text-align:left;
  }
  .seg button small{display:block;font-size:11.5px;font-weight:600;color:#64748B;margin-top:3px}
  .seg button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:#fff}
  .seg button[aria-pressed="true"] small{color:#fff;opacity:.8}
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
  .msg.info{background:#3B82F618;color:#CBD5E1;font-size:13px;line-height:1.5}

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
  .bars i.on{background:var(--brand-text)}
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
    font-weight:600;font-size:12px;line-height:1;font-family:inherit;padding:9px 11px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;flex:0 0 auto;
  }
  .kbd{margin-top:8px;display:flex;flex-direction:column;gap:5px}
  .krow{display:flex;gap:5px;justify-content:center}
  .kbd button{
    flex:1 1 0;min-width:0;height:44px;
    font-weight:700;font-size:16px;line-height:1;font-family:inherit;color:#E8EDF7;
    background:#16223C;border:1px solid #22304C;border-radius:8px;cursor:pointer;
  }
  .kbd button:active{background:var(--brand)}
  .kbd button.wide{flex:1.6 1 0}
  .kbd button.go{flex:2 1 0;background:var(--brand);border-color:var(--brand);color:#fff}
  .kbd button.k-shift.on{background:#334155;border-color:#475569}

  /* 그래프 화면 */
  .chart{
    position:fixed;inset:0;background:#0B1120;z-index:20;
    display:flex;flex-direction:column;padding:10px 16px 12px;
  }
  .chead{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .ctitle{font-size:18px;font-weight:800}
  .cnow{font:800 22px/1 ui-monospace,monospace;color:var(--brand-text)}
  .cstats{margin-left:auto;display:flex;gap:12px;font-size:12px;color:#94A3B8}
  .cstats b{color:#E8EDF7;font-weight:700;font-family:ui-monospace,monospace}
  .ranges{display:flex;gap:6px;margin-bottom:6px}
  .ranges button{
    font-weight:700;font-size:13px;line-height:1;font-family:inherit;padding:8px 14px;min-height:36px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;
  }
  .ranges button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:#fff}
  .ranges .close{margin-left:auto;border-color:#22304C}
  /* 설정·보정·양액 화면 머리의 [닫기]·[‹ 설정]. 클래스 없이 만든 버튼이라 예전에는
     브라우저 기본 모양(흰 사각)으로 떠 혼자 튀었다. 그래프의 [닫기]와 같은 모양으로 두되,
     장갑 낀 손으로도 누르게 높이는 터치 최소 44px(1.9.2). */
  .chead > button{
    font-weight:700;font-size:13px;line-height:1;font-family:inherit;padding:8px 16px;min-height:44px;border-radius:8px;
    border:1px solid #22304C;background:transparent;color:#94A3B8;cursor:pointer;flex:0 0 auto;margin-left:auto;
  }
  .chead .cstats + button{margin-left:12px}
  .chead > button:active{background:#16223C}
  .plot{flex:1;min-height:0;background:#111A2E;border:1px solid #22304C;border-radius:12px;
    position:relative;overflow:hidden}
  .plot svg{display:block;position:absolute;inset:0;width:100%;height:100%}
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
    font-weight:700;font-size:13px;line-height:1;font-family:inherit;padding:9px 16px;min-height:38px;border-radius:8px;
    background:var(--brand);color:#fff;border:0;cursor:pointer;
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
    color:var(--brand-text);margin:12px 0 8px;padding-left:18px;white-space:nowrap;
  }
  .steps{
    text-align:left;display:inline-block;margin-top:6px;
    background:#111A2E;border:1px solid #22304C;border-radius:12px;padding:10px 20px;
  }
  /* 맨 위 *{padding:0} 이 ol 의 들여쓰기까지 지워 번호가 테두리에 붙었다(1.9.1). */
  .steps ol{padding-left:1.5em}
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
  <span class="brand" id="brand">Shrimp365</span>
  <span class="tag" id="tag"></span>
  <span class="ver" id="ver"></span>
  <span class="ai" id="ai" onclick="openAi()"><span class="bulb"></span><span id="ailabel"></span></span>
  <span class="pw" id="pw" onclick="openPower()"></span>
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
<div id="aipanel"></div>
<div id="powerpanel"></div>
<div id="envpanel"></div>

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
  // 스마트팜에서는 염도를 보여 주지 않는다 — 양액에 염도 환산값은 뜻이 없다.
  if (isAgri()) {
    // [센서 설정]에서 끈 센서는 칸을 그리지 않는다(값이 없는 '고장' 칸과 구분된다).
    // 수온은 pH·DO·EC 센서 어느 것이든 잰다. sensors_on 이 없는 옛 상태면 4칸 그대로.
    var on = d && d.sensors_on;
    var all = ["temperature","ph","do_level","conductivity"];
    if (!on) return all;
    var need = {temperature:["ph","do","ec"], ph:["ph"], do_level:["do"], conductivity:["ec"]};
    return all.filter(function(k){ return need[k].some(function(s){ return on.indexOf(s) >= 0; }); });
  }
  var fourth = (typeof v.salinity === "number") ? "salinity"
             : (typeof v.conductivity === "number") ? "conductivity"
             : "salinity";
  return ["temperature","ph","do_level",fourth];
}

// 양액(수경재배)에서는 적정 범위가 새우와 전혀 다르다. 새우 기준을 그대로
// 쓰면 정상값(수온 24℃, pH 6.2)이 온통 빨갛게 떠 경고가 무의미해진다.
// 양액 관리를 켠 장비와 스마트팜 모드에서는 NUT_BANDS 로 바꿔 본다(둘 다 limits.py 가 준다).
// 스마트팜에서 양액 관리를 꺼 둔 것은 "보충량 계산을 안 쓴다" 는 뜻이지 새우 기준으로
// 보라는 뜻이 아니다 — 그렇게 보면 정상 양액(21℃, pH 6.1)이 온통 빨갛게 뜬다.
var nutMode = false;   // 계기판이 매번 갱신할 때 함께 정한다

// 이 항목에 쓰는 판정 밴드 — 값 칸의 색(level)과 그래프의 녹색 띠가 이 하나를 본다.
// 농업 기준(NUT_BANDS = 웹 AGRI_THRESHOLDS 와 같은 값)에 없는 항목은 새우 표로 돌아가고,
// 전도도처럼 어느 표에도 없는 항목은 밴드가 없다(전역 EC 기준선을 긋지 않는다).
// isAgri() 도 직접 본다 — 그래프가 열려 있는 동안에는 renderValues 가 돌지 않아
// nutMode 가 모드 전환을 늦게 따라올 수 있다.
function bandFor(key){
  if ((nutMode || isAgri()) && NUT_BANDS[key]) return NUT_BANDS[key];
  return BANDS[key] || null;
}

// 밴드의 한쪽 끝이 null 이면 그쪽은 보지 않는다 — 용존산소에 상한이 없는 것이
// 그 예다. 예전에는 상한 자리에 20 을 박아 두어, 과포화를 "위험"으로 찍었다.
function within(pair, v){
  if (!pair) return false;
  if (pair[0] !== null && v < pair[0]) return false;
  if (pair[1] !== null && v > pair[1]) return false;
  return true;
}

function level(key, v){
  var b = bandFor(key);
  if(!b) return "";
  if(within(b.ok, v)) return "";
  return within(b.warn, v) ? "warn" : "crit";
}

function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]; }); }

// ── 화면 언어 ────────────────────────────────────────────────────────────────
// 웹페이지와 같은 4종(ko/en/vi/id). 서버가 첫 언어를 __LANG__ 자리에 새겨 준다.
// [설정] → [언어 설정] 에서 바꾸면 즉시 다시 그리고 서버에도 남긴다.
var LANG = "__LANG__";
if (!/^(ko|en|vi|id)$/.test(LANG)) LANG = "ko";

// 언어 이름은 어느 언어에서 보든 그 언어 그대로 적는다(현지 표기).
var LANG_NAMES = {ko:"한국어", en:"English", vi:"Tiếng Việt", id:"Bahasa Indonesia"};
var LANG_ORDER = ["ko","en","vi","id"];

// ── 장비 모드 ────────────────────────────────────────────────────────────────
// shrimp(양식장) | agriculture(스마트팜). 서버가 첫 모드를 __MODE__ 자리에 새겨 주고,
// 그 뒤로는 /api/state 의 mode 를 따라간다. 바뀌는 것은 화면 이름·라벨·강조색뿐이다 —
// 측정·전송은 모드를 모른다.
var MODE = "__MODE__";
if (MODE !== "agriculture") MODE = "shrimp";
var BRAND = {
  shrimp:      {name:"Shrimp365", tag:"",                   accent:"#60A5FA"},
  agriculture: {name:"Farm365",   tag:"SMART FARMING",      accent:"#4ADE80"}
};
function isAgri(){ return MODE === "agriculture"; }
// 그래프 SVG 는 속성에 CSS 변수를 못 쓰므로 색을 직접 준다(--brand-text 와 같은 값).
function accent(){ return BRAND[MODE].accent; }

function applyMode(m){
  MODE = (m === "agriculture") ? "agriculture" : "shrimp";
  try { document.documentElement.setAttribute("data-mode", MODE); } catch(e){}
  var b = BRAND[MODE];
  document.title = b.name;
  document.getElementById("brand").textContent = b.name;
  document.getElementById("tag").textContent = b.tag;
}

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
  // 하단 상태줄 — 수집기는 status_code + 숫자만 보내고 문장은 여기서 만든다(1.9.2).
  // 1.9.1 은 수집기가 만든 한국어 문장을 그대로 띄워 영어 화면에도 "보관 37건" 이 떴다.
  st_send_fail:{ko:"전송 실패",en:"Send failed",vi:"Gửi thất bại",id:"Gagal kirim"},
  st_unlinked:{ko:"미연결 — 측정만",en:"Not linked — measuring only",vi:"Chưa kết nối — chỉ đo",id:"Belum ditautkan — hanya mengukur"},
  st_sent:{ko:"전송 {at}",en:"Sent {at}",vi:"Đã gửi {at}",id:"Terkirim {at}"},
  st_sent_more:{ko:"전송 {at} · 보관분 {sent}건 함께",en:"Sent {at} · +{sent} held",vi:"Đã gửi {at} · +{sent} đã lưu",id:"Terkirim {at} · +{sent} tersimpan"},
  st_waiting:{ko:"측정 대기 — 아직 들어온 값이 없습니다 ({at})",en:"Waiting — no readings yet ({at})",vi:"Đang chờ — chưa có số liệu ({at})",id:"Menunggu — belum ada data ({at})"},
  st_sensor_error:{ko:"센서 오류 — 읽은 값 없음",en:"Sensor error — no readings",vi:"Lỗi cảm biến — không có số liệu",id:"Kesalahan sensor — tanpa data"},
  st_dry_run:{ko:"시험 실행(전송 안 함) {at}",en:"Dry run (not sent) {at}",vi:"Chạy thử (không gửi) {at}",id:"Uji coba (tidak dikirim) {at}"},
  st_checking:{ko:"센서 확인 중",en:"Checking sensors",vi:"Đang kiểm tra cảm biến",id:"Memeriksa sensor"},
  st_pair_wait:{ko:"연결 대기 중",en:"Waiting for link",vi:"Đang chờ kết nối",id:"Menunggu tautan"},
  st_paired:{ko:"연결 완료",en:"Linked",vi:"Đã kết nối",id:"Tertaut"},
  st_unlinked_by_user:{ko:"계정 연결 해제됨 — 새 코드로 연결하세요",en:"Account unlinked — link again with a new code",vi:"Đã ngắt tài khoản — kết nối lại bằng mã mới",id:"Akun diputus — tautkan lagi dengan kode baru"},
  st_restarting:{ko:"다시 시작하는 중… 약 15초",en:"Restarting… about 15s",vi:"Đang khởi động lại… khoảng 15 giây",id:"Memulai ulang… sekitar 15 dtk"},
  st_rebooting:{ko:"재부팅하는 중… 약 1분",en:"Rebooting… about 1 min",vi:"Đang khởi động lại thiết bị… khoảng 1 phút",id:"Memulai ulang perangkat… sekitar 1 menit"},
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
  // 모드
  menu_mode:{ko:"모드",en:"Mode",vi:"Chế độ",id:"Mode"},
  menu_mode_sub:{ko:"양식장 / 스마트팜",en:"Shrimp farm / Smart farm",vi:"Trại tôm / Nông trại thông minh",id:"Tambak / Smart farm"},
  mode_hint:{ko:"이 장비를 어디에 쓰는지 고르세요. 화면 이름·라벨·강조색이 바뀌고, 측정과 서버 전송은 그대로입니다.",en:"Choose where this device is used. The name, labels and accent colour change; measuring and uploading stay the same.",vi:"Chọn nơi dùng thiết bị này. Tên, nhãn và màu nhấn thay đổi; việc đo và gửi dữ liệu giữ nguyên.",id:"Pilih tempat perangkat ini dipakai. Nama, label dan warna aksen berubah; pengukuran dan pengiriman tetap sama."},
  mode_shrimp:{ko:"양식장",en:"Shrimp farm",vi:"Trại tôm",id:"Tambak"},
  mode_shrimp_sub:{ko:"수조 · 염도 · 새우 양식 기준",en:"Tanks · salinity · shrimp ranges",vi:"Bể · độ mặn · ngưỡng nuôi tôm",id:"Kolam · salinitas · rentang udang"},
  mode_agri:{ko:"스마트팜",en:"Smart farm",vi:"Nông trại thông minh",id:"Smart farm"},
  mode_agri_sub:{ko:"베드 · 전도도(mS/cm) · 양액 보충 안내",en:"Beds · conductivity (mS/cm) · nutrient dosing",vi:"Luống · độ dẫn (mS/cm) · bổ sung dinh dưỡng",id:"Bedeng · konduktivitas (mS/cm) · dosis nutrisi"},
  mode_ec_note:{ko:"스마트팜으로 바꾸면 EC 센서가 염도 대신 전도도(mS/cm)를 보여 줍니다. [센서 설정] 에서 다시 바꿀 수 있습니다.",en:"Switching to Smart farm shows conductivity (mS/cm) instead of salinity. You can change it back in [Sensor settings].",vi:"Chuyển sang Nông trại thông minh sẽ hiện độ dẫn (mS/cm) thay cho độ mặn. Có thể đổi lại trong [Cài đặt cảm biến].",id:"Beralih ke Smart farm menampilkan konduktivitas (mS/cm) alih-alih salinitas. Bisa diubah kembali di [Pengaturan sensor]."},
  mode_saved:{ko:"바꿨습니다.",en:"Changed.",vi:"Đã đổi.",id:"Diubah."},
  env_air:{ko:"기온",en:"Air temp",vi:"Nhiệt độ không khí",id:"Suhu udara"},
  env_canopy:{ko:"초관부 온도",en:"Canopy temp",vi:"Nhiệt độ tán",id:"Suhu kanopi"},
  env_rh:{ko:"습도",en:"Humidity",vi:"Độ ẩm",id:"Kelembapan"},
  env_soil:{ko:"토양수분",en:"Soil moisture",vi:"Độ ẩm đất",id:"Kelembapan tanah"},
  env_soil_temp:{ko:"지온",en:"Soil temp",vi:"Nhiệt độ đất",id:"Suhu tanah"},
  env_meta:{ko:"{n}대 · {m}분 전",en:"{n} sensor(s) · {m} min ago",vi:"{n} cảm biến · {m} phút trước",id:"{n} sensor · {m} mnt lalu"},
  env_one:{ko:"{id} · {m}분 전",en:"{id} · {m} min ago",vi:"{id} · {m} phút trước",id:"{id} · {m} mnt lalu"},
  env_one_now:{ko:"{id} · 방금",en:"{id} · just now",vi:"{id} · vừa xong",id:"{id} · baru saja"},
  env_now:{ko:"{n}대 · 방금",en:"{n} sensor(s) · just now",vi:"{n} cảm biến · vừa xong",id:"{n} sensor · baru saja"},
  env_wind:{ko:"풍속",en:"Wind",vi:"Gió",id:"Angin"},
  env_rain_day:{ko:"오늘 강수",en:"Rain today",vi:"Mưa hôm nay",id:"Hujan hari ini"},
  wx_title:{ko:"기상 상세",en:"Weather details",vi:"Chi tiết thời tiết",id:"Detail cuaca"},
  wx_hint:{ko:"기상센서가 보내는 값 전부 — 1분마다 새로 고칩니다",en:"Everything the weather station sends — refreshed every minute",vi:"Mọi giá trị trạm thời tiết gửi — làm mới mỗi phút",id:"Semua nilai dari stasiun cuaca — diperbarui tiap menit"},
  wx_wind:{ko:"풍속(평균)",en:"Wind (avg)",vi:"Gió (TB)",id:"Angin (rata)"},
  wx_gust:{ko:"돌풍",en:"Gust",vi:"Gió giật",id:"Hembusan"},
  wx_dir:{ko:"풍향",en:"Direction",vi:"Hướng gió",id:"Arah"},
  wx_rain_day:{ko:"오늘 강수",en:"Rain today",vi:"Mưa hôm nay",id:"Hujan hari ini"},
  wx_rain_rate:{ko:"강우강도",en:"Rain rate",vi:"Cường độ mưa",id:"Intensitas hujan"},
  wx_solar:{ko:"일사량",en:"Solar radiation",vi:"Bức xạ mặt trời",id:"Radiasi matahari"},
  wx_solar_lux:{ko:"조도로 어림",en:"estimated from lux",vi:"ước từ lux",id:"perkiraan dari lux"},
  wx_uv:{ko:"자외선 지수",en:"UV index",vi:"Chỉ số UV",id:"Indeks UV"},
  wx_pressure:{ko:"기압",en:"Pressure",vi:"Áp suất",id:"Tekanan"},
  wx_dew:{ko:"이슬점",en:"Dew point",vi:"Điểm sương",id:"Titik embun"},
  wx_dew_sub:{ko:"기온·습도로 계산",en:"from temp & humidity",vi:"tính từ nhiệt & ẩm",id:"dari suhu & RH"},
  env_gust:{ko:"돌풍 {v}",en:"gust {v}",vi:"giật {v}",id:"hembusan {v}"},
  env_rate:{ko:"지금 {v} mm/h",en:"now {v} mm/h",vi:"hiện {v} mm/h",id:"kini {v} mm/j"},
  dir_N:{ko:"북",en:"N",vi:"Bắc",id:"U"}, dir_NE:{ko:"북동",en:"NE",vi:"Đông Bắc",id:"TL"},
  dir_E:{ko:"동",en:"E",vi:"Đông",id:"T"}, dir_SE:{ko:"남동",en:"SE",vi:"Đông Nam",id:"TG"},
  dir_S:{ko:"남",en:"S",vi:"Nam",id:"S"}, dir_SW:{ko:"남서",en:"SW",vi:"Tây Nam",id:"BD"},
  dir_W:{ko:"서",en:"W",vi:"Tây",id:"B"}, dir_NW:{ko:"북서",en:"NW",vi:"Tây Bắc",id:"BL"},
  env_no_hist:{ko:"아직 쌓인 기록이 없습니다 — 5분마다 남깁니다",en:"No history yet — recorded every 5 minutes",vi:"Chưa có lịch sử — ghi mỗi 5 phút",id:"Belum ada riwayat — dicatat tiap 5 menit"},
  env_loading:{ko:"기록을 읽는 중…",en:"Loading history…",vi:"Đang tải…",id:"Memuat…"},
  env_avg_line:{ko:"평균",en:"Average",vi:"Trung bình",id:"Rata-rata"},
  env_each_title:{ko:"{p} · 센서별",en:"{p} · by sensor",vi:"{p} · từng cảm biến",id:"{p} · per sensor"},
  env_trend_title:{ko:"{p} · 24시간",en:"{p} · 24 h",vi:"{p} · 24 giờ",id:"{p} · 24 jam"},
  wx_more:{ko:"기상 상세",en:"Weather details",vi:"Chi tiết thời tiết",id:"Detail cuaca"},
  env_avg:{ko:"평균 ({n}대)",en:"Average ({n})",vi:"Trung bình ({n})",id:"Rata-rata ({n})"},
  env_lost:{ko:"끊김",en:"No signal",vi:"Mất tín hiệu",id:"Terputus"},
  env_hi:{ko:"최고",en:"Highest",vi:"Cao nhất",id:"Tertinggi"},
  env_lo:{ko:"최저",en:"Lowest",vi:"Thấp nhất",id:"Terendah"},
  env_just:{ko:"방금",en:"just now",vi:"vừa xong",id:"baru saja"},
  env_ago:{ko:"{m}분 전",en:"{m} min ago",vi:"{m} phút trước",id:"{m} mnt lalu"},
  env_missing:{ko:"값 없음",en:"No data",vi:"Không có dữ liệu",id:"Tidak ada data"},
  env_empty:{ko:"환경·기상 센서 값이 들어오지 않습니다 — 수집기(zigbee_bridge·rtl433_bridge)와 센서 배터리를 확인하세요",en:"No environment or weather data — check the collectors (zigbee_bridge, rtl433_bridge) and sensor batteries",vi:"Không có dữ liệu môi trường/thời tiết — kiểm tra bộ thu (zigbee_bridge, rtl433_bridge) và pin cảm biến",id:"Tidak ada data lingkungan/cuaca — periksa kolektor (zigbee_bridge, rtl433_bridge) dan baterai sensor"},
  nut_off_hint:{ko:"양액 관리 꺼짐 — 눌러서 [양액 설정] 에서 켜세요",en:"Nutrient management off — tap to turn it on in [Nutrient solution]",vi:"Quản lý dinh dưỡng đang tắt — nhấn để bật trong [Dung dịch dinh dưỡng]",id:"Manajemen nutrisi mati — ketuk untuk menyalakan di [Larutan nutrisi]"},
  // 센서 설정
  version:{ko:"버전",en:"Version",vi:"Phiên bản",id:"Versi"},
  checking:{ko:"확인 중",en:"checking",vi:"đang kiểm tra",id:"memeriksa"},
  ext_title:{ko:"그 밖의 표시",en:"Other displays",vi:"Hiển thị khác",id:"Tampilan lain"},
  ext_hint:{ko:"끄면 장비 화면과 웹 대시보드에서 그 칸이 사라집니다. 환경·기상과 전력은 저장하면 프로그램이 다시 시작됩니다(약 15초).",en:"Turned-off items disappear from this screen and the web dashboard. Saving a change to environment or power restarts the program (~15 s).",vi:"Mục tắt sẽ ẩn trên màn hình này và bảng điều khiển web. Lưu thay đổi môi trường/điện sẽ khởi động lại (~15 giây).",id:"Item yang dimatikan hilang dari layar ini dan dasbor web. Menyimpan perubahan lingkungan/listrik memulai ulang program (~15 dtk)."},
  ext_env:{ko:"환경·기상 (무선 온습도·토양·기상센서)",en:"Environment & weather (wireless)",vi:"Môi trường & thời tiết (không dây)",id:"Lingkungan & cuaca (nirkabel)"},
  ext_nutrient:{ko:"양액 관리",en:"Nutrient management",vi:"Quản lý dinh dưỡng",id:"Manajemen nutrisi"},
  ext_power:{ko:"전력 회로",en:"Power circuits",vi:"Mạch điện",id:"Sirkuit listrik"},
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
  n_flow:{ko:"유량",en:"Flow rate",vi:"Lưu lượng",id:"Laju aliran"},
  n_dp:{ko:"차압",en:"Differential pressure",vi:"Chênh áp",id:"Tekanan diferensial"},
  raw:{ko:"원시",en:"raw",vi:"thô",id:"mentah"},
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
  menu_wireless:{ko:"무선 센서",en:"Wireless sensors",vi:"Cảm biến không dây",id:"Sensor nirkabel"},
  menu_wireless_sub:{ko:"지그비·433MHz 센서 찾기·등록·상태",en:"Find, add and check Zigbee/433MHz sensors",vi:"Tìm, thêm, kiểm tra cảm biến Zigbee/433MHz",id:"Cari, tambah, cek sensor Zigbee/433MHz"},
  wl_dongle:{ko:"지그비 동글",en:"Zigbee dongle",vi:"USB Zigbee",id:"Dongle Zigbee"},
  wl_z2m:{ko:"지그비 서버",en:"Zigbee2MQTT",vi:"Zigbee2MQTT",id:"Zigbee2MQTT"},
  wl_collector:{ko:"수집기",en:"Collector",vi:"Bộ thu",id:"Kolektor"},
  wl_rf:{ko:"433MHz 수신기",en:"433MHz receiver",vi:"Bộ thu 433MHz",id:"Penerima 433MHz"},
  wl_not_installed:{ko:"무선 수집 프로그램이 아직 설치되지 않았습니다. 지그비 동글을 꽂고 PC에서 한 번만 실행하세요:",en:"The wireless collector isn't installed yet. Plug in the Zigbee dongle and run once from a PC:",vi:"Chưa cài chương trình thu không dây. Cắm USB Zigbee và chạy một lần từ máy tính:",id:"Kolektor nirkabel belum terpasang. Pasang dongle Zigbee lalu jalankan sekali dari PC:"},
  wl_find:{ko:"＋ 새 센서 찾기 (2분)",en:"+ Find new sensors (2 min)",vi:"+ Tìm cảm biến mới (2 phút)",id:"+ Cari sensor baru (2 mnt)"},
  wl_finding:{ko:"찾는 중 {m}:{s} — 센서의 버튼을 5초 길게 누르세요 (누르면 중지)",en:"Searching {m}:{s} — hold the sensor's button 5 s (tap to stop)",vi:"Đang tìm {m}:{s} — giữ nút cảm biến 5 giây (chạm để dừng)",id:"Mencari {m}:{s} — tahan tombol sensor 5 dtk (ketuk untuk berhenti)"},
  wl_new:{ko:"새로 찾은 센서",en:"Newly found",vi:"Mới tìm thấy",id:"Baru ditemukan"},
  wl_registered:{ko:"등록된 센서",en:"Registered",vi:"Đã đăng ký",id:"Terdaftar"},
  wl_none:{ko:"등록된 센서가 없습니다. [새 센서 찾기]를 누르고 센서 버튼을 길게 누르세요.",en:"No sensors yet. Tap [Find new sensors] and hold the sensor's button.",vi:"Chưa có cảm biến. Chạm [Tìm cảm biến mới] rồi giữ nút cảm biến.",id:"Belum ada sensor. Ketuk [Cari sensor baru] lalu tahan tombol sensor."},
  wl_add:{ko:"등록",en:"Add",vi:"Thêm",id:"Tambah"},
  wl_remove:{ko:"빼기",en:"Remove",vi:"Gỡ",id:"Hapus"},
  wl_remove_sure:{ko:"정말 빼기",en:"Really remove",vi:"Gỡ thật",id:"Yakin hapus"},
  wl_pick_kind:{ko:"무엇을 재는 센서인가요?",en:"What does this sensor measure?",vi:"Cảm biến này đo gì?",id:"Sensor ini mengukur apa?"},
  wl_pick_zone:{ko:"어디에 달았나요?",en:"Where is it installed?",vi:"Lắp ở đâu?",id:"Dipasang di mana?"},
  wl_name_will:{ko:"이름: {n} — 장비·웹 화면에 이 이름으로 나옵니다",en:"Name: {n} — shown on the device and web",vi:"Tên: {n} — hiển thị trên thiết bị và web",id:"Nama: {n} — tampil di perangkat dan web"},
  wl_added_zb:{ko:"{n} 등록했습니다. 배터리 센서는 잠들어 있다가 값이 바뀔 때만 보냅니다 — 센서 버튼을 한 번 짧게 누르면 바로 들어옵니다.",en:"Added {n}. Battery sensors sleep and report only on change — tap the sensor's button once to send now.",vi:"Đã thêm {n}. Cảm biến pin chỉ gửi khi giá trị đổi — nhấn nút cảm biến một lần để gửi ngay.",id:"{n} ditambahkan. Sensor baterai hanya mengirim saat nilai berubah — tekan tombol sensor sekali untuk mengirim sekarang."},
  wl_added:{ko:"{n} 등록했습니다. 몇 초 안에 값이 들어옵니다.",en:"Added {n}. Values arrive within seconds.",vi:"Đã thêm {n}. Giá trị sẽ có sau vài giây.",id:"{n} ditambahkan. Nilai masuk dalam beberapa detik."},
  wl_removed:{ko:"뺐습니다. 같은 센서를 다시 쓰려면 다시 찾기로 붙이세요.",en:"Removed. To reuse it, find it again.",vi:"Đã gỡ. Muốn dùng lại, hãy tìm lại.",id:"Dihapus. Untuk memakai lagi, cari ulang."},
  wl_enable:{ko:"환경·기상 표시가 꺼져 있어 등록한 센서 값이 화면에 안 나옵니다.",en:"Environment display is off, so sensor values aren't shown.",vi:"Hiển thị môi trường đang tắt nên không thấy giá trị.",id:"Tampilan lingkungan mati, nilai sensor tidak tampil."},
  wl_enable_btn:{ko:"켜기 (프로그램 다시 시작)",en:"Turn on (restart)",vi:"Bật (khởi động lại)",id:"Nyalakan (mulai ulang)"},
  wl_never:{ko:"수신 없음",en:"no data yet",vi:"chưa có dữ liệu",id:"belum ada data"},
  wl_ago:{ko:"{m}분 전",en:"{m} min ago",vi:"{m} phút trước",id:"{m} mnt lalu"},
  wl_now:{ko:"방금",en:"just now",vi:"vừa xong",id:"baru saja"},
  wl_batt:{ko:"배터리 {v}%",en:"battery {v}%",vi:"pin {v}%",id:"baterai {v}%"},
  wl_lqi:{ko:"신호 {v}",en:"signal {v}",vi:"tín hiệu {v}",id:"sinyal {v}"},
  wl_unpaired:{ko:"페어링 끊김 — 다시 찾기 필요",en:"not paired — find again",vi:"mất ghép đôi — tìm lại",id:"tidak terpasang — cari ulang"},
  wl_interview:{ko:"정보 읽는 중 — 끝날 때까지 센서 버튼을 몇 초마다 짧게 눌러 깨워 두세요",en:"reading info — tap the sensor's button every few seconds to keep it awake",vi:"đang đọc thông tin — nhấn nút cảm biến vài giây một lần để giữ thức",id:"membaca info — tekan tombol sensor tiap beberapa detik agar tetap aktif"},
  wl_unsupported:{ko:"지원 목록에 없는 기기",en:"unsupported device",vi:"thiết bị chưa hỗ trợ",id:"perangkat tidak didukung"},
  wlk_canopy:{ko:"초관부 온습도 (지상 10cm)",en:"Canopy temp/RH (10 cm)",vi:"Nhiệt/ẩm tán (10 cm)",id:"Suhu/RH kanopi (10 cm)"},
  wlk_air:{ko:"기온 온습도 (2m 폴대)",en:"Air temp/RH (2 m mast)",vi:"Nhiệt/ẩm không khí (2 m)",id:"Suhu/RH udara (2 m)"},
  wlk_soil:{ko:"토양 수분·온도",en:"Soil moisture/temp",vi:"Độ ẩm/nhiệt đất",id:"Kelembapan/suhu tanah"},
  "wlk_breaker-pump":{ko:"차단기 — 관수펌프 회로",en:"Breaker — irrigation pump",vi:"Aptomat — bơm tưới",id:"Pemutus — pompa irigasi"},
  "wlk_breaker-aux":{ko:"차단기 — 그 밖의 회로",en:"Breaker — other circuit",vi:"Aptomat — mạch khác",id:"Pemutus — sirkuit lain"},
  wlk_leak:{ko:"누수 감지",en:"Water leak",vi:"Rò nước",id:"Kebocoran air"},
  wlk_valve:{ko:"관수 밸브·유량",en:"Valve / flow",vi:"Van / lưu lượng",id:"Katup / aliran"},
  wl_rf_title:{ko:"433MHz 센서 (기상센서·무선 토양센서 등)",en:"433MHz sensors (weather station, soil …)",vi:"Cảm biến 433MHz (trạm thời tiết, đất …)",id:"Sensor 433MHz (stasiun cuaca, tanah …)"},
  wl_rf_heard:{ko:"근처에서 들리는 센서",en:"Heard nearby",vi:"Nghe thấy gần đây",id:"Terdengar di sekitar"},
  wl_rf_none:{ko:"등록된 433MHz 센서가 없습니다. 센서 전원을 켜면 1분 안에 '근처에서 들리는 센서'에 뜹니다.",en:"No 433MHz sensors yet. Power the sensor on; it appears under 'Heard nearby' within a minute.",vi:"Chưa có cảm biến 433MHz. Bật nguồn cảm biến; sẽ hiện trong 1 phút.",id:"Belum ada sensor 433MHz. Nyalakan sensor; muncul dalam 1 menit."},
  wl_rf_off:{ko:"433MHz 수신기(RTL-SDR 동글)가 없거나 수집기가 꺼져 있습니다. 동글을 꽂고 설치 명령을 다시 실행하세요.",en:"No 433MHz receiver (RTL-SDR) or the collector is off. Plug it in and re-run the installer.",vi:"Không có bộ thu 433MHz hoặc bộ thu đang tắt. Cắm vào rồi chạy lại cài đặt.",id:"Tidak ada penerima 433MHz atau kolektor mati. Pasang lalu jalankan ulang pemasang."},
  wl_rf_seen:{ko:"{n}회 · {ago}",en:"{n}× · {ago}",vi:"{n} lần · {ago}",id:"{n}× · {ago}"},
  wl_rf_rssi:{ko:"세기 {v}dB",en:"{v} dB",vi:"{v} dB",id:"{v} dB"},
  wl_rf_default:{ko:"기본 설정으로 이 모델은 이미 받는 중 — 등록하면 이 센서만 받습니다(이웃집 같은 모델 제외)",en:"This model is already received by default — adding limits it to this unit",vi:"Mẫu này đã được nhận mặc định — thêm để chỉ nhận thiết bị này",id:"Model ini sudah diterima — menambah membatasi ke unit ini"},
  wl_rf_other:{ko:"그 밖에 센서가 아닌 433MHz 신호 {n}개(타이어 공기압계·초인종 등)는 숨겼습니다.",en:"{n} other 433MHz signals (tyre sensors, doorbells …) hidden.",vi:"Đã ẩn {n} tín hiệu 433MHz khác.",id:"{n} sinyal 433MHz lain disembunyikan."},
  wl_rf_tip:{ko:"433MHz 는 페어링이 없습니다. 같은 모델이 여러 대면 센서 뒷면 버튼으로 채널·전원을 껐다 켜서, 방금 '1회'로 새로 뜬 것을 고르세요.",en:"433MHz has no pairing. If several of the same model appear, power-cycle yours and pick the one that just appeared.",vi:"433MHz không ghép đôi. Nếu nhiều thiết bị cùng mẫu, tắt/bật thiết bị của bạn rồi chọn cái vừa hiện.",id:"433MHz tanpa pairing. Jika banyak model sama, nyalakan ulang milik Anda dan pilih yang baru muncul."},
  wlr_weather:{ko:"기상센서 (WS90 등)",en:"Weather station (WS90 …)",vi:"Trạm thời tiết (WS90 …)",id:"Stasiun cuaca (WS90 …)"},
  wlr_soil:{ko:"토양수분 (WH51)",en:"Soil moisture (WH51)",vi:"Độ ẩm đất (WH51)",id:"Kelembapan tanah (WH51)"},
  wlr_canopy:{ko:"초관부 온습도 (지상 10cm)",en:"Canopy temp/RH (10 cm)",vi:"Nhiệt/ẩm tán (10 cm)",id:"Suhu/RH kanopi (10 cm)"},
  wlr_air:{ko:"기온 온습도 (2m)",en:"Air temp/RH (2 m)",vi:"Nhiệt/ẩm không khí (2 m)",id:"Suhu/RH udara (2 m)"},
  wlr_leaf:{ko:"엽면습윤 (WH35)",en:"Leaf wetness (WH35)",vi:"Độ ướt lá (WH35)",id:"Kebasahan daun (WH35)"},
  wlr_rain:{ko:"우량계 (WH40)",en:"Rain gauge (WH40)",vi:"Đo mưa (WH40)",id:"Penakar hujan (WH40)"},
  wl_ble_title:{ko:"블루투스 토양센서 (투야)",en:"Bluetooth soil sensors (Tuya)",vi:"Cảm biến đất Bluetooth (Tuya)",id:"Sensor tanah Bluetooth (Tuya)"},
  wl_ble_soil:{ko:"토양수분·지온",en:"Soil moisture · soil temp",vi:"Độ ẩm đất · nhiệt độ đất",id:"Kelembapan tanah · suhu tanah"},
  wl_ble_off:{ko:"블루투스 수집기가 꺼져 있습니다 — 저장소 폴더에서 sudo bash setup-tuya-ble.sh",en:"Bluetooth collector is off — run sudo bash setup-tuya-ble.sh in the repo folder",vi:"Bộ thu Bluetooth đang tắt — chạy sudo bash setup-tuya-ble.sh",id:"Pengumpul Bluetooth mati — jalankan sudo bash setup-tuya-ble.sh"},
  wl_ble_none:{ko:"등록된 블루투스 센서가 없습니다",en:"No Bluetooth sensors registered",vi:"Chưa có cảm biến Bluetooth",id:"Belum ada sensor Bluetooth"},
  wl_ble_tip:{ko:"센서는 먼저 휴대폰 투야 앱에 붙여 두세요. 앱에서 다시 붙였으면 [투야에서 센서 가져오기] 를 한 번 누르세요 — 바뀐 열쇠를 새로 받습니다.",en:"Pair the sensor in the Tuya phone app first. Removing it from the app changes its key — fetch again.",vi:"Ghép cảm biến trong app Tuya trước. Xóa khỏi app sẽ đổi khóa — cần lấy lại.",id:"Pasangkan sensor di aplikasi Tuya dulu. Menghapusnya mengubah kunci — ambil ulang."},
  wl_ble_setup:{ko:"블루투스 준비가 아직 안 됐습니다. 터미널에서 한 번만 실행하세요(인터넷 필요):",en:"Bluetooth isn't set up yet. Run once in a terminal (needs internet):",vi:"Chưa cài Bluetooth. Chạy một lần trong terminal (cần internet):",id:"Bluetooth belum disiapkan. Jalankan sekali di terminal (perlu internet):"},
  wl_ble_fetch:{ko:"투야에서 센서 가져오기",en:"Fetch sensors from Tuya",vi:"Lấy cảm biến từ Tuya",id:"Ambil sensor dari Tuya"},
  wl_ble_change:{ko:"투야 열쇠 바꾸기",en:"Change Tuya keys",vi:"Đổi khóa Tuya",id:"Ganti kunci Tuya"},
  wl_ble_forget:{ko:"저장한 열쇠 지우기",en:"Forget saved keys",vi:"Xóa khóa đã lưu",id:"Hapus kunci tersimpan"},
  wl_ble_forgot:{ko:"투야 열쇠를 지웠습니다.",en:"Tuya keys removed.",vi:"Đã xóa khóa Tuya.",id:"Kunci Tuya dihapus."},
  wl_ble_fetching:{ko:"투야 클라우드에서 받는 중… (최대 1분)",en:"Fetching from Tuya cloud… (up to 1 min)",vi:"Đang lấy từ Tuya… (tối đa 1 phút)",id:"Mengambil dari Tuya… (maks 1 menit)"},
  wl_ble_fetched:{ko:"블루투스 기기 {n}대를 받았습니다.",en:"Got {n} Bluetooth devices.",vi:"Đã nhận {n} thiết bị Bluetooth.",id:"Dapat {n} perangkat Bluetooth."},
  wl_ble_updated:{ko:"{n} 의 열쇠를 새로 받았습니다(앱에서 다시 붙인 센서).",en:"New keys saved for {n} (re-paired in the app).",vi:"Đã cập nhật khóa cho {n}.",id:"Kunci baru disimpan untuk {n}."},
  wl_ble_new:{ko:"투야 앱에 있는 블루투스 센서",en:"Bluetooth sensors in the Tuya app",vi:"Cảm biến Bluetooth trong app Tuya",id:"Sensor Bluetooth di aplikasi Tuya"},
  wl_ble_all:{ko:"투야 앱의 블루투스 센서가 모두 등록돼 있습니다.",en:"All Bluetooth sensors from the Tuya app are registered.",vi:"Đã đăng ký tất cả cảm biến Bluetooth.",id:"Semua sensor Bluetooth sudah terdaftar."},
  wl_ble_cred_hint:{ko:"투야 개발자 사이트(platform.tuya.com) 프로젝트 Overview 의 Access ID·Access Secret 을 넣으세요. 한 번 넣으면 장비에 저장됩니다.",en:"Enter the Access ID and Secret from your project Overview at platform.tuya.com. They are saved on this device.",vi:"Nhập Access ID và Secret từ Overview dự án trên platform.tuya.com. Sẽ được lưu.",id:"Masukkan Access ID dan Secret dari Overview proyek di platform.tuya.com. Disimpan di perangkat."},
  wl_ble_id:{ko:"Access ID (Client ID)",en:"Access ID (Client ID)",vi:"Access ID (Client ID)",id:"Access ID (Client ID)"},
  wl_ble_sec:{ko:"Access Secret (Client Secret)",en:"Access Secret (Client Secret)",vi:"Access Secret (Client Secret)",id:"Access Secret (Client Secret)"},
  wl_ble_next:{ko:"다음 칸 ↓",en:"Next ↓",vi:"Tiếp ↓",id:"Berikut ↓"},
  wl_ble_prev:{ko:"위 칸 ↑",en:"Back ↑",vi:"Lên ↑",id:"Atas ↑"},
  wl_eco_title:{ko:"에코윗 게이트웨이 (와이파이)",en:"Ecowitt gateway (Wi-Fi)",vi:"Gateway Ecowitt (Wi-Fi)",id:"Gateway Ecowitt (Wi-Fi)"},
  wl_eco_setup:{ko:"게이트웨이(GW1100·GW2000 등)를 농장 와이파이에 연결한 뒤 WS View Plus 앱 → 기기 → [Customized] 에서 '프로토콜: Ecowitt' 을 고르고 아래 값을 적어 저장하세요. 1~2분 안에 여기에 뜹니다.",en:"Connect the gateway (GW1100, GW2000 …) to the farm Wi-Fi, then in the WS View Plus app → device → [Customized] choose 'Protocol: Ecowitt', enter the values below and save. It appears here within 1–2 minutes.",vi:"Kết nối gateway (GW1100, GW2000 …) vào Wi-Fi, rồi trong ứng dụng WS View Plus → thiết bị → [Customized] chọn 'Protocol: Ecowitt', nhập các giá trị dưới đây và lưu. Sẽ hiện trong 1–2 phút.",id:"Hubungkan gateway (GW1100, GW2000 …) ke Wi-Fi, lalu di aplikasi WS View Plus → perangkat → [Customized] pilih 'Protocol: Ecowitt', isi nilai di bawah dan simpan. Muncul dalam 1–2 menit."},
  wl_eco_server:{ko:"서버",en:"Server",vi:"Máy chủ",id:"Server"},
  wl_eco_port:{ko:"포트",en:"Port",vi:"Cổng",id:"Port"},
  wl_eco_path:{ko:"경로",en:"Path",vi:"Đường dẫn",id:"Path"},
  wl_eco_interval:{ko:"간격",en:"Interval",vi:"Chu kỳ",id:"Interval"},
  wl_eco_noip:{ko:"(망 연결 확인 필요)",en:"(check network)",vi:"(kiểm tra mạng)",id:"(periksa jaringan)"},
  wl_eco_off:{ko:"에코윗 수신기가 꺼져 있습니다. 설치 명령을 다시 실행하세요.",en:"The Ecowitt receiver is off. Re-run the installer.",vi:"Bộ nhận Ecowitt đang tắt. Chạy lại cài đặt.",id:"Penerima Ecowitt mati. Jalankan ulang pemasang."},
  wl_eco_heard:{ko:"들어온 게이트웨이",en:"Gateways reporting",vi:"Gateway đang gửi",id:"Gateway yang mengirim"},
  wl_eco_mine:{ko:"등록됨",en:"registered",vi:"đã đăng ký",id:"terdaftar"},
  wl_eco_notmine:{ko:"등록 안 됨 — 받지 않음",en:"not registered — ignored",vi:"chưa đăng ký — bỏ qua",id:"tidak terdaftar — diabaikan"},
  wl_eco_new:{ko:"게이트웨이에 붙은 센서",en:"Sensors on the gateway",vi:"Cảm biến trên gateway",id:"Sensor di gateway"},
  wl_eco_none:{ko:"등록된 에코윗 센서가 없습니다.",en:"No Ecowitt sensors registered.",vi:"Chưa có cảm biến Ecowitt.",id:"Belum ada sensor Ecowitt."},
  wl_eco_gw:{ko:"게이트웨이 기상센서",en:"Gateway weather station",vi:"Trạm thời tiết của gateway",id:"Stasiun cuaca gateway"},
  wl_eco_gw_tip:{ko:"433MHz 로 받던 같은 기상센서가 있으면 그 칸을 걷고 이름을 이어받습니다(비가 두 번 더해지지 않게).",en:"If the same weather station was received over 433MHz, that entry is replaced and its name kept (so rain isn't counted twice).",vi:"Nếu trạm này đang nhận qua 433MHz, mục đó được thay thế và giữ tên (tránh cộng mưa hai lần).",id:"Jika stasiun yang sama diterima lewat 433MHz, entri itu diganti dan namanya dipertahankan (hujan tidak dihitung dua kali)."},
  wl_eco_ch:{ko:"채널 {n}",en:"channel {n}",vi:"kênh {n}",id:"kanal {n}"},
  wlf_soil:{ko:"토양수분 (WH51)",en:"Soil moisture (WH51)",vi:"Độ ẩm đất (WH51)",id:"Kelembapan tanah (WH51)"},
  wlf_tf:{ko:"지온 프로브 (WN34)",en:"Soil temp probe (WN34)",vi:"Đầu dò nhiệt đất (WN34)",id:"Probe suhu tanah (WN34)"},
  wlf_leaf:{ko:"엽면습윤 (WH35)",en:"Leaf wetness (WH35)",vi:"Độ ướt lá (WH35)",id:"Kebasahan daun (WH35)"},
  wlf_th:{ko:"온습도계 (WH31)",en:"Temp/RH (WH31)",vi:"Nhiệt/ẩm (WH31)",id:"Suhu/RH (WH31)"},
  wlr_soiltemp:{ko:"지온 (WN34)",en:"Soil temp (WN34)",vi:"Nhiệt đất (WN34)",id:"Suhu tanah (WN34)"},
  wlz_treatment:{ko:"적용구간",en:"Treatment plot",vi:"Khu áp dụng",id:"Petak perlakuan"},
  wlz_control:{ko:"비교구간",en:"Control plot",vi:"Khu đối chứng",id:"Petak kontrol"},
  wlz_facility:{ko:"시설 (분전반·펌프실)",en:"Facility (panel/pump)",vi:"Cơ sở (tủ điện/bơm)",id:"Fasilitas (panel/pompa)"},
  wlz_mast:{ko:"기상 폴대",en:"Weather mast",vi:"Cột khí tượng",id:"Tiang cuaca"},
  menu_power:{ko:"전력 회로",en:"Power circuits",vi:"Mạch điện",id:"Sirkuit listrik"},
  menu_power_sub:{ko:"차단기마다 연결된 기기 종류 고르기",en:"Choose what each breaker feeds",vi:"Chọn thiết bị cho từng aptomat",id:"Pilih perangkat tiap pemutus"},
  pw_title:{ko:"전력 회로",en:"Power circuits",vi:"Mạch điện",id:"Sirkuit listrik"},
  pw_total:{ko:"전체",en:"Total",vi:"Tổng",id:"Total"},
  pw_total_partial:{ko:"계측 회로 합",en:"Metered sum",vi:"Tổng đo được",id:"Jumlah terukur"},
  pw_today:{ko:"오늘",en:"Today",vi:"Hôm nay",id:"Hari ini"},
  pw_on:{ko:"켜짐",en:"ON",vi:"BẬT",id:"NYALA"},
  pw_off:{ko:"꺼짐",en:"OFF",vi:"TẮT",id:"MATI"},
  pw_lost:{ko:"끊김",en:"No signal",vi:"Mất tín hiệu",id:"Terputus"},
  pw_none:{ko:"계측 차단기 값이 들어오지 않습니다 — 지그비 수집기(zigbee_bridge)와 차단기 페어링을 확인하세요",en:"No breaker readings — check the Zigbee collector (zigbee_bridge) and breaker pairing",vi:"Không có dữ liệu aptomat — kiểm tra bộ thu Zigbee (zigbee_bridge) và ghép nối",id:"Tidak ada data pemutus — periksa kolektor Zigbee (zigbee_bridge) dan pairing"},
  pw_hot_warn:{ko:"차단기 온도 높음 — {name} {t}℃",en:"Breaker running hot — {name} {t}℃",vi:"Aptomat nóng — {name} {t}℃",id:"Pemutus panas — {name} {t}℃"},
  pw_hot_crit:{ko:"차단기 과열 — {name} {t}℃",en:"Breaker overheating — {name} {t}℃",vi:"Aptomat quá nhiệt — {name} {t}℃",id:"Pemutus terlalu panas — {name} {t}℃"},
  pw_hot_do:{ko:"부하·단자 조임 점검",en:"Check load and terminals",vi:"Kiểm tra tải và đầu nối",id:"Periksa beban dan terminal"},
  pw_pick:{ko:"이 차단기에 연결된 기기를 고르세요",en:"Choose what this breaker feeds",vi:"Chọn thiết bị nối với aptomat này",id:"Pilih perangkat pada pemutus ini"},
  pw_change:{ko:"바꾸기",en:"Change",vi:"Đổi",id:"Ubah"},
  pw_saved:{ko:"바꿨습니다.",en:"Changed.",vi:"Đã đổi.",id:"Diubah."},
  pc_title:{ko:"켜고 끄기 · 예약",en:"On/off · schedule",vi:"Bật/tắt · hẹn giờ",id:"Nyala/mati · jadwal"},
  pc_turn_on:{ko:"켜기",en:"Turn on",vi:"Bật",id:"Nyalakan"},
  pc_turn_off:{ko:"끄기",en:"Turn off",vi:"Tắt",id:"Matikan"},
  pc_setup:{ko:"예약",en:"Schedule",vi:"Hẹn giờ",id:"Jadwal"},
  pc_back_auto:{ko:"예약대로",en:"Back to schedule",vi:"Theo lịch",id:"Ikuti jadwal"},
  pc_manual:{ko:"수동",en:"Manual",vi:"Thủ công",id:"Manual"},
  pc_timer:{ko:"시간 예약",en:"Timer",vi:"Hẹn giờ",id:"Timer"},
  pc_cycle:{ko:"반복 간격",en:"Repeat interval",vi:"Lặp chu kỳ",id:"Interval berulang"},
  pc_cycle_s:{ko:"{on} 켜고 {off} 쉬기",en:"{on} on / {off} off",vi:"Bật {on} / nghỉ {off}",id:"{on} nyala / {off} mati"},
  pc_h:{ko:"{n}시간",en:"{n} h",vi:"{n} giờ",id:"{n} jam"},
  pc_m:{ko:"{n}분",en:"{n} min",vi:"{n} phút",id:"{n} mnt"},
  pc_none:{ko:"안 함",en:"Off",vi:"Không",id:"Tidak"},
  pc_everyday:{ko:"매일",en:"Every day",vi:"Hằng ngày",id:"Setiap hari"},
  pc_d0:{ko:"월",en:"Mon",vi:"T2",id:"Sen"},
  pc_d1:{ko:"화",en:"Tue",vi:"T3",id:"Sel"},
  pc_d2:{ko:"수",en:"Wed",vi:"T4",id:"Rab"},
  pc_d3:{ko:"목",en:"Thu",vi:"T5",id:"Kam"},
  pc_d4:{ko:"금",en:"Fri",vi:"T6",id:"Jum"},
  pc_d5:{ko:"토",en:"Sat",vi:"T7",id:"Sab"},
  pc_d6:{ko:"일",en:"Sun",vi:"CN",id:"Min"},
  pc_held_on:{ko:"손으로 켬",en:"Held on",vi:"Đang giữ bật",id:"Ditahan nyala"},
  pc_held_off:{ko:"손으로 끔",en:"Held off",vi:"Đang giữ tắt",id:"Ditahan mati"},
  pc_until:{ko:"{t}까지",en:"until {t}",vi:"đến {t}",id:"sampai {t}"},
  pc_pending:{ko:"차단기 응답 기다리는 중",en:"Waiting for breaker",vi:"Đang chờ aptomat",id:"Menunggu pemutus"},
  pc_pick_mode:{ko:"어떻게 켜고 끌까요?",en:"How should it switch?",vi:"Bật/tắt thế nào?",id:"Bagaimana menyalakan?"},
  pc_timer_hint:{ko:"정한 시각에 켜고 끕니다. 끄는 시각이 더 이르면 다음 날 끕니다.",en:"Turns on and off at set times. An off time earlier than on means next day.",vi:"Bật/tắt theo giờ. Giờ tắt sớm hơn nghĩa là ngày hôm sau.",id:"Nyala/mati pada jam tertentu. Jam mati lebih awal berarti besoknya."},
  pc_cycle_hint:{ko:"가동 시간대 안에서 켜기·쉬기를 되풀이합니다.",en:"Repeats on/off within the active hours.",vi:"Lặp bật/nghỉ trong khung giờ.",id:"Mengulang nyala/mati dalam jam aktif."},
  pc_on_at:{ko:"켜는 시각",en:"On at",vi:"Giờ bật",id:"Jam nyala"},
  pc_off_at:{ko:"끄는 시각",en:"Off at",vi:"Giờ tắt",id:"Jam mati"},
  pc_run:{ko:"켜 두는 시간",en:"Run for",vi:"Chạy trong",id:"Nyala selama"},
  pc_rest:{ko:"쉬는 시간",en:"Rest for",vi:"Nghỉ trong",id:"Mati selama"},
  pc_from:{ko:"시작",en:"From",vi:"Từ",id:"Dari"},
  pc_to:{ko:"끝",en:"To",vi:"Đến",id:"Sampai"},
  pc_add:{ko:"예약 더하기",en:"Add time",vi:"Thêm giờ",id:"Tambah jadwal"},
  pc_del:{ko:"빼기",en:"Remove",vi:"Xóa",id:"Hapus"},
  pc_autooff:{ko:"손으로 켜면 자동 끄기",en:"Auto-off after manual on",vi:"Tự tắt sau khi bật tay",id:"Mati otomatis setelah dinyalakan manual"},
  pc_autooff_s:{ko:"켜면 {m} 뒤 끔",en:"auto-off {m}",vi:"tự tắt sau {m}",id:"mati setelah {m}"},
  pc_autooff_hint:{ko:"관수펌프를 켜 두고 잊어도 정한 시간 뒤 꺼집니다.",en:"A pump left on is switched off after this time.",vi:"Bơm quên tắt sẽ tự tắt sau thời gian này.",id:"Pompa yang lupa dimatikan akan mati setelah waktu ini."},
  pc_quick:{ko:"지금 잠깐 켜기",en:"Run now for",vi:"Chạy ngay trong",id:"Nyalakan sekarang selama"},
  pc_saved:{ko:"예약을 저장했습니다.",en:"Schedule saved.",vi:"Đã lưu lịch.",id:"Jadwal disimpan."},
  pc_aerator_sure:{ko:"산소공급기를 끕니다. 정말 끄려면 [끄기]를 한 번 더 누르세요.",en:"This turns the aerator off. Tap [Turn off] again to confirm.",vi:"Sẽ tắt máy sục khí. Nhấn [Tắt] lần nữa để xác nhận.",id:"Aerator akan dimatikan. Tekan [Matikan] lagi untuk konfirmasi."},
  pc_clock:{ko:"장비 시계가 맞지 않아 예약이 멈춰 있습니다 — 인터넷에 연결하면 시계가 맞춰집니다.",en:"Device clock is wrong, schedules paused — connect to the internet to sync.",vi:"Đồng hồ sai, lịch tạm dừng — kết nối internet để đồng bộ.",id:"Jam perangkat salah, jadwal berhenti — sambungkan internet."},
  pc_do:{ko:"산소량 연동",en:"By oxygen (DO)",vi:"Theo oxy (DO)",id:"Sesuai oksigen (DO)"},
  pc_do_s:{ko:"산소 {lo} 이하 켜기 · {hi} 이상 끄기",en:"On ≤ {lo} · off ≥ {hi} mg/L",vi:"Bật ≤ {lo} · tắt ≥ {hi} mg/L",id:"Nyala ≤ {lo} · mati ≥ {hi} mg/L"},
  pc_do_hint:{ko:"용존산소가 낮아지면 켜고 충분히 오르면 끕니다. 산소값이 10분 넘게 없으면 켜 둡니다.",en:"Turns on when DO drops and off when it recovers. If DO is missing for 10 min it stays on.",vi:"Bật khi DO giảm, tắt khi phục hồi. Mất DO 10 phút thì giữ bật.",id:"Nyala saat DO turun, mati saat pulih. Jika DO hilang 10 mnt tetap nyala."},
  pc_do_on:{ko:"이 값 이하이면 켜기",en:"Turn on at or below",vi:"Bật khi ≤",id:"Nyala jika ≤"},
  pc_do_off:{ko:"이 값 이상이면 끄기",en:"Turn off at or above",vi:"Tắt khi ≥",id:"Mati jika ≥"},
  pc_do_minon:{ko:"켜면 최소 가동",en:"Minimum run",vi:"Chạy tối thiểu",id:"Minimal nyala"},
  pc_do_bad:{ko:"끄는 기준은 켜는 기준보다 높아야 합니다.",en:"The off level must be above the on level.",vi:"Mức tắt phải cao hơn mức bật.",id:"Batas mati harus di atas batas nyala."},
  pc_do_now:{ko:"산소 {v} mg/L",en:"DO {v} mg/L",vi:"DO {v} mg/L",id:"DO {v} mg/L"},
  pc_do_none:{ko:"지금 산소값이 없습니다 — DO 센서를 켜야 연동됩니다(없으면 계속 켜 둡니다).",en:"No DO reading now — enable the DO sensor (without it the circuit stays on).",vi:"Chưa có DO — bật cảm biến DO (không có thì giữ bật).",id:"Belum ada DO — aktifkan sensor DO (tanpa itu tetap nyala)."},
  pc_guard:{ko:"산소 부족 시 강제 켜기",en:"Force on when DO is low",vi:"Bắt buộc bật khi DO thấp",id:"Paksa nyala saat DO rendah"},
  pc_guard_hint:{ko:"예약·손 조작과 관계없이, 산소가 이 값 이하로 떨어지면 켭니다(1 mg/L 회복하면 풀림).",en:"Regardless of schedule or manual off, turns on when DO falls to this level (released after +1 mg/L).",vi:"Bất kể lịch, bật khi DO xuống mức này (+1 mg/L thì bỏ).",id:"Abaikan jadwal, nyala saat DO turun ke batas ini (lepas setelah +1 mg/L)."},
  pc_guard_s:{ko:"산소 {v}↓ 강제 켜기",en:"force on at DO ≤ {v}",vi:"bật khi DO ≤ {v}",id:"paksa nyala DO ≤ {v}"},
  pc_forced:{ko:"산소 부족 — 강제로 켬",en:"Low DO — forced on",vi:"DO thấp — đã bật",id:"DO rendah — dipaksa nyala"},
  pc_now:{ko:"지금 {t}",en:"Now {t}",vi:"Bây giờ {t}",id:"Sekarang {t}"},
  pwt_main:{ko:"전체(인입)",en:"Main incomer",vi:"Tổng (đầu vào)",id:"Utama (masuk)"},
  pwt_aerator:{ko:"산소공급기·브로워",en:"Aerator / blower",vi:"Máy sục khí",id:"Aerator / blower"},
  pwt_circulation_pump:{ko:"순환펌프",en:"Circulation pump",vi:"Bơm tuần hoàn",id:"Pompa sirkulasi"},
  pwt_irrigation_pump:{ko:"관수펌프",en:"Irrigation pump",vi:"Bơm tưới",id:"Pompa irigasi"},
  pwt_heater:{ko:"히터·난방",en:"Heater",vi:"Máy sưởi",id:"Pemanas"},
  pwt_ventilation:{ko:"환기팬",en:"Ventilation fan",vi:"Quạt thông gió",id:"Kipas ventilasi"},
  pwt_cooling:{ko:"냉방·제습",en:"Cooling / dehumidifier",vi:"Làm mát / hút ẩm",id:"Pendingin / dehumidifier"},
  pwt_lighting:{ko:"조명·보광",en:"Lighting",vi:"Chiếu sáng",id:"Pencahayaan"},
  pwt_uv:{ko:"UV 살균기",en:"UV sterilizer",vi:"Đèn UV",id:"Sterilisator UV"},
  pwt_dosing:{ko:"양액 도징펌프",en:"Dosing pump",vi:"Bơm định lượng",id:"Pompa dosis"},
  pwt_feeder:{ko:"자동급이기",en:"Auto feeder",vi:"Máy cho ăn",id:"Pemberi pakan"},
  pwt_other:{ko:"기타",en:"Other",vi:"Khác",id:"Lainnya"},
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
  // AI 모드 — 머리의 표시와, 눌렀을 때 열리는 설명판
  ai_mode:{ko:"AI 모드",en:"AI mode",vi:"Chế độ AI",id:"Mode AI"},
  ai_off:{ko:"AI 모드 꺼짐",en:"AI mode off",vi:"Chế độ AI tắt",id:"Mode AI mati"},
  ai_title:{ko:"AI 모드 — 장비가 스스로 하는 일",en:"AI mode — what the device decides on its own",vi:"Chế độ AI — thiết bị tự quyết định gì",id:"Mode AI — apa yang diputuskan perangkat sendiri"},
  ai_l1:{ko:"기준 이탈 판정",en:"Threshold judgement",vi:"Đánh giá ngưỡng",id:"Penilaian ambang"},
  ai_l1d:{ko:"지금 값이 흰다리새우 적정 범위를 벗어났는지. 매 측정마다.",en:"Whether the current value is outside the range for whiteleg shrimp. Every reading.",vi:"Giá trị hiện tại có ngoài ngưỡng tôm thẻ không. Mỗi lần đo.",id:"Apakah nilai saat ini di luar rentang udang vaname. Setiap pengukuran."},
  ai_l2:{ko:"경량 이상탐지",en:"Lightweight anomaly detection",vi:"Phát hiện bất thường nhẹ",id:"Deteksi anomali ringan"},
  ai_l2d:{ko:"급변 · 연속 악화 · 평소 범위 이탈. 기준을 깨기 전에 찾는다.",en:"Surge, sustained drift, deviation from the usual range — found before a limit is crossed.",vi:"Đột biến, xấu đi liên tục, lệch khỏi mức thường — trước khi vượt ngưỡng.",id:"Lonjakan, perburukan terus-menerus, simpangan dari biasanya — sebelum ambang terlampaui."},
  ai_nut_low:{ko:"보충 필요",en:"Dose needed",vi:"Cần bổ sung",id:"Perlu dosis"},
  ai_nut_high:{ko:"교환 필요",en:"Exchange needed",vi:"Cần thay nước",id:"Perlu ganti air"},
  ai_nut_ok:{ko:"적정",en:"OK",vi:"Đạt",id:"Pas"},
  ai_nut_off:{ko:"꺼짐",en:"Off",vi:"Tắt",id:"Mati"},
  ai_l3:{ko:"설비 운전 권고",en:"Equipment action advice",vi:"Khuyến nghị vận hành",id:"Rekomendasi operasi"},
  ai_l3d:{ko:"판정을 「지금 무엇을 돌릴까」 로 바꾼다. 설비를 직접 돌리지는 않는다.",en:"Turns a judgement into what to run now. It does not switch equipment itself.",vi:"Biến đánh giá thành việc cần chạy ngay. Không tự bật thiết bị.",id:"Mengubah penilaian jadi apa yang harus dijalankan. Tidak menyalakan alat sendiri."},
  ai_none:{ko:"없음",en:"none",vi:"không",id:"tidak ada"},
  ai_cases:{ko:"{n}건",en:"{n}",vi:"{n}",id:"{n}"},
  ai_watching:{ko:"{h}시간 · {n}개 점",en:"{h} h · {n} points",vi:"{h} giờ · {n} điểm",id:"{h} jam · {n} titik"},
  ai_local:{ko:"모두 장비 안에서 계산합니다. 서버도 인터넷도 쓰지 않으므로 회선이 끊겨도 그대로 돕니다.",en:"All of this runs inside the device — no server, no internet, so it keeps working when the line drops.",vi:"Tất cả chạy trong thiết bị — không cần máy chủ hay internet, vẫn chạy khi mất mạng.",id:"Semua berjalan di dalam perangkat — tanpa server atau internet, tetap jalan saat koneksi putus."},
  ai_offd:{ko:"판정 모듈이나 측정 이력이 없어 꺼져 있습니다. 측정과 전송은 그대로 됩니다.",en:"Off — the judgement modules or the history store are missing. Measuring and sending still work.",vi:"Đang tắt — thiếu mô-đun đánh giá hoặc lịch sử đo. Vẫn đo và gửi bình thường.",id:"Mati — modul penilaian atau riwayat tidak ada. Pengukuran dan pengiriman tetap jalan."},
  ai_last:{ko:"마지막 추세 분석 {t} · {m}분마다",en:"Last trend pass {t} · every {m} min",vi:"Phân tích xu hướng {t} · mỗi {m} phút",id:"Analisis tren {t} · tiap {m} menit"}
};

// 스마트팜 모드 사전 — 기본 사전 위에 얕게 얹는다. **바뀌는 키만** 적는다.
// 수조→베드, 양식장→농장, 새우 기준→양액 기준. 네 언어 모두 채운다(parity).
var I18N_AGRI = {
  m_temperature:{ko:"양액 온도",en:"Solution temp.",vi:"Nhiệt độ dung dịch",id:"Suhu larutan"},
  pair_step2:{ko:"로그인 → 농장·베드 관리",en:"Log in → Farm & bed management",vi:"Đăng nhập → Quản lý nông trại & luống",id:"Masuk → Kelola kebun & bedeng"},
  pair_step3:{ko:"베드의 <b>센서 기기</b> → <b>코드로 기기 연결</b>",en:"Bed's <b>Sensor devices</b> → <b>Link by code</b>",vi:"<b>Thiết bị cảm biến</b> của luống → <b>Kết nối bằng mã</b>",id:"<b>Perangkat sensor</b> bedeng → <b>Hubungkan via kode</b>"},
  pair_desc:{ko:"Farm365에 로그인한 뒤 아래 코드를 입력하세요<br>연결 전 측정값도 저장해 두었다가 함께 올립니다",en:"Log in to Farm365 and enter the code below<br>Readings taken before linking are stored and uploaded too",vi:"Đăng nhập Farm365 và nhập mã bên dưới<br>Số liệu trước khi kết nối cũng được lưu và tải lên cùng",id:"Masuk ke Farm365 lalu masukkan kode di bawah<br>Data sebelum ditautkan disimpan dan diunggah bersama"},
  nut_atc:{ko:"온도 보정(25℃)",en:"Temp. compensation (25℃)",vi:"Bù nhiệt (25℃)",id:"Kompensasi suhu (25℃)"},
  nut_cal_hint:{ko:"교정값은 실제 원액·원수로 재서 넣어야 보충량이 맞습니다. 시험 통에 원수를 담고 원액을 정량 투입해 오른 EC 를 재세요.",en:"Calibration must be measured with your own stock solution and source water, or the dose will be off. Dose a test bucket and measure the EC rise.",vi:"Phải hiệu chuẩn bằng dung dịch và nước thực tế, nếu không lượng bổ sung sẽ sai. Đo mức tăng EC trong thùng thử.",id:"Kalibrasi harus diukur dengan larutan dan air Anda sendiri, jika tidak dosis akan meleset. Ukur kenaikan EC di ember uji."},
  // 스마트팜에서는 설비 운전 권고(환수·폭기)를 내지 않고 그 자리를 양액 보충 계산이 맡는다.
  ai_l3:{ko:"양액 보충 계산",en:"Nutrient dosing",vi:"Tính bổ sung dinh dưỡng",id:"Perhitungan dosis nutrisi"},
  ai_l3d:{ko:"EC 로 A·B 원액 보충량이나 원수 교환량을 계산한다. 펌프를 직접 돌리지는 않는다.",en:"Works out A/B stock doses or a source-water exchange from EC. It does not run pumps itself.",vi:"Tính lượng A/B cần bổ sung hoặc lượng nước thay từ EC. Không tự chạy bơm.",id:"Menghitung dosis A/B atau penggantian air dari EC. Tidak menjalankan pompa sendiri."},
  ai_l1d:{ko:"지금 값이 양액 재배 적정 범위를 벗어났는지. 매 측정마다.",en:"Whether the current value is outside the range for nutrient solution. Every reading.",vi:"Giá trị hiện tại có ngoài ngưỡng dung dịch dinh dưỡng không. Mỗi lần đo.",id:"Apakah nilai saat ini di luar rentang larutan nutrisi. Setiap pengukuran."}
};

function t(key, vars){
  var e = (isAgri() && I18N_AGRI[key]) || I18N[key];
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
  nutMode = isAgri() || !!d.nutrient;
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
  // 스마트팜은 양액 보충이 주 업무라 값 바로 아래에 크게 놓는다.
  // 양식장은 예전 순서 그대로(권고 → 양액).
  var hot = renderPowerAlert(d);
  // 경고 띠가 서면 값 칸을 조금 줄인다 — 띠가 값을 가리면 안 된다(800×480 은 여유가 없다).
  // 과열 띠나 환경·기상 줄이 함께 서면 값 칸 자리가 줄어든다 — 글자를 줄여 칸이 아래 줄을 덮지 않게.
  var tight = hot || (isAgri() && d.env);
  // 둘 다면(스마트팜에서 차단기 과열) 한 단계 더 — 보조 줄은 접고 숫자만.
  var tighter = hot && isAgri() && d.env;
  var n = orderFor(d).length;
  // 칸 수에 맞춰 줄을 맞춘다 — 2칸은 나란히, 3칸은 한 줄 셋, 4칸은 2×2. 빈 자리를 남기지 않는다.
  var grid = !n ? "" : '<div class="grid' + (n === 2 ? " n2" : n === 3 ? " n3" : n === 1 ? " n1" : "") +
    (tight ? " tight" : "") + (tighter ? " tighter" : "") + '">' + cells + '</div>';
  if (isAgri()) return hot + grid + renderEnv(d, !n) + renderNutrient(d) + renderAdvice(d);
  return hot + grid + renderAdvice(d) + renderNutrient(d);
}

// ── 전력 ────────────────────────────────────────────────────────────────────
// 머리 칩에 전체 kW, 차단기가 뜨거우면 값 격자 위에 경고 띠. 칩이나 띠를 누르면
// 회로판이 열린다. 판정(65·80℃)은 수집기가 limits.BREAKER_TEMP 로 해서 level 로 준다.
var PW_TYPES = ["main","aerator","circulation_pump","irrigation_pump","heater","ventilation",
                "cooling","lighting","uv","dosing","feeder","other"];
var powerOpen = false, pwTypesOpen = false, pwEdit = null, pwMsg = null;

function pwName(c){ return t("pwt_" + c.type) + (c.type === "other" ? " " + c.id : ""); }
function kw(w){ return (w / 1000).toFixed(w >= 10000 ? 1 : 2); }

function renderPowerChip(d){
  var el = document.getElementById("pw");
  var p = d.power;
  if (!p) { el.innerHTML = ""; el.className = "pw"; return; }
  el.className = "pw" + (p.level ? " " + p.level : "");
  el.innerHTML = '<span class="bolt">\u26A1</span>' +
    (p.total_w === null || p.total_w === undefined ? "--" : kw(p.total_w)) + " kW";
}

function hottest(p){
  var list = (p && p.circuits || []).filter(function(c){ return c.level; });
  list.sort(function(a, b){ return (b.temp || 0) - (a.temp || 0); });
  return list[0] || null;
}

function renderPowerAlert(d){
  var c = hottest(d.power);
  if (!c) return "";
  var key = c.level === "crit" ? "pw_hot_crit" : "pw_hot_warn";
  return '<div class="pwalert ' + c.level + '" onclick="openPower()">\u26A0 ' +
    esc(t(key, {name: pwName(c), t: c.temp.toFixed(0)})) +
    '<span class="why">' + t("pw_hot_do") + ' \u203A</span></div>';
}

function openPower(){ powerOpen = true; drawPower(lastState || {}); }
function closePower(){ powerOpen = false; pwCtl = null; pwDraft = null; pwCtlMsg = null; pwSure = null; document.getElementById("powerpanel").innerHTML = ""; }

function drawPower(d){
  var p = d.power;
  if (!p) { closePower(); return; }
  var rows;
  if (!p.circuits.length) {
    rows = '<div class="pwrow"><div class="nm" style="color:#94A3B8;font-weight:600">' + t("pw_none") + '</div></div>';
  } else {
    rows = p.circuits.map(function(c){
      var st = c.state === 1 ? '<span class="st on">' + t("pw_on") + '</span>'
             : c.state === 0 ? '<span class="st">' + t("pw_off") + '</span>'
             : (c.power === null ? '<span class="st">' + t("pw_lost") + '</span>' : "");
      var num = function(v, unit, cls){
        return '<span class="num' + (cls ? " " + cls : "") + (v === "--" ? " dim" : "") + '">' + v +
               '<small>' + unit + '</small></span>';
      };
      return '<div class="pwrow"><div class="nm">' + esc(pwName(c)) + '<small>' + esc(c.id) + '</small></div>' + st +
        num(c.power === null ? "--" : Math.round(c.power), "W") +
        num(c.current === null ? "--" : c.current.toFixed(1), "A") +
        num(c.energy_today === null ? "--" : c.energy_today.toFixed(2), "kWh " + t("pw_today")) +
        num(c.temp === null ? "--" : c.temp.toFixed(0), "\u2103", c.level) + '</div>' + pwCtlLine(c) +
        (pwSure === c.id ? '<div class="msg err">' + t("pc_aerator_sure") + '</div>' : "");
    }).join("");
  }
  var tot = p.total_w === null || p.total_w === undefined ? "--" : kw(p.total_w);
  var cmsg = pwCtlMsg ? '<div class="msg ' + pwCtlMsg.kind + '">' + esc(pwCtlMsg.text) + '</div>' : "";
  if (p.control && p.control.clock_ok === false) cmsg += '<div class="msg err">' + t("pc_clock") + '</div>';
  if (pwCtl) {
    document.getElementById("powerpanel").innerHTML =
      '<div class="overlay"><h1>' + t("pc_title") + '</h1>' + cmsg +
        '<div class="pwbox">' + drawPowerCtl() + '</div>' +
        '<div class="ovbtns"><button class="act ghost" onclick="pwCtl=null;pwDraft=null;pwCtlMsg=null;drawPower(lastState)">' + t("cancel") + '</button>' +
        '<button class="act" ' + (pwBusy ? "disabled" : "") + ' onclick="pwSaveRule()">' + t("save") + '</button></div>' +
      '</div>';
    return;
  }
  document.getElementById("powerpanel").innerHTML =
    '<div class="overlay"><h1>' + t("pw_title") + '</h1>' +
      '<div class="pwtot"><span>' + t(p.partial ? "pw_total_partial" : "pw_total") + ' <b>' + tot + '</b>kW</span>' +
      (p.control ? '<span>' + t("pc_now", {t: p.control.now}) + '</span>' : "") +
      (p.control && p.control.do !== null && p.control.do !== undefined ? '<span>' + t("pc_do_now", {v: p.control.do.toFixed(2)}) + '</span>' : "") +
      '</div>' + cmsg +
      '<div class="pwbox">' + rows + '</div>' +
      '<div class="ovbtns"><button class="act ghost" onclick="closePower()">' + t("close") + '</button></div>' +
    '</div>';
}

// ── 전력 회로 켜고 끄기 · 예약 — power_control.py. 숫자는 키보드 없이 −/+ 로 고른다.
var pwCtl = null, pwDraft = null, pwCtlMsg = null, pwBusy = false, pwSure = null;
var PW_DAYS = [0,1,2,3,4,5,6];
var PW_MIN_STEPS = [1,2,3,5,10,15,20,30,45,60,90,120,180,240,360,480,720];
var PW_OFF_STEPS = [0,5,10,15,20,30,45,60,90,120,180,240,360,480,720];
var PW_DO_STEPS = [1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,9,10];
var PW_GUARD_STEPS = [0,2,2.5,3,3.5,4,4.5,5,5.5,6];
var PW_MINON_STEPS = [0,5,10,15,20,30,45,60,90,120];

function pwCtlOf(id){ var p = lastState && lastState.power; return p && p.control && p.control.circuits ? p.control.circuits[id] : null; }
function pwFmtMin(m){ return m >= 60 && m % 60 === 0 ? t("pc_h", {n: m / 60}) : t("pc_m", {n: m}); }
function pwDaysTxt(ds){
  if (!ds || ds.length === 7) return t("pc_everyday");
  return ds.map(function(d){ return t("pc_d" + d); }).join("·");
}
function pwRuleTxt(r){
  var g = r && r.do_guard_below ? " · " + t("pc_guard_s", {v: r.do_guard_below.toFixed(1)}) : "";
  return pwRuleBase(r) + g;
}
function pwRuleBase(r){
  if (!r || r.mode === "manual") return t("pc_manual") + (r && r.auto_off_min ? " · " + t("pc_autooff_s", {m: pwFmtMin(r.auto_off_min)}) : "");
  if (r.mode === "do") return t("pc_do_s", {lo: r.do.on_below.toFixed(1), hi: r.do.off_above.toFixed(1)});
  if (r.mode === "timer") return t("pc_timer") + " " + r.timers.map(function(x){ return x.on + "–" + x.off; }).join(", ") +
    " · " + pwDaysTxt(r.timers[0].days);
  var c = r.cycle;
  return t("pc_cycle_s", {on: pwFmtMin(c.on_min), off: pwFmtMin(c.off_min)}) + " · " + c.from + "–" + c.to + " · " + pwDaysTxt(c.days);
}
function pwCtlLine(c){
  var k = pwCtlOf(c.id);
  if (!k || !k.can) return "";
  var on = c.state === 1;
  var bits = [esc(pwRuleTxt(k.rule))];
  if (k.override) bits.push('<span style="color:#FBBF24">' + t(k.override.on ? "pc_held_on" : "pc_held_off") +
    (k.override.until ? " " + t("pc_until", {t: k.override.until.slice(11, 16)}) : "") + '</span>');
  if (k.do_forced) bits.push('<span style="color:#F87171">' + t("pc_forced") + '</span>');
  if (k.error) bits.push('<span style="color:#F87171">' + esc(k.error) + '</span>');
  else if (k.pending) bits.push('<span style="color:#94A3B8">' + t("pc_pending") + '</span>');
  return '<div class="pcline"><div class="pcinfo">' + bits.join(" · ") + '</div>' +
    (k.override && k.rule.mode !== "manual" ? '<button class="toggle" ' + (pwBusy ? "disabled" : "") +
      ' onclick="pwAct(&quot;' + esc(c.id) + '&quot;,{action:&quot;auto&quot;})">' + t("pc_back_auto") + '</button>' : "") +
    '<button class="toggle" onclick="pwOpenCtl(&quot;' + esc(c.id) + '&quot;)">' + t("pc_setup") + '</button>' +
    '<button class="toggle pcbig' + (on ? " on" : "") + '" ' + (pwBusy ? "disabled" : "") +
      ' onclick="pwToggle(&quot;' + esc(c.id) + '&quot;)">' + t(on ? "pc_turn_off" : "pc_turn_on") + '</button></div>';
}
function pwToggle(id){
  var c = ((lastState.power || {}).circuits || []).filter(function(x){ return x.id === id; })[0] || {};
  var k = pwCtlOf(id) || {};
  var on = c.state !== 1;
  if (!on && k.confirm_off && pwSure !== id) {
    pwSure = id; drawPower(lastState);
    return;
  }
  pwSure = null;
  pwAct(id, {action: "set", on: on});
}
function pwAct(id, body){
  pwBusy = true; body.id = id;
  fetch("/api/power/control", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)})
    .then(function(r){ return r.json(); })
    .then(function(d){
      pwBusy = false;
      if (d && d.control && lastState.power) lastState.power.control = d.control;
      if (d && d.ok && body.action === "set") {
        (lastState.power.circuits || []).forEach(function(c){ if (c.id === id) c.state = body.on ? 1 : 0; });
      }
      pwCtlMsg = d && d.ok ? (body.action === "rule" ? {kind:"ok", text:t("pc_saved")} : null)
                           : {kind:"err", text:(d && d.error) || t("save_fail")};
      if (d && d.ok && body.action === "rule") { pwCtl = null; pwDraft = null; }
      drawPower(lastState);
    })
    .catch(function(){ pwBusy = false; pwCtlMsg = {kind:"err", text:t("save_fail")}; drawPower(lastState); });
}
function pwOpenCtl(id){
  var k = pwCtlOf(id) || {rule: {mode: "manual", auto_off_min: 0}};
  pwCtl = id; pwCtlMsg = null;
  pwDraft = JSON.parse(JSON.stringify(k.rule));
  if (!pwDraft.timers) pwDraft.timers = [{on: "06:00", off: "07:00", days: PW_DAYS.slice()}];
  if (!pwDraft.cycle) pwDraft.cycle = {on_min: 15, off_min: 45, from: "06:00", to: "18:00", days: PW_DAYS.slice()};
  if (!pwDraft.do) pwDraft.do = {on_below: 5, off_above: 6, min_on_min: 10};
  if (!pwDraft.auto_off_min) pwDraft.auto_off_min = 0;
  // 산소공급기는 강제 켜기를 4.0 으로 제안한다(화면에 보이므로 '안 함' 으로 내릴 수 있다).
  if (pwDraft.do_guard_below === undefined && k.confirm_off) pwDraft.do_guard_below = 4;
  if (!pwDraft.do_guard_below) pwDraft.do_guard_below = 0;
  drawPower(lastState);
}
function pwStepList(list, v, dir){
  var i = list.indexOf(v);
  if (i < 0) { i = 0; while (i < list.length - 1 && list[i] < v) i++; }
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
}
function pwTimeStep(s, part, dir){
  var h = +s.slice(0, 2), m = +s.slice(3, 5);
  if (s === "24:00") { h = 24; m = 0; }
  var tot = h * 60 + m + (part === "h" ? 60 : 10) * dir;
  tot = ((tot % 1440) + 1440) % 1440;
  return ("0" + Math.floor(tot / 60)).slice(-2) + ":" + ("0" + tot % 60).slice(-2);
}
function pwSet(path, val){
  var o = pwDraft, ks = path.split(".");
  for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
  drawPower(lastState);
}
function pwGet(path){ var o = pwDraft; path.split(".").forEach(function(k){ o = o[k]; }); return o; }
function pwStepper(label, path, kind){
  var v = pwGet(path), show, btn = function(txt, js){ return '<button class="toggle" onclick="' + js + '">' + txt + '</button>'; };
  var q = "&quot;" + path + "&quot;";
  if (kind === "time") {
    show = v;
    return '<div class="pcstep"><span>' + label + '</span>' +
      btn("−1h", "pwSet(" + q + ",pwTimeStep(pwGet(" + q + "),&quot;h&quot;,-1))") +
      btn("−10m", "pwSet(" + q + ",pwTimeStep(pwGet(" + q + "),&quot;m&quot;,-1))") +
      '<b>' + show + '</b>' +
      btn("+10m", "pwSet(" + q + ",pwTimeStep(pwGet(" + q + "),&quot;m&quot;,1))") +
      btn("+1h", "pwSet(" + q + ",pwTimeStep(pwGet(" + q + "),&quot;h&quot;,1))") + '</div>';
  }
  var list = {off: "PW_OFF_STEPS", min: "PW_MIN_STEPS", "do": "PW_DO_STEPS", guard: "PW_GUARD_STEPS", minon: "PW_MINON_STEPS"}[kind];
  show = (kind === "off" || kind === "guard" || kind === "minon") && !v ? t("pc_none")
       : (kind === "do" || kind === "guard") ? v.toFixed(1) + " mg/L" : pwFmtMin(v);
  return '<div class="pcstep"><span>' + label + '</span>' +
    btn("−", "pwSet(" + q + ",pwStepList(" + list + ",pwGet(" + q + "),-1))") + '<b>' + show + '</b>' +
    btn("+", "pwSet(" + q + ",pwStepList(" + list + ",pwGet(" + q + "),1))") + '</div>';
}
function pwDayChips(path){
  var ds = pwGet(path);
  return '<div class="pcdays">' + PW_DAYS.map(function(d){
    var on = ds.indexOf(d) >= 0;
    return '<button class="' + (on ? "on" : "") + '" onclick="pwDay(&quot;' + path + '&quot;,' + d + ')">' + t("pc_d" + d) + '</button>';
  }).join("") + '</div>';
}
function pwDay(path, d){
  var ds = pwGet(path).slice(), i = ds.indexOf(d);
  if (i >= 0) ds.splice(i, 1); else ds.push(d);
  ds.sort();
  pwSet(path, ds);
}
function pwSaveRule(){
  var r = {mode: pwDraft.mode, auto_off_min: pwDraft.auto_off_min};
  if (r.mode === "timer") r.timers = pwDraft.timers;
  if (r.mode === "cycle") r.cycle = pwDraft.cycle;
  if (r.mode === "do") {
    if (pwDraft.do.off_above <= pwDraft.do.on_below) { pwCtlMsg = {kind:"err", text:t("pc_do_bad")}; drawPower(lastState); return; }
    r.do = pwDraft.do;
  } else if (pwDraft.do_guard_below) r.do_guard_below = pwDraft.do_guard_below;
  pwAct(pwCtl, {action: "rule", rule: r});
}
function drawPowerCtl(){
  var id = pwCtl, k = pwCtlOf(id) || {}, d = pwDraft;
  var modes = ["manual","timer","cycle","do"];
  var h = '<div class="sub" style="margin:2px 0 6px">' + esc(id) + ' — ' + t("pc_pick_mode") + '</div>' +
    '<div class="typegrid four">' + modes.map(function(m){
      return '<button class="' + (d.mode === m ? "on" : "") + '" onclick="pwSet(&quot;mode&quot;,&quot;' + m + '&quot;)">' + t("pc_" + m) + '</button>';
    }).join("") + '</div>';
  var cur = lastState && lastState.power && lastState.power.control ? lastState.power.control.do : null;
  if (d.mode === "timer") {
    h += '<div class="sub" style="margin-top:10px">' + t("pc_timer_hint") + '</div>';
    d.timers.forEach(function(x, i){
      h += '<div class="pcbox">' + pwStepper(t("pc_on_at"), "timers." + i + ".on", "time") +
        pwStepper(t("pc_off_at"), "timers." + i + ".off", "time") + pwDayChips("timers." + i + ".days") +
        (d.timers.length > 1 ? '<button class="toggle" onclick="pwDraft.timers.splice(' + i + ',1);drawPower(lastState)">' + t("pc_del") + '</button>' : "") +
        '</div>';
    });
    if (d.timers.length < 6) h += '<button class="toggle" style="margin-top:6px" onclick="pwDraft.timers.push({on:&quot;18:00&quot;,off:&quot;19:00&quot;,days:PW_DAYS.slice()});drawPower(lastState)">+ ' + t("pc_add") + '</button>';
  } else if (d.mode === "cycle") {
    h += '<div class="sub" style="margin-top:10px">' + t("pc_cycle_hint") + '</div><div class="pcbox">' +
      pwStepper(t("pc_run"), "cycle.on_min", "min") + pwStepper(t("pc_rest"), "cycle.off_min", "min") +
      pwStepper(t("pc_from"), "cycle.from", "time") + pwStepper(t("pc_to"), "cycle.to", "time") +
      pwDayChips("cycle.days") + '</div>';
  } else if (d.mode === "do") {
    h += '<div class="sub" style="margin-top:10px">' + t("pc_do_hint") + '</div><div class="pcbox">' +
      pwStepper(t("pc_do_on"), "do.on_below", "do") + pwStepper(t("pc_do_off"), "do.off_above", "do") +
      pwStepper(t("pc_do_minon"), "do.min_on_min", "minon") +
      '<div class="sub">' + (cur === null || cur === undefined ? '<span style="color:#FBBF24">' + t("pc_do_none") + '</span>'
                             : t("pc_do_now", {v: cur.toFixed(2)})) + '</div></div>';
  }
  if (d.mode !== "do") {
    h += '<div class="pcbox">' + pwStepper(t("pc_guard"), "do_guard_below", "guard") +
      '<div class="sub">' + t("pc_guard_hint") + '</div></div>';
  }
  {
    h += '<div class="pcbox">' + pwStepper(t("pc_autooff"), "auto_off_min", "off") +
      '<div class="sub">' + t("pc_autooff_hint") + '</div></div>' +
      '<div class="sub" style="margin-top:8px">' + t("pc_quick") + '</div><div class="pcdays">' +
      [10, 30, 60, 120].map(function(m){
        return '<button ' + (pwBusy ? "disabled" : "") + ' onclick="pwAct(&quot;' + esc(id) + '&quot;,{action:&quot;set&quot;,on:true,minutes:' + m + '})">' + pwFmtMin(m) + '</button>';
      }).join("") + '</div>';
  }
  return h;
}

// [설정] → [전력 회로] — 차단기마다 연결된 기기 종류를 고른다(설계서 4-1 카탈로그).
function openPowerTypes(){ pwEdit = null; pwMsg = null; drawPowerTypes(); }

function drawPowerTypes(){
  var p = (lastState && lastState.power) || {circuits: []};
  var msg = pwMsg ? '<div class="msg ' + pwMsg.kind + '">' + esc(pwMsg.text) + '</div>' : "";
  var body;
  if (pwEdit) {
    var cur = (p.circuits.filter(function(c){ return c.id === pwEdit; })[0] || {}).type;
    body = '<div class="sub" style="margin:2px 0 4px">' + esc(pwEdit) + ' \u2014 ' + t("pw_pick") + '</div>' +
      '<div class="typegrid">' + PW_TYPES.map(function(k){
        return '<button class="' + (k === cur ? "on" : "") + '" onclick="setPowerType(&quot;' + k + '&quot;)">' +
               t("pwt_" + k) + '</button>';
      }).join("") + '</div>';
  } else if (!p.circuits.length) {
    body = '<div class="sub">' + t("pw_none") + '</div>';
  } else {
    body = p.circuits.map(function(c){
      return '<div class="srow" style="cursor:pointer" onclick="pwEdit=&quot;' + esc(c.id) + '&quot;;pwMsg=null;drawPowerTypes()">' +
        '<div class="sname">' + esc(pwName(c)) + '<div class="sub">' + esc(c.id) + '</div></div>' +
        '<button class="toggle">' + t("pw_change") + '</button></div>';
    }).join("");
  }
  document.getElementById("setup").innerHTML =
    '<div class="setup"><div class="chead">' +
      '<span class="ctitle">' + t("menu_power") + '</span>' +
      '<button style="margin-left:auto" onclick="' + (pwEdit ? "pwEdit=null;drawPowerTypes()" : "drawSettingsMenu()") + '">' +
        (pwEdit ? t("back_list") : t("back_menu")) + '</button>' +
    '</div><div class="sbody">' + msg + body + '</div></div>';
}

function setPowerType(k){
  var id = pwEdit;
  fetch("/api/power/type", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({id: id, type: k})})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok) {
        // 다음 갱신을 기다리지 않고 지금 화면에 반영한다.
        (lastState.power.circuits || []).forEach(function(c){ if (c.id === id) c.type = k; });
        pwMsg = {kind:"ok", text: d.saved ? t("pw_saved") : t("saved_mem")};
        pwEdit = null;
      } else {
        pwMsg = {kind:"err", text:(d && d.error) || t("save_fail")};
      }
      drawPowerTypes();
      if (lastState) render(lastState);
    })
    .catch(function(){ pwMsg = {kind:"err", text:t("save_fail")}; drawPowerTypes(); });
}

// [설정] → [무선 센서] — 지그비 센서를 찾고(페어링 모드 2분), 종류·구간을 골라 등록한다.
// 장비 프로그램이 Zigbee2MQTT 이름을 바꾸고 devices.yaml 에 한 줄을 더하면 수집기가 다시 읽는다.
// 화면이 열려 있는 동안 5초(찾는 중에는 3초)마다 다시 읽는다.
var WL_KINDS = ["canopy","air","soil","breaker-pump","breaker-aux","leak","valve"];
var WL_ZONES = ["treatment","control","facility","mast"];
var WL_PREFIX = {canopy:"CN",air:"AIR",soil:"SOIL","breaker-pump":"PUMP","breaker-aux":"AUX",leak:"LEAK",valve:"VALVE"};
var WL_ZONED = {canopy:true, soil:true};
var WL_RF_KINDS = ["weather","soil","canopy","air","leaf","rain"];
var WL_RF_PREFIX = {soil:"SOIL", canopy:"CN", air:"AIR", leaf:"LW", rain:"RAIN"};
var WL_RF_ZONED = {soil:true, canopy:true, leaf:true};
var wl = null, wlTimer = null, wlMsg = null, wlEdit = null, wlKind = null, wlZone = null, wlSure = null, wlBusy = false;
var wlRf = null;   // 433MHz 등록 중이면 {model, id, key, model_only}
var wlEco = null;  // 에코윗 등록 중이면 eco_new 의 한 항목 {key, family, channel, kind, passkey}
var WL_ECO_PREFIX = {soil:"SOIL", tf:"ST", leaf:"LW"};
// 투야 블루투스 — wlBle: null | "cred"(열쇠 넣기) | {id, name}(구간 골라 등록)
var wlBle = null, bleField = "id", bleId = "", bleSec = "", bleShift = false, bleLayer = "abc";

function bleStartCred(){ wlBle = "cred"; bleField = "id"; bleId = ""; bleSec = ""; wlMsg = null; drawWireless(); }
function bleFetch(useSaved){
  wlMsg = {kind:"ok", text:t("wl_ble_fetching")};
  var body = useSaved ? {} : {access_id: bleId, access_secret: bleSec, remember: true};
  wlPost("ble_fetch", body, function(d){
    if (d.ok) {
      wlBle = null; bleSec = "";
      var up = (d.updated || []).length ? " " + t("wl_ble_updated", {n: d.updated.join(", ")}) : "";
      wlMsg = {kind:"ok", text:t("wl_ble_fetched", {n:d.count}) + up};
    }
    else wlMsg = {kind:"err", text:d.error || t("save_fail")};
  });
}
function bleStartAdd(id){
  var n = (wl.ble_new || []).filter(function(x){ return x.id === id; })[0];
  if (!n) return;
  wlBle = n; wlZone = null; wlMsg = null; drawWireless();
}
function bleAdd(){
  var n = wlBle;
  wlPost("ble_add", {id: n.id, zone: wlZone}, function(d){
    if (d.ok) { wlBle = null; wlMsg = {kind:"ok", text:t("wl_added", {n:d.sensor_id})}; }
    else wlMsg = {kind:"err", text:d.error || t("save_fail")};
  });
}
function bleRemove(sid){
  if (wlSure !== "ble:" + sid) { wlSure = "ble:" + sid; drawWireless(); return; }
  wlSure = null;
  wlPost("ble_remove", {sensor_id: sid}, function(d){
    wlMsg = d.ok ? {kind:"ok", text:t("wl_removed")} : {kind:"err", text:d.error || t("save_fail")};
  });
}
function bleForget(){ wlPost("ble_forget", {}, function(d){ wlMsg = d.ok ? {kind:"ok", text:t("wl_ble_forgot")} : {kind:"err", text:d.error}; }); }
function bleTap(ri, ci){
  var set = bleLayer === "sym" ? K_SYM : K_ABC, ch = set[ri][ci];
  if (bleLayer === "abc" && bleShift) ch = ch.toUpperCase();
  if (bleField === "id") bleId += ch; else bleSec += ch;
  drawWireless();
}
function bleBack(){ if (bleField === "id") bleId = bleId.slice(0, -1); else bleSec = bleSec.slice(0, -1); drawWireless(); }
function bleCredBody(){
  var fld = function(key, val, ph){
    var on = bleField === key;
    return '<div class="pwbox" style="margin-top:6px" onclick="bleField=&quot;' + key + '&quot;;drawWireless()">' +
      '<div class="pwf" style="' + (on ? "border-color:var(--brand)" : "") + '"><div style="flex:1;min-width:0;' +
      'font:600 15px/1 ui-monospace,monospace;padding:10px 0;word-break:break-all;color:' + (val ? "#E8EDF7" : "#475569") + '">' +
      (val ? esc(val) : ph) + '</div></div></div>';
  };
  var rows = (bleLayer === "sym" ? K_SYM : K_ABC).map(function(row, ri){
    var keys = row.map(function(ch, ci){
      var label = (bleLayer === "abc" && bleShift) ? ch.toUpperCase() : ch;
      return '<button onclick="bleTap(' + ri + ',' + ci + ')">' + esc(label) + '</button>';
    }).join("");
    if (ri === 3) {
      var sh = bleLayer === "abc" ? '<button class="k-shift wide' + (bleShift ? " on" : "") + '" onclick="bleShift=!bleShift;drawWireless()">⇧</button>' : "";
      return '<div class="krow">' + sh + keys + '<button class="wide" onclick="bleBack()">⌫</button></div>';
    }
    return '<div class="krow">' + keys + '</div>';
  }).join("");
  var ok = bleId.length >= 8 && bleSec.length >= 8;
  return '<div class="sub">' + t("wl_ble_cred_hint") + '</div>' +
    fld("id", bleId, t("wl_ble_id")) + fld("sec", bleSec, t("wl_ble_sec")) +
    '<div class="kbd">' + rows + '<div class="krow">' +
      '<button class="wide" onclick="bleLayer=bleLayer===&quot;sym&quot;?&quot;abc&quot;:&quot;sym&quot;;drawWireless()">' + (bleLayer === "sym" ? "ABC" : "?123") + '</button>' +
      '<button class="wide" onclick="bleField=bleField===&quot;id&quot;?&quot;sec&quot;:&quot;id&quot;;drawWireless()">' + t(bleField === "id" ? "wl_ble_next" : "wl_ble_prev") + '</button>' +
      '<button class="go" ' + (ok && !wlBusy ? "" : "disabled") + ' onclick="bleFetch(false)">' + (wlBusy ? t("wl_ble_fetching") : t("wl_ble_fetch")) + '</button>' +
    '</div></div>';
}

function openWireless(){ wl = null; wlMsg = null; wlEdit = null; wlRf = null; wlEco = null; wlBle = null; wlSure = null; loadWireless(); }
function closeWireless(){ if (wlTimer) clearTimeout(wlTimer); wlTimer = null; wl = null; drawSettingsMenu(); }
function loadWireless(){
  if (wlTimer) clearTimeout(wlTimer);
  fetch("/api/wireless", {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .then(function(d){ wl = d; drawWireless(); })
    .catch(function(){ wlMsg = {kind:"err", text:t("load_fail")}; drawWireless(); })
    .then(function(){
      if (document.getElementById("wlroot")) wlTimer = setTimeout(loadWireless, wl && wl.permit_left ? 3000 : 5000);
    });
}
function wlPost(action, body, done){
  wlBusy = true; drawWireless();
  fetch("/api/wireless/" + action, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body || {})})
    .then(function(r){ return r.json(); })
    .catch(function(){ return {ok:false, error:t("save_fail")}; })
    .then(function(d){ wlBusy = false; done(d || {}); loadWireless(); });
}
function wlRfSuggest(kind, zone, model){
  var taken = (wl && wl.taken) || [];
  var p = WL_RF_PREFIX[kind] || (model.split("-").pop().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "WX");
  var z = WL_RF_ZONED[kind] ? ({treatment:"T", control:"C"})[zone] || "" : "";
  // 기본 설정의 모델 칸을 이어받는 경우(WS90-01)는 서버가 정한다 — 여기서는 새 이름만 보인다.
  for (var n = 1; n < 100; n++) {
    var id = z ? p + "-" + z + n : p + "-" + (n < 10 ? "0" : "") + n;
    if (taken.indexOf(id) < 0) return id;
  }
  return p;
}
function wlStartRf(key){
  var n = (wl.rf_new || []).filter(function(x){ return x.key === key; })[0];
  if (!n) return;
  wlRf = n; wlEdit = null; wlEco = null; wlKind = n.guess || null; wlZone = n.guess === "weather" ? "mast" : null; wlMsg = null; drawWireless();
}
function wlAddRf(){
  var r = wlRf;
  wlPost("register", {rf:true, model:r.model, id:r.id, kind:wlKind, zone:wlZone}, function(d){
    if (d.ok) { wlRf = null; wlMsg = {kind:"ok", text:t("wl_added", {n:d.sensor_id})}; }
    else wlMsg = {kind:"err", text:d.error || t("save_fail")};
  });
}
function wlRemoveRf(key){
  if (wlSure !== key) { wlSure = key; drawWireless(); return; }
  wlSure = null;
  wlPost("remove", {rf:true, key:key}, function(d){ wlMsg = d.ok ? {kind:"ok", text:t("wl_removed")} : {kind:"err", text:d.error || t("save_fail")}; });
}

// 에코윗 — 이름 규칙은 wireless._eco_register 와 같다. 게이트웨이는 서버가 정한다(433MHz 이름을 이어받을 수 있다).
function wlEcoSuggest(n, kind, zone){
  if (n.key === "gateway") return "";
  var taken = (wl && wl.taken) || [], p = WL_ECO_PREFIX[n.family], zoned = true;
  if (n.family === "th") { if (!kind) return ""; p = kind === "canopy" ? "CN" : "AIR"; zoned = kind === "canopy"; }
  var z = zoned ? ({treatment:"T", control:"C"})[zone] || "" : "";
  for (var i = 1; i < 100; i++) {
    var id = z ? p + "-" + z + i : p + "-" + (i < 10 ? "0" : "") + i;
    if (taken.indexOf(id) < 0) return id;
  }
  return p;
}
function wlEcoLabel(n){
  return n.key === "gateway" ? t("wl_eco_gw") + (n.model ? " (" + n.model + ")" : "")
    : t("wlf_" + n.family) + " \u00B7 " + t("wl_eco_ch", {n: n.channel});
}
function wlStartEco(id){
  var n = (wl.eco_new || []).filter(function(x){ return x.id === id; })[0];
  if (!n) return;
  wlEco = n; wlEdit = null; wlRf = null; wlMsg = null;
  wlKind = n.family === "th" ? null : n.kind; wlZone = n.key === "gateway" ? "mast" : null; drawWireless();
}
function wlAddEco(){
  var n = wlEco;
  wlPost("register", {eco:true, key:n.key, kind:wlKind || "", zone:wlZone, passkey:n.passkey || ""}, function(d){
    if (d.ok) { wlEco = null; wlMsg = {kind:"ok", text:t("wl_added", {n:d.sensor_id})}; }
    else wlMsg = {kind:"err", text:d.error || t("save_fail")};
  });
}
function wlRemoveEco(key){
  if (wlSure !== "eco:" + key) { wlSure = "eco:" + key; drawWireless(); return; }
  wlSure = null;
  wlPost("remove", {eco:true, key:key}, function(d){ wlMsg = d.ok ? {kind:"ok", text:t("wl_removed")} : {kind:"err", text:d.error || t("save_fail")}; });
}

function wlSuggest(kind, zone){
  var taken = (wl && wl.taken) || [], p = WL_PREFIX[kind], z = WL_ZONED[kind] ? ({treatment:"T", control:"C"})[zone] || "" : "";
  for (var n = 1; n < 100; n++) {
    var id = z ? p + "-" + z + n : p + "-" + (n < 10 ? "0" : "") + n;
    if (taken.indexOf(id) < 0) return id;
  }
  return p;
}
function wlFind(){
  var on = !(wl && wl.permit_left);
  wlPost("permit", {on: on}, function(d){ wlMsg = d.ok ? null : {kind:"err", text:d.error || t("save_fail")}; });
}
// 이름으로 고른다 — 목록이 3초마다 다시 그려져 순서가 바뀌어도 누른 센서가 등록된다.
function wlStartAdd(name){
  var n = (wl.new || []).filter(function(x){ return x.name === name; })[0];
  if (!n) return;
  wlEco = null; wlEdit = n.name; wlKind = n.guess || null; wlZone = null; wlMsg = null; drawWireless();
}
function wlAdd(){
  var name = wlEdit;
  wlPost("register", {name:name, kind:wlKind, zone:wlZone}, function(d){
    if (d.ok) { wlEdit = null; wlMsg = {kind:"ok", text:t("wl_added_zb", {n:d.sensor_id})}; }
    else wlMsg = {kind:"err", text:d.error || t("save_fail")};
  });
}
function wlRemove(name){
  if (wlSure !== name) { wlSure = name; drawWireless(); return; }
  wlSure = null;
  wlPost("remove", {name:name}, function(d){ wlMsg = d.ok ? {kind:"ok", text:t("wl_removed")} : {kind:"err", text:d.error || t("save_fail")}; });
}
function wlEnable(){
  var power = (wl.sensors || []).some(function(x){ return x.kind.indexOf("breaker") === 0; });
  wlPost("enable", {power: power}, function(d){ wlMsg = d.ok ? {kind:"ok", text:t("restarting")} : {kind:"err", text:d.error || t("save_fail")}; });
}
function wlAgo(m){ return m === null || m === undefined ? t("wl_never") : m < 1 ? t("wl_now") : t("wl_ago", {m:m}); }

function drawWireless(){
  var box = document.getElementById("setup");
  var msg = wlMsg ? '<div class="msg ' + wlMsg.kind + '">' + esc(wlMsg.text) + '</div>' : "";
  var body = "";
  if (!wl) {
    body = '<div class="sub">' + t("checking") + '</div>';
  } else if (wlBle === "cred") {
    body = bleCredBody();
  } else if (wlBle) {
    var bz = wlZone ? (function(){
      var z = ({treatment:"T", control:"C"})[wlZone] || "", taken = wl.taken || [];
      for (var n = 1; n < 100; n++) { var id = "SOIL-" + z + n; if (taken.indexOf(id) < 0) return id; }
      return "";
    })() : "";
    body = '<div class="sub" style="margin:2px 0 2px">' + esc(wlBle.name || wlBle.id) + ' \u00B7 ' + t("wl_ble_soil") + '</div>' +
      '<div class="wlhead">' + t("wl_pick_zone") + '</div><div class="typegrid two">' +
      ["treatment","control","facility"].map(function(z){ return '<button class="' + (z === wlZone ? "on" : "") +
        '" onclick="wlZone=&quot;' + z + '&quot;;drawWireless()">' + t("wlz_" + z) + '</button>'; }).join("") + '</div>' +
      (bz ? '<div class="sub" style="margin-top:10px">' + esc(t("wl_name_will", {n:bz})) + '</div>' : "") +
      '<button class="wlbig" style="margin-top:10px" ' + (wlZone && !wlBusy ? "" : "disabled") + ' onclick="bleAdd()">' + t("wl_add") + '</button>';
  } else if (wlEco) {
    var en = wlEco, th = en.family === "th", gw = en.key === "gateway";
    var ename = wlZone && (!th || wlKind) ? wlEcoSuggest(en, wlKind, wlZone) : "";
    body = '<div class="sub" style="margin:2px 0 2px">' + esc(wlEcoLabel(en)) + '</div>' +
      (th ? '<div class="wlhead">' + t("wl_pick_kind") + '</div><div class="typegrid two">' +
        ["canopy","air"].map(function(k){ return '<button class="' + (k === wlKind ? "on" : "") +
          '" onclick="wlKind=&quot;' + k + '&quot;;drawWireless()">' + t("wlr_" + k) + '</button>'; }).join("") + '</div>' : "") +
      '<div class="wlhead">' + t("wl_pick_zone") + '</div><div class="typegrid two">' +
      (gw ? ["mast","facility"] : ["treatment","control","facility","mast"]).map(function(z){ return '<button class="' + (z === wlZone ? "on" : "") +
        '" onclick="wlZone=&quot;' + z + '&quot;;drawWireless()">' + t("wlz_" + z) + '</button>'; }).join("") + '</div>' +
      (ename ? '<div class="sub" style="margin-top:10px">' + esc(t("wl_name_will", {n:ename})) + '</div>' : "") +
      (gw ? '<div class="sub" style="margin-top:10px">' + t("wl_eco_gw_tip") + '</div>' : "") +
      '<button class="wlbig" style="margin-top:10px" ' + (wlZone && (!th || wlKind) && !wlBusy ? "" : "disabled") + ' onclick="wlAddEco()">' + t("wl_add") + '</button>';
  } else if (wlRf) {
    var rname = wlKind && wlZone ? wlRfSuggest(wlKind, wlZone, wlRf.model) : "";
    if (rname && wlRf.model_only && wlKind === "weather") rname = "";      // 서버가 기존 이름을 이어준다
    body = '<div class="sub" style="margin:2px 0 2px">' + esc(wlRf.model + (wlRf.id ? " \u00B7 id " + wlRf.id : "")) + '</div>' +
      '<div class="wlhead">' + t("wl_pick_kind") + '</div><div class="typegrid">' +
      WL_RF_KINDS.map(function(k){ return '<button class="' + (k === wlKind ? "on" : "") +
        '" onclick="wlKind=&quot;' + k + '&quot;;drawWireless()">' + t("wlr_" + k) + '</button>'; }).join("") + '</div>' +
      '<div class="wlhead">' + t("wl_pick_zone") + '</div><div class="typegrid two">' +
      WL_ZONES.map(function(z){ return '<button class="' + (z === wlZone ? "on" : "") +
        '" onclick="wlZone=&quot;' + z + '&quot;;drawWireless()">' + t("wlz_" + z) + '</button>'; }).join("") + '</div>' +
      (rname ? '<div class="sub" style="margin-top:10px">' + esc(t("wl_name_will", {n:rname})) + '</div>' : "") +
      '<button class="wlbig" style="margin-top:10px" ' + (wlKind && wlZone && !wlBusy ? "" : "disabled") + ' onclick="wlAddRf()">' + t("wl_add") + '</button>';
  } else if (wlEdit) {
    // 등록 — 종류와 구간을 고르면 이름이 정해진다.
    var name = wlKind && wlZone ? wlSuggest(wlKind, wlZone) : "";
    body = '<div class="wlhead">' + t("wl_pick_kind") + '</div><div class="typegrid">' +
      WL_KINDS.map(function(k){ return '<button class="' + (k === wlKind ? "on" : "") +
        '" onclick="wlKind=&quot;' + k + '&quot;;drawWireless()">' + t("wlk_" + k) + '</button>'; }).join("") + '</div>' +
      '<div class="wlhead">' + t("wl_pick_zone") + '</div><div class="typegrid two">' +
      WL_ZONES.map(function(z){ return '<button class="' + (z === wlZone ? "on" : "") +
        '" onclick="wlZone=&quot;' + z + '&quot;;drawWireless()">' + t("wlz_" + z) + '</button>'; }).join("") + '</div>' +
      (name ? '<div class="sub" style="margin-top:10px">' + esc(t("wl_name_will", {n:name})) + '</div>' : "") +
      '<button class="wlbig" style="margin-top:10px" ' + (name && !wlBusy ? "" : "disabled") + ' onclick="wlAdd()">' + t("wl_add") + '</button>';
  } else {
    var u = wl.units || {};
    var chip = function(label, v){ return '<span class="' + (v ? "ok" : v === false ? "bad" : "") + '">' +
      (v ? "✓ " : v === false ? "✕ " : "") + label + '</span>'; };
    body += '<div class="wlchips">' + chip(t("wl_dongle"), !!wl.dongle) + chip(t("wl_z2m"), wl.z2m === true) +
      chip(t("wl_collector"), u["farm365-zigbee"]) + chip(t("wl_rf"), wl.rtlsdr ? true : null) + '</div>';
    if (!wl.installed) {
      body += '<div class="msg err">' + t("wl_not_installed") +
        '<br><b style="font-family:ui-monospace,monospace">sudo bash /opt/shrimp365/setup-wireless.sh</b></div>';
    }
    if (wl.sensors && wl.sensors.length && !wl.env_on) {
      body += '<div class="msg err">' + t("wl_enable") +
        ' <button class="toggle" style="margin-left:6px" onclick="wlEnable()">' + t("wl_enable_btn") + '</button></div>';
    }
    var left = wl.permit_left || 0;
    body += '<button class="wlbig' + (left ? " on" : "") + '" ' + (wlBusy || !wl.mqtt ? "disabled" : "") + ' onclick="wlFind()">' +
      (left ? t("wl_finding", {m: Math.floor(left / 60), s: ("0" + left % 60).slice(-2)}) : t("wl_find")) + '</button>';
    if (wl.new && wl.new.length) {
      body += '<div class="wlhead">' + t("wl_new") + ' (' + wl.new.length + ')</div>' +
        wl.new.map(function(n){
          var sub = [n.vendor, n.model].filter(Boolean).join(" ") || n.name;
          var state = n.interviewing ? t("wl_interview") : !n.supported ? t("wl_unsupported") : "";
          return '<div class="srow"><div class="sname">' + esc(n.description || n.model || n.name) +
            '<div class="sub">' + esc(sub) + (state ? " · " + state : "") + '</div></div>' +
            '<button class="toggle" ' + (n.interviewing ? "disabled" : "") + ' onclick="wlStartAdd(decodeURIComponent(&quot;' + encodeURIComponent(n.name) + '&quot;))">' + t("wl_add") + '</button></div>';
        }).join("");
    }
    body += '<div class="wlhead">' + t("wl_registered") + ' (' + (wl.sensors || []).length + ')</div>';
    body += (wl.sensors || []).length ? wl.sensors.map(function(x){
      var kindKey = x.kind === "canopy" && /^AIR/i.test(x.sensor_id) ? "air" : x.kind;
      var bits = [];
      if (x.battery !== null && x.battery !== undefined) bits.push(t("wl_batt", {v: Math.round(x.battery)}));
      if (x.lqi !== null && x.lqi !== undefined) bits.push(t("wl_lqi", {v: Math.round(x.lqi)}));
      var old = x.age_min === null || x.age_min === undefined || x.age_min >= 30;
      return '<div class="srow"><div class="sname">' + esc(x.sensor_id) +
        '<div class="sub">' + esc((t("wlk_" + kindKey) || x.kind) + " · " + (t("wlz_" + x.zone) || x.zone)) +
        (x.paired === false ? ' · <span style="color:#FBBF24">' + t("wl_unpaired") + '</span>' : "") + '</div></div>' +
        '<div class="wlmeta' + (old ? " old" : "") + '">' + wlAgo(x.age_min) + (bits.length ? "<br>" + bits.join(" · ") : "") + '</div>' +
        '<button class="toggle" style="margin-left:8px" onclick="wlRemove(&quot;' + esc(x.name) + '&quot;)">' +
          (wlSure === x.name ? t("wl_remove_sure") : t("wl_remove")) + '</button></div>';
    }).join("") : '<div class="sub">' + t("wl_none") + '</div>';

    // ── 433MHz — 페어링이 없다. 수집기가 들은 장치 중에서 골라 등록한다.
    body += '<div class="wlhead" style="margin-top:16px">' + t("wl_rf_title") + '</div>';
    if (!wl.rf_heard_ok && !(wl.units || {})["farm365-rtl433"]) body += '<div class="msg err">' + t("wl_rf_off") + '</div>';
    var rfs = wl.rf_sensors || [];
    body += rfs.length ? rfs.map(function(x){
      var bits = [];
      if (x.rssi !== null && x.rssi !== undefined) bits.push(t("wl_rf_rssi", {v: Math.round(x.rssi)}));
      var old = x.age_min === null || x.age_min === undefined || x.age_min >= 30;
      return '<div class="srow"><div class="sname">' + esc(x.sensor_id) +
        '<div class="sub">' + esc((x.kind ? t("wlr_" + x.kind) : x.model) + " \u00B7 " + (t("wlz_" + x.zone) || x.zone) +
          " \u00B7 " + x.model.replace(/^Fineoffset-/, "") + (x.id ? " #" + x.id : "")) + '</div></div>' +
        '<div class="wlmeta' + (old ? " old" : "") + '">' + wlAgo(x.age_min) + (bits.length ? "<br>" + bits.join(" \u00B7 ") : "") + '</div>' +
        '<button class="toggle" style="margin-left:8px" onclick="wlRemoveRf(decodeURIComponent(&quot;' + encodeURIComponent(x.key) + '&quot;))">' +
          (wlSure === x.key ? t("wl_remove_sure") : t("wl_remove")) + '</button></div>';
    }).join("") : '<div class="sub">' + t("wl_rf_none") + '</div>';
    var heard = wl.rf_new || [];
    if (heard.length) {
      body += '<div class="wlhead">' + t("wl_rf_heard") + ' (' + heard.length + ')</div>' +
        heard.map(function(h){
          var bits = [t("wl_rf_seen", {n: h.count, ago: wlAgo(h.age_min)})];
          if (h.rssi !== null && h.rssi !== undefined) bits.push(t("wl_rf_rssi", {v: Math.round(h.rssi)}));
          return '<div class="srow"><div class="sname">' + esc(h.model.replace(/^Fineoffset-/, "") + (h.id ? " #" + h.id : "")) +
            '<div class="sub">' + esc(h.guess ? t("wlr_" + h.guess) : h.model) + " \u00B7 " + bits.join(" \u00B7 ") +
            (h.model_only ? '<br><span style="color:#94A3B8">' + t("wl_rf_default") + '</span>' : "") + '</div></div>' +
            '<button class="toggle" onclick="wlStartRf(decodeURIComponent(&quot;' + encodeURIComponent(h.key) + '&quot;))">' + t("wl_add") + '</button></div>';
        }).join("") + '<div class="sub" style="margin-top:4px">' + t("wl_rf_tip") + '</div>';
    }
    if (wl.rf_other) body += '<div class="sub" style="margin-top:4px">' + t("wl_rf_other", {n: wl.rf_other}) + '</div>';

    // ── 투야 블루투스 — 투야 IoT 열쇠(Access ID·Secret)로 센서 열쇠를 받아 등록한다(처음 한 번 인터넷).
    var bles = wl.ble_sensors || [], bnew = wl.ble_new || [];
    body += '<div class="wlhead" style="margin-top:16px">' + t("wl_ble_title") + '</div>';
    if (!wl.ble_ready) {
      body += '<div class="msg info">' + t("wl_ble_setup") +
        '<br><b style="font-family:ui-monospace,monospace">cd ~/shrimp365/raspberry-pi && sudo bash setup-tuya-ble.sh</b></div>';
    } else if ((wl.units || {})["farm365-tuyable"] === false) {
      body += '<div class="msg err">' + t("wl_ble_off") + '</div>';
    }
    body += bles.map(function(x){
      var bits = [];
      if (x.battery !== null && x.battery !== undefined) bits.push(t("wl_batt", {v: Math.round(x.battery)}));
      if (x.rssi !== null && x.rssi !== undefined) bits.push(t("wl_rf_rssi", {v: Math.round(x.rssi)}));
      var old = x.age_min === null || x.age_min === undefined || x.age_min >= 30;
      return '<div class="srow"><div class="sname">' + esc(x.sensor_id) +
        '<div class="sub">' + esc(t("wl_ble_soil") + " \u00B7 " + (t("wlz_" + x.zone) || x.zone) + (x.name ? " \u00B7 " + x.name : "")) +
        (x.error ? '<br><span style="color:#FBBF24">' + esc(x.error) + '</span>' : "") + '</div></div>' +
        '<div class="wlmeta' + (old ? " old" : "") + '">' + wlAgo(x.age_min) + (bits.length ? "<br>" + bits.join(" \u00B7 ") : "") + '</div>' +
        '<button class="toggle" style="margin-left:8px" onclick="bleRemove(decodeURIComponent(&quot;' + encodeURIComponent(x.sensor_id) + '&quot;))">' +
          (wlSure === "ble:" + x.sensor_id ? t("wl_remove_sure") : t("wl_remove")) + '</button></div>';
    }).join("");
    if (!bles.length && !bnew.length) body += '<div class="sub">' + t("wl_ble_none") + '</div>';
    if (bnew.length) {
      body += '<div class="wlhead">' + t("wl_ble_new") + ' (' + bnew.length + ')</div>' + bnew.map(function(n){
        return '<div class="srow"><div class="sname">' + esc(n.name || n.id) + '<div class="sub">' + esc(n.category) + '</div></div>' +
          '<button class="toggle" onclick="bleStartAdd(decodeURIComponent(&quot;' + encodeURIComponent(n.id) + '&quot;))">' + t("wl_add") + '</button></div>';
      }).join("");
    } else if (wl.ble_fetched) {
      body += '<div class="sub" style="margin-top:4px">' + t("wl_ble_all") + '</div>';
    }
    if (wl.ble_ready) {
      body += '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        (wl.ble_saved ? '<button class="toggle" ' + (wlBusy ? "disabled" : "") + ' onclick="bleFetch(true)">' + t("wl_ble_fetch") + '</button>' : "") +
        '<button class="toggle" onclick="bleStartCred()">' + t(wl.ble_saved ? "wl_ble_change" : "wl_ble_fetch") + '</button>' +
        (wl.ble_saved ? '<button class="toggle" onclick="bleForget()">' + t("wl_ble_forget") + '</button>' : "") + '</div>';
    }
    body += '<div class="sub" style="margin-top:4px">' + t("wl_ble_tip") + '</div>';

    // ── 에코윗 — 게이트웨이가 이 장비로 보내 온다. 들어온 게이트웨이와 거기 붙은 센서 중에서 골라 등록한다.
    body += '<div class="wlhead" style="margin-top:16px">' + t("wl_eco_title") + '</div>';
    if ((wl.units || {})["farm365-ecowitt"] === false) body += '<div class="msg err">' + t("wl_eco_off") + '</div>';
    var ecos = wl.eco_sensors || [], gws = wl.eco_gateways || [];
    body += ecos.map(function(x){
      var old = x.age_min === null || x.age_min === undefined || x.age_min >= 30;
      var what = x.key === "gateway" ? t("wl_eco_gw") : (t("wlr_" + x.kind) || x.kind) + " \u00B7 " + t("wl_eco_ch", {n: x.channel});
      return '<div class="srow"><div class="sname">' + esc(x.sensor_id) +
        '<div class="sub">' + esc(what + " \u00B7 " + (t("wlz_" + x.zone) || x.zone)) + '</div></div>' +
        '<div class="wlmeta' + (old ? " old" : "") + '">' + wlAgo(x.age_min) + '</div>' +
        '<button class="toggle" style="margin-left:8px" onclick="wlRemoveEco(decodeURIComponent(&quot;' + encodeURIComponent(x.key) + '&quot;))">' +
          (wlSure === "eco:" + x.key ? t("wl_remove_sure") : t("wl_remove")) + '</button></div>';
    }).join("");
    if (!gws.length) {
      body += (ecos.length ? "" : '<div class="sub">' + t("wl_eco_none") + '</div>') +
        '<div class="msg info" style="margin-top:6px">' + t("wl_eco_setup") +
        '<div class="ecoset"><span>' + t("wl_eco_server") + '</span><b>' + esc(wl.ip || t("wl_eco_noip")) + '</b>' +
        '<span>' + t("wl_eco_port") + '</span><b>' + esc(String(wl.eco_port || 8088)) + '</b>' +
        '<span>' + t("wl_eco_path") + '</span><b>' + esc(wl.eco_path || "/data/report/") + '</b>' +
        '<span>' + t("wl_eco_interval") + '</span><b>60s</b></div></div>';
    } else {
      body += '<div class="wlhead">' + t("wl_eco_heard") + ' (' + gws.length + ')</div>' + gws.map(function(g){
        return '<div class="srow"><div class="sname">' + esc(g.model || "Ecowitt") +
          '<div class="sub">' + esc(g.ip) + " \u00B7 " + (g.registered ? t("wl_eco_mine") : t("wl_eco_notmine")) + '</div></div>' +
          '<div class="wlmeta' + (g.age_min >= 30 ? " old" : "") + '">' + wlAgo(g.age_min) + '</div></div>';
      }).join("");
    }
    var enew = wl.eco_new || [];
    if (enew.length) {
      body += '<div class="wlhead">' + t("wl_eco_new") + ' (' + enew.length + ')</div>' + enew.map(function(n){
        return '<div class="srow"><div class="sname">' + esc(wlEcoLabel(n)) +
          '<div class="sub">' + wlAgo(n.age_min) + '</div></div>' +
          '<button class="toggle" onclick="wlStartEco(decodeURIComponent(&quot;' + encodeURIComponent(n.id) + '&quot;))">' + t("wl_add") + '</button></div>';
      }).join("");
    }
  }
  box.innerHTML = '<div class="setup" id="wlroot"><div class="chead">' +
      '<span class="ctitle">' + t("menu_wireless") + '</span>' +
      '<button style="margin-left:auto" onclick="' + (wlEdit || wlRf || wlEco || wlBle ? "wlEdit=null;wlRf=null;wlEco=null;wlBle=null;drawWireless()" : "closeWireless()") + '">' +
        (wlEdit || wlRf || wlEco || wlBle ? t("back_list") : t("back_menu")) + '</button>' +
    '</div><div class="sbody">' + msg + body + '</div></div>';
}

// 환경·기상 줄 — 스마트팜에서 [environment] 를 켠 장비만. 끈 장비(env=null)는
// 자리도 차지하지 않는다. 켰는데 값이 하나도 없으면 비워 두지 않고 점검할 곳을 알린다.
// 칸 이름은 field_env.py 와 서버 수신 칸이 같다.
//   opt: 값이 있을 때만 띄운다 — 지온 센서나 기상센서가 없는 농장에 빈 칸을 늘 두지 않는다.
var ENV_SLOTS = [
  {k:"air_temp",      unit:"\u00B0C",  digits:1},
  // 2m 기온(기상센서)과 지상 10cm 초관부 온도(지그비 온습도계)가 둘 다 있을 때만 따로 뜬다.
  {k:"canopy_temp",   unit:"\u00B0C",  digits:1, opt:true},
  {k:"humidity",      unit:"%",       digits:1},
  {k:"soil_moisture", unit:"%",       digits:1},
  {k:"soil_temp",     unit:"\u00B0C",  digits:1, opt:true},
  {k:"wind_speed",    unit:"m/s",     digits:1, opt:true},
  {k:"rain_day",      unit:"mm",      digits:1, opt:true}
];
// 기상 상세 칸 — 눌러서 그래프를 볼 때 단위·자리를 여기서 찾는다(화면 줄에는 따로 안 뜬다).
var WX_SLOTS = [
  {k:"wind_gust", unit:"m/s", digits:1}, {k:"wind_dir", unit:"\u00B0", digits:0},
  {k:"rain_rate", unit:"mm/h", digits:1}, {k:"solar", unit:"W/m\u00B2", digits:0},
  {k:"uv_index", unit:"", digits:1}, {k:"pressure", unit:"hPa", digits:1}
];
var ENV_LABEL = {wind_gust:"wx_gust", wind_dir:"wx_dir", rain_rate:"wx_rain_rate", solar:"wx_solar",
                 uv_index:"wx_uv", pressure:"wx_pressure",
                 canopy_temp:"env_canopy", humidity:"env_rh", soil_moisture:"env_soil", soil_temp:"env_soil_temp",
                 wind_speed:"env_wind", rain_day:"env_rain_day"};
var COMPASS = ["N","NE","E","SE","S","SW","W","NW"];
function envLabel(k, e){
  if (k === "air_temp") return t(e && e.var === "canopy_temp" ? "env_canopy" : "env_air");
  return t(ENV_LABEL[k]);
}
// 칸 아래 작은 줄 — 바람은 돌풍·풍향, 비는 지금 강우강도를 먼저 보여 준다.
// 그것이 없으면 센서 대수와 마지막 값의 나이.
function envMeta(k, e, env){
  if (k === "wind_speed") {
    var bits = [];
    if (env.wind_gust) bits.push(t("env_gust", {v:env.wind_gust.value.toFixed(1)}));
    if (env.wind_dir) bits.push(t("dir_" + COMPASS[Math.round(env.wind_dir.value / 45) % 8]));
    if (bits.length) return bits.join(" \u00B7 ");
  }
  if (k === "rain_day" && env.rain_rate && env.rain_rate.value > 0) {
    return t("env_rate", {v:env.rain_rate.value.toFixed(1)});
  }
  // 한 대뿐이면 대수 대신 그 센서 이름 — '1대'만으로는 어느 센서인지 모른다
  // (예: 기상센서 WS90 이 기온·습도도 함께 재므로 온습도계가 없어도 칸이 찬다).
  var live = (e.each || []).filter(function(x){ return x.value !== null && x.value !== undefined; });
  var one = e.sensors === 1 && live.length === 1 && live[0].id;
  if (one) return e.age_min < 1 ? t("env_one_now", {id:one}) : t("env_one", {id:one, m:e.age_min});
  return e.age_min < 1 ? t("env_now", {n:e.sensors}) : t("env_meta", {n:e.sensors, m:e.age_min});
}
function renderEnv(d, big){
  var env = d.env;
  if (!env) return "";
  var any = ENV_SLOTS.some(function(s){ return env[s.k]; });
  if (!any) return '<div class="env empty">' + t("env_empty") + '</div>';
  var tiles = ENV_SLOTS.filter(function(s){ return !s.opt || env[s.k]; })
    .map(function(s){
      var e = env[s.k];
      if (!e) {
        return '<div class="e none"><span class="ek">' + envLabel(s.k, null) + '</span>' +
               '<span class="ev">--</span><span class="em">' + t("env_missing") + '</span></div>';
      }
      // 수집 주기(보통 5분)의 세 배를 넘기면 끊기고 있는 것 — 값은 두되 주황으로 알린다.
      // 센서가 여러 대면 누를 수 있다 — 한 대 한 대의 값과 끊긴 센서를 펼쳐 본다.
      var many = e.each && e.each.length >= 2;
      // 누르면 그래프 — 센서가 한 대여도(강수·풍속·토양수분 …). 풍속·강수 그래프에는 '기상 상세' 단추가 있다.
      var tap = 'openEnvEach(&quot;' + s.k + '&quot;)';
      return '<div class="e' + (e.age_min >= 15 ? " old" : "") + (tap ? " many" : "") + '"' +
             (tap ? ' onclick="' + tap + '"' : "") + '>' +
             '<span class="ek">' + envLabel(s.k, e) + '</span>' +
             '<span class="ev">' + e.value.toFixed(s.digits) + '<small>' + s.unit + '</small></span>' +
             '<span class="em">' + esc(envMeta(s.k, e, env)) + '</span></div>';
    }).join("");
  return '<div class="env' + (big ? " big" : "") + '">' + tiles + '</div>';
}

// 칸을 누르면 — 센서별 그래프와 목록. 평균은 지금 값이 있는 센서로만 낸다. 끊긴 센서는
// 회색 '끊김'으로 남겨 평균에서 어느 것이 빠졌는지 보이게 하고, 가장 높은·낮은 센서에 표시를 붙인다.
// 그래프는 장비 이력(history.env_samples, 5분 간격)에서 — 인터넷이 끊겨도 그린다.
// 센서 색은 이름순 자리로 정한다. 목록의 점 색과 선 색이 같다.
var SENSOR_COLORS = ["#38BDF8","#F472B6","#A3E635","#FBBF24","#C084FC","#2DD4BF","#FB923C","#F87171",
                     "#60A5FA","#E879F9","#4ADE80","#FACC15"];
var envEachKey = null, envEachHours = 24, envSeries = null, envSeriesAt = 0;
function openEnvEach(k){
  wxOpen = false;
  envEachKey = k; envEachHours = 24; envSeries = null;
  drawEnvEach(lastState || {}); loadEnvSeries();
}
function closeEnvEach(){ envEachKey = null; envSeries = null; document.getElementById("envpanel").innerHTML = ""; }
function setEnvRange(h){ envEachHours = h; envSeries = null; drawEnvEach(lastState || {}); loadEnvSeries(); }
function loadEnvSeries(){
  var k = envEachKey, h = envEachHours;
  if (!k) return;
  envSeriesAt = Date.now();
  fetch("/api/env_history?slot=" + k + "&hours=" + h, {cache:"no-store"})
    .then(function(r){ return r.json(); })
    .catch(function(){ return {sensors:[], avg:[], count:0}; })
    .then(function(d){
      if (envEachKey !== k || envEachHours !== h) return;   // 그새 닫았거나 구간을 바꿨다
      envSeries = d; drawEnvEach(lastState || {});
    });
}
function sensorColors(e){
  var ids = (e.each || []).map(function(x){ return x.id; });
  ((envSeries && envSeries.sensors) || []).forEach(function(s){ if (ids.indexOf(s.id) < 0) ids.push(s.id); });
  ids.sort();
  var c = {};
  ids.forEach(function(id, i){ c[id] = SENSOR_COLORS[i % SENSOR_COLORS.length]; });
  return c;
}
// W·H 는 그릴 자리의 실제 픽셀 크기 — 수질 그래프(drawChart)와 같은 까닭으로 고정 viewBox 를
// 늘리지 않는다(늘리면 축 글자가 퍼지고 점이 타원이 된다).
function envPlot(slot, d, colors, W, H){
  if (!d) return '<div class="nodata">' + t("env_loading") + '</div>';
  if (!d.count) return '<div class="nodata">' + t("env_no_hist") + '</div>';
  W = Math.max(240, W || 500); H = Math.max(120, H || 300);
  var padL = 44, padR = 10, padT = 10, padB = 24;
  var all = [];
  d.sensors.forEach(function(s){ s.points.forEach(function(p){ all.push(p[0]); }); });
  var t0 = Math.min.apply(null, all), t1 = Math.max(Math.max.apply(null, all), t0 + 1);
  var span = Math.max(d.max - d.min, Math.pow(10, -slot.digits));
  var lo = d.min - span * 0.1, hi = d.max + span * 0.1;
  var x = function(t){ return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
  var y = function(v){ return padT + (hi - v) / (hi - lo) * (H - padT - padB); };
  var grid = "";
  for (var i = 0; i <= 3; i++) {
    var v = lo + (hi - lo) * i / 3, gy = y(v);
    grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W-padR) + '" y2="' + gy + '" stroke="#22304C" stroke-width="1"/>' +
            '<text x="' + (padL-6) + '" y="' + (gy+4) + '" text-anchor="end" fill="#64748B" font-size="11" ' +
            'font-family="ui-monospace,monospace">' + v.toFixed(slot.digits) + '</text>';
  }
  [0, 0.5, 1].forEach(function(f){
    var tt = t0 + (t1 - t0) * f;
    grid += '<text x="' + x(tt) + '" y="' + (H-7) + '" text-anchor="' + (f === 0 ? "start" : f === 1 ? "end" : "middle") +
            '" fill="#64748B" font-size="11" font-family="ui-monospace,monospace">' + fmtTick(tt, envEachHours) + '</text>';
  });
  var line = function(pts, color, w, dash){
    if (pts.length === 1) return '<circle cx="' + x(pts[0][0]) + '" cy="' + y(pts[0][1]) + '" r="3" fill="' + color + '"/>';
    return '<polyline fill="none" stroke="' + color + '" stroke-width="' + w + '"' + (dash ? ' stroke-dasharray="6 5"' : "") +
      ' stroke-linejoin="round" stroke-linecap="round" points="' +
      pts.map(function(p){ return x(p[0]) + "," + y(p[1]); }).join(" ") + '"/>';
  };
  var lines = d.sensors.map(function(s){ return line(s.points, colors[s.id] || "#94A3B8", 2, false); }).join("");
  var avg = d.sensors.length >= 2 ? line(d.avg, "#E8EDF7", 1.5, true) : "";
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + grid + lines + avg + '</svg>';
}
// ── 기상 상세 ── 풍속·강수 칸을 누르면. 기상센서(WS90 등)가 보내는 값을 한 화면에 모은다.
var wxOpen = false;
function openWeather(){ envEachKey = null; wxOpen = true; drawWeather(lastState || {}); }
function closeWeather(){ wxOpen = false; document.getElementById("envpanel").innerHTML = ""; }
function dewPoint(tc, rh){
  // 마그누스 식 — 이슬·결로가 생기는 온도. 기온이 이슬점에 가까우면 잎이 젖는다(병 발생 조건).
  if (typeof tc !== "number" || typeof rh !== "number" || rh <= 0) return null;
  var a = 17.62, b = 243.12, g = Math.log(rh / 100) + a * tc / (b + tc);
  return b * g / (a - g);
}
function drawWeather(d){
  var env = d.env || {};
  var v = function(k){ return env[k] && typeof env[k].value === "number" ? env[k].value : null; };
  var items = [];
  var add = function(label, val, digits, unit, sub, key){
    if (val === null || val === undefined) return;
    // 칸을 누르면 그 값의 그래프(장비 이력 — 5분 간격). 계산한 이슬점은 이력이 없어 누르지 않는다.
    var tap = key ? ' many" onclick="wxOpen=false;openEnvEach(&quot;' + key + '&quot;)' : '';
    items.push('<div class="e' + tap + '"><span class="ek">' + label + '</span><span class="ev">' +
      (typeof val === "number" ? val.toFixed(digits) : esc(val)) + '<small>' + unit + '</small></span>' +
      '<span class="em">' + (sub || "") + '</span></div>');
  };
  add(t("wx_wind"), v("wind_speed"), 1, "m/s", "", "wind_speed");
  add(t("wx_gust"), v("wind_gust"), 1, "m/s", "", "wind_gust");
  var dir = v("wind_dir");
  add(t("wx_dir"), dir === null ? null : t("dir_" + COMPASS[Math.round(dir / 45) % 8]), 0, "", dir === null ? "" : Math.round(dir) + "\u00B0", "wind_dir");
  add(t("wx_rain_day"), v("rain_day"), 1, "mm", "", "rain_day");
  add(t("wx_rain_rate"), v("rain_rate"), 1, "mm/h", "", "rain_rate");
  add(t("wx_solar"), v("solar"), 0, "W/m\u00B2", env.solar && env.solar.var === "illuminance" ? t("wx_solar_lux") : "", "solar");
  add(t("wx_uv"), v("uv_index"), 1, "", "", "uv_index");
  add(t("wx_pressure"), v("pressure"), 1, "hPa", "", "pressure");
  var at = env.air_temp && env.air_temp.var === "t_air" ? v("air_temp") : null;
  add(t("wx_dew"), dewPoint(at, v("humidity")), 1, "\u00B0C", t("wx_dew_sub"));
  if (!items.length) { closeWeather(); return; }
  document.getElementById("envpanel").innerHTML =
    '<div class="chart">' +
      '<div class="chead"><span class="ctitle">' + t("wx_title") + '</span>' +
        '<span class="cstats"><span>' + t("wx_hint") + '</span></span>' +
        '<button style="margin-left:auto" onclick="closeWeather()">' + t("close") + '</button></div>' +
      '<div class="env big wxgrid">' + items.join("") + '</div>' +
    '</div>';
}

function drawEnvEach(d){
  var e = d.env && d.env[envEachKey];
  var slot = ENV_SLOTS.concat(WX_SLOTS).filter(function(s){ return s.k === envEachKey; })[0];
  if (!e || !slot) { closeEnvEach(); return; }
  if (!e.each) e = Object.assign({}, e, {each: []});
  // 화면이 오래 열려 있으면 그래프도 따라간다(1분마다 다시 읽기).
  if (envSeries && Date.now() - envSeriesAt > 60000) loadEnvSeries();
  var colors = sensorColors(e);
  var live = e.each.filter(function(x){ return x.value !== null; }).map(function(x){ return x.value; });
  var hi = Math.max.apply(null, live), lo = Math.min.apply(null, live);
  var spread = live.length >= 2 && hi !== lo;
  var rows = e.each.map(function(x){
    var dead = x.value === null;
    var tag = dead ? '<span class="st">' + t("env_lost") + '</span>'
            : spread && x.value === hi ? '<span class="tag hi">' + t("env_hi") + '</span>'
            : spread && x.value === lo ? '<span class="tag lo">' + t("env_lo") + '</span>' : "";
    var ago = x.age_min < 1 ? t("env_just") : t("env_ago", {m: x.age_min});
    return '<div class="pwrow eachrow"><span class="dot" style="background:' + colors[x.id] + '"></span>' +
      '<div class="nm">' + esc(x.id) + '<small>' + ago + '</small></div>' + tag +
      '<span class="num' + (dead ? " dim" : "") + '">' + (dead ? "--" : x.value.toFixed(slot.digits)) +
      '<small>' + slot.unit + '</small></span></div>';
  }).join("");
  var buttons = RANGE_OPTIONS.map(function(o){
    return '<button onclick="setEnvRange(' + o.hours + ')" aria-pressed="' + (o.hours === envEachHours) + '">' +
      t(o.k) + '</button>';
  }).join("");
  document.getElementById("envpanel").innerHTML =
    '<div class="chart">' +
      '<div class="chead"><span class="ctitle">' + t(e.each.length >= 2 ? "env_each_title" : "env_trend_title", {p: envLabel(envEachKey, e)}) + '</span>' +
        '<span class="cnow">' + e.value.toFixed(slot.digits) + '<small style="font-size:13px;color:#94A3B8"> ' +
        slot.unit + '</small></span>' +
        (e.each.length >= 2 ? '<span class="cstats"><span>' + t("env_avg", {n: e.sensors}) + '</span>' +
          '<span class="avgkey">' + t("env_avg_line") + '</span></span>' : "") + '</div>' +
      '<div class="ranges">' + buttons +
        (envEachKey === "wind_speed" || envEachKey === "rain_day" || WX_SLOTS.some(function(w){ return w.k === envEachKey; })
          ? '<button onclick="openWeather()">' + t("wx_more") + '</button>' : "") +
        '<button class="close" onclick="closeEnvEach()">' + t("close") + '</button></div>' +
      '<div class="eachbody"><div class="plot" id="envplot"></div>' +
        '<div class="eachlist">' + rows + '</div></div>' +
    '</div>';
  var plot = document.getElementById("envplot");
  plot.innerHTML = envPlot(slot, envSeries, colors, plot.clientWidth, plot.clientHeight);
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
  // 스마트팜인데 양액 관리가 꺼져 있으면 그 자리에 켜는 길을 둔다 — 빈칸보다 낫다.
  // 양식장에서는 예전처럼 아무것도 띄우지 않는다.
  if (!n) {
    if (!isAgri()) return "";
    // [센서 설정]에서 일부러 끈 것이면 안내도 띄우지 않는다(sensors_on 이 있는 새 장비).
    if (d.sensors_on && d.sensors_on.indexOf("nutrient") < 0) return "";
    return '<div class="nut front off" onclick="openSettings();openNutrient()">' +
      '<span class="head">' + t("nut_off_hint") + '</span></div>';
  }
  var cls = isAgri() ? "nut front" : "nut";
  if (n.error === "target_lte_source") {
    return '<div class="' + cls + ' high"><span class="head">' + t("nut_bad_cfg") + '</span></div>';
  }
  var meta = '<span class="meta">EC ' + n.ec + ' / ' + n.target + ' mS/cm<br>' +
             t("nut_conc") + ' ' + n.percent + '%</span>';
  if (n.verdict === "low") {
    if (n.error === "bad_calibration") {
      return '<div class="' + cls + ' high"><span class="head">' + t("nut_need_cal") + '</span>' + meta + '</div>';
    }
    return '<div class="' + cls + ' low">' +
      '<span class="head">' + t("nut_low") + '</span>' +
      '<span class="dose">A ' + n.dose_a + '<small>mL</small></span>' +
      '<span class="dose">B ' + n.dose_b + '<small>mL</small></span>' +
      meta + '</div>';
  }
  if (n.verdict === "high") {
    return '<div class="' + cls + ' high">' +
      '<span class="head">' + t("nut_high") + '</span>' +
      '<span class="dose">' + (n.exchange_l !== undefined ? n.exchange_l : "--") + '<small>L</small></span>' +
      meta + '</div>';
  }
  return '<div class="' + cls + ' ok"><span class="head">' + t("nut_ok") + '</span>' + meta + '</div>';
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
  var r = RANGES[key] || {unit:"", digits:2};
  // 계기판이 전도도를 mS/cm 로 보여 주면 그래프도 같은 단위로 — 이력은 uS/cm 로 쌓인다.
  if (key === "conductivity" && lastState && lastState.ec_unit === "ms" && d.count) {
    var k = function(v){ return v / 1000; };
    d = {count:d.count, min:k(d.min), max:k(d.max), avg:k(d.avg),
         points:d.points.map(function(p){ return [p[0], k(p[1]), k(p[2]), k(p[3])]; })};
    r = {unit:"mS/cm", digits:2};
  }

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

  var box = document.getElementById("chart");
  if (!d.count) {
    box.innerHTML = '<div class="chart">' + head +
      '<div class="nodata">' + t("no_data") + '</div></div>';
    return;
  }

  // 그릴 자리를 먼저 깔고 **실제 픽셀 크기**로 좌표를 잡는다. 1.9.1 은 고정 viewBox 를
  // preserveAspectRatio="none" 으로 늘려 축 숫자가 옆으로 퍼지고 끝점이 타원이 됐다.
  box.innerHTML = '<div class="chart">' + head + '<div class="plot" id="plot"></div></div>';
  var plot = document.getElementById("plot");
  var W = Math.max(240, plot.clientWidth), H = Math.max(120, plot.clientHeight);
  var padL = 52, padR = 14, padT = 12, padB = 26;

  var pts = d.points;
  var step = Math.pow(10, -r.digits);
  var span = Math.max(d.max - d.min, step * 5);
  var lo = d.min - span * 0.12, hi = d.max + span * 0.12;

  // 적정 범위 — 값 칸의 색과 같은 밴드(bandFor → limits.py 가 주입한 BANDS/NUT_BANDS).
  // 숫자를 여기 또 적지 않는다. 한쪽 끝이 null 이면(용존산소 상한) 그쪽은 데이터 끝까지.
  var b = bandFor(key);
  var ok = b && b.ok;
  // 세로축이 기준 경계를 담게 넓힌다. 다만 경계가 너무 멀면(염도 15~35 에 실제 18.2)
  // 곡선이 바닥에 눌려 변화를 읽을 수 없으므로, 전체 폭은 데이터 폭의 5배까지만
  // 허용하고 그보다 먼 경계는 가장자리에 ▲/▼ 값으로 적는다.
  // 가까운 경계부터 넣는다 — 먼 쪽을 먼저 넣으면 가까운 쪽이 밀려날 수 있다.
  var maxRange = span * 5, edge = span * 0.06;
  var offTop = null, offBottom = null;
  var fitLow = function(){
    if (ok[0] === null || ok[0] >= lo + edge) return;
    if (hi - (ok[0] - edge) <= maxRange) lo = Math.min(lo, ok[0] - edge); else offBottom = ok[0];
  };
  var fitHigh = function(){
    if (ok[1] === null || ok[1] <= hi - edge) return;
    if ((ok[1] + edge) - lo <= maxRange) hi = Math.max(hi, ok[1] + edge); else offTop = ok[1];
  };
  if (ok) {
    var gapLow = ok[0] === null ? Infinity : d.min - ok[0];
    var gapHigh = ok[1] === null ? Infinity : ok[1] - d.max;
    if (gapLow <= gapHigh) { fitLow(); fitHigh(); } else { fitHigh(); fitLow(); }
  }

  var r1 = function(v){ return Math.round(v * 10) / 10; };
  var t0 = pts[0][0], t1 = Math.max(pts[pts.length-1][0], t0 + 1);
  var x = function(tt){ return r1(padL + (tt - t0) / (t1 - t0) * (W - padL - padR)); };
  var y = function(v){ return r1(padT + (hi - v) / (hi - lo) * (H - padT - padB)); };
  var mono = 'font-size="11" font-family="ui-monospace,monospace"';

  // 적정 범위 띠와 경계선
  var band = "";
  if (ok) {
    var top = (ok[1] === null) ? hi : Math.min(ok[1], hi);
    var bottom = (ok[0] === null) ? lo : Math.max(ok[0], lo);
    if (top > bottom) {
      band = '<rect x="' + padL + '" y="' + y(top) + '" width="' + (W - padL - padR) +
             '" height="' + r1(y(bottom) - y(top)) + '" fill="#10B981" opacity="0.12"/>';
    }
    [ok[0], ok[1]].forEach(function(v){
      if (v === null || v < lo || v > hi) return;
      band += '<line x1="' + padL + '" y1="' + y(v) + '" x2="' + (W - padR) + '" y2="' + y(v) +
              '" stroke="#10B981" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>' +
              '<text x="' + (W - padR - 4) + '" y="' + (y(v) - 4) + '" text-anchor="end" fill="#34D399" ' +
              mono + '>' + v.toFixed(r.digits) + '</text>';
    });
    if (offTop !== null)
      band += '<text x="' + (W - padR - 4) + '" y="' + (padT + 11) + '" text-anchor="end" fill="#34D399" ' +
              mono + '>▲ ' + offTop.toFixed(r.digits) + '</text>';
    if (offBottom !== null)
      band += '<text x="' + (W - padR - 4) + '" y="' + (H - padB - 4) + '" text-anchor="end" fill="#34D399" ' +
              mono + '>▼ ' + offBottom.toFixed(r.digits) + '</text>';
  }

  // 최저~최고 범위(칸마다)를 옅게 깔고 그 위에 평균선을 얹는다.
  var upper = pts.map(function(p){ return x(p[0]) + "," + y(p[3]); });
  var lower = pts.map(function(p){ return x(p[0]) + "," + y(p[2]); }).reverse();
  var spread = '<polygon points="' + upper.concat(lower).join(" ") +
               '" fill="' + accent() + '" opacity="0.18"/>';
  var line = '<polyline fill="none" stroke="' + accent() + '" stroke-width="2" ' +
             'stroke-linejoin="round" stroke-linecap="round" points="' +
             pts.map(function(p){ return x(p[0]) + "," + y(p[1]); }).join(" ") + '"/>';

  // 가로 눈금 4개
  var gridY = "", labelsY = "";
  for (var i = 0; i <= 3; i++) {
    var v = lo + (hi - lo) * i / 3, gy = y(v);
    gridY += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy +
             '" stroke="#22304C" stroke-width="1"/>';
    labelsY += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#64748B" ' +
               mono + '>' + v.toFixed(r.digits) + '</text>';
  }

  // 세로 눈금 — 시각
  var labelsX = "";
  [0, 0.5, 1].forEach(function(f){
    var tt = t0 + (t1 - t0) * f;
    labelsX += '<text x="' + x(tt) + '" y="' + (H - 8) + '" text-anchor="' +
      (f === 0 ? "start" : f === 1 ? "end" : "middle") + '" fill="#64748B" ' + mono + '>' +
      fmtTick(tt, hours) + '</text>';
  });

  var last = pts[pts.length-1];
  var dot = '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="4" fill="' + accent() + '"/>';

  plot.innerHTML =
    '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      gridY + band + spread + line + dot + labelsY + labelsX +
    '</svg>';
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
  // 모드는 수집기가 정본이다. 화면이 바꾼 뒤에도, SSH 로 설정을 고친 뒤에도 따라간다.
  if (d.mode && d.mode !== MODE) applyMode(d.mode);
  document.getElementById("link").innerHTML = renderLink(d);
  document.getElementById("ver").textContent = d.version ? "v" + d.version : "";
  renderAi(d);
  renderPowerChip(d);
  if (powerOpen) drawPower(d);
  if (envEachKey) drawEnvEach(d);
  else if (wxOpen) drawWeather(d);
  // 그래프를 보고 있는 중에는 뒤 화면을 다시 그리지 않는다.
  // 3초마다 갱신하면 조작 중에 깜빡이고 눌림이 씹힌다.
  if (!chartKey) document.getElementById("main").innerHTML = renderValues(d);
  document.getElementById("overlay").innerHTML = renderOverlay(d);

  var st = statusText(d);
  var bad = d.status_code ? (d.status_code === "send_fail" || d.status_code === "sensor_error")
                          : /FAIL|ERROR|실패|오류/i.test(d.status || "");
  document.getElementById("dot").className = "dot" + (bad ? " bad" : (d.linked ? " ok" : ""));
  document.getElementById("status").textContent = st;
  document.getElementById("time").textContent = d.updated_at || "";

  document.getElementById("settings").textContent = t("settings");
  var btn = document.getElementById("action");
  btn.textContent = d.linked ? t("info") : t("link_device");
  btn.className = "act" + (d.linked ? " ghost" : "");
  btn.onclick = d.linked ? showInfo : startPair;
}

// 하단 상태줄 문장. 수집기가 status_code(+ status_args 의 숫자)를 주면 화면 언어로
// 만들고, 코드가 없으면(예전 수집기·모르는 코드) 수집기가 준 문자열을 그대로 쓴다.
function statusText(d){
  var c = d.status_code, a = d.status_args || {};
  if (!c || !I18N["st_" + c]) return d.status || "";
  var key = (c === "sent" && a.sent) ? "st_sent_more" : "st_" + c;
  // textContent 로 넣으므로 이스케이프하지 않는다.
  var s = t(key, {at: a.at || "", sent: a.sent || 0});
  // 못 올리고 쌓아 둔 건수와 그 시각 — "지금 안 올라가고 있다" 를 실감나게 한다.
  if (c === "send_fail" || c === "unlinked") {
    if (a.pending) s += " · " + t("held", {n: a.pending});
    if (a.at) s += " (" + a.at + ")";
  }
  return s;
}

// ── AI 모드 ───────────────────────────────────────────────────────────────
//
// 이 장비는 값을 띄우는 계측기가 아니라 스스로 판정하고 권고한다. 그런데 평소
// 화면은 숫자 넉 장뿐이라 그 사실이 보이지 않는다. 머리에 표시를 두어 켜져 있음을
// 늘 알리고, 누르면 **무엇을 하고 있는지**를 연다 — 현장에서도 점검 자리에서도
// "AI 가 뭘 한다는 거냐" 는 질문에 화면이 직접 답하게 하려는 것이다.
//
// 켜졌다고 쓰는 근거는 수집기가 보내 준다(판정 모듈 + 측정 이력이 다 있을 때만).
// 화면이 제멋대로 켜졌다고 하면 그 표시는 거짓말이 된다.
var aiOpen = false;

function renderAi(d){
  var ai = d.ai || {};
  var on = !!ai.enabled;
  var el = document.getElementById("ai");
  el.className = "ai" + (on ? " on" : "");
  document.getElementById("ailabel").textContent = on ? t("ai_mode") : t("ai_off");
  if (aiOpen) drawAi(d);
}

function openAi(){ aiOpen = true; drawAi(lastState || {}); }
function closeAi(){ aiOpen = false; document.getElementById("aipanel").innerHTML = ""; }

function drawAi(d){
  var ai = d.ai || {}, on = !!ai.enabled;
  var anomalies = (d.anomalies || []).length;
  var advice = (d.advice || []).length;

  // 기준 이탈은 지금 값으로 바로 센다 — 화면의 색과 같은 판정이다.
  var out = 0;
  var vals = d.values || {};
  for (var k in vals) { if (typeof vals[k] === "number" && level(k, vals[k])) out++; }

  var cnt = function(n){ return n ? t("ai_cases", {n:n}) : t("ai_none"); };
  var layer = function(n, ttl, dsc, now){
    return '<div class="layer"><span class="n">' + n + '</span>' +
           '<div><div class="ttl">' + t(ttl) + '</div>' +
           '<div class="dsc">' + t(dsc) + '</div></div>' +
           '<span class="now">' + now + '</span></div>';
  };

  var foot = on
    ? (ai.at ? t("ai_last", {t:esc(ai.at), m:Math.round((ai.interval_s||300)/60)}) + '<br>' : '')
      + t("ai_local")
    : t("ai_offd");

  document.getElementById("aipanel").innerHTML =
    '<div class="overlay"><h1>' + t("ai_title") + '</h1>' +
      '<div class="aibox">' +
        layer(1, "ai_l1", "ai_l1d", cnt(out)) +
        layer(2, "ai_l2", "ai_l2d",
              (on && ai.samples ? t("ai_watching", {h:ai.window_h||96, n:ai.samples}) + '<br>' : '') + cnt(anomalies)) +
        layer(3, "ai_l3", "ai_l3d", isAgri() ? nutState(d.nutrient) : cnt(advice)) +
        '<div class="foot">' + foot + '</div>' +
      '</div>' +
      '<div class="ovbtns"><button class="act ghost" onclick="closeAi()">' + t("close") + '</button></div>' +
    '</div>';
}

// AI 설명판 3번 칸(스마트팜) — 권고 건수 대신 지금 양액 판정을 한 단어로.
function nutState(n){
  if (!n) return t("ai_nut_off");
  if (n.verdict === "low") return t("ai_nut_low");
  if (n.verdict === "high") return t("ai_nut_high");
  return n.verdict === "ok" ? t("ai_nut_ok") : t("ai_none");
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
    {t:"menu_mode",    sub:"menu_mode_sub",    fn:"openMode()"},
    {t:"menu_cal",      sub:"menu_cal_sub",      fn:"openCal()"},
    {t:"menu_nutrient", sub:"menu_nutrient_sub", fn:"openNutrient()"},
    {t:"menu_wireless", sub:"menu_wireless_sub", fn:"openWireless()"},
    {t:"menu_restart", sub:"menu_restart_sub", fn:"openRestart()"}
  ];
  // 전력 회로는 [power] 를 켠 장비에만 — 꺼진 장비에 빈 메뉴를 두지 않는다.
  if (lastState && lastState.power) {
    items.splice(items.length - 1, 0, {t:"menu_power", sub:"menu_power_sub", fn:"openPowerTypes()"});
  }
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

// ── 모드 설정 ────────────────────────────────────────────────────────────────
// 양식장(Shrimp365) / 스마트팜(Farm365) 두 칸 토글. 누르는 즉시 수집기에 저장하고
// 화면도 바로 갈아입는다 — 재시작이 필요 없다(이름·라벨·색만 바뀌므로).
var modeMsg = null;

function openMode(){ modeMsg = null; drawMode(); }

function drawMode(){
  document.getElementById("wifi").innerHTML = "";
  var cell = function(val, label, sub, brand){
    return '<button aria-pressed="' + (MODE === val ? "true" : "false") + '" ' +
      'onclick="setMode(&quot;' + val + '&quot;)">' +
      t(label) + ' <span style="font-weight:600;opacity:.8">· ' + brand + '</span>' +
      '<small>' + t(sub) + '</small></button>';
  };
  var msg = modeMsg ? '<div class="msg ' + modeMsg.kind + '">' + esc(modeMsg.text) + '</div>' : "";
  document.getElementById("setup").innerHTML =
    '<div class="setup">' +
      '<div class="chead">' +
        '<span class="ctitle">' + t("menu_mode") + '</span>' +
        '<button style="margin-left:auto" onclick="drawSettingsMenu()">' + t("back_menu") + '</button>' +
      '</div>' +
      '<div class="sbody">' +
        msg +
        '<div class="sub" style="margin:2px 0 8px">' + t("mode_hint") + '</div>' +
        '<div class="seg">' +
          cell("shrimp", "mode_shrimp", "mode_shrimp_sub", BRAND.shrimp.name) +
          cell("agriculture", "mode_agri", "mode_agri_sub", BRAND.agriculture.name) +
        '</div>' +
        '<div class="sub">' + t("mode_ec_note") + '</div>' +
      '</div>' +
    '</div>';
}

function setMode(m){
  if (m !== "shrimp" && m !== "agriculture") return;
  if (m === MODE) return;
  fetch("/api/mode", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({mode:m})})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.ok){
        applyMode(d.mode || m);
        if (lastState) {   // 뒤 화면도 새 모드(와 바뀐 EC 단위)로 — 다음 갱신을 기다리지 않는다
          lastState.mode = MODE;
          if (d.ec_unit) lastState.ec_unit = d.ec_unit;
          render(lastState);
        }
        modeMsg = {kind:"ok", text: d.saved ? t("mode_saved") : t("saved_mem")};
      } else {
        modeMsg = {kind:"err", text:(d && d.error) || t("save_fail")};
      }
      drawMode();
    })
    .catch(function(){ modeMsg = {kind:"err", text:t("save_fail")}; drawMode(); });
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

// 전도도를 mS/cm 로 보는 장비(스마트팜 기본)는 보정 화면도 mS/cm 로 보이고 받는다.
// 계기판·그래프가 1.64 mS/cm 인데 여기만 1640 uS/cm 이면 휴대용 측정기 값을 옮겨
// 적을 때 단위를 사람이 바꿔야 한다. 서버·설정 파일에는 uS/cm 그대로 보낸다.
function calDiv(k){
  return (k === "conductivity" && lastState && lastState.ec_unit === "ms") ? 1000 : 1;
}
function calUnit(it){ return calDiv(it.k) === 1000 ? "mS/cm" : it.unit; }
function calShow(k, v){
  if (v === null || v === undefined) return v;
  var d = calDiv(k);
  return d === 1 ? v : Math.round(v / d * 1000) / 1000;
}

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
        '<span class="sub">' + t("cal_now") + ' ' + fmt(calShow(it.k, calData.raw[it.k])) + ' ' + calUnit(it) + '</span><br>' +
        '<b style="font-size:24px;font-family:ui-monospace,monospace">' + (calBuf || "0") + '</b> ' + calUnit(it) +
      '</div>' +
      '<div class="kbd" style="max-width:330px">' + rows +
        '<div class="krow">' +
          '<button class="wide" onclick="calCancel()">' + t("cancel") + '</button>' +
          '<button class="go" onclick="calApply()">' + t("save") + '</button>' +
        '</div></div>';
  } else {
    var msg = calMsg ? '<div class="msg ' + calMsg.kind + '">' + esc(calMsg.text) + '</div>' : "";
    var list = CAL_ITEMS.map(function(it){
      var raw = calShow(it.k, calData.raw[it.k]), off = calShow(it.k, calData.offsets[it.k] || 0),
          cor = calShow(it.k, calData.corrected[it.k]);
      var offTxt = off ? (off > 0 ? "+" + off : String(off)) : "0";
      return '<div class="srow">' +
        '<div class="sname">' + t(it.t) +
          '<div class="sub">' + t("cal_now") + ' ' + fmt(raw) + ' ' + calUnit(it) +
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
  calEdit = k; calBuf = String(calShow(k, calData.raw[k])); drawCal();
}
function calCancel(){ calEdit = null; calBuf = ""; drawCal(); }
function calKey(k){
  if (k === "back") calBuf = calBuf.slice(0, -1);
  else if (k === "."){ if (calBuf.indexOf(".") < 0) calBuf += "."; }
  else calBuf = (calBuf === "0" ? "" : calBuf) + k;
  if (calBuf.length > 9) calBuf = calBuf.slice(0, 9);
  drawCal();
}
// mS/cm → uS/cm 곱셈은 부동소수 오차를 남긴다(1.64*1000 = 1639.9999999999998).
// 그대로 보내면 보정값이 -2e-13 처럼 0 이 아니게 저장되므로 소수 셋째 자리에서 자른다.
function calApply(){
  var v = parseFloat(calBuf || "0") * calDiv(calEdit);
  calSend({name: calEdit, actual: Math.round(v * 1000) / 1000});
}
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
        extrasRows(d) +
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
  if (key === "flow") return t("n_flow");
  if (key === "dp") return t("n_dp");
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
    // 서버가 준 한국어 label 대신 화면 언어 이름을 쓴다(1.9.1 은 영어 화면에도 "용존산소").
    var head = '<b>' + esc(senName(sen.key)) + '</b> <span class="dim">ID ' + sen.slave_id + '</span> — ' +
      (sen.ok ? '<span class="okv">' + t("test_comm_ok") + '</span>'
              : '<span class="badv">' + t("test_no_reply") + '</span>');
    if (!sen.ok) return '<div class="trow">' + head + '</div>';
    var rows = (sen.fields || []).map(function(f){
      var v = verdictText(f);
      var shown = (f.value === null || f.value === undefined) ? "--" : f.value;
      var unit = f.unit || "";
      // 전도도는 수집기가 uS/cm 로 맞춰 보낸다. [센서 설정] 의 단위가 mS/cm 면
      // 계기판과 같게 나눠 보여 준다(1.9.1 은 값 uS·단위 mS 로 1000배 틀렸다).
      if (f.name === "conductivity" && unit === "uS/cm" && typeof f.value === "number" &&
          setupData && setupData.ec_unit === "ms") {
        shown = (f.value / 1000).toFixed(2); unit = "mS/cm";
      }
      if (unit === "C") unit = "\u00B0C";
      return '<div class="tfield">' +
        '<span class="tname">' + esc(f.name) + '</span>' +
        '<span class="tval">' + esc(String(shown)) + ' <span class="dim">' + esc(unit) + '</span></span>' +
        '<span class="' + v.cls + '">' + v.txt + '</span>' +
        '<span class="dim traw">' + t("raw") + ' ' + (f.raw === null ? "-" : f.raw) + '</span>' +
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

// 스마트팜 — 수질 센서 말고 켜고 끄는 것(환경·기상, 양액, 전력). 끄면 그 칸을 그리지 않는다.
function extrasRows(d){
  if (!isAgri() || !d.extras) return "";
  return '<div class="wlhead" style="margin-top:10px">' + t("ext_title") + '</div>' +
    '<div class="sub" style="margin:2px 0 6px">' + t("ext_hint") + '</div>' +
    ["env","nutrient","power"].map(function(k){
      var on = !!d.extras[k];
      return '<div class="srow"><div class="sname">' + t("ext_" + k) +
        '<div class="sub">' + (on ? t("in_use") : t("not_used")) + '</div></div>' +
        '<button class="toggle' + (on ? " on" : "") + '" onclick="toggleExtra(&quot;' + k + '&quot;)">' +
        (on ? t("on") : t("off")) + '</button></div>';
    }).join("");
}
function toggleExtra(k){
  setupData.extras[k] = !setupData.extras[k];
  drawSettings();
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
  if (isAgri() && setupData.extras) payload.extras = setupData.extras;
  fetch("/api/sensors/save", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.ok) {
        setupMsg = {kind:"ok", text: d.restarting ? t("restarting") : d.saved ? t("saved_ok") : t("saved_mem")};
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
applyMode(MODE);   // 서버가 새겨 준 첫 모드로 이름·부제를 맞춘다
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
    mode="shrimp",
    get_mode=None,
    on_set_mode=None,
    on_set_power_type=None,
    on_power_control=None,
    get_wireless=None,
    on_wireless=None,
    get_lang=None,
) -> ThreadingHTTPServer | None:
    """상태 페이지를 띄운다. 실패해도 수집은 계속되어야 하므로 None 을 돌려준다.

    language·mode 는 처음 값이다. get_lang()·get_mode() 를 주면 페이지를 줄 때마다
    **지금** 언어·모드를 새긴다 — 1.9.1 은 serve() 시작 때 한 번만 새겨서, 화면에서
    언어를 바꾼 뒤 페이지만 새로고침되면(버전 갱신·재시작 후 자동 새로고침 등)
    부팅 때 언어로 돌아갔다.
    """

    # 판정 숫자는 limits.py 한 곳에서만 온다 — 화면에 같은 값을 또 적어 두면
    # 한쪽만 고쳐져 수조 옆 색과 서버 알림이 어긋난다(실제로 수온이 그랬다).
    page_base = (PAGE
                 .replace("__BANDS__", json.dumps(limits.BANDS))
                 .replace("__NUT_BANDS__", json.dumps(limits.NUTRIENT_BANDS)))
    first = {"lang": language, "mode": mode}

    def current_lang() -> str:
        lang_now = first["lang"]
        if get_lang is not None:
            try:
                lang_now = get_lang()
            except Exception as exc:  # noqa: BLE001 — 화면이 언어 때문에 죽으면 안 된다
                log.warning("화면 언어를 읽지 못했습니다: %s", exc)
        return lang_now if lang_now in ("ko", "en", "vi", "id") else "ko"

    def current_mode() -> str:
        mode_now = first["mode"]
        if get_mode is not None:
            try:
                mode_now = (get_mode() or {}).get("mode", mode_now)
            except Exception as exc:  # noqa: BLE001
                log.warning("장비 모드를 읽지 못했습니다: %s", exc)
        return mode_now if mode_now in ("shrimp", "agriculture") else "shrimp"

    def page_bytes() -> bytes:
        # 첫 페인트부터 올바른 언어·이름·색이어야 한다. 그 뒤로는 /api/state 의
        # mode 를 따라가고, 언어는 화면이 바꿀 때 /api/lang 으로 수집기에 남긴다.
        return (page_base
                .replace("__LANG__", current_lang())
                .replace("__MODE__", current_mode())).encode()

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
            elif self.path == "/api/wireless" and get_wireless is not None:
                self._send(200, json.dumps(get_wireless()).encode(), "application/json")
            elif self.path.startswith("/api/env_history"):
                self._env_history()
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
            elif self.path == "/api/mode" and get_mode is not None:
                self._send(200, json.dumps(get_mode()).encode(), "application/json")
            elif self.path in ("/", "/index.html"):
                self._send(200, page_bytes(), "text/html; charset=utf-8")
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

        def _env_history(self) -> None:
            if history is None:
                self._send(200, b'{"sensors":[],"avg":[],"count":0}', "application/json")
                return
            query = parse_qs(urlparse(self.path).query)
            slot = (query.get("slot") or [""])[0]
            try:
                hours = int((query.get("hours") or ["24"])[0])
            except ValueError:
                hours = 24
            if hours not in (6, 12, 24, 168):
                hours = 24
            self._send(200, json.dumps(history.env_series(slot, hours)).encode(), "application/json")

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
            if self.path == "/api/mode" and on_set_mode is not None:
                body = self._body()
                mode_sel = body.get("mode")
                if not isinstance(mode_sel, str):
                    self._send(200, json.dumps({"ok": False, "error": "요청이 올바르지 않습니다."}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_set_mode(mode_sel)).encode(), "application/json")
                return
            if self.path.startswith("/api/wireless/") and on_wireless is not None:
                action = self.path[len("/api/wireless/"):]
                body = self._body()
                if action not in ("permit", "register", "remove", "enable", "ble_fetch", "ble_add", "ble_remove",
                                  "ble_forget") or not isinstance(body, dict):
                    self._send(200, json.dumps({"ok": False, "error": "요청이 올바르지 않습니다."}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_wireless(action, body)).encode(), "application/json")
                return
            if self.path == "/api/power/control" and on_power_control is not None:
                body = self._body()
                if not isinstance(body, dict):
                    self._send(200, json.dumps({"ok": False, "error": "요청이 올바르지 않습니다."}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_power_control(body), ensure_ascii=False).encode(), "application/json")
                return
            if self.path == "/api/power/type" and on_set_power_type is not None:
                body = self._body()
                sid, kind = body.get("id"), body.get("type")
                if not isinstance(sid, str) or not isinstance(kind, str):
                    self._send(200, json.dumps({"ok": False, "error": "요청이 올바르지 않습니다."}).encode(),
                               "application/json")
                    return
                self._send(200, json.dumps(on_set_power_type(sid, kind)).encode(), "application/json")
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
