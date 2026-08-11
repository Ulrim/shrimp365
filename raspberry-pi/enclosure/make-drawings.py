#!/usr/bin/env python3
"""
제작도면 생성기 — 수질 모니터링 장비 함체

가공용 DXF(R12)와 검도용 SVG(A2, 1:1)를 함께 만듭니다.
표준 라이브러리만 씁니다.

    python3 make-drawings.py

부품이 확정되면 아래 PARAMS 만 고치고 다시 돌리십시오. 전 도면이 함께 갱신됩니다.
"""

import math
import os

OUT = os.path.dirname(os.path.abspath(__file__))

# ══════════════════════════════════════════════════════════════════
#  PARAMS — 실물 확정 후 여기만 고칩니다
# ══════════════════════════════════════════════════════════════════
P = {
    # 함체 (기성품 — 구매 확정 후 실측값으로 교체)
    "enc_w": 300.0, "enc_h": 250.0, "enc_d": 150.0,
    "door_flat_w": 260.0, "door_flat_h": 210.0,   # 도어 실링립 안쪽 평탄부
    "bp_w": 260.0, "bp_h": 210.0,                 # 백플레이트

    # 공식 7인치 디스플레이 (실측 확인 필요)
    "disp_w": 194.0, "disp_h": 111.0,
    "act_w": 155.0, "act_h": 86.0,

    # 도어 개구부
    "win_w": 176.0, "win_h": 94.0, "win_r": 3.0,
    "gasket": 5.0,                                # 개구부 바깥 개스킷 밴드 폭

    # 압착 프레임 / 스탠드오프
    "so_px": 210.0, "so_py": 127.0,               # 스탠드오프 피치
    "so_base_d": 8.0,                             # 스탠드오프 베이스 지름
    "pf_w": 224.0, "pf_h": 141.0, "pf_r": 5.0,    # 프레임 외곽
    "pf_win_w": 178.0, "pf_win_h": 95.0, "pf_win_r": 3.0,
    "pf_hole_d": 3.4,

    # 하부면 커넥터 — 커넥터 확정 후 반드시 재확인
    "m12_hole_d": 16.5,     # M12 전면체결형(M16x1.5 나사부) 기준
    "vent_hole_d": 12.5,    # M12x1.5 통기 벤트
    "conn_y": 100.0,        # 후면 외벽에서 커넥터 중심까지
    "sensor_pitch": 36.0,
    "ac_x": 105.0,
    "vent_x": -105.0,

    # 백플레이트 가공
    "din_y": -45.0,                                # 레일 중심 (백플레이트 중심 기준)
    "din_len": 240.0,
    "din_holes_x": [-105.0, -35.0, 35.0, 105.0],
    "din_hole_d": 4.5,
    "pi_cx": -60.0, "pi_cy": 65.0,                 # 파이 나사 4개의 패턴 중심
    "pi_px": 58.0, "pi_py": 49.0, "pi_hole_d": 3.2,
    "rtc_x": -112.0, "rtc_y": [60.0, 85.0], "rtc_hole_d": 3.2,
    "ssd_x": 95.0, "ssd_y": [40.0, 90.0], "ssd_hole_d": 4.5,
    "gnd_x": 120.0, "gnd_y": -95.0, "gnd_hole_d": 4.5,

    # 차양 (전개도)
    "sun_w": 340.0, "sun_rear": 40.0, "sun_top": 190.0, "sun_drop": 40.0,
    "sun_hole_d": 5.5, "sun_holes_x": [-120.0, -40.0, 40.0, 120.0],
}

SHEET_W, SHEET_H = 594.0, 420.0        # A2
LAYERS = [("CUT", 1), ("MARK", 3), ("REF", 8), ("DIM", 4), ("NOTE", 7)]


# ══════════════════════════════════════════════════════════════════
#  DXF (R12) 생성
# ══════════════════════════════════════════════════════════════════
class Dxf:
    def __init__(self):
        self.ents = []

    def _g(self, code, val):
        self.ents.append("%d\n%s" % (code, val))

    def line(self, layer, x1, y1, x2, y2):
        for c, v in ((0, "LINE"), (8, layer), (10, "%.4f" % x1), (20, "%.4f" % y1),
                     (30, "0.0"), (11, "%.4f" % x2), (21, "%.4f" % y2), (31, "0.0")):
            self._g(c, v)

    def circle(self, layer, x, y, r):
        for c, v in ((0, "CIRCLE"), (8, layer), (10, "%.4f" % x), (20, "%.4f" % y),
                     (30, "0.0"), (40, "%.4f" % r)):
            self._g(c, v)

    def arc(self, layer, x, y, r, a1, a2):
        for c, v in ((0, "ARC"), (8, layer), (10, "%.4f" % x), (20, "%.4f" % y),
                     (30, "0.0"), (40, "%.4f" % r), (50, "%.4f" % a1), (51, "%.4f" % a2)):
            self._g(c, v)

    def text(self, layer, x, y, h, s):
        for c, v in ((0, "TEXT"), (8, layer), (10, "%.4f" % x), (20, "%.4f" % y),
                     (30, "0.0"), (40, "%.4f" % h), (1, s)):
            self._g(c, v)

    def save(self, path):
        out = ["0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC"]
        tab = ["0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n%d" % len(LAYERS)]
        for name, color in LAYERS:
            tab.append("0\nLAYER\n2\n%s\n70\n0\n62\n%d\n6\nCONTINUOUS" % (name, color))
        tab.append("0\nENDTAB\n0\nENDSEC")
        out.append("\n".join(tab))
        out.append("0\nSECTION\n2\nENTITIES\n" + "\n".join(self.ents) + "\n0\nENDSEC")
        out.append("0\nEOF\n")
        with open(path, "w") as f:
            f.write("\n".join(out))


# ══════════════════════════════════════════════════════════════════
#  SVG 생성 (모델 mm → 시트 mm, 1:1, Y 뒤집기)
# ══════════════════════════════════════════════════════════════════
STYLE = {
    "CUT":  'stroke="#c00000" stroke-width="0.6" fill="none"',
    "MARK": 'stroke="#008000" stroke-width="0.35" fill="none"',
    "REF":  'stroke="#909090" stroke-width="0.25" stroke-dasharray="4,2,1,2" fill="none"',
    "DIM":  'stroke="#0070a0" stroke-width="0.25" fill="none"',
    "NOTE": 'stroke="#202020" stroke-width="0.25" fill="none"',
}


