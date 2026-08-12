#!/usr/bin/env python3
"""
내부 배선도 생성기 — 수질 모니터링 장비 함체

    python3 make-wiring.py

산출물 (A3 가로, svg/)
    W-01  전원 계통도       AC → 단자대 → SMPS 12V / 콘센트 1구
    W-02  RS485 · 센서 계통도
    W-03  접지 · 본딩 계통도
    W-04  단자대 8P 배치·결선도

결선표와 전선 규격은 WIRING.md 에 있습니다. 이 도면은 계통을 보는 용도이고,
실제로 배선할 때 손에 드는 것은 WIRING.md 의 결선표입니다.
"""

import os

OUT = os.path.dirname(os.path.abspath(__file__))
SW, SH = 420.0, 297.0            # A3 가로

# 회로별 색 — 전 도면에서 같은 뜻으로 씁니다
CO = {
    "L":    "#8a4b1e",   # AC 활선 (갈색)
    "N":    "#2a5fa8",   # AC 중성 (파랑)
    "PE":   "#2f8f3f",   # 보호접지 (녹/황)
    "12":   "#c00000",   # +12V (빨강)
    "0P":   "#202020",   # 0V 센서계 (검정)
    "5":    "#e07a00",   # 파이 어댑터 계통 (주황)
    "0S":   "#8a8a8a",   # 파이 GND (회색)
    "A":    "#0a8a3a",   # RS485 A (초록)
    "B":    "#b89000",   # RS485 B (노랑)
    "ink":  "#202020",
    "note": "#0070a0",
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Sheet:
    def __init__(self):
        self.b = ['<rect x="0" y="0" width="%.0f" height="%.0f" fill="#ffffff"/>' % (SW, SH),
                  '<rect x="8" y="8" width="%.0f" height="%.0f" fill="none" stroke="#202020" '
                  'stroke-width="0.6"/>' % (SW - 16, SH - 16)]

    # ── 기본 도형 ──
    def box(self, x, y, w, h, title, sub=None, fill="#ffffff", stroke="#202020", lw=0.7, ts=4.0):
        self.b.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s" '
                      'stroke="%s" stroke-width="%.2f" rx="1.5"/>' % (x, y, w, h, fill, stroke, lw))
        if sub:
            lines = sub.split("\n")
            top = y + h/2 - 0.8 - 1.7 * (len(lines) - 1)
            self.txt(x + w/2, top, title, ts, "middle", weight="bold")
            for i, ln in enumerate(lines):
                self.txt(x + w/2, top + 4.6 + i * 3.9, ln, 3.0, "middle", color="#555")
        else:
            self.txt(x + w/2, y + h/2 + 1.4, title, ts, "middle", weight="bold")

    def txt(self, x, y, s, size=3.2, anchor="start", color=None, weight="normal", style=""):
        self.b.append('<text x="%.2f" y="%.2f" font-family="sans-serif" font-size="%.2f" '
                      'text-anchor="%s" fill="%s" font-weight="%s"%s>%s</text>'
                      % (x, y, size, anchor, color or CO["ink"], weight,
                         ' font-style="italic"' if style else "", esc(s)))

    def wire(self, pts, key="ink", w=1.0, dash=None, arrow=False):
        d = " ".join(("M" if i == 0 else "L") + " %.2f %.2f" % p for i, p in enumerate(pts))
        da = ' stroke-dasharray="%s"' % dash if dash else ""
        self.b.append('<path d="%s" fill="none" stroke="%s" stroke-width="%.2f" '
                      'stroke-linejoin="round" stroke-linecap="round"%s/>'
                      % (d, CO.get(key, key), w, da))
        if arrow:
            (x0, y0), (x1, y1) = pts[-2], pts[-1]
            dx, dy = x1 - x0, y1 - y0
            L = (dx*dx + dy*dy) ** 0.5 or 1
            ux, uy = dx / L, dy / L
            self.b.append('<polygon points="%.2f,%.2f %.2f,%.2f %.2f,%.2f" fill="%s"/>'
                          % (x1, y1, x1 - 2.6*ux - 1.0*uy, y1 - 2.6*uy + 1.0*ux,
                             x1 - 2.6*ux + 1.0*uy, y1 - 2.6*uy - 1.0*ux, CO.get(key, key)))

    def dot(self, x, y, key="ink", r=1.3):
        self.b.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>' % (x, y, r, CO.get(key, key)))

    def wlabel(self, x, y, s, key="ink", anchor="middle"):
        self.b.append('<rect x="%.2f" y="%.2f" width="%.2f" height="4.6" fill="#ffffff" '
                      'opacity="0.92"/>' % (x - len(s) * 1.05 - 1, y - 3.6, len(s) * 2.1 + 2))
        self.txt(x, y, s, 3.0, anchor, color=CO.get(key, key), weight="bold")

    # ── 마감 ──
    def finish(self, path, title, no, notes, legend=None):
        tw, th = 168.0, 30.0
        tx, ty = SW - 8 - tw, SH - 8 - th
        self.b.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#fff" '
                      'stroke="#202020" stroke-width="0.6"/>' % (tx, ty, tw, th))
        self.b.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#202020" '
                      'stroke-width="0.4"/>' % (tx, ty + 15, tx + tw, ty + 15))
        self.txt(tx + 3, ty + 10.5, title, 6.0, weight="bold")
        self.txt(tx + 3, ty + 24, "Shrimp365 수질 모니터링 장비 — 내부 배선", 3.6)
        self.txt(tx + tw - 3, ty + 24, "도번 %s   Rev.A" % no, 3.6, "end")

        y = 22.0
        self.txt(14, y, "주기", 4.6, weight="bold")
        n = 0
        for t in notes:
            y += 5.0
            if t.startswith(" "):
                self.txt(20, y, t.strip(), 3.3)
            else:
                n += 1
                self.txt(14, y, "%d." % n, 3.3)
                self.txt(20, y, t, 3.3)

        if legend:
            ly = SH - 14
            x = 14.0
            for lbl, key in legend:
                self.b.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" '
                              'stroke-width="1.4"/>' % (x, ly, x + 9, ly, CO[key]))
                self.txt(x + 11, ly + 1.2, lbl, 3.2)
                x += 15 + len(lbl) * 2.0

        with open(path, "w") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" width="%.0fmm" height="%.0fmm" '
                    'viewBox="0 0 %.0f %.0f">\n%s\n</svg>\n'
                    % (SW, SH, SW, SH, "\n".join(self.b)))
        print("  svg/%s" % os.path.basename(path))


