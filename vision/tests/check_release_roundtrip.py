"""배포 한 바퀴를 실제로 돌려 본다 — 꾸러미를 만들어 적용하기까지.

pytest(test_updater.py)는 조각을 본다. 이 검사는 **release.py 가 만든 꾸러미를
updater.py 가 그대로 받아들이는지**를 본다. 둘의 규칙(허용 경로·해시 모양·버전
올리기)이 어긋나면 조각 테스트는 전부 통과하면서 현장에서는 아무 장비도 받지
못한다 — 배포한 사람은 올렸다고 생각하고, 장비는 조용히 옛 버전으로 돈다.

진짜 꾸러미를 묶고 진짜로 바꿔치기해 본다. 전부 임시 폴더 안이고 끝나면
지운다 — 저장소와 설치본은 건드리지 않는다.

pytest 와 함께 돌리지 않는 이유: 하위 프로세스가 몇 초 걸리고 저장소를 통째로
복사한다. 배포 경로를 고쳤다면 손으로 한 번 돌려 보라.

    python3 vision/tests/check_release_roundtrip.py
"""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VISION = Path(__file__).resolve().parent.parent
DEPLOY = VISION / "deploy"


def load(name):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


updater = load("updater")
ok = True


def check(name, cond, detail=""):
    global ok
    tail = "" if cond or not detail else f" — {detail}"
    print(f"{'  ok  ' if cond else 'FAIL  '}{name}{tail}")
    if not cond:
        ok = False


work = Path(tempfile.mkdtemp())
repo = work / "repo"
shutil.copytree(VISION, repo / "vision", ignore=shutil.ignore_patterns(
    ".venv", "__pycache__", "*.pyc", ".pytest_cache", ".ruff_cache", "ai"))
(repo / "public" / "updates" / "vision").mkdir(parents=True)

# ── 1. 꾸러미 만들기 ──
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0",
                    "--notes", "수조 사진"], cwd=repo / "vision",
                   capture_output=True, text=True)
check("꾸러미를 만든다", r.returncode == 0, (r.stderr or r.stdout)[-300:])

man_path = repo / "public/updates/vision/manifest.json"
manifest = json.loads(man_path.read_text())
check("목록의 latest 가 올라간다", manifest["latest"] == "1.1.0", manifest.get("latest"))
check("소스 버전 세 곳이 함께 올라간다",
      (repo / "vision/VERSION").read_text().strip() == "1.1.0"
      and 'version = "1.1.0"' in (repo / "vision/pyproject.toml").read_text()
      and 'FALLBACK = "1.1.0"' in (repo / "vision/app/version.py").read_text())

entry = manifest["releases"]["1.1.0"]
blob = (repo / "public/updates/vision" / entry["file"]).read_bytes()
check("꾸러미 크기가 상한 안이다", len(blob) < updater.MAX_PACKAGE_BYTES, f"{len(blob):,} 바이트")
check("서명 항목이 남아 있지 않다", "signature" not in entry)

# ── 2. 업데이터가 받아들이는가 ──
try:
    updater.verify_payload(blob, entry)
    check("업데이터가 해시를 받아들인다", True)
except Exception as e:
    check("업데이터가 해시를 받아들인다", False, str(e))

try:
    updater.verify_payload(blob + b"x", entry)
    check("바뀐 꾸러미는 거부한다", False, "통과해 버렸다")
except Exception:
    check("바뀐 꾸러미는 거부한다", True)

# ── 3. 푸는 단계까지 ──
stage = work / "stage"
try:
    updater.safe_extract(blob, stage)
    check("업데이터가 꾸러미를 푼다", True)
except Exception as e:
    check("업데이터가 꾸러미를 푼다", False, str(e))

names = sorted(str(p.relative_to(stage)) for p in stage.rglob("*") if p.is_file())
check("app/ 전체가 들어 있다", sum(n.startswith("app/") for n in names) > 30, f"{len(names)}개")
check("업데이터 자신도 들어 있다", "deploy/updater.py" in names)
check("모델은 들어 있지 않다", not any(n.endswith(".onnx") for n in names))
check("VERSION 이 새 버전이다", (stage / "VERSION").read_text().strip() == "1.1.0")

# ── 4. 바꿔치기 ──
app_dir = work / "opt"
(app_dir / "app").mkdir(parents=True)
(app_dir / "app/stale.py").write_text("X=1\n")
(app_dir / "VERSION").write_text("1.0.0\n")
(app_dir / ".venv").mkdir()
(app_dir / ".venv/python").write_text("bin")
updater.swap_in(stage, app_dir=app_dir, prev_dir=work / "prev")
check("설치본이 새 버전이 된다", (app_dir / "VERSION").read_text().strip() == "1.1.0")
check("옛 모듈이 남지 않는다", not (app_dir / "app/stale.py").exists())
check("가상환경은 그대로다", (app_dir / ".venv/python").read_text() == "bin")
check("바뀐 설치본을 프로그램이 읽으면 새 버전이다",
      updater.current_version(app_dir) == "1.1.0")

# ── 5. 두 번째 빌드가 재현 가능한가 ──
#
# 서명이 없으므로, "올라가 있는 꾸러미가 이 소스에서 나왔나" 를 확인할 길은
# 같은 버전을 다시 빌드해 해시를 맞춰 보는 것뿐이다.
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0"],
                   cwd=repo / "vision", capture_output=True, text=True)
again = json.loads(man_path.read_text())["releases"]["1.1.0"]
check("같은 소스는 같은 해시를 낸다", again["sha256"] == entry["sha256"],
      f'{entry["sha256"][:12]} vs {again["sha256"][:12]}')

# ── 6. 오래된 꾸러미를 정리하는가 ──
for v in ("1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"):
    subprocess.run([sys.executable, "deploy/release.py", "build", v],
                   cwd=repo / "vision", capture_output=True, text=True)
final = json.loads(man_path.read_text())
tarballs = sorted(p.name for p in (repo / "public/updates/vision").glob("*.tar.gz"))
check("목록이 최근 것만 남긴다", len(final["releases"]) <= 5, f'{len(final["releases"])}개')
check("파일도 함께 지워진다", len(tarballs) <= 5, f"{len(tarballs)}개")
check("남은 파일과 목록이 어긋나지 않는다",
      {e["file"] for e in final["releases"].values()} == set(tarballs),
      f'목록 {sorted(e["file"] for e in final["releases"].values())} / 파일 {tarballs}')
check("최신은 반드시 남아 있다", final["latest"] == "1.7.0", final["latest"])

shutil.rmtree(work, ignore_errors=True)
print("\n" + ("전부 통과했습니다." if ok else "실패가 있습니다."))
sys.exit(0 if ok else 1)
