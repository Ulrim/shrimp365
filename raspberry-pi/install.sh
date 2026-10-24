#!/usr/bin/env bash
# Shrimp365 수질 모니터링 프로그램 설치.
#
# 내려받은 raspberry-pi 폴더 안에서 실행하세요.
#   sudo ./install.sh
#
# 하는 일
#   · pyserial 설치
#   · 프로그램을 /opt/shrimp365 에 배치
#   · 설정 파일을 /etc/shrimp365/config.ini 로 복사 (있으면 건드리지 않음)
#   · 전용 계정 shrimp365 생성 (시리얼·I2C 접근 권한만)
#   · systemd 서비스 등록 (시작은 하지 않음 — 설정을 먼저 채워야 하므로)
#
# 이미 설치된 기기에서 다시 실행하면 프로그램만 새 것으로 바꿉니다.
# 설정 파일과 그동안 쌓인 데이터는 그대로 둡니다.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/shrimp365
CONF_DIR=/etc/shrimp365
CONF="$CONF_DIR/config.ini"
SERVICE_USER=shrimp365

MODULES=(shrimp365_sensor.py display.py webui.py wifi.py buffer.py history.py updater.py limits.py anomaly.py advice.py field_env.py wireless.py power_control.py verify.py)

# 시스템 파일 — 모듈과 달리 /opt 밖으로 간다. 없으면 설치를 멈춘다.
POLKIT_RULE=50-shrimp365-nm.rules

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo ./install.sh" >&2
  exit 1
fi

UNITS=(shrimp365-sensor.service shrimp365-update.service shrimp365-update.timer)

for f in "${MODULES[@]}" config.example.ini "$POLKIT_RULE" "${UNITS[@]}"; do
  if [ ! -f "$SRC/$f" ]; then
    echo "필요한 파일이 없습니다: $f" >&2
    echo "raspberry-pi 폴더 안에서 실행했는지 확인하세요." >&2
    exit 1
  fi
done

FIRST_INSTALL=yes
[ -f "$CONF" ] && FIRST_INSTALL=no

# ── 1. pyserial ──────────────────────────────────────────────────────────────
# 배포판 패키지를 먼저 쓴다. pip 로 넣으면 OS 업데이트 때 어긋날 수 있다.
echo "==> pyserial 확인"
if python3 -c "import serial" 2>/dev/null; then
  echo "    이미 설치되어 있습니다."
  # 원격 업데이트의 서명 확인에 쓴다. 없으면 업데이트만 건너뛰고 측정은 계속된다.
  python3 -c "import cryptography" 2>/dev/null \
    || apt-get install -y python3-cryptography 2>/dev/null \
    || echo "    (python3-cryptography 설치 실패 — 원격 업데이트는 쓸 수 없습니다)"
else
  # 저장소 목록 갱신은 실패해도 넘어간다. 만료된 외부 저장소 하나 때문에
  # 설치 전체가 멈추면 안 된다. 정작 필요한 패키지는 그 다음 줄에서 받는다.
  apt-get update -qq || echo "    (저장소 갱신 실패 — 그대로 진행합니다)"
  # Bookworm 이후로는 pip 가 시스템 파이썬을 막으므로 apt 쪽이 정답이다.
  apt-get install -y python3-serial
  apt-get install -y python3-cryptography 2>/dev/null \
    || echo "    (python3-cryptography 설치 실패 — 원격 업데이트는 쓸 수 없습니다)"
  python3 -c "import serial" 2>/dev/null || {
    echo "pyserial 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요." >&2
    exit 1
  }
fi

# ── 2. 프로그램 배치 ─────────────────────────────────────────────────────────
echo "==> 프로그램 설치: $APP_DIR"
install -d -m 755 "$APP_DIR"
for f in "${MODULES[@]}"; do
  install -m 644 "$SRC/$f" "$APP_DIR/$f"
done
# 다시 설치했을 때 옛 바이트코드가 남아 헷갈리는 일을 막는다.
rm -rf "$APP_DIR/__pycache__"
# 무선 센서 수집기 설치 도구 — 화면 [설정] → [무선 센서] 가 이 경로를 안내한다.
# 실제 설치(브로커·Zigbee2MQTT·수집기)는 동글을 꽂은 뒤 setup-wireless.sh 가 한다.
if [ -f "$SRC/setup-wireless.sh" ]; then
  install -m 755 "$SRC/setup-wireless.sh" "$APP_DIR/setup-wireless.sh"
fi
# 투야 블루투스 토양센서 — 설치(setup-tuya-ble.sh)와 등록(tuya_ble_setup.py, 투야 클라우드 열쇠).
for f in setup-tuya-ble.sh tuya_ble_setup.py; do
  if [ -f "$SRC/$f" ]; then install -m 755 "$SRC/$f" "$APP_DIR/$f"; fi