# ══════════════════════════════════════════════════════════════════
#  단자대 8P — 전 도면 공용 정의
# ══════════════════════════════════════════════════════════════════
POLES = [("1", "L", "L"), ("2", "N", "N"), ("3", "PE", "PE"),
         ("4", "+12V", "12"), ("5", "0V", "0P"),
         ("6", "A", "A"), ("7", "B", "B"), ("8", "본딩", "0S")]
GROUPS = [(0, 2, "220V / 접지  3P"), (3, 4, "12V  2P"),
          (5, 6, "RS485  2P"), (7, 7, "본딩 1P")]


def draw_tb(s, x, y, w, h, show_groups=True):
    """단자대 8P 를 가로로 그리고, 각 극의 중심 x 좌표를 돌려줍니다."""
    cw = w / 8
    s.box(x, y, w, h, "", None, fill="#ffffff", lw=1.0)
    cx = []
    for i, (no, name, key) in enumerate(POLES):
        px = x + cw * i
        if i:
            s.wire([(px, y), (px, y + h)], "ink", 0.5)
        s.txt(px + cw/2, y + 10, no, 3.4, "middle", color="#888")
        s.txt(px + cw/2, y + 21, name, 4.4, "middle", color=CO[key], weight="bold")
        cx.append(px + cw/2)
    if show_groups:
        for a, b, label in GROUPS:
            gx0, gx1 = x + cw * a + 2, x + cw * (b + 1) - 2
            s.wire([(gx0, y - 5), (gx0, y - 8), (gx1, y - 8), (gx1, y - 5)], "ink", 0.8)
            s.txt((gx0 + gx1) / 2, y - 10.5, label, 3.2, "middle", weight="bold")
    return cx


