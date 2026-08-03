"""라즈베리파이에 붙인 LCD에 측정값을 표시한다.

지원 화면
  none     — 화면 없음(기본)
  console  — 터미널 출력. 배선 전에 무엇이 표시될지 확인할 때 씀
  i2c_lcd  — I2C 문자 LCD (HD44780 + PCF8574 백팩). 1602(16x2)·2004(20x4)

I2C 문자 LCD 는 폰트가 ROM 에 고정돼 있어 **한글을 출력할 수 없다.**
그래서 라벨은 모두 영문 약자를 쓴다 (Temp, pH, DO, Sal).

외부 패키지를 쓰지 않는다. /dev/i2c-N 을 직접 열어 ioctl 로 주소를 잡는다.
장비에 python3-smbus 를 따로 깔지 않아도 동작한다.
"""

from __future__ import annotations

import fcntl
import logging
import os
import time

log = logging.getLogger("shrimp365.display")

I2C_SLAVE = 0x0703  # linux/i2c-dev.h


# ── 기본형 ────────────────────────────────────────────────────────────────────

class Display:
    """화면이 없을 때 쓰는 기본 구현. 모든 호출을 조용히 무시한다."""

    columns = 16
    rows = 2

    def show(self, lines: list[str]) -> None:
        pass

    def close(self) -> None:
        pass


class ConsoleDisplay(Display):
    """터미널에 LCD 흉내를 낸다. 배선 전 확인용."""

    def __init__(self, columns: int = 16, rows: int = 2):
        self.columns = columns
        self.rows = rows

    def show(self, lines: list[str]) -> None:
        border = "+" + "-" * self.columns + "+"
        print(border)
        for i in range(self.rows):
            text = lines[i] if i < len(lines) else ""
            print("|" + text[: self.columns].ljust(self.columns) + "|")
        print(border, flush=True)


# ── I2C 문자 LCD (HD44780 + PCF8574) ──────────────────────────────────────────

class CharLcdI2C(Display):
    """PCF8574 백팩이 달린 HD44780 계열 문자 LCD.

    백팩 핀 배치는 시중 모듈의 사실상 표준을 따른다.
      P0=RS  P1=RW  P2=EN  P3=백라이트  P4~P7=D4~D7
    """

    _RS = 0x01
    _EN = 0x04
    _BACKLIGHT = 0x08

    # 4줄 LCD 는 3·4번째 줄이 1·2번째 줄 뒤에 이어 붙는 구조라 주소가 튄다.
    _ROW_OFFSETS = (0x00, 0x40, 0x14, 0x54)

    def __init__(self, bus: int = 1, address: int = 0x27, columns: int = 16, rows: int = 2):
        self.columns = columns
        self.rows = rows
        self.address = address
        self._backlight = self._BACKLIGHT
        self._last: list[str] = []

        self._fd = os.open(f"/dev/i2c-{bus}", os.O_RDWR)
        fcntl.ioctl(self._fd, I2C_SLAVE, address)

        self._init_display()

    # -- 저수준 --

    def _raw(self, value: int) -> None:
        os.write(self._fd, bytes([value | self._backlight]))

    def _pulse(self, value: int) -> None:
        # EN 을 올렸다 내리는 순간 LCD 가 데이터를 읽는다.
        self._raw(value | self._EN)
        time.sleep(0.0005)
        self._raw(value & ~self._EN)
        time.sleep(0.0001)

    def _send(self, value: int, mode: int) -> None:
        """8비트 값을 상위·하위 4비트로 나눠 보낸다(4비트 모드)."""
        high = mode | (value & 0xF0)
        low = mode | ((value << 4) & 0xF0)
        for nibble in (high, low):
            self._raw(nibble)
            self._pulse(nibble)

    def _command(self, value: int) -> None:
        self._send(value, 0)

    def _init_display(self) -> None:
        time.sleep(0.05)  # 전원 안정 대기
        # 8비트 모드로 세 번 깨운 뒤 4비트 모드로 전환하는 표준 절차
        for _ in range(3):
            self._raw(0x30)
            self._pulse(0x30)
            time.sleep(0.005)
        self._raw(0x20)
        self._pulse(0x20)

        self._command(0x28)  # 4비트, 2줄, 5x8 폰트
        self._command(0x0C)  # 화면 켬, 커서 끔
        self._command(0x06)  # 커서 자동 오른쪽 이동
        self.clear()

    # -- 공개 --

    def clear(self) -> None:
        self._command(0x01)
        time.sleep(0.002)
        self._last = []

    def backlight(self, on: bool) -> None:
        self._backlight = self._BACKLIGHT if on else 0x00
        self._raw(0)

    def show(self, lines: list[str]) -> None:
        # 바뀐 줄만 다시 쓴다. 매번 전체를 지우면 눈에 띄게 깜빡인다.
        for row in range(self.rows):
            text = (lines[row] if row < len(lines) else "")[: self.columns].ljust(self.columns)
            if row < len(self._last) and self._last[row] == text:
                continue
            self._command(0x80 | self._ROW_OFFSETS[row])
            for char in text:
                # HD44780 폰트에 없는 문자는 물음표로 대체한다(깨진 기호 방지).
                code = ord(char)
                self._send(code if 0x20 <= code <= 0x7D else 0x3F, self._RS)
        self._last = [
            (lines[r] if r < len(lines) else "")[: self.columns].ljust(self.columns)
            for r in range(self.rows)
        ]

    def close(self) -> None:
        try:
            self.clear()
            self.backlight(False)
        except OSError:
            pass
        try:
            os.close(self._fd)
        except OSError:
            pass


