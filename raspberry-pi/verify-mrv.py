"""전력 수기 입력(탄소 MRV) 경로를 **가짜 서버에 붙여** 실제로 돌려 본다.

    python3 raspberry-pi/verify-mrv.py

**verify.py 와 별 파일인 이유.** 이 시험은 127.0.0.1 에 가짜 HTTP 서버를 세우고
페어링·목록 조회·전송을 왕복한다. verify.py 는 그 반대로 **네트워크를 전혀 쓰지
않아야** 하는 파일이다 — 성능검증 자리에서, 인터넷이 없는 현장 장비에서 그대로
돌려 판정(limits/anomaly/advice)과 설정 쓰기를 보여 주는 것이 그 파일의 일이다.
둘을 합치면 포트를 열 수 없는 장비에서 verify.py 전체가 실패한다. 그래서 가짜
서버가 필요한 시험만 여기에 모으고, 두 파일을 섞지 않는다.

여기서 보는 것: ①~⑤ 설계 결정이 코드에서 실제로 지켜지는지 — 2건 규칙,
시계 거부, 음수 거부, 오프라인 보관과 순서 보존, 목록 밖 계측기, 페어링,
운전 모드, MRV 기본 화면 값, 그리고 ⑨ 「이 장비가 읽을 계측기」 거르개의
설정 파일 왕복.
"""
import atexit, json, shutil, sys, tempfile, threading, types
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# pyserial 은 이 PC 에 없다. MODBUS 를 쓰지 않는 함수만 시험하므로 자리만 채운다.
fake = types.ModuleType("serial")
fake.SerialException = type("SerialException", (OSError,), {})
fake.Serial = object
fake.PARITY_NONE = "N"; fake.STOPBITS_ONE = 1; fake.EIGHTBITS = 8
sys.modules.setdefault("serial", fake)

import buffer as buffer_mod      # noqa: E402
import configparser             # noqa: E402
import modes                    # noqa: E402
import shrimp365_sensor as S     # noqa: E402

LOG = []          # 서버가 받은 readings 배치
STORED = set()    # (meter_id, ts) — 저장된 것. 서버의 멱등 판정을 흉내 낸다.
PREV = {}         # meter_id → 마지막 적산 원값 (배치 경계 판정용)
CLAIM = {"linked": False}
# 가짜 서버가 본 규약 위반. **핸들러에서 assert 로 터뜨리지 않는다** — 핸들러는
# 작업 스레드에서 돌므로 거기서 터지면 연결만 끊기고, 그 모습이 **엉뚱한 검사의
# FAIL** 로 나타난다(키가 안 붙은 것이 "회선이 돌아오면 전부 올라간다" 의 실패로
# 보인다). 여기에 적어 두고 끝에서 한 번에 판정한다.
BAD = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _keyed(self, path):
        """수집 키가 붙었는가. 안 붙었으면 **서버처럼 401 로 답한다.**"""
        if self.headers.get("X-API-Key") == "mrvk_secret":
            return True
        BAD.append(f"{path}: 수집 키가 안 붙었다")
        self._json(401, {"error": "키가 안 붙었다"})
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/mrv/pair":
            if not CLAIM["linked"]:
                return self._json(200, {"status": "pending"})
            return self._json(200, {"status": "linked", "api_key": "mrvk_secret",
                                    "site_id": "site_1", "org_id": "org_1"})
        if path == "/api/mrv/ingest/meters":
            if not self._keyed(path):
                return None
            return self._json(200, {"site_id": "site_1", "items": [
                {"id": "m_total", "label": "총전력계", "unit": "kWh_interval", "is_aeration": False},
                {"id": "m_blow", "label": "브로워", "unit": "kWh_interval", "is_aeration": True},
            ]})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if path == "/api/mrv/pair":
            return self._json(201, {"code": "730412", "pairing_secret": "s" * 40,
                                    "expires_in_sec": 900})
        if path == "/api/mrv/ingest/readings":
            if not self._keyed(path):
                return None
            if body.get("source") != "manual":
                BAD.append(f"{path}: source 가 manual 이 아니다 — {body.get('source')!r}")
                return self._json(400, {"error": "source 가 manual 이 아니다"})
            # ⑩ **모든 건이 자료유형을 선언해야 한다.** 장비가 적지 않으면 서버가
            # "장비에서 왔으니 실측이겠지" 하고 가정하게 되고, 가정이 사실로 굳는 날
            # 증빙이 무너진다. 그래서 여기서 규약으로 본다 — 전송 경로에서 이 칸을
            # 빼면(또는 재전송이 옛 보관분을 채우지 않으면) 그 자리에서 FAIL 한다.
            for i, r in enumerate(body["readings"]):
                got = r.get("measurement_basis")
                if got not in S.MRV_BASES:
                    BAD.append(f"{path}: readings[{i}] 자료유형이 없거나 모르는 값 — {got!r}")
            LOG.append(body["readings"])
            # ADR 0001 의 배치 경계 규칙을 그대로 흉내 낸다.
            acc = ded = 0
            q = {"ok": 0, "suspect": 0, "bad": 0}
            prev_in_batch = {}
            for r in sorted(body["readings"], key=lambda x: x["ts"]):
                key = (r["meter_id"], r["ts"])
                if key in STORED:
                    ded += 1
                    prev_in_batch[r["meter_id"]] = r["value"]
                    continue
                if r["reading_kind"] == "cumulative_kwh":
                    p = prev_in_batch.get(r["meter_id"])
                    if p is not None:
                        q["ok"] += 1
                    elif r["meter_id"] in PREV:
                        q["suspect"] += 1
                    else:
                        q["bad"] += 1
                    prev_in_batch[r["meter_id"]] = r["value"]
                    PREV[r["meter_id"]] = r["value"]
                else:
                    q["ok" if r["value"] >= 0 else "suspect"] += 1
                STORED.add(key)
                acc += 1
            return self._json(200, {"accepted": acc, "deduped": ded, "rejected": [],
                                    "quality": q})
        self._json(404, {"error": "not found"})


srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"

tmp = Path(tempfile.mkdtemp(prefix="shrimp365-verify-mrv-"))
fails = []


@atexit.register
def _clean_up():
    """임시 디렉토리와 가짜 서버를 치운다. **실패로 sys.exit(1) 할 때도 치운다** —
    자체점검은 몇 번이고 다시 돌리는 파일이다. shutdown() 만 하고 server_close()
    를 빠뜨리면 듣던 소켓이 남는다."""
    try:
        srv.shutdown()
        srv.server_close()
    except Exception:          # noqa: BLE001 — 치우는 길에서 더 시끄러워질 이유가 없다
        pass
    shutil.rmtree(tmp, ignore_errors=True)


def _cfg_get(path, section, key):
    """설정 파일에서 한 값을 읽는다. configparser 로 읽어야 "파일에 남았다" 가
    장비가 다음 부팅에 읽는 것과 같은 뜻이 된다."""
    # interpolation=None — 장비의 load_config 와 같게 읽는다. 기본값으로 읽으면
    # 값에 섞인 `%` 하나로 이 시험 자체가 터져, 무엇이 깨졌는지 가린다.
    c = configparser.ConfigParser(interpolation=None)
    c.read(path, encoding="utf-8")
    return (c.get(section, key, fallback="") or "").strip()


def check(label, got, want):
    ok = got == want
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + ("" if ok else f"\n        받음 {got!r} / 기대 {want!r}"))
    if not ok:
        fails.append(label)


