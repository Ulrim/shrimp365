# 수질 모니터링 프로그램 설치 안내서 — 라즈베리파이

라즈베리파이를 **수질 모니터링 장비**로 만드는 절차입니다.
설치하고 나면 이 한 대가 다음을 합니다.

- 센서에서 **수온·pH·용존산소·염도**를 1분마다 측정
- Shrimp365 계정으로 전송 → 웹의 수질 기록·차트·알림에 자동 반영
- 파이 화면에 현재 수치와 **6시간·12시간·24시간·일주일 그래프** 표시
- 인터넷이 끊기면 값을 파이에 보관했다가 회선이 돌아오면 이어서 전송

빈 SD카드에서 시작해 **Shrimp365 화면에 수질값이 올라오는 것까지** 순서대로 적었습니다.
처음 한 대는 넉넉히 **1시간**, 두 번째부터는 20분이면 됩니다.

기능 설명과 화면 예시는 [README.md](README.md) 에 있습니다. 이 문서는 설치 절차만 다룹니다.

---

## 전체 흐름

| 단계 | 하는 일 | 어디서 |
|---|---|---|
| 1 | SD카드에 OS 굽기 | PC |
| 2 | 첫 부팅 · 접속 | 파이 |
| 3 | 프로그램 내려받기 | 파이 |
| 4 | `sudo ./install.sh` | 파이 |
| 5 | 센서 배선 | 현장 |
| 6 | 설정 파일 채우기 | 파이 |
| 7 | 값이 읽히는지 점검 | 파이 |
| 8 | 상시 실행 시작 | 파이 |
| 9 | Shrimp365 계정과 연결 | 휴대폰·터치스크린 |
| 10 | (선택) LCD·터치스크린 | 파이 |

**5번(배선)을 먼저 해 두면** 7번에서 실제 값을 보며 확인할 수 있어 편합니다.
장비를 책상에서 먼저 만들어 두는 경우라면 지금 순서대로 진행하셔도 됩니다.

---

## 0. 준비물

**필수**

- 라즈베리파이 — Zero 2 W 이상. 터치스크린을 붙일 거면 **4 또는 5** 를 권합니다.
- microSD 카드 16GB 이상
- 파이 전원 어댑터 (공식 어댑터 권장 — 전압이 흔들리면 통신 오류가 잦습니다)
- **USB-RS485 변환기**
- 센서 전원 **DC 9~24V** — 파이의 5V로는 센서가 돌지 않습니다
- 인터넷 (WiFi 또는 유선)

**선택**

- I2C 문자 LCD (1602 / 2004)
- 라즈베리파이 공식 7인치 터치스크린 (800×480)

---

## 1. SD카드에 OS 굽기

PC에서 **Raspberry Pi Imager** 를 받습니다 — https://www.raspberrypi.com/software/

### OS 고르기

| 붙일 화면 | 고를 OS |
|---|---|
| 화면 없음, 또는 문자 LCD만 | **Raspberry Pi OS Lite (64-bit)** |
| 7인치 터치스크린 | **Raspberry Pi OS (64-bit)** — 데스크톱 포함 |

터치스크린 키오스크는 데스크톱 환경이 있어야 뜹니다. Lite 에는 없습니다.

### 굽기 전에 "설정 편집" 을 꼭 누르세요

Imager 가 굽기 직전에 **"OS 커스터마이즈 설정을 적용하시겠습니까?"** 를 묻습니다.
**설정 편집**을 눌러 아래를 채우면, 파이에 모니터를 붙이지 않고도 바로 접속할 수 있습니다.

- **호스트명** — 여러 대를 쓸 거면 구분되게. 예: `shrimp-a1`
- **사용자 이름·비밀번호** — 예: `pi` / (직접 정한 비밀번호). 기본 비밀번호는 쓰지 마세요.
- **무선 LAN** — 현장 WiFi 이름·비밀번호, 국가는 `KR`
- **서비스 탭 → SSH 사용** 체크

굽기가 끝나면 카드를 파이에 꽂고 전원을 넣습니다.

---

## 2. 첫 부팅 · 접속

첫 부팅은 1~2분 걸립니다.

**모니터·키보드를 붙였다면** 그대로 터미널을 쓰면 됩니다.

**떨어져서 접속한다면** 같은 네트워크의 PC에서 (Windows 는 PowerShell, Mac 은 터미널)

```bash
ssh pi@shrimp-a1.local
```

`.local` 이름이 안 잡히면 공유기 관리 화면에서 파이의 IP를 찾아 `ssh pi@192.168.0.xx` 로 접속합니다.

### 한글이 깨져 보이면 (Windows 에서 접속한 경우)

이 프로그램은 안내와 오류 메시지를 **한글로** 냅니다. Windows 의 명령 프롬프트(cmd)로
접속하면 `?????` `ÇÑ±Û` 처럼 깨져서, 정작 문제가 생겼을 때 원인을 읽을 수 없습니다.

**가장 빠른 해결 — Windows Terminal 로 접속하세요.** 별도 설정 없이 한글이 그대로 나옵니다.
Windows 11 에는 기본으로 있고(시작 → `terminal`), Windows 10 이면 Microsoft Store 에서
"Windows Terminal" 을 무료로 받으시면 됩니다.

cmd 를 그대로 쓰셔야 한다면 **접속하기 전에** 문자표를 UTF-8 로 바꿉니다.

```cmd
chcp 65001
ssh pi@shrimp-a1.local
```

이것만으로 네모(□□□)가 나온다면 글꼴 문제입니다. cmd 창 제목 표시줄에서
**마우스 오른쪽 버튼 → 속성 → 글꼴**을 열어 `굴림체` 나 `맑은 고딕` 처럼 한글이 있는
글꼴로 바꾸세요. `Consolas` 에는 한글이 없습니다.

