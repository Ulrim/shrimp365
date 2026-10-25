"""웹에서 전력 회로 켜고 끄기·예약 — 서버 명령함을 15초마다 묻는다.

웹은 장비에 직접 닿지 못한다(장비는 농장 공유기 뒤에 있다). 그래서 장비가 묻는다::

    POST /api/sensors/power   (X-Device-Key)
      보냄  {"control": power_control 의 snapshot(바뀌었을 때·1분마다), "results": [{"id", "ok", "error"}]}
      받음  {"commands": [{"id", "circuit", "action": "set"|"auto"|"rule", "on", "minutes", "rule"}]}

명령은 장비 화면의 단추와 같은 입구(PowerControl.command)로 실행한다 — 인입 회로 금지, 과열 중 켜기 금지,
산소 부족 강제 켜기 같은 안전 규칙이 웹 명령에도 그대로 걸린다. 예약은 장비가 지키므로 인터넷이
끊겨도 돈다. 서버는 2분 안에 가져가지 않은 명령을 버린다(늦은 '켜기' 가 엉뚱한 때 실행되지 않게).

서버가 이 경로를 모르거나(옛 서버) 표가 없으면(power_remote.sql 전) 5분에 한 번만 다시 묻는다.
[power] remote = false 로 끈다.
"""

from __future__ import annotations

import json
import logging
import threading
import time

log = logging.getLogger("shrimp365.power_remote")

POLL_S = 15          # 평소 묻는 간격
HEARTBEAT_S = 60     # 제어 상태가 그대로여도 이만큼마다 올린다 — 웹이 '장비 연결됨' 을 판정한다
IDLE_S = 300         # 서버가 준비되지 않았거나 키가 없을 때
MAX_RESULTS = 20


def _same(a: dict, b: dict | None) -> bool:
    """'지금 시각' 은 매분 바뀌므로 빼고 비교한다."""
    if b is None:
        return False
    strip = lambda s: {k: v for k, v in s.items() if k != "now"}  # noqa: E731
    return json.dumps(strip(a), sort_keys=True, default=str) == json.dumps(strip(b), sort_keys=True, default=str)


class RemotePower:
    def __init__(self, pctl, url_fn, key_fn, request, *, poll_s: float = POLL_S) -> None:
        """request(url, key, payload) → (HTTP 상태, JSON dict). 회선 문제면 (0, {})."""
        self.pctl = pctl
        self.url_fn = url_fn
        self.key_fn = key_fn
        self.request = request
        self.poll_s = poll_s
        self.results: list[dict] = []
        self._sent: dict | None = None
        self._sent_at = 0.0
        self._warned = False
        self._thread: threading.Thread | None = None

    def once(self) -> float:
        """한 번 묻고 받은 명령을 실행한다. 다음에 물을 때까지 기다릴 초를 돌려준다."""
        key = self.key_fn()
        if not key:
            return IDLE_S
        snap = self.pctl.snapshot()
        payload: dict = {"results": self.results[:MAX_RESULTS]}
        send_ctl = not _same(snap, self._sent) or time.monotonic() - self._sent_at >= HEARTBEAT_S
        if send_ctl:
            payload["control"] = snap
        status, data = self.request(self.url_fn(), key, payload)
        if status == 0:
            return self.poll_s                       # 인터넷이 잠시 끊겼다 — 결과는 들고 있다가 다음에
        if status in (401, 404, 405) or data.get("disabled"):
            if not self._warned:
                log.info("웹 원격 제어를 쓸 수 없습니다(HTTP %s%s) — 5분 뒤 다시 묻습니다", status,
                         ", 서버에 power_remote.sql 필요" if data.get("disabled") else "")
                self._warned = True
            return IDLE_S
        if not 200 <= status < 300:
            return self.poll_s * 2
        self._warned = False
        self.results = self.results[len(payload["results"]):]
        if send_ctl:
            self._sent, self._sent_at = snap, time.monotonic()
        cmds = data.get("commands")
        if not isinstance(cmds, list) or not cmds:
            return self.poll_s
        for cmd in cmds[:10]:
            if not isinstance(cmd, dict) or not isinstance(cmd.get("id"), str):
                continue
            try:
                r = self.pctl.command(cmd.get("circuit"), cmd.get("action"), cmd)
            except Exception as exc:  # noqa: BLE001 — 명령 하나가 원격 제어 전체를 멈추면 안 된다
                log.exception("웹 명령 실행 실패: %s", cmd)
                r = {"ok": False, "error": f"장비 내부 오류: {type(exc).__name__}"}
            ok = bool(r.get("ok")) and not r.get("error")
            log.info("웹에서 전력 회로 %s %s → %s", cmd.get("circuit"), cmd.get("action"),
                     "실행" if ok else r.get("error"))
            self.results.append({"id": cmd["id"], "ok": ok, "error": str(r.get("error") or "")[:200]})
        self.results = self.results[-MAX_RESULTS:]
        return 1.0                                   # 결과와 새 상태를 바로 알린다(웹이 기다린다)

    def start(self) -> None:
        if self._thread:
            return

        def loop() -> None:
            while True:
                try:
                    wait = self.once()
                except Exception:  # noqa: BLE001 — 이 스레드가 죽으면 웹 단추가 영영 안 듣는다
                    log.exception("웹 원격 제어 확인 실패")
                    wait = self.poll_s
                time.sleep(wait)

        self._thread = threading.Thread(target=loop, name="power-remote", daemon=True)
        self._thread.start()