print("\n① 지침은 직전 값과 함께 2건으로 보낸다")
lasts = S.MrvLastReadings(tmp / "last.json")
r1 = S.mrv_submit_power(BASE, "mrvk_secret", "m_total", 1000.0, "cumulative_kwh", lasts)
check("첫 지침은 1건만 간다", len(LOG[-1]), 1)
check("첫 지침은 기준점이다(baseline)", r1["baseline"], True)
check("첫 지침은 산입되지 않는다", r1["countable"], False)
r2 = S.mrv_submit_power(BASE, "mrvk_secret", "m_total", 1120.5, "cumulative_kwh", lasts)
check("두 번째 지침은 2건이 간다", len(LOG[-1]), 2)
check("직전 지침이 앞에 실린다", LOG[-1][0]["value"], 1000.0)
check("직전 건은 중복으로 흡수된다", r2["deduped"], 1)
check("새 건은 산입된다(quality.ok)", (r2["quality"]["ok"], r2["countable"]), (1, True))
check("두 번째는 기준점이 아니다", r2["baseline"], False)
r3 = S.mrv_submit_power(BASE, "mrvk_secret", "m_blow", 50.0, "interval_kwh", lasts)
check("구간 사용량은 1건만 간다", len(LOG[-1]), 1)
check("구간 사용량은 바로 산입된다", r3["countable"], True)
check("구간 사용량은 직전 지침 사슬을 건드리지 않는다",
      (lasts.get("m_blow").get("value"), lasts.has_reading("m_blow")), (None, False))
r4 = S.mrv_submit_power(BASE, "mrvk_secret", "m_total", 1200.0, "cumulative_kwh", lasts)
check("사용량을 중간에 넣어도 지침 사슬은 이어진다",
      (len(LOG[-1]), LOG[-1][0]["value"], r4["countable"]), (2, 1120.5, True))
check("같은 초에 두 건을 넣어도 뒤 건이 사라지지 않는다",
      (r4["accepted"], LOG[-1][0]["ts"] != LOG[-1][1]["ts"]), (1, True))

print("\n② 시계가 수상하면 보내지 않는다")
check("2024년은 거부", S.mrv_clock_ok(datetime(2024, 12, 31, tzinfo=timezone.utc)), False)
check("1970년은 거부", S.mrv_clock_ok(datetime(1970, 1, 1, tzinfo=timezone.utc)), False)
check("2025년은 통과", S.mrv_clock_ok(datetime(2025, 1, 1, tzinfo=timezone.utc)), True)
check("지금은 통과", S.mrv_clock_ok(), True)

real_clock = S.mrv_clock_ok
S.mrv_clock_ok = lambda now=None: False
store_c = buffer_mod.Buffer(tmp / "clock.db")
before = len(LOG)
rc = S.mrv_submit_power(BASE, "mrvk_secret", "m_total", 1200.0, "cumulative_kwh",
                        lasts, store_c)
check("시계가 틀리면 전송하지 않는다", (rc["ok"], len(LOG) == before), (False, True))
check("시계가 틀리면 버퍼에도 쌓지 않는다", store_c.pending(), 0)
check("사유를 화면에 줄 수 있다", rc["code"], "clock")
S.mrv_clock_ok = real_clock

print("\n③ 0 은 받고 음수는 거부한다")
r0 = S.mrv_submit_power(BASE, "mrvk_secret", "m_blow", 0.0, "interval_kwh", lasts)
check("구간 사용량 0 kWh 는 저장된다", (r0["ok"], r0["accepted"]), (True, 1))
rn = S.mrv_submit_power(BASE, "mrvk_secret", "m_blow", -1.0, "interval_kwh", lasts)
check("음수는 거부", (rn["ok"], rn["code"]), (False, "negative"))
rz = S.mrv_submit_power(BASE, "mrvk_secret", "m_zero", 0.0, "cumulative_kwh", lasts)
check("적산 지침 0 도 받는다(새 계량기)", rz["ok"], True)

print("\n④ 회선이 끊겨도 지침이 유실되지 않는다")
store = buffer_mod.Buffer(tmp / "mrv-power.db")
check("전력 보관함은 수질 큐와 다른 파일", store.path.name, "mrv-power.db")
DEAD = "http://127.0.0.1:9"      # 아무것도 듣지 않는 포트
q1 = S.mrv_submit_power(DEAD, "mrvk_secret", "m_total", 1300.0, "cumulative_kwh", lasts, store)
check("전송 실패 시 보관한다", (q1["ok"], q1["queued"]), (False, True))
q2 = S.mrv_submit_power(DEAD, "mrvk_secret", "m_total", 1400.0, "cumulative_kwh", lasts, store)
check("두 건 모두 보관된다", store.pending(), 2)
check("보관 중에는 직접 보내지 않는다(순서 보존)", q2.get("queued"), True)
sent = S.mrv_flush(store, BASE, "mrvk_secret", 20, lambda: False)
check("회선이 돌아오면 전부 올라간다", (sent, store.pending()), (2, 0))
check("순서대로 올라갔다", [r[-1]["value"] for r in LOG[-2:]], [1300.0, 1400.0])
check("사슬이 이어졌다(직전 지침이 함께)",
      [r[0]["value"] for r in LOG[-2:]], [1200.0, 1300.0])

