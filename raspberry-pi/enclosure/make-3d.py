#!/usr/bin/env python3
"""
3D 조립 모델 생성기 — 수질 모니터링 장비 함체

기성품을 실제 치수대로 함체에 배치해 본 모델입니다.
치수는 make-drawings.py 의 PARAMS 를 그대로 읽어 쓰므로 도면과 어긋나지 않습니다.

    python3 make-3d.py

산출물
    model/enclosure.obj + .mtl   색이 있는 조립 모델 (Blender / Fusion / FreeCAD)
    model/enclosure.stl          단색 메시 (뷰어·프린터용)
    png/3d-*.png                 렌더 미리보기 4장

좌표계 (mm)
    X  좌우   −150 … +150   (정면에서 보아 오른쪽이 +)
    Y  상하      0 … 250    (함체 바닥이 0)
    Z  앞뒤      0 … 150    (함체 후면이 0, 도어가 150)
"""

import importlib.util
import math
import os
import struct
import zlib

OUT = os.path.dirname(os.path.abspath(__file__))

# 도면 생성기의 PARAMS 를 그대로 가져옵니다 (단일 출처)
_spec = importlib.util.spec_from_file_location("mkdwg", os.path.join(OUT, "make-drawings.py"))
_mk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mk)
P = _mk.P

W, H, D = P["enc_w"], P["enc_h"], P["enc_d"]
WALL = 3.0
DOOR_T = 3.0
Z_DOOR = D - DOOR_T          # 도어 내면
BP_Z = WALL + 12.0           # 백플레이트 뒷면 (후면 내벽에서 12 이격)
BP_T = 2.0
CY = H / 2                   # 백플레이트 중심의 Y (함체 좌표)

# 색 (RGB 0~1)
C = {
    "enc":    (0.82, 0.83, 0.80),   # RAL7035 밝은 회색
    "door":   (0.78, 0.79, 0.76),
    "plate":  (0.72, 0.74, 0.77),   # 알루미늄
    "rail":   (0.62, 0.64, 0.67),
    "smps":   (0.90, 0.89, 0.85),   # Mean Well 케이스
    "buck":   (0.86, 0.85, 0.81),
    "term":   (0.55, 0.58, 0.62),
    "fuse":   (0.18, 0.18, 0.20),
    "spd":    (0.20, 0.48, 0.30),
    "pcb":    (0.05, 0.35, 0.22),   # 파이 기판
    "case":   (0.30, 0.32, 0.35),   # 방열 케이스
    "screen": (0.08, 0.08, 0.10),
    "bezel":  (0.15, 0.15, 0.17),
    "metal":  (0.68, 0.70, 0.72),
    "black":  (0.12, 0.12, 0.13),
    "gasket": (0.25, 0.26, 0.30),
    "ssd":    (0.25, 0.27, 0.30),
}


# ══════════════════════════════════════════════════════════════════
#  메시
# ══════════════════════════════════════════════════════════════════
class Part:
    def __init__(self, name, color, group):
        self.name, self.color, self.group = name, color, group
        self.v, self.f = [], []

    def add(self, verts, faces):
        n = len(self.v)
        self.v += verts
        self.f += [[i + n for i in fc] for fc in faces]


