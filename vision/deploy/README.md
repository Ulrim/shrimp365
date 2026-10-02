# 라즈베리파이에 개체수(비전) 장비 설치

라즈베리파이 **CSI 카메라**(리본 케이블로 보드에 직접 붙는 카메라)를 쓰는 경우의
설치 방법입니다. 이 카메라는 libcamera 스택이라 도커 안에서 다루기 번거로워,
수질 센서 장비와 같은 방식으로 **systemd 서비스**로 올립니다.

터치스크린을 달면 장비 자체가 계기판이 되고, 화면의 버튼으로 수조에 연결합니다.
명령줄을 몰라도 쓸 수 있어야 하므로 설치는 **명령 하나**로 끝납니다.

> USB·IP(RTSP) 카메라라면 이 문서가 필요 없습니다. 저장소 루트의
> `docker compose --profile vision up -d` 로 어느 서버에서든 띄우면 됩니다.

---

## 준비물

| | |
|---|---|
| 보드 | 라즈베리파이 4 이상 + **방열판이나 팬** |
| 카메라 | CSI 카메라 (리본 케이블) |
| 화면 | 공식 7인치 터치스크린 800×480 (선택이지만 권장) |
| OS | Raspberry Pi OS **Bookworm 이상, 데스크톱 포함** (Lite 는 화면을 못 답니다) |
| 받아 둘 값 | `VISION_SERVICE_KEY`·`VISION_STREAM_SECRET` (웹에 넣은 것과 같은 값), Supabase DB 주소 |

---

## 1. 카메라 확인

```bash
rpicam-hello --list-cameras
```

카메라가 목록에 나와야 합니다. 안 나오면 리본 방향(접점이 보드 쪽)과
`raspi-config` 의 카메라 활성화를 먼저 확인하세요. 여기서 안 되면 뒤 단계는
모두 의미가 없습니다.

## 2. 코드 받기

`shrimp365` 는 **비공개 저장소**입니다. `git clone` 을 그냥 하면 인증을 묻고,
거기에 GitHub 계정 비밀번호를 넣어도 통하지 않습니다 — GitHub 는 2021-08 부터
Git 작업에 비밀번호를 받지 않습니다. 둘 중 하나로 하세요.

**방법 1 — PC 에서 ZIP 으로 받아 복사 (토큰이 필요 없습니다).**

브라우저로 GitHub 저장소에 들어가 브랜치를 `claude/shrimp-water-quality-monitoring-aZ4EY`
로 바꾸고 **Code → Download ZIP**. 압축을 풀고 그 안의 `vision` 폴더만 보냅니다.

```bash
# PC 에서
scp -r shrimp365-claude-shrimp-water-quality-monitoring-aZ4EY/vision pi@192.168.0.50:~/
```

**방법 2 — 파이에서 바로 clone (읽기 전용 토큰을 하나 만듭니다).**

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token

- Repository access: **Only select repositories** → `Ulrim/shrimp365`
- Permissions → Repository permissions → **Contents: Read-only**
- Expiration: 설치에만 쓰니 **7 days** 로 충분합니다

```bash
cd ~
git clone --depth 1 --filter=blob:none --sparse \
  -b claude/shrimp-water-quality-monitoring-aZ4EY \
  https://github.com/Ulrim/shrimp365.git shrimp365-src
# Username: GitHub 아이디
# Password: 위에서 만든 토큰을 붙여넣기 (화면에 안 보이는 게 정상입니다)

cd ~/shrimp365-src
git sparse-checkout set vision
cp -r vision ~/vision
```

> `--filter=blob:none --sparse` 는 필요한 것만 받습니다. 저장소 전체는 51 MB
> 인데(대부분 `public/` 의 카드뉴스 이미지) 이렇게 받으면 24 MB 입니다.
>
> clone 에 `sudo` 를 쓰지 마세요. root 로 받으면 파일 주인이 어긋나고, 토큰도
> root 의 프로세스에 남습니다. 토큰은 명령줄에 적지 말고 **프롬프트에
> 붙여넣으세요** — 명령줄에 쓰면 `~/.bash_history` 와 `ps` 에 그대로 남습니다.

## 3. 설치 — 명령 하나

```bash
cd ~/vision
sudo ./deploy/install.sh
```

이 스크립트가 하는 일:

- 시스템 패키지 (picamera2·한글 글꼴)
- 전용 계정 `shrimp365` (카메라 권한만, 로그인 불가)
- 프로그램을 `/opt/shrimp365-vision` 에 배치
- 가상환경 + onnxruntime 추론 의존성 (1~2분)
- 설정 파일 `/etc/shrimp365-vision/env` 생성
- systemd 서비스 등록