print("\n⑤ 계측기는 목록에서만 — 목록 조회")
meters = S.mrv_fetch_meters(BASE, "mrvk_secret")
check("목록을 받는다", [m["id"] for m in meters["items"]], ["m_total", "m_blow"])
check("폭기 여부가 함께 온다", [m["is_aeration"] for m in meters["items"]], [False, True])
check("키가 없으면 조회하지 않는다", S.mrv_fetch_meters(BASE, "")["ok"], False)

print("\n⑥ 페어링 — 코드 받기 → 승인 → 키 저장")
cfg = tmp / "config.ini"
cfg.write_text("[mrv]\napi_key =\nsite_id =\n", encoding="utf-8")
CLAIM["linked"] = True
got = {}
key = S.mrv_run_pairing(BASE, "serial-1", cfg, None, lambda: False,
                        on_linked=lambda k, s: got.update(key=k, site=s))
check("원문 키를 받는다", key, "mrvk_secret")
check("콜백으로 알린다", (got.get("key"), got.get("site")), ("mrvk_secret", "site_1"))
text = cfg.read_text(encoding="utf-8")
check("config [mrv] 에 저장된다",
      ("api_key = mrvk_secret" in text, "site_id = site_1" in text), (True, True))
check("연결 해제는 비워 쓴다",
      (S.save_mrv_api_key(cfg, "", ""),
       "api_key = \n" in cfg.read_text(encoding="utf-8")), (True, True))
check("[mrv] 가 없는 옛 설정 파일에도 만들어 붙인다",
      (lambda p: (p.write_text("[server]\ndevice_key = x\n", encoding="utf-8"),
                  S.save_mrv_api_key(p, "k2", "s2"),
                  "[mrv]" in p.read_text(encoding="utf-8"))[1:])(tmp / "old.ini"),
      (True, True))
check("수질 device_key 를 건드리지 않는다",
      "device_key = x" in (tmp / "old.ini").read_text(encoding="utf-8"), True)

print("\n⑦ 운전 모드 — 설정 파일 왕복")
# main() 이 하는 것과 같은 길: [device] mode 를 읽고, 없으면 [nutrient] enabled 로 추론.
def resolve_from(text):
    cfg = configparser.ConfigParser()
    cfg.read_string(text)
    declared = cfg.get("device", "mode", fallback="") if cfg.has_section("device") else ""
    nut = cfg.getboolean("nutrient", "enabled", fallback=False) \
        if cfg.has_section("nutrient") else False
    return modes.resolve(declared, nut)

check("기존 양식장 설치(모드 없음·양액 끔)",
      resolve_from("[nutrient]\nenabled = false\n"), "aquaculture")
check("기존 수경재배 설치(모드 없음·양액 켬)",
      resolve_from("[nutrient]\nenabled = true\n"), "smartfarm")
check("[nutrient] 구간조차 없는 설치", resolve_from("[server]\nendpoint = x\n"), "aquaculture")
check("모드가 적혀 있으면 양액 플래그를 이긴다",
      resolve_from("[device]\nmode = mrv\n[nutrient]\nenabled = true\n"), "mrv")

cfg2 = tmp / "mode.ini"
cfg2.write_text("; 머리말\n[server]\nendpoint = x\n[nutrient]\nenabled = false\n",
                encoding="utf-8")
check("[device] 가 없으면 만들어 붙인다",
      (S.save_mode(cfg2, "mrv"), resolve_from(cfg2.read_text(encoding="utf-8"))),
      (True, "mrv"))
check("머리말 주석을 가리지 않는다",
      cfg2.read_text(encoding="utf-8").startswith("; 머리말"), True)
