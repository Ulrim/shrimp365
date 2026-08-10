"""라즈베리파이의 Wi‑Fi 를 화면에서 다루기 위한 얇은 껍데기.

수조 옆에 선 채로 터치스크린만 보고 공유기를 바꿔 붙일 수 있어야 한다.
지금까지는 SSH 로 들어가거나 `raspi-config` 를 열어야 했다.

라즈베리파이 OS(Bookworm 이후)는 NetworkManager 를 기본으로 쓰므로
`nmcli` 하나로 조회·검색·접속이 모두 된다. 여기서는 그 명령을 감싸
화면이 쓰기 좋은 형태(dict/list)로 돌려줄 뿐, 정책 판단은 하지 않는다.

권한: 이 프로그램은 시스템 서비스(shrimp365 사용자)로 돌아가고
`NoNewPrivileges=yes` 라 sudo 로 권한을 올릴 수 없다. 대신 polkit 규칙
(50-shrimp365-nm.rules)이 이 사용자에게 NetworkManager 제어를 허용한다.
규칙이 없으면 접속 시도에서 "권한 없음" 이 돌아오고, 화면이 그대로
사람에게 알린다 — 조회는 규칙 없이도 대개 된다.

명령은 전부 인자 배열로 넘긴다(shell 을 거치지 않는다). SSID·비밀번호에
공백이나 특수문자, 따옴표가 섞여도 주입이 되지 않는다.
"""

from __future__ import annotations

import logging
import subprocess

log = logging.getLogger("shrimp365.wifi")

# nmcli 가 매달리는 일을 두 겹으로 막는다. --wait 는 nmcli 자체의 상한이고,
# subprocess timeout 은 그마저 무시하고 멈춘 경우의 최후 보루다.
_QUICK = 12      # 조회·검색용
_CONNECT = 35    # 접속용 (--wait 30 보다 넉넉하게)


def _run(args: list[str], timeout: int, stdin: str | None = None) -> tuple[int, str, str]:
    """nmcli 를 부른다. 없으면(설치 안 됨) 코드 127 로 알린다.

    stdin 을 주면 그대로 표준입력으로 넣는다. 비밀번호를 argv 대신 stdin 으로
    넘기는 데 쓴다(아래 connect 주석 참고).
    """
    try:
        p = subprocess.run(
            ["nmcli", *args],
            capture_output=True, text=True, timeout=timeout, input=stdin,
        )
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "nmcli 없음"
    except subprocess.TimeoutExpired:
        return 124, "", "시간 초과"


def _split_terse(line: str) -> list[str]:
    r"""nmcli -t 한 줄을 필드로 나눈다.

    terse 모드는 필드 구분자로 ':' 를 쓰고, 값 안의 ':' 와 '\' 는
    각각 '\:' '\\' 로 이스케이프한다. SSID 에 콜론이 들어갈 수 있으므로
    이스케이프되지 않은 ':' 에서만 자른다.
    """
    fields, buf, i = [], [], 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            buf.append(line[i + 1])
            i += 2
        elif c == ":":
            fields.append("".join(buf))
            buf = []
            i += 1
        else:
            buf.append(c)
            i += 1
    fields.append("".join(buf))
    return fields


def _wifi_device() -> str | None:
    """무선 장치 이름(wlan0 등)을 찾는다. 없으면 None."""
    code, out, _ = _run(["-t", "-f", "DEVICE,TYPE", "device"], _QUICK)
    if code != 0:
        return None
    for line in out.splitlines():
        parts = _split_terse(line)
        if len(parts) >= 2 and parts[1] == "wifi":
            return parts[0]
    return None


def status() -> dict:
    """지금 붙어 있는 Wi‑Fi 와 무선 기능 on/off, IP 를 돌려준다."""
    dev = _wifi_device()
    if dev is None:
        # nmcli 자체가 없을 수도, 무선 장치가 없을 수도 있다.
        code, _, err = _run(["-v"], _QUICK)
        if code == 127:
            return {"available": False, "reason": "이 기기에서 Wi‑Fi 설정을 지원하지 않습니다."}
        return {"available": False, "reason": "무선 장치를 찾지 못했습니다."}

    radio_code, radio_out, _ = _run(["-t", "-f", "WIFI", "radio"], _QUICK)
    radio_on = radio_code == 0 and radio_out.strip().lower().endswith("enabled")

    ssid, ip = None, None
    code, out, _ = _run(
        ["-t", "-f", "GENERAL.CONNECTION,IP4.ADDRESS", "device", "show", dev], _QUICK)
    if code == 0:
        for line in out.splitlines():
            parts = _split_terse(line)
            if len(parts) < 2:
                continue
            field, value = parts[0], ":".join(parts[1:]) if len(parts) > 2 else parts[1]
            if field == "GENERAL.CONNECTION" and value and value != "--":
                ssid = value
            elif field.startswith("IP4.ADDRESS") and value and ip is None:
                ip = value.split("/")[0]

    return {
        "available": True,
        "device": dev,
        "radio": radio_on,
        "connected": bool(ssid),
        "ssid": ssid,
        "ip": ip,
    }