done
# 무선 수집기 코드(/opt/shrimp365/field/{src,scripts}) — setup-wireless.sh 가 깐 서비스가 여기서 돈다.
# 폴더를 통째로 지우고 바꾸면 안 된다: 저장소(git)에서 받은 판의 field/ 에는 설정 견본만 있어,
# 예전에는 업데이트할 때마다 수집기가 지워져 지그비·기상 값이 끊겼다. 덮어쓰기만 하고,
# 수집기 코드는 설치 꾸러미(field/src) 또는 저장소(../openfield) 에서 새 것으로 바꿔 끼운다.
if [ -d "$SRC/field" ]; then
  install -d -m 755 "$APP_DIR/field"
  cp -r "$SRC/field/." "$APP_DIR/field/"
  COL_SRC=""; COL_SCRIPTS=""
  if [ -d "$SRC/field/src/ofdf" ]; then
    COL_SRC="$SRC/field/src"; COL_SCRIPTS="$SRC/field/scripts"
  elif [ -d "$SRC/../openfield/src/ofdf" ]; then
    COL_SRC="$SRC/../openfield/src"; COL_SCRIPTS="$SRC/../openfield/scripts"
  fi
  # 원본과 대상이 같은 폴더면(설치된 곳에서 다시 돌림) 건드리지 않는다 — 지우면 원본도 사라진다.
  if [ -n "$COL_SRC" ] && [ "$(realpath "$COL_SRC")" = "$(realpath -m "$APP_DIR/field/src")" ]; then
    COL_SRC=""
  fi
  if [ -n "$COL_SRC" ]; then
    install -d -m 755 "$APP_DIR/field/src" "$APP_DIR/field/scripts"
    rm -rf "$APP_DIR/field/src/ofdf.new"
    cp -r "$COL_SRC/ofdf" "$APP_DIR/field/src/ofdf.new"     # 다 복사한 뒤에 바꿔 끼운다
    rm -rf "$APP_DIR/field/src/ofdf"
    mv "$APP_DIR/field/src/ofdf.new" "$APP_DIR/field/src/ofdf"
    for s in zigbee_bridge.py rtl433_bridge.py ecowitt_receiver.py tuya_ble_bridge.py; do
      [ -f "$COL_SCRIPTS/$s" ] && install -m 644 "$COL_SCRIPTS/$s" "$APP_DIR/field/scripts/$s"
    done
  fi
  find "$APP_DIR/field" -name __pycache__ -type d -prune -exec rm -rf {} +
  chmod -R a+rX "$APP_DIR/field"
  # 깔려 있는 수집기는 새 코드로 다시 시작한다(지워졌다 되살아난 경우 포함 — 멈춰 있어도 켜 둔 것이면).
  for u in farm365-zigbee farm365-rtl433 farm365-ecowitt farm365-tuyable; do
    if systemctl is-enabled --quiet "$u" 2>/dev/null; then systemctl restart "$u" || true; fi
  done
fi

# ── 3. 설정 파일 ─────────────────────────────────────────────────────────────
install -d -m 755 "$CONF_DIR"
if [ -f "$CONF" ]; then
  echo "==> 설정 파일이 이미 있습니다 — 그대로 둡니다: $CONF"
else
  echo "==> 설정 파일 생성: $CONF"
  install -m 600 "$SRC/config.example.ini" "$CONF"
fi
# 기기 키가 들어가는 파일이므로 권한은 매번 다시 좁힌다.
chmod 600 "$CONF"

# ── 4. 전용 계정 ─────────────────────────────────────────────────────────────
# root 로 돌릴 이유가 없다. 시리얼 포트만 읽으면 되는 프로그램이다.
if id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> 계정 $SERVICE_USER 확인"
else
  echo "==> 계정 $SERVICE_USER 생성"
  useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
fi
usermod -aG dialout "$SERVICE_USER"
# LCD 를 붙일 수 있으므로 i2c 그룹이 있으면 미리 넣어 둔다.
getent group i2c >/dev/null && usermod -aG i2c "$SERVICE_USER"

# 설정 파일은 프로그램 소유여야 한다. 코드로 연결하면 받은 기기 키를
# 프로그램이 직접 이 파일에 적기 때문이다. 다른 사용자는 읽지 못한다.
chown "$SERVICE_USER":"$SERVICE_USER" "$CONF"
chmod 600 "$CONF"

# 오프라인 보관분과 그래프 이력을 두는 곳.
# 서비스로 돌 때는 systemd(StateDirectory)가 만들지만, 설치 점검을 위해
# 손으로 한 번 실행할 때도 필요하므로 여기서 미리 만들어 둔다.
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" /var/lib/shrimp365

