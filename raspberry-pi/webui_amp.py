"""AMP AquaPilot — 에이엠피(AMP) 전용판 장비 화면.

config.ini 의 [brand] edition = amp 일 때 shrimp365_sensor.py 가 webui.serve 대신
이 모듈의 serve() 를 쓴다. 기본값(shrimp365)이면 이 파일은 불리지 않는다.

구조 — 페이지만 갈아 끼운다
  · HTTP 처리(엔드포인트·State 계약·오류 처리)는 webui.serve() 하나가 그대로 맡는다.
    이 모듈은 webui.serve(..., _page=...) 로 **보여 줄 HTML 만** 바꿔 넣는다.
    그래서 /api/* 는 두 에디션이 한 코드다 — 한쪽만 고쳐져 어긋날 일이 없다.
  · 양식장 모드 고정. 모드·양액·무선 센서·전력 켜고 끄기 콜백은 받아도 넘기지 않는다
    (그 엔드포인트는 이 에디션에서 404). 전력 회로는 [설정] 안에서 보기만 한다.
  · 판정 숫자는 limits.BANDS 를 그대로 주입한다(webui.py 와 같은 기준).
  · 문구는 이 파일의 I18N 이 먼저, 없는 키(하단줄 status_code·운전 권고·센서 진단 등)는
    webui.py 의 I18N 을 그대로 꺼내 쓴다(BASE_I18N).

★ 임시 브랜드 — 에이엠피 실제 자료가 오면 아래 세 곳만 바꾼다.
  · 제품명 : 아래 BRAND_MARK / PRODUCT 두 상수. 창 제목·워드마크·기기 정보·
             문자 LCD·로그 첫 줄이 모두 이 값을 쓴다.
  · 색     : PAGE 안 <style> 맨 앞 "BRAND TOKENS" 블록(:root = 다크, [data-theme=light]).
             화면 CSS 는 토큰만 참조한다. 상태색(--ok/--warn/--crit)은 브랜드와 무관하다.
  · 로고   : PAGE 안 <symbol id="amp-mark"> 하나. 모든 자리가 <use href="#amp-mark"> 로 참조한다.
  고객센터 번호·앱 이름·포털 주소는 코드가 아니라 config.ini [brand] 에서 받는다
  (support_phone · app_name · pair_url). 비어 있으면 그 줄을 숨긴다.

설계: docs/amp/design.md · 시안: docs/amp/prototype/amp-kiosk-prototype.html
설치: docs/amp/INSTALL-AMP.md
"""

from __future__ import annotations

import json
import logging
import re
from html import escape as _html

import limits
import webui

log = logging.getLogger("shrimp365.webui_amp")

# ── 제품명(임시) — 여기 두 줄만 바꾸면 화면·LCD·로그가 함께 바뀐다 ─────────────
BRAND_MARK = "AMP"
PRODUCT = "AquaPilot"
PRODUCT_NAME = f"{BRAND_MARK} {PRODUCT}"

EDITIONS = ("shrimp365", "amp")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def read_brand(cfg) -> dict:
    """config.ini 의 [brand] 를 읽는다. 구간·키가 없거나 모르는 값이면 shrimp365 이다.

    돌려주는 것: edition(shrimp365|amp), name(화면·LCD·로그에 쓸 이름),
    support_phone · app_name · pair_url(없으면 "").
    """
    def get(key: str, limit: int) -> str:
        try:
            value = cfg.get("brand", key, fallback="", raw=True)
        except Exception:  # noqa: BLE001 — 설정 한 줄 때문에 수집기가 서면 안 된다
            value = ""
        return _CTRL.sub("", str(value or "")).strip()[:limit]

    edition = get("edition", 20).lower()
    if edition not in EDITIONS:
        edition = "shrimp365"
    return {
        "edition": edition,
        "name": PRODUCT_NAME if edition == "amp" else "Shrimp365",
        "support_phone": get("support_phone", 40),
        "app_name": get("app_name", 40),
        "pair_url": get("pair_url", 80),
    }


def _base_i18n() -> str:
    """webui.py 의 I18N 객체 글자를 그대로 꺼낸다(하단줄·권고·센서 진단 문구 재사용)."""
    m = re.search(r"\nvar I18N = (\{.*?\n\});", webui.PAGE, re.S)
    if not m:
        log.warning("webui.py 의 I18N 을 찾지 못했습니다 — 일부 문구가 키 이름으로 보입니다.")
        return "{}"
    return m.group(1)


def _js(value) -> str:
    """<script> 안에 넣을 JSON. 태그를 닫거나 자리표시(__X__)와 겹치지 않게 막는다."""
    return (json.dumps(value, ensure_ascii=False)
            .replace("</", "<\\/").replace("__", "_\\u005f"))


def serve(
    state,
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
    *,
    brand: dict | None = None,
):
    """webui.serve() 와 같은 시그니처. AMP판이 쓰지 않는 콜백은 받아도 넘기지 않는다.

    brand 는 read_brand() 의 결과(support_phone·app_name·pair_url). 없으면 빈 값.
    """
    info = brand or {}
    brand_js = _js({
        "mark": BRAND_MARK, "product": PRODUCT, "name": PRODUCT_NAME,
        "support_phone": str(info.get("support_phone") or ""),
        "app_name": str(info.get("app_name") or ""),
        "pair_url": str(info.get("pair_url") or ""),
    })
    base = (PAGE
            .replace("__TITLE__", _html(PRODUCT_NAME))
            .replace("__BANDS__", json.dumps(limits.BANDS))
            .replace("__BRAND__", brand_js)
            .replace("__BASE_I18N__", _base_i18n()))

    def page(lang: str, _mode: str) -> bytes:
        return base.replace("__LANG__", lang).encode()

    return webui.serve(
        state, port,
        on_pair_start=on_pair_start,
        on_pair_cancel=on_pair_cancel,
        on_unlink=on_unlink,
        history=history,
        on_test=on_test,
        on_save_sensors=on_save_sensors,
        get_sensors=get_sensors,
        get_wifi=get_wifi,
        on_wifi_scan=on_wifi_scan,
        on_wifi_connect=on_wifi_connect,
        language=language,
        on_set_lang=on_set_lang,
        on_restart=on_restart,
        on_reboot=on_reboot,
        get_calibration=get_calibration,
        on_save_calibration=on_save_calibration,
        mode="shrimp",
        get_lang=get_lang,
        _page=page,
    )


