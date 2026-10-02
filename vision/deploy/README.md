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
```

### 2-a. 코드 올리기

`shrimp365` 는 **비공개 저장소**입니다. `git clone` 을 그냥 하면 인증을 묻고,
거기에 GitHub 계정 비밀번호를 넣어도 통하지 않습니다 — GitHub 는 2021-08 부터
Git 작업에 비밀번호를 받지 않습니다. 둘 중 하나로 하세요.

**방법 1 — PC 에서 ZIP 으로 받아 복사 (토큰이 필요 없습니다).**

브라우저로 GitHub 저장소에 들어가 브랜치를 `claude/shrimp-water-quality-monitoring-aZ4EY`
로 바꾸고 **Code → Download ZIP**. 압축을 풀고 그 안의 `vision` 폴더만 보냅니다.

```bash
# PC 에서
scp -r shrimp365-claude-shrimp-water-quality-monitoring-aZ4EY/vision pi@192.168.0.50:/tmp/

# 파이에서
sudo cp -r /tmp/vision/* /opt/shrimp365-vision/
rm -rf /tmp/vision
```

**방법 2 — 파이에서 바로 clone (읽기 전용 토큰을 하나 만듭니다).**

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token

- Repository access: **Only select repositories** → `Ulrim/shrimp365`
- Permissions → Repository permissions → **Contents: Read-only**
- Expiration: 설치에만 쓰니 **7 days** 로 충분합니다

`vision/` 은 0.35 MB 인데 저장소 전체는 51 MB 입니다(`public/` 의 카드뉴스
이미지가 대부분). 필요한 것만 받습니다 — 1.8 MB 로 끝납니다.

```bash
# sudo 를 쓰지 않습니다. root 로 받으면 파일 주인이 어긋나고, 토큰도
# root 의 프로세스에 남습니다.
cd ~
git clone --depth 1 --filter=blob:none --sparse \
  -b claude/shrimp-water-quality-monitoring-aZ4EY \
  https://github.com/Ulrim/shrimp365.git shrimp365-src
# Username: GitHub 아이디
# Password: 위에서 만든 토큰을 붙여넣기 (화면에 안 보이는 게 정상입니다)

cd ~/shrimp365-src
git sparse-checkout set vision

sudo cp -r ~/shrimp365-src/vision/* /opt/shrimp365-vision/
rm -rf ~/shrimp365-src          # 토큰이 남은 설정까지 같이 지웁니다
```

> 명령줄에 토큰을 적지 말고 **프롬프트에 붙여넣으세요.** 명령줄에 쓰면
> `~/.bash_history` 와 `ps` 에 그대로 남습니다.

### 2-b. 파이썬 환경

```bash
# picamera2 를 쓰려면 가상환경이 시스템 패키지를 볼 수 있어야 합니다.
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

## 3. 모델 확인 (복사할 것 없음)

배포용 모델 `shrimp_yolov8n_416.onnx` (12 MB) 는 **저장소에 함께 들어 있습니다.**
2 단계에서 코드를 올렸다면 이미 와 있습니다. 확인만 하세요.

```bash
ls -la /opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
sha256sum /opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
# ae95071c7e53df7e828e0faf51a54e0f7c5bb3010312b1d305949af12d533804
```

없거나 크기가 0 이면 2 단계의 복사가 덜 된 것입니다. 다시 하세요.

> **왜 이 파일만 저장소에 넣었나.** 학습 중간 산출물(`.pt`)은 넣지 않습니다 —
> 재학습마다 수십 MB 가 history 에 영구히 쌓입니다. 하지만 배포용 ONNX 가
> 저장소에 없으면 설치하는 사람이 PC 를 거쳐 따로 옮겨야 하고, 그 단계를
> 빠뜨리면 **서비스가 조용히 시뮬레이션으로 떠서 가짜 개체수가 DB 에 쌓입니다.**
> 12 MB 로 그 함정을 없애는 쪽을 택했습니다.

> **다른 해상도를 쓰려면.** 416 은 파이 4 기준입니다. 더 정확한 쪽이 필요하면
> 640 을 직접 내보내 올리고(`ai/trainer/export_edge.py`), `MODEL_PATH` 와
> **`CONFIDENCE_THRESHOLD` 를 같이** 바꾸세요. 해상도마다 최적값이 다릅니다.
>
> | 해상도 | 최적 conf | 평균 계수 오차 | ±20% 내 | pred/gt |
> |---|---|---|---|---|
> | 416 (함께 들어 있음) | **0.30** | 4.6% | 94.6% | 0.973 |
> | 512 | 0.25 | 4.4% | 94.0% | 0.996 |
> | 640 | 0.25 | 3.5% | 95.1% | 0.960 |
>
> valid 분할의 밀식 구간(GT ≥ 11, 185장) 기준입니다. 속도는 §9 에서 이 파이로
> 직접 재세요 — 세 해상도의 정확도 차이는 작고, 속도 차이가 큽니다.

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

# 저장소에 함께 들어 있는 모델. 기본값이 이미 이 파일을 가리키므로 생략해도
# 되지만, 서비스의 WorkingDirectory 에 의존하지 않도록 절대 경로로 못박습니다.
MODEL_PATH=/opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx
# 함께 들어 있는 416 모델의 측정 최적값입니다. 해상도를 바꾸면 이 값도
# 바꿔야 합니다 — 416→0.30, 512→0.25, 640→0.25.
CONFIDENCE_THRESHOLD=0.30

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
