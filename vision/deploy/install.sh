#!/usr/bin/env bash
# Shrimp365 개체수(비전) 프로그램 설치.
#
# 내려받은 vision 폴더 안에서 실행하세요.
#   sudo ./deploy/install.sh
#
# 하는 일
#   · 시스템 패키지 설치 (picamera2·glib·한글 글꼴)
#   · 전용 계정 shrimp365 생성 (카메라 접근 권한만)
#   · 프로그램을 /opt/shrimp365-vision 에 배치
#   · 가상환경 + onnxruntime 추론 의존성 설치
#   · 설정 파일을 /etc/shrimp365-vision/env 로 생성 (있으면 건드리지 않음)
#   · systemd 서비스 등록
#
# 이미 설치된 기기에서 다시 실행하면 프로그램만 새 것으로 바꿉니다.
# 설정 파일과 받아 둔 기기 키는 그대로 둡니다.
#
# 화면(터치스크린)은 이 다음에 deploy/setup-kiosk.sh 로 답니다.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/shrimp365-vision
CONF_DIR=/etc/shrimp365-vision
CONF="$CONF_DIR/env"
SERVICE_USER=shrimp365
UNIT=shrimp365-vision.service
MODEL=ai/models/shrimp_yolov8n_416.onnx

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo ./deploy/install.sh" >&2
  exit 1
fi

# 설치를 시작하기 전에 있어야 할 것들을 먼저 본다. 절반 설치된 상태가
# 가장 고치기 어렵다.
for f in pyproject.toml app/main.py "deploy/$UNIT"; do
  if [ ! -f "$SRC/$f" ]; then
    echo "필요한 파일이 없습니다: $f" >&2
    echo "vision 폴더를 통째로 내려받았는지 확인하세요." >&2
    exit 1
  fi
done

# 모델이 없으면 서비스는 떠도 개체수가 가짜가 된다. 설치 때 짚고 넘어간다.
MODEL_OK=yes
[ -s "$SRC/$MODEL" ] || MODEL_OK=no

FIRST_INSTALL=yes
[ -f "$CONF" ] && FIRST_INSTALL=no

# ── 1. 시스템 패키지 ─────────────────────────────────────────────────────────
echo "==> 시스템 패키지 확인"
# 저장소 목록 갱신 실패로 설치 전체가 멈추면 안 된다. 만료된 외부 저장소
# 하나 때문에 막히는 일이 흔하다.
apt-get update -qq || echo "    (저장소 갱신 실패 — 그대로 진행합니다)"

# picamera2 는 pip 로 깔지 않는다. 라즈베리파이 OS 가 libcamera 와 짝을 맞춰
# 제공하는 패키지라, pip 로 넣으면 카메라가 열리지 않는다.
apt-get install -y python3-picamera2 2>/dev/null \
  || echo "    (python3-picamera2 없음 — CSI 카메라를 쓰려면 라즈베리파이 OS 가 필요합니다)"
apt-get install -y python3-venv python3-dev libgl1 2>/dev/null \
  || apt-get install -y python3-venv python3-dev 2>/dev/null || true
# 영상 위에 그리는 카메라 이름이 한글이다. 글꼴이 없으면 네모(□□□)로 나온다.
apt-get install -y fonts-noto-cjk 2>/dev/null \
  || apt-get install -y fonts-nanum 2>/dev/null \
  || echo "    (한글 글꼴 설치 실패 — 영상 속 글자가 깨질 수 있습니다)"

# ── 2. 전용 계정 ─────────────────────────────────────────────────────────────
# root 로 돌릴 이유가 없다. 카메라만 열면 되는 프로그램이다.
if id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> 계정 $SERVICE_USER 확인"
else
  echo "==> 계정 $SERVICE_USER 생성"
  useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
fi
# video 그룹이 있어야 CSI 카메라(/dev/video*, /dev/media*)에 닿는다.
usermod -aG video "$SERVICE_USER"