def box(part, x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [[0, 2, 1], [0, 3, 2],       # 뒤
         [4, 5, 6], [4, 6, 7],       # 앞
         [0, 1, 5], [0, 5, 4],       # 아래
         [3, 7, 6], [3, 6, 2],       # 위
         [0, 4, 7], [0, 7, 3],       # 왼쪽
         [1, 2, 6], [1, 6, 5]]       # 오른쪽
    part.add(v, f)


def bx(part, cx, cy, cz, w, h, d):
    box(part, cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2)


def cyl(part, cx, cy, cz, r, length, axis="z", seg=20):
    """axis 방향으로 length 만큼 뻗는 원통. (cx,cy,cz) 는 시작면 중심."""
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        du, dv = r * math.cos(a), r * math.sin(a)
        if axis == "z":
            v.append((cx + du, cy + dv, cz)); v.append((cx + du, cy + dv, cz + length))
        elif axis == "y":
            v.append((cx + du, cy, cz + dv)); v.append((cx + du, cy + length, cz + dv))
        else:
            v.append((cx, cy + du, cz + dv)); v.append((cx + length, cy + du, cz + dv))
    for i in range(seg):
        a0, a1 = 2 * i, 2 * ((i + 1) % seg)
        f.append([a0, a1, a1 + 1]); f.append([a0, a1 + 1, a0 + 1])
    c0, c1 = len(v), len(v) + 1
    if axis == "z":
        v.append((cx, cy, cz)); v.append((cx, cy, cz + length))
    elif axis == "y":
        v.append((cx, cy, cz)); v.append((cx, cy + length, cz))
    else:
        v.append((cx, cy, cz)); v.append((cx + length, cy, cz))
    for i in range(seg):
        a0, a1 = 2 * i, 2 * ((i + 1) % seg)
        f.append([c0, a1, a0]); f.append([c1, a0 + 1, a1 + 1])
    part.add(v, f)


# ══════════════════════════════════════════════════════════════════
#  조립
# ══════════════════════════════════════════════════════════════════
def build():
    parts = []

    def P_(name, color, group):
        p = Part(name, color, group); parts.append(p); return p

    # ── 함체 본체 (기성품) ──
    b = P_("enclosure_base", C["enc"], "shell")
    box(b, -W/2, 0, 0, W/2, H, WALL)                                # 후면
    box(b, -W/2, 0, WALL, -W/2 + WALL, H, Z_DOOR)                   # 좌
    box(b,  W/2 - WALL, 0, WALL, W/2, H, Z_DOOR)                    # 우
    box(b, -W/2 + WALL, 0, WALL, W/2 - WALL, WALL, Z_DOOR)          # 하
    box(b, -W/2 + WALL, H - WALL, WALL, W/2 - WALL, H, Z_DOOR)      # 상

    # ── 도어 (개구부 176 x 94) ──
    ow, oh = P["win_w"] / 2, P["win_h"] / 2
    d = P_("door", C["door"], "door")
    box(d, -W/2, CY + oh, Z_DOOR, W/2, H, D)
    box(d, -W/2, 0, Z_DOOR, W/2, CY - oh, D)
    box(d, -W/2, CY - oh, Z_DOOR, -ow, CY + oh, D)
    box(d,  ow, CY - oh, Z_DOOR,  W/2, CY + oh, D)

    # ── 디스플레이 (Raspberry Pi Touch Display 7") ──
    g = P_("gasket", C["gasket"], "door")
    gw, gh = (P["win_w"] + 2 * P["gasket"]) / 2, (P["win_h"] + 2 * P["gasket"]) / 2
    box(g, -gw, CY + oh, Z_DOOR - 2, gw, CY + gh, Z_DOOR)
    box(g, -gw, CY - gh, Z_DOOR - 2, gw, CY - oh, Z_DOOR)
    box(g, -gw, CY - oh, Z_DOOR - 2, -ow, CY + oh, Z_DOOR)
    box(g,  ow, CY - oh, Z_DOOR - 2,  gw, CY + oh, Z_DOOR)

    dsp = P_("display_7in", C["bezel"], "door")
    bx(dsp, 0, CY, Z_DOOR - 2 - 10, P["disp_w"], P["disp_h"], 20)
    scr = P_("display_active_area", C["screen"], "door")
    bx(scr, 0, CY, Z_DOOR - 2 + 0.2, P["act_w"], P["act_h"], 0.4)

    # ── 압착 프레임 (SH-04) + 스탠드오프 ──
    z_frame = Z_DOOR - 2 - 20 - 3          # 디스플레이 뒷면에서 패드 3 뒤
    pf = P_("press_frame", C["plate"], "door")
    fw, fh = P["pf_w"] / 2, P["pf_h"] / 2
    ww, wh = P["pf_win_w"] / 2, P["pf_win_h"] / 2
    box(pf, -fw, CY + wh, z_frame, fw, CY + fh, z_frame + 3)
    box(pf, -fw, CY - fh, z_frame, fw, CY - wh, z_frame + 3)
    box(pf, -fw, CY - wh, z_frame, -ww, CY + wh, z_frame + 3)
    box(pf,  ww, CY - wh, z_frame,  fw, CY + wh, z_frame + 3)

    blt = P_("door_bolt_TR_SUS316", C["metal"], "door")
    for bxp in (-W/2 + 15, W/2 - 15):
        for byp in (20.0, H / 2, H - 20):
            cyl(blt, bxp, byp, D - 0.5, 4.0, 2.5)

    so = P_("standoff_M3", C["metal"], "door")
    for sx in (-P["so_px"] / 2, P["so_px"] / 2):
        for sy in (-P["so_py"] / 2, P["so_py"] / 2):
            cyl(so, sx, CY + sy, z_frame, 4, Z_DOOR - z_frame)

    # ── 백플레이트 ──
    bp = P_("backplate", C["plate"], "interior")
    bx(bp, 0, CY, BP_Z + BP_T / 2, P["bp_w"], P["bp_h"], BP_T)

    z0 = BP_Z + BP_T

    # ── SMPS 12V 60W (메탈케이스형) ──
    sm = P_("SMPS_12V_60W", C["smps"], "interior")
    bx(sm, P["smps_cx"], CY + P["smps_cy"], z0 + P["smps_d"] / 2,
       P["smps_w"], P["smps_h"], P["smps_d"])

    # ── 콘센트 1구 원형 220V ──
    ou = P_("outlet_1gang", C["term"], "interior")
    cyl(ou, P["outlet_cx"], CY + P["outlet_cy"], z0, P["outlet_d"] / 2, 42.0)
    ad = P_("pi_power_adapter", C["black"], "interior")
    bx(ad, P["outlet_cx"], CY + P["outlet_cy"], z0 + 42 + 22, 46, 46, 44)

    # ── 단자대 8P ──
    tb = P_("terminal_block_8P", C["term"], "interior")
    bx(tb, P["tb_cx"], CY + P["tb_cy"], z0 + 11, P["tb_w"], P["tb_h"], 22)

    # ── 도어 뒤: 파이 4 + USB-RS485 (디스플레이 뒷면에 장착) ──
    z_pi = z_frame - 30
    pcb = P_("raspberry_pi_4", C["pcb"], "door")
    bx(pcb, -20, CY - 20, z_pi + 1.5, 85, 56, 3)
    case = P_("pi_heatsink_case", C["case"], "door")
    bx(case, -20, CY - 20, z_pi - 10, 88, 59, 20)
    rs = P_("usb_rs485", C["black"], "door")
    bx(rs, 62, CY - 20, z_pi - 4, 70, 20, 15)
    ssd = P_("usb_ssd", C["ssd"], "door")
    bx(ssd, -20, CY + 32, z_pi - 4, 70, 50, 10)

    # ── 하부면 커넥터 ──
    sp = P["sensor_pitch"]
    cx = P["sensor_cx"]
    conn = [(cx - sp, P["m12_hole_d"], "M12_A_pH"),
            (cx, P["m12_hole_d"], "M12_A_DO"),
            (cx + sp, P["m12_hole_d"], "M12_A_EC"),
            (P["ac_x"], P["m12_hole_d"], "AC_inlet")]
    for cx_, dia, name in conn:
        col = C["black"] if "AC" in name else C["metal"]
        p = P_(name, col, "connector")
        cyl(p, cx_, -14.0, P["conn_y"], dia / 2, 40.0, axis="y")
        cyl(p, cx_, -14.0, P["conn_y"], dia / 2 + 3, 8.0, axis="y")

    return parts


def build_sunshield():
    """차양 — 별도 부품이라 조립 모델에서는 분리해 둡니다."""
    p = Part("sun_shield", C["plate"], "option")
    sw = P["sun_w"] / 2
    top_y = H + 25
    box(p, -sw, top_y, -P["sun_rear"], sw, top_y + 1.5, P["sun_top"] - P["sun_rear"])
    box(p, -sw, top_y - P["sun_drop"], P["sun_top"] - P["sun_rear"] - 1.5,
        sw, top_y + 1.5, P["sun_top"] - P["sun_rear"])
    return [p]


# ══════════════════════════════════════════════════════════════════
#  내보내기
# ══════════════════════════════════════════════════════════════════
def export_obj(parts, base):
    os.makedirs(os.path.join(OUT, "model"), exist_ok=True)
    mtl_name = os.path.basename(base) + ".mtl"
    with open(base + ".mtl", "w") as f:
        for p in parts:
            r, g, b = p.color
            f.write("newmtl %s\nKd %.3f %.3f %.3f\nKa %.3f %.3f %.3f\nKs 0.1 0.1 0.1\nNs 20\n\n"
                    % (p.name, r, g, b, r * 0.3, g * 0.3, b * 0.3))
    with open(base + ".obj", "w") as f:
        f.write("# Shrimp365 수질 모니터링 장비 함체 — 기성품 조립 모델\n")
        f.write("# 단위 mm.  X 좌우 / Y 상하 / Z 앞뒤(0=후면, %d=도어)\n" % D)
        f.write("mtllib %s\n" % mtl_name)
        off = 1
        for p in parts:
            f.write("\ng %s\nusemtl %s\n" % (p.name, p.name))
            for v in p.v:
                f.write("v %.3f %.3f %.3f\n" % v)
            for fc in p.f:
                f.write("f %d %d %d\n" % (fc[0] + off, fc[1] + off, fc[2] + off))
            off += len(p.v)


def export_stl(parts, path):
    tris = []
    for p in parts:
        for fc in p.f:
            a, b, c = (p.v[i] for i in fc)
            u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            w = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            n = (u[1]*w[2] - u[2]*w[1], u[2]*w[0] - u[0]*w[2], u[0]*w[1] - u[1]*w[0])
            L = math.sqrt(sum(t * t for t in n)) or 1.0
            tris.append(((n[0]/L, n[1]/L, n[2]/L), a, b, c))
    with open(path, "wb") as f:
        f.write(b"Shrimp365 enclosure assembly".ljust(80, b"\0"))
        f.write(struct.pack("<I", len(tris)))
        for n, a, b, c in tris:
            f.write(struct.pack("<12fH", *n, *a, *b, *c, 0))
    return len(tris)


# ══════════════════════════════════════════════════════════════════
#  렌더러 (z-버퍼 + 평면 셰이딩, 표준 라이브러리만)
# ══════════════════════════════════════════════════════════════════
def png(path, w, h, buf):
    raw = b"".join(b"\x00" + bytes(buf[y*w*3:(y+1)*w*3]) for y in range(h))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


def norm(v):
    L = math.sqrt(sum(t * t for t in v)) or 1.0
    return (v[0]/L, v[1]/L, v[2]/L)


def render(parts, path, eye, target, w=1000, h=750, fov=32.0, bg=(0.96, 0.96, 0.97)):
    up = (0, 1, 0)
    fwd = norm((target[0]-eye[0], target[1]-eye[1], target[2]-eye[2]))
    rgt = norm((fwd[1]*up[2]-fwd[2]*up[1], fwd[2]*up[0]-fwd[0]*up[2], fwd[0]*up[1]-fwd[1]*up[0]))
    tup = (rgt[1]*fwd[2]-rgt[2]*fwd[1], rgt[2]*fwd[0]-rgt[0]*fwd[2], rgt[0]*fwd[1]-rgt[1]*fwd[0])
    F = (w / 2) / math.tan(math.radians(fov) / 2)
    cx, cy = w / 2, h / 2
    light = norm((-0.45, 0.75, -0.5))

    buf = bytearray(int(255 * bg[i % 3]) for i in range(w * h * 3))
    zb = [0.0] * (w * h)          # 1/z 를 담습니다. 클수록 가깝습니다.

    def proj(p):
        """화면좌표와 1/z 를 돌려줍니다. 깊이는 반드시 1/z 로 보간해야
        큰 면(도어 등)의 안쪽에서 깊이가 어긋나지 않습니다."""
        dx, dy, dz = p[0]-eye[0], p[1]-eye[1], p[2]-eye[2]
        z = dx*fwd[0] + dy*fwd[1] + dz*fwd[2]
        if z <= 1.0:
            return None
        x = dx*rgt[0] + dy*rgt[1] + dz*rgt[2]
        y = dx*tup[0] + dy*tup[1] + dz*tup[2]
        return (cx + F * x / z, cy - F * y / z, 1.0 / z)

    for p in parts:
        pr = [proj(v) for v in p.v]
        for fc in p.f:
            s = [pr[i] for i in fc]
            if None in s:
                continue
            a, b, c = (p.v[i] for i in fc)
            u = (b[0]-a[0], b[1]-a[1], b[2]-a[2])
            v2 = (c[0]-a[0], c[1]-a[1], c[2]-a[2])
            n = norm((u[1]*v2[2]-u[2]*v2[1], u[2]*v2[0]-u[0]*v2[2], u[0]*v2[1]-u[1]*v2[0]))
            lam = abs(n[0]*light[0] + n[1]*light[1] + n[2]*light[2])
            sh = 0.34 + 0.66 * lam
            col = tuple(min(255, int(255 * min(1.0, ch * sh))) for ch in p.color)

            x0 = max(0, int(min(q[0] for q in s))); x1 = min(w-1, int(max(q[0] for q in s)) + 1)
            y0 = max(0, int(min(q[1] for q in s))); y1 = min(h-1, int(max(q[1] for q in s)) + 1)
            if x1 < x0 or y1 < y0:
                continue
            (ax, ay, aq), (bx_, by, bq), (cx_, cy_, cq) = s
            det = (by - cy_) * (ax - cx_) + (cx_ - bx_) * (ay - cy_)
            if abs(det) < 1e-9:
                continue
            for py in range(y0, y1 + 1):
                yy = py + 0.5
                row = py * w
                for px in range(x0, x1 + 1):
                    xx = px + 0.5
                    l1 = ((by - cy_) * (xx - cx_) + (cx_ - bx_) * (yy - cy_)) / det
                    if l1 < 0 or l1 > 1:
                        continue
                    l2 = ((cy_ - ay) * (xx - cx_) + (ax - cx_) * (yy - cy_)) / det
                    if l2 < 0 or l1 + l2 > 1:
                        continue
                    q = l1 * aq + l2 * bq + (1 - l1 - l2) * cq   # 1/z 보간
                    if q > zb[row + px]:
                        zb[row + px] = q
                        i = (row + px) * 3
                        buf[i], buf[i+1], buf[i+2] = col
    png(path, w, h, buf)


def explode(parts, factor=1.0):
    """조립 순서대로 뒤 → 앞으로 벌립니다. 커넥터는 아래로 빼서
    하부면에 밖에서 끼운다는 것이 보이게 합니다."""
    off = {"shell":     (0.0, 0.0, 0.0),
           "connector": (0.0, -80.0, 0.0),
           "interior":  (0.0, 0.0, 190.0),
           "door":      (0.0, 0.0, 350.0),
           "option":    (0.0, 0.0, 0.0)}
    out = []
    for p in parts:
        dx, dy, dz = (t * factor for t in off.get(p.group, (0.0, 0.0, 0.0)))
        q = Part(p.name, p.color, p.group)
        q.v = [(v[0] + dx, v[1] + dy, v[2] + dz) for v in p.v]
        q.f = list(p.f)
        out.append(q)
    return out


if __name__ == "__main__":
    parts = build()
    shield = build_sunshield()
    os.makedirs(os.path.join(OUT, "model"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "png"), exist_ok=True)

    base = os.path.join(OUT, "model", "enclosure")
    export_obj(parts + shield, base)
    ntri = export_stl(parts, base + ".stl")
    print("model/enclosure.obj + .mtl  (부품 %d개)" % len(parts))
    print("model/enclosure.stl         (삼각형 %d개)" % ntri)

    ctr = (0, H / 2, D / 2)
    views = [
        ("3d-01-front",    (0, 128, 980),    (0, H/2, 75),  parts),
        ("3d-02-iso",      (620, 480, 780),  (0, H/2, 60),  parts),
        ("3d-03-interior", (330, 430, 700),  (0, 120, 45),
         [p for p in parts if p.group != "door"]),
        ("3d-04-exploded", (820, 560, 1180), (0, 110, 210), explode(parts)),
        ("3d-05-connectors", (300, -300, 820), (0, 70, 95), parts),
    ]
    for name, eye, tgt, ps in views:
        render(ps, os.path.join(OUT, "png", name + ".png"), eye, tgt)
        print("png/%s.png" % name)