class Svg:
    def __init__(self, ox, oy, k=1.0):
        self.ox, self.oy, self.k = ox, oy, k
        self.body = []

    def X(self, x): return self.ox + self.k * x
    def Y(self, y): return self.oy - self.k * y

    def line(self, layer, x1, y1, x2, y2):
        self.body.append('<line x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f" %s/>'
                         % (self.X(x1), self.Y(y1), self.X(x2), self.Y(y2), STYLE[layer]))

    def circle(self, layer, x, y, r):
        self.body.append('<circle cx="%.3f" cy="%.3f" r="%.3f" %s/>'
                         % (self.X(x), self.Y(y), r * self.k, STYLE[layer]))

    def arc(self, layer, x, y, r, a1, a2):
        p1 = (x + r * math.cos(math.radians(a1)), y + r * math.sin(math.radians(a1)))
        p2 = (x + r * math.cos(math.radians(a2)), y + r * math.sin(math.radians(a2)))
        large = 1 if (a2 - a1) % 360 > 180 else 0
        self.body.append('<path d="M %.3f %.3f A %.3f %.3f 0 %d 0 %.3f %.3f" %s/>'
                         % (self.X(p1[0]), self.Y(p1[1]), r * self.k, r * self.k, large,
                            self.X(p2[0]), self.Y(p2[1]), STYLE[layer]))

    def text(self, x, y, s, size=3.0, anchor="middle", color="#202020", weight="normal"):
        self.body.append('<text x="%.3f" y="%.3f" font-family="sans-serif" font-size="%.2f" '
                         'text-anchor="%s" fill="%s" font-weight="%s">%s</text>'
                         % (self.X(x), self.Y(y), size, anchor, color, weight, esc(s)))

    def raw_text(self, sx, sy, s, size=3.0, anchor="start", color="#202020", weight="normal"):
        self.body.append('<text x="%.3f" y="%.3f" font-family="sans-serif" font-size="%.2f" '
                         'text-anchor="%s" fill="%s" font-weight="%s">%s</text>'
                         % (sx, sy, size, anchor, color, weight, esc(s)))

    def arrow(self, x, y, ang):
        """모델좌표 (x,y) 에 각도 ang(도) 방향 화살촉"""
        a = math.radians(ang)
        L, Wd = 2.6 / self.k, 0.9 / self.k
        tip = (self.X(x), self.Y(y))
        bx, by = x - L * math.cos(a), y - L * math.sin(a)
        p2 = (self.X(bx - Wd * math.sin(a)), self.Y(by + Wd * math.cos(a)))
        p3 = (self.X(bx + Wd * math.sin(a)), self.Y(by - Wd * math.cos(a)))
        self.body.append('<polygon points="%.3f,%.3f %.3f,%.3f %.3f,%.3f" fill="#0070a0"/>'
                         % (tip[0], tip[1], p2[0], p2[1], p3[0], p3[1]))

    # --- 치수 ---
    def dim_h(self, x1, x2, y, label, ext_from=None):
        o = 2.0 / self.k
        if ext_from is not None:
            self.line("DIM", x1, ext_from, x1, y + (o if y > ext_from else -o))
            self.line("DIM", x2, ext_from, x2, y + (o if y > ext_from else -o))
        self.line("DIM", x1, y, x2, y)
        self.arrow(x1, y, 180)
        self.arrow(x2, y, 0)
        self.text((x1 + x2) / 2, y + 1.4 / self.k, label, 3.2, color="#0070a0")

    def dim_v(self, y1, y2, x, label, ext_from=None):
        o = 2.0 / self.k
        if ext_from is not None:
            self.line("DIM", ext_from, y1, x + (o if x > ext_from else -o), y1)
            self.line("DIM", ext_from, y2, x + (o if x > ext_from else -o), y2)
        self.line("DIM", x, y1, x, y2)
        self.arrow(x, y1, 270)
        self.arrow(x, y2, 90)
        self.body.append('<text x="%.3f" y="%.3f" font-family="sans-serif" font-size="3.2" '
                         'text-anchor="middle" fill="#0070a0" transform="rotate(-90 %.3f %.3f)">%s</text>'
                         % (self.X(x) - 1.2, self.Y((y1 + y2) / 2),
                            self.X(x) - 1.2, self.Y((y1 + y2) / 2), esc(label)))

    def leader(self, x, y, tx, ty, label, anchor="start"):
        self.line("DIM", x, y, tx, ty)
        self.arrow(x, y, math.degrees(math.atan2(y - ty, x - tx)))
        dx = (1.5 if anchor == "start" else -1.5) / self.k
        self.text(tx + dx, ty - 1.0 / self.k, label, 3.0, anchor=anchor, color="#0070a0")


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def hole_table(sv, ty, rows, caption, cols=("이름", "X", "Y", "Ø")):
    """좌측 주기 아래에 구멍 좌표표를 놓습니다."""
    bx, w = 16.0, 126.0
    sv.raw_text(bx, ty, caption, 3.6, weight="bold")
    ty += 4
    sv.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="none" '
                   'stroke="#202020" stroke-width="0.4"/>' % (bx, ty, w, 8 + len(rows) * 6.2))
    sv.body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#202020" '
                   'stroke-width="0.4"/>' % (bx, ty + 7.6, bx + w, ty + 7.6))
    offs = (4, 52, 80, 104)
    for lbl, dx in zip(cols, offs):
        sv.raw_text(bx + dx, ty + 5.6, lbl, 3.4, weight="bold")
    for i, r in enumerate(rows):
        yy = ty + 13.4 + i * 6.2
        for txt, dx in zip(r, offs):
            sv.raw_text(bx + dx, yy, str(txt), 3.4)
    return ty + 8 + len(rows) * 6.2


def centerlines(dr, xext, yext):
    dr.line("REF", -xext, 0, xext, 0)
    dr.line("REF", 0, -yext, 0, yext)


