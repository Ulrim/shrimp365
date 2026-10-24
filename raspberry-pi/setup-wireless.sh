#!/usr/bin/env bash
# Farm365 장비 — 무선 센서(Zigbee·433MHz) 수집 설치. 재실행해도 안전하다(멱등).
#
#   sudo bash setup-wireless.sh                  # 지그비 + 에코윗 + (RTL-SDR 동글이 꽂혀 있으면) 433MHz
#   sudo bash setup-wireless.sh --adapter zstack # 동글이 SONOFF Dongle-P(CC2652P)일 때. 기본은 ember(MG24·Dongle-E)
#
# 설치하는 것
#   · mosquitto            장비 안에서만 쓰는 메시지 중계(127.0.0.1)
#   · Zigbee2MQTT          지그비 동글과 센서를 붙여 주는 프로그램 (/opt/zigbee2mqtt, 웹 8081)
#   · farm365-zigbee       지그비 값을 수집 파일로 쌓는 수집기
#   · farm365-rtl433       433MHz 기상센서(WS90) 수집기 — RTL-SDR 동글이 있을 때
#   · farm365-ecowitt      에코윗 게이트웨이 수신기(와이파이, 포트 8088) — 늘 켠다
#
# 433MHz 와 에코윗은 둘 다 화면에서 '등록한 것만' 받는다. 같은 기상센서를 두 길로
# 등록하는 것은 화면이 막으므로(비가 두 번 더해진다) 둘을 함께 켜 두어도 된다.
#
# 설치가 끝나면 센서 연결은 장비 화면 [설정] → [무선 센서] 에서 한다(SSH 필요 없음).
# 인터넷이 필요하다(패키지·Zigbee2MQTT 내려받기). 10~20분 걸린다.
set -euo pipefail

ADAPTER=ember
FORCE_RTL=0
LEGACY_ECO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --adapter) ADAPTER="$2"; shift 2 ;;
    --ecowitt) LEGACY_ECO=1; shift ;;   # 예전 옵션 — 이제 에코윗 수신기는 늘 켜고, 화면에서 등록한 것만 받는다
    --rtl433)  FORCE_RTL=1; shift ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done

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
FIELD=/var/lib/shrimp365/field          # 장비 서비스(StateDirectory)가 읽고 쓸 수 있는 곳
DATA="$FIELD/data"
Z2M_DATA="$FIELD/zigbee2mqtt"
APP=/opt/shrimp365/field
CONF=/etc/shrimp365/config.ini

# 수집기 코드가 있는 곳 — 설치 꾸러미(field/src), 저장소(../openfield), 이미 깔린 곳 순서.
if [ -d "$HERE/field/src/ofdf" ]; then
  SRC_SRC="$HERE/field/src"; SRC_SCRIPTS="$HERE/field/scripts"
elif [ -d "$HERE/../openfield/src/ofdf" ]; then
  SRC_SRC="$HERE/../openfield/src"; SRC_SCRIPTS="$HERE/../openfield/scripts"
elif [ -d "$APP/src/ofdf" ]; then
  SRC_SRC="$APP/src"; SRC_SCRIPTS="$APP/scripts"
else
  echo "수집기 코드를 찾지 못했습니다(field/src 또는 ../openfield)." >&2
  exit 1
fi
TEMPLATE="$HERE/field/devices.template.yaml"
[ -f "$TEMPLATE" ] || TEMPLATE="$APP/devices.template.yaml"

# ── 1. 패키지 ────────────────────────────────────────────────────────────────
echo "==> 패키지 설치"
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients git curl ca-certificates \
  python3-yaml python3-pandas python3-paho-mqtt
# rtl-433 은 배포판에 따라 없을 수 있다 — 없으면 433MHz 만 빠지고 나머지는 진행한다.
apt-get install -y -qq rtl-433 2>/dev/null || echo "   (rtl-433 패키지를 찾지 못했습니다 — 433MHz 기상센서는 나중에)"

# 브로커는 장비 안에서만 연다. 바깥에서 센서 값을 넣거나 페어링을 열 수 없게.
cat > /etc/mosquitto/conf.d/farm365.conf <<'EOF'
# Farm365 — 장비 안에서만 쓰는 중계(setup-wireless.sh)
listener 1883 127.0.0.1
allow_anonymous true
EOF
systemctl enable --now mosquitto >/dev/null
systemctl restart mosquitto

# ── 2. Node.js (Zigbee2MQTT 2.x 는 20 이상) ───────────────────────────────────
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
  echo "==> Node.js 22 설치"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

# ── 3. Zigbee2MQTT ──────────────────────────────────────────────────────────
# 버전을 고정한다 — 개발 줄기(master)를 받으면 설치할 때마다 다른 것이 깔린다. Z2M_REF 로 정할 수
# 있고, 비우면 내려받을 때의 최신 정식 판(x.y.z 태그)을 쓴다.
Z2M_REPO=https://github.com/Koenkk/zigbee2mqtt.git
if [ ! -f /opt/zigbee2mqtt/package.json ]; then
  Z2M_REF="${Z2M_REF:-$(git ls-remote --tags --refs "$Z2M_REPO" | sed -nE 's#.*refs/tags/([0-9]+\.[0-9]+\.[0-9]+)$#\1#p' | sort -V | tail -1)}"
  [ -n "$Z2M_REF" ] || { echo "Zigbee2MQTT 판을 찾지 못했습니다(인터넷 확인)." >&2; exit 1; }
  echo "==> Zigbee2MQTT $Z2M_REF 내려받기"
  rm -rf /opt/zigbee2mqtt
  git clone --depth 1 --branch "$Z2M_REF" "$Z2M_REPO" /opt/zigbee2mqtt
