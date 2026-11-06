#!/usr/bin/env bash
# Farm365/Shrimp365 장비 — GitHub 에서 받은 저장소로 스스로 업데이트하게 한다.
#
#   cd ~/shrimp365/raspberry-pi && sudo ./setup-autoupdate.sh          # 켜기 (매일 새벽 3시대 + 부팅 10분 뒤)
#   sudo ./setup-autoupdate.sh --now                                     # 켜고 지금 한 번 돌려 보기
#   sudo ./setup-autoupdate.sh --off                                     # 끄기
#   sudo ./setup-autoupdate.sh --branch main                             # 따라갈 브랜치를 main 으로 바꾸고 켜기
#
# 현장 장비는 main 을 따라가게 두기를 권합니다 — 다른 브랜치는 작업 중인 것이 섞일 수 있습니다.
#
# 하는 일 (shrimp365-gitupdate.timer → shrimp365-gitupdate.service)
#   1. 이 저장소가 지금 따라가는 브랜치를 GitHub 에서 받아 본다(git fetch).
#   2. 새 것이 있으면 앞으로만 감는다(fast-forward). 장비에서 손으로 고친 파일이 있으면
#      덮어쓰지 않고 건너뛴다 — 로그에 남긴다.
#   3. install.sh 로 프로그램을 바꿔 끼우고(설정·데이터는 그대로), 무선 수집기가 깔려 있으면
#      수집기 코드도 바꾼 뒤 서비스를 다시 시작한다.
#
# 웹의 [업데이트] 버튼(서명된 꾸러미, updater.py)과는 따로 돈다. 그쪽은 오너 PC 에서
# 서명한 버전만 받는다. 이쪽은 GitHub 저장소를 그대로 믿는다 — 저장소에 쓸 수 있는
# 사람이 곧 장비에 코드를 넣을 수 있는 사람이 된다는 뜻이다.
#
# 기록 보기:  journalctl -u shrimp365-gitupdate -n 50
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo 로 실행하세요:  sudo ./setup-autoupdate.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT=shrimp365-gitupdate
RUNNER=/usr/local/sbin/shrimp365-gitupdate

if [ "${1:-}" = "--off" ]; then
  systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service" "$RUNNER"
  systemctl daemon-reload
  echo "자동 업데이트를 껐습니다."
  exit 0
fi

if [ ! -d "$REPO/.git" ]; then
  echo "git 으로 받은 저장소가 아닙니다($REPO). 'git clone' 으로 받은 폴더에서 실행하세요." >&2
  exit 1
fi
OWNER="$(stat -c %U "$REPO")"

if [ "${1:-}" = "--branch" ] && [ -n "${2:-}" ]; then
  # --depth 1 로 받은 저장소는 한 브랜치만 안다 — 그 브랜치도 받을 수 있게 넓히고 옮겨 탄다.
  echo "==> 따라갈 브랜치를 $2 로 바꿉니다"
  sudo -u "$OWNER" git -C "$REPO" remote set-branches --add origin "$2"
  sudo -u "$OWNER" git -C "$REPO" fetch -q --depth 1 origin "$2"
  sudo -u "$OWNER" git -C "$REPO" checkout -q -B "$2" "origin/$2"
  sudo -u "$OWNER" git -C "$REPO" branch -q --set-upstream-to="origin/$2" "$2"
  (cd "$HERE" && ./install.sh)
  systemctl restart shrimp365-sensor || true
  shift 2
fi

echo "==> 실행 스크립트: $RUNNER"
cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
# setup-autoupdate.sh 가 만들었다. 저장소: $REPO (소유자 $OWNER)
set -euo pipefail
REPO="$REPO"
OWNER="$OWNER"
EOF
cat >> "$RUNNER" <<'EOF'
g() { sudo -u "$OWNER" git -C "$REPO" "$@"; }   # 저장소 주인으로 — root 로 돌리면 git 이 소유자 불일치로 거부한다

BR="$(g rev-parse --abbrev-ref HEAD)"
if ! g fetch -q origin "$BR"; then
  echo "GitHub 에 닿지 못했습니다(인터넷 확인). 다음에 다시 봅니다."
  exit 0
fi
# 마지막으로 **설치까지 끝낸** 커밋. 저장소를 앞으로 감은 뒤 install.sh 가 실패하면(서비스 재시작 실패 등)
# 다음 번에는 저장소가 이미 최신이라 "최신입니다" 로 끝나 영영 반만 업데이트된 채 남았다.
# 저장소 HEAD 와 이 기록이 다르면 install.sh 를 다시 돌린다.
STATE=/var/lib/shrimp365/installed-commit
OLD="$(g rev-parse HEAD)"
NEW="$(g rev-parse "origin/$BR")"
if [ "$OLD" != "$NEW" ]; then
  if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
    echo "장비에서 고친 파일이 있어 덮어쓰지 않고 건너뜁니다:"
    g status --short --untracked-files=no
    exit 1
  fi
  if ! g merge -q --ff-only "origin/$BR"; then
    echo "앞으로만 감을 수 없습니다(갈라진 기록). 손으로 확인하세요: cd $REPO && git status"
    exit 1
  fi
  echo "업데이트: ${OLD:0:7} → ${NEW:0:7} ($BR)"
  g log --oneline -20 "$OLD..$NEW" || true      # | head 로 자르면 기록이 길 때 SIGPIPE 로 여기서 끝났다
fi
HEAD_NOW="$(g rev-parse HEAD)"
if [ "$(cat "$STATE" 2>/dev/null || true)" = "$HEAD_NOW" ]; then
  echo "최신입니다 ($BR ${HEAD_NOW:0:7})."
  exit 0
fi

cd "$REPO/raspberry-pi"
./install.sh

# 무선 수집기 코드는 install.sh 가 저장소(openfield/)에서 바꿔 끼우고 다시 시작한다.

systemctl restart shrimp365-sensor
mkdir -p "$(dirname "$STATE")"
echo "$HEAD_NOW" > "$STATE"
echo "끝 — 장비 프로그램을 다시 시작했습니다 (${HEAD_NOW:0:7})."
EOF
chmod 755 "$RUNNER"

echo "==> 서비스·타이머: $UNIT"
cat > "/etc/systemd/system/$UNIT.service" <<EOF
# Farm365 — setup-autoupdate.sh 가 만들었다.
[Unit]
Description=Shrimp365/Farm365 GitHub 자동 업데이트
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$RUNNER
TimeoutStartSec=15min
EOF
cat > "/etc/systemd/system/$UNIT.timer" <<EOF
# Farm365 — setup-autoupdate.sh 가 만들었다.
[Unit]
Description=Shrimp365/Farm365 GitHub 자동 업데이트 (매일 새벽 + 부팅 뒤)

[Timer]
OnBootSec=10min
OnCalendar=*-*-* 03:20
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now "$UNIT.timer" >/dev/null

echo
echo "자동 업데이트를 켰습니다 — 저장소 $REPO ($(sudo -u "$OWNER" git -C "$REPO" rev-parse --abbrev-ref HEAD) 브랜치)."
echo "다음 확인: $(systemctl list-timers "$UNIT.timer" --no-legend | awk '{print $1, $2, $3}')"
echo "기록:      journalctl -u $UNIT -n 50"

if [ "${1:-}" = "--now" ]; then
  echo
  echo "==> 지금 한 번 돌려 봅니다"
  systemctl start "$UNIT.service" || true
  journalctl -u "$UNIT" -n 30 --no-pager
fi