check("두 번째 변경은 그 줄만 고친다",
      (S.save_mode(cfg2, "smartfarm"),
       cfg2.read_text(encoding="utf-8").count("mode ="),
       resolve_from(cfg2.read_text(encoding="utf-8"))), (True, 1, "smartfarm"))
check("예시 설정 파일은 양식장으로 읽힌다",
      resolve_from((HERE / "config.example.ini").read_text(encoding="utf-8")), "aquaculture")

print("\n⑧ MRV 기본 화면이 쓸 값")
lasts2 = S.MrvLastReadings(tmp / "home.json")
meters2 = [{"id": "m_total", "label": "총전력계", "is_aeration": False},
           {"id": "m_blow", "label": "브로워", "is_aeration": True}]
check("보낸 적 없으면 줄이 없다", S.mrv_recent_rows(meters2, lasts2), [])
S.mrv_submit_power(BASE, "mrvk_secret", "m_total", 9000.0, "cumulative_kwh", lasts2)
rows = S.mrv_recent_rows(meters2, lasts2)
check("보낸 계측기만 줄이 선다", [(r["id"], r["value"]) for r in rows], [("m_total", 9000.0)])
check("시각은 지역 시각으로 적는다", len(rows[0]["at"]), len("10-18 09:12"))
check("오늘 보낸 건수가 센다", lasts2.today(), 1)
check("재시작해도 남는다", S.MrvLastReadings(tmp / "home.json").today(), 1)
check("옛 모양 파일(계측기 지도만)도 읽는다",
      (lambda f: (f.write_text('{"m_total": {"value": 10.0, "ts": "2026-10-18T00:00:00+00:00"}}',
                               encoding="utf-8"),
                  S.MrvLastReadings(f).has_reading("m_total"))[1])(tmp / "old.json"), True)

print("\n⑨ 「이 장비가 읽을 계측기」 — 화면 거르개의 설정 파일 왕복")
# 거르개는 **화면에만** 적용된다. 그래도 설정 파일 왕복이 깨지면 작업자가 고른
# 것이 재부팅과 함께 사라지고, 15대가 다시 전부 뜬다. 그래서 여기서 왕복한다.
SERVER_METERS = [{"id": "m_total", "label": "총전력계"},
                 {"id": "m_blow", "label": "브로워"}]

check("빈 값은 '전부 보여 준다' 로 읽는다", S.mrv_parse_visible(""), [])
check("공백만 있는 값도 전부", S.mrv_parse_visible("   "), [])
check("쉼표·공백 섞인 값을 읽는다",
      S.mrv_parse_visible(" m_total, m_blow  m_pump "), ["m_total", "m_blow", "m_pump"])
check("같은 id 를 두 번 적어도 한 번만", S.mrv_parse_visible("m_a, m_a"), ["m_a"])
check("상한을 넘기지 않는다",
      len(S.mrv_parse_visible(", ".join(f"m{i}" for i in range(S.MRV_VISIBLE_MAX + 9)))),
      S.MRV_VISIBLE_MAX)

vcfg = tmp / "visible.ini"
vcfg.write_text("; 머리말\n[mrv]\napi_key = k\nbuffer_path = /var/lib/x.db\n"
                "[update]\nenabled = true\n", encoding="utf-8")
check("[mrv] 안에 항목을 만들어 넣는다",
      (S.save_mrv_visible_meters(vcfg, ["m_total", "m_blow"]),
       S.mrv_parse_visible(_cfg_get(vcfg, "mrv", "visible_meters"))),
      (True, ["m_total", "m_blow"]))
check("뒤 구간([update])을 밀어내지 않는다",
      _cfg_get(vcfg, "update", "enabled"), "true")
check("앞 줄(buffer_path)이 깨지지 않는다",
      _cfg_get(vcfg, "mrv", "buffer_path"), "/var/lib/x.db")
check("머리말 주석을 지우지 않는다",
      vcfg.read_text(encoding="utf-8").startswith("; 머리말"), True)
check("두 번째 저장은 그 줄만 고친다",
      (S.save_mrv_visible_meters(vcfg, ["m_blow"]),
       vcfg.read_text(encoding="utf-8").count("visible_meters"),
       S.mrv_parse_visible(_cfg_get(vcfg, "mrv", "visible_meters"))),
      (True, 1, ["m_blow"]))