# ── 화면 구성 ─────────────────────────────────────────────────────────────────

# LCD 폰트에 한글이 없으므로 영문 약자를 쓴다.
_LABELS = [
    ("temperature", "Temp", "C", 1),
    ("ph", "pH", "", 2),
    ("do_level", "DO", "mg/L", 2),
    ("salinity", "Sal", "ppt", 1),
]


def _fmt(label: str, value: float, unit: str, digits: int, width: int) -> str:
    """'Temp     28.4C' 처럼 라벨은 왼쪽, 값은 오른쪽에 붙인다."""
    right = f"{value:.{digits}f}{unit}"
    pad = width - len(label) - len(right)
    return label + " " * max(1, pad) + right


def compose(
    values: dict[str, float],
    columns: int,
    rows: int,
    page: int,
    status: str = "",
) -> list[str]:
    """측정값을 LCD 줄 목록으로 만든다.

    20x4 는 네 항목이 한 번에 들어가고, 16x2 는 두 개씩 나눠 번갈아 보여 준다.
    """
    available = [(key, label, unit, digits) for key, label, unit, digits in _LABELS if key in values]

    if not available:
        return ["Shrimp365".center(columns), "No sensor data"[:columns]]

    # 상태 줄은 자리가 남을 때만 넣는다. 다만 문제가 생겼을 때는 값 한 줄을
    # 밀어내고서라도 반드시 띄운다 — 현장에서는 "안 올라가고 있다"는 사실이
    # 측정값 하나보다 중요하다.
    is_problem = bool(status) and status.isupper()
    show_status = bool(status) and rows >= 2 and (len(available) < rows or is_problem)

    body_rows = rows - 1 if show_status else rows
    per_page = max(1, body_rows)
    pages = max(1, (len(available) + per_page - 1) // per_page)
    chunk = available[(page % pages) * per_page:][:per_page]

    lines = [
        _fmt(label, values[key], unit, digits, columns)
        for key, label, unit, digits in chunk
    ]

    if show_status:
        lines.append(status[:columns])

    return lines


def make_display(kind: str, **kwargs) -> Display:
    """설정값으로 화면 객체를 만든다. 실패해도 수집은 계속되어야 하므로
    예외 대신 화면 없음으로 되돌린다."""
    kind = (kind or "none").strip().lower()

    if kind in ("", "none", "off"):
        return Display()

    if kind == "console":
        return ConsoleDisplay(columns=kwargs.get("columns", 16), rows=kwargs.get("rows", 2))

    if kind in ("i2c_lcd", "lcd", "i2c"):
        try:
            return CharLcdI2C(
                bus=kwargs.get("bus", 1),
                address=kwargs.get("address", 0x27),
                columns=kwargs.get("columns", 16),
                rows=kwargs.get("rows", 2),
            )
        except (OSError, PermissionError) as exc:
            log.error(
                "LCD 초기화 실패 (%s). 화면 없이 계속합니다. "
                "i2cdetect -y 1 로 주소를 확인하고, 사용자가 i2c 그룹에 있는지 보세요.",
                exc,
            )
            return Display()

    log.warning("알 수 없는 화면 종류 '%s' — 화면 없이 진행합니다.", kind)
    return Display()