# ── 3. 프로그램 배치 ─────────────────────────────────────────────────────────
echo "==> 프로그램 설치: $APP_DIR"
install -d -m 755 "$APP_DIR"
# 소스 트리를 그대로 옮긴다. 가상환경과 파이썬 찌꺼기는 빼고 — 개발 PC 에서
# 만든 .venv 가 섞여 들어가면 파이에서 실행되지 않는다.
tar -C "$SRC" \
    --exclude=.venv --exclude=__pycache__ --exclude='*.pyc' \
    --exclude=.pytest_cache --exclude=.ruff_cache \
    -cf - . | tar -C "$APP_DIR" -xf -

install -d -m 755 "$CONF_DIR"

# ── 4. 가상환경 ──────────────────────────────────────────────────────────────
# --system-site-packages: picamera2 는 시스템 패키지라 가상환경에서 보여야 한다.
echo "==> 파이썬 환경 (1~2분 걸립니다)"
if [ ! -x "$APP_DIR/.venv/bin/python" ]; then
  python3 -m venv --system-site-packages "$APP_DIR/.venv"
fi
# .[edge] = onnxruntime 만. .[ml](torch) 은 파이에서 20~40분 걸리고 메모리도
# 많이 쓴다 — 파이는 ONNX 로 돈다.
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -e "${APP_DIR}[edge]"

# 설치가 끝났는데 실행에 필요한 것이 빠져 있으면, 그 사실은 **첫 기동 때**
# 파이썬 스택트레이스로 드러난다. 현장에서 그 문구로 원인을 찾기 어렵다.
# 여기서 한 번 불러 보고 빠진 것을 이름으로 말한다.
#
# 실제로 이렇게 당했다: sqlalchemy 를 [asyncio] 없이 선언해 greenlet 이
# 빠졌는데, 파이썬 3.11 에서는 어쩌다 따라와 멀쩡했고 파이의 3.13 에서만
# 터졌다. 개발 PC 에서는 끝까지 보이지 않는 종류다.
echo "==> 설치 점검"
if ! "$APP_DIR/.venv/bin/python" - <<'PYEOF'
import sys

REQUIRED = [
    ("fastapi", "웹 프레임워크"),
    ("uvicorn", "서버"),
    ("sqlalchemy", "DB"),
    ("sqlalchemy.ext.asyncio", "DB 비동기 (greenlet 필요)"),
    ("asyncpg", "Postgres 드라이버"),
    ("onnxruntime", "추론 엔진"),
    ("numpy", "배열 연산"),
    ("PIL", "이미지"),
    ("httpx", "서버 통신"),
]

missing = []
for mod, what in REQUIRED:
    try:
        __import__(mod)
    except Exception as exc:  # noqa: BLE001
        missing.append(f"  · {mod} ({what}) — {type(exc).__name__}: {exc}")

if missing:
    print("설치가 덜 되었습니다:", file=sys.stderr)
    for line in missing:
        print(line, file=sys.stderr)
    sys.exit(1)
PYEOF
then
  echo
  echo "  ! 위 항목이 빠져 서비스가 뜨지 않습니다."
  echo "    인터넷을 확인하고 다시 실행하세요:  sudo ./deploy/install.sh"
  exit 1
fi
echo "    실행에 필요한 것이 모두 있습니다."

chown -R "$SERVICE_USER":video "$APP_DIR"

# ── 5. 설정 파일 ─────────────────────────────────────────────────────────────
if [ -f "$CONF" ]; then
  echo "==> 설정 파일이 이미 있습니다 — 그대로 둡니다: $CONF"
else
  echo "==> 설정 파일 생성: $CONF"
  cat > "$CONF" <<'EOF'
# Shrimp365 개체수(비전) 설정
#
# 채워야 하는 것은 아래 세 줄뿐입니다. 나머지는 기본값으로 둡니다.
#
#   VISION_SERVICE_KEY   웹(Vercel)에 넣은 것과 같은 값
#   VISION_STREAM_SECRET 웹(Vercel)에 넣은 것과 같은 값
#   DATABASE_URL         Supabase → Settings → Database → Session pooler
#                        접두사를 postgresql+asyncpg:// 로 바꿔 넣으세요
#
# 고친 뒤:  sudo systemctl restart shrimp365-vision

VISION_SERVICE_KEY=
VISION_STREAM_SECRET=
DATABASE_URL=

SHRIMP365_URL=https://www.shrimp365.kr
CORS_ORIGINS=https://www.shrimp365.kr

