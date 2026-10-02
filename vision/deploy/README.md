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
# 브랜치는 이 저장소에서 실제로 배포되는 브랜치입니다(main 이 아닙니다).
sudo git clone --depth 1 -b claude/shrimp-water-quality-monitoring-aZ4EY \
  https://github.com/Ulrim/shrimp365.git /tmp/shrimp365
sudo cp -r /tmp/shrimp365/vision/* /opt/shrimp365-vision/
sudo rm -rf /tmp/shrimp365

# 가상환경 — picamera2 를 쓰려면 시스템 패키지가 보여야 합니다.
cd /opt/shrimp365-vision
sudo python3 -m venv --system-site-packages .venv
sudo .venv/bin/pip install -e ".[edge]"
sudo chown -R shrimp365:video /opt/shrimp365-vision
```

> **왜 `.[edge]` 인가.** 파이에서 쓰는 모델은 ONNX(`MODEL_PATH=....onnx`)이고,
> 추론은 onnxruntime 만으로 돕니다(전처리·후처리는 `app/services/detector_onnx.py`
> 가 직접 합니다). 설치가 1분이면 끝납니다.
>
> `.pt` 가중치를 파이에서 직접 돌리려면 `.[ml]`(ultralytics·torch)이 필요한데
> 설치에 **20~40분** 걸리고 메모리도 많이 씁니다. 권하지 않습니다.
> 모델 없이 시뮬레이션으로 확인만 할 거라면 `pip install -e .` 만 해도 됩니다.
>
> 모델을 만들어 올리는 절차는 `docs/VISION_MODEL_TRAINING.md` 에 있습니다.

## 3. 모델 파일 올리기

**이 단계를 건너뛰면 서비스는 멀쩡히 뜨지만 개체수가 가짜입니다.** 가중치는
수십~수백 MB 이진 파일이라 저장소에 넣지 않습니다(`.gitignore`). 학습해서 받은
`shrimp_yolov8n_416.onnx` 를 PC 에서 파이로 복사하세요.

PC(윈도우 PowerShell 또는 터미널)에서:

```bash
scp shrimp_yolov8n_416.onnx pi@192.168.0.50:/tmp/
```

파이에서:

```bash
sudo mv /tmp/shrimp_yolov8n_416.onnx /opt/shrimp365-vision/ai/models/
sudo chown shrimp365:video /opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
ls -la /opt/shrimp365-vision/ai/models/   # 파일 크기가 0 이 아닌지 확인
```

> **416 과 640 중 무엇을 쓰나.** 파이 4 라면 416 을 권합니다 — 측정한 계수
> 오차율은 둘 다 약 5%(밀식 구간)로 사실상 같은데 416 이 훨씬 빠릅니다.
> 실제 속도는 §9 에서 이 파이로 직접 재세요.

## 4. 환경변수

```bash
sudo tee /etc/shrimp365-vision/env >/dev/null <<'EOF'
VISION_SERVICE_KEY=웹과_같은_값
VISION_STREAM_SECRET=웹과_같은_값
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:비밀번호@aws-0-....pooler.supabase.com:5432/postgres
SHRIMP365_URL=https://www.shrimp365.kr
CORS_ORIGINS=https://www.shrimp365.kr

# 이 파이의 공개 주소. 파이가 여러 대면 각자 다르게(vision-1 / vision-2 …).
VISION_PUBLIC_URL=https://vision-1.shrimp365.kr

# §3 에서 올린 모델. 이 줄이 없으면 기본값(...shrimp_yolov8n.pt)을 찾다가
# 파일이 없어 **조용히 시뮬레이션으로 떨어집니다**. 절대 경로로 적으세요.
MODEL_PATH=/opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
# 측정으로 고른 값(기본 0.25 보다 계수 오차율이 낮았습니다).
CONFIDENCE_THRESHOLD=0.35

# 파이 4 는 추론이 무겁습니다. 초당 한 번이면 개체수 세기에 충분합니다.
MAX_CAMERAS=1
AUTO_START_STREAMS=true
EOF
sudo chmod 600 /etc/shrimp365-vision/env
```

## 5. 서비스 등록

```bash
sudo cp /opt/shrimp365-vision/deploy/shrimp365-vision.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shrimp365-vision
journalctl -u shrimp365-vision -f
```

처음 뜨면 로그에 **6자리 연결 코드**가 뜹니다:

```
───────────────────────────────────────────────
  연결 코드: 4 8 2 9 1 7
  shrimp365 에 로그인해 개체수 → 설정에서 이 코드를 입력하세요.
  (시리얼 100000001a2b3c4d · 15분간 유효)
───────────────────────────────────────────────
```

## 6. 기기 등록 (페어링)

수질 센서 파이와 같은 방식입니다. 긴 키를 옮겨 적지 않습니다.

1. 파이 로그에 뜬 **6자리 코드**를 확인합니다 (`journalctl -u shrimp365-vision -f`)
2. shrimp365 에 로그인 → **개체수 → 설정 → 카메라 연결**
3. 코드를 넣고 **수조**를 고른 뒤 연결

승인하는 순간 카메라가 등록되고, 파이가 기기 키를 받아
`/var/lib/shrimp365-vision/device.json` 에 저장합니다. 이후 재부팅해도 그대로
자기 카메라를 맡습니다.

> **승인 전까지 이 파이는 아무 카메라도 맡지 않습니다.** 시리얼만으로 붙이지
> 않는 이유는 시리얼이 장비 겉면에서 읽히는 값이라, 아무나 남의 계정에 카메라를
> 붙일 수 있기 때문입니다. 승인은 계정 주인만 할 수 있습니다.

코드가 만료됐으면(15분) 서비스를 다시 시작하면 새 코드를 받습니다.

```bash
sudo systemctl restart shrimp365-vision
```

## 7. 바깥에서 닿게 하기

브라우저가 영상과 실시간 값을 받으려면 이 파이에 **https 주소**가 있어야 합니다.
농장 공유기 뒤에 있는 파이에는 포트 개방 없이 쓰는 Cloudflare Tunnel 이 가장 간단합니다.
설정은 `docs/VISION_DEPLOY.md` §3-4 를 보세요.

## 8. 파이가 여러 대일 때

CSI 카메라는 리본으로 보드에 직접 붙어 있어, **그 보드에서 도는 서비스만** 열 수
있습니다. 그래서 수조마다 파이를 두면 각 파이가 자기 카메라만 맡아야 합니다.

파이마다 두 가지만 다르게 하면 됩니다.

1. **`VISION_PUBLIC_URL`** — 파이마다 자기 주소(`vision-1`, `vision-2` …)
2. **페어링** — 파이마다 한 번씩

나머지(`VISION_SERVICE_KEY`·`VISION_STREAM_SECRET`·`DATABASE_URL`)는 모든 파이가
같은 값을 씁니다.

이렇게 해 두면 각 파이가 자기 기기 키로 자기 카메라만 알아보고, 그 주소가
카메라 행에 적혀 화면이 영상·실시간·시작/정지를 **카메라마다 제 파이로** 보냅니다.
파이가 세 대면 브라우저가 실시간 연결도 세 개를 엽니다 — 한 대가 죽어도 나머지는
그대로 보입니다.

이름을 손으로 정해 양쪽에 적는 방식이 아닌 이유가 여기 있습니다 — 오타 하나로
파이가 남의 카메라를 열려 들고, 그때는 원인이 로그에 보이지 않습니다.

> 파이마다 터널(또는 인증서)이 하나씩 필요합니다. Cloudflare Tunnel 이면
> 파이에서 `cloudflared tunnel create shrimp365-vision-2` 처럼 이름만 바꿔
> 만들고 `vision-2.shrimp365.kr` 로 라우팅하면 됩니다.

> 파이마다 https 주소가 따로 필요합니다(`vision-1.shrimp365.kr` …). 대수가 늘면
> 파이에서 추론하지 말고 RTSP 로 영상만 보내 한 서버에서 모아 추론하는 구성이
> 낫습니다. 그때는 카메라 종류를 `rtsp` 로 등록하면 됩니다 — 코드는 그대로입니다.

## 9. 성능에 대해

파이 4 의 CPU 추론은 빠르지 않습니다. 다만 개체수는 **초당 한 번이면 충분**하므로
기본값(`fps_target=1`)으로 쓸 수 있습니다. 수행계획서 기준은 장당 1~3초입니다.

추측하지 말고 이 파이에서 직접 재세요. 이 숫자가 검수 근거입니다.

```bash
cd /opt/shrimp365-vision
.venv/bin/python ai/trainer/export_edge.py \
    --weights ai/models/shrimp_yolov8n_416.onnx --bench --runs 30
```

기준을 넘으면 더 작은 해상도로 내보낸 모델(320)로 바꾸거나, `--format ncnn` 으로
내보낸 모델을 씁니다. 해상도를 바꾸면 정확도도 바뀌므로 계수 오차율을 다시
재야 합니다(`docs/VISION_MODEL_TRAINING.md`).

- **방열판이나 팬을 다세요.** 추론이 4코어를 계속 쓰면 발열로 성능이 떨어집니다.
- 코어를 다른 작업과 나눠 써야 하면 `INFERENCE_THREADS=2` 로 제한할 수 있습니다.
- 이 파이는 개체수 전용입니다(수질 센서는 다른 파이가 맡습니다). 그래서 서비스
  파일에 우선순위를 낮추는 설정을 두지 않았습니다 — 양보할 상대가 없습니다.
  한 대에 둘을 같이 올리게 되면 `Nice=10`, `CPUWeight=50` 을 넣어 센서 쪽을
  먼저 보내야 합니다.
