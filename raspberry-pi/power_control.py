"""전력 회로 켜고 끄기 — 수동 · 시간 예약 · 반복 간격 · 산소량 연동.

계측 차단기(지그비)는 Zigbee2MQTT 로 켜고 끌 수 있다(`zigbee2mqtt/<이름>/set {"state":"ON"}`).
이 모듈은 회로마다 규칙을 두고 15초마다 '지금 켜져 있어야 하는가' 를 계산해, 바뀔 때만 명령을 보낸다.

규칙 (회로 이름 → 규칙, /var/lib/shrimp365/power_control.json)::

    {"mode": "manual"}                                   # 사람이 화면에서 켜고 끈다
    {"mode": "timer", "timers": [{"on": "06:00", "off": "06:30", "days": [0,1,2,3,4,5,6]}]}
    {"mode": "cycle", "cycle": {"on_min": 15, "off_min": 45, "from": "06:00", "to": "18:00",
                                "days": [0,1,2,3,4,5,6]}}
    {"mode": "do", "do": {"on_below": 5.0, "off_above": 6.0, "min_on_min": 10}}   # 산소량 연동
    "auto_off_min": 30                                   # (어느 모드든) 손으로 켜면 30분 뒤 끈다. 0 = 안 함
    "do_guard_below": 4.0                                # (예약·간격·수동) 산소가 이 아래면 무조건 켠다. 0 = 안 함

산소량 연동(do): 용존산소가 on_below 이하로 떨어지면 켜고, off_above 이상으로 오르면 끈다(그 사이는
그대로 — 켜고 끄기를 반복하지 않게). 한 번 켜면 min_on_min 동안은 끄지 않는다. 산소값이 10분 넘게
없으면(센서 고장·배선) 켠다 — 모르면 켜 두는 쪽이 안전하다.

산소 부족 강제 켜기(do_guard_below): 예약·간격·수동 어느 모드든, 산소가 그 값 이하이면 예약과 손 조작을
무시하고 켠다. 산소가 그 값 + 1 mg/L 이상으로 회복되면 풀린다. 산소값을 모르면 관여하지 않는다.

요일은 월=0 … 일=6. 켜는 시각이 끄는 시각보다 늦으면 자정을 넘긴다(22:00→02:00 는 켠 날 기준).

손으로 켜고 끄기(override)는 예약보다 앞선다. 예약이 다음에 바뀌는 순간(켜기→끄기 또는 그 반대)에
손 조작이 풀리고 예약을 다시 따른다 — 손으로 끈 관수펌프가 다음 예약 때까지 꺼져 있어야 하지만,
영영 꺼져 있으면 안 되기 때문이다.

안전:
  · 인입(main) 회로는 제어하지 않는다.
  · 산소공급기(aerator)는 새 규칙의 '산소 부족 강제 켜기' 가 기본 4.0 mg/L 로 걸린다(끌 수 있다).
    화면에서 손으로 끌 때는 한 번 더 묻는다.
  · 차단기가 과열(crit)이면 켜기 명령을 보내지 않는다.
  · 시계가 맞지 않으면(인터넷 없이 부팅해 2024년 이전) 예약을 돌리지 않는다.
  · 보낸 뒤 차단기 상태가 따라오지 않으면 90초 간격으로 두 번 더 보내고, 그래도 안 되면 화면에 알린다.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

log = logging.getLogger("shrimp365.power")

DEFAULT_PATH = Path("/var/lib/shrimp365/power_control.json")
MODES = ("manual", "timer", "cycle", "do")
NO_CONTROL = {"main"}
#: 끌 때 화면이 한 번 더 묻는 회로, 새 규칙에 산소 부족 강제 켜기를 기본으로 거는 회로.
CONFIRM_OFF = {"aerator"}
DO_GUARD_DEFAULT = 4.0
DO_STALE_S = 600
GUARD_RELEASE = 1.0
MAX_TIMERS = 6
TICK_S = 15
RETRY_S = 90
RETRIES = 2
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")
_ID = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _days(v) -> list[int]:
    if not isinstance(v, list):
        return list(range(7))
    return sorted({int(d) for d in v if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6})


def clean_rule(rule: dict, kind: str) -> tuple[dict | None, str]:
    """화면에서 온 규칙을 검사해 정리한다. (규칙, 오류) — 오류가 있으면 규칙은 None."""
    if not isinstance(rule, dict):
        return None, "규칙 형식이 올바르지 않습니다"
    mode = rule.get("mode", "manual")
    if mode not in MODES:
        return None, "모르는 모드입니다"
    if kind in NO_CONTROL:
        return None, "인입(전체) 회로는 켜고 끌 수 없습니다"
    try:
        auto_off = int(rule.get("auto_off_min") or 0)
    except (TypeError, ValueError):
        return None, "자동 끄기 시간이 올바르지 않습니다"
    if not 0 <= auto_off <= 24 * 60:
        return None, "자동 끄기는 0~1440분입니다"
    try:
        guard = float(rule.get("do_guard_below") or 0)
    except (TypeError, ValueError):
        return None, "산소 부족 기준이 올바르지 않습니다"
    if guard and not 0.5 <= guard <= 15:
        return None, "산소 부족 기준은 0.5~15 mg/L 입니다"
    out: dict = {"mode": mode, "auto_off_min": auto_off}
    if guard and mode != "do":
        out["do_guard_below"] = round(guard, 1)
    if mode == "timer":
        timers = []
        for t in rule.get("timers") or []:
            if not isinstance(t, dict) or not _HHMM.match(str(t.get("on", ""))) or not _HHMM.match(str(t.get("off", ""))):
                return None, "시각은 HH:MM 으로 적습니다"
            if t["on"] == t["off"]:
                return None, "켜는 시각과 끄는 시각이 같습니다"
            days = _days(t.get("days"))
            if not days:
                return None, "요일을 하나 이상 고르세요"
            timers.append({"on": t["on"], "off": t["off"], "days": days})
        if not timers:
            return None, "예약 시각을 하나 이상 넣으세요"
        if len(timers) > MAX_TIMERS:
            return None, f"예약은 {MAX_TIMERS}개까지입니다"
        out["timers"] = timers
    elif mode == "cycle":
        c = rule.get("cycle") or {}
        try:
            on_m, off_m = int(c.get("on_min", 0)), int(c.get("off_min", 0))
        except (TypeError, ValueError):
            return None, "간격이 올바르지 않습니다"
        if not (1 <= on_m <= 720 and 1 <= off_m <= 720):
            return None, "켜는·쉬는 시간은 1~720분입니다"
        frm, to = str(c.get("from", "00:00")), str(c.get("to", "24:00"))
        if not _HHMM.match(frm) or not _HHMM.match(to) or frm == to:
            return None, "가동 시간대가 올바르지 않습니다"
        days = _days(c.get("days"))
        if not days:
            return None, "요일을 하나 이상 고르세요"
        out["cycle"] = {"on_min": on_m, "off_min": off_m, "from": frm, "to": to, "days": days}
    elif mode == "do":
        c = rule.get("do") or {}
        try:
            lo, hi, mn = float(c.get("on_below", 0)), float(c.get("off_above", 0)), int(c.get("min_on_min", 10))
        except (TypeError, ValueError):
            return None, "산소 기준이 올바르지 않습니다"
        if not (0.5 <= lo <= 15 and lo < hi <= 20):
            return None, "켜는 기준은 0.5~15, 끄는 기준은 그보다 높게(20 이하) 적습니다"
        if not 0 <= mn <= 240:
            return None, "최소 가동 시간은 0~240분입니다"
        out["do"] = {"on_below": round(lo, 1), "off_above": round(hi, 1), "min_on_min": mn}
    return out, ""


def _in_window(now: dt.datetime, on: str, off: str, days: list[int]) -> tuple[bool, dt.datetime | None]:
    """now 가 [on, off) 안인가. 자정을 넘는 창은 켠 날의 요일로 본다. (안인가, 창 시작 시각)."""
    a, b = _minutes(on), _minutes(off)
    m = now.hour * 60 + now.minute
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if a < b:
        if now.weekday() in days and a <= m < b:
            return True, today + dt.timedelta(minutes=a)
        return False, None
    # 자정을 넘는다: 오늘 a 이후(오늘 요일) 또는 오늘 b 이전(어제 요일)
    if m >= a and now.weekday() in days:
        return True, today + dt.timedelta(minutes=a)
    if m < b and (now - dt.timedelta(days=1)).weekday() in days:
        return True, today - dt.timedelta(days=1) + dt.timedelta(minutes=a)
    return False, None


def scheduled(rule: dict, now: dt.datetime) -> bool | None:
    """예약상 지금 켜져 있어야 하는가. 수동 모드는 None(예약 없음)."""
    mode = rule.get("mode")
    if mode == "timer":
        return any(_in_window(now, t["on"], t["off"], t["days"])[0] for t in rule.get("timers", []))
    if mode == "cycle":
        c = rule["cycle"]
        inside, start = _in_window(now, c["from"], "00:00" if c["to"] == "24:00" else c["to"], c["days"])
        if not inside:
            return False
        period = c["on_min"] + c["off_min"]
        elapsed = int((now - start).total_seconds() // 60)
        return elapsed % period < c["on_min"]
    return None


class PowerControl:
    """회로 규칙을 들고 15초마다 명령을 낸다. 화면 스레드와 주 루프가 함께 부르므로 잠근다."""

    def __init__(self, path: Path = DEFAULT_PATH, *, send=None, names=None, clock=None) -> None:
        self.path = Path(path)
        self._send_fn = send            # (회로 이름, 켜기 bool) → None, 실패하면 예외
        self._names = names             # () → {회로 이름(대문자): Zigbee2MQTT 이름}
        self._clock = clock or dt.datetime.now
        self._lock = threading.RLock()
        self.rules: dict[str, dict] = {}
        self.over: dict[str, dict] = {}      # 손 조작 {"on", "until", "sched"}
        self.last: dict[str, dict] = {}      # 마지막 명령 {"on", "at", "tries", "error"}
        self.circuits: dict[str, dict] = {}  # 주 루프가 알려 주는 회로 {"type", "state", "level"}
        self.do_value: float | None = None   # 마지막 용존산소(mg/L)와 받은 때(monotonic)
        self.do_at = 0.0
        self.do_on: dict[str, float] = {}    # 산소량 연동으로 켠 회로 → 켠 때(time.time)
        self.guard_on: set[str] = set()      # 산소 부족으로 강제로 켠 회로
        self._thread: threading.Thread | None = None
        self._load()

    # ── 저장 ──────────────────────────────────────────────────────────────
    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        self.rules = {k: v for k, v in (data.get("rules") or {}).items() if _ID.match(k) and isinstance(v, dict)}
        self.over = {k: v for k, v in (data.get("override") or {}).items() if _ID.match(k) and isinstance(v, dict)}

    def _save(self) -> bool:
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({"rules": self.rules, "override": self.over}, ensure_ascii=False, indent=1),
                           encoding="utf-8")
            os.replace(tmp, self.path)
            return True
        except OSError as exc:
            log.warning("전력 제어 규칙을 저장하지 못했습니다: %s", exc)
            return False

    # ── 주 루프 · 화면 ────────────────────────────────────────────────────
    def observe(self, circuits: list[dict]) -> None:
        # 이번에 빠진 회로(끊김)도 종류는 기억한다 — 잊으면 인입·산소공급기 보호가 풀린다.
        with self._lock:
            for c in self.circuits.values():
                c.update(state=None, level="")
            for c in circuits:
                self.circuits[c["id"].upper()] = {"type": c.get("type"), "state": c.get("state"),
                                                  "level": c.get("level", "")}

    def observe_do(self, value) -> None:
        """주 루프가 읽은 용존산소. 못 읽었으면 None — 예전 값은 10분 뒤 '모름' 이 된다."""
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            with self._lock:
                self.do_value, self.do_at = float(value), time.monotonic()

    def _do_now(self) -> float | None:
        if self.do_value is None or time.monotonic() - self.do_at > DO_STALE_S:
            return None
        return self.do_value

    def _kind(self, sid: str) -> str:
        return (self.circuits.get(sid) or {}).get("type") or "other"

    def controllable(self, sid: str) -> bool:
        return self._kind(sid) not in NO_CONTROL and sid in self._zname_map()

    def _zname_map(self) -> dict[str, str]:
        try:
            return {k.upper(): v for k, v in (self._names() if self._names else {}).items()}
        except Exception as exc:  # noqa: BLE001 — 설정 파일을 못 읽어도 화면은 떠야 한다
            log.warning("차단기 이름을 읽지 못했습니다: %s", exc)
            return {}

    def snapshot(self) -> dict:
        """화면용 — 회로마다 규칙·손 조작·마지막 명령·제어 가능 여부."""
        with self._lock:
            names = self._zname_map()
            now = self._clock()
            out = {}
            for sid in sorted(set(self.circuits) | set(self.rules)):
                kind = self._kind(sid)
                rule = self.rules.get(sid) or self.default_rule(kind)
                o = self.over.get(sid)
                last = self.last.get(sid, {})
                out[sid] = {
                    "rule": rule,
                    "can": kind not in NO_CONTROL and sid in names,
                    "confirm_off": kind in CONFIRM_OFF,
                    "override": None if not o else {"on": o["on"], "until": o.get("until")},
                    "scheduled": self._sched(sid, rule, now, peek=True),
                    "do_forced": sid in self.guard_on,
                    "error": last.get("error") or "",
                    "pending": bool(last and last.get("tries", 0) and not last.get("ok")),
                }
            do = self._do_now()
            return {"circuits": out, "clock_ok": self._clock_ok(now), "now": now.strftime("%H:%M"),
                    "do": None if do is None else round(do, 2)}

    @staticmethod
    def default_rule(kind: str) -> dict:
        r: dict = {"mode": "manual", "auto_off_min": 0}
        if kind in CONFIRM_OFF:
            r["do_guard_below"] = DO_GUARD_DEFAULT
        return r

    def set_rule(self, sid: str, rule: dict) -> dict:
        sid = sid.upper()
        with self._lock:
            if not _ID.match(sid):
                return {"ok": False, "error": "회로 이름이 올바르지 않습니다"}
            clean, err = clean_rule(rule, self._kind(sid))
            if clean is None:
                return {"ok": False, "error": err}
            self.rules[sid] = clean
            self.over.pop(sid, None)         # 새 규칙은 바로 따른다
            self.last.pop(sid, None)
            saved = self._save()
        log.info("전력 회로 규칙: %s → %s", sid, clean)
        self.tick()
        return {"ok": True, "saved": saved, "rule": clean}

    def manual(self, sid: str, on: bool, minutes: int | None = None) -> dict:
        """화면의 [켜기]/[끄기]. minutes 를 주면 그만큼 뒤에 되돌린다(켰으면 끄고, 껐으면 켠다)."""
        sid = sid.upper()
        with self._lock:
            kind = self._kind(sid)
            if kind in NO_CONTROL:
                return {"ok": False, "error": "인입(전체) 회로는 켜고 끌 수 없습니다"}
            if sid not in self._zname_map():
                return {"ok": False, "error": "이 회로의 차단기를 [무선 센서]에서 찾지 못했습니다"}
            if on and (self.circuits.get(sid) or {}).get("level") == "crit":
                return {"ok": False, "error": "차단기 과열 중에는 켤 수 없습니다 — 부하·단자를 점검하세요"}
            rule = self.rules.get(sid) or self.default_rule(kind)
            if minutes is None and on and rule.get("auto_off_min"):
                minutes = int(rule["auto_off_min"])
            if minutes is not None:
                if not 1 <= int(minutes) <= 24 * 60:
                    return {"ok": False, "error": "시간은 1~1440분입니다"}
            now = self._clock()
            self.over[sid] = {"on": bool(on), "sched": self._sched(sid, rule, now, peek=True),
                              "until": (now + dt.timedelta(minutes=int(minutes))).isoformat(timespec="seconds")
                              if minutes else None}
            self.last.pop(sid, None)
            self._save()
        log.info("화면에서 전력 회로 %s: %s%s", sid, "켜기" if on else "끄기", f" ({minutes}분)" if minutes else "")
        res = self.tick()
        return {"ok": True, **(res.get(sid) or {})}

    def clear_override(self, sid: str) -> dict:
        sid = sid.upper()
        with self._lock:
            self.over.pop(sid, None)
            self.last.pop(sid, None)
            self._save()
        self.tick()
        return {"ok": True}

    # ── 판단 ──────────────────────────────────────────────────────────────
    @staticmethod
    def _clock_ok(now: dt.datetime) -> bool:
        return now.year >= 2024

    def _sched(self, sid: str, rule: dict, now: dt.datetime, peek: bool = False) -> bool | None:
        """규칙상 지금 켜져야 하는가 — 시각 예약·간격은 시계로, 산소량 연동은 용존산소로."""
        if rule.get("mode") != "do":
            return scheduled(rule, now) if self._clock_ok(now) else None
        c, do = rule["do"], self._do_now()
        was = sid in self.do_on
        if do is None:
            want = True                                  # 산소를 모르면 켜 둔다
        elif do <= c["on_below"]:
            want = True
        elif do >= c["off_above"]:
            want = was and time.time() - self.do_on[sid] < c.get("min_on_min", 0) * 60
        else:
            want = was                                   # 사이 구간은 그대로
        if not peek:
            if want and not was:
                self.do_on[sid] = time.time()
            elif not want:
                self.do_on.pop(sid, None)
        return want

    def _guard(self, sid: str, rule: dict) -> bool:
        """산소 부족 강제 켜기 — 걸렸는가(이번 판단에서 켜야 하는가)."""
        below = rule.get("do_guard_below") or 0
        do = self._do_now()
        if not below or rule.get("mode") == "do" or do is None:
            self.guard_on.discard(sid)
            return False
        if do <= below:
            if sid not in self.guard_on:
                log.warning("산소 부족(%.2f mg/L ≤ %.1f) — %s 를 강제로 켭니다", do, below, sid)
            self.guard_on.add(sid)
        elif do >= below + GUARD_RELEASE:
            self.guard_on.discard(sid)
        return sid in self.guard_on

    def desired(self, sid: str, now: dt.datetime) -> bool | None:
        """지금 켜져 있어야 하는가. None 이면 아무것도 하지 않는다."""
        rule = self.rules.get(sid) or self.default_rule(self._kind(sid))
        sched = self._sched(sid, rule, now)
        if self._guard(sid, rule):
            return True                       # 산소 부족 — 예약·손 조작보다 앞선다
        o = self.over.get(sid)
        if o:
            until = o.get("until")
            if until and self._clock_ok(now) and now >= dt.datetime.fromisoformat(until):
                self.over.pop(sid, None)
                self._save()
                # 시간 지정이 끝났다: 예약이 있으면 예약을, 없으면 반대로 되돌린다.
                return sched if sched is not None else (not o["on"])
            if sched is not None and o.get("sched") is not None and sched != o["sched"]:
                self.over.pop(sid, None)      # 예약이 바뀌는 순간 손 조작이 풀린다
                self._save()
                return sched
            return bool(o["on"])
        return sched

    def tick(self) -> dict:
        """한 번 판단해 필요한 명령을 보낸다. {회로: {"sent": bool, "on", "error"}}."""
        out: dict[str, dict] = {}
        with self._lock:
            if not self.circuits:
                return out                      # 회로 종류를 알기 전(시작 직후)에는 명령하지 않는다
            now = self._clock()
            names = self._zname_map()
            guarded = {sid for sid, c in self.circuits.items() if c.get("type") in CONFIRM_OFF}
            for sid in sorted(set(self.rules) | set(self.over) | guarded):
                want = self.desired(sid, now)
                if want is None or sid not in names or self._kind(sid) in NO_CONTROL:
                    continue
                c = self.circuits.get(sid) or {}
                if want and c.get("level") == "crit":
                    self.last[sid] = {"on": want, "at": time.time(), "tries": 0, "ok": False,
                                      "error": "과열 중이라 켜지 않았습니다"}
                    continue
                last = self.last.get(sid)
                state = c.get("state")
                if last and last["on"] == want:
                    if state is not None and bool(state) == want:
                        last.update(ok=True, error="")
                        continue
                    if last.get("ok") is True:
                        continue                    # 한 번 따른 뒤 차단기에서 손으로 바꾼 것은 다투지 않는다
                    if last.get("ok") is not False and state is None:
                        continue                    # 상태를 모르는 차단기 — 한 번 보냈으면 됐다
                    if time.time() - last["at"] < RETRY_S:
                        continue
                    if last["tries"] > RETRIES:
                        last["error"] = "차단기가 명령을 따르지 않습니다 — 연결·수동 스위치 확인"
                        continue
                r = self._send(sid, names[sid], want, (last or {}).get("tries", 0) if last and last["on"] == want else 0)
                out[sid] = r
        return out

    def _send(self, sid: str, name: str, on: bool, tries: int) -> dict:
        err = ""
        try:
            if self._send_fn is None:
                raise RuntimeError("명령 통로가 없습니다")
            self._send_fn(name, on)
        except Exception as exc:  # noqa: BLE001
            err = f"명령을 보내지 못했습니다: {exc}"
            log.warning("전력 회로 %s %s 실패: %s", sid, "켜기" if on else "끄기", exc)
        else:
            log.info("전력 회로 %s → %s", sid, "ON" if on else "OFF")
        self.last[sid] = {"on": on, "at": time.time(), "tries": tries + 1, "ok": None if not err else False,
                          "error": err}
        return {"sent": not err, "on": on, "error": err}

    def start(self) -> None:
        if self._thread:
            return

        def loop() -> None:
            while True:
                try:
                    self.tick()
                except Exception:  # noqa: BLE001 — 제어 스레드가 죽으면 예약이 멈춘다
                    log.exception("전력 제어 판단 실패")
                time.sleep(TICK_S)

        self._thread = threading.Thread(target=loop, name="power-control", daemon=True)
        self._thread.start()


def mqtt_sender(mqtt_factory, base: str):
    """Zigbee2MQTT 로 켜기/끄기를 보내는 함수를 만든다."""
    def send(name: str, on: bool) -> None:
        with mqtt_factory() as m:
            m.publish(f"{base}/{name}/set", {"state": "ON" if on else "OFF"})
    return send