class Draw:
    """DXF 와 SVG 에 동시에 그립니다. dim_* / note 는 SVG 전용."""

    def __init__(self, ox, oy, k=1.0):
        self.d, self.s = Dxf(), Svg(ox, oy, k)

    def line(self, layer, *a):
        self.d.line(layer, *a); self.s.line(layer, *a)

    def circle(self, layer, x, y, dia):
        self.d.circle(layer, x, y, dia / 2); self.s.circle(layer, x, y, dia / 2)

    def hole(self, x, y, dia, cross=4.0):
        """구멍 + 중심선"""
        self.circle("CUT", x, y, dia)
        for layer, dd in (("MARK", 0),):
            self.line(layer, x - dia / 2 - cross, y, x + dia / 2 + cross, y)
            self.line(layer, x, y - dia / 2 - cross, x, y + dia / 2 + cross)

    def arc(self, layer, *a):
        self.d.arc(layer, *a); self.s.arc(layer, *a)

    def rect(self, layer, cx, cy, w, h):
        x1, x2, y1, y2 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
        self.line(layer, x1, y1, x2, y1); self.line(layer, x2, y1, x2, y2)
        self.line(layer, x2, y2, x1, y2); self.line(layer, x1, y2, x1, y1)

    def rrect(self, layer, cx, cy, w, h, r):
        x1, x2, y1, y2 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
        self.line(layer, x1 + r, y1, x2 - r, y1)
        self.line(layer, x2, y1 + r, x2, y2 - r)
        self.line(layer, x2 - r, y2, x1 + r, y2)
        self.line(layer, x1, y2 - r, x1, y1 + r)
        self.arc(layer, x2 - r, y1 + r, r, 270, 360)
        self.arc(layer, x2 - r, y2 - r, r, 0, 90)
        self.arc(layer, x1 + r, y2 - r, r, 90, 180)
        self.arc(layer, x1 + r, y1 + r, r, 180, 270)


# ══════════════════════════════════════════════════════════════════
#  시트 (테두리 · 표제란 · 주석)
# ══════════════════════════════════════════════════════════════════
def sheet(dr, title, no, notes, extra_rows=None, scale="1:1"):
    s = dr.s
    b = []
    b.append('<rect x="0" y="0" width="%.1f" height="%.1f" fill="#ffffff"/>' % (SHEET_W, SHEET_H))
    b.append('<rect x="10" y="10" width="%.1f" height="%.1f" fill="none" stroke="#202020" '
             'stroke-width="0.7"/>' % (SHEET_W - 20, SHEET_H - 20))
    s.body = b + s.body

    # 표제란
    tw, th = 190.0, 46.0
    tx, ty = SHEET_W - 10 - tw, SHEET_H - 10 - th
    s.body.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#ffffff" '
                  'stroke="#202020" stroke-width="0.7"/>' % (tx, ty, tw, th))
    s.body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#202020" '
                  'stroke-width="0.4"/>' % (tx, ty + 16, tx + tw, ty + 16))
    s.body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#202020" '
                  'stroke-width="0.4"/>' % (tx, ty + 31, tx + tw, ty + 31))
    s.raw_text(tx + 4, ty + 11, title, 6.5, weight="bold")
    s.raw_text(tx + 4, ty + 26, "Shrimp365 수질 모니터링 장비 함체", 4.0)
    s.raw_text(tx + tw - 4, ty + 26, "도번 %s" % no, 4.0, anchor="end")
    s.raw_text(tx + 4, ty + 41, "척도 %s   투상 제3각   단위 mm" % scale, 3.6)
    s.raw_text(tx + tw - 4, ty + 41, "A2 / Rev.A", 3.6, anchor="end")

    # 주석 — 좌측 열. 공백으로 시작하는 줄은 앞 항목의 이어짐이라 번호를 붙이지 않는다.
    ny, num = 26.0, 0
    s.raw_text(16, ny, "주기", 4.8, weight="bold")
    for i, n in enumerate(notes):
        y = ny + 8 + i * 5.2
        if n.startswith(" "):
            s.raw_text(22, y, n.strip(), 3.4)
        else:
            num += 1
            s.raw_text(16, y, "%d." % num, 3.4)
            s.raw_text(22, y, n, 3.4)
    ny = ny + 8 + len(notes) * 5.2

    if extra_rows:
        ny += 6
        for i, r in enumerate(extra_rows):
            s.raw_text(16, ny + i * 5.0, r, 3.4)
        ny += len(extra_rows) * 5.0

    # 범례
    ly = SHEET_H - 22
    for i, (lbl, key) in enumerate([("가공 CUT", "CUT"), ("마킹 MARK", "MARK"), ("참고 REF", "REF")]):
        col = {"CUT": "#c00000", "MARK": "#008000", "REF": "#909090"}[key]
        s.body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                      'stroke-width="0.8"/>' % (16 + i * 46, ly, 28 + i * 46, ly, col))
        s.raw_text(30 + i * 46, ly + 1.4, lbl, 3.4)
    return ny


def write(dr, base, title, no, notes, extra=None, after=None, scale="1:1"):
    y = sheet(dr, title, no, notes, extra, scale)
    if after:
        after(dr.s, y + 8)
    os.makedirs(os.path.join(OUT, "dxf"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "svg"), exist_ok=True)
    dr.d.save(os.path.join(OUT, "dxf", base + ".dxf"))
    with open(os.path.join(OUT, "svg", base + ".svg"), "w") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" width="%.0fmm" height="%.0fmm" '
                'viewBox="0 0 %.0f %.0f">\n%s\n</svg>\n'
                % (SHEET_W, SHEET_H, SHEET_W, SHEET_H, "\n".join(dr.s.body)))
    print("  %-22s dxf/%s.dxf  svg/%s.svg" % (title, base, base))