# ══════════════════════════════════════════════════════════════════
#  W-01  전원 계통도
# ══════════════════════════════════════════════════════════════════
def w01():
    s = Sheet()
    TBX, TBY, TBW, TBH = 52.0, 182.0, 304.0, 28.0

    # AC 인입
    s.box(14, 96, 34, 44, "X1", "AC 인입\n방수 커넥터", fill="#f4f4f6")
    yL, yN, yPE = 106.0, 118.0, 132.0
    s.box(60, 100, 22, 13, "F1", "2A T", fill="#fff8f0")
    s.wire([(48, yL), (60, yL)], "L", 1.2)
    s.wire([(82, yL), (94, yL), (94, TBY)], "L", 1.2)
    s.wire([(48, yN), (106, yN), (106, TBY)], "N", 1.2)
    s.wire([(48, yPE), (118, yPE), (118, TBY)], "PE", 1.4)
    s.box(56, 128, 22, 16, "SPD", "275V", fill="#f0fff2")
    s.wire([(67, 128), (67, yL)], "L", 0.8); s.dot(67, yL, "L")
    s.wire([(67, 144), (67, 152), (118, 152)], "PE", 0.8); s.dot(118, 152, "PE")

    # 단자대
    cx = draw_tb(s, TBX, TBY, TBW, TBH)

    # SMPS · 콘센트 (단자대 위)
    s.box(150, 96, 78, 46, "SMPS", "220V → 12V\n60W  5A", fill="#f4f8ff")
    s.box(250, 96, 70, 46, "콘센트 1구", "220V 원형", fill="#f4f4f6")
    for bx_, k, xt in ((168, "L", cx[0]), (186, "N", cx[1]),
                       (268, "L", cx[0]), (286, "N", cx[1])):
        s.wire([(xt, TBY), (xt, 160), (bx_, 160), (bx_, 142)], k, 1.1)
    s.dot(cx[0], TBY, "L"); s.dot(cx[1], TBY, "N")

    # SMPS 12V 출력 → 퓨즈 · TVS → 단자대 4·5
    s.box(340, 100, 22, 13, "F2", "1A", fill="#fff8f0")
    s.box(340, 122, 22, 13, "TVS", "16V", fill="#fff8f0")
    s.wire([(228, 108), (340, 108)], "12", 1.2)
    s.wire([(228, 128), (340, 128)], "0P", 1.2)
    s.wire([(362, 108), (392, 108), (392, 166), (cx[3], 166), (cx[3], TBY)], "12", 1.2)
    s.wire([(362, 128), (380, 128), (380, 172), (cx[4], 172), (cx[4], TBY)], "0P", 1.2)

    # 콘센트 → 어댑터 → 파이 (도어)
    s.box(250, 40, 70, 18, "파이 전원 어댑터", None, fill="#f7f7f7")
    s.box(238, 12, 94, 22, "라즈베리파이 4 + 7\" LCD", "도어 (외부에서 보이는 면)",
          fill="#f0f4ff", stroke="#0070a0", lw=1.2)
    s.wire([(285, 96), (285, 58)], "5", 1.4, arrow=True)
    s.wire([(285, 40), (285, 34)], "5", 1.4, arrow=True)
    s.txt(326, 52, "220V 코드", 3.0, color="#666")

    # 단자대 아래 — 센서 3대
    for i, name in enumerate(("센서 1  pH", "센서 2  DO", "센서 3  EC")):
        bx_ = 92 + i * 74
        s.box(bx_, 234, 68, 24, name, "핀  1  3  2  4", fill="#f7f7f7", ts=3.6)
        for j, (k, dx) in enumerate((("12", 8), ("0P", 20), ("A", 32), ("B", 44))):
            s.wire([(cx[3 + j], TBY + TBH), (cx[3 + j], 214 + j * 5),
                    (bx_ + dx, 214 + j * 5), (bx_ + dx, 234)], k, 0.9)

    # 본딩
    s.wire([(cx[4], TBY + TBH), (cx[4], 216), (cx[7], 216), (cx[7], TBY + TBH)], "0S", 1.4)
    s.wire([(cx[7], TBY), (cx[7], 86), (396, 86), (396, 23), (332, 23)], "0S", 1.4, arrow=True)
    s.txt(300, 82, "★ 변환기 GND 본딩 (LK1)", 3.4, "end", color="#c00000", weight="bold")

    # 접지
    s.box(14, 234, 66, 24, "접지 스터드", "백플레이트", fill="#f0fff2", ts=3.6)
    s.wire([(cx[2], TBY + TBH), (cx[2], 236), (47, 236), (47, 234)], "PE", 1.4)

    s.finish(os.path.join(OUT, "svg", "W-01-power.svg"), "전원 계통도", "W-01", [
        "AC 220V 단상. 인입 → 단자대 8P → ① SMPS ② 콘센트 1구 두 갈래로 나뉜다.",
        "파이와 LCD 는 콘센트에 꽂은 자체 어댑터(5.1V 3A)로 급전한다.",
        "   함체 안에 DC-DC 를 두지 않는다.",
        "SMPS 12V 60W 는 센서 전용이다. 센서 3대 부하는 약 0.1A 로 정격의 2 % 다.",
        "   여유가 크므로 센서 증설이나 12V 부속 추가에 대비된다.",
        "F1 2A 슬로우블로우는 AC 전체를 보호한다. SPD 는 온도퓨즈 내장형만 쓴다.",
        "F2 1A 와 TVS 는 센서 라인 전용이다. 수십 미터 케이블이 사실상 안테나다.",
        "★ 본딩 — 파이 어댑터와 SMPS 는 서로 절연된 별개 전원이다. 변환기 GND 를",
        "   단자대 8극(본딩)을 거쳐 5극(0V)에 묶지 않으면 RS485 공통모드가 벗어나",
        "   간헐적 CRC 오류가 난다. 통전 검사로는 잡히지 않는다.",
        "콘센트에 꽂은 어댑터는 진동으로 빠진다. 케이블 타이나 브래킷으로 고정할 것.",
    ], [("AC L", "L"), ("AC N", "N"), ("PE", "PE"), ("+12V", "12"),
        ("0V", "0P"), ("어댑터", "5"), ("본딩", "0S")])