**모델은 저장소에 함께 들어 있습니다**(`ai/models/shrimp_yolov8n_416.onnx`, 12 MB).
따로 복사할 것이 없습니다. 혹시 빠졌다면 설치 스크립트가 경고합니다 — 그대로
두면 서비스는 멀쩡히 뜨지만 **개체수가 가짜로 쌓입니다.**

이미 설치된 기기에서 다시 실행하면 프로그램만 새 것으로 바꾸고, 설정과 기기
연결은 그대로 둡니다.

## 4. 설정 — 세 줄

```bash
sudo nano /etc/shrimp365-vision/env
```

채울 것은 세 줄뿐입니다.

```
VISION_SERVICE_KEY=웹에_넣은_값
VISION_STREAM_SECRET=웹에_넣은_값
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:비밀번호@aws-0-....pooler.supabase.com:5432/postgres
```

`DATABASE_URL` 은 Supabase → Settings → Database → **Session pooler** 문자열입니다.
Supabase 가 주는 값은 `postgresql://` 로 시작하므로 **`+asyncpg` 를 끼워 넣어야**
합니다.

나머지(모델 경로·임계값·동시 카메라 수)는 기본값이 이미 맞습니다.

## 5. 시작

```bash
sudo systemctl start shrimp365-vision
journalctl -u shrimp365-vision -f
```

로그에서 이 줄을 확인하세요:

```
INFO Starting shrimp365 vision service — 실제 모델로 추론합니다 (.../shrimp_yolov8n_416.onnx)
```

대신 이 배너가 뜨면 **개체수가 가짜입니다.** 이유와 고치는 방법이 함께 적힙니다.

```
WARNING ====================================================================
  [시뮬레이션 모드] 이 서비스가 내보내는 개체수는 가짜입니다.
  이유: 모델 파일이 없습니다: ... (MODEL_PATH 를 .onnx 파일의 실제 경로로 지정하세요)
```

## 6. 터치스크린 달기 (권장)

```bash
cd ~/vision
sudo ./deploy/setup-kiosk.sh
sudo reboot
```

크로미움을 키오스크 모드로 띄우고, 화면 절전을 끄고, 부팅 때 자동 실행되게
합니다. 데스크톱이 있는 Raspberry Pi OS 에서만 됩니다.

재부팅하면 화면에 계기판이 뜹니다.

```
┌──────────────────────────────────────────────────┐
│ 🦐 Shrimp365          [촬영 중] [연결됨]          │
├────────────────┬─────────────────────────────────┤
│  현재 개체수    │                                 │
│                │       검출 박스가 그려진          │
│      131       │        라이브 영상               │
│       마리     │                                 │
│ 방금 · 신뢰도 55%│                                 │
├────────────────┤                                 │
│  최근 30분      │                                 │
│  ╱╲╱╲╱╲╱╲      │ A-1조 수중 카메라   [기기 연결]   │
└────────────────┴─────────────────────────────────┘
```

화면은 **이 장비 안에서만** 열립니다(`127.0.0.1:8080`). 인증 없이 영상과 연결
코드를 보여 주므로 — 장비 앞에 선 사람만 본다는 전제 — 바깥에 열리는 포트(8000)와
일부러 분리했습니다. 루프백이 아닌 주소로 설정하면 화면이 아예 뜨지 않습니다.

화면 포트가 이미 쓰이고 있어도 **개체수 측정은 그대로 계속됩니다.** 로그에
사유만 남고, 화면만 안 뜹니다.

## 7. 수조에 연결 — 6자리 코드

수질 센서 장비와 같은 방식입니다. 긴 키를 옮겨 적지 않습니다.

**화면이 있으면** — 연결 전 장비는 이 화면으로 시작합니다.

```
         이 카메라를 수조에 연결하세요
   아래 버튼을 누르면 6자리 코드가 나옵니다.
   Shrimp365에 그 코드를 넣으면 연결이 끝납니다.

            [ 기기 연결 시작 ]
```

누르면 6자리 코드가 크게 뜹니다. 그 코드를 들고:

1. 휴대폰이나 PC 에서 **www.shrimp365.kr** 접속
2. 로그인 → **개체수** → **설정**
3. **카메라 연결** → 6자리 코드 입력
4. 이 카메라를 붙일 **수조** 선택

**화면이 없으면** — 코드는 로그에도 뜹니다.

```bash
journalctl -u shrimp365-vision -f
```

```
───────────────────────────────────────────────
  연결 코드: 4 8 2 9 1 7
  (시리얼 100000001a2b3c4d · 15분간 유효)
───────────────────────────────────────────────
```