# ── 4-b. Wi‑Fi 제어 권한 (polkit) ────────────────────────────────────────────
# 화면에서 Wi‑Fi 를 바꿔 붙이려면 세션 없는 서비스 사용자에게 NetworkManager
# 제어를 열어 줘야 한다. NetworkManager 를 쓰는 기기에서만 규칙을 깐다.
if [ -d /etc/polkit-1/rules.d ]; then
  echo "==> Wi‑Fi 제어 권한 설정 (polkit)"
  install -m 644 "$SRC/$POLKIT_RULE" /etc/polkit-1/rules.d/
else
  echo "==> polkit 규칙 디렉터리가 없어 Wi‑Fi 권한 설정을 건너뜁니다."
  echo "    (화면의 Wi‑Fi 조회는 되지만 접속 변경은 안 될 수 있습니다.)"
fi

# ── 4-c. 무선 절전 끄기 ──────────────────────────────────────────────────────
# 파이의 wlan0 은 기본이 절전 켬이라, 회선이 한 번 끊기면 다시 붙지 못한 채
# 몇 시간씩 오프라인으로 남는 일이 있다. 무인 계측기에는 전력보다 연결
# 유지가 중요하므로 절전을 끈다. (원격 업데이트도 이 파일을 동기화한다)
if [ -d /etc/NetworkManager/conf.d ]; then
  echo "==> 무선 절전 끄기 (연결 끊김 후 자동 복구용)"
  cat > /etc/NetworkManager/conf.d/99-shrimp365-wifi-powersave.conf <<'NMEOF'
# Shrimp365 — 무선 절전 끄기
# 파이의 wlan0 절전은 회선이 끊긴 뒤 자동 복구를 막는 흔한 원인이다.
# 무인으로 도는 계측기라 전력보다 연결 유지가 중요하다.
[connection]
wifi.powersave = 2
NMEOF
  chmod 644 /etc/NetworkManager/conf.d/99-shrimp365-wifi-powersave.conf
  nmcli general reload 2>/dev/null || true
fi

# ── 5. 서비스 등록 ───────────────────────────────────────────────────────────
if [ -d /run/systemd/system ]; then
  echo "==> 서비스 등록"
  for u in "${UNITS[@]}"; do
    install -m 644 "$SRC/$u" /etc/systemd/system/
  done
  systemctl daemon-reload
  systemctl enable shrimp365-sensor >/dev/null
  # 5분마다 승인된 업데이트가 있는지 확인한다. 승인하지 않으면 아무 일도 없다.
  # 이미 켜져 있어도 재시작해야 바뀐 주기(예: 일일→5분)를 바로 반영한다.
  systemctl enable --now shrimp365-update.timer >/dev/null 2>&1 || true
  systemctl restart shrimp365-update.timer >/dev/null 2>&1 || true
  RUNNING=no
  systemctl is-active --quiet shrimp365-sensor && RUNNING=yes
  if [ "$RUNNING" = yes ]; then
    echo "==> 새 프로그램으로 재시작"
    systemctl restart shrimp365-sensor
  fi
else
  echo "==> systemd 가 없어 서비스 등록을 건너뜁니다."
  RUNNING=no
fi

echo
echo "==> 설치 완료"
echo
if [ "$FIRST_INSTALL" = yes ]; then
  cat <<EOF
다음 순서로 진행하세요.

  1) 설정 확인 — 시리얼 포트와 연결한 센서
       sudo nano $CONF

  2) 값이 읽히는지 점검 (서버로 보내지 않음)
       sudo -u $SERVICE_USER python3 $APP_DIR/shrimp365_sensor.py \\
         --config $CONF --once --dry-run -v

  3) 값이 맞으면 시작
       sudo systemctl start shrimp365-sensor
       journalctl -u shrimp365-sensor -f

  4) 계정과 연결 — 6자리 코드를 받아 Shrimp365 에 입력합니다
       터치스크린이 있으면: 화면 오른쪽 아래 [기기 연결] 버튼
       화면이 없으면:
         sudo -u $SERVICE_USER python3 $APP_DIR/shrimp365_sensor.py \\
           --config $CONF --pair

       뜨는 코드를 www.shrimp365.kr 에 입력하세요.
       로그인 → 양식장·수조 관리 → 수조의 "센서 기기" → "코드로 기기 연결"
       연결되면:  sudo systemctl restart shrimp365-sensor
EOF
elif [ "$RUNNING" = yes ]; then
  echo "   프로그램을 새 것으로 바꾸고 다시 시작했습니다."
  echo "   설정과 보관 중인 데이터는 그대로입니다."
  echo "     journalctl -u shrimp365-sensor -f"
else
  echo "   프로그램을 새 것으로 바꿨습니다. 시작:"
  echo "     sudo systemctl start shrimp365-sensor"
fi
echo
