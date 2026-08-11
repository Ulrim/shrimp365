#!/usr/bin/env python3
"""
내부 배선도 생성기 — 수질 모니터링 장비 함체

    python3 make-wiring.py

산출물 (A3 가로, svg/)
    W-01  전원 계통도
    W-02  RS485 · 센서 계통도
    W-03  접지 · 본딩 계통도
    W-04  단자대 배치·결선도

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
    "24":   "#c00000",   # +24V (빨강)
    "0P":   "#202020",   # 0V-P 센서계 (검정)
    "5":    "#e07a00",   # +5V (주황)
    "0S":   "#8a8a8a",   # 0V-S 파이계 (회색)
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
#  W-01  전원 계통도
# ══════════════════════════════════════════════════════════════════
def w01():
    s = Sheet()
    yL, yN, yPE = 108.0, 120.0, 146.0

    s.box(18, 98, 40, 40, "X1", "AC 인입\nM12 S-coded", fill="#f4f4f6")
    s.wire([(58, yL), (150, yL)], "L", 1.2)
    s.wire([(58, yN), (150, yN)], "N", 1.2)
    s.wire([(58, yPE), (120, yPE), (120, 238)], "PE", 1.4)
    s.wlabel(66, yL - 2.5, "L", "L"); s.wlabel(66, yN - 2.5, "N", "N")
    s.wlabel(66, yPE - 2.5, "PE", "PE")

    s.box(78, 101, 24, 14, "F1", "2A T", fill="#fff8f0")
    s.box(112, 112, 24, 16, "SPD", "275V", fill="#f0fff2")
    s.wire([(124, yL), (124, 112)], "L", 0.9); s.dot(124, yL, "L")
    s.wire([(124, 128), (124, yPE)], "PE", 0.9); s.dot(124, yPE, "PE")

    s.box(150, 96, 46, 44, "HDR-60-24", "AC → 24V\n2.5A  60W", fill="#f4f8ff")

    # 24V 계통
    s.wire([(196, 106), (206, 106)], "24", 1.2)
    s.box(206, 99, 22, 14, "F2", "1A", fill="#fff8f0")
    s.box(234, 99, 22, 14, "TVS1", "33V", fill="#fff8f0")
    s.wire([(228, 106), (234, 106)], "24", 1.2)
    s.wire([(256, 106), (400, 106)], "24", 1.7)
    s.wire([(196, 130), (400, 130)], "0P", 1.7)
    s.wlabel(340, 103, "+24V 레일", "24")
    s.wlabel(340, 127, "0V-P 레일", "0P")

    # 센서
    s.box(320, 150, 62, 20, "센서 M12 x4", "24V+ / 0V", fill="#f7f7f7")
    s.wire([(336, 106), (336, 150)], "24", 1.0); s.dot(336, 106, "24")
    s.wire([(364, 130), (364, 150)], "0P", 1.0); s.dot(364, 130, "0P")

    # DC-DC
    s.wire([(222, 106), (222, 176)], "24", 1.0); s.dot(222, 106, "24")
    s.wire([(250, 130), (250, 176)], "0P", 1.0); s.dot(250, 130, "0P")
    s.box(206, 176, 62, 34, "DDR-30G-5", "24V → 5.15V  6A\n입출력 절연 4000VDC",
          fill="#f4f8ff", stroke="#c00000", lw=1.2)

    # 5V 계통
    s.wire([(268, 186), (278, 186)], "5", 1.2)
    s.box(278, 179, 22, 14, "F3", "5A", fill="#fff8f0")
    s.wire([(300, 186), (400, 186)], "5", 1.7)
    s.wire([(268, 204), (400, 204)], "0S", 1.7)
    s.wlabel(356, 183, "+5V 레일", "5")
    s.wlabel(356, 201, "0V-S 레일", "0S")

    s.box(312, 222, 42, 18, "파이 4", "USB-C", fill="#f7f7f7")
    s.box(358, 222, 42, 18, "디스플레이", "5V/GND", fill="#f7f7f7")
    for x, y, k in ((326, 186, "5"), (372, 186, "5"), (340, 204, "0S"), (386, 204, "0S")):
        s.wire([(x, y), (x, 222)], k, 1.0); s.dot(x, y, k)

    # LK1 — 0V-P ↔ 0V-S (필수)
    s.box(282, 152, 34, 16, "LK1", "0V 본딩", fill="#fff0f0", stroke="#c00000", lw=1.5)
    s.wire([(299, 130), (299, 152)], "0P", 1.4); s.dot(299, 130, "0P")
    s.wire([(299, 168), (299, 204)], "0S", 1.4); s.dot(299, 204, "0S")

    # LK2 · 접지 스터드
    s.box(96, 238, 48, 16, "접지 스터드", "백플레이트", fill="#f0fff2")
    s.box(30, 238, 48, 16, "LK2", "0V-P ↔ PE", fill="#f0fff2", stroke="#2f8f3f", lw=1.2)
    s.wire([(78, 246), (96, 246)], "PE", 1.2)
    s.wire([(200, 130), (200, 222), (24, 222), (24, 246), (30, 246)], "0P", 1.0, dash="4,2")
    s.dot(200, 130, "0P")

    s.txt(24, 266, "LK1 이 빠지면 센서계와 파이계의 0V 가 서로 떠서 RS485 공통모드가 벗어난다.",
          3.6, weight="bold", color="#c00000")
    s.txt(24, 272, "간헐적 CRC 오류로만 나타나 출고 검사에서 잡히지 않는다. 반드시 도통을 확인할 것.",
          3.6, weight="bold", color="#c00000")

    s.finish(os.path.join(OUT, "svg", "W-01-power.svg"), "전원 계통도", "W-01", [
        "AC 220V 50/60Hz 단상 입력. 계통 단선도이며 배선 경로가 아니다.",
        "F1 2A 슬로우블로우 / F2 24V 1A / F3 5V 5A. SPD 는 온도퓨즈 내장형만 쓴다.",
        "DDR-30G-5 는 입출력이 4000VDC 절연이다. 0V-P 와 0V-S 는 서로 다른 노드이고,",
        "   LK1 을 넣지 않으면 두 계통이 떠 있게 된다.",
        "LK2 는 0V-P 를 PE 에 한 점에서 묶는다. 기본 장착이며 접지 루프가 의심되면 분리한다.",
        "벅 출력은 무부하에서 5.15V 로 조정한 뒤 파이를 연결한다.",
        "디스플레이 5V 는 파이 GPIO 가 아니라 5V 레일에서 직접 받는다 — 0.5A 를 파이",
        "   기판에 흘리지 않기 위해서다. 양쪽을 동시에 물리지 말 것.",
        "HDR-60-24 는 클래스 II 라 FG 단자가 없다. PE 는 SMPS 를 거치지 않는다.",
    ], [("AC L", "L"), ("AC N", "N"), ("PE", "PE"), ("+24V", "24"),
        ("0V-P", "0P"), ("+5V", "5"), ("0V-S", "0S")])


# ══════════════════════════════════════════════════════════════════
#  W-02  RS485 · 센서 계통도
# ══════════════════════════════════════════════════════════════════
def w02():
    s = Sheet()
    s.box(20, 92, 40, 24, "파이 4", "USB", fill="#f7f7f7")
    s.box(74, 88, 52, 32, "USB-RS485", "변환기", fill="#f4f8ff")
    s.wire([(60, 104), (74, 104)], "0S", 1.2)
    s.txt(67, 100, "USB", 2.8, "middle", color="#666")

    s.box(146, 84, 30, 40, "TVS", "SM712", fill="#fff8f0")
    s.wire([(126, 96), (146, 96)], "A", 1.2)
    s.wire([(126, 112), (146, 112)], "B", 1.2)
    s.wlabel(136, 93, "A", "A"); s.wlabel(136, 109, "B", "B")

    # A/B 레일
    s.wire([(176, 96), (388, 96)], "A", 1.6)
    s.wire([(176, 112), (388, 112)], "B", 1.6)
    s.wlabel(300, 93, "RS485 A 레일 (초록)", "A")
    s.wlabel(300, 109, "RS485 B 레일 (노랑)", "B")

    # 24V / 0V 레일
    s.wire([(176, 62), (388, 62)], "24", 1.4)
    s.wire([(176, 76), (388, 76)], "0P", 1.4)
    s.wlabel(300, 59, "+24V", "24"); s.wlabel(300, 73, "0V-P", "0P")

    sensors = [("X2  pH", "ID 1", 196), ("X3  DO", "ID 3", 246),
               ("X4  EC", "ID 4", 296), ("X5  예비", "종단", 346)]
    for name, sub, x in sensors:
        s.box(x - 22, 150, 44, 30, name, sub, fill="#f7f7f7")
        for yy, k in ((62, "24"), (76, "0P"), (96, "A"), (112, "B")):
            xx = x - 15 + {62: 0, 76: 10, 96: 20, 112: 30}[yy]
            s.wire([(xx, yy), (xx, 150)], k, 0.9)
            s.dot(xx, yy, k)
        s.txt(x, 190, "1 2 3 4", 3.0, "middle", color="#666")

    s.txt(196, 204, "M12 A-coded 4핀   1=+24V(빨강)  2=A(초록)  3=0V(검정)  4=B(노랑)",
          3.6, weight="bold")
    s.txt(196, 212, "핀 색은 Nengshi 센서 케이블 기준이다. 표준 M12 케이블(갈/백/청/흑)을 쓸 때는 WIRING.md 대응표를 볼 것.",
          3.2, color="#555")

    # 실드
    s.wire([(196, 180), (196, 232), (120, 232)], "PE", 1.0, dash="3,2")
    s.box(76, 226, 44, 12, "0V-P 단자", None, fill="#f7f7f7")
    s.txt(124, 229, "실드는 함체측 한쪽만 접지 — 양쪽 접지는 접지 루프", 3.2, color=CO["PE"])

    # 종단
    s.box(324, 226, 64, 14, "120Ω 더미 플러그", None, fill="#fff0f0", stroke="#c00000")
    s.wire([(356, 180), (356, 226)], "ink", 0.9, dash="3,2")

    s.finish(os.path.join(OUT, "svg", "W-02-rs485.svg"), "RS485 · 센서 계통도", "W-02", [
        "센서 4대가 같은 A/B 선에 병렬로 물린다. 슬레이브 ID 는 서로 달라야 한다.",
        "변환기의 GND 는 USB 를 통해 0V-S 에 있고, 센서 0V 는 0V-P 에 있다.",
        "   두 계통은 W-01 의 LK1 로 묶인다. LK1 이 없으면 이 회로는 동작하지 않는다.",
        "TVS 는 변환기 바로 앞에 둔다. 센서 케이블 수십 미터가 사실상 안테나다.",
        "센서 케이블은 실드 트위스트 페어. A/B 를 같은 페어로 꼰다.",
        "실드는 함체측 0V-P 한쪽에만 접지한다. 양쪽 접지는 접지 루프를 만든다.",
        "종단저항 120Ω 은 케이블이 10m 를 넘을 때만 예비 포트에 더미 플러그로 꽂는다.",
        "   함체를 열지 않고 넣고 뺄 수 있어야 하므로 내부 점퍼로 만들지 않는다.",
        "RS485 배선은 AC·SMPS 배선에서 50 이상 띄우고, 교차할 때는 직각으로 지난다.",
    ], [("+24V", "24"), ("0V-P", "0P"), ("RS485 A", "A"), ("RS485 B", "B"), ("실드/PE", "PE")])


# ══════════════════════════════════════════════════════════════════
#  W-03  접지 · 본딩 계통도
# ══════════════════════════════════════════════════════════════════
def w03():
    s = Sheet()
    yPE = 106.0

    s.box(24, 96, 46, 20, "X1 PE 핀", "M12 S-coded", fill="#f0fff2")
    s.box(150, 92, 58, 28, "접지 스터드", "M4 + 톱니와셔", fill="#f0fff2",
          stroke="#2f8f3f", lw=1.4)
    s.wire([(70, yPE), (150, yPE)], "PE", 1.8, arrow=True)
    s.wlabel(110, yPE - 3, "0.75㎟ 이상 녹/황", "PE")

    s.box(248, 96, 66, 20, "압착 프레임", "도어 · 미본딩", fill="#f7f7f7")
    s.txt(320, 108, "도어 스탠드오프로 절연되어 있고 활선부와 닿지", 3.2, color="#666")
    s.txt(320, 113, "않으므로 본딩하지 않는다.", 3.2, color="#666")

    s.box(150, 138, 58, 22, "백플레이트", "알루미늄", fill="#f7f7f7")
    s.wire([(179, 120), (179, 138)], "PE", 1.6, arrow=True)
    s.box(248, 138, 66, 22, "케이블 실드", "센서측은 띄움", fill="#f7f7f7")

    # LK2 : 0V-P ↔ PE
    s.box(100, 120, 48, 20, "LK2", "분리 가능", fill="#f0fff2", stroke="#2f8f3f", lw=1.2)
    s.wire([(124, 120), (124, yPE)], "PE", 1.2); s.dot(124, yPE, "PE")

    # 0V-P 계
    s.box(150, 170, 58, 22, "0V-P 레일", "센서 계", fill="#f7f7f7")
    s.wire([(124, 140), (124, 181), (150, 181)], "0P", 1.4)
    s.box(248, 170, 66, 22, "센서 0V x4", None, fill="#f7f7f7")
    s.wire([(208, 181), (248, 181)], "0P", 1.4)
    s.wire([(228, 181), (228, 149), (248, 149)], "0P", 1.0, dash="3,2")
    s.dot(228, 181, "0P")

    # LK1 : 0V-P ↔ 0V-S (필수)
    s.box(46, 192, 52, 22, "LK1", "필수", fill="#fff0f0", stroke="#c00000", lw=1.6)
    s.wire([(150, 181), (72, 181), (72, 192)], "0P", 1.4)
    s.wire([(72, 214), (72, 235), (150, 235)], "0S", 1.4)

    s.box(150, 224, 58, 22, "0V-S 레일", "파이 계", fill="#f7f7f7")
    s.box(248, 206, 66, 18, "파이 4 GND", None, fill="#f7f7f7")
    s.box(248, 232, 66, 18, "변환기 GND", None, fill="#f7f7f7")
    s.wire([(208, 235), (230, 235), (230, 215), (248, 215)], "0S", 1.2)
    s.wire([(230, 235), (230, 241), (248, 241)], "0S", 1.2)
    s.dot(230, 235, "0S")

    s.txt(24, 268, "본딩 확인 3항목 — ① X1 PE ↔ 백플레이트 < 0.1Ω   "
                   "② 0V-P ↔ 0V-S 도통 (LK1)   ③ 0V-P ↔ PE 도통 (LK2)",
          4.2, weight="bold", color="#c00000")

    s.finish(os.path.join(OUT, "svg", "W-03-ground.svg"), "접지 · 본딩 계통도", "W-03", [
        "PE 는 AC 커넥터에서 받아 백플레이트 접지 스터드 한 점에 모은다.",
        "   HDR-60-24 는 클래스 II 라 FG 단자가 없다. PE 는 SMPS 를 거치지 않는다.",
        "백플레이트가 알루미늄이므로 반드시 PE 에 본딩한다. 방열 경로이면서 금속",
        "   노출부이기도 하다. 톱니와셔로 도장·산화막을 관통시킬 것.",
        "LK1 (0V-P ↔ 0V-S) 은 필수다. DDR-30G-5 가 절연형이라 이것이 없으면 두 계통의",
        "   기준이 떠서 RS485 가 간헐적으로 끊긴다.",
        "LK2 (0V-P ↔ PE) 는 기본 장착이다. SELV 계통에 기준을 주고 서지를 PE 로 뺀다.",
        "   접지 루프가 의심되면 분리해 시험할 수 있다.",
        "케이블 실드는 함체측 0V-P 한쪽에만 붙인다. 센서측은 띄운다.",
    ], [("PE", "PE"), ("0V-P", "0P"), ("0V-S", "0S")])


# ══════════════════════════════════════════════════════════════════
#  W-04  단자대 배치·결선도
# ══════════════════════════════════════════════════════════════════
def w04():
    s = Sheet()
    x0, y0 = 40.0, 98.0
    pw, ph = 26.0, 26.0          # 위치 폭 / 단 높이

    groups = [
        (1, 4, "+24V", "24", ["HDR +24V", "F2 → TVS", "센서 1·2", "센서 3·4"]),
        (5, 8, "0V-P", "0P", ["HDR 0V", "DDR IN−", "센서 1·2", "센서 3·4 · 실드"]),
    ]
    tier2 = [
        (1, 4, "A", "A", ["변환기 A", "TVS A", "센서 1·2", "센서 3·4"]),
        (5, 8, "B", "B", ["변환기 B", "TVS B", "센서 1·2", "센서 3·4"]),
    ]
    # 상단(1층)
    for a, b, name, key, uses in groups:
        for i in range(a, b + 1):
            x = x0 + (i - 1) * pw
            s.box(x, y0, pw - 1.5, ph, str(i), None, fill="#ffffff", ts=3.6)
            s.txt(x + (pw - 1.5) / 2, y0 + 20, name, 3.0, "middle", color=CO[key], weight="bold")
        s.wire([(x0 + (a - 1) * pw + 4, y0 - 4), (x0 + (b - 1) * pw + pw - 5.5, y0 - 4)], key, 2.2)
        s.txt(x0 + (a - 1) * pw + 4, y0 - 7, "브리지", 2.8, color=CO[key])
    # 하단(2층)
    for a, b, name, key, uses in tier2:
        for i in range(a, b + 1):
            x = x0 + (i - 1) * pw
            s.box(x, y0 + ph + 2, pw - 1.5, ph, "", None, fill="#fafafa")
            s.txt(x + (pw - 1.5) / 2, y0 + ph + 18, name, 3.0, "middle",
                  color=CO[key], weight="bold")
        s.wire([(x0 + (a - 1) * pw + 4, y0 + 2*ph + 6), (x0 + (b - 1) * pw + pw - 5.5, y0 + 2*ph + 6)],
               key, 2.2)

    # 9·10 위치 — 5V 계
    for i, (t1, t2) in enumerate([("+5V", "0V-S"), ("+5V", "0V-S")]):
        x = x0 + (8 + i) * pw
        s.box(x, y0, pw - 1.5, ph, str(9 + i), None, fill="#ffffff", ts=3.6)
        s.txt(x + (pw - 1.5) / 2, y0 + 20, t1, 3.0, "middle", color=CO["5"], weight="bold")
        s.box(x, y0 + ph + 2, pw - 1.5, ph, "", None, fill="#fafafa")
        s.txt(x + (pw - 1.5) / 2, y0 + ph + 18, t2, 3.0, "middle", color=CO["0S"], weight="bold")
    s.wire([(x0 + 8 * pw + 4, y0 - 4), (x0 + 9 * pw + pw - 5.5, y0 - 4)], "5", 2.2)
    s.wire([(x0 + 8 * pw + 4, y0 + 2*ph + 6), (x0 + 9 * pw + pw - 5.5, y0 + 2*ph + 6)], "0S", 2.2)

    s.txt(x0, y0 - 16, "2단 단자대 10위치 = 20극   (1층 = 위, 2층 = 아래)", 4.4, weight="bold")
    s.txt(x0, y0 + 2*ph + 18, "← 센서·RS485 구역 (좌)                    AC 구역 (우) →",
          3.6, color="#666")

    # 링크 · 접지단자
    s.box(x0, 176, 74, 22, "LK1", "0V-P ↔ 0V-S  필수", fill="#fff0f0",
          stroke="#c00000", lw=1.4)
    s.box(x0 + 84, 176, 74, 22, "LK2", "0V-P ↔ PE  기본 장착", fill="#f0fff2",
          stroke="#2f8f3f", lw=1.2)
    s.box(x0 + 168, 176, 74, 22, "PE 접지단자", "레일 접지형", fill="#f0fff2")

    # 레일 배치
    ry = 220.0
    items = [("2단 단자대", 47), ("DDR-30G-5", 35), ("HDR-60-24", 52.5),
             ("퓨즈 x3", 52.5), ("SPD", 18), ("(예비 35)", 35)]
    x = x0
    total = sum(w for _, w in items)
    k = 300.0 / 240.0
    for name, w in items:
        fill = "#f2f2f2" if name.startswith("(") else "#ffffff"
        s.box(x, ry, w * k - 1.2, 26, name, "%.0f" % w, fill=fill, ts=3.4)
        x += w * k
    s.txt(x0, ry - 6, "DIN 레일 240mm 배분 — 사용 205, 여유 35 (AC 라인 필터 자리 18 포함)",
          4.0, weight="bold")
    s.wire([(x0, ry + 32), (x0 + 240 * k, ry + 32)], "ink", 1.4)
    s.txt(x0 + 120 * k, ry + 38, "240", 3.4, "middle")

    s.finish(os.path.join(OUT, "svg", "W-04-terminal.svg"), "단자대 배치 · 결선도", "W-04", [
        "2단 단자대 10위치(20극). 굵은 선은 삽입 브리지로 묶는 구간이다.",
        "1층 1~4 = +24V, 5~8 = 0V-P, 9~10 = +5V.",
        "2층 1~4 = RS485 A, 5~8 = RS485 B, 9~10 = 0V-S.",
        "센서·RS485 는 왼쪽, AC 는 오른쪽에 모은다. 하부면 커넥터 배치와 같은 방향이라",
        "   AC 배선과 통신 배선이 함체 안에서 서로 반대편에 놓인다.",
        "LK1 은 필수다. 조립 시 빠뜨리면 통신이 간헐적으로 끊긴다 — W-01·W-03 참조.",
        "LK2 는 기본 장착이며 접지 루프 시험 때 분리할 수 있다.",
        "PE 는 별도 레일 접지형 단자를 쓴다. 일반 단자대에 PE 를 섞지 않는다.",
        "어느 극에 무엇을 무는지는 WIRING.md 의 결선표가 기준이다.",
    ], [("+24V", "24"), ("0V-P", "0P"), ("A", "A"), ("B", "B"), ("+5V", "5"), ("0V-S", "0S")])


if __name__ == "__main__":
    os.makedirs(os.path.join(OUT, "svg"), exist_ok=True)
    print("내부 배선도 생성")
    w01(); w02(); w03(); w04()
    print("완료 — %s/svg" % OUT)
