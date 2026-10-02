#!/usr/bin/env bash
# 라즈베리파이 공식 7인치 터치스크린(800×480)을 개체수 계기판으로 만든다.
#
#   · 크로미움을 키오스크 모드로 띄워 장비 화면(app/kiosk.py)을 표시
#   · 화면 꺼짐·절전·마우스 커서 비활성화
#   · 부팅하면 자동 실행
#
# 데스크톱 환경이 있는 Raspberry Pi OS(Bookworm 이상)에서 실행하세요.
# Lite 버전에는 데스크톱이 없어 이 스크립트가 동작하지 않습니다.
#
#   sudo ./deploy/setup-kiosk.sh
#
# 수질 센서 파이의 raspberry-pi/setup-kiosk.sh 와 같은 구조입니다. 한 농장에
# 두 장비가 같이 서는 일이 많아, 설치 방법이 다르면 현장에서 헷갈립니다.

set -euo pipefail

CONF=/etc/shrimp365-vision/env
TARGET_USER="${SUDO_USER:-$(id -un)}"
USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo ./deploy/setup-kiosk.sh" >&2
  exit 1
fi

if [ ! -f "$CONF" ]; then
  echo "설정 파일이 없습니다($CONF). 먼저 설치하세요 — sudo ./deploy/install.sh" >&2
  exit 1
fi

# ── 0. 화면 포트 ─────────────────────────────────────────────────────────────
# 설정에 KIOSK_PORT 가 있으면 그 값을, 없으면 프로그램 기본값(8080)을 쓴다.
PORT="$(awk -F= '/^[[:space:]]*KIOSK_PORT[[:space:]]*=/{gsub(/[^0-9]/,"",$2);print $2;exit}' "$CONF")"
[ -n "$PORT" ] || PORT=8080

# 화면을 끄는 설정이 들어 있으면 켠다 — 화면을 달려고 이 스크립트를 돌리는 것이다.
if grep -qiE '^[[:space:]]*KIOSK_ENABLED[[:space:]]*=[[:space:]]*(false|0|no)' "$CONF"; then
  echo "==> 장비 화면을 켭니다 (KIOSK_ENABLED=true)"
  sed -i 's/^[[:space:]]*KIOSK_ENABLED[[:space:]]*=.*/KIOSK_ENABLED=true/' "$CONF"
  systemctl restart shrimp365-vision 2>/dev/null || true
fi

# ── 0-2. 서비스를 켠다 ───────────────────────────────────────────────────────
# 설치 스크립트는 설정을 먼저 채우도록 일부러 시작하지 않는다. 화면을 다는
# 시점이면 설정은 끝났다는 뜻이고, 화면에 값이 나오려면 서비스가 돌아야 한다.
if [ -d /run/systemd/system ]; then
  echo "==> 개체수 서비스를 켭니다 (전원을 넣으면 자동으로 시작)"
  systemctl enable --now shrimp365-vision 2>/dev/null || true
  if ! systemctl is-active --quiet shrimp365-vision; then
    echo "    ! 서비스가 뜨지 않았습니다. 화면 설치는 계속합니다."
    echo "      나중에 확인하세요:  journalctl -u shrimp365-vision -n 30"
  fi
fi

KIOSK_URL="${KIOSK_URL:-http://127.0.0.1:$PORT}"
echo "==> 대상 사용자: $TARGET_USER ($USER_HOME)"
echo "==> 키오스크 주소: $KIOSK_URL"

# ── 1. 크로미움 ──────────────────────────────────────────────────────────────
echo "==> 크로미움 설치"
apt-get update -qq || echo "    (저장소 갱신 실패 — 그대로 진행합니다)"
# 배포판에 따라 패키지 이름이 다르다.
apt-get install -y chromium-browser 2>/dev/null || apt-get install -y chromium
apt-get install -y unclutter 2>/dev/null || true
# 화면이 한국어다. 글꼴이 없으면 네모(□□□)로만 나온다.
apt-get install -y fonts-noto-cjk 2>/dev/null \
  || apt-get install -y fonts-nanum 2>/dev/null || true
# 아래 실행 스크립트가 화면이 떴는지 확인할 때 쓴다.
apt-get install -y curl 2>/dev/null || true

