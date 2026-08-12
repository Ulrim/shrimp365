#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
시방서 본문용 개요도 생성기

    python3 docs/make-figures.py     # docs/figures/F-01.svg … F-08.svg

부록의 제작도면(A2·A3 원본)과 달리, 이 그림들은 **A4 본문 폭(178 mm)에 1:1 로
앉도록** 그립니다. 축소가 없으므로 글자가 3.2~4.4 mm 로 그대로 읽힙니다.
치수는 make-drawings.py 의 PARAMS 를 그대로 읽어 쓰므로 도면과 어긋나지 않습니다.
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENC = os.path.join(ROOT, "raspberry-pi", "enclosure")
OUT = os.path.join(ROOT, "docs", "figures")
sys.path.insert(0, ENC)

import importlib.util
_spec = importlib.util.spec_from_file_location("mkdwg", os.path.join(ENC, "make-drawings.py"))
_m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m)
P = _m.P

W = 178.0                      # A4 본문 폭

NAVY = "#12395e"
LIGHT = "#e8eef5"
GREY = "#f4f6f8"
LINE = "#8a97a5"
RED = "#b32020"
REDBG = "#fdf1f1"
GREEN = "#1c5c1c"
GREENBG = "#e4f0e4"
AMBER = "#8a5a00"
AMBERBG = "#fdf3e0"
INK = "#1a1a1a"


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


