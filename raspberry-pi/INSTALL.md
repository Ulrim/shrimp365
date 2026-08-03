# 라즈베리파이 설치 안내서

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

접속되면 먼저 OS를 최신으로 올립니다.

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

---

## 3. 프로그램 내려받기

세 가지 방법이 있습니다. **파이가 인터넷에 연결돼 있고 GitHub 접근 권한이 있으면 방법 A**,
현장 파이에 저장소 접근을 주고 싶지 않으면 **방법 B 또는 C** 를 쓰세요.

### 방법 A — 저장소에서 바로 받기

```bash
sudo apt install -y git
git clone https://github.com/Ulrim/shrimp365.git
cd shrimp365/raspberry-pi
```

비공개 저장소이므로 아이디와 **개인용 액세스 토큰**(비밀번호 자리에 입력)을 묻습니다.
토큰은 GitHub → Settings → Developer settings → Personal access tokens 에서 만들고,
권한은 `repo` **읽기**만 주면 됩니다.

> 현장 장비에 토큰을 남기지 마세요. 받은 뒤 `git credential-cache exit` 로 지우거나,
> 애초에 방법 B·C 를 쓰는 편이 안전합니다.

### 방법 B — USB 메모리로 옮기기 (인터넷이 불안한 현장)

PC에서 `raspberry-pi` 폴더 전체를 USB 메모리에 복사한 뒤, 파이에 꽂고

```bash
lsblk                                   # sda1 등 USB 이름 확인
sudo mkdir -p /mnt/usb
sudo mount /dev/sda1 /mnt/usb
cp -r /mnt/usb/raspberry-pi ~/
sudo umount /mnt/usb
cd ~/raspberry-pi
```

### 방법 C — PC에서 바로 밀어 넣기 (같은 네트워크)

PC의 `raspberry-pi` 폴더가 있는 위치에서

```bash
scp -r raspberry-pi pi@shrimp-a1.local:~/
```

그다음 파이에서

```bash
cd ~/raspberry-pi
```

### 받았는지 확인

어느 방법이든, 지금 위치에 아래 파일들이 있어야 합니다.

```bash
ls
# config.example.ini  display.py  history.py  install.sh  README.md
# buffer.py  shrimp365-sensor.service  shrimp365_sensor.py  webui.py ...
```

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
| `응답 없음` | 전원·배선·ID | **A와 B가 바뀐 경우가 가장 많습니다.** 두 선을 바꿔 꽂아 보세요 |
| `CRC 불일치` | 노이즈·선 길이 | 120Ω 종단저항, 전원선과 통신선 분리 |
| `다른 기기가 응답함` | 슬레이브 ID 충돌 | 같은 ID 센서가 둘. 한 대씩 연결해 ID 변경 |

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

**코드 확인** — 터치스크린이 있으면 화면 오른쪽 아래 **기기 연결** 버튼,
없으면 로그에서 봅니다.

```bash
journalctl -u shrimp365-sensor | grep "연결 코드" | tail -1
# 연결 코드: 482100 — Shrimp365 에 로그인해 이 코드를 입력하세요
```

**연결하기**

1. 휴대폰이나 PC에서 **www.shrimp365.kr** 접속 → 로그인
2. **양식장·수조 관리** → 센서를 붙일 수조의 **센서 기기** 펼치기
3. **코드로 기기 연결** → 6자리 코드 입력

승인되면 기기가 키를 자동으로 받아 설정 파일에 저장하고 곧바로 전송을 시작합니다.
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

```ini
[webui]
enabled = true
port = 8080
```

```bash
sudo systemctl restart shrimp365-sensor
cd ~/raspberry-pi
sudo ./setup-kiosk.sh
sudo reboot
```

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

6) **www.shrimp365.kr** 의 수조 화면에서 측정 시각이 1분마다 갱신되는가

여섯 개가 다 맞으면 설치 완료입니다.

---

# 부록

## A. 프로그램 업데이트

새 버전을 3번과 같은 방법으로 받은 뒤, 그 폴더에서

```bash
sudo ./install.sh
```

돌고 있던 서비스는 자동으로 다시 시작됩니다.
**설정 파일과 그동안 쌓인 측정 이력은 그대로 둡니다.**

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

## C. 제거

```bash
sudo systemctl disable --now shrimp365-sensor
sudo rm -f /etc/systemd/system/shrimp365-sensor.service
sudo systemctl daemon-reload
sudo rm -rf /opt/shrimp365 /etc/shrimp365 /var/lib/shrimp365
sudo userdel shrimp365
```

Shrimp365 웹에서도 해당 기기를 **비활성**으로 바꾸거나 삭제하세요.
그래야 그 키로는 더 이상 아무것도 올라오지 않습니다.

## D. 자주 막히는 곳

**`sudo: ./install.sh: command not found`**
`raspberry-pi` 폴더 안이 아닙니다. `cd ~/raspberry-pi` 후 다시 실행하세요.
USB나 Windows 를 거쳐 복사했다면 실행 권한이 빠졌을 수 있습니다 — `chmod +x install.sh`.

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

**터치스크린이 검은 화면**
`curl http://127.0.0.1:8080` 이 파이에서 응답하면 수집기는 정상이고 크로미움 쪽 문제입니다.
`/usr/local/bin/shrimp365-kiosk` 를 직접 실행해 오류를 보세요.

그 밖의 증상은 [README.md 의 문제 해결](README.md#문제-해결) 에 정리해 두었습니다.