# ── 2. 실행 스크립트 ─────────────────────────────────────────────────────────
# 크로미움은 비정상 종료 후 "복원하시겠습니까?" 풍선을 띄운다. 무인 장비에서는
# 아무도 눌러 주지 않으므로 매번 흔적을 지우고 시작한다.
cat > /usr/local/bin/shrimp365-vision-kiosk <<EOF
#!/usr/bin/env bash
set -u

URL="\${1:-$KIOSK_URL}"
PROFILE="\$HOME/.config/shrimp365-vision-kiosk"

# 정전으로 꺼졌을 때 남는 복구 안내를 지운다.
if [ -f "\$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \\
    "\$PROFILE/Default/Preferences" 2>/dev/null || true
fi

# 서비스가 화면을 올릴 때까지 기다린다(최대 90초).
# 추론 모델을 올리는 데 파이에서 수십 초가 걸린다 — 수질 센서(60초)보다 길게 본다.
UP=no
for _ in \$(seq 1 90); do
  if curl -sf -o /dev/null --max-time 2 "\$URL"; then UP=yes; break; fi
  sleep 1
done

# 끝내 안 뜨면 크로미움의 "This site can't be reached" 가 나온다. 화면만 있는
# 장비에서는 그 영어 문구로 무엇을 해야 할지 알 수 없으므로 우리말로 띄운다.
if [ "\$UP" != yes ]; then
  cat > /tmp/shrimp365-vision-down.html <<'HTML'
<!doctype html><html lang="ko"><meta charset="utf-8">
<style>
 body{background:#0B1120;color:#E8EDF7;font-family:sans-serif;margin:0;
      height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 48px}
 h1{font-size:30px;margin:0 0 8px} p{color:#93A4BF;font-size:17px;margin:0 0 22px}
 li{font-size:16px;line-height:2.1} code{background:#16223a;padding:3px 8px;border-radius:5px}
</style>
<h1>개체수 화면을 불러오지 못했습니다</h1>
<p>프로그램이 실행 중이 아니거나 아직 올라오는 중입니다.</p>
<ol>
 <li>도는지 확인 — <code>systemctl status shrimp365-vision</code></li>
 <li>안 돌면 — <code>sudo systemctl start shrimp365-vision</code></li>
 <li>설정 세 줄(비밀값 2개·DB 주소)이 채워졌는지 — <code>sudo nano /etc/shrimp365-vision/env</code></li>
 <li>고친 뒤 — <code>sudo systemctl restart shrimp365-vision</code></li>
</ol>
<p>자세한 이유는 <code>journalctl -u shrimp365-vision -n 50</code> 에 적혀 있습니다.</p>
HTML
  URL="file:///tmp/shrimp365-vision-down.html"
fi

BROWSER=\$(command -v chromium-browser || command -v chromium)

exec "\$BROWSER" \\
  --kiosk "\$URL" \\
  --user-data-dir="\$PROFILE" \\
  --window-size=800,480 \\
  --window-position=0,0 \\
  --start-fullscreen \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-features=TranslateUI \\
  --no-first-run \\
  --check-for-update-interval=31536000 \\
  --password-store=basic \\
  --overscroll-history-navigation=0 \\
  --disable-pinch
EOF
chmod +x /usr/local/bin/shrimp365-vision-kiosk

# ── 3. 자동 실행 등록 ────────────────────────────────────────────────────────
# Bookworm 은 기본이 Wayland(wayfire 또는 labwc)이고, 예전 버전은 X11(LXDE)이다.
# 어느 환경으로 부팅해도 뜨도록 셋 다 넣는다. 쓰이지 않는 항목은 무시된다.
install -d -o "$TARGET_USER" -g "$TARGET_USER" "$USER_HOME/.config/autostart"
cat > "$USER_HOME/.config/autostart/shrimp365-vision-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Shrimp365 Vision Kiosk
Exec=/usr/local/bin/shrimp365-vision-kiosk
X-GNOME-Autostart-enabled=true
EOF
chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config/autostart/shrimp365-vision-kiosk.desktop"

# wayfire — 파일이 없으면 만들어서라도 넣는다. 예전에는 "있을 때만" 고쳤는데,
# 그러면 wayfire 로 부팅하는데 설정 파일이 아직 없는 기기에서 자동 실행이
# 조용히 등록되지 않는다(화면이 영영 안 뜬다).
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if ! grep -qs "shrimp365-vision-kiosk" "$WAYFIRE_INI"; then
  if grep -qs "^\[autostart\]" "$WAYFIRE_INI"; then
    sed -i '/^\[autostart\]/a shrimp365vision = /usr/local/bin/shrimp365-vision-kiosk' "$WAYFIRE_INI"
  else
    printf '\n[autostart]\nshrimp365vision = /usr/local/bin/shrimp365-vision-kiosk\n' >> "$WAYFIRE_INI"
  fi
  chown "$TARGET_USER:$TARGET_USER" "$WAYFIRE_INI"
fi

# labwc — **사용자 autostart 가 있으면 시스템 것을 대신한다(합치지 않는다).**
# 그래서 빈 파일에 우리 줄만 적으면 작업표시줄·바탕화면이 사라진다
# (/etc/xdg/labwc/autostart 가 그것들을 띄운다). 없을 때는 시스템 것을
# 먼저 복사해 두고 우리 줄을 덧붙인다.
LABWC_DIR="$USER_HOME/.config/labwc"
install -d -o "$TARGET_USER" -g "$TARGET_USER" "$LABWC_DIR"
if [ ! -f "$LABWC_DIR/autostart" ] && [ -f /etc/xdg/labwc/autostart ]; then
  echo "==> labwc 기본 autostart 를 먼저 복사합니다 (작업표시줄 유지)"
  install -m 644 -o "$TARGET_USER" -g "$TARGET_USER" \
    /etc/xdg/labwc/autostart "$LABWC_DIR/autostart"
fi
if ! grep -qs "shrimp365-vision-kiosk" "$LABWC_DIR/autostart"; then
  echo "/usr/local/bin/shrimp365-vision-kiosk &" >> "$LABWC_DIR/autostart"
  chown "$TARGET_USER:$TARGET_USER" "$LABWC_DIR/autostart"
fi

# ── 4. 화면 절전 끄기 ────────────────────────────────────────────────────────
# 양식장 상황판이므로 항상 켜져 있어야 한다.
echo "==> 화면 절전 해제"

LXDE_AUTOSTART="$USER_HOME/.config/lxsession/LXDE-pi/autostart"
if [ -d "$USER_HOME/.config/lxsession/LXDE-pi" ]; then
  grep -qs -- "-dpms" "$LXDE_AUTOSTART" || cat >> "$LXDE_AUTOSTART" <<'EOF'
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0
EOF
  chown "$TARGET_USER:$TARGET_USER" "$LXDE_AUTOSTART"
fi

if [ -f "$WAYFIRE_INI" ] && ! grep -q "^\[idle\]" "$WAYFIRE_INI"; then
  printf '\n[idle]\ndpms_timeout = -1\nscreensaver_timeout = -1\n' >> "$WAYFIRE_INI"
  chown "$TARGET_USER:$TARGET_USER" "$WAYFIRE_INI"
fi

# 콘솔 블랭킹 (부팅 직후 잠깐 보이는 텍스트 화면)
if [ -f /boot/firmware/cmdline.txt ] && ! grep -q "consoleblank=0" /boot/firmware/cmdline.txt; then
  sed -i '1 s/$/ consoleblank=0/' /boot/firmware/cmdline.txt
fi

echo
echo "==> 완료"
echo "   재부팅하면 화면에 자동으로 뜹니다:  sudo reboot"
echo "   바로 확인:  /usr/local/bin/shrimp365-vision-kiosk"
echo
echo "   화면에서 [기기 연결 시작] 을 누르면 6자리 코드가 나옵니다."
echo "   그 코드를 www.shrimp365.kr → 개체수 → 설정 → 카메라 연결 에 입력하세요."
echo
echo "   화면이 안 뜨면:  systemctl status shrimp365-vision"
echo "   화면 주소:       $KIOSK_URL  (이 장비 안에서만 열립니다)"