check("전부 끄면 빈 값으로 남는다 — 항목을 지우지 않는다",
      (S.save_mrv_visible_meters(vcfg, []),
       "visible_meters" in vcfg.read_text(encoding="utf-8"),
       S.mrv_parse_visible(_cfg_get(vcfg, "mrv", "visible_meters"))),
      (True, True, []))

# 끝 개행이 없는 파일. _append_config_lines() 를 거치지 않으면 앞 줄과 뭉쳐
# buffer_path 까지 깨진다(그 함수 머리말의 실제 사고).
nl = tmp / "visible-nonl.ini"
nl.write_text("[mrv]\napi_key = k\nbuffer_path = /var/lib/x.db", encoding="utf-8")
check("끝 개행이 없는 [mrv] 에도 줄을 잃지 않고 붙인다",
      (S.save_mrv_visible_meters(nl, ["m_total"]),
       _cfg_get(nl, "mrv", "buffer_path"),
       S.mrv_parse_visible(_cfg_get(nl, "mrv", "visible_meters"))),
      (True, "/var/lib/x.db", ["m_total"]))

old = tmp / "visible-old.ini"
old.write_text("[server]\ndevice_key = x\n", encoding="utf-8")
check("[mrv] 가 없는 옛 설정 파일에는 구간을 만들어 붙인다",
      (S.save_mrv_visible_meters(old, ["m_total"]),
       S.mrv_parse_visible(_cfg_get(old, "mrv", "visible_meters")),
       _cfg_get(old, "server", "device_key")),
      (True, ["m_total"], "x"))

check("고른 것이 전부 살아 있으면 사라진 것은 없다",
      S.mrv_missing_visible(SERVER_METERS, ["m_total", "m_blow"]), [])
check("운영자가 웹에서 지운 계측기를 집어낸다",
      S.mrv_missing_visible(SERVER_METERS, ["m_total", "m_gone"]), ["m_gone"])
check("아무것도 고르지 않았으면 사라진 것도 없다",
      S.mrv_missing_visible(SERVER_METERS, []), [])
check("목록이 비어 있으면 고른 것 전부가 사라진 것으로 보인다(호출부가 가린다)",
      S.mrv_missing_visible([], ["m_total"]), ["m_total"])

# 설정 파일에 적어 두었던 id 가 서버 목록에서 사라진 그림. 저장 → 다시 읽기 →
# 사라진 계측기 처리까지가 한 왕복이다.
rt = tmp / "visible-rt.ini"
rt.write_text("[mrv]\napi_key = k\n", encoding="utf-8")
S.save_mrv_visible_meters(rt, ["m_total", "m_pump9"])
reread = S.mrv_parse_visible(_cfg_get(rt, "mrv", "visible_meters"))
check("다시 읽어도 고른 순서가 그대로", reread, ["m_total", "m_pump9"])
check("다시 읽은 값으로 사라진 계측기를 알아낸다",
      S.mrv_missing_visible(S.mrv_fetch_meters(BASE, "mrvk_secret")["items"], reread),
      ["m_pump9"])

# 손으로 적은 값. configparser 는 기본값에서 인라인 주석을 떼지 않으므로, 이 줄들이
# 그대로 값으로 들어와 조각마다 "서버 목록에 없는 계측기" 가 된다. 그러면 빨간
# 「고른 계측기 4대가 서버 목록에 없습니다」가 **상시** 뜨고, 거짓 경고가 뜨는 화면에서
# 진짜 경고는 묻힌다. config.example.ini 가 손 편집을 권하므로 현실적인 입력이다.
check("꼬리 주석(;)을 떼고 읽는다",
      S.mrv_parse_visible("m_total  ; 매일 읽는 것"), ["m_total"])
check("꼬리 주석(#)을 떼고 읽는다",
      S.mrv_parse_visible("m_total  # 메모"), ["m_total"])
check("따옴표를 떼고 읽는다",
      S.mrv_parse_visible('"m_total", "m_blow"'), ["m_total", "m_blow"])
