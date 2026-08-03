#!/usr/bin/env bash
# 라즈베리파이 공식 7인치 터치스크린(800×480)을 계기판으로 만든다.
#
#   · 크로미움을 키오스크 모드로 띄워 수집기의 상태 페이지를 표시
#   · 화면 꺼짐·절전·마우스 커서 비활성화
#   · 부팅하면 자동 실행
#
# 데스크톱 환경이 있는 Raspberry Pi OS(Bookworm 이상)에서 실행하세요.
# Lite 버전에는 데스크톱이 없어 이 스크립트가 동작하지 않습니다.

set -euo pipefail

CONF=/etc/shrimp365/config.ini
TARGET_USER="${SUDO_USER:-$(id -un)}"
USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo ./setup-kiosk.sh" >&2
  exit 1
fi

# ── 0. 상태 페이지 켜기 ──────────────────────────────────────────────────────
# 이걸 안 켜 두면 크로미움이 "This site can't be reached" 만 띄운다.
# 화면을 붙이려고 이 스크립트를 돌리는 것이므로, 여기서 알아서 켠다.
PORT=8080
if [ -f "$CONF" ]; then
  PORT="$(awk '/^\[webui\]/{s=1;next} /^\[/{s=0} s&&/^[[:space:]]*port[[:space:]]*=/{gsub(/[^0-9]/,"",$0);print;exit}' "$CONF")"
  [ -n "$PORT" ] || PORT=8080

  if awk '/^\[webui\]/{s=1;next} /^\[/{s=0} s&&/^[[:space:]]*enabled[[:space:]]*=/{print;exit}' "$CONF" \
     | grep -qi "true"; then
    echo "==> 상태 페이지가 이미 켜져 있습니다 (포트 $PORT)"
  else
    echo "==> 상태 페이지를 켭니다 ([webui] enabled = true)"
    # [webui] 구간 안의 enabled 만 바꾼다. 다른 구간에도 같은 이름이 있다.
    awk '/^\[webui\]/{s=1} /^\[/&&!/^\[webui\]/{s=0}
         s&&/^[[:space:]]*enabled[[:space:]]*=/{print "enabled = true";next}
         {print}' "$CONF" > "$CONF.tmp"
    # 권한과 소유자를 원본 그대로 유지한 채 바꿔치기한다.
    chown --reference="$CONF" "$CONF.tmp"
    chmod --reference="$CONF" "$CONF.tmp"
    mv "$CONF.tmp" "$CONF"
    systemctl restart shrimp365-sensor 2>/dev/null || true
  fi
else
  echo "==> 설정 파일이 없습니다($CONF). 수집기를 먼저 설치하세요 — INSTALL.md 4번" >&2
  exit 1
fi

KIOSK_URL="${KIOSK_URL:-http://127.0.0.1:$PORT}"

echo "==> 대상 사용자: $TARGET_USER ($USER_HOME)"
echo "==> 키오스크 주소: $KIOSK_URL"

# ── 1. 크로미움 설치 ─────────────────────────────────────────────────────────
echo "==> 크로미움 설치"
apt-get update -qq
# 배포판에 따라 패키지 이름이 다르다.
apt-get install -y chromium-browser 2>/dev/null || apt-get install -y chromium
apt-get install -y unclutter 2>/dev/null || true

# 화면이 전부 한글이다. 한글 글꼴이 없으면 네모(□□□)로만 나오므로 같이 깐다.
# 이미 깔려 있으면 apt 가 알아서 넘어간다.
echo "==> 한글 글꼴 설치"
apt-get install -y fonts-nanum 2>/dev/null || apt-get install -y fonts-unfonts-core || true

# ── 2. 실행 스크립트 ─────────────────────────────────────────────────────────
# 크로미움은 비정상 종료 후 "복원하시겠습니까?" 풍선을 띄운다.
# 무인 장비에서는 아무도 눌러 주지 않으므로 매번 흔적을 지우고 시작한다.
cat > /usr/local/bin/shrimp365-kiosk <<EOF
#!/usr/bin/env bash
set -u

URL="\${1:-$KIOSK_URL}"
PROFILE="\$HOME/.config/shrimp365-kiosk"