승인하는 순간 카메라가 등록되고, 파이가 기기 키를 받아
`/var/lib/shrimp365-vision/device.json` 에 저장합니다. 재부팅해도 그대로 자기
카메라를 맡습니다. 코드가 만료되면(15분) 화면의 버튼을 다시 누르거나
`sudo systemctl restart shrimp365-vision` 하세요.

> **승인 전까지 이 장비는 아무 카메라도 맡지 않습니다.** 시리얼만으로 붙이지
> 않는 이유는 시리얼이 장비 겉면에서 읽히는 값이라, 아무나 남의 계정에 카메라를
> 붙일 수 있기 때문입니다. 승인은 계정 주인만 할 수 있습니다.

## 8. 브라우저에서 영상 보기 (선택)

여기까지 하면 **개체수는 쌓이고 장비 화면에도 나옵니다.** 다만 웹에서 영상을
보려면 이 파이에 **https 주소**가 있어야 합니다. 농장 공유기 뒤의 파이에는 포트
개방 없이 쓰는 Cloudflare Tunnel 이 가장 간단합니다 — `docs/VISION_DEPLOY.md` §3-4.

터널이 서면 설정에 주소를 적고,

```
VISION_PUBLIC_URL=https://vision-1.shrimp365.kr
```

Vercel 환경변수에도 같은 주소를 넣고 재배포합니다.

```
VISION_SERVICE_URL=https://vision-1.shrimp365.kr
NEXT_PUBLIC_VISION_PUBLIC_URL=https://vision-1.shrimp365.kr
```

## 9. 파이가 여러 대일 때

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

> 대수가 늘면 파이에서 추론하지 말고 RTSP 로 영상만 보내 한 서버에서 모아
> 추론하는 구성이 낫습니다. 그때는 카메라 종류를 `rtsp` 로 등록하면 됩니다 —
> 코드는 그대로입니다.

## 10. 성능에 대해

파이 4 의 CPU 추론은 빠르지 않습니다. 다만 개체수는 **초당 한 번이면 충분**하므로
기본값(`fps_target=1`)으로 쓸 수 있습니다. 수행계획서 기준은 장당 1~3초입니다.

추측하지 말고 이 파이에서 직접 재세요. 이 숫자가 검수 근거입니다.

```bash
cd /opt/shrimp365-vision
sudo -u shrimp365 .venv/bin/python ai/trainer/export_edge.py \
    --weights ai/models/shrimp_yolov8n_416.onnx --bench --runs 30
```

기준을 넘으면 더 작은 해상도(320)로 내보낸 모델로 바꾸거나 `--format ncnn` 을
씁니다. **해상도를 바꾸면 임계값도 같이 바꿔야 합니다.**

| 해상도 | 최적 conf | 평균 계수 오차 | ±20% 내 | pred/gt |
|---|---|---|---|---|
| 416 (함께 들어 있음) | **0.30** | 4.6% | 94.6% | 0.973 |
| 512 | 0.25 | 4.4% | 94.0% | 0.996 |
| 640 | 0.25 | 3.5% | 95.1% | 0.960 |

valid 분할의 밀식 구간(GT ≥ 11, 185장) 기준입니다. 정확도 차이는 작고 속도
차이가 크므로, 파이에서 느리면 주저 없이 작은 쪽으로 가세요.

- **방열판이나 팬을 다세요.** 추론이 4코어를 계속 쓰면 발열로 성능이 떨어집니다.
- 터치스크린을 달면 크로미움이 코어를 나눠 씁니다. 추론이 밀리면
  `INFERENCE_THREADS=2` 로 제한하세요.
- 이 파이는 개체수 전용입니다(수질 센서는 다른 파이가 맡습니다). 한 대에 둘을
  같이 올리게 되면 서비스 파일에 `Nice=10`, `CPUWeight=50` 을 넣어 센서 쪽을
  먼저 보내야 합니다.

---

## 안 될 때

| 증상 | 확인 |
|---|---|
| 화면에 "개체수 화면을 불러오지 못했습니다" | `systemctl status shrimp365-vision` → 설정 세 줄이 비었는지 |
| 로그에 `[시뮬레이션 모드]` 배너 | 배너에 적힌 이유대로. 대개 `MODEL_PATH` 또는 모델 파일 없음 |
| 코드가 안 나옴 | `SHRIMP365_URL` 과 인터넷 연결. 로그에 사유가 적힙니다 |
| 영상이 웹에서 안 보임 | §8 의 터널과 `VISION_PUBLIC_URL` |
| 카메라가 안 열림 | `rpicam-hello --list-cameras`, `shrimp365` 계정이 `video` 그룹인지 |

```bash
journalctl -u shrimp365-vision -n 50     # 최근 로그 50줄
systemctl status shrimp365-vision        # 서비스 상태
curl -s localhost:8080/api/state | head  # 화면이 보는 값 그대로
```