# ══════════════════════════════════════════════════════════════════
#  W-02  RS485 · 센서 계통도
# ══════════════════════════════════════════════════════════════════
def w02():
    s = Sheet()
    TBX, TBY, TBW, TBH = 52.0, 150.0, 304.0, 28.0

    s.box(30, 92, 76, 26, "라즈베리파이 4", "도어", fill="#f0f4ff",
          stroke="#0070a0", lw=1.2)
    s.box(126, 88, 62, 34, "USB-RS485", "변환기", fill="#f4f8ff")
    s.wire([(106, 105), (126, 105)], "0S", 1.2)
    s.txt(116, 101, "USB", 2.8, "middle", color="#666")

    s.box(210, 86, 28, 38, "TVS", "SM712", fill="#fff8f0")
    s.wire([(188, 96), (210, 96)], "A", 1.2); s.wlabel(199, 93, "A", "A")
    s.wire([(188, 114), (210, 114)], "B", 1.2); s.wlabel(199, 111, "B", "B")

    cx = draw_tb(s, TBX, TBY, TBW, TBH)
    s.wire([(238, 96), (270, 96), (270, 130), (cx[5], 130), (cx[5], TBY)], "A", 1.3)
    s.wire([(238, 114), (256, 114), (256, 136), (cx[6], 136), (cx[6], TBY)], "B", 1.3)
    s.wire([(157, 122), (157, 142), (cx[7], 142), (cx[7], TBY)], "0S", 1.4)
    s.txt(150, 138, "GND", 3.0, "end", color="#666")

    for i, (name, sid) in enumerate((("센서 1  pH", "ID 1"), ("센서 2  DO", "ID 3"),
                                     ("센서 3  EC", "ID 4"))):
        bx_ = 76 + i * 96
        s.box(bx_, 224, 76, 26, name, sid, fill="#f7f7f7")
        for j, k in enumerate(("12", "0P", "A", "B")):
            xt = cx[3 + j]
            s.wire([(xt, TBY + TBH), (xt, 200 + j * 5), (bx_ + 12 + j * 14, 200 + j * 5),
                    (bx_ + 12 + j * 14, 224)], k, 0.9)
        s.txt(bx_ + 38, 256, "1   3   2   4", 3.0, "middle", color="#666")

    s.txt(52, 270, "M12 A-coded 4핀   1 = +12V(빨강)   2 = A(초록)   3 = 0V(검정)   4 = B(노랑)",
          4.0, weight="bold")
    s.txt(52, 277, "핀 색은 Nengshi 센서 케이블 기준. 표준 M12 케이블(갈/백/청/흑)은 WIRING.md 대응표를 볼 것.",
          3.2, color="#555")
    s.txt(52, 286, "★ 변환기 GND → 단자대 8극 → 5극(0V) 본딩이 없으면 이 회로는 동작하지 않는다.",
          3.6, weight="bold", color="#c00000")

    s.finish(os.path.join(OUT, "svg", "W-02-rs485.svg"), "RS485 · 센서 계통도", "W-02", [
        "센서 3대가 같은 A/B 선에 병렬로 물린다. 슬레이브 ID 는 서로 달라야 한다.",
        "변환기는 파이 USB 로 급전되므로 그 GND 는 파이 어댑터 계통에 있고,",
        "   센서 0V 는 SMPS 계통에 있다. 두 계통은 단자대 8극 본딩으로만 만난다.",
        "TVS 는 변환기 바로 앞에 둔다.",
        "센서 케이블은 실드 트위스트 페어. A/B 를 같은 페어로 꼰다.",
        "실드는 함체측 0V(5극) 한쪽에만 접지한다. 센서측은 띄운다.",
        "종단저항 120Ω 은 케이블이 10m 를 넘을 때만 A–B 사이에 넣는다.",
        "RS485 배선은 AC·SMPS 배선에서 50 이상 띄우고, 교차할 때는 직각으로 지난다.",
    ], [("+12V", "12"), ("0V", "0P"), ("RS485 A", "A"), ("RS485 B", "B"), ("본딩", "0S")])