def _bars(signal: int) -> int:
    """신호 세기(0~100)를 막대 0~4 로 바꾼다. 잡히기만 하면 최소 1칸."""
    if signal <= 0:
        return 0
    return max(1, min(4, round(signal / 25)))


def scan(rescan: bool = True) -> dict:
    """주변 Wi‑Fi 목록. SSID 별로 가장 센 것 하나만 남긴다."""
    dev = _wifi_device()
    if dev is None:
        return {"available": False, "networks": []}

    if rescan:
        # 너무 자주 부르면 "이미 검색 중" 오류가 난다. 실패해도 그냥 목록을 읽는다.
        _run(["device", "wifi", "rescan"], _QUICK)

    code, out, err = _run(
        ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list"], _QUICK)
    if code != 0:
        return {"available": True, "networks": [], "error": (err.strip() or "검색 실패")}

    best: dict[str, dict] = {}
    for line in out.splitlines():
        parts = _split_terse(line)
        if len(parts) < 4:
            continue
        in_use = parts[0].strip() == "*"
        ssid = parts[1].strip()
        if not ssid:
            continue  # 숨김 SSID 는 목록에 이름이 없어 고를 수 없다.
        try:
            signal = int(parts[2])
        except ValueError:
            signal = 0
        security = parts[3].strip()
        prev = best.get(ssid)
        if prev is None or signal > prev["signal"]:
            best[ssid] = {
                "ssid": ssid,
                "signal": signal,
                "bars": _bars(signal),
                "secure": bool(security and security != "--"),
                "in_use": in_use,
            }

    networks = sorted(best.values(), key=lambda n: (not n["in_use"], -n["signal"]))
    return {"available": True, "networks": networks}


def _looks_like_missing_secret(err: str) -> bool:
    """비밀번호(시크릿)를 못 받아 실패한 것으로 보이는가."""
    lower = (err or "").lower()
    return any(s in lower for s in (
        "secrets were required", "802-11-wireless-security",
        "no key available", "no secrets", "password",
    ))


def connect(ssid: str, password: str = "") -> dict:
    """SSID 에 접속한다. 저장된 접속이 있으면 재사용, 없으면 새로 만든다."""
    ssid = (ssid or "").strip()
    if not ssid:
        return {"ok": False, "error": "네트워크를 골라 주세요."}

    dev = _wifi_device()
    if dev is None:
        return {"ok": False, "error": "무선 장치를 찾지 못했습니다."}

    base = ["--wait", "30", "device", "wifi", "connect", ssid, "ifname", dev]

    if password:
        # 비밀번호를 argv 에 싣지 않는다. /proc/<pid>/cmdline 은 기본적으로
        # world-readable 이라, argv 로 넘기면 접속 시도 동안(수십 초) 같은 기기의
        # 다른 로컬 사용자가 평문 비밀번호를 읽을 수 있다. 대신 --ask 로 켜고
        # 비밀번호를 stdin 으로 흘려 넣는다(argv 에는 남지 않는다).
        code, _, err = _run(["--ask", *base], _CONNECT, stdin=password + "\n")
        # 일부 nmcli 버전은 --ask 에서 stdin 을 못 읽어 비밀번호 단계에서 막힌다.
        # 그때만 예전 방식(argv)으로 한 번 더 시도한다 — 기능을 먼저 지킨다.
        if code != 0 and _looks_like_missing_secret(err):
            code, _, err = _run([*base, "password", password], _CONNECT)
    else:
        code, _, err = _run(base, _CONNECT)

    if code == 0:
        log.info("Wi‑Fi 접속: %s", ssid)  # 비밀번호는 남기지 않는다.
        return {"ok": True}

    msg = (err or "").strip()
    lower = msg.lower()
    if code == 127:
        friendly = "이 기기에서 Wi‑Fi 설정을 지원하지 않습니다."
    elif code == 124:
        friendly = "응답이 없습니다. 신호가 약하거나 공유기가 멀 수 있습니다."
    elif "not authorized" in lower or "권한" in msg or "permission" in lower:
        friendly = "권한이 없어 바꾸지 못했습니다. 설치 시 네트워크 권한 설정을 확인하세요."
    elif _looks_like_missing_secret(msg):
        friendly = "비밀번호가 맞지 않는 것 같습니다."
    elif "no network with ssid" in lower or "no suitable" in lower:
        friendly = "그 네트워크를 찾지 못했습니다. 다시 검색해 주세요."
    else:
        friendly = msg or "접속하지 못했습니다."
    log.warning("Wi‑Fi 접속 실패(%s): %s", ssid, msg or code)
    return {"ok": False, "error": friendly}