자세한 내용과 다른 경우(PuTTY, 파이에 모니터를 직접 붙인 경우)는
**[부록 E](#e-한글이-깨져-보일-때)** 를 보세요.

### OS 최신화

접속되면 먼저 OS를 최신으로 올립니다.

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

---

## 3. 프로그램 내려받기

**방법 A(웹사이트에서 받기)를 권합니다.** 계정도 토큰도 git 도 필요 없습니다.
나머지는 인터넷이 없거나 저장소에서 직접 받아야 할 때 씁니다.

> **사이트가 주는 것은 "마지막으로 배포한 버전" 입니다.** 저장소에 들어간 코드가
> 자동으로 올라가지는 않습니다 — `release.py build` 로 꾸러미를 만들어 커밋해야
> 사이트에 반영됩니다. 방금 들어간 변경을 파이에 올리려는 것이라면, 받은 뒤
> `cat shrimp365-setup/VERSION` 또는 `grep '^VERSION' shrimp365-setup/shrimp365_sensor.py`
> 로 버전을 확인하시거나 **방법 B** 로 저장소에서 바로 받으세요.
>
> `manifest.json` 의 `latest` 는 **설치 꾸러미가 아니라 원격 업데이트**가 기준입니다
> (현장 장비가 받을 수 있는 가장 높은 버전). 설치 꾸러미만 낸 버전은 여기 오르지
> 않으니 설치본 확인에는 쓰지 마세요.

### 방법 A — 웹사이트에서 바로 받기 (권장)

```bash
curl -fsSLO https://www.shrimp365.kr/updates/shrimp365-setup-latest.tar.gz
tar xzf shrimp365-setup-latest.tar.gz
cd shrimp365-setup
```

이게 전부입니다. 설치에 필요한 파일이 모두 들어 있고 실행 권한도 그대로 살아 있습니다.

받은 파일이 진짜인지 확인하시려면(권장):

```bash
curl -fsSLO https://www.shrimp365.kr/updates/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
# shrimp365-setup-latest.tar.gz: OK
```

`OK` 가 아니면 받다가 깨졌거나 중간에 바뀐 것입니다. 다시 받으세요.

> 특정 버전을 받으시려면 파일 이름에 번호를 넣으면 됩니다 —
> `shrimp365-setup-1.1.0.tar.gz`. 어떤 버전이 있는지는
> https://www.shrimp365.kr/updates/manifest.json 에서 볼 수 있습니다.

### 방법 B — 저장소에서 받기

```bash
sudo apt install -y git
git clone -b claude/shrimp-water-quality-monitoring-aZ4EY \
  https://github.com/Ulrim/shrimp365.git
cd shrimp365/raspberry-pi
```

> 위 브랜치가 지금의 **기본 브랜치**라 `-b` 를 빼고 `git clone` 해도 같은 것을
> 받습니다. 적어 두는 것은 나중에 기본 브랜치가 바뀌어도 이 문서가 가리키는 곳이
> 흔들리지 않게 하기 위함입니다.

저장소가 **공개**라 아이디도 토큰도 묻지 않습니다. 위 두 줄이면 끝입니다.

> 예전에는 비공개라 개인용 액세스 토큰이 필요했습니다. 그 설명을 보고 토큰을 만들어
> 현장 장비에 남기신 적이 있다면 지금 지우세요 — `git credential-cache exit` 로
> 캐시를 비우고, GitHub → Settings → Developer settings 에서 그 토큰을 폐기합니다.

#### 저장소로 받은 장비를 스스로 업데이트하게 하기

```bash
cd ~/shrimp365/raspberry-pi
sudo ./setup-autoupdate.sh --branch main --now   # main 을 따라가게 하고 지금 한 번 확인
```

매일 새벽 3시대와 부팅 10분 뒤에 GitHub 를 확인해 새 것이 있으면 받아 `install.sh` 로 바꿔 끼우고
(설정·데이터는 그대로) 무선 수집기 코드도 바꾼 뒤 다시 시작합니다. 장비에서 손으로 고친 파일이
있으면 덮어쓰지 않고 건너뜁니다. 기록은 `journalctl -u shrimp365-gitupdate -n 50`,
끄려면 `sudo ./setup-autoupdate.sh --off`. 웹의 [업데이트] 버튼(서명된 꾸러미)과는 따로 돕니다.

### 방법 C — USB 메모리로 옮기기 (인터넷이 불안한 현장)

PC에서 `raspberry-pi` 폴더 **전체**를 USB 메모리에 복사합니다.
GitHub 웹에서 ZIP 으로 받으신다면 화면 왼쪽 위에서 브랜치를
`claude/shrimp-water-quality-monitoring-aZ4EY` 로 바꾼 뒤 받으세요 —
기본 브랜치에는 이 폴더가 아직 없습니다.

USB를 파이에 꽂고

```bash
lsblk                                   # sda1 등 USB 이름 확인
sudo mkdir -p /mnt/usb
sudo mount /dev/sda1 /mnt/usb
cp -r /mnt/usb/raspberry-pi ~/
sudo umount /mnt/usb
cd ~/raspberry-pi
```

### 방법 D — PC에서 바로 밀어 넣기 (같은 네트워크)

PC의 `raspberry-pi` 폴더가 있는 위치에서

```bash
scp -r raspberry-pi pi@shrimp-a1.local:~/
```

그다음 파이에서

```bash
cd ~/raspberry-pi
```

### 받았는지 확인 — 파일 구성

지금 위치에서 `ls` 를 치면 아래 파일들이 보여야 합니다.
**하나라도 빠지면 설치가 중간에 멈추므로** 먼저 맞춰 보세요.

```bash
ls
```

| 파일 | 무엇인지 | 설치되는 곳 |
|---|---|---|
| **`install.sh`** | 설치 스크립트. 아래 것들을 제자리에 놓아 줍니다 | (설치할 때만 씀) |
| `shrimp365_sensor.py` | **본체.** 센서 읽기·서버 전송·기기 연결을 모두 합니다 | `/opt/shrimp365/` |
| `buffer.py` | 인터넷이 끊긴 동안 값을 모아 두는 부분 | `/opt/shrimp365/` |
| `history.py` | 화면 그래프에 쓸 측정 이력 | `/opt/shrimp365/` |
| `display.py` | 문자 LCD 출력 (LCD 안 달면 안 씁니다) | `/opt/shrimp365/` |
| `webui.py` | 터치스크린에 띄우는 상태 화면 | `/opt/shrimp365/` |
| `updater.py` | 원격 업데이트를 받아 서명을 확인하고 적용 | `/opt/shrimp365/` |
| `config.example.ini` | **설정 견본.** 포트·센서·주기를 여기서 정합니다 | `/etc/shrimp365/config.ini` |
| `shrimp365-sensor.service` | 부팅하면 자동 시작하게 하는 등록 파일 | `/etc/systemd/system/` |
| `shrimp365-update.service` `.timer` | 하루 한 번 업데이트 확인 | `/etc/systemd/system/` |
| `setup-kiosk.sh` | 7인치 터치스크린을 쓸 때만 실행 (10번) | (설정할 때만 씀) |
| `requirements.txt` | 필요한 파이썬 패키지 목록 (`pyserial` 하나뿐) | (참고용) |
| `README.md` `INSTALL.md` | 문서 | (참고용) |

한 줄로 확인하려면

```bash
for f in install.sh shrimp365_sensor.py buffer.py history.py display.py \
         webui.py updater.py config.example.ini shrimp365-sensor.service \
         shrimp365-update.service shrimp365-update.timer; do
  [ -f "$f" ] && echo "  OK   $f" || echo "  없음 $f"
done
```

**`install.sh` 만 없다면** 다시 받지 않고도 진행할 수 있습니다 —
[부록 C](#c-installsh-없이-손으로-설치하기) 의 명령을 순서대로 실행하세요.
**`.py` 파일이 없다면** 복사가 덜 된 것이니 3번을 다시 하세요.

---

## 4. 설치

```bash
sudo ./install.sh
```

한 번에 끝납니다. 스크립트가 하는 일은 이렇습니다.

| | 내용 |
|---|---|
| 필요한 패키지 | `python3-serial` (그 외에는 파이썬 기본 기능만 씁니다) |
| 프로그램 | `/opt/shrimp365/` 에 배치 |
| 설정 파일 | `/etc/shrimp365/config.ini` 로 복사, 권한 600 |
| 데이터 폴더 | `/var/lib/shrimp365/` 생성 |
| 전용 계정 | `shrimp365` — 시리얼·I2C 접근만 가능, 로그인 불가 |
| 서비스 | `shrimp365-sensor` 등록 (부팅 시 자동 시작) |

프로그램을 `root` 로 돌리지 않는 이유는 단순합니다. 이 프로그램에 필요한 권한은
**시리얼 포트를 읽는 것**뿐이라, 그 이상을 줄 이유가 없습니다.

> 설치만 하고 **시작은 하지 않습니다.** 설정을 먼저 채워야 하기 때문입니다.
> 이미 설치된 기기에서 다시 실행하면 프로그램만 새 것으로 바꾸고,
> 설정과 그동안 쌓인 데이터는 건드리지 않습니다.

---

## 5. 센서 배선

전원을 **모두 내린 상태에서** 연결하세요.

| 센서 선 색 | 연결 |
|---|---|
| 빨강 | DC 9~24V (+) |
| 검정 | 0V (−) |
| 초록 | RS485 **A** (T/R+) |
| 노랑 | RS485 **B** (T/R−) |

```
  [pH 센서]──┐
  [DO 센서]──┼── A/B 두 선에 나란히 ──[USB-RS485]──USB──[라즈베리파이]
  [EC 센서]──┘
       └── 9~24V 전원 (0V 는 파이 GND 와 공통으로 묶기)
```

**꼭 지킬 것 세 가지**

1. 센서 전원의 **0V 와 파이 GND 를 공통으로 묶습니다.** 안 묶으면 통신이 들쭉날쭉합니다.
2. 센서 여러 대를 **같은 A/B 선에 나란히** 답니다. 단, **슬레이브 ID 가 서로 달라야** 합니다
   (출고 기본값: pH=1, DO=3, EC=4).
3. 선이 10m를 넘으면 **양 끝에 120Ω 종단저항**을 답니다.

배선이 끝나면 센서 전원 → 파이 전원 순으로 켭니다.

---

## 6. 설정 파일 채우기

먼저 변환기가 어느 포트로 잡혔는지 봅니다.

```bash
ls -l /dev/serial/by-id/
# usb-FTDI_FT232R_USB_UART_... -> ../../ttyUSB0
```

`ttyUSB0` 이면 그대로 두면 됩니다. 아무것도 안 나오면 변환기가 인식되지 않은 것이니
USB를 다시 꽂고 `dmesg | tail` 로 확인하세요.

```bash
sudo nano /etc/shrimp365/config.ini
```

처음에 확인할 곳은 두 군데뿐입니다.

```ini
[serial]
port = /dev/ttyUSB0        ; 위에서 확인한 값

[sensors]
ph_enabled = true          ; 연결하지 않은 센서는 false 로
ph_slave_id = 1
do_enabled = true
do_slave_id = 3
ec_enabled = true
ec_slave_id = 4
```

측정 주기는 기본 **1분**입니다(`interval_seconds = 60`). 서버가 기기당 분당 60회로
제한하므로 60초보다 짧게는 권하지 않습니다.

`device_key` 는 **비워 두세요.** 9번에서 코드로 연결하면 자동으로 채워집니다.

저장은 `Ctrl+O` → `Enter`, 닫기는 `Ctrl+X` 입니다.

> **GPIO UART 를 쓰신다면**(USB 변환기 대신) `sudo raspi-config` →
> Interface Options → Serial Port → 로그인 셸 **아니오** / 하드웨어 포트 **예** 로 놓고,
> `port = /dev/serial0` 으로 적습니다.

---

## 7. 값이 읽히는지 점검

서버로 보내기 전에, 센서에서 값이 제대로 들어오는지 먼저 봅니다.

```bash
sudo -u shrimp365 python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --once --dry-run -v
```

정상이면 이렇게 나옵니다.

```json
{
  "ph": 7.85,
  "orp": 210.0,
  "do_level": 6.42,
  "do_saturation": 84.1,
  "conductivity": 32.1,
  "tds": 16.05,
  "salinity": 21.4,
  "temperature": 28.4
}
```

**여기서 값이 안 나오면 다음 단계로 넘어가지 마세요.** 배선 문제입니다.
아래 표에서 메시지를 찾아 먼저 해결하세요.

| 메시지 | 원인 | 할 일 |
|---|---|---|
| `could not open port` | 포트 이름이 다름 | 6번의 `ls -l /dev/serial/by-id/` 다시 확인 |
| `응답 없음` | 전원·배선·**ID** | 아래 `--scan` 으로 먼저 확인하세요 |
| `CRC 불일치` | 노이즈·선 길이 | 120Ω 종단저항, 전원선과 통신선 분리 |
| `다른 기기가 응답함` | 슬레이브 ID 충돌 | 같은 ID 센서가 둘. 한 대씩 연결해 ID 변경 |

### 한두 개만 안 읽힐 때 — 먼저 선을 훑어 보세요

나머지는 되는데 특정 센서만 `응답 없음` 이면, 배선보다 **슬레이브 ID** 가 원인인
경우가 대부분입니다. 출고 기본값과 다르게 설정되어 나오는 제품이 있습니다.

```bash
sudo -u shrimp365 python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --scan
```

선에 실제로 무엇이 붙어 있는지 보여 줍니다.

```
  ID   추정             비고
  ---  ---------------  ------------------------
  1    pH 센서            첫 값 7.85 pH
  4    EC 센서            첫 값 32.1 mS
  5    DO 센서            첫 값 6.42 mg/L

설정의 슬레이브 ID 와 견줘 보세요 — /etc/shrimp365/config.ini 의 [sensors]
  ph_slave_id = 1
  do_slave_id = 3   ← 응답 없음
  ec_slave_id = 4
```

이 경우 DO 센서가 3 이 아니라 **5** 에 붙어 있습니다. 설정을 고치면 됩니다.

```bash
sudo nano /etc/shrimp365/config.ini      # do_slave_id = 5
```

**아무것도 안 나온다면** ID 문제가 아니라 전원이나 배선입니다.
A와 B를 바꿔 꽂는 실수가 가장 흔하니 두 선을 서로 바꿔 보세요.

**같은 ID 가 둘이면** 서로를 가려 하나만 보입니다. 훑기로는 구분이 안 되므로,
**확인하려는 센서 하나만 남기고 나머지의 A/B 를 뺀 뒤** 다시 훑으세요.
그때 나오는 번호가 그 센서의 진짜 ID 입니다.

### ID 가 겹쳤을 때 — 바꾸기

겹친 센서의 번호를 비어 있는 번호로 옮기면 됩니다.
**센서를 한 대만 연결한 상태에서** 하세요. 여러 대가 붙어 있으면 엉뚱한 센서가 바뀝니다.

```bash
sudo -u shrimp365 python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --set-id 1 3
#                                             ↑ 지금 ID  ↑ 바꿀 ID
```

이미 다른 센서가 쓰는 번호로는 바꾸지 못하게 막아 두었습니다.
바꾼 뒤에는 설정 파일의 슬레이브 ID 도 같은 번호로 고치고, 센서 전원을 껐다 켜세요
(전원을 다시 넣어야 적용되는 제품이 있습니다).

```bash
sudo nano /etc/shrimp365/config.ini      # do_slave_id = 3
sudo systemctl restart shrimp365-sensor
```

기본은 ID 1~32 를 훑습니다. 더 넓게 보시려면 `--scan-range 1-64`.

값이 맞으면 실제로 한 번 보내 봅니다. 아직 계정에 연결하지 않았으므로
**"기기 키가 없습니다"** 가 뜨고 값은 파이에 보관됩니다 — 정상입니다.

---

## 8. 상시 실행 시작

```bash
sudo systemctl start shrimp365-sensor
systemctl status shrimp365-sensor        # active (running) 확인
journalctl -u shrimp365-sensor -f        # 흐르는 로그 보기 (Ctrl+C 로 나오기)
```

이제 정전이 나거나 재부팅해도 알아서 다시 시작합니다.
인터넷이 끊겨도 프로세스는 살아 있고, 측정값은 파이에 쌓였다가 회선이 돌아오면 올라갑니다.

---

## 9. Shrimp365 계정과 연결

키를 옮겨 적을 필요 없이, 기기가 띄우는 **6자리 코드**로 연결합니다.

**코드 받기** — 화면이 있느냐에 따라 다릅니다.

터치스크린이 있으면 화면 오른쪽 아래 **기기 연결** 버튼을 누르면 코드가 뜹니다.

화면이 없으면 SSH 에서 한 줄로 받습니다.

```bash
sudo -u shrimp365 python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --pair
# 연결 코드: 482100 — Shrimp365 에 로그인해 이 코드를 입력하세요
```

코드가 화면에 뜬 채로 승인될 때까지 기다립니다. 연결되면 알려 주고 끝납니다.

**연결하기**

1. 휴대폰이나 PC에서 **www.shrimp365.kr** 접속 → 로그인
2. **양식장·수조 관리** → 센서를 붙일 수조의 **센서 기기** 펼치기
3. **코드로 기기 연결** → 6자리 코드 입력

승인되면 기기가 키를 자동으로 받아 설정 파일에 저장합니다.
`--pair` 로 연결하셨다면 서비스를 다시 시작해 새 키를 읽게 합니다.

```bash
sudo systemctl restart shrimp365-sensor
```

**연결 전에 측정해 둔 값도 이때 함께 올라갑니다.**

> 코드는 15분간 유효합니다. 지나면 기기가 알아서 새 코드를 띄웁니다.
> 승인 전까지 기기는 어떤 데이터도 계정에 올릴 수 없습니다.

**왜 이메일 입력이 아니라 코드인가** — 이메일 주소는 명함에도 게시판에도 있는 공개
정보입니다. 이메일만으로 기기를 지정하게 하면 누구나 남의 계정에 가짜 수질값을 밀어 넣을
수 있습니다. 수질 데이터는 알림과 판단의 근거이므로, 승인은 **로그인한 계정 주인만**
할 수 있어야 합니다.

### 확인

www.shrimp365.kr 에서 해당 수조를 보면 기기 카드에 **방금 전**과 측정값이 뜹니다.
1분 뒤 새로고침해 시각이 갱신되면 끝난 것입니다.

---

## 10. (선택) 화면 붙이기

### 문자 LCD

```bash
sudo raspi-config          # Interface Options → I2C → 예
sudo apt install -y i2c-tools
sudo i2cdetect -y 1        # 27 또는 3f 가 보이면 정상
```

`/etc/shrimp365/config.ini` 의 `[display]` 를 고칩니다.

```ini
[display]
type = i2c_lcd
columns = 16          ; 1602 이면 16, 2004 이면 20
rows = 2              ; 1602 이면 2,  2004 이면 4
i2c_address = 0x27    ; i2cdetect 에서 본 주소
```

```bash
sudo systemctl restart shrimp365-sensor
```

배선과 표시 예시는 [README.md](README.md#lcd-화면-붙이기-선택) 를 보세요.

### 7인치 터치스크린

데스크톱이 있는 Raspberry Pi OS 에서만 됩니다.

```bash
cd ~/raspberry-pi
sudo ./setup-kiosk.sh
sudo reboot
```

스크립트가 상태 페이지(`[webui] enabled`)를 알아서 켜고 수집기를 다시 시작합니다.
크로미움 설치, 부팅 시 자동 실행, 화면 절전 해제, 한글 글꼴까지 함께 처리합니다.

재부팅하면 화면에 계기판이 자동으로 뜹니다. 값 칸을 누르면 **6시간·12시간·24시간·일주일**
그래프가 열립니다.

---

## 11. 마무리 확인표

설치가 끝났는지 이 여섯 가지로 확인합니다.

```bash
# 1) 서비스가 돌고 있는가
systemctl is-active shrimp365-sensor          # active

# 2) 재부팅해도 뜨는가
systemctl is-enabled shrimp365-sensor         # enabled

# 3) 최근 오류가 없는가
journalctl -u shrimp365-sensor -p err -n 20   # 비어 있으면 정상

# 4) 밀린 값이 쌓이지 않는가 (0 또는 한 자리)
sudo -u shrimp365 python3 -c "import sqlite3;print(sqlite3.connect('/var/lib/shrimp365/queue.db').execute('select count(*) from readings').fetchone()[0])"

# 5) 설정 파일 권한이 좁은가
ls -l /etc/shrimp365/config.ini               # -rw------- shrimp365
```

```bash
# 6) 판정이 설계대로인가 — 센서·인터넷 없이 돈다
python3 /opt/shrimp365/verify.py              # 마지막 줄 "모두 통과"
```

7) **www.shrimp365.kr** 의 수조 화면에서 측정 시각이 1분마다 갱신되는가

일곱 개가 다 맞으면 설치 완료입니다.

---

# 부록

## A. 프로그램 업데이트

**두 번째부터는 웹에서 원격으로 하시면 됩니다.** 기기 카드의 **[업데이트]** 를
누르면 그 기기만 다음 확인 때(하루 한 번) 새 버전을 받아 갑니다. 자세한 내용은
[README 의 원격 업데이트](README.md#원격-소프트웨어-업데이트) 를 보세요.

손으로 하실 때는 새 버전을 3번과 같은 방법으로 받은 뒤, 그 폴더에서

```bash
sudo ./install.sh
```

돌고 있던 서비스는 자동으로 다시 시작됩니다.
**설정 파일과 그동안 쌓인 측정 이력은 그대로 둡니다.**

> 지금 현장에 나가 있는 장비에는 원격 업데이트 기능 자체가 없습니다.
> **한 번은 위 방법으로 손수 올려 주셔야** 그다음부터 원격이 됩니다.

## B. 두 번째 기기부터 — SD카드를 복제할 때

여러 대를 만들 때 SD카드 이미지를 복제하면 빠르지만, **반드시 아래 두 가지를 지우세요.**

```bash
# 1) 기기 키 — 안 지우면 두 기기가 같은 키를 써서 값이 뒤섞입니다
sudo sed -i 's/^device_key.*/device_key =/' /etc/shrimp365/config.ini

# 2) 앞 기기의 측정 데이터
sudo rm -f /var/lib/shrimp365/*.db

sudo systemctl restart shrimp365-sensor
```

키를 비우면 새 기기가 새 6자리 코드를 띄웁니다. 9번을 다시 하면 됩니다.
호스트명도 `sudo raspi-config` 에서 구분되게 바꿔 두면 관리가 편합니다.

## C. `install.sh` 없이 손으로 설치하기

USB 복사본이 오래되어 `install.sh` 가 들어 있지 않을 때, 다시 복사해 오지 않고
그대로 진행하는 방법입니다. 스크립트가 하는 일을 그대로 풀어 쓴 것이라 결과는 같습니다.

`raspberry-pi` 폴더 안에서 순서대로 실행하세요.

```bash
# 1) 필요한 패키지
sudo apt update && sudo apt install -y python3-serial

# 2) 프로그램 배치
sudo install -d -m 755 /opt/shrimp365 /etc/shrimp365
sudo install -m 644 shrimp365_sensor.py display.py webui.py buffer.py history.py \
  /opt/shrimp365/

# 3) 설정 파일 (권한 600 — 기기 키가 들어갑니다)
sudo install -m 600 config.example.ini /etc/shrimp365/config.ini

# 4) 전용 계정 — 시리얼 포트 접근만, 로그인 불가
sudo useradd -r -s /usr/sbin/nologin shrimp365
sudo usermod -aG dialout shrimp365
sudo usermod -aG i2c shrimp365 2>/dev/null   # LCD 를 붙일 경우

# 5) 설정 파일은 수집기 소유여야 합니다.
#    코드로 연결하면 받은 기기 키를 수집기가 직접 이 파일에 적기 때문입니다.
sudo chown shrimp365:shrimp365 /etc/shrimp365/config.ini

# 6) 오프라인 보관분과 그래프 이력을 둘 곳
sudo install -d -m 700 -o shrimp365 -g shrimp365 /var/lib/shrimp365

# 7) 서비스 등록 (부팅 시 자동 시작)
sudo install -m 644 shrimp365-sensor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable shrimp365-sensor
```

제대로 됐는지 확인합니다.

```bash
ls -l /etc/shrimp365/config.ini      # -rw------- shrimp365 shrimp365
ls /opt/shrimp365/                   # .py 파일 5개
```

여기까지 됐으면 안내서 **5번(배선)** 으로 돌아가 이어서 진행하세요.

> 다음에 프로그램을 업데이트하실 때는 새 복사본에 `install.sh` 가 들어 있을 것이므로
> `sudo ./install.sh` 한 줄이면 됩니다.

## D. 제거

```bash
sudo systemctl disable --now shrimp365-sensor
sudo rm -f /etc/systemd/system/shrimp365-sensor.service
sudo systemctl daemon-reload
sudo rm -rf /opt/shrimp365 /etc/shrimp365 /var/lib/shrimp365
sudo userdel shrimp365
```

Shrimp365 웹에서도 해당 기기를 **비활성**으로 바꾸거나 삭제하세요.
그래야 그 키로는 더 이상 아무것도 올라오지 않습니다.

## E. 한글이 깨져 보일 때

증상에 따라 원인이 다릅니다. **먼저 어떻게 깨지는지 보세요.**

| 화면에 나오는 모양 | 원인 | 어디를 고치나 |
|---|---|---|
| `???` `?????` | 터미널 문자표가 UTF-8 이 아님 | 접속하는 PC |
| `ÇÑ±Û` `한글` 같은 깨진 글자 | 위와 같음 (다른 문자표로 해석) | 접속하는 PC |
| `□□□` `▯▯▯` (네모만) | 문자표는 맞는데 **글꼴에 한글이 없음** | 접속하는 PC의 글꼴 |
| 빈칸으로 아무것도 없음 | 파이에 모니터를 직접 붙인 화면(콘솔) | 아래 4번 참고 |

파이 쪽 프로그램은 언제나 UTF-8 로 내보냅니다. 그래서 **거의 모든 경우 고칠 곳은
파이가 아니라 접속하는 PC 쪽**입니다.

### 1. Windows 명령 프롬프트(cmd) · PowerShell

한국어 Windows 는 기본 문자표가 `949`(CP949)라 UTF-8 한글이 깨집니다.
**접속하기 전에** 바꾸세요.

```cmd
chcp 65001
ssh pi@shrimp-a1.local
```

`chcp` 는 그 창에서만 유효해서, 창을 새로 열 때마다 다시 쳐야 합니다.
매번 치기 번거로우면 아래 명령으로 cmd 가 열릴 때 자동으로 실행되게 해 둘 수 있습니다.

```cmd
reg add "HKCU\Software\Microsoft\Command Processor" /v Autorun /d "chcp 65001>nul" /f
```

되돌릴 때는

```cmd
reg delete "HKCU\Software\Microsoft\Command Processor" /v Autorun /f
```

### 2. 글꼴에 한글이 없을 때 (네모로 나옴)

문자표는 맞게 잡혔는데 글꼴이 한글을 못 그리는 경우입니다.
cmd 창 **제목 표시줄에서 마우스 오른쪽 → 속성 → 글꼴** 탭에서
`굴림체` 또는 `맑은 고딕` 을 고르세요. 기본값인 `Consolas` 에는 한글 글자가 없습니다.

### 3. Windows Terminal (권장)

위 두 가지를 신경 쓸 필요가 없습니다. UTF-8 이 기본이고 한글 글꼴도 알아서 찾습니다.

- Windows 11 — 이미 설치돼 있습니다. 시작 메뉴에서 `terminal`
- Windows 10 — Microsoft Store 에서 "Windows Terminal" (무료)

여러 대를 관리하실 거면 여기에 접속 정보를 저장해 두는 편이 훨씬 편합니다.

### 4. PuTTY 를 쓰신다면

접속 전 설정 창에서 두 군데를 바꿉니다.

- **Window → Translation → Remote character set** → `UTF-8`
- **Window → Appearance → Font** → `굴림체` 또는 `맑은 고딕`

바꾼 뒤 Session 화면에서 **Save** 를 눌러야 다음에도 유지됩니다.

### 5. 파이에 모니터를 직접 붙인 경우

여기만은 PC 문제가 아닙니다. **Lite 버전의 검은 콘솔 화면(tty)에서는 한글이
원리상 표시되지 않습니다.** 이 화면은 글자 모양을 몇백 개만 담을 수 있어서
한글 글꼴이 아예 들어가지 않습니다. 문자 LCD 에 한글이 안 나오는 것과 같은 이유입니다.

세 가지 중에 고르세요.

1. **다른 PC에서 SSH 로 접속** — 가장 간단하고, 위 방법대로 하면 한글이 그대로 나옵니다.
2. **데스크톱 버전 OS를 쓰고 그 안의 터미널을 사용** — 한글이 정상 표시됩니다.
   글꼴이 부실하면 `sudo apt install -y fonts-nanum`
3. **영어로 보기** — 급할 때 로그만 확인하는 용도입니다.
   ```bash
   LANG=C journalctl -u shrimp365-sensor -n 50
   ```
   프로그램 메시지 자체는 한글이라 그대로지만, 시스템 메시지는 영어로 나옵니다.

### 6. 터치스크린에 네모(□□□)가 나올 때

7인치 화면의 계기판은 4개 언어(한국어·영어·베트남어·인도네시아어)로 뜹니다.
해당 글꼴이 없으면 네모로 보입니다.

```bash
sudo apt install -y fonts-noto-cjk fonts-noto-core
sudo reboot
```

`setup-kiosk.sh` 가 이 글꼴들을 함께 설치하지만, 그 전에 만든 장비이거나
설치 중 인터넷이 끊겼다면 위 명령으로 채워 넣으시면 됩니다.
(한국어만 급히 채우려면 `fonts-nanum` 만으로도 됩니다.)

화면 언어는 계기판의 **[설정] → [언어 설정]** 에서 바꿉니다.

스마트팜(수경재배)에 쓰는 장비라면 **[설정] → [모드]** 에서 "스마트팜(Farm365)" 을 고르세요
(`config.ini` 의 `[webui] mode = agriculture` 와 같습니다). 화면 이름이 Farm365 로, 라벨이
베드·농장·양액으로, 염도 칸이 전도도(mS/cm)로 바뀌고 양액 보충 안내가 앞에 놓입니다.
측정과 서버 전송은 두 모드가 같습니다.

**환경·기상 칸 (스마트팜, 선택).** 값 격자 아래에 기온(또는 초관부 온도)·습도·토양수분 칸이,
센서가 있으면 지온·풍속·오늘 강수 칸이 더 뜹니다. 같은 값이 수질 값과 함께 서버로 올라가
웹 대시보드의 "환경·기상" 카드에 나옵니다. 장비가 센서를 직접 받지는 않고, 같은 파이에서
도는 노지 수집기의 파일을 읽습니다.

**무선 센서 연결 — 장비 화면에서 합니다.**

1. 지그비 동글(SONOFF)을 꽂고, 433MHz 기상센서(WS90)를 쓰면 RTL-SDR 동글도 꽂습니다.
2. 처음 한 번만 수집 프로그램을 설치합니다(인터넷 필요, 10~20분):
   ```bash
   sudo bash /opt/shrimp365/setup-wireless.sh
   ```
   메시지 중계(mosquitto)·Zigbee2MQTT·수집기를 설치하고 서비스로 등록합니다. 동글이
   SONOFF Dongle-P(CC2652P)면 `--adapter zstack` 을 붙입니다. 에코윗 게이트웨이 수신기(포트 8088)는
   늘 켜 둡니다(예전 `--ecowitt` 옵션은 이제 필요 없습니다). `config.ini` 의 `[environment]` 도 켜 줍니다.
3. 장비 화면 **[설정] → [무선 센서]** 에서 **[새 센서 찾기]** 를 누르고, 센서의 버튼을 5초 길게 누릅니다.
   찾은 센서가 목록에 뜨면 **[등록]** → 무엇을 재는 센서인지(초관부 온습도·2m 기온·토양·차단기·누수·밸브)와
   어디에 달았는지(적용구간·비교구간·시설·기상 폴대)를 고릅니다. 이름(CN-T1, SOIL-C2, PUMP-01 …)은
   장비가 정하고, 몇 초 안에 값이 들어옵니다. 서비스 재시작은 필요 없습니다.
4. **433MHz 센서(기상센서 WS90·무선 토양센서 WH51·온습도 WH31·엽면습윤 WH35·우량계 WH40)** 는 페어링이
   없습니다. 센서 전원을 켜면 1분 안에 같은 화면의 **'근처에서 들리는 센서'** 에 모델과 id 가 뜹니다.
   **[등록]** → 종류·구간을 고르면 그 한 대만 받습니다(이웃집 같은 모델은 버립니다). 같은 모델이 여러 대
   뜨면 센서 전원을 껐다 켜서 방금 '1회'로 새로 뜬 것을 고르세요. 처음 설치한 장비는 WS90 을 모델 단위로
   받도록 돼 있는데, 목록에서 내 WS90 을 등록하면 이름(WS90-01)은 그대로 두고 그 한 대로 좁혀집니다.
5. **에코윗 게이트웨이(GW1100·GW2000 등, 와이파이)** 는 게이트웨이가 장비로 보내 옵니다. 같은 화면 아래
   **'에코윗 게이트웨이'** 칸에 이 장비의 주소·포트(8088)·경로(`/data/report/`)가 나옵니다. 게이트웨이를 농장
   와이파이에 붙이고 WS View Plus 앱 → 기기 → **[Customized]** 에서 프로토콜 `Ecowitt`, 위 값, 간격 60초를
   적어 저장하면 1~2분 안에 **'들어온 게이트웨이'** 와 거기 붙은 센서(게이트웨이 기상센서·토양수분 WH51·
   지온 WN34·엽면습윤 WH35·온습도 WH31 채널)가 뜹니다. **[등록]** → 구간을 고릅니다(온습도계는 초관부
   10cm 인지 2m 기온인지도). 등록한 게이트웨이(PASSKEY)와 채널만 받고, 같은 망의 다른 게이트웨이는
   버립니다. 같은 WS90 을 433MHz 로 받고 있었다면 게이트웨이를 등록할 때 그 칸을 걷고 이름(WS90-01)을
   이어받습니다 — 두 길로 받으면 비가 두 번 더해지므로 화면이 둘 다 등록하는 것을 막습니다.
   처음 등록할 때 그 게이트웨이의 열쇠(PASSKEY)를 적어 두므로, 다른 게이트웨이로 바꾸려면 에코윗 칸을 모두
   뺀 뒤 새로 등록합니다. **예전에 `--ecowitt` 로 설치해 손으로 `ecowitt:` 칸을 쓰던 장비**는 설치 명령을 다시
   돌리면 등록이 없거나 열쇠가 없는 경우 안내가 뜹니다 — 화면에서 다시 등록하면 됩니다.
6. 같은 화면에서 센서마다 배터리·신호 세기·마지막 수신을 봅니다. 고장 난 센서는 **[빼기]** 로 지우고
   새 센서를 다시 찾아 붙입니다.
7. **투야 블루투스 토양센서(SGS01B-JR 등, 투야·Smart Life 앱에 붙는 블루투스 모델)** 는 지그비 동글로
   찾을 수 없습니다. 값을 암호로 보내므로 센서마다 열쇠를 투야 클라우드에서 **한 번** 받아야 하고,
   그 뒤로는 인터넷 없이 파이가 5분마다 직접 붙어 토양수분·지온·배터리를 읽습니다.
   1. 센서를 투야(또는 Smart Life) 앱에 붙여 둡니다(이미 붙었으면 그대로).
      **앱에서 센서를 지우고 다시 붙이면 열쇠가 바뀝니다** — 그때는 아래 iii 을 다시 합니다.
   2. 투야 IoT 개발자 계정(한 번만, 무료): <https://platform.tuya.com> 가입 → **Cloud → Development →
      Create Cloud Project**(Industry·Development Method: Smart Home, **Data Center: Western America** —
      한국 앱 계정은 미국 서부로 연결됩니다. 무료 판은 데이터센터를 하나만 고를 수 있고, 중국은 안 됩니다)
      → **Overview** 의 Access ID·Access Secret 을 적어 둡니다 → 프로젝트의 **Devices → Link App Account →
      Add App Account** 창에 뜬 QR 을 앱 **나(Me) → 오른쪽 위 스캔** 으로 찍어 연결합니다.
      개발자 사이트 **로그인 화면의 QR** 을 찍으면 "QR 코드로 로그인 · 권한이 없습니다" 가 뜹니다 — 그 QR 이 아닙니다.
      연결되면 Devices 목록에 센서가 보입니다.
   3. 파이에서(인터넷 필요):
      ```bash
      sudo bash /opt/shrimp365/setup-tuya-ble.sh --register
      ```
      블루투스 수집기(farm365-tuyable)를 설치한 뒤 Access ID·Secret 을 묻고, 앱에 붙은 블루투스 기기를
      보여 줍니다. 번호를 고르고 구간(처리구·대조구·시설)을 고르면 이름(SOIL-T1, SOIL-C1 …)이 붙어
      `devices.yaml` 의 `tuya_ble:` 칸에 적힙니다(Access ID·Secret 은 저장하지 않습니다).
      나중에 센서를 더하거나 뺄 때는 `sudo /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/tuya_ble_setup.py`
      (보기 `--list`, 빼기 `--remove SOIL-T1`).
   4. 바로 읽히는지 확인:
      ```bash
      sudo systemctl stop farm365-tuyable
      sudo -u shrimp365 /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/field/scripts/tuya_ble_bridge.py \
        --devices /var/lib/shrimp365/field/devices.yaml --out /var/lib/shrimp365/field/data \
        --capture /var/lib/shrimp365/field/data/capture --once -v
      sudo systemctl start farm365-tuyable
      ```
      `[SOIL-T1] [{... 'variable': 'soil_moisture', 'value': 31.0 ...}]` 처럼 나오면 됩니다. 장비 화면
      **[무선 센서]** 아래 '블루투스 토양센서' 칸에서도 마지막 수신·배터리·오류를 봅니다.
   - **휴대폰 투야 앱을 열어 두면** 앱이 센서를 붙잡아 파이가 붙지 못할 수 있습니다. 앱을 닫아 두세요.
   - 파이와 센서 사이는 블루투스라 **10m 안팎**(벽·흙·물에 약함)입니다. '광고가 안 들립니다' 가 뜨면
     거리와 배터리를 봅니다.
   - 제품마다 값 번호(DP)가 다를 수 있습니다. 알려진 두 배치는 스스로 맞추고, 모르면 '-v' 출력과
     `capture/tuyable_heard.json` 에 받은 DP 전부가 남습니다. 그 값을 보고 `devices.yaml` 의 센서 칸에
     `dps: {soil_moisture: 3, soil_temp: 5, soil_temp_scale: 10, battery_pct: 15}` 처럼 적으면 됩니다.

수집 파일은 `/var/lib/shrimp365/field/data`, 센서 목록은 `/var/lib/shrimp365/field/devices.yaml` 에 있습니다.
장비 서비스는 보안 설정상 `/home` 아래를 읽지 못하므로 수집 폴더를 그곳에 두지 않습니다.
화면에만 띄우고 서버로 보내지 않으려면 `config.ini` 의 `[environment]` 에서 `upload = false`.
4. 웹에 보이려면 서버 DB 에 `supabase/migrations/environment_readings.sql` 을 한 번 실행합니다
   (실행 전에도 장비는 멈추지 않습니다 — 서버가 환경 칸만 빼고 저장합니다).

센서가 여러 대면 평균을 띄우고 "2대 · 3분 전" 처럼 대수와 나이를 함께 보여 줍니다. 그런 칸은 이름 옆에
› 가 붙고, 누르면 센서마다 색이 다른 선 그래프(6시간·12시간·24시간·일주일, 점선은 평균)와 한 대 한 대의
값(가장 높은·낮은 센서 표시, 끊긴 센서는 "끊김")이 나옵니다. 그래프는 장비 안에 5분마다 남기는 기록이라
인터넷이 끊겨도 보입니다. 웹 "환경·기상" 카드도 같은 칸을 누르면 센서별 24시간 그래프와 값이 펼쳐집니다
(서버 DB 에 `env_sensors.sql` 실행 필요). 15분 넘게
새 값이 없으면 그 칸 아래 글씨가 주황으로 바뀌고, 30분(`stale_minutes`)이 지나면 값을 지웁니다
(서버로도 보내지 않습니다). 켰는데 값이 하나도 없으면 수집기·배터리를 확인하라는 줄이 뜹니다.

**분전반 전력 (양식장·스마트팜 공통, 선택).** 화면 위쪽에 지금 전력(⚡ 1.2 kW) 칩이 뜨고, 누르면
회로마다 켜짐/꺼짐·전력·오늘 사용량·차단기 온도가 나옵니다. 같은 값이 웹 대시보드의 "전력"
카드에 나옵니다. 지그비 차단기는 화면에서 켜고 끌 수 있고 예약도 걸 수 있습니다(아래 5). 배선·부품은
`docs/plans/farm365-main-panel.md` 를 따릅니다(단상).

1. Zigbee 계측 차단기를 위 **[무선 센서]** 에서 찾아 '차단기 — 관수펌프 회로' 또는 '차단기 — 그 밖의 회로'
   로 등록합니다(이름 PUMP-01, AUX-01 …).
2. `config.ini` 의 `[power]` 에서 `enabled = true` 로 두고 재시작합니다.
3. 화면 **[설정] → [전력 회로]** 에서 차단기마다 붙은 기기 종류(관수펌프·히터·환기팬…)를 고릅니다.
   고른 값은 `config.ini` 의 `[power_circuits]` 에 적힙니다. 기기를 바꾸면 여기서 다시 고르면 됩니다.
4. 웹에 보이려면 서버 DB 에 `supabase/migrations/power_readings.sql` 을 한 번 실행합니다
   (실행 전에도 수질 수신은 멈추지 않습니다 — 서버가 전력 기록만 건너뜁니다).
5. **켜고 끄기·예약.** 화면 위 ⚡ 칩을 눌러 [전력 회로] 창을 열면 회로마다 **[켜기]/[끄기]** 와 **[예약]** 이
   있습니다. [예약] 에서 고릅니다:
   - **수동** — 사람이 켜고 끕니다. '손으로 켜면 자동 끄기' 를 30분으로 두면 켜 두고 잊어도 30분 뒤 꺼집니다.
   - **시간 예약** — 06:00 켜기 → 06:30 끄기처럼 시각과 요일을 정합니다(6개까지). 끄는 시각이 더 이르면
     다음 날 끕니다(22:00 → 02:00).
   - **반복 간격** — 가동 시간대(예: 06:00~18:00) 안에서 '15분 켜고 45분 쉬기' 를 되풀이합니다.
   - **산소량 연동** — 용존산소가 정한 값(예: 5.0 mg/L) 이하로 떨어지면 켜고, 충분히 오르면(예: 6.5) 끕니다.
     그 사이에서는 그대로 두어 자주 켰다 껐다 하지 않고, 한 번 켜면 '최소 가동'(예: 10분) 동안은 끄지 않습니다.
     DO 센서 값이 10분 넘게 없으면(고장·배선) 켜 둡니다. 산소공급기를 24시간 돌리지 않고 필요할 때만 돌릴 때 씁니다.
   - **산소 부족 시 강제 켜기** — 시간 예약·반복 간격·수동 어느 쪽이든 덧붙일 수 있습니다. 산소가 그 값 이하로
     떨어지면 예약이나 손으로 끈 것과 관계없이 켜고, 1 mg/L 회복하면 원래대로 돌아갑니다. 산소공급기에는 4.0 으로
     제안됩니다('안 함' 으로 내릴 수 있습니다).
   - **지금 잠깐 켜기** — 10분·30분·1시간·2시간만 켜고 끕니다.
   예약 중에 손으로 켜거나 끄면 그 조작이 앞서고, 예약이 다음에 바뀌는 순간(켜기↔끄기) 다시 예약을
   따릅니다. [예약대로] 를 누르면 바로 돌아갑니다. 규칙은 `/var/lib/shrimp365/power_control.json` 에
   남아 재부팅해도 그대로입니다.
   안전 장치: 인입(전체) 회로는 제어하지 않고, 산소공급기는 손으로 끌 때 한 번 더 묻습니다. 차단기가 과열(80℃)이면 켜지 않습니다. 장비 시계가 틀리면(인터넷 없이 부팅) 예약을 멈추고
   화면에 알립니다. 명령 뒤 차단기 상태가 따라오지 않으면 두 번 더 보내고, 그래도 안 되면 화면에 알립니다.
   차단기에서 손으로 바꾼 것은 다투지 않습니다. 제어를 막고 값만 보려면 `config.ini` 의 `[power]` 에
   `control = false`.

차단기 본체 온도가 **65 ℃ 이상이면 주의, 80 ℃ 이상이면 위험** 띠가 화면에 뜨고 휴대폰으로 알림이
갑니다. 60 ℃ 아래로 내려와야 풀립니다. 과열 중에는 5분 간격을 기다리지 않고 매 측정 서버로 올립니다.

### 7. 파이 쪽 로케일도 맞춰 두기 (선택)

꼭 필요하지는 않지만, 파일 이름이나 다른 프로그램에서 한글을 쓰실 거면 맞춰 두는 편이 좋습니다.

```bash
sudo raspi-config
# Localisation Options → Locale
#   → 목록에서 ko_KR.UTF-8 UTF-8 을 스페이스바로 체크
#   → 기본 로케일은 en_US.UTF-8 로 두는 것을 권합니다
```

> 기본 로케일을 `ko_KR.UTF-8` 로 바꾸면 시스템 메시지까지 한글이 됩니다.
> 모니터를 직접 붙여 쓰는 Lite 장비에서는 그 메시지마저 안 보이게 되어 오히려 불편합니다.
> **모니터를 붙여 쓰신다면 `en_US.UTF-8` 로 두세요.**

수집기 서비스는 로케일과 무관하게 UTF-8 로 로그를 남기도록 등록 파일에 지정해 두었습니다.

## F. 자주 막히는 곳

**`sudo: ./install.sh: command not found`**

파일이 그 자리에 없다는 뜻입니다. 먼저 지금 어디에 무엇이 있는지 봅니다.

```bash
pwd && ls
```

`install.sh` 가 목록에 **없다면** — 원인은 대개 둘 중 하나입니다.

1. **브랜치를 안 지정하고 `git clone` 했다** (가장 흔합니다).
   기본 브랜치에는 아직 `raspberry-pi` 폴더가 없습니다. 3번 **방법 A**(웹사이트에서
   받기)로 바꾸시면 이 문제가 아예 없습니다. 굳이 저장소에서 받으시려면 `-b` 를 붙이세요.
   ```bash
   cd ~ && rm -rf shrimp365
   git clone -b claude/shrimp-water-quality-monitoring-aZ4EY \
     https://github.com/Ulrim/shrimp365.git
   cd shrimp365/raspberry-pi
   ```
   이미 받아 둔 폴더가 있다면 그 안에서 브랜치만 바꿔도 됩니다.
   ```bash
   git fetch origin claude/shrimp-water-quality-monitoring-aZ4EY
   git checkout claude/shrimp-water-quality-monitoring-aZ4EY
   ```
2. **폴더를 잘못 들어왔다.** `cd ~/shrimp365/raspberry-pi` 또는 `cd ~/raspberry-pi`.
3. **USB 복사본이 오래됐다.** `install.sh` 는 나중에 추가된 파일이라, 그 전에 만든
   USB 에는 들어 있지 않습니다. USB를 다시 만들거나, 다시 만들 여건이 안 되면
   **[부록 C](#c-installsh-없이-손으로-설치하기)** 의 명령을 순서대로 실행하세요.
   결과는 스크립트를 돌린 것과 같습니다.

`install.sh` 가 **보이는데도** 같은 메시지가 나온다면 — 파일 자체가 아니라 실행 방법의
문제이므로 아래 한 줄로 우회할 수 있습니다. Windows 나 USB 를 거치며 실행 권한이나
줄바꿈 형식이 바뀐 경우입니다.

```bash
sudo bash install.sh
```

계속 쓰실 거면 원인을 아예 없애 두세요.

```bash
chmod +x install.sh                    # 실행 권한 복구
sed -i 's/\r$//' install.sh            # Windows 줄바꿈(CRLF) 제거
```

**`sudo: ./install.sh: Permission denied`**
파일은 있는데 실행 권한이 없습니다. `chmod +x install.sh` 또는 `sudo bash install.sh`.

**`Permission denied: '/dev/ttyUSB0'`**
계정이 `dialout` 그룹에 없습니다. `sudo ./install.sh` 를 다시 실행하면 넣어 줍니다.

**`HTTP 401`**
기기 키가 틀렸거나 기기가 **비활성** 상태입니다. Shrimp365 화면에서 활성 여부를 확인하세요.

**`HTTP 429`**
너무 자주 보내고 있습니다. 서버는 기기당 분당 60회로 제한합니다.
`interval_seconds` 가 60 미만이면 60 이상으로 올리세요.

**보관 건수가 계속 늘어남**
전송이 안 되고 있습니다. `journalctl -u shrimp365-sensor -f` 로 사유를 보세요.
값은 그동안에도 계속 쌓이므로, 원인을 고치면 끊겼던 시점부터 자동으로 채워집니다.

**터치스크린에 `This site can't be reached` 가 나옴**

크로미움은 떴는데 **상태 페이지가 안 올라와 있는** 것입니다. 수집기는 그동안에도
정상적으로 측정·전송하고 있으니 데이터가 비지는 않습니다.

```bash
# 1) 상태 페이지가 켜져 있는가 — enabled = true 여야 합니다
grep -A2 "\[webui\]" /etc/shrimp365/config.ini | grep enabled

# 2) 수집기가 도는가
systemctl status shrimp365-sensor

# 3) 페이지가 응답하는가 — 200 이면 정상
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080
```

1번이 `false` 였다면 그게 원인입니다. `sudo ./setup-kiosk.sh` 를 다시 실행하면
알아서 켜 줍니다(예전 버전 스크립트는 켜 주지 않았습니다). 직접 고치셔도 됩니다.

```bash
sudo nano /etc/shrimp365/config.ini      # [webui] 아래 enabled = true
sudo systemctl restart shrimp365-sensor
```

고친 뒤 화면만 다시 띄우려면 `/usr/local/bin/shrimp365-kiosk` 를 실행하거나 재부팅하세요.

**터치스크린이 검은 화면**
`curl http://127.0.0.1:8080` 이 파이에서 응답하면 수집기는 정상이고 크로미움 쪽 문제입니다.
`/usr/local/bin/shrimp365-kiosk` 를 직접 실행해 오류를 보세요.

그 밖의 증상은 [README.md 의 문제 해결](README.md#문제-해결) 에 정리해 두었습니다.