# ══════════════════════════════════════════════════════════════════
#  W-03  접지 · 본딩 계통도
# ══════════════════════════════════════════════════════════════════
def w03():
    s = Sheet()
    s.box(20, 96, 50, 22, "X1 PE 핀", "AC 인입", fill="#f0fff2")
    s.box(104, 96, 44, 22, "단자대 3극", "PE", fill="#f0fff2")
    s.box(182, 92, 58, 30, "접지 스터드", "M4 + 톱니와셔", fill="#f0fff2",
          stroke="#2f8f3f", lw=1.4)
    s.wire([(70, 107), (104, 107)], "PE", 1.6, arrow=True)
    s.wire([(148, 107), (182, 107)], "PE", 1.6, arrow=True)
    s.wlabel(165, 103, "1.5㎟ 녹/황", "PE")

    for i, (label, sub) in enumerate((("백플레이트", "알루미늄"),
                                      ("SMPS FG", "단자가 있으면"),
                                      ("콘센트 접지극", ""))):
        s.box(276, 82 + i * 28, 70, 22, label, sub or None, fill="#f7f7f7")
        s.wire([(240, 107), (258, 107), (258, 93 + i * 28), (276, 93 + i * 28)], "PE", 1.2)

    # 12V 계통
    s.box(104, 168, 44, 22, "단자대 5극", "0V", fill="#f7f7f7")
    s.box(276, 168, 70, 22, "센서 0V x3", None, fill="#f7f7f7")
    s.box(276, 198, 70, 22, "케이블 실드", "센서측 띄움", fill="#f7f7f7")
    s.wire([(148, 179), (276, 179)], "0P", 1.4)
    s.wire([(212, 179), (212, 209), (276, 209)], "0P", 1.0, dash="3,2")
    s.dot(212, 179, "0P")

    # 본딩
    s.box(104, 232, 44, 22, "단자대 8극", "본딩", fill="#fff0f0",
          stroke="#c00000", lw=1.6)
    s.wire([(126, 190), (126, 232)], "0P", 1.6)
    s.wlabel(126, 214, "5–8 점퍼", "0P")
    s.box(276, 232, 70, 22, "USB-RS485 GND", None, fill="#f7f7f7")
    s.box(276, 262, 70, 22, "파이 4 GND", "어댑터 계통", fill="#f0f4ff")
    s.wire([(148, 243), (276, 243)], "0S", 1.6, arrow=True)
    s.wire([(212, 243), (212, 273), (276, 273)], "0S", 1.2)
    s.dot(212, 243, "0S")

    # LK2
    s.box(20, 168, 60, 22, "LK2", "0V ↔ PE 선택", fill="#f0fff2",
          stroke="#2f8f3f", lw=1.2)
    s.wire([(80, 179), (104, 179)], "0P", 1.2)
    s.wire([(50, 168), (50, 107), (70, 107)], "PE", 1.2, dash="4,2")
    s.dot(70, 107, "PE")

    s.txt(20, 62, "파이 어댑터는 대개 2핀이라 접지가 없다. 파이 계통이 PE 와 만나는 곳은",
          4.0, weight="bold", color="#c00000")
    s.txt(20, 69, "이 본딩선 하나뿐이다.", 4.0, weight="bold", color="#c00000")

    s.finish(os.path.join(OUT, "svg", "W-03-ground.svg"), "접지 · 본딩 계통도", "W-03", [
        "PE 는 AC 인입에서 단자대 3극을 거쳐 접지 스터드 한 점에 모은다.",
        "백플레이트가 알루미늄이면 반드시 PE 에 본딩한다. 톱니와셔로 산화막을 관통시킬 것.",
        "콘센트의 접지극도 PE 에 문다. 어댑터가 3핀이면 이 경로로 파이 섀시가 접지된다.",
        "★ 5–8 점퍼와 변환기 GND 배선이 이 장비의 필수 본딩이다.",
        "   파이 어댑터와 SMPS 는 서로 절연된 별개 전원이라 이것 말고는 만나는 곳이 없다.",
        "   빠지면 RS485 공통모드가 벗어나 간헐적 CRC 오류가 난다.",
        "LK2 (0V ↔ PE) 는 선택이다. SELV 계통에 기준을 주고 서지를 PE 로 뺀다.",
        "   접지 루프가 의심되면 분리해 시험한다.",
        "케이블 실드는 함체측 0V 한쪽에만 붙인다.",
    ], [("PE", "PE"), ("0V", "0P"), ("본딩·파이 GND", "0S")])


