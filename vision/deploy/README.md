# 라즈베리파이에 비전 서비스 설치

라즈베리파이 **CSI 카메라**(리본 케이블로 보드에 직접 붙는 카메라)를 쓰는 경우의
설치 방법입니다. 이 카메라는 libcamera 스택이라 도커 안에서 다루기 번거로워,
수질 센서 에이전트와 같은 방식으로 **systemd 서비스**로 올립니다.

> USB·IP(RTSP) 카메라라면 이 문서가 필요 없습니다. 저장소 루트의
> `docker compose --profile vision up -d` 로 어느 서버에서든 띄우면 됩니다.

## 1. 카메라 확인

```bash
rpicam-hello --list-cameras
```

카메라가 목록에 나와야 합니다. 안 나오면 리본 방향(접점이 보드 쪽)과
`raspi-config` 의 카메라 활성화를 먼저 확인하세요.

## 2. 설치

```bash
# 시스템 패키지 — picamera2 는 pip 로 깔지 않습니다(라즈베리파이 OS 제공).
sudo apt update
sudo apt install -y python3-picamera2 python3-venv git libgl1 fonts-noto-cjk

sudo useradd -r -s /usr/sbin/nologin -G video shrimp365 2>/dev/null || true
sudo mkdir -p /opt/shrimp365-vision /etc/shrimp365-vision

# 저장소의 vision/ 만 내려받아 배치합니다.
sudo git clone --depth 1 -b claude/camera-vision-migration-43d9xz \
  https://github.com/Ulrim/shrimp365.git /tmp/shrimp365
sudo cp -r /tmp/shrimp365/vision/* /opt/shrimp365-vision/
sudo rm -rf /tmp/shrimp365

# 가상환경 — picamera2 를 쓰려면 시스템 패키지가 보여야 합니다.
cd /opt/shrimp365-vision
sudo python3 -m venv --system-site-packages .venv
sudo .venv/bin/pip install -e ".[ml]"
sudo chown -R shrimp365:video /opt/shrimp365-vision
```

> `.[ml]` 설치(ultralytics·torch)는 파이에서 **20~40분** 걸립니다. 정상입니다.
> 모델 없이 시뮬레이션으로 먼저 확인만 할 거라면 `pip install -e .` 만 해도 됩니다.

## 3. 환경변수

```bash
sudo tee /etc/shrimp365-vision/env >/dev/null <<'EOF'
VISION_SERVICE_KEY=웹과_같은_값
VISION_STREAM_SECRET=웹과_같은_값
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:비밀번호@aws-0-....pooler.supabase.com:5432/postgres
SHRIMP365_INTERNAL_URL=https://www.shrimp365.kr
CORS_ORIGINS=https://www.shrimp365.kr

# 파이 4 는 추론이 무겁습니다. 초당 한 번이면 개체수 세기에 충분합니다.
MAX_CAMERAS=1
AUTO_START_STREAMS=true
EOF
sudo chmod 600 /etc/shrimp365-vision/env
```

## 4. 서비스 등록

```bash
sudo cp /opt/shrimp365-vision/deploy/shrimp365-vision.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shrimp365-vision
journalctl -u shrimp365-vision -f
```

`Starting shrimp365 vision service` 와 `Schema check passed (6 tables)` 가 보이면 정상입니다.

## 5. 바깥에서 닿게 하기

브라우저가 영상과 실시간 값을 받으려면 이 파이에 **https 주소**가 있어야 합니다.
농장 공유기 뒤에 있는 파이에는 포트 개방 없이 쓰는 Cloudflare Tunnel 이 가장 간단합니다.
설정은 `docs/VISION_DEPLOY.md` §3-4 를 보세요.

## 6. 성능에 대해

파이 4 의 CPU 추론은 빠르지 않습니다(YOLOv8n 기준 초당 2~3장 수준). 다만 개체수는
**초당 한 번이면 충분**하므로 기본값(`fps_target=1`)으로 쓸 수 있습니다. 대신:

- **방열판이나 팬을 다세요.** 추론이 4코어를 계속 쓰면 발열로 성능이 떨어집니다.
- **카메라 파이와 수질 센서 파이를 나누는 편이 낫습니다.** 한 대에 몰면 추론이
  CPU 를 먹는 동안 센서 수집이 밀립니다. 부득이 같이 쓴다면 서비스 파일의
  `Nice`/`CPUWeight` 가 센서 쪽을 먼저 보내도록 이미 낮춰 두었습니다.
- 카메라를 여러 대 붙일 계획이면 파이에서 추론하지 말고, 파이는 RTSP 로 영상만
  보내고 성능 좋은 서버에서 추론하는 구성이 낫습니다. 그때는 카메라 종류를
  `rtsp` 로 등록하면 됩니다 — 코드는 그대로입니다.