# ══════════════════════════════════════════════════════════════════
#  도면 1 — 도어 가공
# ══════════════════════════════════════════════════════════════════
def dwg_door():
    dr = Draw(378, 190)
    g = P["gasket"]

    dr.rect("REF", 0, 0, P["enc_w"], P["enc_h"])
    dr.rect("REF", 0, 0, P["door_flat_w"], P["door_flat_h"])
    dr.rect("REF", 0, 0, P["disp_w"], P["disp_h"])
    dr.rect("REF", 0, 0, P["act_w"], P["act_h"])

    # 개구부 (유일한 절삭 가공)
    dr.rrect("CUT", 0, 0, P["win_w"], P["win_h"], P["win_r"])
    # 개스킷 밴드 바깥선
    dr.rrect("MARK", 0, 0, P["win_w"] + 2 * g, P["win_h"] + 2 * g, P["win_r"] + g)

    centerlines(dr, P["door_flat_w"] / 2 + 12, P["door_flat_h"] / 2 + 12)

    # 스탠드오프 접착 위치
    for sx in (-P["so_px"] / 2, P["so_px"] / 2):
        for sy in (-P["so_py"] / 2, P["so_py"] / 2):
            dr.circle("MARK", sx, sy, P["so_base_d"])
            dr.line("MARK", sx - 7, sy, sx + 7, sy)
            dr.line("MARK", sx, sy - 7, sx, sy + 7)

    s = dr.s
    s.dim_h(-P["win_w"] / 2, P["win_w"] / 2, 62, "개구부 176", ext_from=P["win_h"] / 2)
    s.dim_v(-P["win_h"] / 2, P["win_h"] / 2, 100, "94", ext_from=P["win_w"] / 2)
    s.dim_h(-P["so_px"] / 2, P["so_px"] / 2, -78, "스탠드오프 피치 210", ext_from=-P["so_py"] / 2)
    s.dim_v(-P["so_py"] / 2, P["so_py"] / 2, -122, "127", ext_from=-P["so_px"] / 2)
    s.dim_h(-P["door_flat_w"] / 2, P["door_flat_w"] / 2, -118, "도어 평탄부 260 (참고)",
            ext_from=-P["door_flat_h"] / 2)

    s.leader(P["win_w"] / 2 - 3, P["win_h"] / 2 - 3, 140, 84, "R3 (4개소)")
    s.leader(P["win_w"] / 2 + g, 20, 140, 58, "개스킷 밴드 폭 5")
    s.leader(P["disp_w"] / 2, -30, 140, -36, "디스플레이 외형 194x111")
    s.leader(P["act_w"] / 2, -12, 140, 12, "활성영역 155x86")
    s.leader(P["so_px"] / 2, P["so_py"] / 2, 140, 118, "M3 스탠드오프 Ø8 접착")

    write(dr, "01-door", "도어 가공도", "SH-01", [
        "도어를 바깥에서 본 모습. 개구부는 상하좌우 대칭이므로 안팎 좌표가 같다.",
        "절삭 가공은 개구부 176 x 94, R3 하나뿐이다. 나머지는 위치 마킹이다.",
        "개구부 절단면의 버를 제거하고 모서리를 0.5 C 로 면취한다.",
        "스탠드오프는 도어 안쪽면에 2액형 에폭시로 접착한다. 도어 벽두께가 4mm",
        "   이상이면 M3 열간압입 인서트(하부구멍 Ø4.0 x 깊이 4.0)로 대체해도 된다.",
        "개스킷: 폭 5, 두께 2 폴리우레탄 폼 양면테이프. 개구부 가장자리에 맞춰",
        "   끊김 없이 한 바퀴 두른다. 모서리에서 잇지 말 것.",
        "디스플레이 유리(194x111)와 개스킷 바깥선(186x104) 사이 여유는 편측 4.0 /",
        "   3.5 이다. 유리 뒷면 가장자리에 단차가 있으면 개스킷이 뜬다 — 시제품",
        "   1대로 실측 확인한 뒤 양산 도면을 확정할 것.",
        "도어 바깥면에 노출되는 나사는 없어야 한다.",
    ], ["※ 함체 외곽 300x250 과 평탄부 260x210 은 기성 함체 카탈로그값이다.",
        "   구매 확정 후 실측하여 PARAMS 를 갱신하고 도면을 다시 생성할 것."])


# ══════════════════════════════════════════════════════════════════
#  도면 2 — 하부면 타공
# ══════════════════════════════════════════════════════════════════
def dwg_bottom():
    dr = Draw(378, 268)
    W, D, y = P["enc_w"], P["enc_d"], P["conn_y"]
    sp = P["sensor_pitch"]

    dr.rect("REF", 0, D / 2, W, D)
    dr.line("REF", -W / 2, D, W / 2, D)

    holes = [(P["vent_x"], P["vent_hole_d"], "VENT"),
             (-1.5 * sp, P["m12_hole_d"], "pH"),
             (-0.5 * sp, P["m12_hole_d"], "DO"),
             (0.5 * sp, P["m12_hole_d"], "EC"),
             (1.5 * sp, P["m12_hole_d"], "SPARE"),
             (P["ac_x"], P["m12_hole_d"], "AC")]
    for hx, hd, name in holes:
        dr.hole(hx, y, hd)
        dr.s.text(hx, y + 14, name, 3.6, weight="bold")

    s = dr.s
    s.raw_text(dr.s.X(0), dr.s.Y(D + 8), "▲ 함체 전면(도어) 쪽", 4.2, anchor="middle")
    s.raw_text(dr.s.X(0), dr.s.Y(-14), "▼ 함체 후면 쪽", 4.2, anchor="middle")

    s.dim_h(-1.5 * sp, -0.5 * sp, y - 26, "36", ext_from=y)
    s.dim_h(-0.5 * sp, 0.5 * sp, y - 26, "36", ext_from=y)
    s.dim_h(0.5 * sp, 1.5 * sp, y - 26, "36", ext_from=y)
    s.dim_h(0, P["ac_x"], y - 42, "105", ext_from=y)
    s.dim_h(P["vent_x"], 0, y - 42, "105", ext_from=y)
    s.dim_v(0, y, -W / 2 - 26, "후면에서 100", ext_from=-W / 2)
    s.dim_h(-W / 2, W / 2, D + 22, "300 (참고)", ext_from=D)

    s.leader(P["ac_x"] + P["m12_hole_d"] / 2, y, 142, y + 40, "AC: Ø16.5  M12 S-coded")
    s.leader(0.5 * sp + P["m12_hole_d"] / 2, y, 60, y + 54, "센서: Ø16.5  M12 A-coded (4개소)")
    s.leader(P["vent_x"], y - P["vent_hole_d"] / 2, -132, y - 58, "벤트: Ø12.5  M12x1.5", anchor="end")

    def table(sv, ty):
        rows = [(n, "%+.1f" % hx, "%.1f" % y, "%.1f" % hd) for hx, hd, n in holes]
        hole_table(sv, ty, rows, "구멍 좌표 (X: 좌우 중심 / Y: 후면 외벽 기준, mm)")

    write(dr, "02-bottom", "하부면 타공도", "SH-02", [
        "함체 하부면을 정면도에서 아래로 90° 전개한 모습. 좌우는 정면에서 본 것과 같다.",
        "정면에서 보아 좌→우 순서: VENT, pH, DO, EC, SPARE, AC.",
        "AC 는 M12 S-coded, 센서는 M12 A-coded 로 코딩이 다르다. 두 계열은 물리적으로",
        "   서로 결합되지 않으므로 AC 를 센서 포트에 꽂는 사고가 원천 차단된다.",
        "구멍 지름은 M16x1.5 나사부를 갖는 전면체결형 M12 커넥터 기준이다.",
        "   후면체결형·2점나사형은 치수가 다르다 — 커넥터 확정 후 재확인할 것.",
        "커넥터에 회전방지 평면이 있는 제품이면 Ø16.5 에 폭 15.5 평면을 추가한다.",
        "Y=100 은 후면 외벽 기준이다. SMPS 깊이(약 56)와 백플레이트 이격을 피해",
        "   커넥터 몸통이 간섭 없이 들어가도록 정한 값이다.",
        "커넥터는 전부 하부면에만 둔다. 측면·상부는 물이 고여 방수가 깨진다.",
        "타공 후 버를 제거하고 개스킷 접촉면을 평탄하게 다듬는다.",
        "미사용 포트(SPARE)에는 방수캡을 씌워 출하한다.",
    ], ["※ 유선 LAN 은 사용하지 않기로 하여 RJ45 포트를 삭제했다."], after=table)