fi
echo "==> Zigbee2MQTT 준비(처음에는 몇 분 걸립니다)"
( cd /opt/zigbee2mqtt
  corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --silent
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm run build >/dev/null )
# 서비스 사용자가 주인이어야 한다 — root 소유 저장소를 다른 사용자가 돌리면 git 이 'safe.directory'
# 로 거절하고, Zigbee2MQTT 는 판 정보를 못 읽어 다시 빌드하려다 실패한다.
chown -R "$USER_:$USER_" /opt/zigbee2mqtt

install -d -o "$USER_" -g "$USER_" -m 755 "$FIELD" "$DATA" "$DATA/capture" "$Z2M_DATA"
if [ ! -f "$Z2M_DATA/configuration.yaml" ]; then
  PORT=""
  for p in /dev/serial/by-id/*; do
    case "$p" in *[Ss]onoff*|*ITead*|*[Zz]igbee*|*EFR32*|*MG2[14]*|*cc26*|*CC26*) PORT="$p"; break ;; esac
  done
  if [ -z "$PORT" ]; then
    echo "   지그비 동글을 찾지 못했습니다. 동글을 꽂고 다시 실행하세요(다른 설정은 그대로 남습니다)." >&2
    PORT=/dev/ttyUSB0
  fi
  echo "   동글: $PORT (adapter: $ADAPTER)"
  cat > "$Z2M_DATA/configuration.yaml" <<EOF
# Farm365 — setup-wireless.sh 가 만들었다. 센서 페어링·이름은 장비 화면 [무선 센서] 가 바꾼다.
homeassistant:
  enabled: false
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://127.0.0.1
serial:
  port: $PORT
  adapter: $ADAPTER
frontend:
  enabled: true
  host: 127.0.0.1     # 장비 안에서만. 이 화면은 인증이 없어 같은 망 누구나 페어링·삭제·코드 실행까지 할 수 있다.
  port: 8081          # 8080 은 장비 화면이 쓴다. PC 에서 보려면: ssh -L 8081:127.0.0.1:8081 pi@장비주소
advanced:
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
  log_level: warning
  last_seen: ISO_8601
EOF
  chown "$USER_:$USER_" "$Z2M_DATA/configuration.yaml"
fi

if ! grep -qE '^\s+host:' "$Z2M_DATA/configuration.yaml"; then
  sed -i 's/^frontend:$/frontend:\n  host: 127.0.0.1/' "$Z2M_DATA/configuration.yaml"   # 예전 판이 만든 설정도 장비 안에서만
fi

# ── 4. 수집기 ────────────────────────────────────────────────────────────────
echo "==> 수집기 배치: $APP"
install -d -m 755 "$APP" "$APP/src" "$APP/scripts"
# /opt/shrimp365 에서 실행하면 원본과 대상이 같은 폴더다 — 그때는 이미 깔린 것을 그대로 쓴다.
if [ "$(realpath "$SRC_SRC")" != "$(realpath "$APP/src")" ]; then
  rm -rf "$APP/src/ofdf.new"
  cp -r "$SRC_SRC/ofdf" "$APP/src/ofdf.new"
  rm -rf "$APP/src/ofdf"
  mv "$APP/src/ofdf.new" "$APP/src/ofdf"
  for s in zigbee_bridge.py rtl433_bridge.py ecowitt_receiver.py tuya_ble_bridge.py; do
    [ -f "$SRC_SCRIPTS/$s" ] || continue
    install -m 644 "$SRC_SCRIPTS/$s" "$APP/scripts/$s"
  done
fi
if [ -f "$TEMPLATE" ] && [ "$(realpath "$TEMPLATE")" != "$(realpath -m "$APP/devices.template.yaml")" ]; then
  install -m 644 "$TEMPLATE" "$APP/devices.template.yaml"
fi
find "$APP" -name __pycache__ -type d -prune -exec rm -rf {} +
chmod -R a+rX "$APP"
if [ ! -f "$FIELD/devices.yaml" ]; then
  install -o "$USER_" -g "$USER_" -m 644 "$APP/devices.template.yaml" "$FIELD/devices.yaml"
fi

# ── 5. 서비스 ────────────────────────────────────────────────────────────────
unit() {  # 이름, 설명, 실행 줄, 뒤에 올 것
  cat > "/etc/systemd/system/$1.service" <<EOF
# Farm365 — setup-wireless.sh 가 만들었다.
[Unit]
Description=$2
After=network-online.target mosquitto.service $4
Wants=mosquitto.service

[Service]
Type=simple
User=$USER_
Group=$USER_
SupplementaryGroups=dialout plugdev
WorkingDirectory=$5
Environment=PYTHONUNBUFFERED=1
$6
ExecStart=$3
Restart=always
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$FIELD

[Install]
WantedBy=multi-user.target
EOF
}
unit zigbee2mqtt "Zigbee2MQTT (Farm365 무선 센서)" "/usr/bin/node index.js" "" /opt/zigbee2mqtt \
  "Environment=ZIGBEE2MQTT_DATA=$Z2M_DATA
Environment=HOME=$Z2M_DATA
ReadWritePaths=/opt/zigbee2mqtt"
unit farm365-zigbee "Farm365 지그비 수집기" \
  "/usr/bin/python3 $APP/scripts/zigbee_bridge.py --devices $FIELD/devices.yaml --out $DATA --capture $DATA/capture" \
  "zigbee2mqtt.service" "$APP" ""
unit farm365-rtl433 "Farm365 433MHz 기상센서 수집기" \
  "/usr/bin/python3 $APP/scripts/rtl433_bridge.py --spawn --devices $FIELD/devices.yaml --out $DATA --capture $DATA/capture" \
  "" "$APP" ""
unit farm365-ecowitt "Farm365 에코윗 게이트웨이 수신기" \
  "/usr/bin/python3 $APP/scripts/ecowitt_receiver.py --registered-only --devices $FIELD/devices.yaml --out $DATA --capture $DATA/capture" \
  "" "$APP" ""
systemctl daemon-reload
systemctl enable --now zigbee2mqtt farm365-zigbee >/dev/null
systemctl restart zigbee2mqtt farm365-zigbee

HAS_RTL=0
for d in /sys/bus/usb/devices/*; do
  if [ "$(cat "$d/idVendor" 2>/dev/null)" = "0bda" ] && grep -qE '^(2838|2832)$' "$d/idProduct" 2>/dev/null; then HAS_RTL=1; fi
done
systemctl enable --now farm365-ecowitt >/dev/null
systemctl restart farm365-ecowitt
if [ "$HAS_RTL" = 1 ] || [ "$FORCE_RTL" = 1 ]; then
  systemctl enable --now farm365-rtl433 >/dev/null
else
  echo "   RTL-SDR 동글이 없어 433MHz 수집기는 켜지 않았습니다(꽂은 뒤 다시 실행하면 켜집니다)."
fi

# ── 6. 장비 설정: 환경·기상 켜고 같은 폴더를 보게 ────────────────────────────
if [ -f "$CONF" ]; then
  python3 - "$CONF" "$DATA" <<'EOF'
import sys
sys.path.insert(0, "/opt/shrimp365")
from pathlib import Path
from wireless import save_section_value
conf, data = Path(sys.argv[1]), sys.argv[2]
save_section_value(conf, "environment", "enabled", "true")
save_section_value(conf, "environment", "dir", data)
save_section_value(conf, "power", "dir", data)
EOF
  systemctl restart shrimp365-sensor || true
fi

# ── 7. 예전 설정 점검: 같은 기상센서를 두 길로 받거나, 등록 없이 받던 에코윗 ─────────────
python3 - "$FIELD/devices.yaml" "$LEGACY_ECO" <<'EOF' || true
import sys
sys.path.insert(0, "/opt/shrimp365")
from pathlib import Path
from wireless import guess_rf_kind, read_eco, read_rf
dev, legacy = Path(sys.argv[1]), sys.argv[2] == "1"
eco, rf = read_eco(dev), read_rf(dev)
weather_rf = [k for k in rf if guess_rf_kind(k.split("/")[0]) == "weather"]
if eco["gateway"] is not None and weather_rf:
    print("   [주의] 기상센서를 에코윗 게이트웨이와 433MHz(" + ", ".join(weather_rf) + ") 두 길로 받게 돼 있습니다.")
    print("          비가 두 번 더해집니다. 화면 [무선 센서]에서 한쪽을 빼세요.")
if (eco["gateway"] is not None or eco["channels"]) and not eco["passkey"]:
    print("   [주의] 에코윗 게이트웨이 열쇠(PASSKEY)가 없어 같은 망의 다른 게이트웨이 값도 받습니다.")
    print("          화면에서 에코윗 칸을 모두 뺀 뒤 '들어온 게이트웨이' 목록에서 다시 등록하세요.")
if legacy and eco["gateway"] is None:
    print("   [알림] 이제 에코윗은 화면에서 등록한 것만 받습니다. 지금은 게이트웨이 등록이 없어 기상값이 들어오지 않습니다.")
    print("          화면 [설정] → [무선 센서] → '에코윗 게이트웨이' 에서 게이트웨이와 센서를 등록하세요.")
EOF

echo
echo "==> 상태"
for u in mosquitto zigbee2mqtt farm365-zigbee farm365-rtl433 farm365-ecowitt; do
  printf "   %-18s %s\n" "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"
done
echo
echo "끝났습니다. 장비 화면 [설정] → [무선 센서] 에서 [새 센서 찾기]를 누르고"
echo "센서의 버튼을 5초 길게 누르면 붙습니다."