class Fig:
    """좌표 원점은 좌상단, Y 는 아래로 증가. 단위 mm."""

    def __init__(self, h, w=W):
        self.w, self.h = w, h
        self.b = []

    # ── 기본 도형 ──
    def rect(self, x, y, w, h, fill="none", stroke=LINE, sw=0.3, r=1.2, dash=None):
        d = ' stroke-dasharray="%s"' % dash if dash else ""
        self.b.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" '
                      'fill="%s" stroke="%s" stroke-width="%.2f"%s/>'
                      % (x, y, w, h, r, fill, stroke, sw, d))

    def circle(self, x, y, r, fill="none", stroke=LINE, sw=0.3):
        self.b.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s" stroke="%s" '
                      'stroke-width="%.2f"/>' % (x, y, r, fill, stroke, sw))

    def line(self, x1, y1, x2, y2, stroke=LINE, sw=0.3, dash=None):
        d = ' stroke-dasharray="%s"' % dash if dash else ""
        self.b.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" '
                      'stroke-width="%.2f"%s/>' % (x1, y1, x2, y2, stroke, sw, d))

    def text(self, x, y, s, size=3.4, anchor="middle", fill=INK, weight="normal",
             family="sans-serif"):
        self.b.append('<text x="%.2f" y="%.2f" font-family="%s" font-size="%.2f" '
                      'text-anchor="%s" fill="%s" font-weight="%s">%s</text>'
                      % (x, y, family, size, anchor, fill, weight, esc(s)))

    # ── 조합 도형 ──
    def box(self, x, y, w, h, title, lines=(), fill=LIGHT, stroke=NAVY, sw=0.4,
            tsize=3.8, lsize=3.1, tcol=NAVY):
        """제목 + 여러 줄 설명이 든 상자. 세로 가운데 정렬."""
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=sw)
        n = 1 + len(lines)
        gap = 4.6
        top = y + h / 2 - (n - 1) * gap / 2 + tsize * 0.36
        self.text(x + w / 2, top, title, tsize, weight="bold", fill=tcol)
        for i, ln in enumerate(lines):
            self.text(x + w / 2, top + (i + 1) * gap, ln, lsize, fill="#3c4753")

    def arrow(self, x1, y1, x2, y2, label=None, stroke=NAVY, sw=0.5, dash=None,
              lsize=2.9, lside=1, curve=False):
        self.line(x1, y1, x2, y2, stroke=stroke, sw=sw, dash=dash)
        import math
        a = math.atan2(y2 - y1, x2 - x1)
        L, Wd = 2.4, 1.1
        bx, by = x2 - L * math.cos(a), y2 - L * math.sin(a)
        self.b.append('<polygon points="%.2f,%.2f %.2f,%.2f %.2f,%.2f" fill="%s"/>'
                      % (x2, y2, bx - Wd * math.sin(a), by + Wd * math.cos(a),
                         bx + Wd * math.sin(a), by - Wd * math.cos(a), stroke))
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            if abs(y2 - y1) < abs(x2 - x1):        # 가로 화살표 → 위/아래에
                self.text(mx, my - 1.6 if lside > 0 else my + 3.6, label, lsize, fill="#4a5560")
            else:                                   # 세로 화살표 → 옆에
                self.text(mx + 2.2, my + 1.0, label, lsize, anchor="start", fill="#4a5560")

    def tag(self, x, y, s, bg=GREENBG, fg=GREEN, size=2.8):
        w = len(s) * size * 0.62 + 3.0
        self.rect(x, y - size * 0.85, w, size * 1.5, fill=bg, stroke="none", r=0.8)
        self.text(x + w / 2, y + size * 0.25, s, size, weight="bold", fill=fg)
        return w

    def caption(self, y, s, size=2.9):
        self.text(4, y, s, size, anchor="start", fill="#5a6672")

    def save(self, name):
        head = ('<svg xmlns="http://www.w3.org/2000/svg" width="%.1fmm" height="%.1fmm" '
                'viewBox="0 0 %.1f %.1f">' % (self.w, self.h, self.w, self.h))
        bg = '<rect width="%.1f" height="%.1f" fill="#ffffff"/>' % (self.w, self.h)
        path = os.path.join(OUT, name + ".svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(head + bg + "".join(self.b) + "</svg>\n")
        print("  " + name + ".svg")


# ══════════════════════════════════════════════════════════════════
#  F-01 시스템 구성도
# ══════════════════════════════════════════════════════════════════
def f01():
    g = Fig(84)
    g.text(0, 6, "", 3)
    # 구역 배경
    zones = [(2, 12, 40, "수 조"), (46, 12, 52, "현장 장치 (함체)"),
             (102, 12, 30, "통 신"), (136, 12, 40, "서버 · 사용자")]
    for zx, zy, zw, zt in zones:
        g.rect(zx, zy, zw, 60, fill=GREY, stroke="#dde3e9", sw=0.3, r=2)
        g.text(zx + zw / 2, zy - 2.0, zt, 3.4, weight="bold", fill=NAVY)

    # 센서 3
    for i, (nm, sub) in enumerate([("pH / ORP", "ID 1"), ("DO", "ID 3"), ("EC · 염분", "ID 4")]):
        g.box(6, 17 + i * 17, 32, 13, nm, [sub], fill="#ffffff", tsize=3.4, lsize=2.8)
    g.text(22, 79, "수중 침지 · 케이블 최대 50 m", 2.9, fill="#5a6672")

    # 현장 장치
    g.box(50, 17, 44, 14, "7\" 터치 디스플레이", ["800 × 480, 도어 장착"], tsize=3.5, lsize=2.8)
    g.box(50, 34, 44, 14, "라즈베리파이 4", ["수집 · 표시 · 전송"], tsize=3.5, lsize=2.8)
    g.box(50, 51, 44, 13, "SMPS 12 V 60 W", ["센서 전원"], fill=AMBERBG, stroke="#c99a3a",
          tsize=3.4, lsize=2.8, tcol=AMBER)
    g.text(72, 79, "IP66 함체 · 하면 커넥터 4개소", 2.9, fill="#5a6672")

    # 통신
    g.box(104, 27, 26, 14, "WiFi 공유기", ["현장 납품"], fill="#ffffff", tsize=3.3, lsize=2.8)
    g.text(117, 50, "인터넷", 3.2, fill="#5a6672")
    g.text(117, 55, "HTTPS", 3.2, fill="#5a6672")

    # 서버
    g.box(140, 17, 34, 14, "Next.js 서버", ["API · 웹"], tsize=3.4, lsize=2.8)
    g.box(140, 34, 34, 14, "Supabase", ["PostgreSQL"], tsize=3.4, lsize=2.8)
    g.box(140, 51, 34, 13, "사용자 브라우저", ["PC · 모바일"], fill="#ffffff", tsize=3.3, lsize=2.8)

    # 화살표
    for i in range(3):
        g.arrow(38, 23.5 + i * 17, 50, 30, stroke="#5a7a92", sw=0.4)
    g.text(44, 14.5, "RS485", 2.8, fill="#4a5560")
    g.arrow(72, 34, 72, 31, stroke=NAVY, sw=0.5)
    g.arrow(50, 57.5, 38, 57.5, stroke="#c99a3a", sw=0.5)
    g.text(44, 55.0, "12 V", 2.8, fill="#8a6a20")
    g.arrow(94, 34, 104, 34, stroke=NAVY, sw=0.5)
    g.arrow(130, 34, 140, 27, stroke=NAVY, sw=0.5)
    g.arrow(157, 31, 157, 34, stroke=NAVY, sw=0.5)
    g.arrow(157, 48, 157, 51, stroke=NAVY, sw=0.5)
    g.save("F-01")


# ══════════════════════════════════════════════════════════════════
#  F-02 함체 내외부 배치도
# ══════════════════════════════════════════════════════════════════
def f02():
    g = Fig(132)
    SC = 0.22                      # 도면 mm → 그림 mm (두 면을 A4 폭에 나란히)
    ew, eh = P["enc_w"] * SC, P["enc_h"] * SC

    # ── 왼쪽: 외부(도어) ──
    ox, oy = 15.0, 16.0
    g.text(ox + ew / 2, 10, "외부 — 도어 (사용자가 보는 면)", 3.6, weight="bold", fill=NAVY)
    g.rect(ox, oy, ew, eh, fill="#eef0f1", stroke=NAVY, sw=0.6, r=1.5)
    fw, fh = P["door_flat_w"] * SC, P["door_flat_h"] * SC
    g.rect(ox + (ew - fw) / 2, oy + (eh - fh) / 2, fw, fh, fill="none", stroke="#c3ccd6",
           sw=0.25, dash="2,1.5")
    dw, dh = P["win_w"] * SC, P["win_h"] * SC
    g.rect(ox + (ew - dw) / 2, oy + eh * 0.30, dw, dh, fill="#20262b", stroke="#000", sw=0.4)
    g.text(ox + ew / 2, oy + eh * 0.30 + dh / 2 + 1.2, "7\" 터치 LCD", 3.4,
           weight="bold", fill="#ffffff")
    g.text(ox + ew / 2, oy + eh * 0.30 - 1.6, "개구부 %g × %g" % (P["win_w"], P["win_h"]),
           2.9, fill="#5a6672")
    # 탬퍼 볼트
    for bx in (ox + 3, ox + ew - 3):
        for by in (oy + 4, oy + eh / 2, oy + eh - 4):
            g.circle(bx, by, 0.9, fill="#ffffff", stroke="#7a8894", sw=0.25)
    g.text(ox + ew / 2, oy + eh + 5, "탬퍼 볼트 6개소 · 도어 뒤에 파이 4 장착", 2.9, fill="#5a6672")

    # ── 오른쪽: 내부(백플레이트) ──
    ix = ox + ew + 16
    g.text(ix + ew / 2, 10, "내부 — 백플레이트 (도어를 연 모습)", 3.6, weight="bold", fill=NAVY)
    g.rect(ix, oy, ew, eh, fill="#f7f8f9", stroke=NAVY, sw=0.6, r=1.5)
    bw, bh = P["bp_w"] * SC, P["bp_h"] * SC
    bx0, by0 = ix + (ew - bw) / 2, oy + (eh - bh) / 2
    g.rect(bx0, by0, bw, bh, fill="#eceff2", stroke="#9aa6b2", sw=0.35)

    def bp(cx, cy, w, h, label, sub, fill, stroke, tcol):
        """백플레이트 좌표(중심 기준, Y 위쪽 +) → 그림 좌표"""
        x = bx0 + bw / 2 + (cx - w / 2) * SC
        y = by0 + bh / 2 - (cy + h / 2) * SC
        g.box(x, y, w * SC, h * SC, label, [sub], fill=fill, stroke=stroke, sw=0.4,
              tsize=3.2, lsize=2.7, tcol=tcol)

    bp(P["smps_cx"], P["smps_cy"], P["smps_w"], P["smps_h"], "SMPS",
       "12 V 60 W", AMBERBG, "#c99a3a", AMBER)
    ocx, ocy, od = P["outlet_cx"], P["outlet_cy"], P["outlet_d"]
    g.circle(bx0 + bw / 2 + ocx * SC, by0 + bh / 2 - ocy * SC, od / 2 * SC,
             fill=REDBG, stroke=RED, sw=0.4)
    g.text(bx0 + bw / 2 + ocx * SC, by0 + bh / 2 - ocy * SC - 0.4, "콘센트", 3.0,
           weight="bold", fill=RED)
    g.text(bx0 + bw / 2 + ocx * SC, by0 + bh / 2 - ocy * SC + 3.4, "1구 220 V", 2.6, fill=RED)
    tbx = bx0 + bw / 2 + (P["tb_cx"] - P["tb_w"] / 2) * SC
    tby = by0 + bh / 2 - (P["tb_cy"] + P["tb_h"] / 2) * SC
    tbw, tbh = P["tb_w"] * SC, P["tb_h"] * SC
    g.rect(tbx, tby, tbw, tbh, fill=LIGHT, stroke=NAVY, sw=0.4, r=0.8)
    for i in range(8):                                  # 8극 눈금
        g.line(tbx + tbw * (i + 1) / 8, tby, tbx + tbw * (i + 1) / 8, tby + tbh,
               stroke="#9aa6b2", sw=0.2)
    g.text(tbx + tbw / 2, tby + tbh + 4.0, "단자대 8P", 3.0, weight="bold", fill=NAVY)
    g.circle(bx0 + bw / 2 + P["gnd_x"] * SC, by0 + bh / 2 - P["gnd_y"] * SC, 1.6,
             fill=GREENBG, stroke=GREEN, sw=0.4)
    g.text(bx0 + bw / 2 + P["gnd_x"] * SC - 4.0, by0 + bh / 2 - P["gnd_y"] * SC + 1.0,
           "접지", 2.7, anchor="end", fill=GREEN, weight="bold")

    # ── 하면 커넥터 (두 그림 아래 공통) ──
    cy = oy + eh + 14
    g.text(W / 2, cy - 3, "하면 — 원형 타공 4개소 (그 밖의 면은 뚫지 않는다)", 3.5,
           weight="bold", fill=NAVY)
    bar_w = 130.0
    bx1 = (W - bar_w) / 2
    g.rect(bx1, cy, bar_w, 15, fill=GREY, stroke=NAVY, sw=0.4)
    holes = [(P["sensor_cx"] - P["sensor_pitch"], "pH", "A-coded"),
             (P["sensor_cx"], "DO", "A-coded"),
             (P["sensor_cx"] + P["sensor_pitch"], "EC", "A-coded"),
             (P["ac_x"], "AC 220 V", "S-coded")]
    for hx, nm, cod in holes:
        px = bx1 + bar_w / 2 + hx * (bar_w / P["enc_w"])
        col = RED if "AC" in nm else NAVY
        g.circle(px, cy + 7.5, 2.6, fill="#ffffff", stroke=col, sw=0.5)
        g.text(px, cy + 8.6, "Ø", 2.8, fill=col, weight="bold")
        g.text(px, cy + 20.0, nm, 3.2, weight="bold", fill=col)
        g.text(px, cy + 24.0, cod, 2.7, fill="#5a6672")
    g.text(W / 2, cy + 29.5,
           "AC 는 S-coded, 센서는 A-coded — 서로 결합되지 않는다. 예비 포트·통기 벤트 없음.",
           2.9, fill="#5a6672")
    g.save("F-02")


# ══════════════════════════════════════════════════════════════════
#  F-03 전원 계통 개요
# ══════════════════════════════════════════════════════════════════
def f03():
    g = Fig(86)
    y0 = 14
    g.box(3, y0, 26, 15, "AC 220 V", ["인입 커넥터"], fill=REDBG, stroke=RED, tcol=RED,
          tsize=3.5, lsize=2.8)
    g.box(35, y0, 22, 15, "F1 · SPD", ["2 A T / 275 V"], fill=REDBG, stroke=RED, tcol=RED,
          tsize=3.4, lsize=2.8)
    g.box(63, y0, 30, 15, "단자대 8P", ["L · N · PE"], fill=LIGHT, stroke=NAVY,
          tsize=3.5, lsize=2.8)
    g.arrow(29, y0 + 7.5, 35, y0 + 7.5)
    g.arrow(57, y0 + 7.5, 63, y0 + 7.5)

    # 두 갈래
    g.box(105, y0 - 9, 32, 15, "SMPS", ["220 V → 12 V 60 W"], fill=AMBERBG,
          stroke="#c99a3a", tcol=AMBER, tsize=3.5, lsize=2.8)
    g.box(105, y0 + 15, 32, 15, "콘센트 1구", ["220 V"], fill=REDBG, stroke=RED, tcol=RED,
          tsize=3.5, lsize=2.8)
    g.arrow(93, y0 + 7.5, 105, y0 - 1.5)
    g.arrow(93, y0 + 7.5, 105, y0 + 22.5)

    g.box(145, y0 - 9, 30, 15, "센서 3대", ["12 V · 약 0.1 A"], fill="#ffffff",
          tsize=3.4, lsize=2.8)
    g.box(145, y0 + 15, 30, 15, "파이 어댑터", ["5.1 V 3 A"], fill="#ffffff",
          tsize=3.4, lsize=2.8)
    g.arrow(137, y0 - 1.5, 145, y0 - 1.5)
    g.arrow(137, y0 + 22.5, 145, y0 + 22.5)

    g.box(145, y0 + 36, 30, 13, "파이 4 + LCD", ["약 10 W"], fill="#ffffff",
          tsize=3.3, lsize=2.7)
    g.arrow(160, y0 + 30, 160, y0 + 36)

    # 본딩 링크
    g.line(121, y0 + 6, 121, y0 + 15, stroke=GREEN, sw=0.6, dash="2,1.2")
    g.text(123, y0 + 11.5, "LK1  0 V 본딩", 3.0, anchor="start", fill=GREEN, weight="bold")

    g.rect(3, 70, 172, 13, fill=REDBG, stroke=RED, sw=0.4, r=1.2)
    g.text(6, 75.0, "★ SMPS 의 0 V 와 파이 어댑터 계통은 서로 절연된 별개 전원이다. LK1 로 묶지 않으면",
           3.0, anchor="start", fill=RED, weight="bold")
    g.text(6, 79.6, "   RS485 공통모드가 벗어나 통신이 간헐적으로 끊긴다 — 통전 검사로는 잡히지 않는다.",
           3.0, anchor="start", fill=RED)
    g.save("F-03")


# ══════════════════════════════════════════════════════════════════
#  F-04 센서 · RS485 계통 개요
# ══════════════════════════════════════════════════════════════════
def f04():
    g = Fig(80)
    g.box(3, 12, 34, 16, "라즈베리파이 4", ["USB"], tsize=3.5, lsize=2.8)
    g.box(43, 12, 34, 16, "USB-RS485", ["변환기"], tsize=3.5, lsize=2.8)
    g.arrow(37, 20, 43, 20)
    g.box(83, 12, 30, 16, "TVS · 단자대", ["6극 A / 7극 B"], tsize=3.4, lsize=2.7)
    g.arrow(77, 20, 83, 20)

    # 멀티드롭 버스
    bus_y1, bus_y2 = 42.0, 46.0
    g.line(98, 28, 98, bus_y1, stroke=NAVY, sw=0.5)
    g.line(20, bus_y1, 170, bus_y1, stroke=NAVY, sw=0.6)
    g.line(20, bus_y2, 170, bus_y2, stroke="#c99a3a", sw=0.6)
    g.text(174, bus_y1 + 1.0, "A", 3.2, anchor="start", weight="bold", fill=NAVY)
    g.text(174, bus_y2 + 1.0, "B", 3.2, anchor="start", weight="bold", fill=AMBER)
    g.line(102, 28, 102, bus_y2, stroke="#c99a3a", sw=0.5)

    for i, (nm, sid, x) in enumerate([("pH / ORP", "슬레이브 ID 1", 22),
                                      ("DO", "슬레이브 ID 3", 74),
                                      ("EC · 염분", "슬레이브 ID 4", 126)]):
        g.line(x + 16, bus_y1, x + 16, 56, stroke=NAVY, sw=0.4)
        g.line(x + 20, bus_y2, x + 20, 56, stroke="#c99a3a", sw=0.4)
        g.box(x, 56, 40, 15, nm, [sid], fill="#ffffff", tsize=3.4, lsize=2.8)

    g.text(3, 36, "멀티드롭 — 3대가 같은 2선에 병렬로 물린다", 3.1, anchor="start",
           fill="#4a5560")
    g.text(175, 76, "9600 8-N-1 · Modbus-RTU", 2.9, anchor="end", fill="#5a6672")
    g.text(3, 76, "종단저항 120 Ω 은 케이블 10 m 초과 시 단자대 6·7극에 부착", 2.9,
           anchor="start", fill="#5a6672")
    g.save("F-04")


# ══════════════════════════════════════════════════════════════════
#  F-05 데이터 흐름
# ══════════════════════════════════════════════════════════════════
def f05():
    g = Fig(76)
    steps = [("① 계측", ["주기마다 3대 폴링", "Modbus 레지스터"]),
             ("② 환산·검증", ["전도도 → 염분", "범위·급변 판정"]),
             ("③ 로컬 저장", ["SQLite 버퍼", "약 30일분"]),
             ("④ 전송", ["HTTPS POST", "기기 키 인증"]),
             ("⑤ 서버 저장", ["water_quality", "_readings"])]
    bw = 32.0
    gap = (W - 6 - bw * len(steps)) / (len(steps) - 1)
    for i, (t, ls) in enumerate(steps):
        x = 3 + i * (bw + gap)
        g.box(x, 14, bw, 20, t, ls, tsize=3.4, lsize=2.8)
        if i:
            g.arrow(x - gap, 24, x, 24)

    # 오프라인 경로
    g.rect(3, 42, W - 6, 15, fill=AMBERBG, stroke="#c99a3a", sw=0.4, r=1.2)
    g.text(6, 47.4, "통신 두절 시 — ③ 에 계속 쌓고 복구되면 오래된 것부터 순서대로 올린다.",
           3.0, anchor="start", fill=AMBER, weight="bold")
    g.text(6, 52.4, "현장 화면은 서버와 무관하게 계속 표시된다. 측정 시각은 기기 RTC 기준으로 기록한다.",
           3.0, anchor="start", fill=AMBER)

    g.rect(3, 60, W - 6, 12, fill=GREY, stroke="#dde3e9", sw=0.3, r=1.2)
    g.text(6, 65.0, "서버 저장 후 — 대시보드 · 그래프 · 임계값 알림 · 디지털 트윈이 같은 테이블을 읽는다.",
           3.0, anchor="start", fill="#4a5560")
    g.text(6, 69.6, "기기 등록은 현장 화면의 6자리 페어링 코드로 계정에 연결한다.",
           3.0, anchor="start", fill="#4a5560")
    g.save("F-05")


# ══════════════════════════════════════════════════════════════════
#  F-06 현장 화면 레이아웃
# ══════════════════════════════════════════════════════════════════
def f06():
    g = Fig(124)
    sw_, sh_ = 150.0, 150.0 * 480 / 800
    sx, sy = (W - sw_) / 2, 10.0
    g.rect(sx - 3, sy - 3, sw_ + 6, sh_ + 6, fill="#20262b", stroke="#000", sw=0.5, r=2)
    g.rect(sx, sy, sw_, sh_, fill="#ffffff", stroke="#000", sw=0.3, r=0.5)

    # 상단 바
    g.rect(sx, sy, sw_, 10, fill=NAVY, stroke="none", r=0.5)
    g.text(sx + 4, sy + 6.6, "수조 1  ·  실시간", 3.6, anchor="start", fill="#ffffff",
           weight="bold")
    g.text(sx + sw_ - 4, sy + 6.6, "WiFi ● 연결  14:32", 3.0, anchor="end", fill="#c9d6e4")

    # 값 카드 4
    cw = (sw_ - 10) / 4
    vals = [("수온", "27.4", "℃"), ("pH", "7.82", ""), ("DO", "6.1", "mg/L"),
            ("염분", "22.4", "ppt")]
    for i, (nm, v, u) in enumerate(vals):
        x = sx + 2 + i * (cw + 2)
        g.rect(x, sy + 13, cw, 26, fill=GREY, stroke="#dde3e9", sw=0.3, r=1)
        g.text(x + cw / 2, sy + 19, nm, 3.2, fill="#5a6672")
        g.text(x + cw / 2, sy + 29, v, 6.2, weight="bold", fill=NAVY)
        g.text(x + cw / 2, sy + 35, u, 2.9, fill="#5a6672")

    # 그래프 영역
    g.rect(sx + 2, sy + 41, sw_ - 4, 30, fill="#ffffff", stroke="#dde3e9", sw=0.3, r=1)
    pts = [(0, 20), (10, 14), (20, 17), (30, 8), (40, 11), (50, 5), (60, 9), (70, 6),
           (80, 11), (90, 4), (100, 8)]
    for k, col in enumerate([NAVY, "#c99a3a", "#2e7d32"]):
        d = " ".join("%s %.2f %.2f" % ("M" if i == 0 else "L",
                                       sx + 4 + p[0] * (sw_ - 8) / 100,
                                       sy + 47 + p[1] + k * 2.5)
                     for i, p in enumerate(pts))
        g.b.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.5"/>' % (d, col))
    g.text(sx + 5, sy + 45.5, "최근 6시간 — 수온 · pH · DO", 2.7, anchor="start", fill="#8a97a5")

    # 하단 버튼
    for i, nm in enumerate(["6시간", "12시간", "24시간", "일주일"]):
        x = sx + 2 + i * (cw + 2)
        g.rect(x, sy + 74, cw, 10, fill=LIGHT if i == 0 else "#ffffff",
               stroke="#c3ccd6", sw=0.3, r=1)
        g.text(x + cw / 2, sy + 80.6, nm, 3.2, fill=NAVY if i == 0 else "#5a6672")

    y = sy + sh_ + 14
    g.text(W / 2, y, "7인치 정전식 터치 800 × 480 · 도어에 고정 · 조작은 이 화면이 전부",
           3.1, fill="#4a5560")
    g.text(W / 2, y + 5.5,
           "임계값을 벗어난 값은 붉게 표시하고, 통신이 끊겨도 계측·표시는 계속된다.",
           3.1, fill="#4a5560")
    g.save("F-06")


# ══════════════════════════════════════════════════════════════════
#  F-07 웹 화면 구성
# ══════════════════════════════════════════════════════════════════
def f07():
    g = Fig(92)
    g.rect(3, 10, W - 6, 62, fill="#ffffff", stroke="#c3ccd6", sw=0.4, r=1.5)
    g.rect(3, 10, W - 6, 9, fill=NAVY, stroke="none", r=1.5)
    g.text(7, 16.2, "수질 모니터링", 3.6, anchor="start", fill="#ffffff", weight="bold")
    g.text(W - 7, 16.2, "양식장 ▾   계정", 3.0, anchor="end", fill="#c9d6e4")

    # 좌측 메뉴
    g.rect(3, 19, 34, 53, fill=GREY, stroke="none")
    for i, nm in enumerate(["대시보드", "수질 현황", "기록 입력", "그래프 · 이력",
                            "디지털 트윈", "알림", "리포트", "기기 관리"]):
        sel = (i == 0)
        if sel:
            g.rect(4, 21 + i * 6.2, 32, 5.4, fill=LIGHT, stroke="none", r=0.8)
        g.text(7, 25.0 + i * 6.2, nm, 3.0, anchor="start",
               fill=NAVY if sel else "#5a6672", weight="bold" if sel else "normal")

    # 카드 4
    cw = (W - 6 - 34 - 10) / 4
    for i, (nm, v) in enumerate([("수온", "27.4 ℃"), ("pH", "7.82"),
                                 ("DO", "6.1 mg/L"), ("염분", "22.4 ppt")]):
        x = 39 + i * (cw + 2)
        g.rect(x, 22, cw, 15, fill="#ffffff", stroke="#dde3e9", sw=0.3, r=1)
        g.text(x + cw / 2, 27.5, nm, 2.9, fill="#5a6672")
        g.text(x + cw / 2, 34, v, 4.2, weight="bold", fill=NAVY)

    # 그래프
    g.rect(39, 39, (W - 6 - 34 - 4) * 0.62, 31, fill="#ffffff", stroke="#dde3e9", sw=0.3, r=1)
    g.text(42, 44.5, "수온 · pH · DO · 염분 추이", 3.0, anchor="start", fill="#4a5560")
    gw = (W - 6 - 34 - 4) * 0.62
    for k, col in enumerate([NAVY, "#c99a3a", "#2e7d32"]):
        pts = [(0, 20 - k * 3), (14, 14 - k * 2), (28, 17 - k * 3), (42, 10 - k * 2),
               (56, 13 - k * 3), (70, 8 - k * 2), (84, 11 - k * 3), (100, 7 - k * 2)]
        d = " ".join("%s %.2f %.2f" % ("M" if i == 0 else "L",
                                       41 + p[0] * (gw - 4) / 100, 46 + p[1])
                     for i, p in enumerate(pts))
        g.b.append('<path d="%s" fill="none" stroke="%s" stroke-width="0.45"/>' % (d, col))

    # 디지털 트윈
    tx = 39 + gw + 2
    tw = W - 3 - tx - 3
    g.rect(tx, 39, tw, 31, fill="#f7f8f9", stroke="#dde3e9", sw=0.3, r=1)
    g.text(tx + tw / 2, 44.5, "디지털 트윈", 3.0, fill="#4a5560", weight="bold")
    for i in range(2):
        for j in range(2):
            g.rect(tx + 4 + j * (tw / 2 - 3), 47 + i * 10, tw / 2 - 7, 8,
                   fill=GREENBG if (i + j) % 3 else AMBERBG,
                   stroke="#b9c4cf", sw=0.3, r=0.8)
            g.text(tx + 4 + j * (tw / 2 - 3) + (tw / 2 - 7) / 2, 52.0 + i * 10,
                   "수조 %d" % (i * 2 + j + 1), 2.8, fill="#4a5560")
    g.text(tx + tw / 2, 68.6, "배치 · 색으로 상태 표시", 2.6, fill="#8a97a5")

    g.text(3, 79, "구현 — 대시보드 · 수질 현황 · 기록 입력 · 그래프 · 알림 · 리포트 · 기기 관리",
           3.1, anchor="start", fill=GREEN, weight="bold")
    g.text(3, 84.5, "예정 — 디지털 트윈 (양식장·수조 배치도 위에 실시간 값을 겹쳐 표시)",
           3.1, anchor="start", fill=AMBER, weight="bold")
    g.save("F-07")


# ══════════════════════════════════════════════════════════════════
#  F-08 설치 개요
# ══════════════════════════════════════════════════════════════════
def f08():
    g = Fig(96)
    # 벽
    g.rect(8, 10, 8, 76, fill="#eceff2", stroke="#9aa6b2", sw=0.35)
    g.text(12, 90, "벽", 3.0, fill="#5a6672")

    # 함체
    ex, ey, ew, eh = 16, 20, 34, 34
    g.rect(ex, ey, ew, eh, fill="#f7f8f9", stroke=NAVY, sw=0.6, r=1.5)
    g.rect(ex + 4, ey + 8, ew - 8, 14, fill="#20262b", stroke="#000", sw=0.3)
    g.text(ex + ew / 2, ey + 16.5, "LCD", 3.0, fill="#ffffff", weight="bold")
    g.text(ex + ew / 2, ey - 3, "현장 장치", 3.4, weight="bold", fill=NAVY)
    g.text(12, ey + eh + 12, "설치 높이", 2.8, fill="#5a6672")
    g.text(12, ey + eh + 16, "1.4~1.5 m", 2.8, fill="#5a6672")

    # 드립 루프
    g.b.append(('<path d="M %.1f %.1f C %.1f %.1f, %.1f %.1f, %.1f %.1f" fill="none" '
                'stroke="%s" stroke-width="0.6"/>')
               % (ex + 10, ey + eh, ex + 6, ey + eh + 16, ex + 26, ey + eh + 16,
                  ex + 24, ey + eh + 4, GREEN))
    g.text(ex + ew / 2 + 4, ey + eh + 20, "드립 루프", 2.9, fill=GREEN, weight="bold")

    # 수조
    tx, ty, tw2, th = 74, 34, 96, 46
    g.rect(tx, ty, tw2, th, fill="none", stroke="#5a6672", sw=0.6)
    g.rect(tx + 1, ty + 8, tw2 - 2, th - 9, fill="#dbe9f2", stroke="none")
    g.line(tx + 1, ty + 8, tx + tw2 - 1, ty + 8, stroke="#5a91b5", sw=0.4)
    g.text(tx + 2, ty + 5, "수조", 3.4, anchor="start", weight="bold", fill=NAVY)
    g.text(tx + tw2 - 3, ty + 6, "수면", 2.8, anchor="end", fill="#5a91b5")

    # 센서 3
    for i, nm in enumerate(["pH", "DO", "EC"]):
        px = tx + 20 + i * 28
        g.line(px, ty - 6, px, ty + 26, stroke="#5a6672", sw=0.5)
        g.rect(px - 2.2, ty + 20, 4.4, 12, fill="#8a97a5", stroke="#5a6672", sw=0.3, r=0.8)
        g.text(px, ty - 8, nm, 3.1, weight="bold", fill=NAVY)
    g.line(tx + 8, ty + 32, tx + tw2 - 8, ty + 32, stroke=RED, sw=0.4, dash="2,1.5")
    g.text(tx + tw2 - 8, ty + 36, "바닥에서 100 mm 이상 띄운다", 2.8, anchor="end", fill=RED)

    # 케이블
    g.b.append('<path d="M %.1f %.1f C %.1f %.1f, %.1f %.1f, %.1f %.1f" fill="none" '
               'stroke="#5a6672" stroke-width="0.5"/>'
               % (ex + 24, ey + eh + 4, 60, 78, 70, 22, tx + 20, ty - 6))
    g.text(62, 86, "센서 케이블 최대 50 m (0.5 ㎟ 이상 · 실드)", 2.9, anchor="start",
           fill="#5a6672")

    g.rect(3, 4, W - 6, 0.0)
    g.text(W / 2, 8, "설치 개요 — 직사광을 피하고, 하면이 아래를 향하는 수직 벽부",
           3.2, fill="#4a5560")
    g.save("F-08")


if __name__ == "__main__":
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    print("본문 개요도 생성")
    f01(); f02(); f03(); f04(); f05(); f06(); f07(); f08()
    print("완료 — %s" % OUT)
