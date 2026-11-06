#!/usr/bin/env bash
# Farm365 장비 — 투야 블루투스(BLE) 토양센서 수집 설치. 재실행해도 안전하다(멱등).
#
#   sudo bash setup-tuya-ble.sh            # 설치 + 수집기 켜기
#   sudo bash setup-tuya-ble.sh --register # 설치 뒤 바로 센서 등록(tuya_ble_setup.py)까지
#
# 설치하는 것
#   · /opt/shrimp365/ble-venv   bleak(블루투스) · pycryptodome(암호) · tinytuya(투야 클라우드) 전용 파이썬
#   · farm365-tuyable            5분마다 센서에 붙어 값을 읽어 수집 파일(tuyable_YYYYMMDD.csv)에 쌓는 수집기
#
# 투야 블루투스 센서는 값을 암호로 보낸다. 센서마다 열쇠(local_key)를 투야 클라우드에서 한 번
# 받아야 한다 — tuya_ble_setup.py 가 한다(투야 IoT 개발자 계정 필요, INSTALL.md 참고).
# 열쇠를 받은 뒤로는 인터넷 없이 라즈베리파이가 직접 읽는다.
#
# 주의: 투야 앱에서 센서를 지우고 다시 붙이면 열쇠가 바뀐다. 그때는 tuya_ble_setup.py 를 다시 실행한다.
# 센서를 투야 앱(휴대폰)이 붙잡고 있으면 파이가 붙지 못할 수 있다 — 앱은 닫아 둔다.
#
# 기록 보기:  journalctl -u farm365-tuyable -n 50
set -euo pipefail

REGISTER=0
case "${1:-}" in
  --register) REGISTER=1 ;;
  -h|--help) sed -n 2,18p "$0"; exit 0 ;;
  "") ;;
  *) echo "모르는 옵션: $1" >&2; exit 2 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo bash $0" >&2
  exit 1
fi
if ! id shrimp365 >/dev/null 2>&1; then
  echo "장비 프로그램이 먼저 설치돼 있어야 합니다(install.sh)." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
USER_=shrimp365
FIELD=/var/lib/shrimp365/field
DATA="$FIELD/data"
APP=/opt/shrimp365/field
VENV=/opt/shrimp365/ble-venv

# 수집기 코드가 있는 곳 — 설치 꾸러미(field/src), 저장소(../openfield), 이미 깔린 곳 순서.
if [ -d "$HERE/field/src/ofdf" ]; then
  SRC_SRC="$HERE/field/src"; SRC_SCRIPTS="$HERE/field/scripts"
elif [ -d "$HERE/../openfield/src/ofdf" ]; then
  SRC_SRC="$HERE/../openfield/src"; SRC_SCRIPTS="$HERE/../openfield/scripts"
elif [ -d "$APP/src/ofdf" ]; then
  SRC_SRC="$APP/src"; SRC_SCRIPTS="$APP/scripts"
else
  echo "수집기 코드를 찾지 못했습니다(field/src 또는 ../openfield)." >&2
  echo "저장소 폴더에서 실행하세요:  cd ~/shrimp365/raspberry-pi && sudo ./install.sh && sudo bash setup-tuya-ble.sh --register" >&2
  exit 1
fi

# ── 1. 블루투스 ──────────────────────────────────────────────────────────────
echo "==> 블루투스 준비"
apt-get update -qq
apt-get install -y -qq bluez python3-venv python3-yaml
rfkill unblock bluetooth 2>/dev/null || true
systemctl enable --now bluetooth >/dev/null
usermod -aG bluetooth "$USER_"
if ! bluetoothctl show >/dev/null 2>&1; then
  echo "   [주의] 블루투스 장치가 보이지 않습니다(bluetoothctl show). 파이 4/5 는 내장돼 있습니다 — 재부팅 뒤 다시 실행하세요."
fi

# ── 2. 전용 파이썬 ───────────────────────────────────────────────────────────
echo "==> 전용 파이썬: $VENV (bleak · pycryptodome · tinytuya)"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv --system-site-packages "$VENV"
fi
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q "bleak>=0.21" "bleak-retry-connector>=3.0" "pycryptodome>=3.19" "tinytuya>=1.13" "pyyaml>=6.0"
chmod -R a+rX "$VENV"