# ══════════════════════════════════════════════════════════════════
#  W-04  단자대 8P 배치·결선도
# ══════════════════════════════════════════════════════════════════
def w04():
    s = Sheet()
    TBX, TBY, TBW, TBH = 40.0, 108.0, 340.0, 40.0
    cx = draw_tb(s, TBX, TBY, TBW, TBH)
    s.txt(TBX, TBY - 22, "단자대 8P (접지 포함) — 단단 8극", 5.4, weight="bold")

    rows = [
        ("1", "L", "AC 인입 L (F1 뒤)", "SMPS L · 콘센트 L", "0.75 갈색"),
        ("2", "N", "AC 인입 N", "SMPS N · 콘센트 N", "0.75 파랑"),
        ("3", "PE", "AC 인입 PE", "접지 스터드 · 콘센트 접지극", "1.5 녹/황"),
        ("4", "+12V", "SMPS +V (F2·TVS 뒤)", "센서 1·2·3 핀 1", "0.75 빨강"),
        ("5", "0V", "SMPS −V", "센서 1·2·3 핀 3 · 실드 · 8극", "0.75 검정"),
        ("6", "A", "USB-RS485 A (TVS 뒤)", "센서 1·2·3 핀 2", "0.5 초록"),
        ("7", "B", "USB-RS485 B (TVS 뒤)", "센서 1·2·3 핀 4", "0.5 노랑"),
        ("8", "본딩", "USB-RS485 GND", "5극 (점퍼)", "1.0 회색"),
    ]
    ty = 166.0
    hdr = [("극", 44), ("이름", 62), ("들어오는 것", 108), ("나가는 것", 216), ("전선", 324)]
    s.box(40, ty - 8, 340, 10 + len(rows) * 10, "", None, fill="#ffffff", lw=0.8)
    for lbl, x in hdr:
        s.txt(x, ty, lbl, 3.6, weight="bold")
    s.wire([(40, ty + 3), (380, ty + 3)], "ink", 0.6)
    for i, (no, name, frm, to, wire) in enumerate(rows):
        y = ty + 11 + i * 10
        key = POLES[i][2]
        s.txt(44, y, no, 3.4, weight="bold")
        s.txt(62, y, name, 3.4, color=CO[key], weight="bold")
        s.txt(108, y, frm, 3.3)
        s.txt(216, y, to, 3.3)
        s.txt(324, y, wire, 3.3)
        if i == 7:
            s.b.append('<rect x="40" y="%.1f" width="340" height="10" fill="#c00000" '
                       'opacity="0.07"/>' % (y - 7.5))

    s.txt(40, 268, "★ 8극(본딩)은 예비극이 아니다. 5극과 점퍼로 묶고 변환기 GND 를 여기에 문다.",
          4.0, weight="bold", color="#c00000")

    s.finish(os.path.join(OUT, "svg", "W-04-terminal.svg"), "단자대 8P 배치 · 결선도", "W-04", [
        "단단 8극. 220V/접지 3극 + 12V 2극 + RS485 2극 + 본딩 1극.",
        "220V 극과 저압 극이 한 단자대에 섞여 있다. 극 사이 절연 격벽이 있는 제품을 쓰고,",
        "   1~3극 위에 투명 절연 커버를 덮는다.",
        "3극(PE)에는 녹/황 전선만 쓰고 단자대에 별도 접지 표시를 붙인다.",
        "8극은 예비가 아니라 본딩 전용이다 — W-01·W-03 참조.",
        "   여기를 비워 두면 RS485 가 간헐적으로 끊긴다.",
        "센서 3대를 4·5·6·7극에 병렬로 문다. 극당 3가닥이므로 압착 단자로 정리한다.",
        "센서를 4대로 늘리려면 단자대를 10극으로 키우거나 분배 단자를 추가한다.",
    ], [("220V", "12"), ("PE", "PE"), ("12V", "12"), ("0V", "0P"),
        ("A", "A"), ("B", "B"), ("본딩", "0S")])


if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "svg"), exist_ok=True)
    print("내부 배선도 생성")
    w01(); w02(); w03(); w04()
    print("완료 — %s/svg" % OUT)
