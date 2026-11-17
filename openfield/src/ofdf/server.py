"""현장 화면 서버 — 화면 파일 + 승인·조회·설정·리포트.

전에는 ``python -m http.server`` 로 화면 파일만 내보냈다. 읽기만 하는 화면
(M1·M3)은 그것으로 충분했지만, 다음은 파일만으로 안 된다.

    M2  화면 안 승인·거부            POST /api/approvals
    M5  위험 사례 조회 · CSV 내보내기  GET  /api/cases · /api/export/*.csv
    M6  설정 편집                    GET·POST /api/settings
    M7  월간 리포트                  GET  /api/report

**판단 프로세스와 따로 돈다.** 판단이 죽어도 화면은 살아서 '멈췄다'고
알려야 하기 때문이다. 둘은 파일로만 이야기한다 — 이 서버는 판단 이력을
읽고 ``state/`` 에 설정·응답을 쓰며, 제어기는 그것을 매 주기 읽는다
(:mod:`ofdf.site`).

표준 라이브러리만 쓴다. 라즈베리파이에 웹 프레임워크를 더 깔지 않는다.

지키는 것
--------
* **포장 내부망 전용이다.** 공인 IP 로 포트를 열지 않는다.
* 쓰기 요청은 화면이 보낸 것만 받는다(``X-OFDF-Panel`` 머리말 + JSON). 농가가
  다른 웹사이트를 보는 동안 그 사이트가 몰래 승인을 누르는 것을 막는다.
  주소(Host)가 IP·localhost·``*.local`` 이 아닌 쓰기 요청도 받지 않는다 —
  바깥 도메인이 이 제어기의 주소로 바뀌어 들어오는 수법(DNS 리바인딩)을 막는다.
  다른 이름으로 들어와야 하면 ``OFDF_PANEL_HOSTS`` 에 쉼표로 적는다.
* 관리 번호를 다섯 번 틀리면 1분 동안 잠근다. 네 자리 번호를 순서대로
  넣어 보는 데 몇 초면 되기 때문이다.
* 무거운 조회(리포트·내보내기)는 한 번에 하나만 돌고, 기록을 한 줄씩 흘려
  읽는다. 일 년치를 통째로 올리면 메모리 상한에서 서비스가 죽는다.
* 설정 변경은 환경변수 ``OFDF_PANEL_PIN`` 이 있으면 그 번호를 요구한다.
  승인·거부는 번호를 묻지 않는다 — 서리가 오는 밤에 장갑 낀 손으로 번호를
  치게 할 수는 없고, 제어함 앞에 선 사람은 어차피 수동 스위치를 쥐고 있다.
* 설정값은 범위 안에서만 받는다(:data:`ofdf.site.BOUNDS`).
"""

from __future__ import annotations

import datetime
import hmac
import ipaddress
import json
import logging
import os
import re
import threading
import time
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ofdf import __version__
from ofdf import site as site_mod
from ofdf.action import cases as cases_mod
from ofdf.action.journal import Journal

LOG = logging.getLogger("ofdf.server")

#: 쓰기 요청 본문 상한. 설정값 몇 개와 조치 이름 하나가 전부다.
MAX_BODY_BYTES = 16 * 1024
#: 한 번에 조회·내보내기 할 수 있는 최대 기간(일)
MAX_RANGE_DAYS = 400
#: 화면이 쓰기 요청에 붙이는 머리말
PANEL_HEADER = "X-OFDF-Panel"

#: 관리 번호를 이만큼 틀리면 잠근다 / 잠그는 시간(초)
PIN_MAX_FAILURES = 5
PIN_LOCK_SECONDS = 60
#: 조회할 수 있는 해의 범위. 날짜 계산이 넘치지 않게 한다.
MIN_YEAR, MAX_YEAR = 2000, 2100

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _readable(cases: list[dict]) -> list[dict]:
    """사례의 판단근거·실측 이름을 화면에 쓰는 말로 바꾼다(t_air → 기온)."""
    from ofdf.upload import feature_label

    for case in cases:
        case["evidence"] = [
            {**item, "label": feature_label(str(item.get("feature", "")))}
            for item in case.get("evidence", [])
        ]
        case["inputs"] = {
            feature_label(str(key)): value for key, value in (case.get("inputs") or {}).items()
        }
    return cases


