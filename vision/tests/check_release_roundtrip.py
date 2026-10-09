"""업데이트 한 바퀴를 실제로 돌려 본다 — 열쇠 생성부터 적용까지.

pytest(test_updater.py)는 조각을 본다. 이 검사는 **release.py 가 만든 꾸러미를
updater.py 가 그대로 받아들이는지**를 본다. 둘의 규칙(허용 경로·서명 모양·버전
올리기)이 어긋나면 조각 테스트는 전부 통과하면서 현장에서는 아무 장비도 받지
못한다 — 배포한 사람은 올렸다고 생각하고, 장비는 조용히 옛 버전으로 돈다.

진짜 열쇠를 만들고, 진짜 꾸러미를 묶고, 진짜로 바꿔치기해 본다. 전부 임시
폴더 안이고 끝나면 지운다 — 저장소와 설치본은 건드리지 않는다.

pytest 와 함께 돌리지 않는 이유: 열쇠 생성과 하위 프로세스가 몇 초 걸리고,
저장소를 통째로 복사한다. 배포 경로를 고쳤다면 손으로 한 번 돌려 보라.

    python3 vision/tests/check_release_roundtrip.py
"""
import base64, importlib.util, json, shutil, subprocess, sys, tempfile
from pathlib import Path

VISION = Path(__file__).resolve().parent.parent
DEPLOY = VISION / "deploy"

def load(name):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m
    spec.loader.exec_module(m); return m

updater = load("updater")
ok = True
def check(name, cond, detail=""):
    global ok
    print(f"{'  ok  ' if cond else 'FAIL  '}{name}" + ("" if cond or not detail else f" — {detail}"))
    if not cond: ok = False

work = Path(tempfile.mkdtemp())
repo = work / "repo"
shutil.copytree(VISION, repo / "vision", ignore=shutil.ignore_patterns(
    ".venv", "__pycache__", "*.pyc", ".pytest_cache", ".ruff_cache", "ai"))
(repo / "public" / "updates" / "vision").mkdir(parents=True)

# ── 1. 열쇠 만들기 ──
r = subprocess.run([sys.executable, "deploy/release.py", "init"],
                   cwd=repo / "vision", capture_output=True, text=True)
check("열쇠를 만든다", r.returncode == 0, r.stderr[-200:])
pub = ""
for line in r.stdout.splitlines():
    if line.startswith("RELEASE_PUBLIC_KEY"):
        pub = line.split('"')[1]
check("공개키를 알려 준다", bool(pub), r.stdout[-200:])
check("개인키가 600 으로 저장된다",
      oct((repo / "vision/deploy/secrets/release-key.pem").stat().st_mode)[-3:] == "600")

# ── 2. 공개키를 안 넣고 빌드하면 멈춘다 ──
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0"],
                   cwd=repo / "vision", capture_output=True, text=True)
check("공개키가 비어 있으면 배포를 막는다", r.returncode != 0 and "비어 있습니다" in r.stderr,
      (r.stderr or r.stdout)[-200:])

# ── 3. 엉뚱한 공개키를 넣으면 멈춘다 ──
up = repo / "vision/deploy/updater.py"
text = up.read_text()
wrong = base64.b64encode(b"\x01" * 32).decode()
up.write_text(text.replace('RELEASE_PUBLIC_KEY = ""', f'RELEASE_PUBLIC_KEY = "{wrong}"'))
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0"],
                   cwd=repo / "vision", capture_output=True, text=True)
check("짝이 안 맞는 공개키면 배포를 막는다", r.returncode != 0 and "짝이 아닙니다" in r.stderr,
      (r.stderr or r.stdout)[-200:])

# ── 4. 제대로 빌드 ──
up.write_text(text.replace('RELEASE_PUBLIC_KEY = ""', f'RELEASE_PUBLIC_KEY = "{pub}"'))
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0",
                    "--notes", "수조 사진"], cwd=repo / "vision", capture_output=True, text=True)
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

# ── 5. 업데이터가 받아들이는가 ──
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
verifier = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub))
try:
    updater.verify_package(blob, "1.1.0", entry, verifier)
    check("업데이터가 서명을 받아들인다", True)
except Exception as e:
    check("업데이터가 서명을 받아들인다", False, str(e))

# ── 6. 푸는 단계까지 ──
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

# ── 7. 바꿔치기 ──
app_dir = work / "opt"
(app_dir / "app").mkdir(parents=True)
(app_dir / "app/stale.py").write_text("X=1\n")
(app_dir / "VERSION").write_text("1.0.0\n")
(app_dir / ".venv").mkdir(); (app_dir / ".venv/python").write_text("bin")
updater.swap_in(stage, app_dir=app_dir, prev_dir=work / "prev")
check("설치본이 새 버전이 된다", (app_dir / "VERSION").read_text().strip() == "1.1.0")
check("옛 모듈이 남지 않는다", not (app_dir / "app/stale.py").exists())
check("가상환경은 그대로다", (app_dir / ".venv/python").read_text() == "bin")
check("바뀐 설치본을 프로그램이 읽으면 새 버전이다",
      updater.current_version(app_dir) == "1.1.0")

# ── 8. 두 번째 빌드가 재현 가능한가 ──
r = subprocess.run([sys.executable, "deploy/release.py", "build", "1.1.0"],
                   cwd=repo / "vision", capture_output=True, text=True)
again = json.loads(man_path.read_text())["releases"]["1.1.0"]
check("같은 소스는 같은 해시를 낸다", again["sha256"] == entry["sha256"],
      f'{entry["sha256"][:12]} vs {again["sha256"][:12]}')

shutil.rmtree(work, ignore_errors=True)
print("\n" + ("전부 통과했습니다." if ok else "실패가 있습니다."))
sys.exit(0 if ok else 1)