# ── 3. 수집기 코드 ───────────────────────────────────────────────────────────
echo "==> 수집기 배치: $APP"
install -d -m 755 "$APP" "$APP/src" "$APP/scripts"
# /opt/shrimp365 에서 실행하면 원본과 대상이 같은 폴더다 — 그때는 복사하지 않는다(지우면 원본도 사라진다).
if [ "$(realpath "$SRC_SRC")" != "$(realpath "$APP/src")" ]; then
  rm -rf "$APP/src/ofdf.new"
  cp -r "$SRC_SRC/ofdf" "$APP/src/ofdf.new"       # 다 복사한 뒤에 바꿔 끼운다
  rm -rf "$APP/src/ofdf"
  mv "$APP/src/ofdf.new" "$APP/src/ofdf"
  for s in zigbee_bridge.py rtl433_bridge.py ecowitt_receiver.py tuya_ble_bridge.py; do
    if [ -f "$SRC_SCRIPTS/$s" ]; then install -m 644 "$SRC_SCRIPTS/$s" "$APP/scripts/$s"; fi
  done
fi
if [ ! -f "$APP/scripts/tuya_ble_bridge.py" ] || [ ! -f "$APP/src/ofdf/data/tuya_ble.py" ]; then
  echo "블루투스 수집기 코드가 없습니다. 저장소 폴더에서 실행하세요:" >&2
  echo "   cd ~/shrimp365/raspberry-pi && sudo ./install.sh && sudo bash setup-tuya-ble.sh --register" >&2
  exit 1
fi
if [ "$HERE" != /opt/shrimp365 ]; then
  install -m 755 "$HERE/tuya_ble_setup.py" /opt/shrimp365/tuya_ble_setup.py
  install -m 755 "$0" /opt/shrimp365/setup-tuya-ble.sh
fi
find "$APP" -name __pycache__ -type d -prune -exec rm -rf {} +
chmod -R a+rX "$APP"
install -d -o "$USER_" -g "$USER_" -m 755 "$FIELD" "$DATA" "$DATA/capture"
if [ ! -f "$FIELD/devices.yaml" ]; then
  if [ -f "$APP/devices.template.yaml" ]; then
    install -o "$USER_" -g "$USER_" -m 640 "$APP/devices.template.yaml" "$FIELD/devices.yaml"
  else
    install -o "$USER_" -g "$USER_" -m 640 /dev/null "$FIELD/devices.yaml"
  fi
fi

# ── 4. 서비스 ────────────────────────────────────────────────────────────────
echo "==> 서비스: farm365-tuyable"
cat > /etc/systemd/system/farm365-tuyable.service <<EOF
# Farm365 — setup-tuya-ble.sh 가 만들었다.
[Unit]
Description=Farm365 투야 블루투스 토양센서 수집기
After=bluetooth.service
Wants=bluetooth.service

[Service]
Type=simple
User=$USER_
Group=$USER_
SupplementaryGroups=bluetooth
WorkingDirectory=$APP
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python $APP/scripts/tuya_ble_bridge.py --devices $FIELD/devices.yaml --out $DATA --capture $DATA/capture
Restart=always
RestartSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$FIELD

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now farm365-tuyable >/dev/null
systemctl restart farm365-tuyable
# 여기까지 왔으면 준비 끝 — install.sh 와 장비 화면이 이 표시를 본다(꾸러미가 늘면 판 번호를 올린다).
echo 2 > "$VENV/.ready"

# 장비 화면이 환경 값을 같은 폴더에서 읽게(setup-wireless.sh 를 안 돌린 장비 대비).
CONF=/etc/shrimp365/config.ini
if [ -f "$CONF" ] && [ -f /opt/shrimp365/wireless.py ]; then
  python3 - "$CONF" "$DATA" <<'PYEOF' || true
import sys
sys.path.insert(0, "/opt/shrimp365")
from pathlib import Path
from wireless import save_section_value
conf, data = Path(sys.argv[1]), sys.argv[2]
save_section_value(conf, "environment", "enabled", "true")
save_section_value(conf, "environment", "dir", data)
PYEOF
fi

echo
echo "   farm365-tuyable  $(systemctl is-active farm365-tuyable 2>/dev/null || true)"
echo
echo "다음: 센서 등록 — 장비 화면 [설정] → [무선 센서] → '블루투스 토양센서' → [투야에서 센서 가져오기]"
echo "   (터미널로 하려면: sudo $VENV/bin/python /opt/shrimp365/tuya_ble_setup.py)"
echo "확인: sudo -u $USER_ $VENV/bin/python $APP/scripts/tuya_ble_bridge.py --devices $FIELD/devices.yaml --once -v --out /tmp --capture ''"

if [ "$REGISTER" = 1 ]; then
  echo
  "$VENV/bin/python" /opt/shrimp365/tuya_ble_setup.py
fi