# 정전으로 꺼졌을 때 남는 복구 안내를 지운다.
if [ -f "\$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \\
    "\$PROFILE/Default/Preferences" 2>/dev/null || true
fi

# 수집기가 상태 페이지를 올릴 때까지 기다린다(최대 60초).
UP=no
for _ in \$(seq 1 60); do
  if curl -sf -o /dev/null --max-time 2 "\$URL"; then UP=yes; break; fi
  sleep 1
done

# 끝내 안 뜨면 크로미움의 "This site can't be reached" 가 나온다.
# 화면만 있는 장비에서는 그 영어 문구로 무엇을 해야 할지 알 수 없으므로,
# 무엇이 문제이고 무엇을 하면 되는지 우리말로 띄운다.
if [ "\$UP" != yes ]; then
  cat > /tmp/shrimp365-down.html <<'HTML'
<!doctype html><html lang="ko"><meta charset="utf-8">
<style>
 body{background:#0b1220;color:#e6edf7;font-family:sans-serif;margin:0;
      height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 48px}
 h1{font-size:30px;margin:0 0 8px} p{color:#93a4bf;font-size:17px;margin:0 0 22px}
 li{font-size:16px;line-height:2.1} code{background:#16223a;padding:3px 8px;border-radius:5px}
</style>
<h1>측정 화면을 불러오지 못했습니다</h1>
<p>수집기가 실행 중이 아니거나 상태 페이지가 꺼져 있습니다.</p>
<ol>
 <li>수집기가 도는지 — <code>systemctl status shrimp365-sensor</code></li>
 <li>안 돌면 — <code>sudo systemctl start shrimp365-sensor</code></li>
 <li>설정의 <code>[webui] enabled = true</code> 확인</li>
 <li>고친 뒤 — <code>sudo systemctl restart shrimp365-sensor</code></li>
</ol>
<p>수집기는 이 화면과 무관하게 계속 측정하고 있습니다.</p>
HTML
  URL="file:///tmp/shrimp365-down.html"
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
chmod +x /usr/local/bin/shrimp365-kiosk

# ── 3. 자동 실행 등록 ────────────────────────────────────────────────────────
# Bookworm 은 기본이 Wayland(wayfire 또는 labwc)이고, 예전 버전은 X11(LXDE)이다.
# 어느 환경으로 부팅해도 뜨도록 셋 다 넣어 둔다. 쓰이지 않는 항목은 무시된다.
install -d -o "$TARGET_USER" -g "$TARGET_USER" "$USER_HOME/.config/autostart"
cat > "$USER_HOME/.config/autostart/shrimp365-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Shrimp365 Kiosk
Exec=/usr/local/bin/shrimp365-kiosk
X-GNOME-Autostart-enabled=true
EOF
chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config/autostart/shrimp365-kiosk.desktop"

# wayfire (Bookworm, Pi 4/5 기본)
WAYFIRE_INI="$USER_HOME/.config/wayfire.ini"
if [ -f "$WAYFIRE_INI" ] && ! grep -q "shrimp365-kiosk" "$WAYFIRE_INI"; then
  if grep -q "^\[autostart\]" "$WAYFIRE_INI"; then
    sed -i '/^\[autostart\]/a shrimp365 = /usr/local/bin/shrimp365-kiosk' "$WAYFIRE_INI"
  else
    printf '\n[autostart]\nshrimp365 = /usr/local/bin/shrimp365-kiosk\n' >> "$WAYFIRE_INI"
  fi
  chown "$TARGET_USER:$TARGET_USER" "$WAYFIRE_INI"
fi

# labwc (Bookworm 이후 일부 기기 기본)
LABWC_DIR="$USER_HOME/.config/labwc"
install -d -o "$TARGET_USER" -g "$TARGET_USER" "$LABWC_DIR"
if ! grep -qs "shrimp365-kiosk" "$LABWC_DIR/autostart"; then
  echo "/usr/local/bin/shrimp365-kiosk &" >> "$LABWC_DIR/autostart"
  chown "$TARGET_USER:$TARGET_USER" "$LABWC_DIR/autostart"
fi

# ── 4. 화면 절전 끄기 ────────────────────────────────────────────────────────
# 양식장 상황판이므로 항상 켜져 있어야 한다.
echo "==> 화면 절전 해제"

# X11
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

# Wayland (wayfire)
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
echo "   바로 확인:  /usr/local/bin/shrimp365-kiosk"
echo
echo "   상태 페이지는 이 스크립트가 켜 두었습니다 (포트 $PORT)."
echo "   화면이 안 뜨면:  systemctl status shrimp365-sensor"