PAGE = r"""<!doctype html>
<html lang="__LANG__" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800,initial-scale=1">
<title>__TITLE__</title>
<style>
/* ======================================================================
   BRAND TOKENS — 임시(1안 딥네이비 + 시안). 에이엠피 확정 색이 오면 이 블록만 바꾼다.
   :root = 다크(기본) / [data-theme=light] = 라이트. 상태색은 브랜드와 무관 — 바꾸지 않는다.
   ====================================================================== */
:root{
  --font: system-ui, "Noto Sans CJK KR", "Noto Sans KR", sans-serif;
  --press: brightness(1.15);
  --logo-tile:#1E4FA8; --logo-line:#FFFFFF; --logo-dot:#22C3E6;
  --brand:#22C3E6; --on-brand:#03222B; --brand-text:#22C3E6; --brand-soft:#22C3E61F; --focus:#7FE3F7;
  --bg:#0A1324; --surface:#111D33; --surface-2:#18263F; --line:#26375A; --line-strong:#3A4E77;
  --text:#EAF0FA; --text-2:#A9B6CC; --text-3:#7D8BA3;
  /* 상태색 · 다크 */
  --ok:#3DD68C; --warn:#FFB020; --crit:#FF6B6B;
  --ok-soft:#3DD68C1A; --warn-soft:#FFB0201F; --crit-soft:#FF6B6B24;
  --crit-fill:#B3261E; --on-crit:#FFFFFF; --band:#3DD68C1F; --scrim:#000000A6;
}
:root[data-theme="light"]{
  --press: brightness(.93);
  --logo-tile:#0F3B78; --logo-line:#FFFFFF; --logo-dot:#22C3E6;
  --brand:#0F3B78; --on-brand:#FFFFFF; --brand-text:#0A5F86; --brand-soft:#0F3B7814; --focus:#0A5F86;
  --bg:#F2F5FA; --surface:#FFFFFF; --surface-2:#E8EDF5; --line:#C9D3E3; --line-strong:#9AA8BF;
  --text:#0B1A33; --text-2:#42526B; --text-3:#5F6E86;
  /* 상태색 · 라이트 */
  --ok:#0E7A45; --warn:#9A5B00; --crit:#C42B2B;
  --ok-soft:#0E7A4514; --warn-soft:#F5A5241F; --crit-soft:#C42B2B14;
  --crit-fill:#B3261E; --on-crit:#FFFFFF; --band:#0E7A4517; --scrim:#0B1A3380;
}
/* ====================== BRAND TOKENS 끝 — 아래는 토큰만 쓴다(직접 hex 금지) ====================== */

*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;width:800px;height:480px;overflow:hidden;background:var(--bg)}
#app{position:relative;width:800px;height:480px;overflow:hidden;background:var(--bg);color:var(--text);
  font:500 16px/1.35 var(--font);font-variant-numeric:tabular-nums;-webkit-user-select:none;user-select:none}
:where(#app button){font:inherit;color:inherit;-webkit-tap-highlight-color:transparent;cursor:pointer;margin:0}
#app h1,#app h2,#app p{margin:0}
#app button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
#app h1[tabindex]:focus{outline:none}
#app button:active:not(:disabled){filter:var(--press)}
.scr{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg)}
.enter{animation:scrIn .18s ease-out}
@keyframes scrIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

.ic{width:24px;height:24px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ic.s{width:20px;height:20px}
.ic.l{width:28px;height:28px}
.ic.dim{color:var(--text-3)}

/* 워드마크 — 크기는 font-size 하나로 */
.wm{display:inline-flex;align-items:center;gap:.45em;font-size:17px;line-height:1;white-space:nowrap;color:var(--text)}
.wm svg{width:1.65em;height:1.65em;flex:none}
.wm-amp{font-weight:800;letter-spacing:.06em}
.wm-prod{font-weight:600;color:var(--brand-text);margin-left:-.1em}
.wm.md{font-size:24px}
.wm.lg{font-size:40px}

/* 상단 바 */
.bar{height:56px;flex:none;display:flex;align-items:center;gap:6px;padding:0 12px;background:var(--surface);border-bottom:1px solid var(--line)}
.bar h1{font-size:20px;font-weight:700;white-space:nowrap}
.sp{flex:1 1 0;min-width:0}
.meta{font-size:14px;color:var(--text-3);white-space:nowrap}
.who{display:flex;flex-direction:column;gap:3px;flex:0 1 auto;min-width:0}
.site{font-size:13px;color:var(--text-2);padding-left:36px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}

/* 버튼 */
.btn{min-height:48px;min-width:48px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;
  border-radius:12px;border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font-weight:600;font-size:16px;white-space:nowrap}
.btn.ghost{background:transparent}
.btn.back{padding:0 14px 0 8px}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.btn.danger{background:var(--crit-fill);border-color:var(--crit-fill);color:var(--on-crit)}
.btn.on-crit{background:transparent;border-color:var(--on-crit);color:var(--on-crit)}
.btn:disabled{opacity:.45;cursor:not-allowed}

/* 칩(상단 상태) */
.chip{min-height:48px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:24px;flex:0 1 auto;min-width:0;
  border:1px solid var(--line-strong);background:transparent;color:var(--text-2);font-weight:600;font-size:15px;white-space:nowrap}
.chip .lbl{overflow:hidden;text-overflow:ellipsis;min-width:0}
.chip b{font-weight:700}
.chip.ai{border-color:transparent;background:var(--brand-soft);color:var(--brand-text)}
.chip.ai b{color:var(--text)}
.chip.ai.alarm{background:var(--crit-fill);color:var(--on-crit)}
.chip.ai.alarm b{color:var(--on-crit)}
.chip.ai.hold{background:var(--surface-2);color:var(--text-2)}
.chip.net.fail{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}

/* 상태 표지 — 색 + 아이콘 모양 + 글자 3중 */
.pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 8px;border-radius:16px;font-size:15px;font-weight:700;white-space:nowrap;flex:none}
.pill.ok{color:var(--ok)}
.pill.warn{color:var(--warn);background:var(--warn-soft);box-shadow:inset 0 0 0 1px var(--warn)}
.pill.crit{color:var(--on-crit);background:var(--crit-fill)}
.pill.fault{color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line-strong)}

/* 대시보드 — 값 칸 */
.grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;padding:10px 12px 0}
.card{display:flex;flex-direction:column;justify-content:space-between;min-width:0;text-align:left;padding:12px 18px 12px;
  border-radius:16px;border:2px solid var(--line);background:var(--surface);color:var(--text)}
.card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.card-k{font-size:18px;font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.card-v{display:flex;align-items:baseline;gap:8px;line-height:1}
.num{font-size:72px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.unit{font-size:22px;font-weight:600;color:var(--text-2)}
.card-f{display:flex;align-items:center;gap:14px;font-size:14px;color:var(--text-3);white-space:nowrap;overflow:hidden;min-height:20px}
.card-f .tr{display:inline-flex;align-items:center;gap:4px}
.card-f.note{color:var(--warn);font-weight:600;gap:6px}
.card-f.note span{overflow:hidden;text-overflow:ellipsis}
.card.warn{border-color:var(--warn);background:linear-gradient(var(--warn-soft),var(--warn-soft)),var(--surface)}
.card.crit{border-color:var(--crit);box-shadow:inset 0 0 0 1px var(--crit);background:linear-gradient(var(--crit-soft),var(--crit-soft)),var(--surface)}
.card.fault{border-style:dashed;border-color:var(--line-strong)}
.card.fault .num{font-size:48px;color:var(--text-3)}
.card-err{display:flex;flex-direction:column;gap:2px;min-width:0}
.card-err b{display:inline-flex;align-items:center;gap:6px;font-size:16px;color:var(--text)}
.card-err small{font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 권고 띠 / 경보 띠 */
.strip{flex:none;height:64px;margin:10px 12px 12px;display:flex;align-items:center;gap:12px;padding:0 8px 0 12px;
  border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--text);text-align:left}
button.strip{width:calc(100% - 24px)}
.strip .ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:none;background:var(--brand-soft);color:var(--brand-text)}
.strip .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.strip .lbl{font-size:13px;font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strip .msg{font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strip .more{display:inline-flex;align-items:center;gap:4px;padding:0 8px;color:var(--brand-text);font-weight:600;font-size:15px;white-space:nowrap}
.strip.alarm{background:var(--crit-fill);border-color:var(--crit-fill);color:var(--on-crit)}
.strip.alarm .ico{background:transparent;color:var(--on-crit);box-shadow:inset 0 0 0 2px var(--on-crit)}
.strip.alarm .lbl{color:var(--on-crit)}
.strip.alarm .acked{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;padding:0 8px;white-space:nowrap}
.strip.pulse{animation:alarmPulse 1.5s ease-in-out 4}
@keyframes alarmPulse{50%{box-shadow:0 0 0 5px var(--crit-soft);filter:brightness(1.18)}}
.strip.warn .ico{background:var(--warn-soft);color:var(--warn)}
.strip.fault .ico,.strip.unl .ico{background:var(--surface-2);color:var(--text-2)}
.strip.fault{border-style:dashed;border-color:var(--line-strong)}

/* 공통 본문 */
.body{flex:1;min-height:0;padding:12px;display:flex;flex-direction:column;gap:10px}
.scroll{overflow-y:auto;min-height:0;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}

/* 그래프 */
.cnow{display:inline-flex;align-items:baseline;gap:4px;font-size:28px;font-weight:700;margin-left:4px;white-space:nowrap}
.cnow small{font-size:15px;color:var(--text-2);font-weight:600}
.seg{display:inline-flex;gap:6px;flex:none}
.seg button{min-height:48px;min-width:76px;padding:0 14px;border-radius:12px;border:1px solid var(--line-strong);background:transparent;color:var(--text-2);font-weight:600;font-size:16px;white-space:nowrap}
.seg button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.stats{display:flex;align-items:baseline;gap:20px;font-size:14px;color:var(--text-2);white-space:nowrap;min-height:27px}
.stats b{font-size:20px;font-weight:700;color:var(--text);margin-left:6px}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2)}
.lg-band{width:18px;height:12px;border-radius:3px;background:var(--band);box-shadow:inset 0 0 0 1px var(--ok)}
.lg-warn{width:18px;height:0;border-top:2px dashed var(--warn)}
.plot{flex:1;min-height:0;border-radius:14px;border:1px solid var(--line);background:var(--surface);padding:6px}
.plot svg{display:block;width:100%;height:100%}
.plot .empty{height:100%}
.c-band{fill:var(--band)}
.c-grid{stroke:var(--line);stroke-width:1}
.c-lab{fill:var(--text-3);font-size:13px}
.c-warn{stroke:var(--warn);stroke-width:1.5;stroke-dasharray:6 5}
.c-wl{fill:var(--warn);font-size:13px;font-weight:700}
.c-line{fill:none;stroke:var(--brand-text);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.c-dot{fill:var(--brand-text);stroke:var(--surface);stroke-width:3}

/* AI 판단 */
.ai-wrap{flex:1;min-height:0;display:grid;grid-template-columns:1fr 272px;gap:12px}
.finds{display:flex;flex-direction:column;gap:8px;min-height:0}
.find{display:grid;grid-template-columns:40px 1fr auto;column-gap:12px;row-gap:3px;align-items:center;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface);flex:none}
.find .fi{grid-row:span 2;align-self:start;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand-text)}
.find .ft{font-size:17px;font-weight:700;min-width:0;line-height:1.3}
.find .tm{font-size:13px;color:var(--text-3);white-space:nowrap;align-self:start;padding-top:3px}
.find .fw{grid-column:2 / 4;font-size:14px;line-height:1.4;color:var(--text-2)}
.find .fw b{color:var(--text);margin-right:6px}
.find.crit{border-color:var(--crit);box-shadow:inset 0 0 0 1px var(--crit)}
.find.crit .fi{background:var(--crit-fill);color:var(--on-crit)}
.find.warn .fi{background:var(--warn-soft);color:var(--warn)}
.find.ok .fi{background:var(--ok-soft);color:var(--ok)}
.find.fault{border-style:dashed;border-color:var(--line-strong)}
.find.fault .fi{background:var(--surface-2);color:var(--text-2)}
.fmore{font-size:13px;color:var(--text-3);padding-left:4px}
.eng{display:flex;flex-direction:column;padding:4px 14px 12px;border-radius:14px;border:1px solid var(--line);background:var(--surface)}
.eng-row{display:grid;grid-template-columns:28px 1fr auto;column-gap:10px;row-gap:2px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.eng-row .n{grid-row:span 2;align-self:start;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:700;background:var(--brand-soft);color:var(--brand-text)}
.eng-row b{font-size:15px}
.eng-row .c{font-size:15px;font-weight:700;color:var(--brand-text);text-align:right;white-space:nowrap}
.eng-row small{grid-column:2 / 4;font-size:12.5px;color:var(--text-2)}
.eng-note{display:flex;gap:8px;align-items:flex-start;margin-top:10px!important;font-size:13px;color:var(--text-2)}

/* 기기 정보 */
.info{flex:1;min-height:0;display:grid;grid-template-columns:300px 1fr;gap:12px}
.info-l{display:flex;flex-direction:column;gap:12px;min-width:0}
.box{border-radius:14px;border:1px solid var(--line);background:var(--surface);padding:4px 16px;min-width:0}
.dl{margin:0}
.dl div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:15px}
.dl div:last-child{border-bottom:0}
.dl dt{color:var(--text-2);white-space:nowrap}
.dl dd{margin:0;font-weight:600;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.powered{flex:none;text-align:center;font-size:12px;color:var(--text-3);padding-bottom:2px}

/* 설정 타일 */
.tiles{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,1fr);gap:10px}
.tile{display:grid;grid-template-columns:44px 1fr 20px;align-items:center;gap:12px;padding:0 14px;min-height:72px;text-align:left;
  border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--text);min-width:0}
.tile>span{min-width:0}
.tile .ti{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--brand-soft);color:var(--brand-text)}
.tile b{display:block;font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile small{display:block;font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.danger .ti{background:var(--crit-soft);color:var(--crit)}

/* 목록 행 */
.list{display:flex;flex-direction:column;gap:8px}
.list.tight{gap:6px}
.list.tight .row{min-height:54px;padding-top:3px;padding-bottom:3px}
.row{display:flex;align-items:center;gap:12px;min-height:60px;padding:6px 8px 6px 16px;border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--text);text-align:left;flex:none}
.rowbtn{width:100%;min-height:56px;padding-right:16px}
.row.cur{border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)}
.rn{flex:1;min-width:0}
.rn b{display:block;font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rn small{display:block;font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.okt{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--ok);white-space:nowrap}
.toggle{min-height:48px;min-width:108px;display:inline-flex;align-items:center;gap:10px;padding:0 16px 0 8px;border-radius:24px;
  border:1px solid var(--line-strong);background:var(--surface-2);color:var(--text-2);font-weight:700;font-size:15px;white-space:nowrap}
.toggle .knob{width:32px;height:32px;border-radius:50%;background:var(--text-3);flex:none}
.toggle[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.toggle[aria-pressed="true"] .knob{background:var(--on-brand)}
.off{min-width:72px;text-align:right;font-size:20px;font-weight:700;white-space:nowrap}
.btn-ph{display:inline-block;width:88px;flex:none}
.calr{min-width:88px}
.note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--warn-soft);font-size:14px;color:var(--text)}
.note .ic{color:var(--warn)}
.cur-net{display:flex;align-items:center;gap:10px;min-height:52px;padding:0 16px;border-radius:12px;background:var(--surface-2);font-size:15px;flex:none;min-width:0}
.cur-net>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cur-net.warn{background:var(--warn-soft);box-shadow:inset 0 0 0 1px var(--warn)}
.cur-net .st{display:inline-flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap}
.cur-net .st.w{color:var(--warn)}
.bars{display:inline-flex;align-items:flex-end;gap:3px;height:20px;flex:none}
.bars i{display:block;width:5px;border-radius:1.5px;background:var(--line-strong)}
.bars i:nth-child(1){height:6px}.bars i:nth-child(2){height:10px}.bars i:nth-child(3){height:15px}.bars i:nth-child(4){height:20px}
.bars i.on{background:var(--text)}
.empty{flex:1;display:grid;place-items:center;align-content:center;gap:6px;color:var(--text-2);font-size:16px;text-align:center;padding:0 24px}
.empty small{font-size:13px;color:var(--text-3)}

/* 센서 테스트 */
.tgrid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.tcard{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface);min-width:0}
.tcard.fault{border-style:dashed;border-color:var(--line-strong)}
.th{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.th h2{font-size:16px;font-weight:700;min-width:0;line-height:1.25}
.addr{font-size:13px;color:var(--text-3);white-space:nowrap}
.tstat{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:700}
.tstat.good{color:var(--ok)}
.tsub{font-size:13px;color:var(--text-2)}
.tline{display:grid;grid-template-columns:1fr auto;gap:0 8px;padding:7px 0 0;border-top:1px solid var(--line)}
.tline .tn{font-size:14px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tline .tv{font-size:18px;font-weight:700;text-align:right;white-space:nowrap}
.tline .tv small{font-size:13px;color:var(--text-2);font-weight:600;margin-left:3px}
.tline .tr{grid-column:1 / 3;font-size:12px;color:var(--text-3)}
.tline .tr.bad{color:var(--warn);font-weight:600}
.prog{width:240px;height:4px;border-radius:2px;background:var(--surface-2);overflow:hidden}
.prog.sm{width:100%}
.prog i{display:block;width:100%;height:100%;background:var(--brand);transform-origin:left;animation:prog 1.5s linear forwards}
.prog.loop i{animation:progLoop 1.6s ease-in-out infinite}
@keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes progLoop{0%{transform:scaleX(0)}70%{transform:scaleX(1)}100%{transform:scaleX(1);opacity:0}}

/* 언어 */
.langs{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px}
.lang{position:relative;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:0 22px;text-align:left;border-radius:16px;border:1px solid var(--line);background:var(--surface);color:var(--text)}
.lang b{font-size:24px;font-weight:700}
.lang small{font-size:14px;color:var(--text-2)}
.lang[aria-pressed="true"]{border:2px solid var(--brand);background:linear-gradient(var(--brand-soft),var(--brand-soft)),var(--surface)}
.lang .ic{position:absolute;right:18px;top:50%;margin-top:-12px;color:var(--brand-text)}

/* 전력 회로 */
.pwrap{flex:1;min-height:0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.ptable{width:100%;border-collapse:separate;border-spacing:0}
.ptable th,.ptable td{padding:9px 14px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.ptable tr:last-child td{border-bottom:0}
.ptable th:first-child,.ptable td:first-child{text-align:left}
.ptable th{font-size:13px;font-weight:600;color:var(--text-2);position:sticky;top:0;background:var(--surface)}
.ptable td{font-size:17px;font-weight:700}
.ptable td small{display:block;font-size:12px;font-weight:500;color:var(--text-3)}
.ptable tr.tot td{background:var(--surface-2)}
.ptable td.warn{color:var(--warn)} .ptable td.crit{color:var(--crit)}
.ptable td.dim{color:var(--text-3);font-weight:500}
.onoff{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:14px;font-size:13px;font-weight:700;box-shadow:inset 0 0 0 1px var(--line-strong);color:var(--text-2)}
.onoff.on{background:var(--brand-soft);box-shadow:none;color:var(--brand-text)}

/* 기기 연결 */
.pair{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center;padding:0 8px}
.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.steps li{display:grid;grid-template-columns:36px 1fr;gap:12px;align-items:center;font-size:17px}
.steps .n{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:var(--brand-soft);color:var(--brand-text)}
.pnote{display:flex;gap:8px;align-items:flex-start;margin-top:16px!important;font-size:13px;color:var(--text-2)}
.pcode{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.code{display:flex;gap:8px}
.code span{width:52px;height:76px;border-radius:12px;display:grid;place-items:center;font-size:44px;font-weight:700;
  border:2px solid var(--line-strong);background:var(--surface);color:var(--brand-text)}
.code .gap{width:6px;border:0;background:none}
.exp{font-size:15px;color:var(--text-2)}
.perr{font-size:15px;color:var(--warn);font-weight:600;max-width:340px}
.wait{display:inline-flex;align-items:center;gap:6px;font-size:15px;color:var(--text-2)}
.wait i{width:8px;height:8px;border-radius:50%;background:var(--brand-text);animation:blink 1.2s infinite}
.wait i:nth-child(2){animation-delay:.2s}.wait i:nth-child(3){animation-delay:.4s;margin-right:6px}
@keyframes blink{0%,100%{opacity:.25}50%{opacity:1}}

/* Wi‑Fi 비밀번호 */
.pwf{display:flex;align-items:center;gap:10px;min-height:52px;padding:0 6px 0 16px;border-radius:12px;background:var(--surface-2);flex:none}
.pwf .val{flex:1;min-width:0;font-size:20px;font-weight:600;letter-spacing:2px;overflow:hidden;text-overflow:clip;white-space:nowrap}
.pwf .ph{color:var(--text-3);letter-spacing:0;font-weight:500}
.kb{display:flex;flex-direction:column;gap:6px;flex:none}
.kb-row{display:flex;gap:6px}
.kb-row button{flex:1 1 0;min-width:0;height:46px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface);color:var(--text);font-size:19px;font-weight:600}
.kb-row .w{flex:1.7 1 0;font-size:16px}
.kb-row .on{background:var(--brand-soft);color:var(--brand-text)}
.kb-row .go{background:var(--brand);border-color:var(--brand);color:var(--on-brand);font-size:16px}
.mbox{flex:none;padding:8px 12px;border-radius:10px;font-size:14px;font-weight:600;background:var(--surface-2);color:var(--text-2)}
.mbox.err{background:var(--warn-soft);color:var(--warn)}

/* 부팅 */
.boot{align-items:center;justify-content:center;gap:24px}
.boot small{font-size:13px;color:var(--text-3)}

/* 모달 */
.modal{position:absolute;inset:0;z-index:10;display:grid;place-items:center;background:var(--scrim)}
.dialog{width:460px;display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:18px;border:1px solid var(--line-strong);background:var(--surface)}
.dialog h2{font-size:20px;font-weight:700}
.dsub{font-size:14px;color:var(--text-2)}
.dlg-btns{display:flex;justify-content:flex-end;gap:10px}
.kp-disp{height:56px;display:flex;align-items:baseline;justify-content:flex-end;gap:6px;padding:10px 16px 0;border-radius:12px;background:var(--surface-2);font-size:32px;font-weight:700}
.kp-disp .ph{color:var(--text-3)}
.kp-disp small{font-size:15px;color:var(--text-2)}
.kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.kp .btn{min-height:52px;font-size:22px}

/* 토스트 */
.toast{position:absolute;left:50%;bottom:16px;z-index:20;transform:translateX(-50%);max-width:640px;padding:12px 18px;border-radius:12px;background:var(--text);color:var(--bg);font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .wait i{opacity:1}
}
</style>
</head>
<body>
<!-- 아이콘 스프라이트 — 24px 격자, 선 2px, 끝 둥글게. 로고 심볼은 맨 위 하나. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <!-- ★ 임시 AMP 심볼: 둥근 정사각 + 'A'(두 획) + 물결 가로획(수면) + 꼭짓점 점(측정점). 실제 로고 오면 이 symbol 만 교체 -->
  <symbol id="amp-mark" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" style="fill:var(--logo-tile)"/>
    <path d="M7 24 16 8 25 24" style="fill:none;stroke:var(--logo-line);stroke-width:2.75;stroke-linecap:round;stroke-linejoin:round"/>
    <path d="M10.8 18.6q2.6-2.2 5.2 0t5.2 0" style="fill:none;stroke:var(--logo-line);stroke-width:2.4;stroke-linecap:round"/>
    <circle cx="16" cy="8" r="2.6" style="fill:var(--logo-dot)"/>
  </symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8 5.4-5.7"/></symbol>
  <symbol id="i-tick" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 3.6 21.4 20H2.6Z"/><path d="M12 9.8v4.4M12 17.2v.01"/></symbol>
  <symbol id="i-crit" viewBox="0 0 24 24"><path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2Z"/><path d="M12 7.6v5.2M12 16.4v.01"/></symbol>
  <symbol id="i-unplug" viewBox="0 0 24 24"><path d="M9 3v4M15 3v4M6.5 7h11v4a5.5 5.5 0 0 1-11 0ZM12 16.5V21"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-ai" viewBox="0 0 24 24"><path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7Z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/></symbol>
  <symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 19h10.5a4.5 4.5 0 0 0 .4-8.98A6.5 6.5 0 0 0 5.4 11.6 3.8 3.8 0 0 0 7 19Z"/></symbol>
  <symbol id="i-cloudoff" viewBox="0 0 24 24"><path d="M7 19h10.5a4.5 4.5 0 0 0 .4-8.98A6.5 6.5 0 0 0 5.4 11.6 3.8 3.8 0 0 0 7 19Z"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></symbol>
  <symbol id="i-linkoff" viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 6h3M11 6h9M4 12h9M17 12h3M4 18h1M9 18h11"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/></symbol>
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol>
  <symbol id="i-next" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="M3 7l6.5 6.5 4-4L21 17"/><path d="M15 17h6v-6"/></symbol>
  <symbol id="i-up" viewBox="0 0 24 24"><path d="M3 17l6.5-6.5 4 4L21 7"/><path d="M15 7h6v6"/></symbol>
  <symbol id="i-flat" viewBox="0 0 24 24"><path d="M3 12h15"/><path d="M15 8l4 4-4 4"/></symbol>
  <symbol id="i-wifi" viewBox="0 0 24 24"><path d="M2.5 9a13.5 13.5 0 0 1 19 0M5.5 12.5a9 9 0 0 1 13 0M8.6 16a4.6 4.6 0 0 1 6.8 0M12 19.5v.01"/></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9s1.3-6.4 3.9-9Z"/></symbol>
  <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/></symbol>
  <symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12Z"/></symbol>
  <symbol id="i-activity" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></symbol>
  <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/></symbol>
  <symbol id="i-probe" viewBox="0 0 24 24"><path d="M9.5 2.5h5v8l2 3v6a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-6l2-3Z"/><path d="M7.5 16h9"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9Z"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/></symbol>
  <symbol id="i-del" viewBox="0 0 24 24"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7Z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 3.5V8h4.5M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20.5V16h-4.5"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol>
</svg>

<div id="app">
  <div id="view"></div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
</div>

<script>
(function(){
'use strict';

/* ---------- 서버가 새겨 주는 것 ---------- */
var LANG = "__LANG__";
if (!/^(ko|en|vi|id)$/.test(LANG)) LANG = "ko";
var BANDS = __BANDS__;        // limits.py — 화면·운전 권고·서버 알림이 같은 기준
var BRAND = __BRAND__;        // {mark, product, name, support_phone, app_name, pair_url}
var BASE_I18N = __BASE_I18N__; // webui.py 의 I18N — 하단줄·권고·센서 진단 문구를 그대로 쓴다

/* ---------- AMP판 문구 — 없는 키는 BASE_I18N 으로 ---------- */
var I18N = {
  m_temp:{ko:"수온",en:"Water temp",vi:"Nhiệt độ nước",id:"Suhu air"},
  m_ph:{ko:"pH",en:"pH",vi:"pH",id:"pH"},
  m_do:{ko:"용존산소",en:"Dissolved O₂",vi:"Oxy hòa tan",id:"Oksigen terlarut"},
  m_sal:{ko:"염도",en:"Salinity",vi:"Độ mặn",id:"Salinitas"},
  m_ec:{ko:"전도도",en:"Conductivity",vi:"Độ dẫn điện",id:"Konduktivitas"},
  s_ok:{ko:"정상",en:"Normal",vi:"Bình thường",id:"Normal"},
  s_warn:{ko:"주의",en:"Caution",vi:"Chú ý",id:"Waspada"},
  s_crit:{ko:"위험",en:"Danger",vi:"Nguy hiểm",id:"Bahaya"},
  s_fault:{ko:"센서 오류",en:"Sensor fault",vi:"Lỗi cảm biến",id:"Sensor error"},
  s_off:{ko:"꺼짐",en:"Off",vi:"Tắt",id:"Mati"},
  s_wait:{ko:"대기",en:"Waiting",vi:"Chờ",id:"Menunggu"},
  target:{ko:"적정",en:"Target",vi:"Tối ưu",id:"Ideal"},
  atleast:{ko:"{v} 이상",en:"≥ {v}",vi:"≥ {v}",id:"≥ {v}"},
  atmost:{ko:"{v} 이하",en:"≤ {v}",vi:"≤ {v}",id:"≤ {v}"},
  no_band:{ko:"판정 기준 없음 — 값만 표시",en:"No target range — value only",vi:"Không có ngưỡng — chỉ hiển thị",id:"Tanpa rentang — nilai saja"},
  per1h:{ko:"1시간",en:"1 h",vi:"1 giờ",id:"1 jam"},
  open_chart:{ko:"그래프 열기",en:"Open chart",vi:"Mở biểu đồ",id:"Buka grafik"},
  e_electrode:{ko:"전극 확인 필요",en:"Check electrode",vi:"Kiểm tra điện cực",id:"Periksa elektroda"},
  e_electrode_sub:{ko:"센서는 응답하지만 값을 내지 못합니다",en:"Sensor answers but gives no reading",vi:"Cảm biến phản hồi nhưng không có giá trị",id:"Sensor merespons tetapi tanpa nilai"},
  e_noresp:{ko:"센서 응답 없음",en:"Sensor not responding",vi:"Cảm biến không phản hồi",id:"Sensor tidak merespons"},
  e_noresp_sub:{ko:"설정 › 센서 테스트",en:"Settings › Sensor test",vi:"Cài đặt › Kiểm tra cảm biến",id:"Pengaturan › Tes sensor"},
  e_off:{ko:"센서 꺼짐",en:"Sensor off",vi:"Cảm biến đang tắt",id:"Sensor mati"},
  e_off_sub:{ko:"설정 › 센서 설정에서 켜기",en:"Turn on in Settings › Sensors",vi:"Bật trong Cài đặt › Cảm biến",id:"Nyalakan di Pengaturan › Sensor"},
  e_wait:{ko:"측정 대기",en:"Waiting",vi:"Đang chờ",id:"Menunggu"},
  e_wait_sub:{ko:"첫 측정을 기다리는 중",en:"Waiting for the first reading",vi:"Chờ lần đo đầu tiên",id:"Menunggu pembacaan pertama"},
  e_noval:{ko:"값 없음",en:"No reading",vi:"Không có giá trị",id:"Tanpa nilai"},
  ai_adv:{ko:"권고 {n}",en:"{n} advice",vi:"{n} gợi ý",id:"{n} saran"},
  ai_alarm:{ko:"경보 {n}",en:"{n} alarm",vi:"{n} cảnh báo",id:"{n} alarm"},
  ai_anom:{ko:"이상징후 {n}",en:"{n} anomaly",vi:"{n} bất thường",id:"{n} anomali"},
  ai_hold:{ko:"일부 보류",en:"Partly paused",vi:"Dừng 1 phần",id:"Sebagian ditunda"},
  ai_ok:{ko:"이상 없음",en:"All clear",vi:"Ổn định",id:"Aman"},
  ai_off_s:{ko:"꺼짐",en:"Off",vi:"Tắt",id:"Mati"},
  net_ok:{ko:"동기화 {t}",en:"Synced {t}",vi:"Đồng bộ {t}",id:"Sinkron {t}"},
  net_fail:{ko:"전송 실패 · 보관 {n}건",en:"Offline · {n} queued",vi:"Gửi lỗi · lưu {n}",id:"Gagal · {n} antre"},
  net_unl:{ko:"미연결 · 보관 {n}건",en:"Unlinked · {n} queued",vi:"Chưa liên kết · lưu {n}",id:"Belum tertaut · {n}"},
  nav_info:{ko:"정보",en:"Info",vi:"Thông tin",id:"Info"},
  nav_set:{ko:"설정",en:"Settings",vi:"Cài đặt",id:"Setelan"},
  adv_label:{ko:"AI 권고",en:"AI advice",vi:"Khuyến nghị AI",id:"Saran AI"},
  anom_label:{ko:"AI 이상징후",en:"AI anomaly",vi:"Bất thường AI",id:"Anomali AI"},
  ai_label:{ko:"AI",en:"AI",vi:"AI",id:"AI"},
  adv_more:{ko:"근거 보기",en:"Why?",vi:"Lý do",id:"Alasan"},
  strip_ok:{ko:"모든 항목 적정 범위 · 추세 이상 없음",en:"All readings in range · no trend issues",vi:"Mọi chỉ số trong ngưỡng · xu hướng ổn",id:"Semua nilai dalam rentang · tren normal"},
  alarm_below:{ko:"위험 · {m} {v} — 기준 {lim} 미만",en:"Danger · {m} {v} — below {lim}",vi:"Nguy hiểm · {m} {v} — dưới {lim}",id:"Bahaya · {m} {v} — di bawah {lim}"},
  alarm_above:{ko:"위험 · {m} {v} — 기준 {lim} 초과",en:"Danger · {m} {v} — above {lim}",vi:"Nguy hiểm · {m} {v} — trên {lim}",id:"Bahaya · {m} {v} — di atas {lim}"},
  alarm_more:{ko:" 외 {n}",en:" +{n} more",vi:" +{n}",id:" +{n}"},
  alarm_check:{ko:"지금 수조를 확인하세요",en:"Check the tank now",vi:"Kiểm tra ao ngay",id:"Periksa kolam sekarang"},
  alarm_ack:{ko:"확인",en:"Acknowledge",vi:"Xác nhận",id:"Konfirmasi"},
  alarm_acked:{ko:"확인됨 · 해소될 때까지 유지",en:"Acknowledged · stays until cleared",vi:"Đã xác nhận · giữ đến khi hết",id:"Dikonfirmasi · tetap hingga pulih"},
  unl_title:{ko:"계정에 연결되지 않은 장비입니다",en:"This device is not linked to an account",vi:"Thiết bị chưa liên kết tài khoản",id:"Perangkat belum terhubung ke akun"},
  unl_sub:{ko:"측정과 보관은 계속됩니다",en:"Measuring and storing continue",vi:"Vẫn đo và lưu dữ liệu",id:"Pengukuran & penyimpanan tetap berjalan"},
  unl_btn:{ko:"기기 연결",en:"Link device",vi:"Liên kết",id:"Hubungkan"},
  fault_strip:{ko:"센서 {n}개 확인 필요 — 해당 항목은 판단을 보류합니다",en:"{n} sensor(s) need attention — not assessed",vi:"{n} cảm biến cần kiểm tra — tạm không đánh giá",id:"{n} sensor perlu dicek — penilaian ditunda"},
  back:{ko:"뒤로",en:"Back",vi:"Quay lại",id:"Kembali"},
  period:{ko:"기간",en:"Period",vi:"Khoảng thời gian",id:"Periode"},
  r24:{ko:"24시간",en:"24 h",vi:"24 giờ",id:"24 jam"},
  r7d:{ko:"7일",en:"7 days",vi:"7 ngày",id:"7 hari"},
  st_min:{ko:"최저",en:"Min",vi:"Thấp nhất",id:"Min"},
  st_avg:{ko:"평균",en:"Avg",vi:"Trung bình",id:"Rata-rata"},
  st_max:{ko:"최고",en:"Max",vi:"Cao nhất",id:"Maks"},
  band:{ko:"적정 범위",en:"Target range",vi:"Khoảng tối ưu",id:"Rentang ideal"},
  warnline:{ko:"주의 경계",en:"Caution limit",vi:"Ngưỡng chú ý",id:"Batas waspada"},
  loading:{ko:"불러오는 중…",en:"Loading…",vi:"Đang tải…",id:"Memuat…"},
  chart_aria:{ko:"{m} {r} 그래프. 최저 {min}, 평균 {avg}, 최고 {max}.",en:"{m} {r} chart. Min {min}, avg {avg}, max {max}.",vi:"Biểu đồ {m} {r}. Thấp nhất {min}, trung bình {avg}, cao nhất {max}.",id:"Grafik {m} {r}. Min {min}, rata-rata {avg}, maks {max}."},
  ai_title:{ko:"AI 판단",en:"AI assessment",vi:"Đánh giá AI",id:"Penilaian AI"},
  last_run:{ko:"마지막 분석 {t} · {m}분마다",en:"Last run {t} · every {m} min",vi:"Lần chạy cuối {t} · mỗi {m} phút",id:"Terakhir {t} · tiap {m} menit"},
  not_run:{ko:"추세 분석 전",en:"Trend pass not run yet",vi:"Chưa phân tích xu hướng",id:"Analisis tren belum berjalan"},
  why:{ko:"근거",en:"Why",vi:"Lý do",id:"Alasan"},
  k_anom:{ko:"추세 이상징후",en:"Trend anomaly",vi:"Xu hướng bất thường",id:"Anomali tren"},
  k_adv:{ko:"운전 권고",en:"Advice",vi:"Khuyến nghị",id:"Saran"},
  k_limit:{ko:"기준 이탈",en:"Limit breach",vi:"Vượt ngưỡng",id:"Lewat batas"},
  k_sensor:{ko:"센서",en:"Sensor",vi:"Cảm biến",id:"Sensor"},
  k_stable:{ko:"안정",en:"Stable",vi:"Ổn định",id:"Stabil"},
  an_surge:{ko:"{m} 급변",en:"{m} sudden change",vi:"{m} thay đổi đột ngột",id:"{m} berubah mendadak"},
  an_drift_down:{ko:"{m} 하락 추세",en:"{m} falling trend",vi:"{m} giảm dần",id:"Tren {m} menurun"},
  an_drift_up:{ko:"{m} 상승 추세",en:"{m} rising trend",vi:"{m} tăng dần",id:"Tren {m} naik"},
  an_dev:{ko:"{m} 평소 범위 이탈",en:"{m} outside its usual range",vi:"{m} ngoài mức thường",id:"{m} di luar kisaran biasa"},
  aw_surge:{ko:"{a} → {b} · {n}분 전부터",en:"{a} → {b} · since {n} min ago",vi:"{a} → {b} · từ {n} phút trước",id:"{a} → {b} · sejak {n} menit lalu"},
  aw_days_down:{ko:"{n}일 연속 하루 최저값 하락 · {a} → {b}",en:"Daily low falling {n} days in a row · {a} → {b}",vi:"Mức thấp nhất ngày giảm {n} ngày liền · {a} → {b}",id:"Titik terendah harian turun {n} hari · {a} → {b}"},
  aw_days_up:{ko:"{n}일 연속 하루 최고값 상승 · {a} → {b}",en:"Daily high rising {n} days in a row · {a} → {b}",vi:"Mức cao nhất ngày tăng {n} ngày liền · {a} → {b}",id:"Titik tertinggi harian naik {n} hari · {a} → {b}"},
  aw_span:{ko:"{n}시간 동안 {a} → {b}",en:"{a} → {b} over {n} h",vi:"{a} → {b} trong {n} giờ",id:"{a} → {b} dalam {n} jam"},
  aw_dev:{ko:"평소 평균 {a} → 지금 {b}",en:"Usual average {a} → now {b}",vi:"Trung bình thường {a} → hiện {b}",id:"Rata-rata biasa {a} → kini {b}"},
  aw_now:{ko:"지금 {v}",en:"Now {v}",vi:"Hiện {v}",id:"Kini {v}"},
  aw_now_range:{ko:"지금 {v} — 적정 {r}",en:"Now {v} — target {r}",vi:"Hiện {v} — tối ưu {r}",id:"Kini {v} — ideal {r}"},
  aw_surplus:{ko:"지금 {v} — 최근 1시간 내내 산소 과잉",en:"Now {v} — oxygen surplus for the past hour",vi:"Hiện {v} — dư oxy suốt 1 giờ qua",id:"Kini {v} — oksigen berlebih 1 jam terakhir"},
  f_hold:{ko:"{m} 판단 보류",en:"{m} not assessed",vi:"Tạm dừng đánh giá {m}",id:"Penilaian {m} ditunda"},
  f_all_ok:{ko:"모든 항목 안정",en:"All readings stable",vi:"Mọi chỉ số ổn định",id:"Semua nilai stabil"},
  w_all_ok:{ko:"{n}개 항목 모두 적정 범위 · 추세 이상 없음",en:"All {n} readings in range · no trend issues",vi:"Cả {n} chỉ số trong ngưỡng · xu hướng ổn",id:"{n} nilai dalam rentang · tren normal"},
  f_more:{ko:"외 {n}건 더",en:"+{n} more",vi:"+{n} nữa",id:"+{n} lagi"},
  f_none:{ko:"아직 판단할 측정값이 없습니다",en:"No readings to assess yet",vi:"Chưa có số liệu để đánh giá",id:"Belum ada nilai untuk dinilai"},
  e1_t:{ko:"기준 이탈 판정",en:"Limit check",vi:"Kiểm tra ngưỡng",id:"Cek batas"},
  e1_d:{ko:"매 측정마다 적정 범위와 비교",en:"Every reading vs the target range",vi:"So mỗi lần đo với khoảng tối ưu",id:"Tiap pengukuran vs rentang ideal"},
  e2_t:{ko:"추세 이상탐지",en:"Trend anomaly detection",vi:"Phát hiện bất thường",id:"Deteksi anomali tren"},
  e2_d:{ko:"최근 {h}시간 · {n}개 점 기준",en:"Last {h} h · {n} points",vi:"{h} giờ gần nhất · {n} điểm",id:"{h} jam terakhir · {n} titik"},
  e2_d0:{ko:"측정 이력을 쌓는 중",en:"Building up history",vi:"Đang tích lũy dữ liệu",id:"Mengumpulkan riwayat"},
  e3_t:{ko:"설비 운전 권고",en:"Equipment advice",vi:"Khuyến nghị vận hành",id:"Saran operasi"},
  e3_d:{ko:"판정을 '지금 무엇을 돌릴까'로",en:"Turns findings into what to run now",vi:"Chuyển nhận định thành việc cần làm",id:"Mengubah temuan jadi tindakan"},
  cnt_none:{ko:"없음",en:"None",vi:"Không",id:"Tidak ada"},
  cnt:{ko:"{n}건",en:"{n}",vi:"{n}",id:"{n}"},
  cnt_off:{ko:"꺼짐",en:"Off",vi:"Tắt",id:"Mati"},
  ai_offline:{ko:"인터넷 없이 장비 안에서 계산합니다",en:"Computed on the device — no internet needed",vi:"Tính ngay trên thiết bị — không cần Internet",id:"Dihitung di perangkat — tanpa internet"},
  ai_advice_only:{ko:"권고만 합니다 — 설비를 직접 켜고 끄지 않습니다",en:"Advice only — it never switches equipment",vi:"Chỉ khuyến nghị — không tự bật/tắt thiết bị",id:"Hanya saran — tidak menyalakan/mematikan peralatan"},
  info_title:{ko:"기기 정보",en:"Device info",vi:"Thông tin thiết bị",id:"Info perangkat"},
  i_account:{ko:"연결 계정",en:"Account",vi:"Tài khoản",id:"Akun"},
  i_farm:{ko:"양식장",en:"Farm",vi:"Trại nuôi",id:"Tambak"},
  i_tank:{ko:"수조",en:"Tank",vi:"Ao",id:"Kolam"},
  i_model:{ko:"제품",en:"Product",vi:"Sản phẩm",id:"Produk"},
  i_serial:{ko:"일련번호",en:"Serial",vi:"Số sê-ri",id:"Nomor seri"},
  i_ver:{ko:"소프트웨어",en:"Software",vi:"Phần mềm",id:"Perangkat lunak"},
  i_net:{ko:"네트워크",en:"Network",vi:"Mạng",id:"Jaringan"},
  i_sync:{ko:"서버 전송",en:"Upload",vi:"Gửi dữ liệu",id:"Unggah"},
  i_updated:{ko:"마지막 측정",en:"Last reading",vi:"Lần đo cuối",id:"Pembacaan terakhir"},
  i_support:{ko:"고객센터",en:"Support",vi:"Hỗ trợ",id:"Dukungan"},
  change_acct:{ko:"계정 변경",en:"Change account",vi:"Đổi tài khoản",id:"Ganti akun"},
  not_linked:{ko:"연결 안 됨",en:"Not linked",vi:"Chưa liên kết",id:"Belum terhubung"},
  no_wifi:{ko:"Wi‑Fi 연결 없음",en:"No Wi‑Fi",vi:"Không có Wi‑Fi",id:"Tanpa Wi‑Fi"},
  set_title:{ko:"설정",en:"Settings",vi:"Cài đặt",id:"Pengaturan"},
  set_sensors:{ko:"센서 설정",en:"Sensors",vi:"Cảm biến",id:"Sensor"},
  set_sensors_s:{ko:"켜기·끄기, 측정 주기, 염도/전도도",en:"On/off, interval, salinity/EC",vi:"Bật/tắt, chu kỳ, độ mặn/EC",id:"Aktif/mati, interval, salinitas/EC"},
  set_test:{ko:"센서 테스트",en:"Sensor test",vi:"Kiểm tra cảm biến",id:"Tes sensor"},
  set_test_s:{ko:"통신·값 확인",en:"Check link and readings",vi:"Kiểm tra kết nối và giá trị",id:"Cek koneksi dan nilai"},
  set_cal:{ko:"보정",en:"Calibration",vi:"Hiệu chuẩn",id:"Kalibrasi"},
  set_cal_s:{ko:"휴대용 측정기 값에 맞추기",en:"Match a handheld meter",vi:"Khớp với máy đo cầm tay",id:"Samakan dengan alat genggam"},
  set_wifi:{ko:"Wi‑Fi",en:"Wi‑Fi",vi:"Wi‑Fi",id:"Wi‑Fi"},
  set_wifi_s:{ko:"공유기에 연결",en:"Connect to a router",vi:"Kết nối bộ phát",id:"Sambung ke router"},
  set_lang:{ko:"언어",en:"Language",vi:"Ngôn ngữ",id:"Bahasa"},
  set_power:{ko:"전력 회로",en:"Power circuits",vi:"Mạch điện",id:"Sirkuit daya"},
  set_power_s:{ko:"산소공급기·펌프 전력",en:"Aerator and pump power",vi:"Công suất sục khí, bơm",id:"Daya aerator dan pompa"},
  set_pair:{ko:"기기 연결",en:"Link device",vi:"Liên kết thiết bị",id:"Hubungkan perangkat"},
  set_pair_s:{ko:"6자리 코드로 계정에 연결",en:"Link to an account with a 6-digit code",vi:"Liên kết tài khoản bằng mã 6 số",id:"Tautkan akun dengan kode 6 digit"},
  set_restart:{ko:"재시작",en:"Restart",vi:"Khởi động lại",id:"Mulai ulang"},
  set_restart_s:{ko:"프로그램 다시 시작 · 기기 재부팅",en:"Restart program · reboot device",vi:"Chạy lại chương trình · khởi động lại",id:"Mulai ulang program · reboot"},
  th_dark:{ko:"다크",en:"Dark",vi:"Tối",id:"Gelap"},
  th_light:{ko:"라이트",en:"Light",vi:"Sáng",id:"Terang"},
  sn_ph:{ko:"pH · ORP",en:"pH · ORP",vi:"pH · ORP",id:"pH · ORP"},
  sn_ec:{ko:"전도도 · 염도",en:"Conductivity · Salinity",vi:"Độ dẫn · Độ mặn",id:"Konduktivitas · Salinitas"},
  addr:{ko:"주소 {n}",en:"Address {n}",vi:"Địa chỉ {n}",id:"Alamat {n}"},
  interval:{ko:"측정 주기",en:"Reading interval",vi:"Chu kỳ đo",id:"Interval baca"},
  interval_s:{ko:"짧을수록 그래프가 촘촘합니다",en:"Shorter means a denser chart",vi:"Ngắn hơn, biểu đồ dày hơn",id:"Lebih pendek, grafik lebih rapat"},
  mins:{ko:"{n}분",en:"{n} min",vi:"{n} phút",id:"{n} mnt"},
  secs:{ko:"{n}초",en:"{n} s",vi:"{n} giây",id:"{n} dtk"},
  show4:{ko:"네 번째 칸",en:"Fourth tile",vi:"Ô thứ tư",id:"Kotak keempat"},
  show4_s:{ko:"염도 또는 전도도로 측정·표시",en:"Measure salinity or conductivity",vi:"Đo độ mặn hoặc độ dẫn",id:"Ukur salinitas atau konduktivitas"},
  ec_unit:{ko:"전도도 단위",en:"Conductivity unit",vi:"Đơn vị độ dẫn",id:"Satuan konduktivitas"},
  on:{ko:"켜짐",en:"On",vi:"Bật",id:"Nyala"},
  off:{ko:"꺼짐",en:"Off",vi:"Tắt",id:"Mati"},
  saved:{ko:"저장했습니다",en:"Saved",vi:"Đã lưu",id:"Tersimpan"},
  retest:{ko:"다시 테스트",en:"Run again",vi:"Chạy lại",id:"Uji lagi"},
  testing:{ko:"테스트 중…",en:"Testing…",vi:"Đang kiểm tra…",id:"Menguji…"},
  comm_ok:{ko:"통신 정상",en:"Link OK",vi:"Kết nối tốt",id:"Koneksi OK"},
  comm_fail:{ko:"응답 없음",en:"No response",vi:"Không phản hồi",id:"Tidak merespons"},
  comm_fail_s:{ko:"배선·전원·주소를 확인하세요",en:"Check wiring, power and address",vi:"Kiểm tra dây, nguồn và địa chỉ",id:"Cek kabel, daya, dan alamat"},
  not_tested:{ko:"결과 없음",en:"No result",vi:"Không có kết quả",id:"Tanpa hasil"},
  raw:{ko:"원시값",en:"Raw",vi:"Thô",id:"Mentah"},
  f_sat:{ko:"포화도",en:"Saturation",vi:"Độ bão hòa",id:"Saturasi"},
  cal_sensor:{ko:"센서값",en:"Sensor",vi:"Cảm biến",id:"Sensor"},
  cal_after:{ko:"보정 후",en:"after",vi:"sau hiệu chuẩn",id:"setelah"},
  cal_enter:{ko:"실측값 입력",en:"Enter reading",vi:"Nhập giá trị đo",id:"Masukkan nilai"},
  cal_reset:{ko:"해제",en:"Reset",vi:"Bỏ",id:"Reset"},
  cal_note:{ko:"1점 보정입니다 — 입력한 지점 근처에서만 정확합니다. 차이가 크면 보정으로 덮지 말고 전극부터 점검하세요.",en:"Single-point offset — accurate only near that point. If the gap is large, service the electrode instead of covering it with an offset.",vi:"Hiệu chuẩn 1 điểm — chỉ chính xác gần điểm đó. Nếu lệch nhiều, hãy bảo dưỡng điện cực thay vì bù.",id:"Kalibrasi 1 titik — akurat hanya di sekitar titik itu. Jika selisih besar, rawat elektroda, jangan ditutup dengan offset."},
  cal_kp_t:{ko:"{m} 실측값 입력",en:"Enter {m} reading",vi:"Nhập giá trị đo {m}",id:"Masukkan nilai {m}"},
  cal_kp_hint:{ko:"휴대용 측정기로 잰 값을 입력하세요",en:"Enter the value from your handheld meter",vi:"Nhập giá trị đo bằng máy cầm tay",id:"Masukkan nilai dari alat ukur genggam"},
  apply:{ko:"적용",en:"Apply",vi:"Áp dụng",id:"Terapkan"},
  cancel:{ko:"취소",en:"Cancel",vi:"Hủy",id:"Batal"},
  del:{ko:"지우기",en:"Delete",vi:"Xóa",id:"Hapus"},
  wifi_now:{ko:"연결됨",en:"Connected",vi:"Đã kết nối",id:"Terhubung"},
  wifi_upfail:{ko:"서버 전송 실패",en:"Upload failing",vi:"Gửi dữ liệu lỗi",id:"Unggah gagal"},
  rescan:{ko:"다시 검색",en:"Scan again",vi:"Quét lại",id:"Pindai ulang"},
  scanning:{ko:"검색 중…",en:"Scanning…",vi:"Đang quét…",id:"Memindai…"},
  secured:{ko:"잠금",en:"Secured",vi:"Có mật khẩu",id:"Terkunci"},
  signal:{ko:"신호 {n}/4",en:"Signal {n}/4",vi:"Tín hiệu {n}/4",id:"Sinyal {n}/4"},
  col_circuit:{ko:"회로",en:"Circuit",vi:"Mạch",id:"Sirkuit"},
  col_state:{ko:"상태",en:"State",vi:"Trạng thái",id:"Status"},
  col_w:{ko:"전력 W",en:"Power W",vi:"Công suất W",id:"Daya W"},
  col_a:{ko:"전류 A",en:"Current A",vi:"Dòng A",id:"Arus A"},
  col_kwh:{ko:"오늘 kWh",en:"Today kWh",vi:"Hôm nay kWh",id:"Hari ini kWh"},
  col_tc:{ko:"단자 ℃",en:"Terminal °C",vi:"Đầu cực °C",id:"Terminal °C"},
  pw_none_amp:{ko:"연결된 계측기 없음",en:"No power meter connected",vi:"Chưa kết nối đồng hồ điện",id:"Tidak ada meter daya terhubung"},
  pw_none_hint:{ko:"전력 계측 차단기·전력계를 달면 여기에 회로별 전력이 나옵니다",en:"Fit metering breakers or power meters to see each circuit here",vi:"Lắp aptomat/đồng hồ đo điện để xem từng mạch tại đây",id:"Pasang pemutus/meter daya untuk melihat tiap sirkuit di sini"},
  rs_title:{ko:"장비를 다시 시작할까요?",en:"Restart the device?",vi:"Khởi động lại thiết bị?",id:"Mulai ulang perangkat?"},
  pair_title:{ko:"기기 연결",en:"Link this device",vi:"Liên kết thiết bị",id:"Hubungkan perangkat"},
  pair_s1_app:{ko:"휴대폰에서 {app} 앱을 열고 로그인",en:"Open the {app} app on your phone and sign in",vi:"Mở ứng dụng {app} trên điện thoại và đăng nhập",id:"Buka aplikasi {app} di ponsel dan masuk"},
  pair_s1_url:{ko:"{url} 에 접속해 로그인",en:"Go to {url} and sign in",vi:"Truy cập {url} và đăng nhập",id:"Buka {url} lalu masuk"},
  pair_s2:{ko:"양식장 › 수조 선택",en:"Choose farm › tank",vi:"Chọn trại › ao",id:"Pilih tambak › kolam"},
  pair_s3:{ko:"기기 추가 › 코드로 연결",en:"Add device › Link with code",vi:"Thêm thiết bị › Liên kết bằng mã",id:"Tambah perangkat › Hubungkan dengan kode"},
  pair_s4:{ko:"오른쪽 6자리 코드 입력",en:"Enter the 6-digit code shown here",vi:"Nhập mã 6 số bên cạnh",id:"Masukkan kode 6 digit di samping"},
  pair_web:{ko:"웹: {url}",en:"Web: {url}",vi:"Web: {url}",id:"Web: {url}"},
  pair_code:{ko:"연결 코드",en:"Link code",vi:"Mã liên kết",id:"Kode tautan"},
  pair_wait:{ko:"앱 입력을 기다리는 중",en:"Waiting for the app",vi:"Đang chờ ứng dụng",id:"Menunggu aplikasi"},
  pair_note:{ko:"연결 전 측정값도 보관했다가 함께 올립니다",en:"Readings taken before linking are kept and uploaded too",vi:"Dữ liệu đo trước khi liên kết cũng được lưu và tải lên",id:"Data sebelum terhubung disimpan lalu ikut diunggah"},
  pair_linked:{ko:"이미 계정에 연결된 장비입니다",en:"This device is already linked",vi:"Thiết bị đã được liên kết",id:"Perangkat sudah terhubung"},
  boot_msg:{ko:"센서 확인 중…",en:"Checking sensors…",vi:"Đang kiểm tra cảm biến…",id:"Memeriksa sensor…"}
};

function t(k, vars){
  var e = I18N[k] || BASE_I18N[k];
  var s = e ? (e[LANG] || e.en || e.ko) : k;
  if (vars) for (var x in vars) s = s.split("{" + x + "}").join(String(vars[x]));
  return s;
}

/* ---------- 도우미 ---------- */
var LOC = {ko:"ko-KR", en:"en-US", vi:"vi-VN", id:"id-ID"}, NF = {};
function fmt(v, d){
  var key = LANG + d;
  if (!NF[key]) NF[key] = new Intl.NumberFormat(LOC[LANG], {minimumFractionDigits:d, maximumFractionDigits:d});
  return NF[key].format(v);
}
function fmtSigned(v, d){ var r = Number(v.toFixed(d)); return (r > 0 ? "+" : r < 0 ? "\u2212" : "\u00B1") + fmt(Math.abs(r), d); }
function decSep(){ return fmt(1.5, 1).charAt(1); }
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }
function ic(id, cls){ return '<svg class="ic' + (cls ? " " + cls : "") + '" aria-hidden="true" focusable="false"><use href="#i-' + id + '"/></svg>'; }
function pad2(n){ return (n < 10 ? "0" : "") + n; }
function hhmm(d){ return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function dlabel(d){ var m = d.getMonth() + 1, day = d.getDate(); return (LANG === "ko" || LANG === "en") ? m + "/" + day : day + "/" + m; }
function wm(cls){
  return '<span class="wm' + (cls ? " " + cls : "") + '" role="img" aria-label="' + esc(BRAND.name) + '">' +
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 32 32"><use href="#amp-mark"/></svg>' +
    '<span class="wm-amp" aria-hidden="true">' + esc(BRAND.mark) + '</span><span class="wm-prod" aria-hidden="true">' + esc(BRAND.product) + '</span></span>';
}
function api(path, body){
  var opt = body === undefined ? {cache:"no-store"}
          : {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)};
  return fetch(path, opt).then(function(r){ return r.json(); });
}

/* ---------- 측정 항목 ---------- */
var MET = {
  temperature:{label:"m_temp", unit:"\u00B0C", d:1, rd:0, sensors:["ph","do","ec"]},
  ph:{label:"m_ph", unit:"", d:2, rd:1, sensors:["ph"]},
  do_level:{label:"m_do", unit:"mg/L", d:1, rd:1, sensors:["do"]},
  salinity:{label:"m_sal", unit:"\u2030", d:1, rd:0, sensors:["ec"]},
  conductivity:{label:"m_ec", unit:"\u00B5S/cm", d:0, rd:0, sensors:["ec"]},
  turbidity:{label:"turbidity", unit:"NTU", d:1, rd:0, sensors:[]}
};
var LV = {ok:{ic:"check", k:"s_ok"}, warn:{ic:"warn", k:"s_warn"}, crit:{ic:"crit", k:"s_crit"}, fault:{ic:"unplug", k:"s_fault"}};
function ecMs(){ return !!(S.d && S.d.ec_unit === "ms"); }
function unitOf(k){ return k === "conductivity" ? (ecMs() ? "mS/cm" : "\u00B5S/cm") : (MET[k] ? MET[k].unit : ""); }
function digOf(k){ return k === "conductivity" ? (ecMs() ? 2 : 0) : (MET[k] ? MET[k].d : 2); }
function shown(k, v){ return (k === "conductivity" && ecMs()) ? v / 1000 : v; }
function valTxt(k, v, d){ var u = unitOf(k); return fmt(shown(k, v), d === undefined ? digOf(k) : d) + (u ? " " + u : ""); }
function mlabel(k){ return MET[k] ? t(MET[k].label) : k; }
function level(k, v){
  var b = BANDS[k]; if (!b || typeof v !== "number") return "";
  function inside(p){ return !((p[0] !== null && v < p[0]) || (p[1] !== null && v > p[1])); }
  if (inside(b.ok)) return "ok";
  return inside(b.warn) ? "warn" : "crit";
}
function rangeTxt(k){
  var b = BANDS[k]; if (!b) return "";
  var o = b.ok, d = MET[k] ? MET[k].rd : 1;
  if (o[1] === null) return t("atleast", {v:fmt(o[0], d)});
  if (o[0] === null) return t("atmost", {v:fmt(o[1], d)});
  return fmt(o[0], d) + "\u2013" + fmt(o[1], d);
}
function pill(lv){ var x = LV[lv]; return x ? '<span class="pill ' + lv + '">' + ic(x.ic, "s") + t(x.k) + '</span>' : ""; }
function vals(){ return (S.d && S.d.values) || {}; }
function num(k){ var v = vals()[k]; return typeof v === "number" ? v : null; }
function fourthKey(){
  var v = vals();
  if (S.ecMode === "conductivity") return "conductivity";
  if (S.ecMode === "salinity") return "salinity";
  return typeof v.salinity === "number" ? "salinity" : typeof v.conductivity === "number" ? "conductivity" : "salinity";
}
function cardKeys(){ return ["temperature", "ph", "do_level", fourthKey()]; }
function owner(k){ return k === "ph" ? "ph" : k === "do_level" ? "do" : (k === "salinity" || k === "conductivity") ? "ec" : null; }

/* 값 칸의 고장 — 꺼 둔 것 / 첫 측정 전 / 전극 / 응답 없음 / 범위 밖 / 값 없음. 값이 있으면 null */
function faultOf(k){
  var d = S.d || {}, on = d.sensors_on, need = MET[k].sensors;
  if (on && !need.some(function(s){ return on.indexOf(s) >= 0; })) return {kind:"off"};
  if (num(k) !== null) return null;
  if (!d.updated_at) return {kind:"wait"};
  var errs = d.errors || {}, who = owner(k);
  var why = who ? errs[who] : (k === "temperature" ? (errs.do || errs.ph || errs.ec) : null);
  if (why === "probe") return {kind:"electrode"};
  if (why && String(why).indexOf("range:") === 0) return {kind:"range", detail:String(why).slice(6)};
  if (why) return {kind:"noresp"};
  return {kind:"noval"};
}
function faultText(f){
  if (f.kind === "range") return {b:t("sen_range"), s:f.detail};
  if (f.kind === "noval") return {b:t("e_noval"), s:t("e_noresp_sub")};
  return {b:t("e_" + f.kind), s:t("e_" + f.kind + "_sub")};
}
/* 값은 나왔지만 믿기 어려운 경우(전극이 물 밖 등) — webui.py 의 진단 문구를 쓴다 */
function suspectOf(k){
  var who = owner(k), w = who && S.d && S.d.errors ? S.d.errors[who] : null;
  if (!w || num(k) === null) return null;
  w = String(w);
  if (w.indexOf("temp_off:") === 0) return t("sen_temp_off");
  if (w.indexOf("do_air:") === 0) return t("sen_do_air");
  if (w.indexOf("do_scale:") === 0) return t("sen_do_scale");
  if (w.indexOf("supersat:") === 0) return t("sen_supersat");
  return null;
}
/* 판단을 보류해야 하는 칸(꺼 둔 것·첫 측정 전 제외) */
function faultCards(){
  return cardKeys().filter(function(k){ var f = faultOf(k); return f && f.kind !== "off" && f.kind !== "wait"; });
}
function critCards(){
  return cardKeys().filter(function(k){ return level(k, num(k)) === "crit"; });
}

/* ---------- 상태 ---------- */
var S = {
  screen:"boot", prev:{}, d:null, ver:null, ecMode:null, sens:null,
  theme:"dark", chartKey:"do_level", range:"24h", chart:null,
  trend:{}, trendAt:0, modal:null, focusModal:false, kp:{key:null, buf:""},
  test:null, cal:null, wifi:null, wstat:null, wsel:null, wpw:"", wshow:false, wshift:false, wlayer:"abc", wmsg:null, wbusy:false,
  ackSig:"", alarmSeen:{}, noResp:0, bootAt:Date.now(), restart:null, wasPairing:false, wasLinked:null
};
try { var th = localStorage.getItem("amp-theme"); if (th === "light" || th === "dark") S.theme = th; } catch(e){}
document.documentElement.setAttribute("data-theme", S.theme);

function statusText(d){
  var c = d.status_code, a = d.status_args || {};
  if (!c || !BASE_I18N["st_" + c]) return d.status || "";
  var key = (c === "sent" && a.sent) ? "st_sent_more" : "st_" + c;
  return t(key, {at: a.at || "", sent: a.sent || 0});
}
function aiState(){
  var d = S.d || {}, ai = d.ai || {}, crit = critCards().length;
  if (crit) return {cls:"alarm", ic:"crit", txt:t("ai_alarm", {n:crit})};
  if (!ai.enabled) return {cls:"hold", ic:"ai", txt:t("ai_off_s")};
  if (faultCards().length) return {cls:"hold", ic:"ai", txt:t("ai_hold")};
  var n = (d.advice || []).length; if (n) return {cls:"", ic:"ai", txt:t("ai_adv", {n:n})};
  var a = (d.anomalies || []).length; if (a) return {cls:"", ic:"ai", txt:t("ai_anom", {n:a})};
  return {cls:"", ic:"ai", txt:t("ai_ok")};
}
function netState(){
  if (S.noResp >= 2) return {cls:"fail", ic:"cloudoff", txt:t("no_collector")};
  var d = S.d || {}, c = d.status_code, a = d.status_args || {}, n = d.pending || 0;
  if (!d.linked) return {cls:"", ic:"linkoff", txt:n ? t("net_unl", {n:n}) : t("not_linked")};
  if (c === "send_fail") return {cls:"fail", ic:"cloudoff", txt:n ? t("net_fail", {n:n}) : t("st_send_fail")};
  if (c === "sent") return {cls:"", ic:"cloud", txt:t("net_ok", {t:a.at || ""})};
  return {cls:"", ic:"cloud", txt:statusText(d) || t("st_checking")};
}

/* ======================= 화면들 ======================= */
function subBar(title, right, backKey){
  return '<header class="bar"><button class="btn ghost back" data-a="back" data-fid="back">' + ic("back") + '<span>' + t(backKey || "back") + '</span></button>' +
    '<h1 tabindex="-1">' + title + '</h1><span class="sp"></span>' + (right || "") + '</header>';
}

function vBoot(){
  var msg = S.restart ? t(S.restart === "dev" ? "rebooting" : "restarting") : t("boot_msg");
  var ver = S.d && S.d.version ? " · v" + esc(S.d.version) : "";
  return '<div class="scr boot">' + wm("lg") +
    '<div class="prog' + (S.restart ? " loop" : "") + '" role="progressbar" aria-label="' + esc(msg) + '"><i></i></div>' +
    '<small>' + msg + ver + '</small></div>';
}

function vMain(){
  var d = S.d || {}, ai = aiState(), net = netState();
  var where = d.linked ? ([d.farm, d.tank].filter(Boolean).join(" \u00B7 ") || d.account || t("connected")) : t("not_linked");
  var bar = '<header class="bar">' +
    '<div class="who">' + wm() + '<span class="site">' + esc(where) + '</span></div>' +
    '<span class="sp"></span>' +
    '<button class="chip ai ' + ai.cls + '" data-a="go" data-arg="ai" data-fid="ai">' + ic(ai.ic, "s") + '<span class="lbl">AI <b>' + ai.txt + '</b></span></button>' +
    '<button class="chip net ' + net.cls + '" data-a="go" data-arg="info" data-fid="net">' + ic(net.ic, "s") + '<span class="lbl">' + esc(net.txt) + '</span></button>' +
    '<button class="btn ghost" data-a="go" data-arg="info" data-fid="info" aria-label="' + t("nav_info") + '" title="' + t("nav_info") + '">' + ic("info") + '</button>' +
    '<button class="btn ghost" data-a="go" data-arg="settings" data-fid="set">' + ic("sliders") + '<span>' + t("nav_set") + '</span></button>' +
    '</header>';
  return '<div class="scr">' + bar + '<div class="grid">' + cardKeys().map(card).join("") + '</div>' + strip() + '</div>';
}

function card(k){
  var v = num(k), f = faultOf(k), lv = f ? "fault" : level(k, v), label = mlabel(k), body, foot, unit = unitOf(k);
  if (f){
    var ft = faultText(f);
    body = '<span class="card-v"><span class="num">\u2014 \u2014</span><span class="unit">' + unit + '</span></span>';
    foot = '<span class="card-err"><b>' + ic(f.kind === "off" ? "power" : "unplug", "s") + ft.b + '</b><small>' + esc(ft.s) + '</small></span>';
  } else {
    body = '<span class="card-v"><span class="num">' + fmt(shown(k, v), digOf(k)) + '</span><span class="unit">' + unit + '</span></span>';
    var sus = suspectOf(k);
    if (sus) {
      foot = '<span class="card-f note">' + ic("warn", "s") + '<span>' + sus + '</span></span>';
    } else {
      var tr = trendOf(k), rt = rangeTxt(k);
      foot = '<span class="card-f"><span>' + (rt ? t("target") + " " + rt : t("no_band")) + '</span>' +
        (tr === null ? "" : '<span class="tr">' + ic(tr.dir, "s") + t("per1h") + " " + fmtSigned(shown(k, tr.delta), digOf(k)) + '</span>') + '</span>';
    }
  }
  var aria = label + " " + (f ? faultText(f).b : fmt(shown(k, v), digOf(k)) + " " + unit) + (LV[lv] ? ", " + t(LV[lv].k) : "") + ". " + t("open_chart");
  return '<button class="card ' + lv + '" data-a="chart" data-arg="' + k + '" data-fid="c-' + k + '" aria-label="' + esc(aria) + '">' +
    '<span class="card-top"><span class="card-k">' + label + '</span>' + (f ? pill("fault") : pill(lv)) + '</span>' + body + foot + '</button>';
}

/* 1시간 변화 — 장비 이력(/api/history)의 최근 1시간 첫 값과 지금 값의 차. 이력이 모자라면 숨긴다 */
function trendOf(k){
  var r = S.trend[k], v = num(k);
  if (!r || v === null) return null;
  var dd = v - r.ref, step = Math.pow(10, -digOf(k)) / 2;
  return {delta:dd, dir: dd < -step ? "down" : dd > step ? "up" : "flat"};
}
function calcTrend(h){
  var pts = (h && h.points) || [], now = Date.now() / 1000;
  if (pts.length < 2) return null;
  if (now - pts[pts.length - 1][0] > 900) return null;          // 최근 15분 안에 값이 없다
  for (var i = 0; i < pts.length; i++){
    if (pts[i][0] >= now - 3600){
      return pts[i][0] <= now - 2700 ? {ref:pts[i][1]} : null;   // 1시간 중 45분 이상을 덮어야 한다
    }
  }
  return null;
}
function needTrends(){ return Date.now() - S.trendAt > 60000 || cardKeys().some(function(k){ return !(k in S.trend); }); }
function loadTrends(){
  if (!S.d || !S.d.updated_at) return;
  S.trendAt = Date.now();
  cardKeys().forEach(function(k){
    api("/api/history?key=" + k + "&hours=6").then(function(h){
      S.trend[k] = calcTrend(h);
      if (S.screen === "main") render(true);
    }).catch(function(){ S.trend[k] = null; });   // 실패해도 다음 주기(1분)까지 다시 묻지 않는다
  });
}

function advText(a){ return t("adv_" + a.code); }
function strip(){
  var d = S.d || {}, cl = critCards();
  if (cl.length){
    var k = cl[0], v = num(k), b = BANDS[k].warn, below = b[0] !== null && v < b[0];
    var lim = below ? b[0] : b[1], sig = cl.join(",");
    if (!S.alarmSeen[sig]) S.alarmSeen[sig] = Date.now();
    var acked = S.ackSig === sig, pulse = !acked && (Date.now() - S.alarmSeen[sig] < 6000);
    var top = (d.advice || []).filter(function(a){ return a.level === "danger"; })[0];
    var lbl = t(below ? "alarm_below" : "alarm_above", {m:mlabel(k), v:valTxt(k, v), lim:fmt(shown(k, lim), MET[k].rd)}) +
              (cl.length > 1 ? t("alarm_more", {n:cl.length - 1}) : "");
    return '<div class="strip alarm' + (pulse ? " pulse" : "") + '"' + (pulse ? ' role="alert"' : "") + '>' +
      '<span class="ico">' + ic("crit", "l") + '</span>' +
      '<span class="txt"><span class="lbl">' + esc(lbl) + '</span><span class="msg">' + (top ? advText(top) : t("alarm_check")) + '</span></span>' +
      (acked ? '<span class="acked">' + ic("tick", "s") + t("alarm_acked") + '</span>'
             : '<button class="btn on-crit" data-a="ack" data-arg="' + sig + '" data-fid="ack">' + ic("bell") + t("alarm_ack") + '</button>') +
      '</div>';
  }
  var fl = faultCards();
  if (fl.length){
    return '<button class="strip fault" data-a="go" data-arg="test" data-fid="strip"><span class="ico">' + ic("unplug", "l") + '</span>' +
      '<span class="txt"><span class="lbl">' + fl.map(mlabel).join(" \u00B7 ") + '</span><span class="msg">' + t("fault_strip", {n:fl.length}) + '</span></span>' +
      '<span class="more">' + t("set_test") + ic("next", "s") + '</span></button>';
  }
  // 미연결 안내는 '즉시' 권고 다음 — 연결 전에는 휴대폰 알림이 가지 않으므로 주의 권고보다 앞에 둔다.
  var adv = d.advice || [];
  if (S.d && !d.linked && !(adv.length && adv[0].level === "danger")){
    return '<div class="strip unl"><span class="ico">' + ic("linkoff", "l") + '</span>' +
      '<span class="txt"><span class="msg">' + t("unl_title") + '</span><span class="lbl">' + t("unl_sub") + '</span></span>' +
      '<button class="btn primary" data-a="go" data-arg="pair" data-fid="pairbtn">' + ic("link") + t("unl_btn") + '</button></div>';
  }
  if (adv.length){
    return '<button class="strip' + (adv[0].level === "danger" || adv[0].level === "warn" ? " warn" : "") + '" data-a="go" data-arg="ai" data-fid="strip"><span class="ico">' + ic("ai", "l") + '</span>' +
      '<span class="txt"><span class="lbl">' + t("adv_label") + '</span><span class="msg">' + advText(adv[0]) + '</span></span>' +
      '<span class="more">' + t("adv_more") + ic("next", "s") + '</span></button>';
  }
  var an = d.anomalies || [];
  var msg = an.length ? anTitle(an[0]) : (d.updated_at ? t("strip_ok") : t("boot_msg"));
  return '<button class="strip" data-a="go" data-arg="ai" data-fid="strip"><span class="ico">' + ic("ai", "l") + '</span>' +
    '<span class="txt"><span class="lbl">' + t(an.length ? "anom_label" : "ai_label") + '</span><span class="msg">' + msg + '</span></span>' +
    '<span class="more">' + t("adv_more") + ic("next", "s") + '</span></button>';
}

/* ---------- 그래프 — 장비 이력(/api/history) ---------- */
function loadChart(){
  var k = S.chartKey, h = S.range === "7d" ? 168 : 24;
  S.chart = {key:k, hours:h, data:null};
  api("/api/history?key=" + k + "&hours=" + h).then(function(d){
    if (S.chart && S.chart.key === k && S.chart.hours === h){ S.chart.data = d; if (S.screen === "chart") render(); }
  }).catch(function(){
    if (S.chart && S.chart.key === k && S.chart.hours === h){ S.chart.data = {points:[], count:0}; if (S.screen === "chart") render(); }
  });
}
function nice(x){ var e = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function decOf(step){ return Math.max(0, -Math.floor(Math.log(step) / Math.LN10 + 1e-9)); }

function chartSvg(k, data){
  var W = 762, H = 348, L = 56, R = 14, T = 12, B = 30, b = BANDS[k], dg = digOf(k);
  var pts = data.points.map(function(p){ return [p[0], shown(k, p[1])]; });
  var lo = shown(k, data.min), hi = shown(k, data.max), minSpan = Math.pow(10, -dg) * 6;
  if (hi - lo < minSpan){ var c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  var span = hi - lo, bounds = b ? [b.ok[0], b.ok[1], b.warn[0], b.warn[1]] : [];
  bounds.forEach(function(x){ if (x !== null && x >= lo - 1.5 * span && x <= hi + 1.5 * span){ lo = Math.min(lo, x); hi = Math.max(hi, x); } });
  var padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
  var pw = W - L - R, ph = H - T - B, t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
  function X(ts){ return L + (ts - t0) * pw / (t1 - t0); }
  function Y(v){ return T + (hi - v) * ph / (hi - lo); }
  var s = "";
  if (b){
    var bl = b.ok[0] === null ? lo : Math.max(lo, b.ok[0]), bh = b.ok[1] === null ? hi : Math.min(hi, b.ok[1]);
    if (bh > bl) s += '<rect class="c-band" x="' + L + '" y="' + Y(bh).toFixed(1) + '" width="' + pw + '" height="' + (Y(bl) - Y(bh)).toFixed(1) + '"/>';
  }
  var step = nice((hi - lo) / 4), sd = decOf(step), g = 0;
  for (var yv = Math.ceil(lo / step) * step; yv <= hi + 1e-9 && g < 12; yv += step, g++){
    var yy = Y(yv).toFixed(1);
    s += '<line class="c-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>' +
         '<text class="c-lab" x="' + (L - 8) + '" y="' + (Y(yv) + 4).toFixed(1) + '" text-anchor="end">' + fmt(yv, sd) + '</text>';
  }
  if (b) [b.warn[0], b.warn[1]].forEach(function(x){
    if (x !== null && x > lo && x < hi){
      var wy = Y(x).toFixed(1);
      s += '<line class="c-warn" x1="' + L + '" x2="' + (W - R) + '" y1="' + wy + '" y2="' + wy + '"/>' +
           '<text class="c-wl" x="' + (W - R - 4) + '" y="' + (Y(x) - 6).toFixed(1) + '" text-anchor="end">' + fmt(x, MET[k].rd) + '</text>';
    }
  });
  // 칸 사이가 크게 비면(센서 오류·전원 꺼짐) 선을 끊는다 — 없던 값을 이어 그리지 않는다.
  var gap = data.hours * 3600 / 160 * 2.5, path = "", prev = null;
  pts.forEach(function(p){
    path += (prev !== null && p[0] - prev <= gap ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1);
    prev = p[0];
  });
  s += '<path class="c-line" d="' + path + '"/>';
  var last = pts[pts.length - 1];
  s += '<circle class="c-dot" cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="5"/>';
  var labs = [t0, (t0 + t1) / 2, t1].map(function(ts){ var dt = new Date(ts * 1000); return data.hours > 24 ? dlabel(dt) : hhmm(dt); });
  s += '<text class="c-lab" x="' + L + '" y="' + (H - 8) + '" text-anchor="start">' + labs[0] + '</text>' +
       '<text class="c-lab" x="' + (L + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + labs[1] + '</text>' +
       '<text class="c-lab" x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end">' + labs[2] + '</text>';
  var aria = t("chart_aria", {m:mlabel(k), r:t(data.hours > 24 ? "r7d" : "r24"), min:fmt(shown(k, data.min), dg), avg:fmt(shown(k, data.avg), dg), max:fmt(shown(k, data.max), dg)});
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(aria) + '">' + s + '</svg>';
}

function vChart(){
  var k = S.chartKey, v = num(k), f = faultOf(k), lv = f ? "fault" : level(k, v), ch = S.chart, dg = digOf(k);
  function seg(r, key){ return '<button data-a="range" data-arg="' + r + '" data-fid="r-' + r + '" aria-pressed="' + (S.range === r) + '">' + t(key) + '</button>'; }
  var data = ch && ch.key === k ? ch.data : null, stats = "", plot;
  if (!data) plot = '<p class="empty">' + t("loading") + '</p>';
  else if (!data.count || !data.points.length) plot = '<p class="empty">' + t("no_data") + '</p>';
  else {
    stats = '<span>' + t("st_min") + '<b>' + fmt(shown(k, data.min), dg) + '</b></span><span>' + t("st_avg") + '<b>' + fmt(shown(k, data.avg), dg) + '</b></span><span>' + t("st_max") + '<b>' + fmt(shown(k, data.max), dg) + '</b></span>';
    plot = chartSvg(k, {points:data.points, min:data.min, max:data.max, avg:data.avg, hours:ch.hours});
  }
  var legend = BANDS[k] ? '<span class="lg"><i class="lg-band"></i>' + t("band") + " " + rangeTxt(k) + '</span><span class="lg"><i class="lg-warn"></i>' + t("warnline") + '</span>' : "";
  return '<div class="scr">' +
    '<header class="bar"><button class="btn ghost back" data-a="back" data-fid="back">' + ic("back") + '<span>' + t("back") + '</span></button>' +
      '<h1 tabindex="-1">' + mlabel(k) + '</h1>' +
      '<span class="cnow">' + (v === null ? "\u2014 \u2014" : fmt(shown(k, v), dg)) + '<small>' + unitOf(k) + '</small></span>' + pill(lv) +
      '<span class="sp"></span>' +
      '<span class="seg" role="group" aria-label="' + t("period") + '">' + seg("24h", "r24") + seg("7d", "r7d") + '</span>' +
    '</header>' +
    '<div class="body"><div class="stats">' + stats + '<span class="sp"></span>' + legend + '</div>' +
      '<div class="plot">' + plot + '</div></div></div>';
}

/* ---------- AI 판단 — 수집기가 준 값·advice·anomalies·errors 로만 만든다 ---------- */
function upTime(){ var u = S.d && S.d.updated_at; return u ? String(u).slice(11, 16) : ""; }
function anTitle(a){
  var m = mlabel(a.parameter);
  if (a.kind === "surge") return t("an_surge", {m:m});
  if (a.kind === "drift") return t(a.direction === "up" ? "an_drift_up" : "an_drift_down", {m:m});
  return t("an_dev", {m:m});
}
function anWhy(a){
  var k = a.parameter, dg = typeof a.digits === "number" ? a.digits : 2;
  var A = valTxt(k, a.reference, k === "conductivity" && ecMs() ? 2 : dg), Bv = valTxt(k, a.value, k === "conductivity" && ecMs() ? 2 : dg);
  if (typeof a.reference !== "number" || typeof a.value !== "number") return "";
  if (a.kind === "surge") return t("aw_surge", {a:A, b:Bv, n:a.gap_minutes || 1});
  if (a.kind === "drift" && a.days) return t(a.direction === "up" ? "aw_days_up" : "aw_days_down", {n:a.days, a:A, b:Bv});
  if (a.kind === "drift" && a.span_hours) return t("aw_span", {n:a.span_hours, a:A, b:Bv});
  if (a.kind === "deviation") return t("aw_dev", {a:A, b:Bv});
  return "";
}
var ADV_FIELD = {do:"do_level", ph:"ph", temp:"temperature", salinity:"salinity", turbidity:"turbidity"};
var ADV_TREND = {do_falling:1, ph_shift:1, temp_swing:1, salinity_shift:1, turbidity_up:1};
function advWhy(a){
  var k = ADV_FIELD[String(a.code).split("_")[0]];
  if (!k) return "";
  if (ADV_TREND[a.code]){
    var an = ((S.d && S.d.anomalies) || []).filter(function(x){ return x.parameter === k; })[0];
    if (an) return anWhy(an);
  }
  if (typeof a.value !== "number") return "";
  var vt = valTxt(k, a.value, typeof a.digits === "number" ? a.digits : undefined);
  if (a.code === "do_surplus") return t("aw_surplus", {v:vt});
  return BANDS[k] ? t("aw_now_range", {v:vt, r:rangeTxt(k)}) : t("aw_now", {v:vt});
}
function findings(){
  var d = S.d || {}, ai = d.ai || {}, out = [], tm = upTime();
  cardKeys().forEach(function(k){
    var v = num(k), lv = level(k, v);
    if (lv === "warn" || lv === "crit")
      out.push({o: lv === "crit" ? 0 : 2, lv:lv, ic:lv, k:"k_limit", t:mlabel(k) + " " + t(LV[lv].k), w:t("aw_now_range", {v:valTxt(k, v), r:rangeTxt(k)}), tm:tm});
  });
  (d.advice || []).forEach(function(a){
    var lv = a.level === "danger" ? "crit" : a.level === "warn" ? "warn" : "ok";
    out.push({o: lv === "crit" ? 0 : lv === "warn" ? 2 : 4, lv:lv, ic:"ai", k:"k_adv", t:advText(a), w:advWhy(a), tm:tm});
  });
  (d.anomalies || []).forEach(function(a){
    out.push({o: a.type === "danger" ? 1 : 3, lv: a.type === "danger" ? "crit" : "", ic: a.direction === "up" ? "up" : "down", k:"k_anom", t:anTitle(a), w:anWhy(a), tm:ai.at || ""});
  });
  faultCards().forEach(function(k){
    var ft = faultText(faultOf(k));
    out.push({o:1, lv:"fault", ic:"unplug", k:"k_sensor", t:t("f_hold", {m:mlabel(k)}), w:ft.b + " \u2014 " + ft.s, tm:tm});
  });
  out.sort(function(a, b){ return a.o - b.o; });
  if (!out.length && d.updated_at){
    var n = cardKeys().filter(function(k){ return num(k) !== null; }).length;
    if (n) out.push({lv:"ok", ic:"check", k:"k_stable", t:t("f_all_ok"), w:t("w_all_ok", {n:n}), tm:tm});
  }
  return out;
}
function vAI(){
  var d = S.d || {}, ai = d.ai || {}, on = !!ai.enabled, list = findings(), MAX = 4;
  function cnt(n){ return n ? t("cnt", {n:n}) : t("cnt_none"); }
  var finds = list.slice(0, MAX).map(function(f){
    return '<div class="find ' + f.lv + '"><span class="fi">' + ic(f.ic) + '</span><span class="ft">' + f.t + '</span>' +
      '<span class="tm">' + t(f.k) + (f.tm ? " \u00B7 " + esc(f.tm) : "") + '</span>' +
      (f.w ? '<span class="fw"><b>' + t("why") + '</b>' + esc(f.w) + '</span>' : "") + '</div>';
  }).join("") || '<p class="empty">' + t("f_none") + '</p>';
  if (list.length > MAX) finds += '<p class="fmore">' + t("f_more", {n:list.length - MAX}) + '</p>';
  var limitN = cardKeys().filter(function(k){ var l = level(k, num(k)); return l === "warn" || l === "crit"; }).length;
  var e2d = on ? (ai.samples ? t("e2_d", {h:ai.window_h || 96, n:fmt(ai.samples, 0)}) : t("e2_d0")) : t("e2_d0");
  var rows = [
    ["e1_t", t("e1_d"), cnt(limitN)],
    ["e2_t", e2d, on ? cnt((d.anomalies || []).length) : t("cnt_off")],
    ["e3_t", t("e3_d"), on ? cnt((d.advice || []).length) : t("cnt_off")]
  ].map(function(e, i){
    return '<div class="eng-row"><span class="n">' + (i + 1) + '</span><b>' + t(e[0]) + '</b><span class="c">' + e[2] + '</span><small>' + e[1] + '</small></div>';
  }).join("");
  var meta = on && ai.at ? t("last_run", {t:esc(ai.at), m:Math.round((ai.interval_s || 300) / 60)}) : t("not_run");
  return '<div class="scr">' + subBar(t("ai_title"), '<span class="meta">' + meta + '</span>') +
    '<div class="body"><div class="ai-wrap"><div class="finds scroll">' + finds + '</div>' +
    '<aside class="eng">' + rows +
      (on ? '<p class="eng-note">' + ic("cloudoff", "s") + '<span>' + t("ai_offline") + '</span></p>'
          : '<p class="eng-note">' + ic("info", "s") + '<span>' + t("ai_offd") + '</span></p>') +
      '<p class="eng-note">' + ic("info", "s") + '<span>' + t("ai_advice_only") + '</span></p>' +
    '</aside></div></div></div>';
}

/* ---------- 기기 정보 ---------- */
function dl(rows){ return '<dl class="dl">' + rows.map(function(r){ return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join("") + '</dl>'; }
function loadWifiStatus(){
  api("/api/wifi").then(function(w){ S.wstat = w; if (S.screen === "info" || S.screen === "wifi") render(true); }).catch(function(){});
}
function vInfo(){
  var d = S.d || {}, lk = !!d.linked, w = S.wstat;
  var acct = lk ? [[t("i_account"), d.account ? esc(d.account) : "\u2014"]] : [[t("i_account"), t("not_linked")]];
  if (lk && d.farm) acct.push([t("i_farm"), esc(d.farm)]);
  if (lk && d.tank) acct.push([t("i_tank"), esc(d.tank)]);
  var net = w && w.connected ? esc(w.ssid || "") + (w.ip ? " \u00B7 " + esc(w.ip) : "") : (w ? t("no_wifi") : "\u2014");
  var dev = [
    [t("i_model"), esc(BRAND.name)],
    [t("i_serial"), d.serial ? esc(d.serial) : "\u2014"],
    [t("i_ver"), d.version ? "v" + esc(d.version) : "\u2014"],
    [t("i_net"), net],
    [t("i_sync"), esc(netState().txt)],
    [t("i_updated"), d.updated_at ? esc(d.updated_at) : "\u2014"]
  ];
  if (BRAND.support_phone) dev.push([t("i_support"), esc(BRAND.support_phone)]);
  var btn = lk ? '<button class="btn" data-a="unlinkAsk" data-fid="acct">' + ic("link") + t("change_acct") + '</button>'
               : '<button class="btn primary" data-a="go" data-arg="pair" data-fid="acct">' + ic("link") + t("unl_btn") + '</button>';
  return '<div class="scr">' + subBar(t("info_title")) +
    '<div class="body"><div class="info">' +
      '<div class="info-l"><div style="padding:6px 2px 2px">' + wm("md") + '</div><div class="box">' + dl(acct) + '</div>' + btn + '</div>' +
      '<div class="box">' + dl(dev) + '</div>' +
    '</div><p class="powered">Powered by Shrimp365</p></div></div>';
}

/* ---------- 설정 ---------- */
var LANGS = [["ko", "한국어", "Korean"], ["en", "English", "English"], ["vi", "Tiếng Việt", "Vietnamese"], ["id", "Bahasa Indonesia", "Indonesian"]];
function langName(c){ for (var i = 0; i < LANGS.length; i++){ if (LANGS[i][0] === c) return LANGS[i][1]; } return c; }
var TILES = [
  ["sensors", "probe", "set_sensors", "set_sensors_s"], ["test", "activity", "set_test", "set_test_s"],
  ["cal", "target", "set_cal", "set_cal_s"], ["wifi", "wifi", "set_wifi", "set_wifi_s"],
  ["lang", "globe", "set_lang", null], ["power", "zap", "set_power", "set_power_s"],
  ["pair", "link", "set_pair", "set_pair_s"], ["restart", "power", "set_restart", "set_restart_s"]
];
function segGroup(name, opts, label){
  return '<span class="seg" role="group"' + (label ? ' aria-label="' + esc(label) + '"' : "") + '>' + opts.map(function(o){
    return '<button data-a="' + name + '" data-arg="' + o[0] + '" data-fid="' + name + '-' + o[0] + '" aria-pressed="' + o[2] + '">' + o[1] + '</button>';
  }).join("") + '</span>';
}
function vSettings(){
  var tiles = TILES.map(function(x){
    var act = x[0] === "restart" ? 'data-a="modal" data-arg="restart"' : 'data-a="go" data-arg="' + x[0] + '"';
    var sub = x[0] === "lang" ? langName(LANG) : t(x[3]);
    return '<button class="tile' + (x[0] === "restart" ? " danger" : "") + '" ' + act + ' data-fid="t-' + x[0] + '">' +
      '<span class="ti">' + ic(x[1]) + '</span><span><b>' + t(x[2]) + '</b><small>' + sub + '</small></span>' + ic("next", "s dim") + '</button>';
  }).join("");
  var theme = segGroup("theme", [["dark", t("th_dark"), S.theme === "dark"], ["light", t("th_light"), S.theme === "light"]]);
  var ver = S.d && S.d.version ? '<span class="meta">v' + esc(S.d.version) + '</span>' : "";
  return '<div class="scr">' + subBar(t("set_title"), ver + theme) +
    '<div class="body"><div class="tiles">' + tiles + '</div></div></div>';
}

/* 센서 설정 — /api/sensors 로 읽고, 바꿀 때마다 /api/sensors/save 로 바로 저장 */
var SENS = [["ph", "sn_ph"], ["do", "m_do"], ["ec", "sn_ec"]];
function sensOf(key){ var l = (S.sens && S.sens.sensors) || []; for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i]; return null; }
function loadSensors(then){
  api("/api/sensors").then(function(d){ S.sens = d; S.ecMode = d.ec_mode || S.ecMode; if (then) then(); if (S.screen === "sensors" || S.screen === "test") render(); })
    .catch(function(){ toast(t("load_fail")); });
}
function saveSensors(){
  var s = S.sens; if (!s) return;
  var payload = {interval:s.interval, ec_mode:s.ec_mode, ec_unit:s.ec_unit};
  (s.sensors || []).forEach(function(sn){ payload[sn.key] = {enabled:sn.enabled, slave_id:sn.slave_id}; });
  api("/api/sensors/save", payload).then(function(r){
    if (r && r.ok){ S.ecMode = s.ec_mode; toast(r.saved ? t("saved_ok") : t("saved_mem")); }
    else { toast((r && r.error) || t("save_fail")); loadSensors(); }
    render();
  }).catch(function(){ toast(t("save_fail")); loadSensors(); });
  render();
}
function vSensors(){
  var s = S.sens;
  if (!s) return '<div class="scr">' + subBar(t("set_sensors")) + '<div class="body"><p class="empty">' + t("loading") + '</p></div></div>';
  var rows = SENS.map(function(x){
    var sn = sensOf(x[0]); if (!sn) return "";
    var subs = {ph:"pH, ORP, " + t("m_temp"), do:"DO, " + t("f_sat") + ", " + t("m_temp"), ec:"EC, " + t("m_sal") + ", " + t("m_temp")};
    return '<div class="row"><div class="rn"><b>' + t(x[1]) + '</b><small>' + t("addr", {n:sn.slave_id}) + " \u00B7 " + subs[x[0]] + '</small></div>' +
      '<button class="toggle" data-a="sensToggle" data-arg="' + x[0] + '" data-fid="tg-' + x[0] + '" aria-pressed="' + !!sn.enabled + '"><span class="knob"></span>' + t(sn.enabled ? "on" : "off") + '</button></div>';
  }).join("");
  var opts = [60, 120, 300, 600]; if (opts.indexOf(s.interval) < 0) opts.push(s.interval); opts.sort(function(a, b){ return a - b; });
  var iv = segGroup("sensInterval", opts.map(function(n){ return [n, n % 60 ? t("secs", {n:n}) : t("mins", {n:n / 60}), s.interval === n]; }), t("interval"));
  var s4 = segGroup("sensFourth", [["salinity", t("m_sal") + " \u2030", s.ec_mode !== "conductivity"], ["conductivity", t("m_ec"), s.ec_mode === "conductivity"]], t("show4"));
  var unit = s.ec_mode === "conductivity"
    ? '<div class="row"><div class="rn"><b>' + t("ec_unit") + '</b></div>' + segGroup("sensUnit", [["us", "\u00B5S/cm", s.ec_unit !== "ms"], ["ms", "mS/cm", s.ec_unit === "ms"]], t("ec_unit")) + '</div>' : "";
  return '<div class="scr">' + subBar(t("set_sensors"), s.port ? '<span class="meta">' + esc(s.port) + '</span>' : "") +
    '<div class="body"><div class="list tight">' + rows +
      '<div class="row"><div class="rn"><b>' + t("interval") + '</b><small>' + t("interval_s") + '</small></div>' + iv + '</div>' +
      '<div class="row"><div class="rn"><b>' + t("show4") + '</b><small>' + t("show4_s") + '</small></div>' + s4 + '</div>' + unit +
    '</div></div></div>';
}

/* 센서 테스트 — /api/sensors/test 가 센서를 실제로 한 번 읽는다(몇 초) */
var FIELD_LBL = {ph:"pH", orp:"ORP", temperature:"m_temp", do_level:"m_do", do_saturation:"f_sat", conductivity:"m_ec", tds:"TDS"};
var FIELD_DG = {ph:2, orp:0, temperature:1, do_level:2, do_saturation:0, conductivity:0};
function runTest(){
  S.test = "run"; render();
  api("/api/sensors/test", {}).then(function(r){ S.test = (r && r.result) || []; if (S.screen === "test") render(); })
    .catch(function(){ S.test = []; toast(t("test_fail")); if (S.screen === "test") render(); });
}
function verdict(f){
  if (f.verdict === "ok") return {bad:false, txt:t("v_ok")};
  if (f.verdict === "probe") return {bad:true, txt:t("v_probe")};
  if (f.verdict === "range") return {bad:true, txt:t("v_range")};
  if (f.verdict === "supersat") return {bad:true, txt:t("v_supersat").replace("{{p}}", String(f.saturation))};
  return {bad:true, txt:t("v_undecodable")};
}
function vTest(){
  var res = Array.isArray(S.test) ? S.test : [], running = S.test === "run";
  var serialErr = res.filter(function(r){ return r.key === "_"; })[0];
  var cards = SENS.map(function(x){
    var key = x[0], sn = sensOf(key), r = res.filter(function(e){ return e.key === key; })[0];
    var head = '<div class="th"><h2>' + t(x[1]) + '</h2><span class="addr">' + (sn ? t("addr", {n:sn.slave_id}) : "") + '</span></div>', body, bad = false;
    if (running){
      body = '<p class="tstat">' + t("testing") + '</p><div class="prog sm loop"><i></i></div>';
    } else if (sn && !sn.enabled){
      bad = true; body = '<p class="tstat">' + ic("power", "s") + t("off") + '</p><p class="tsub">' + t("e_off_sub") + '</p>';
    } else if (!r){
      body = '<p class="tsub">' + (serialErr ? esc(serialErr.error || "") : t("not_tested")) + '</p>';
    } else if (!r.ok){
      bad = true; body = '<p class="tstat">' + ic("unplug", "s") + t("comm_fail") + '</p><p class="tsub">' + t("comm_fail_s") + '</p>';
    } else {
      body = '<p class="tstat good">' + ic("check", "s") + t("comm_ok") + '</p>' + (r.fields || []).map(function(f){
        var vd = verdict(f), u = f.unit || "", v = f.value, dg = FIELD_DG[f.name];
        if (dg === undefined) dg = typeof v === "number" && Math.abs(v) < 100 ? 1 : 0;
        if (vd.bad) bad = true;
        if (f.verdict === "probe" || f.verdict === "undecodable") v = null;   // 전극이 못 낸 값(0x7FFF 등)은 숫자로 보이지 않는다
        if (u === "C") u = "\u00B0C"; else if (u === "pH") u = "";
        if (f.name === "conductivity" && u === "uS/cm"){ if (ecMs() && typeof v === "number"){ v = v / 1000; dg = 2; u = "mS/cm"; } else u = "\u00B5S/cm"; }
        var lbl = FIELD_LBL[f.name] ? (FIELD_LBL[f.name].indexOf("_") > 0 || FIELD_LBL[f.name].indexOf("m_") === 0 ? t(FIELD_LBL[f.name]) : FIELD_LBL[f.name]) : esc(f.name);
        return '<div class="tline"><span class="tn">' + lbl + '</span><span class="tv">' + (typeof v === "number" ? fmt(v, dg) : "\u2014 \u2014") + '<small>' + esc(u) + '</small></span>' +
          '<span class="tr' + (vd.bad ? " bad" : "") + '">' + vd.txt + " \u00B7 " + t("raw") + " " + (f.raw === null || f.raw === undefined ? "-" : esc(f.raw)) + '</span></div>';
      }).join("");
    }
    return '<div class="tcard' + (bad ? " fault" : "") + '">' + head + body + '</div>';
  }).join("");
  return '<div class="scr">' + subBar(t("set_test"), '<button class="btn" data-a="runtest" data-fid="runtest"' + (running ? " disabled" : "") + '>' + ic("refresh") + t("retest") + '</button>') +
    '<div class="body"><div class="tgrid">' + cards + '</div></div></div>';
}

/* 보정 — /api/calibration · 실측값을 넣으면 장비가 오프셋을 구한다 */
var CALS = ["temperature", "ph", "do_level", "conductivity"];
function calDiv(k){ return (k === "conductivity" && ecMs()) ? 1000 : 1; }
function calDg(k){ return k === "conductivity" ? (ecMs() ? 2 : 0) : k === "temperature" ? 1 : 2; }
function loadCal(){
  api("/api/calibration").then(function(d){ S.cal = d; if (S.screen === "cal") render(); }).catch(function(){ toast(t("load_fail")); });
}
function calSend(payload){
  api("/api/calibration/save", payload).then(function(r){
    toast(r && r.ok ? t("cal_saved") : ((r && r.error) || t("save_fail"))); loadCal();
  }).catch(function(){ toast(t("save_fail")); });
}
function vCal(){
  var c = S.cal;
  if (!c) return '<div class="scr">' + subBar(t("set_cal")) + '<div class="body"><p class="empty">' + t("loading") + '</p></div></div>';
  var rows = CALS.map(function(k){
    var raw = c.raw[k], off = c.offsets[k] || 0, cor = c.corrected[k], dv = calDiv(k), dg = calDg(k), u = unitOf(k);
    var has = typeof raw === "number";
    var sub = has ? t("cal_sensor") + " " + fmt(raw / dv, dg) + (u ? " " + u : "") + (off && typeof cor === "number" ? " \u2192 " + t("cal_after") + " " + fmt(cor / dv, dg) : "") : t("cal_none");
    return '<div class="row"><div class="rn"><b>' + mlabel(k) + '</b><small>' + sub + '</small></div>' +
      '<span class="off">' + (off ? fmtSigned(off / dv, dg) : "0") + '</span>' +
      '<button class="btn" data-a="calOpen" data-arg="' + k + '" data-fid="cal-' + k + '"' + (has ? "" : " disabled") + '>' + t("cal_enter") + '</button>' +
      (off ? '<button class="btn ghost calr" data-a="calReset" data-arg="' + k + '" data-fid="calr-' + k + '">' + t("cal_reset") + '</button>' : '<span class="btn-ph"></span>') +
      '</div>';
  }).join("");
  return '<div class="scr">' + subBar(t("set_cal")) +
    '<div class="body"><div class="list">' + rows + '</div><p class="note">' + ic("warn", "s") + '<span>' + t("cal_note") + '</span></p></div></div>';
}

/* Wi‑Fi — /api/wifi · /api/wifi/scan · /api/wifi/connect */
function loadWifi(rescan){
  S.wbusy = true; if (S.screen === "wifi") render();
  Promise.all([api("/api/wifi"), fetch("/api/wifi/scan" + (rescan ? "?rescan=1" : ""), {method:"POST"}).then(function(r){ return r.json(); })])
    .then(function(res){
      S.wbusy = false; S.wstat = res[0];
      var nets = (res[1] && res[1].networks) || [];
      S.wifi = {nets:nets, err: res[0] && res[0].available === false ? (res[0].reason || "") : (!nets.length ? ((res[1] && res[1].error) || t("wifi_none_found")) : null)};
      if (S.screen === "wifi") render();
    }).catch(function(){ S.wbusy = false; S.wifi = {nets:[], err:t("wifi_load_fail")}; if (S.screen === "wifi") render(); });
}
function bars(n){ var s = ""; for (var i = 1; i <= 4; i++) s += '<i' + (i <= n ? ' class="on"' : "") + '></i>'; return '<span class="bars" aria-hidden="true">' + s + '</span>'; }
function vWifi(){
  var w = S.wstat, fail = S.d && S.d.status_code === "send_fail", cur;
  if (w && w.connected){
    cur = '<div class="cur-net' + (fail ? " warn" : "") + '">' + ic("wifi") + '<span><b>' + esc(w.ssid || "") + '</b>' + (w.ip ? " \u00B7 " + esc(w.ip) : "") + '</span><span class="sp"></span>' +
      (fail ? '<span class="st w">' + ic("cloudoff", "s") + t("wifi_upfail") + '</span>' : '<span class="st okt">' + ic("check", "s") + t("wifi_now") + '</span>') + '</div>';
  } else cur = '<div class="cur-net">' + ic("wifi") + '<span>' + (w ? t("wifi_none_conn") : t("loading")) + '</span></div>';
  var list;
  if (!S.wifi || (S.wbusy && !S.wifi.nets.length)) list = '<p class="empty">' + t("scanning") + '</p>';
  else if (S.wifi.err && !S.wifi.nets.length) list = '<p class="empty">' + esc(S.wifi.err) + '</p>';
  else list = '<div class="list scroll" style="flex:1">' + S.wifi.nets.map(function(n, i){
    var aria = n.ssid + ", " + t("signal", {n:n.bars}) + (n.secure ? ", " + t("secured") : "") + (n.in_use ? ", " + t("wifi_now") : "");
    return '<button class="row rowbtn' + (n.in_use ? " cur" : "") + '" data-a="wifiPick" data-arg="' + i + '" data-fid="w-' + i + '" aria-label="' + esc(aria) + '">' +
      '<span class="rn"><b>' + esc(n.ssid) + '</b></span>' + (n.in_use ? '<span class="okt">' + ic("tick", "s") + t("wifi_now") + '</span>' : "") +
      (n.secure ? ic("lock", "s dim") : "") + bars(n.bars) + '</button>';
  }).join("") + '</div>';
  return '<div class="scr">' + subBar(t("set_wifi"), '<button class="btn" data-a="rescan" data-fid="rescan"' + (S.wbusy ? " disabled" : "") + '>' + ic("refresh") + t(S.wbusy ? "scanning" : "rescan") + '</button>') +
    '<div class="body">' + cur + list + '</div></div>';
}
var K_ABC = [["1","2","3","4","5","6","7","8","9","0"],["q","w","e","r","t","y","u","i","o","p"],["a","s","d","f","g","h","j","k","l"],["z","x","c","v","b","n","m"]];
var K_SYM = [["1","2","3","4","5","6","7","8","9","0"],["!","@","#","$","%","^","&","*","(",")"],["-","_","=","+","[","]","{","}",";",":"],["~","\\","`","'","\"",",",".","?","/","|"]];
function vWifiPw(){
  var n = S.wsel || {ssid:""}, set = S.wlayer === "sym" ? K_SYM : K_ABC;
  var val = S.wpw ? (S.wshow ? esc(S.wpw) : new Array(S.wpw.length + 1).join("\u2022")) : '<span class="ph">' + t("wifi_pw_ph") + '</span>';
  var rows = set.map(function(row, ri){
    var keys = row.map(function(ch, ci){
      var lb = (S.wlayer === "abc" && S.wshift) ? ch.toUpperCase() : ch;
      return '<button data-a="kTap" data-arg="' + ri + '_' + ci + '">' + esc(lb) + '</button>';
    }).join("");
    if (ri === 3){
      return '<div class="kb-row">' + (S.wlayer === "abc" ? '<button class="w' + (S.wshift ? " on" : "") + '" data-a="kShift" aria-label="Shift">\u21E7</button>' : "") + keys +
        '<button class="w" data-a="kBack" aria-label="' + t("del") + '">' + ic("del") + '</button></div>';
    }
    return '<div class="kb-row">' + keys + '</div>';
  }).join("") +
    '<div class="kb-row"><button class="w" data-a="kLayer">' + (S.wlayer === "sym" ? "ABC" : "?123") + '</button>' +
    '<button style="flex:3 1 0" data-a="kSpace">' + t("wifi_space") + '</button>' +
    '<button class="w go" data-a="wifiConnect" data-fid="wconn"' + (S.wbusy ? " disabled" : "") + '>' + t(S.wbusy ? "wifi_connecting" : "wifi_connect") + '</button></div>';
  return '<div class="scr">' + subBar(esc(n.ssid)) +
    '<div class="body">' + (S.wmsg ? '<p class="mbox' + (S.wmsg.err ? " err" : "") + '">' + esc(S.wmsg.text) + '</p>' : "") +
      '<div class="pwf"><span class="val">' + val + '</span><button class="btn ghost" data-a="kShow" aria-label="' + t(S.wshow ? "wifi_hide" : "wifi_show") + '">' + ic("eye") + t(S.wshow ? "wifi_hide" : "wifi_show") + '</button></div>' +
      '<div class="kb">' + rows + '</div></div></div>';
}
function wifiConnect(){
  var n = S.wsel; if (!n) return;
  S.wbusy = true; S.wmsg = {err:false, text:t("wifi_connecting_to", {ssid:n.ssid})}; render();
  api("/api/wifi/connect", {ssid:n.ssid, password:S.wpw}).then(function(r){
    S.wbusy = false;
    if (r && r.ok){ S.wsel = null; S.wpw = ""; toast(t("wifi_connected")); S.screen = "wifi"; render(); loadWifi(false); }
    else { S.wmsg = {err:true, text:(r && r.error) || t("wifi_connect_fail")}; if (S.screen !== "wifipw") toast(S.wmsg.text); render(); }
  }).catch(function(){ S.wbusy = false; S.wmsg = {err:true, text:t("wifi_connect_fail")}; render(); });
}

function vLang(){
  var b = LANGS.map(function(l){
    var on = LANG === l[0];
    return '<button class="lang" data-a="lang" data-arg="' + l[0] + '" data-fid="l-' + l[0] + '" aria-pressed="' + on + '" lang="' + l[0] + '"><b>' + l[1] + '</b><small>' + l[2] + '</small>' + (on ? ic("check") : "") + '</button>';
  }).join("");
  return '<div class="scr">' + subBar(t("set_lang")) + '<div class="body"><div class="langs">' + b + '</div></div></div>';
}

/* 전력 회로 — 보기만(켜고 끄기는 이 에디션에 없다). 계측이 없으면 "연결된 계측기 없음" */
function vPower(){
  var p = S.d && S.d.power, body;
  if (!p || !p.circuits || !p.circuits.length){
    body = '<div class="empty">' + ic("zap", "l dim") + '<b>' + t("pw_none_amp") + '</b><small>' + (p ? t("pw_none") : t("pw_none_hint")) + '</small></div>';
  } else {
    var cs = p.circuits.slice().sort(function(a, b){ return (a.type === "main" ? 0 : 1) - (b.type === "main" ? 0 : 1); });
    var n = function(v, dg, cls){ return v === null || v === undefined ? '<td class="dim">\u2014</td>' : '<td' + (cls ? ' class="' + cls + '"' : "") + '>' + fmt(v, dg) + '</td>'; };
    var rows = cs.map(function(c){
      var st = c.state === 1 ? '<span class="onoff on">' + t("on") + '</span>' : c.state === 0 ? '<span class="onoff">' + t("off") + '</span>'
             : '<span class="onoff">' + t(c.age_min === null || c.age_min === undefined ? "pw_wait" : "pw_lost") + '</span>';
      var name = t("pwt_" + c.type);
      return '<tr><td>' + (name.indexOf("pwt_") === 0 ? esc(c.type) : name) + '<small>' + esc(c.id) + '</small></td><td>' + st + '</td>' +
        n(c.power, 0) + n(c.current, 1) + n(c.energy_today, 2) + n(c.temp, 0, c.level || "") + '</tr>';
    }).join("");
    var head = '<tr><th scope="col">' + t("col_circuit") + '</th><th scope="col">' + t("col_state") + '</th><th scope="col">' + t("col_w") + '</th><th scope="col">' + t("col_a") + '</th><th scope="col">' + t("col_kwh") + '</th><th scope="col">' + t("col_tc") + '</th></tr>';
    // 인입(main) 계측이 있으면 그 줄이 곧 전체다. 없을 때만 '계측 회로 합' 줄을 둔다.
    var tot = !p.partial || p.total_w === null || p.total_w === undefined ? "" :
      '<tr class="tot"><td>' + t(p.partial ? "pw_total_partial" : "pw_total") + '</td><td></td><td>' + fmt(p.total_w, 0) + '</td><td></td><td></td><td></td></tr>';
    body = '<div class="pwrap scroll" data-keep="power"><table class="ptable"><thead>' + head + '</thead><tbody>' + tot + rows + '</tbody></table></div>';
  }
  return '<div class="scr">' + subBar(t("set_power")) + '<div class="body">' + body + '</div></div>';
}

/* 기기 연결 — /api/pair/start 로 코드를 받는다. 코드·오류는 State(pair_code·pair_error) */
function vPair(){
  var d = S.d || {}, right, steps = [];
  if (BRAND.app_name) steps.push(t("pair_s1_app", {app:esc(BRAND.app_name)}));
  else if (BRAND.pair_url) steps.push(t("pair_s1_url", {url:esc(BRAND.pair_url)}));
  steps.push(t("pair_s2"), t("pair_s3"), t("pair_s4"));
  var left = '<div><ol class="steps">' + steps.map(function(s, i){ return '<li><span class="n">' + (i + 1) + '</span><span>' + s + '</span></li>'; }).join("") + '</ol>' +
    (BRAND.app_name && BRAND.pair_url ? '<p class="pnote">' + ic("globe", "s") + '<span>' + t("pair_web", {url:esc(BRAND.pair_url)}) + '</span></p>' : "") +
    '<p class="pnote">' + ic("info", "s") + '<span>' + t("pair_note") + '</span></p></div>';
  if (d.linked && !d.pairing){
    right = '<div class="pcode">' + ic("check", "l") + '<p class="exp">' + t("pair_linked") + '</p>' +
      (d.account ? '<p><b>' + esc(d.account) + '</b></p>' : "") +
      '<button class="btn" data-a="unlinkAsk" data-fid="acct">' + ic("link") + t("change_acct") + '</button></div>';
  } else if (d.pair_error){
    right = '<div class="pcode"><p class="perr">' + t("pair_fail_title") + '<br>' + esc(d.pair_error) + '</p>' +
      '<button class="btn primary" data-a="pairRetry" data-fid="pretry">' + ic("refresh") + t("retry") + '</button></div>';
  } else if (!d.pair_code){
    right = '<div class="pcode"><p class="wait"><i></i><i></i><i></i>' + t("pair_getting") + '</p></div>';
  } else {
    var code = String(d.pair_code), boxes = "";
    for (var i = 0; i < code.length; i++) boxes += '<span>' + esc(code.charAt(i)) + '</span>' + (i === 2 && code.length === 6 ? '<span class="gap"></span>' : "");
    right = '<div class="pcode"><p class="exp">' + t("pair_code") + '</p><div class="code" role="img" aria-label="' + esc(t("pair_code") + " " + code.split("").join(" ")) + '">' + boxes + '</div>' +
      '<p class="wait"><i></i><i></i><i></i>' + t("pair_wait") + '</p></div>';
  }
  return '<div class="scr">' + subBar(t("pair_title"), "", d.linked && !d.pairing ? "back" : "cancel") +
    '<div class="body"><div class="pair">' + left + right + '</div></div></div>';
}

/* ---------- 모달 ---------- */
function mRestart(){
  var opt = function(kind, tk, sk, icn){
    return '<button class="row rowbtn" data-a="restartGo" data-arg="' + kind + '" data-fid="rs-' + kind + '"><span class="rn"><b>' + t(tk) + '</b><small>' + t(sk) + '</small></span>' + ic(icn) + '</button>';
  };
  return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dialog">' +
    '<h2 id="dlg-t">' + t("rs_title") + '</h2><p class="dsub">' + t("restart_hint") + '</p>' +
    opt("app", "restart_app", "restart_app_sub", "refresh") + opt("dev", "reboot_dev", "reboot_dev_sub", "power") +
    '<div class="dlg-btns"><button class="btn" data-a="modalClose" data-fid="m-cancel">' + t("cancel") + '</button></div></div></div>';
}
function mUnlink(){
  return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dialog">' +
    '<h2 id="dlg-t">' + t("change_acct") + '</h2><p class="dsub">' + t("acct_confirm") + '</p>' +
    '<div class="dlg-btns"><button class="btn" data-a="modalClose" data-fid="m-cancel">' + t("cancel") + '</button>' +
    '<button class="btn primary" data-a="unlinkYes" data-fid="m-ok">' + ic("link") + t("acct_confirm_yes") + '</button></div></div></div>';
}
function mKp(){
  var k = S.kp.key, buf = S.kp.buf, c = S.cal, u = unitOf(k);
  var keys = ["1", "2", "3", "DEL", "4", "5", "6", ".", "7", "8", "9", "0"];
  var kp = keys.map(function(x, i){
    return x === "DEL" ? '<button class="btn" data-a="keyDel" data-fid="kp-del" aria-label="' + t("del") + '">' + ic("del") + '</button>'
                       : '<button class="btn" data-a="key" data-arg="' + x + '" data-fid="kp-' + i + '">' + (x === "." ? decSep() : x) + '</button>';
  }).join("");
  var ph = c && typeof c.raw[k] === "number" ? fmt(c.raw[k] / calDiv(k), calDg(k)) : "0";
  return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dialog">' +
    '<h2 id="dlg-t">' + t("cal_kp_t", {m:mlabel(k)}) + '</h2><p class="dsub">' + t("cal_kp_hint") + '</p>' +
    '<div class="kp-disp" aria-live="polite">' + (buf ? esc(buf.replace(".", decSep())) : '<span class="ph">' + ph + '</span>') + '<small>' + u + '</small></div>' +
    '<div class="kp">' + kp + '</div>' +
    '<div class="dlg-btns"><button class="btn" data-a="modalClose" data-fid="m-cancel">' + t("cancel") + '</button>' +
    '<button class="btn primary" data-a="keyOk" data-fid="m-ok">' + t("apply") + '</button></div></div></div>';
}

var VIEWS = {boot:vBoot, main:vMain, chart:vChart, ai:vAI, info:vInfo, settings:vSettings, sensors:vSensors, test:vTest, cal:vCal,
             wifi:vWifi, wifipw:vWifiPw, lang:vLang, power:vPower, pair:vPair};
var MODALS = {restart:mRestart, kp:mKp, unlink:mUnlink};
var PARENT = {chart:"main", ai:"main", info:"main", settings:"main", sensors:"settings", test:"settings", cal:"settings",
              wifi:"settings", wifipw:"wifi", lang:"settings", power:"settings", pair:"settings"};
var LIVE = {main:1, chart:1, ai:1, info:1, power:1, pair:1};

/* ======================= 렌더·이동 ======================= */
var view = document.getElementById("view"), lastScreen = null, kbd = false;
function render(isTick){
  if (isTick && (!LIVE[S.screen] || S.modal)) return;
  var a = document.activeElement, fid = a && view.contains(a) ? a.getAttribute("data-fid") : null;
  var keep = {}; Array.prototype.forEach.call(view.querySelectorAll("[data-keep]"), function(el){ keep[el.getAttribute("data-keep")] = el.scrollTop; });
  view.innerHTML = VIEWS[S.screen]() + (S.modal ? MODALS[S.modal]() : "");
  Array.prototype.forEach.call(view.querySelectorAll("[data-keep]"), function(el){ var v = keep[el.getAttribute("data-keep")]; if (v) el.scrollTop = v; });
  var first = view.firstElementChild, changed = S.screen !== lastScreen;
  if (changed && first) first.classList.add("enter");
  if (S.focusModal){
    S.focusModal = false;
    var mb = view.querySelector('.modal [data-fid="m-cancel"]'); if (mb) mb.focus({preventScroll:true});
  } else if (fid){
    var el = view.querySelector('[data-fid="' + fid + '"]'); if (el) el.focus({preventScroll:true});
  } else if (changed && kbd){
    var h = view.querySelector("h1[tabindex]"); if (h) h.focus({preventScroll:true});
  }
  lastScreen = S.screen;
}
function go(s){
  if (s === "pair" || s === "test") S.prev[s] = S.screen;
  S.screen = s; S.modal = null;
  if (s === "chart") loadChart();
  if (s === "sensors") loadSensors();
  if (s === "test"){ if (!S.sens) loadSensors(); runTest(); }
  if (s === "cal"){ S.cal = null; loadCal(); }
  if (s === "wifi"){ S.wifi = null; loadWifi(true); }
  if (s === "info") loadWifiStatus();
  if (s === "pair"){
    var d = S.d || {};
    if (!d.linked && !d.pairing) fetch("/api/pair/start", {method:"POST"}).then(tick).catch(function(){});
  }
  if (s === "main" && needTrends()) loadTrends();
  render();
}
function back(){
  var cur = S.screen, p = S.prev[cur]; S.prev[cur] = null;
  if (cur === "pair" && S.d && S.d.pairing) fetch("/api/pair/cancel", {method:"POST"}).then(tick).catch(function(){});
  if (cur === "wifipw"){ S.wsel = null; S.wpw = ""; S.wmsg = null; }
  S.screen = (p && p !== "boot" && p !== cur) ? p : (PARENT[cur] || "main"); S.modal = null;
  if (S.screen === "main" && needTrends()) loadTrends();
  render();
}
var toastTimer;
function toast(msg){
  var el = document.getElementById("toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.hidden = true; }, 2600);
}
function reloadWhenBack(wait){
  setTimeout(function poll(){
    fetch("/api/state", {cache:"no-store"}).then(function(r){ if (!r.ok) throw 0; location.reload(); })
      .catch(function(){ setTimeout(poll, 4000); });
  }, wait);
}

var ACT = {
  go:function(s){ go(s); },
  back:function(){ back(); },
  chart:function(k){ S.chartKey = k; go("chart"); },
  range:function(r){ S.range = r; loadChart(); render(); },
  ack:function(sig){ S.ackSig = sig; render(); },
  lang:function(l){
    if (!/^(ko|en|vi|id)$/.test(l)) return;
    LANG = l; document.documentElement.lang = l;
    fetch("/api/lang", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({lang:l})}).catch(function(){});
    render();
  },
  theme:function(v){ S.theme = v; document.documentElement.setAttribute("data-theme", v); try { localStorage.setItem("amp-theme", v); } catch(e){} render(); },
  modal:function(m){ S.modal = m; S.focusModal = true; render(); },
  modalClose:function(){ S.modal = null; render(); },
  sensToggle:function(k){ var sn = sensOf(k); if (sn){ sn.enabled = !sn.enabled; saveSensors(); } },
  sensInterval:function(n){ if (S.sens){ S.sens.interval = +n; saveSensors(); } },
  sensFourth:function(m){ if (S.sens){ S.sens.ec_mode = m; saveSensors(); } },
  sensUnit:function(u){ if (S.sens){ S.sens.ec_unit = u; saveSensors(); } },
  runtest:function(){ runTest(); },
  calOpen:function(k){ S.kp = {key:k, buf:""}; S.modal = "kp"; S.focusModal = true; render(); },
  calReset:function(k){ calSend({name:k, offset:0}); },
  key:function(x){
    var b = S.kp.buf;
    if (x === "." && b.indexOf(".") >= 0) return;
    if (b.length >= 8) return;
    S.kp.buf = (b === "" && x === ".") ? "0." : b + x; render();
  },
  keyDel:function(){ S.kp.buf = S.kp.buf.slice(0, -1); render(); },
  keyOk:function(){
    var x = parseFloat(S.kp.buf), k = S.kp.key; S.modal = null; render();
    if (!isNaN(x)) calSend({name:k, actual:Math.round(x * calDiv(k) * 1000) / 1000});
  },
  wifiPick:function(i){
    var n = S.wifi && S.wifi.nets[+i]; if (!n || n.in_use) return;
    S.wsel = n; S.wpw = ""; S.wshow = false; S.wshift = false; S.wlayer = "abc"; S.wmsg = null;
    if (!n.secure){ wifiConnect(); return; }
    S.screen = "wifipw"; render();
  },
  rescan:function(){ loadWifi(true); },
  kTap:function(a){
    var p = String(a).split("_"), set = S.wlayer === "sym" ? K_SYM : K_ABC, ch = set[+p[0]][+p[1]];
    if (S.wlayer === "abc" && S.wshift) ch = ch.toUpperCase();
    if (S.wpw.length < 63) S.wpw += ch; render();
  },
  kBack:function(){ S.wpw = S.wpw.slice(0, -1); render(); },
  kSpace:function(){ if (S.wpw.length < 63) S.wpw += " "; render(); },
  kShift:function(){ S.wshift = !S.wshift; render(); },
  kLayer:function(){ S.wlayer = S.wlayer === "sym" ? "abc" : "sym"; render(); },
  kShow:function(){ S.wshow = !S.wshow; render(); },
  wifiConnect:function(){ wifiConnect(); },
  pairRetry:function(){ fetch("/api/pair/start", {method:"POST"}).then(tick).catch(function(){}); },
  unlinkAsk:function(){ S.modal = "unlink"; S.focusModal = true; render(); },
  unlinkYes:function(){
    S.modal = null;
    fetch("/api/unlink", {method:"POST"}).then(function(){ S.prev.pair = "main"; S.screen = "pair"; render(); tick(); })
      .catch(function(){ toast(t("save_fail")); render(); });
  },
  restartGo:function(kind){
    var dev = kind === "dev";
    S.modal = null; S.restart = dev ? "dev" : "app"; S.screen = "boot"; render();
    fetch(dev ? "/api/reboot" : "/api/restart", {method:"POST"}).then(function(r){ return r.json(); }).then(function(r){
      if (r && r.ok === false){ S.restart = null; S.screen = "settings"; render(); toast(r.error || t("restart_fail")); return; }
      reloadWhenBack(dev ? 45000 : 12000);
    }).catch(function(){ reloadWhenBack(dev ? 45000 : 12000); });
  }
};

view.addEventListener("click", function(e){
  var el = e.target.closest("[data-a]");
  if (!el || !view.contains(el) || el.disabled) return;
  var fn = ACT[el.getAttribute("data-a")];
  if (fn) fn(el.getAttribute("data-arg"));
});
document.addEventListener("keydown", function(e){
  if (e.key === "Tab") kbd = true;
  if (e.key === "Escape" && S.modal){ S.modal = null; render(); }
});
document.addEventListener("pointerdown", function(){ kbd = false; });

/* ---------- 수집기 상태 — 3초마다 ---------- */
function onState(d){
  S.noResp = 0;
  if (d.version){
    if (S.ver === null) S.ver = d.version;
    else if (d.version !== S.ver){ location.reload(); return; }
  }
  var firstState = !S.d;
  S.d = d;
  if (S.restart) return;
  // 연결 대기가 새로 시작됐으면(계정 변경 등) 연결 화면으로, 연결이 끝나면 대시보드로.
  if (d.pairing && !S.wasPairing && S.screen !== "pair" && S.screen !== "boot"){ S.prev.pair = S.screen; S.screen = "pair"; S.modal = null; render(); }
  if (S.wasLinked === false && d.linked && S.screen === "pair"){ toast(t("st_paired")); S.prev = {}; S.screen = "main"; render(); }
  S.wasPairing = !!d.pairing; S.wasLinked = !!d.linked;
  if (firstState){ loadSensors(); }
  if (S.screen === "boot"){
    setTimeout(function(){ if (S.screen === "boot" && !S.restart){ S.screen = "main"; loadTrends(); render(); } }, Math.max(0, 1500 - (Date.now() - S.bootAt)));
    render();
    return;
  }
  if (S.screen === "main" && needTrends()) loadTrends();
  // 연결 코드를 받는 중이면 1초마다 다시 묻는다 — 3초를 기다리면 빈 화면이 길다.
  if (S.screen === "pair" && d.pairing && !d.pair_code && !d.pair_error) setTimeout(tick, 1000);
  render(true);
}
function tick(){
  return fetch("/api/state", {cache:"no-store"}).then(function(r){ return r.json(); }).then(onState)
    .catch(function(){ S.noResp++; if (S.screen === "main") render(true); });
}

render();
tick();
setInterval(tick, 3000);
})();
</script>
</body>
</html>
"""