check("홑따옴표도 뗀다", S.mrv_parse_visible("'m_total'"), ["m_total"])
check("주석만 있는 값은 전부 보여 준다로 읽는다",
      S.mrv_parse_visible("; 아직 안 골랐다"), [])
check("손으로 적은 값이 거짓 경고를 만들지 않는다",
      S.mrv_missing_visible(SERVER_METERS,
                            S.mrv_parse_visible('"m_total", "m_blow"  ; 매일 읽는 것')), [])

# 꼬리 주석이 붙은 [mrv] 머리글. 구간을 못 찾으면 파일 끝에 [mrv] 를 하나 더 만들어
# 붙이고, 다음 부팅이 DuplicateSectionError 로 터져 장비가 15초마다 재시작한다.
tail = tmp / "visible-tail.ini"
tail.write_text("[mrv]   ; 탄소 MRV\napi_key = k\nvisible_meters_note = 매일 읽는 것\n",
                encoding="utf-8")
check("꼬리 주석이 붙은 [mrv] 안에 적는다 — 구간을 두 번 만들지 않는다",
      (S.save_mrv_visible_meters(tail, ["m_total"]),
       tail.read_text(encoding="utf-8").count("[mrv]"),
       S.mrv_parse_visible(_cfg_get(tail, "mrv", "visible_meters"))),
      (True, 1, ["m_total"]))
check("사람이 적어 둔 옆 항목(visible_meters_note)을 지우지 않는다",
      _cfg_get(tail, "mrv", "visible_meters_note"), "매일 읽는 것")

print("\n⑩ 전력 자료유형 — 보관→재전송 왕복에서 살아남는가")
# 실측과 계산값은 둘 다 유효한 증빙이지만 같은 증빙이 아니다. 장비가 적지 않으면
# 서버가 "장비에서 왔으니 실측이겠지" 하고 가정하게 되므로 장비가 선언한다.
# 위 가짜 서버가 **모든 건**의 자료유형을 규약으로 보고 있으므로, ①~⑤ 가 통과한
# 것 자체가 전송 경로에 이 칸이 실렸다는 뜻이다. 여기서는 그 값이 무엇인지와
# **보관함을 거친 뒤에도 남는지**를 본다.
# 계측기 id 를 이 절 전용으로 둔다. 위 절들이 m_total 로 쓴 (계측기, 시각)이 가짜
# 서버에 남아 있어, 새 lasts 파일로 같은 id 를 다시 쓰면 그 시각이 겹쳐 **중복으로
# 흡수된다** — 그러면 이 절의 FAIL 이 자료유형과 무관한 이유로 뜬다.
lastsb = S.MrvLastReadings(tmp / "basis-last.json")
rb1 = S.mrv_submit_power(BASE, "mrvk_secret", "m_bas_a", 2000.0, "cumulative_kwh", lastsb)
check("이 단말은 실측으로 선언한다",
      [r.get("measurement_basis") for r in LOG[-1]], ["metered"])
rb2 = S.mrv_submit_power(BASE, "mrvk_secret", "m_bas_a", 2100.0, "cumulative_kwh", lastsb)
check("함께 싣는 직전 지침에도 적힌다(2건 모두)",
      [r.get("measurement_basis") for r in LOG[-1]], ["metered", "metered"])
check("자료유형이 2건 규칙을 깨지 않는다", (len(LOG[-1]), rb2["countable"]), (2, True))

# 설정으로 계산값 단말로 세운 경우. 화면이 그 사실을 적고(pw_basis_calculated),
# 전송도 그 값으로 간다 — 계량기 옆이 아닌 자리에 놓인 단말이 거짓 실측을 쌓지
# 않게 하는 길이 이것뿐이다(화면에서 건마다 고르게 하지 않는다 — 오터치가 흔적 없이
# 실측과 계산값을 뒤바꾼다).
rb3 = S.mrv_submit_power(BASE, "mrvk_secret", "m_bas_b", 70.0, "interval_kwh",
                         lastsb, None, "calculated")
check("설정이 계산값이면 계산값으로 간다",
      [r.get("measurement_basis") for r in LOG[-1]], ["calculated"])