# 이 파이의 공개 주소(Cloudflare Tunnel 등). 아직 없으면 비워 두세요 —
# 장비 화면과 개체수 기록은 이것 없이도 됩니다. 브라우저에서 영상을 보려면
# 필요합니다. 파이가 여러 대면 각자 다르게(vision-1 / vision-2 …).
VISION_PUBLIC_URL=

# 파이 4 는 추론이 무겁습니다. 개체수는 초당 한 번이면 충분합니다.
MAX_CAMERAS=1
AUTO_START_STREAMS=true

# 모델과 임계값은 기본값이 이미 맞습니다(저장소에 함께 들어 있는 416 ONNX).
# 다른 해상도로 바꿀 때만 두 줄을 같이 고치세요 — 416→0.30, 512→0.25, 640→0.25.
# MODEL_PATH=/opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
# CONFIDENCE_THRESHOLD=0.30
EOF
fi
# 비밀값이 들어가는 파일이다. 매번 권한을 다시 좁힌다.
chown "$SERVICE_USER":"$SERVICE_USER" "$CONF"
chmod 600 "$CONF"

# 기기 키를 두는 곳. 서비스로 돌 때는 systemd(StateDirectory)가 만들지만,
# 손으로 한 번 실행해 볼 때도 필요하므로 여기서 미리 만든다.
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" /var/lib/shrimp365-vision

# ── 6. 서비스 등록 ───────────────────────────────────────────────────────────
RUNNING=no
if [ -d /run/systemd/system ]; then
  echo "==> 서비스 등록"
  install -m 644 "$SRC/deploy/$UNIT" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable shrimp365-vision >/dev/null
  systemctl is-active --quiet shrimp365-vision && RUNNING=yes
  if [ "$RUNNING" = yes ]; then
    echo "==> 새 프로그램으로 재시작"
    systemctl restart shrimp365-vision
  fi
else
  echo "==> systemd 가 없어 서비스 등록을 건너뜁니다."
fi

# ── 마무리 안내 ──────────────────────────────────────────────────────────────
echo
echo "==> 설치 완료"
echo

if [ "$MODEL_OK" = no ]; then
  cat <<EOF
  ! 모델 파일이 없습니다: $MODEL

    이대로 두면 서비스는 멀쩡히 뜨지만 **개체수가 가짜로 쌓입니다**(시뮬레이션).
    저장소에서 vision 폴더를 받을 때 이 파일이 빠졌다는 뜻입니다. 다시 받아
    $APP_DIR/$MODEL 자리에 넣고 이 스크립트를 다시 실행하세요.

EOF
fi

if [ "$FIRST_INSTALL" = yes ]; then
  cat <<EOF
다음 순서로 진행하세요.

  1) 설정 세 줄 채우기 — 비밀값 2개와 DB 주소
       sudo nano $CONF

  2) 시작
       sudo systemctl start shrimp365-vision
       journalctl -u shrimp365-vision -f

     로그에 이 줄이 보이면 모델이 제대로 물린 것입니다:
       "실제 모델로 추론합니다"

     대신 "[시뮬레이션 모드]" 배너가 뜨면 개체수가 가짜입니다. 배너에 이유와
     고치는 방법이 적혀 있습니다.

  3) 터치스크린을 붙일 거라면 (권장)
       sudo ./deploy/setup-kiosk.sh
       sudo reboot

     화면에서 [기기 연결 시작] 을 누르면 6자리 코드가 나옵니다.

  4) 화면이 없다면 — 코드를 로그에서 봅니다
       journalctl -u shrimp365-vision -f

     뜨는 6자리 코드를 www.shrimp365.kr 에 입력하세요.
     로그인 → 개체수 → 설정 → 카메라 연결 → 수조 선택
EOF
elif [ "$RUNNING" = yes ]; then
  echo "   프로그램을 새 것으로 바꾸고 다시 시작했습니다."
  echo "   설정과 기기 연결은 그대로입니다."
  echo "     journalctl -u shrimp365-vision -f"
else
  echo "   프로그램을 새 것으로 바꿨습니다. 시작:"
  echo "     sudo systemctl start shrimp365-vision"
fi
echo