# ══════════════════════════════════════════════════════════════════
#  도면 3 — 백플레이트 가공
# ══════════════════════════════════════════════════════════════════
def dwg_backplate():
    dr = Draw(382, 200)
    W, H = P["bp_w"], P["bp_h"]

    dr.rect("REF", 0, 0, W, H)
    centerlines(dr, W / 2 + 12, H / 2 + 12)

    holes = []
    for i, hx in enumerate(P["din_holes_x"]):
        holes.append(("DIN-%d" % (i + 1), hx, P["din_y"], P["din_hole_d"]))
    px, py = P["pi_cx"], P["pi_cy"]
    for i, (dx, dy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        holes.append(("PI-%d" % (i + 1), px + dx * P["pi_px"] / 2,
                      py + dy * P["pi_py"] / 2, P["pi_hole_d"]))
    for i, ry in enumerate(P["rtc_y"]):
        holes.append(("RTC-%d" % (i + 1), P["rtc_x"], ry, P["rtc_hole_d"]))
    for i, sy in enumerate(P["ssd_y"]):
        holes.append(("SSD-%d" % (i + 1), P["ssd_x"], sy, P["ssd_hole_d"]))
    holes.append(("GND", P["gnd_x"], P["gnd_y"], P["gnd_hole_d"]))

    for name, hx, hy, hd in holes:
        dr.hole(hx, hy, hd, cross=3 if hd < 4 else 4)

    dr.rect("REF", 0, P["din_y"], P["din_len"], 35)
    dr.rect("REF", px + 10, py, 85, 56)          # 기판 외형 (홀 패턴 중심은 기판 중심에서 10 치우침)
    dr.rect("REF", px + 10 + 42.5 + 35, py, 70, 20)   # USB-RS485 돌출 영역

    s = dr.s
    s.dim_h(P["din_holes_x"][0], P["din_holes_x"][-1], -H / 2 - 18, "210", ext_from=P["din_y"])
    s.dim_h(P["din_holes_x"][0], P["din_holes_x"][1], -H / 2 - 32, "70", ext_from=P["din_y"])
    s.dim_v(-H / 2, P["din_y"], -W / 2 - 20, "60", ext_from=-W / 2)
    s.dim_h(px - P["pi_px"] / 2, px + P["pi_px"] / 2, py + 42, "58", ext_from=py + P["pi_py"] / 2)
    s.dim_v(py - P["pi_py"] / 2, py + P["pi_py"] / 2, px - 52, "49", ext_from=px - P["pi_px"] / 2)
    s.dim_h(-W / 2, W / 2, H / 2 + 30, "260 (기성 백플레이트)", ext_from=H / 2)
    s.dim_v(-H / 2, H / 2, W / 2 + 34, "210", ext_from=W / 2)

    s.leader(P["din_holes_x"][-1], P["din_y"], 146, -96, "DIN 레일 35mm x 240  Ø4.5 (4)")
    s.leader(px + P["pi_px"] / 2, py + P["pi_py"] / 2, 20, 128, "라즈베리파이 4  Ø3.2 (4)")
    s.leader(P["rtc_x"], P["rtc_y"][1], -148, 124, "RTC DS3231  Ø3.2 (2)", anchor="end")
    s.leader(P["ssd_x"], P["ssd_y"][1], 146, 118, "SSD 브래킷  Ø4.5 (2)")
    s.leader(P["gnd_x"], P["gnd_y"], 146, -118, "접지 스터드 Ø4.5")

    def table(sv, ty):
        rows = [(n, "%+.1f" % hx, "%+.1f" % hy, "%.1f" % hd) for n, hx, hy, hd in holes]
        hole_table(sv, ty, rows, "구멍 좌표 (백플레이트 중심 기준, 단위 mm)")

    write(dr, "03-backplate", "백플레이트 가공도", "SH-03", [
        "부품이 붙는 면(함체 전면 방향)에서 본 모습. 재질 알루미늄 2t, 기성 백플레이트.",
        "가공은 구멍 13개뿐이다: Ø4.5 x 7, Ø3.2 x 6.",
        "파이 나사구멍 패턴 58 x 49 의 중심은 기판(85x56) 중심에서 긴 변 방향으로",
        "   10mm 치우쳐 있다. 참고선의 기판 외형이 그것을 반영한 위치다.",
        "파이는 USB·이더넷 면이 오른쪽, GPIO 헤더가 위를 향하게 놓는다.",
        "   DSI 리본이 왼쪽으로 빠져 힌지(좌측) 쪽으로 자연스럽게 돌아간다.",
        "USB-RS485 변환기는 파이 오른쪽으로 약 70 돌출한다. 참고선 영역을 비워 둘 것.",
        "DIN 레일 배치(좌→우): 2단 단자대 - DC/DC 벅 - SMPS - 퓨즈홀더 3 - SPD.",
        "   AC 구역을 오른쪽 끝에 모아 하부면 AC 커넥터(우측)와 최단으로 잇는다.",
        "   RS485 배선은 SMPS·AC 배선에서 50 이상 띄우고, 교차 시 직각으로 지난다.",
        "접지 스터드는 톱니와셔로 알루미늄 산화막을 관통시켜 도통시킨다.",
        "   AC 커넥터 PE - SMPS FG - 백플레이트가 한 점에 모이게 한다.",
        "케이블 덕트는 쓰지 않는다. 접착식 타이 앵커로 정리한다(가공 없음).",
        "실리카겔 홀더는 접착 부착이므로 가공하지 않는다.",
    ], after=table)


# ══════════════════════════════════════════════════════════════════
#  도면 4 — 압착 프레임
# ══════════════════════════════════════════════════════════════════
def dwg_pressframe():
    dr = Draw(378, 200)
    dr.rrect("CUT", 0, 0, P["pf_w"], P["pf_h"], P["pf_r"])
    dr.rrect("CUT", 0, 0, P["pf_win_w"], P["pf_win_h"], P["pf_win_r"])
    for sx in (-P["so_px"] / 2, P["so_px"] / 2):
        for sy in (-P["so_py"] / 2, P["so_py"] / 2):
            dr.hole(sx, sy, P["pf_hole_d"], cross=3)
    dr.rect("REF", 0, 0, P["disp_w"], P["disp_h"])
    centerlines(dr, P["pf_w"] / 2 + 12, P["pf_h"] / 2 + 12)

    s = dr.s
    s.dim_h(-P["pf_w"] / 2, P["pf_w"] / 2, -P["pf_h"] / 2 - 22, "224", ext_from=-P["pf_h"] / 2)
    s.dim_v(-P["pf_h"] / 2, P["pf_h"] / 2, P["pf_w"] / 2 + 24, "141", ext_from=P["pf_w"] / 2)
    s.dim_h(-P["pf_win_w"] / 2, P["pf_win_w"] / 2, 58, "창 178", ext_from=P["pf_win_h"] / 2)
    s.dim_v(-P["pf_win_h"] / 2, P["pf_win_h"] / 2, -P["pf_w"] / 2 - 22, "95", ext_from=-P["pf_win_w"] / 2)
    s.dim_h(-P["so_px"] / 2, P["so_px"] / 2, -P["pf_h"] / 2 - 40, "210", ext_from=-P["so_py"] / 2)
    s.dim_v(-P["so_py"] / 2, P["so_py"] / 2, -P["pf_w"] / 2 - 40, "127", ext_from=-P["so_px"] / 2)

    s.leader(P["pf_w"] / 2 - 4, P["pf_h"] / 2 - 4, 138, 96, "R5 (4)")
    s.leader(P["pf_win_w"] / 2 - 3, P["pf_win_h"] / 2 - 3, 138, 72, "R3 (4)")
    s.leader(P["so_px"] / 2, P["so_py"] / 2, 138, 118, "Ø3.4 (4)")
    s.leader(P["disp_w"] / 2, -20, 138, -30, "디스플레이 외형 194x111 (참고)")

    write(dr, "04-press-frame", "압착 프레임", "SH-04", [
        "재질 알루미늄 3t (또는 SUS304 2t). 수량 1/대. 레이저 절단.",
        "디스플레이 뒷면 가장자리를 폭 8 의 띠로 눌러 도어 개스킷을 균등 압축한다.",
        "   가로 접촉대 반폭 89~97, 세로 47.5~55.5. 도어 개스킷 밴드(반폭 88~93 /",
        "   47~52)와 겹치므로 압축력이 개스킷 바로 위에 실린다.",
        "접촉면에는 두께 3 실리콘 패드를 같은 폭 8 의 액자 모양으로 붙인다.",
        "   디스플레이 뒷면 부품과 직접 닿지 않게 하기 위한 것이다.",
        "M3 스탠드오프 4개소에 SUS316 M3 볼트 + 스프링와셔로 체결한다.",
        "   대각선 순서로 조금씩 나눠 조여 개스킷을 고르게 압축한다. 과조임 금지.",
        "창 치수는 디스플레이 뒷면의 부품 배치에 따라 달라질 수 있다.",
        "   시제품 실측 후 확정할 것.",
        "절단 후 모든 모서리를 면취하고 버를 제거한다. 리본 케이블이 지나간다.",
    ])


# ══════════════════════════════════════════════════════════════════
#  도면 5 — 차양 전개도
# ══════════════════════════════════════════════════════════════════
def dwg_sunshield():
    dr = Draw(378, 330)
    W = P["sun_w"]
    a, b, c = P["sun_rear"], P["sun_top"], P["sun_drop"]
    L = a + b + c

    dr.rect("CUT", 0, L / 2, W, L)
    dr.line("MARK", -W / 2, a, W / 2, a)
    dr.line("MARK", -W / 2, a + b, W / 2, a + b)
    for hx in P["sun_holes_x"]:
        dr.hole(hx, a / 2, P["sun_hole_d"], cross=4)

    s = dr.s
    s.dim_h(-W / 2, W / 2, -20, "340", ext_from=0)
    s.dim_v(0, a, W / 2 + 22, "40 후면 플랜지", ext_from=W / 2)
    s.dim_v(a, a + b, W / 2 + 22, "190 상판", ext_from=W / 2)
    s.dim_v(a + b, L, W / 2 + 22, "40 전면 드롭", ext_from=W / 2)
    s.dim_h(P["sun_holes_x"][0], P["sun_holes_x"][-1], a + 16, "240", ext_from=a / 2)
    s.dim_h(P["sun_holes_x"][0], P["sun_holes_x"][1], a + 30, "80", ext_from=a / 2)

    s.leader(P["sun_holes_x"][-1], a / 2, 178, -30, "Ø5.5 (4)")
    s.leader(0, a, -178, 62, "절곡선 90° 아래로", anchor="end")
    s.leader(0, a + b, -178, 142, "절곡선 90° 아래로", anchor="end")

    write(dr, "05-sun-shield", "차양 전개도", "SH-05", [
        "재질 알루미늄 1.5t. 직사광에 노출되는 설치에만 적용한다(선택 부품).",
        "절곡선 2곳 모두 아래로 90°. 내측 반경 R2.",
        "함체 상단에서 20~30 띄워 고정한다. 그 틈으로 공기가 지나가야 효과가 있다.",
        "함체보다 좌우 각 20, 앞으로 40 더 나오게 하여 정오 전후의 그늘을 확보한다.",
        "표면은 밝은 회색 또는 무광 백색으로 마감한다.",
        "고정은 함체 벽부 브래킷을 공용하거나 별도 스페이서 4개를 쓴다.",
        "함체에 새 구멍을 뚫지 말 것 — 방수가 깨진다.",
    ])


# ══════════════════════════════════════════════════════════════════
#  도면 6 — 디스플레이 장착 단면 상세 (SVG 전용, 4:1)
# ══════════════════════════════════════════════════════════════════
def dwg_section():
    dr = Draw(330, 215)
    K = 4.0   # 두께 방향만 4배 과장

    door_t = 3.0 * K
    gask_t = 2.0 * K
    glass_t = 3.0 * K
    pcb_t = 2.0 * K
    pad_t = 3.0 * K
    frame_t = 3.0 * K

    x_open = P["win_w"] / 2
    x_glass = P["disp_w"] / 2
    x_gask_o = P["win_w"] / 2 + P["gasket"]
    x_pf_in = P["pf_win_w"] / 2
    x_pf_o = P["pf_w"] / 2
    x_so = P["so_px"] / 2

    x_door = 132.0

    def band(layer, x1, x2, ytop, t):
        """좌우 대칭으로 같은 띠를 둘 그립니다."""
        for sgn in (1, -1):
            dr.rect(layer, sgn * (x1 + x2) / 2, ytop - t / 2, x2 - x1, t)

    y = 0.0
    band("CUT", x_open, x_door, y, door_t)                                  # 도어
    band("MARK", x_open, x_gask_o, y - door_t, gask_t)                      # 개스킷
    y_gl = y - door_t - gask_t
    dr.rect("CUT", 0, y_gl - glass_t / 2, P["disp_w"], glass_t)             # 커버 유리
    dr.rect("REF", 0, y_gl - glass_t - pcb_t / 2, P["disp_w"] - 6, pcb_t)   # 기판
    ypad = y_gl - glass_t - pcb_t
    band("MARK", x_pf_in, x_glass, ypad, pad_t)                             # 실리콘 패드
    yfr = ypad - pad_t
    band("CUT", x_pf_in, x_pf_o, yfr, frame_t)                              # 압착 프레임
    for sgn in (1, -1):                                                     # 스탠드오프 + 볼트
        dr.rect("REF", sgn * x_so, (y - door_t + yfr) / 2,
                P["so_base_d"], (y - door_t) - yfr)
        dr.line("MARK", sgn * x_so, y - door_t, sgn * x_so, yfr - frame_t - 10)
    centerlines(dr, 0, 0)
    dr.line("REF", 0, y + 14, 0, yfr - frame_t - 30)

    s = dr.s
    s.raw_text(s.X(-150), s.Y(36), "디스플레이 장착 단면 — 두께 방향만 4배 과장, 좌우 1:1", 5.0)
    s.leader(x_door - 8, y - door_t / 2, 150, 30, "도어 3t")
    s.leader((x_open + x_gask_o) / 2, y - door_t - gask_t / 2, 150, 12, "개스킷 폼 2t x 폭 5")
    s.leader(30, y_gl - glass_t / 2, 150, -6, "디스플레이 커버 유리")
    s.leader(-30, y_gl - glass_t - pcb_t / 2, -150, -6, "디스플레이 기판", anchor="end")
    s.leader((x_pf_in + x_glass) / 2, ypad - pad_t / 2, 150, -24, "실리콘 패드 3t x 폭 8")
    s.leader((x_pf_in + x_pf_o) / 2, yfr - frame_t / 2, 150, -42, "압착 프레임 3t")
    s.leader(x_so, yfr - frame_t - 6, 150, -60, "M3 스탠드오프 + SUS316 볼트")
    s.dim_h(x_open, x_gask_o, 16, "개스킷 5", ext_from=y)
    s.dim_h(x_pf_in, x_glass, yfr - frame_t - 22, "접촉대 8", ext_from=ypad)
    s.dim_h(0, x_open, 30, "개구부 반폭 88", ext_from=y)
    s.dim_h(0, x_glass, 44, "유리 반폭 97", ext_from=y_gl)

    write(dr, "06-section", "디스플레이 장착 단면", "SH-06", [
        "두께 방향만 4배로 과장했다. 좌우 치수는 1:1 이다.",
        "체결력은 스탠드오프 → 압착 프레임 → 실리콘 패드 → 디스플레이 → 개스킷 →",
        "   도어 순으로 전달된다. 개스킷이 눌리는 자리가 접촉대 바로 아래에 오도록",
        "   개구부(176x94)와 프레임 창(178x95)을 맞춰 놓았다.",
        "개스킷 압축률은 30~50% 를 목표로 한다. 2t 폼이 1.0~1.4t 로 눌리면 적정이다.",
        "더 조이면 유리에 응력이 걸리고, 덜 조이면 방수가 안 된다.",
        "DSI 리본과 5V 선은 프레임 창 안쪽으로 빼서 힌지(좌측)를 향해 여유 곡선을",
        "   준다. 도어를 여닫을 때 리본이 꺾이지 않아야 한다.",
        "도어 바깥에서 보이는 것은 디스플레이 유리와 개구부 모서리뿐이다.",
        "이 도면은 이해를 돕기 위한 것이다. 가공 치수는 SH-01, SH-04 를 따른다.",
    ])


# ══════════════════════════════════════════════════════════════════
#  도면 7 — 외함 3면도 (설계 요구 형상)
# ══════════════════════════════════════════════════════════════════
def dwg_enclosure():
    K = 0.5
    dr = Draw(330, 250, K)
    Wd, Hh, Dd = P["enc_w"], P["enc_h"], P["enc_d"]
    fw, fh = P["door_flat_w"], P["door_flat_h"]
    s = dr.s

    # ── 정면도 (좌상) — 도어를 바깥에서 ──
    ox, oy = -120.0, 290.0
    dr.rect("CUT", ox, oy, Wd, Hh)
    dr.rect("REF", ox, oy, fw, fh)
    dr.rrect("CUT", ox, oy, P["win_w"], P["win_h"], P["win_r"])
    for bxp in (-Wd/2 + 15, Wd/2 - 15):
        for byp in (-Hh/2 + 20, 0.0, Hh/2 - 20):
            dr.circle("MARK", ox + bxp, oy + byp, 4)
    s.text(ox, oy + Hh/2 + 24, "정면도 — 도어 (바깥에서)", 7.0, weight="bold")
    s.dim_h(ox - Wd/2, ox + Wd/2, oy - Hh/2 - 30, "300", ext_from=oy - Hh/2)
    s.dim_v(oy - Hh/2, oy + Hh/2, ox - Wd/2 - 30, "250", ext_from=ox - Wd/2)
    s.dim_h(ox - fw/2, ox + fw/2, oy - fh/2 - 13, "도어 평탄부 260", ext_from=oy - fh/2)
    s.dim_v(oy - fh/2, oy + fh/2, ox + Wd/2 + 30, "210", ext_from=ox + fw/2)
    s.leader(ox + P["win_w"]/2, oy, ox + Wd/2 + 42, oy + 70, "디스플레이 개구부 176x94 (SH-01)")
    s.leader(ox + Wd/2 - 15, oy - Hh/2 + 20, ox + Wd/2 + 42, oy - 96,
             "탬퍼 볼트 6개소 SUS316 핀-인-톡스")

    # ── 우측면도 (우상) ──
    sx, sy = 190.0, 290.0
    dr.rect("CUT", sx, sy, Dd, Hh)
    dr.line("MARK", sx + Dd/2 - 3, sy - Hh/2, sx + Dd/2 - 3, sy + Hh/2)
    dr.line("MARK", sx - Dd/2 + 15, sy - Hh/2, sx - Dd/2 + 15, sy + Hh/2)
    dr.line("MARK", sx - Dd/2 + 71.5, sy - Hh/2 + 30, sx - Dd/2 + 71.5, sy + Hh/2 - 30)
    s.text(sx, sy + Hh/2 + 24, "우측면도", 7.0, weight="bold")
    s.dim_h(sx - Dd/2, sx + Dd/2, sy - Hh/2 - 30, "150", ext_from=sy - Hh/2)
    s.leader(sx - Dd/2 + 15, sy + 90, sx + Dd/2 + 34, sy + 118, "백플레이트 면 (후면 내벽 +12)")
    s.leader(sx - Dd/2 + 71.5, sy + 30, sx + Dd/2 + 34, sy + 62, "DIN 기기 앞끝 71.5")
    s.leader(sx + Dd/2 - 3, sy - 40, sx + Dd/2 + 34, sy - 20, "도어 3t")
    s.leader(sx + Dd/2 - 28, sy - 90, sx + Dd/2 + 34, sy - 74, "디스플레이 스택 28")

    # ── 후면도 (좌하) — 벽부 ──
    rx, ry = -120.0, -50.0
    dr.rect("CUT", rx, ry, Wd, Hh)
    for bxp in (-Wd/2 + 30, Wd/2 - 30):
        for byp in (-Hh/2 + 30, Hh/2 - 30):
            dr.rect("MARK", rx + bxp, ry + byp, 26, 16)
    s.text(rx, ry + Hh/2 + 24, "후면도 — 벽부 (뚫지 않는다)", 7.0, weight="bold")
    s.dim_h(rx - Wd/2 + 30, rx + Wd/2 - 30, ry - Hh/2 - 30, "브래킷 피치 240",
            ext_from=ry - Hh/2 + 30)
    s.dim_v(ry - Hh/2 + 30, ry + Hh/2 - 30, rx - Wd/2 - 30, "190", ext_from=rx - Wd/2)
    s.leader(rx - Wd/2 + 30, ry + Hh/2 - 30, rx + Wd/2 + 34, ry + 96,
             "제조사 벽부 브래킷 4개소")

    # ── 평면도 (우하) ──
    px, py = 190.0, -50.0
    dr.rect("CUT", px, py, Wd, Dd)
    dr.line("REF", px - Wd/2, py + Dd/2 - 3, px + Wd/2, py + Dd/2 - 3)
    s.text(px, py + Dd/2 + 24, "평면도", 7.0, weight="bold")
    s.dim_v(py - Dd/2, py + Dd/2, px - Wd/2 - 30, "150", ext_from=px - Wd/2)
    s.dim_h(px - Wd/2, px + Wd/2, py - Dd/2 - 30, "300", ext_from=py - Dd/2)
    s.leader(px, py + Dd/2, px + Wd/2 + 20, py + 60, "도어 (힌지 좌측)")

    write(dr, "07-enclosure", "외함 4면도 — 설계 요구 형상", "SH-07", [
        "이 도면은 가공도가 아니라 외함이 만족해야 할 형상이다. 기성품을 고르든",
        "   새로 만들든 이 치수를 만족해야 한다. 구멍 가공은 SH-01, SH-02 를 따른다.",
        "외형 300 x 250 x 150. 내부 유효 최소 250(W) x 220(H) x 120(D).",
        "재질 폴리카보네이트 또는 ABS. 금속 불가 — 파이4 내장 WiFi 가 차폐된다.",
        "도어는 힌지형, 불투명, 나사 체결식. 힌지 좌측.",
        "   원터치 래치 제품은 소비자가 맨손으로 열 수 있어 쓸 수 없다.",
        "도어 평탄부 260 x 210 이 확보되어야 디스플레이 194 x 111 이 앉는다.",
        "백플레이트는 알루미늄, 후면 내벽에서 12 이격. 방열 경로이므로 금속이어야 한다.",
        "면별 용도 — 도어: 디스플레이 / 하면: 커넥터 6 / 후면: 벽부 브래킷.",
        "   좌우면과 상면은 뚫지 않는다. 물이 고여 방수가 깨진다.",
        "IP66 이상. 도어 개스킷은 함체 기본품을 쓰고 균일하게 압축되어야 한다.",
        "색상 밝은 회색(RAL 7035 계열). 검정은 일사 흡수가 커서 내부 온도를 올린다.",
        "설치는 하면이 아래를 향하는 수직 벽부. 눕히거나 뒤집어 달지 않는다.",
        "설계 근거와 검증 기준은 ENCLOSURE.md 를 볼 것.",
    ], ["※ 지금 치수는 가정치다. 함체 확정 후 실측하여 PARAMS 를 갱신할 것."], scale="1:2")


if __name__ == "__main__":
    print("제작도면 생성")
    dwg_door()
    dwg_bottom()
    dwg_backplate()
    dwg_pressframe()
    dwg_sunshield()
    dwg_section()
    dwg_enclosure()
    print("완료 — %s" % OUT)