check("계산값도 정상적으로 저장된다", (rb3["ok"], rb3["accepted"]), (True, 1))
# 모르는 값에서 입을 닫지 않는다 — 오타 하나로 증빙 입력이 끊기는 쪽이 더 나쁘다.
rb4 = S.mrv_submit_power(BASE, "mrvk_secret", "m_bas_b", 71.0, "interval_kwh",
                         lastsb, None, "metered_ish")
check("모르는 자료유형은 기본값으로 적고 보낸다",
      (rb4["ok"], [r.get("measurement_basis") for r in LOG[-1]]), (True, ["metered"]))

# **회선이 끊긴 동안 쌓인 건.** 보관함에 들어가는 payload 에 이 칸이 없으면, 회선이
# 돌아온 뒤 올라가는 지침들만 조용히 미기재가 된다 — 끊긴 현장일수록 증빙이 비는
# 쪽이 되므로 가장 나쁜 방향이다. 디스크에 적힌 것을 직접 본다.
storeb = buffer_mod.Buffer(tmp / "basis-queue.db")
qb = S.mrv_submit_power(DEAD, "mrvk_secret", "m_bas_a", 2200.0, "cumulative_kwh",
                        lastsb, storeb)
check("회선이 끊기면 보관된다", (qb["ok"], qb["queued"]), (False, True))
check("보관함에 적힌 payload 에도 자료유형이 있다",
      [r.get("measurement_basis")
       for _i, _at, pay in storeb.take(10) for r in pay["readings"]],
      ["metered", "metered"])
sentb = S.mrv_flush(storeb, BASE, "mrvk_secret", 20, lambda: False)
check("회선이 돌아오면 자료유형째로 올라간다",
      (sentb, [r.get("measurement_basis") for r in LOG[-1]]), (1, ["metered", "metered"]))

# **옛 보관분** — 이 칸이 생기기 전에 쌓인 행. 회선이 몇 시간 끊긴 현장에서
# 업데이트가 올라가면 실제로 이 모양이 큐에 남아 있다. 그 건들도 작업자가 계량기를
# 읽어 넣은 값이므로 채워 보낸다(미기재로 올리면 근거를 댈 수 없는 행이 된다).
# 가짜 서버의 규약 검사가 채워지지 않은 건을 그대로 잡는다.
storeo = buffer_mod.Buffer(tmp / "basis-old.db")
storeo.append({"source": "manual", "readings": [
    {"meter_id": "m_bas_a", "ts": "2026-10-20T03:00:00+00:00", "value": 2300.0,
     "reading_kind": "cumulative_kwh"}]}, "2026-10-20T03:00:00+00:00")
sento = S.mrv_flush(storeo, BASE, "mrvk_secret", 20, lambda: False)
check("옛 보관분도 올라간다", (sento, storeo.pending()), (1, 0))
check("옛 보관분에 자료유형을 채워 보낸다",
      [r.get("measurement_basis") for r in LOG[-1]], ["metered"])

# 계산값으로 쌓아 둔 보관분이 회선 복구와 함께 실측으로 바뀌면 안 된다 —
# 이미 적힌 값이 그 행의 진실이다.
storek = buffer_mod.Buffer(tmp / "basis-keep.db")
storek.append({"source": "manual", "readings": [
    {"meter_id": "m_bas_b", "ts": "2026-10-20T04:00:00+00:00", "value": 72.0,
     "reading_kind": "interval_kwh", "measurement_basis": "calculated"}]},
    "2026-10-20T04:00:00+00:00")
S.mrv_flush(storek, BASE, "mrvk_secret", 20, lambda: False, None, None, "metered")
check("이미 적힌 자료유형은 재전송이 덮지 않는다",
      [r.get("measurement_basis") for r in LOG[-1]], ["calculated"])

check("가짜 서버가 본 규약 위반이 없다", BAD, [])

store.close(); store_c.close()      # 가짜 서버와 임시 디렉토리는 _clean_up 이 치운다
storeb.close(); storeo.close(); storek.close()
print()
if fails:
    print(f"실패 {len(fails)}건:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("모두 통과")