class PanelApi:
    """화면이 부르는 기능. HTTP 와 떼어 두어 시험하기 쉽게 한다."""

    def __init__(self, config, *, pin: str | None = None, allowed_hosts=None):
        self.config = config
        self.pin = pin or None
        self.journal = Journal(config.journal_path)
        self.allowed_hosts = frozenset(allowed_hosts or ())
        #: 무거운 조회는 한 번에 하나만. 스레드마다 한 달치를 쥐면 금방 넘친다.
        self.heavy = threading.Lock()
        self._pin_lock = threading.Lock()
        #: 설정은 읽고-고치고-쓴다. 두 화면이 동시에 저장하면 한쪽이 사라진다.
        self._write_lock = threading.Lock()
        self._pin_failures = 0
        self._pin_locked_until = 0.0

    def host_allowed(self, host_header: str | None) -> bool:
        """쓰기 요청의 주소(Host)가 이 제어기를 가리키는 것이 맞는가."""
        host = (host_header or "").strip().lower()
        if host.startswith("["):                       # [::1]:8080
            name = host[1:host.find("]")] if "]" in host else host
        else:
            name = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
        if not name:
            return False
        if name == "localhost" or name.endswith(".local") or name in self.allowed_hosts:
            return True
        try:
            ipaddress.ip_address(name)
        except ValueError:
            return False
        return True

    # ---- 읽기 ----------------------------------------------------------

    def status(self) -> dict:
        return {
            "ok": True, "version": __version__,
            "time": datetime.datetime.now().isoformat(timespec="seconds"),
            "pinRequired": self.pin is not None,
            "writable": self.config.state_dir is not None,
            "responseTtlHours": site_mod.RESPONSE_TTL_HOURS,
        }

    def _range(self, query: dict) -> tuple[str, str]:
        """조회 기간 ``(시작, 끝 다음날)``. 날짜는 ``YYYY-MM-DD``, 끝날을 포함한다."""
        today = datetime.date.today()
        raw_from = (query.get("from") or [""])[0]
        raw_to = (query.get("to") or [""])[0]
        try:
            end = datetime.date.fromisoformat(raw_to) if raw_to else today
            start = (datetime.date.fromisoformat(raw_from) if raw_from
                     else end - datetime.timedelta(days=29))
        except (ValueError, OverflowError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "날짜는 2026-11-01 과 같이 적습니다") from None
        if not (MIN_YEAR <= start.year <= MAX_YEAR and MIN_YEAR <= end.year <= MAX_YEAR):
            raise ApiError(HTTPStatus.BAD_REQUEST,
                           f"{MIN_YEAR}년부터 {MAX_YEAR}년 사이의 날짜만 조회할 수 있습니다")
        if (raw_from and not _DATE.match(raw_from)) or (raw_to and not _DATE.match(raw_to)):
            raise ApiError(HTTPStatus.BAD_REQUEST, "날짜는 2026-11-01 과 같이 적습니다")
        if start > end:
            raise ApiError(HTTPStatus.BAD_REQUEST, "시작일이 종료일보다 늦습니다")
        if (end - start).days > MAX_RANGE_DAYS:
            raise ApiError(HTTPStatus.BAD_REQUEST,
                           f"한 번에 {MAX_RANGE_DAYS}일까지 조회할 수 있습니다")
        return start.isoformat(), (end + datetime.timedelta(days=1)).isoformat()

    def _risk(self, query: dict) -> str | None:
        risk = (query.get("risk") or [""])[0]
        if risk and risk not in cases_mod.RISK_LABELS_KO:
            raise ApiError(HTTPStatus.BAD_REQUEST, "모르는 위험유형입니다")
        return risk or None

    def cases(self, query: dict) -> dict:
        start, end = self._range(query)
        risk = self._risk(query)
        count = 0

        def counted():
            nonlocal count
            for record in self.journal.iter_range(start, end):
                count += 1
                yield record

        with self.heavy:
            found = _readable(cases_mod.risk_cases(counted(), risk=risk))
        last_day = (datetime.date.fromisoformat(end) - datetime.timedelta(days=1)).isoformat()
        return {"from": start, "to": last_day, "records": count, "cases": found}

    def export(self, kind: str, query: dict):
        """CSV 줄을 하나씩 내는 것과 파일 이름. 본문을 통째로 만들지 않는다."""
        start, end = self._range(query)
        risk = self._risk(query)
        if kind not in ("cases", "judgements", "control"):
            raise ApiError(HTTPStatus.NOT_FOUND, "없는 내보내기 종류입니다")
        last_day = (datetime.date.fromisoformat(end) - datetime.timedelta(days=1)).isoformat()

        def lines():
            with self.heavy:
                records = self.journal.iter_range(start, end)
                if kind == "cases":
                    yield from cases_mod.cases_csv_lines(
                        cases_mod.risk_cases(records, risk=risk))
                elif kind == "judgements":
                    from ofdf.upload import feature_label
                    yield from cases_mod.judgements_csv_lines(records, label=feature_label)
                else:
                    yield from cases_mod.control_csv_lines(records)

        return lines(), f"ofdf_{kind}_{start}_{last_day}.csv"

    def report(self, query: dict) -> dict:
        raw = (query.get("month") or [""])[0]
        if raw:
            match = _MONTH.match(raw)
            if not match or not 1 <= int(match.group(2)) <= 12:
                raise ApiError(HTTPStatus.BAD_REQUEST, "달은 2026-11 과 같이 적습니다")
            year, month = int(match.group(1)), int(match.group(2))
            if not MIN_YEAR <= year <= MAX_YEAR:
                raise ApiError(HTTPStatus.BAD_REQUEST, "달은 2026-11 과 같이 적습니다")
        else:
            today = datetime.date.today()
            year, month = today.year, today.month
        start = f"{year:04d}-{month:02d}-01"
        end = f"{year + (month == 12):04d}-{month % 12 + 1:02d}-01"
        with self.heavy:
            summary = cases_mod.monthly_summary(
                self.journal.iter_range(start, end), year, month)
        _readable(summary["cases"])
        summary["station"] = self.config.station
        summary["generated"] = datetime.datetime.now().isoformat(timespec="seconds")
        return summary

    def settings(self) -> dict:
        base = self.config.base_settings()
        current = self.config.site_settings()
        return {
            "values": current.values(),
            "defaults": base.values(),
            "overridden": sorted(site_mod.read_overrides(self.config.state_dir)),
            "bounds": {
                key: {"min": low, "max": high, "unit": unit, "help": text}
                for key, (low, high, unit, text) in site_mod.BOUNDS.items()
            },
            "devices": list(site_mod.SELECTABLE_DEVICES),
            # 위험 판정 기준값은 모델을 학습할 때의 정답 기준이다. 화면에서
            # 바꿔도 학습된 모델의 판단이 달라지지 않으므로 보여 주기만 한다.
            "thresholds": self.config.thresholds or {},
            "log": site_mod.settings_log(self.config.state_dir),
            "pinRequired": self.pin is not None,
        }

    def approvals(self) -> dict:
        return {"responses": site_mod.active_responses(self.config.state_dir),
                "ttlHours": site_mod.RESPONSE_TTL_HOURS}

    # ---- 쓰기 ----------------------------------------------------------

    def _need_state(self) -> Path:
        if self.config.state_dir is None:
            raise ApiError(HTTPStatus.SERVICE_UNAVAILABLE,
                           "상태 디렉터리가 설정되지 않아 저장할 수 없습니다")
        return Path(self.config.state_dir)

    def _check_pin(self, supplied: str | None) -> None:
        if self.pin is None:
            return
        with self._pin_lock:
            wait = self._pin_locked_until - time.monotonic()
            if wait > 0:
                raise ApiError(HTTPStatus.TOO_MANY_REQUESTS,
                               f"관리 번호를 여러 번 틀렸습니다. {int(wait) + 1}초 뒤에 다시 해 주세요")
            if supplied and hmac.compare_digest(supplied.encode(), self.pin.encode()):
                self._pin_failures = 0
                return
            self._pin_failures += 1
            if self._pin_failures >= PIN_MAX_FAILURES:
                self._pin_failures = 0
                self._pin_locked_until = time.monotonic() + PIN_LOCK_SECONDS
                LOG.warning("관리 번호를 %d번 틀려 %d초 잠근다", PIN_MAX_FAILURES, PIN_LOCK_SECONDS)
        raise ApiError(HTTPStatus.FORBIDDEN, "관리 번호가 맞지 않습니다")

    def save_settings(self, payload: dict, *, pin: str | None, source: str) -> dict:
        self._check_pin(pin)
        state = self._need_state()
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "설정값이 올바르지 않습니다")
        base = self.config.base_settings()
        with self._write_lock:
            if payload.get("reset") is True:
                site_mod.reset_overrides(state, base, source=source)
                LOG.info("설정을 설정 파일 값으로 되돌렸다 (%s)", source)
            else:
                _, errors = site_mod.save_overrides(
                    state, base, payload.get("values"), source=source)
                if errors:
                    raise ApiError(HTTPStatus.BAD_REQUEST, " · ".join(errors))
                LOG.info("설정 변경 (%s): %s", source, sorted(payload.get("values") or {}))
        return self.settings()

    def respond(self, payload: dict) -> dict:
        state = self._need_state()
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "응답이 올바르지 않습니다")
        try:
            with self._write_lock:
                site_mod.record_response(
                    state, str(payload.get("id") or ""), str(payload.get("response") or ""))
        except ValueError as exc:
            raise ApiError(HTTPStatus.BAD_REQUEST, str(exc)) from None
        LOG.info("농가 응답: %s → %s", payload.get("id"), payload.get("response"))
        return self.approvals()


