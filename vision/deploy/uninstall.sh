#!/usr/bin/env bash
# 비전 장비 프로그램을 **완전히** 지운다. 처음부터 다시 깔기 전에 쓴다.
#
#     sudo ./deploy/uninstall.sh          기기 연결(페어링)은 남긴다
#     sudo ./deploy/uninstall.sh --all    기기 키까지 지운다(재연결 필요)
#
# 왜 스크립트인가: 지울 자리가 여덟 곳이고, 그중 하나는 `rm -rf` 를 손으로
# 적다가 오타가 나면 되돌릴 수 없는 자리다(/etc, /usr/local/bin). 목록을
# 코드에 두고 한 번에 지운다.
#
# 지우지 않는 것
#   · 서버(Supabase)의 카메라 등록과 쌓인 개체수 — 웹에서 관리한다
#   · 같은 보드로 재연결하면 그 카메라를 **재사용**하고 이력도 이어진다
#     (app/api/vision/pair/claim/route.ts)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행하세요:  sudo $0 ${*:-}"; exit 1; }

ALL=no
[ "${1:-}" = "--all" ] && ALL=yes

SERVICE_USER=shrimp365
STATE_DIR=/var/lib/shrimp365-vision
TARGET_USER="${SUDO_USER:-pi}"
USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6 || true)"

echo "==> 서비스 정지"
systemctl stop shrimp365-vision 2>/dev/null || true
systemctl disable shrimp365-vision 2>/dev/null || true

echo "==> 장비 화면(키오스크) 자동 실행 되돌리기"
pkill -f shrimp365-vision-kiosk 2>/dev/null || true
rm -f /usr/local/bin/shrimp365-vision-kiosk
if [ -n "$USER_HOME" ] && [ -d "$USER_HOME" ]; then
  rm -f "$USER_HOME/.config/autostart/shrimp365-vision-kiosk.desktop"
  rm -rf "$USER_HOME/.config/shrimp365-vision-kiosk"
  # 자동 실행 한 줄만 뽑아낸다. 파일을 지우면 **사용자의 바탕화면 설정이
  # 함께 사라진다** — labwc 는 사용자 파일이 시스템 기본값을 대체하므로,
  # 예전에 이 파일을 통째로 만들었다가 작업표시줄이 없어진 일이 있었다.
  for f in "$USER_HOME/.config/wayfire.ini" \
           "$USER_HOME/.config/labwc/autostart" \
           "$USER_HOME/.config/lxsession/LXDE-pi/autostart"; do
    [ -f "$f" ] && sed -i '/shrimp365-vision-kiosk/d' "$f"
  done
fi

echo "==> 프로그램·설정·서비스 삭제"
rm -rf /opt/shrimp365-vision
rm -rf /etc/shrimp365-vision
rm -f /etc/systemd/system/shrimp365-vision.service
systemctl daemon-reload 2>/dev/null || true

if [ "$ALL" = yes ]; then
  echo "==> 기기 키까지 삭제 — 다시 깐 뒤 6자리 코드로 재연결해야 합니다"
  rm -rf "$STATE_DIR"
  # 계정은 남긴다. 지우려면 `sudo userdel shrimp365` — 다시 깔면 어차피
  # 같은 이름으로 만들고, 카메라 권한(video 그룹)도 다시 붙인다.
else
  echo "==> 기기 키는 남깁니다: $STATE_DIR"
  echo "    (다시 깔면 그 연결을 그대로 씁니다. 지우려면 --all)"
fi

echo
echo "==> 삭제 완료. 남은 것 확인:"
for p in /opt/shrimp365-vision /etc/shrimp365-vision \
         /etc/systemd/system/shrimp365-vision.service \
         /usr/local/bin/shrimp365-vision-kiosk "$STATE_DIR"; do
  [ -e "$p" ] && echo "    남음: $p" || echo "    없음: $p"
done
echo
echo "    받아 둔 소스(~/vision, ~/shrimp365-src)는 직접 지우세요."
echo "    예전에 sudo 로 clone 했다면 주인이 root 라 sudo 가 필요합니다:"
echo "      sudo rm -rf ~/vision ~/shrimp365-src"