class PanelHandler(SimpleHTTPRequestHandler):
    """화면 파일은 그대로 내보내고 ``/api/`` 만 따로 처리한다."""

    server_version = f"ofdf-panel/{__version__}"
    #: 받다 만 채 멈춘 연결을 끊는 시간(초). 내보내기는 무거운 조회 잠금을 쥔 채
    #: 줄을 보내므로, 멈춘 휴대폰 하나가 리포트·조회를 모두 막지 못하게 한다.
    timeout = 30
    api: PanelApi                          # make_handler 가 채운다

    def log_message(self, fmt, *args):     # 표준 오류 대신 로거로
        LOG.debug("%s %s", self.address_string(), fmt % args)

    def end_headers(self):
        # 화면 데이터는 30초마다 갈린다. 낡은 값을 캐시에서 꺼내 보여 주면 안 된다.
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    # ---- 응답 도우미 ----

    def _send(self, status: HTTPStatus, body: bytes, content_type: str, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _fail(self, error: ApiError):
        self._json({"ok": False, "error": error.message}, error.status)

    # ---- 요청 ----

    def do_GET(self):                                      # noqa: N802
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        query = parse_qs(url.query)
        try:
            if url.path == "/api/status":
                self._json(self.api.status())
            elif url.path == "/api/cases":
                self._json(self.api.cases(query))
            elif url.path == "/api/report":
                self._json(self.api.report(query))
            elif url.path == "/api/settings":
                self._json(self.api.settings())
            elif url.path == "/api/approvals":
                self._json(self.api.approvals())
            elif url.path.startswith("/api/export/") and url.path.endswith(".csv"):
                kind = url.path[len("/api/export/"):-len(".csv")]
                lines, name = self.api.export(kind, query)
                # 길이를 미리 알 수 없으므로 연결을 닫는 것으로 끝을 알린다
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{name}"')
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    for line in lines:
                        self.wfile.write(line.encode("utf-8"))
                except (BrokenPipeError, ConnectionResetError):
                    pass                        # 받다가 창을 닫았다
                finally:
                    lines.close()               # 무거운 조회 잠금을 반드시 푼다
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "없는 주소입니다")
        except ApiError as error:
            self._fail(error)
        except Exception:                                  # noqa: BLE001
            LOG.exception("요청 처리 실패: %s", self.path)
            self._fail(ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "서버에서 오류가 났습니다"))

    def _read_json(self) -> dict:
        if self.headers.get(PANEL_HEADER) != "1":
            raise ApiError(HTTPStatus.FORBIDDEN, "화면에서 보낸 요청이 아닙니다")
        if not self.api.host_allowed(self.headers.get("Host")):
            raise ApiError(HTTPStatus.FORBIDDEN, "이 주소로는 설정·승인을 받을 수 없습니다")
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            raise ApiError(HTTPStatus.FORBIDDEN, "화면에서 보낸 요청이 아닙니다")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise ApiError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "JSON 으로 보내야 합니다")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY_BYTES:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "요청 크기가 올바르지 않습니다")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "JSON 을 읽지 못했습니다") from None

    def do_POST(self):                                     # noqa: N802
        url = urlparse(self.path)
        try:
            if url.path == "/api/approvals":
                self._json(self.api.respond(self._read_json()))
            elif url.path == "/api/settings":
                payload = self._read_json()
                self._json(self.api.save_settings(
                    payload, pin=self.headers.get("X-OFDF-Pin"),
                    source=self.client_address[0]))
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "없는 주소입니다")
        except ApiError as error:
            self._fail(error)
        except Exception:                                  # noqa: BLE001
            LOG.exception("요청 처리 실패: %s", self.path)
            self._fail(ApiError(HTTPStatus.INTERNAL_SERVER_ERROR, "서버에서 오류가 났습니다"))


def make_server(config, directory: str | Path, *, host: str = "127.0.0.1", port: int = 0,
                pin: str | None = None, allowed_hosts=None) -> ThreadingHTTPServer:
    """서버를 만든다(띄우지는 않는다). ``port=0`` 이면 빈 포트를 잡는다."""
    api = PanelApi(config, pin=pin, allowed_hosts=allowed_hosts)
    handler = type("BoundPanelHandler", (PanelHandler,), {"api": api})
    return ThreadingHTTPServer((host, port), partial(handler, directory=str(directory)))


def serve(config, directory: str | Path, *, host: str = "0.0.0.0", port: int = 8080) -> int:
    """화면 서버를 띄우고 멈출 때까지 돈다."""
    directory = Path(directory)
    if not directory.is_dir():
        LOG.error("화면 폴더가 없다: %s", directory)
        return 1
    pin = (os.environ.get("OFDF_PANEL_PIN") or "").strip() or None
    hosts = [h.strip().lower() for h in (os.environ.get("OFDF_PANEL_HOSTS") or "").split(",")
             if h.strip()]
    httpd = make_server(config, directory, host=host, port=port, pin=pin, allowed_hosts=hosts)
    LOG.info("현장 화면 http://%s:%d · 화면 %s · 이력 %s · 상태 %s · 설정 잠금 %s",
             host, httpd.server_address[1], directory, config.journal_path,
             config.state_dir, "켜짐" if pin else "꺼짐(OFDF_PANEL_PIN 없음)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0
