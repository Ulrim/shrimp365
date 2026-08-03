# 라즈베리파이 수질 센서 연동

RS-485 디지털 센서(MODBUS-RTU)에서 **수온·pH·DO·염도**를 읽어 Shrimp365 계정으로 올립니다.
로그인하면 해당 수조의 수질 기록·차트·알림에 자동으로 반영됩니다.

지원 센서 — Nengshi 디지털 센서 프로토콜

| 센서 | 기본 슬레이브 ID | 읽는 값 |
|---|---|---|
| pH/ORP | 1 | pH, ORP, 수온 |
| DO | 3 | 용존산소(㎎/L), 포화도(%), 수온 |
| EC/TDS/염도 | 4 | 전도도, TDS, 염도(ppt), 수온 |

수온은 세 센서 모두에 들어 있어서 **pH → EC → DO 순으로 하나만** 골라 보냅니다.
같은 값을 겹쳐 보내면 어느 것이 맞는지 알 수 없기 때문입니다.

---

## 1. 준비물

- 라즈베리파이 (Zero 2 W 이상, OS Lite로 충분)
- **USB-RS485 변환기** (권장) 또는 GPIO UART + RS485 트랜시버
- 센서 전원 **DC 9~24V** — 라즈베리파이 5V로는 동작하지 않습니다
- 센서와 변환기를 잇는 4선

## 2. 배선

센서 케이블 색깔은 제조사 문서 기준입니다.

| 선 색 | 연결 |
|---|---|
| 빨강 | DC 9~24V (+) |
| 검정 | 0V (−) |
| 초록 | RS485 **A** (T/R+) |
| 노랑 | RS485 **B** (T/R−) |

**주의할 점**

- 센서 전원의 0V와 라즈베리파이 GND를 **공통으로 묶어** 주세요. 안 그러면 통신이 불안정합니다.
- 센서 여러 대를 **같은 A/B 선에 병렬로** 연결합니다. 각 센서의 슬레이브 ID가 달라야 합니다.
- 선이 10m를 넘으면 양 끝에 **120Ω 종단저항**을 답니다. CRC 오류가 잦으면 이걸 먼저 의심하세요.

## 3. 설치

```bash
sudo apt update
sudo apt install -y python3-serial

sudo mkdir -p /opt/shrimp365 /etc/shrimp365
sudo cp shrimp365_sensor.py display.py /opt/shrimp365/
sudo cp config.example.ini /etc/shrimp365/config.ini
sudo chmod 600 /etc/shrimp365/config.ini   # 기기 키가 들어가므로 권한을 좁힙니다
```

## 4. 기기 연결

두 가지 방법이 있습니다. **코드로 연결**을 권합니다.

### 방법 1 — 코드로 연결 (권장)

긴 키를 옮겨 적지 않아도 됩니다. 설정 파일의 `device_key`를 **비워 둔 채** 실행하면
기기가 6자리 코드를 화면에 띄웁니다.

```
+--------------------+
|  Pair this device  |
|    4 8 2 1 0 0     |
|www.shrimp365.kr    |
|waiting...          |
+--------------------+
```

1. 농가가 휴대폰이나 터치스크린으로 **Shrimp365 로그인**
2. **양식장·수조 관리** → 수조의 **센서 기기** 펼치기 → **코드로 기기 연결**
3. 화면의 6자리 코드 입력 → 연결

승인되면 기기가 키를 자동으로 받아 설정 파일에 저장하고, 곧바로 측정을 시작합니다.

> 코드는 **15분간** 유효합니다. 지나면 기기가 알아서 새 코드를 띄웁니다.
> 승인 전까지 기기는 어떤 데이터도 올릴 수 없습니다.

**왜 이메일이 아니라 코드인가**
이메일 주소는 명함·게시판 어디에나 있는 공개 정보입니다. 이메일만으로 기기를 지정하면
누구나 남의 계정에 가짜 수질값을 밀어 넣을 수 있습니다. 수질 데이터는 알림과 판단의
근거이므로, 승인은 **로그인한 계정 주인만** 할 수 있어야 합니다.

### 방법 2 — 키를 직접 붙여넣기

**기기 등록** 버튼으로 발급받은 키를 설정 파일에 적습니다. 키는 발급 직후 한 번만 표시됩니다.

```ini
[server]
endpoint   = https://www.shrimp365.kr/api/sensors/data
device_key = 발급받은_키
interval_seconds = 300      ; 5분마다 측정

[serial]
port = /dev/ttyUSB0         ; USB 변환기. GPIO UART면 /dev/serial0

[sensors]
ph_enabled = true
ph_slave_id = 1
do_enabled = true
do_slave_id = 3
ec_enabled = true
ec_slave_id = 4
```

연결하지 않은 센서는 `false`로 두세요.

## 5. 동작 확인

서버로 보내기 전에 값이 제대로 읽히는지 먼저 봅니다.

```bash
# 읽기만 하고 전송하지 않음
sudo python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --once --dry-run -v
```

정상이면 이런 값이 나옵니다.

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

값이 맞으면 실제로 한 번 보내 봅니다.

```bash
sudo python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --once -v
```

`전송 완료`가 뜨면 Shrimp365 화면의 기기 카드에 **방금 전**과 측정값이 표시됩니다.

## 6. 상시 실행 등록

```bash
sudo useradd -r -G dialout -s /usr/sbin/nologin shrimp365 || true
sudo cp shrimp365-sensor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shrimp365-sensor

# 상태·로그 확인
systemctl status shrimp365-sensor
journalctl -u shrimp365-sensor -f
```

정전이나 재부팅 후에도 자동으로 다시 시작합니다. 인터넷이 끊겨도 프로세스는 살아 있고 다음 주기에 다시 시도합니다.

---

## LCD 화면 붙이기 (선택)

라즈베리파이에 **I2C 문자 LCD**(1602 또는 2004)를 달면 현장에서 바로 값을 볼 수 있습니다.
인터넷이 끊겨도 화면에는 계속 표시됩니다.

### 배선 (I2C 4선)

| LCD 백팩 | 라즈베리파이 |
|---|---|
| VCC | 5V (2번 핀) |
| GND | GND (6번 핀) |
| SDA | GPIO2 (3번 핀) |
| SCL | GPIO3 (5번 핀) |

### I2C 켜기

```bash
sudo raspi-config       # Interface Options → I2C → Yes
sudo apt install -y i2c-tools
sudo i2cdetect -y 1     # 27 또는 3f 가 보이면 정상
```

`27`이 보이면 주소는 `0x27`, `3f`면 `0x3F`입니다.

### 설정

`/etc/shrimp365/config.ini`

```ini
[display]
type = i2c_lcd
columns = 16          ; 1602 이면 16, 2004 이면 20
rows = 2              ; 1602 이면 2,  2004 이면 4
i2c_bus = 1
i2c_address = 0x27
page_seconds = 5      ; 값이 다 안 들어갈 때 넘기는 간격
```

`shrimp365` 사용자를 i2c 그룹에 넣어 줍니다.

```bash
sudo usermod -aG i2c shrimp365
sudo systemctl restart shrimp365-sensor
```

### 표시되는 모습

**2004 (20x4)** — 네 값이 한 화면에

```
+--------------------+
|Temp           28.4C|
|pH              7.85|
|DO          6.42mg/L|
|Sal          21.4ppt|
+--------------------+
```

**1602 (16x2)** — 두 개씩 5초마다 번갈아

```
+----------------+     +----------------+
|Temp       28.4C|     |DO      6.42mg/L|
|pH          7.85|  →  |Sal      21.4ppt|
+----------------+     +----------------+
```

**문제가 생기면** 값 한 줄을 밀어내고 경고를 띄웁니다.
현장에서는 "지금 안 올라가고 있다"는 사실이 값 하나보다 중요합니다.

```
+--------------------+
|Temp           28.4C|
|pH              7.85|
|DO          6.42mg/L|
|SEND FAIL 14:32     |
+--------------------+
```

| 표시 | 뜻 |
|---|---|
| `sent 14:32` | 14시 32분에 서버 전송 성공 |
| `SEND FAIL 14:32` | 서버 전송 실패 (인터넷·키 확인) |
| `SENSOR ERROR` | 센서를 하나도 읽지 못함 (배선·전원 확인) |
| `No sensor data` | 아직 첫 측정 전 |

### 알아 두실 점

**한글은 표시되지 않습니다.** 문자 LCD는 폰트가 칩 안에 고정돼 있어 한글 글꼴이 없습니다.
그래서 라벨을 `Temp` `pH` `DO` `Sal` 로 씁니다.
한글을 꼭 쓰셔야 하면 **OLED(SSD1306)** 나 소형 HDMI 화면이 필요합니다 — 말씀 주시면 추가하겠습니다.

**LCD가 고장 나도 수집은 멈추지 않습니다.** 화면 초기화나 출력이 실패하면 로그만 남기고
측정·전송은 그대로 계속합니다.

### 배선 전에 미리 보기

LCD를 연결하기 전에 무엇이 표시될지 터미널에서 확인할 수 있습니다.

```ini
[display]
type = console
columns = 20
rows = 4
```

```bash
sudo python3 /opt/shrimp365/shrimp365_sensor.py \
  --config /etc/shrimp365/config.ini --once --dry-run
```

---

## 문제 해결

**`응답 없음`**
전원(9~24V)이 들어오는지, A/B 선이 바뀌지 않았는지, 슬레이브 ID가 설정과 맞는지 확인하세요.
A와 B를 서로 바꿔 꽂는 실수가 가장 흔합니다.

**`CRC 불일치`**
선이 길거나 노이즈가 있습니다. 종단저항 120Ω을 달고, 전원선과 통신선을 떨어뜨려 배선하세요.

**`다른 기기가 응답함`**
같은 선에 슬레이브 ID가 같은 센서가 둘 있습니다. 한 대만 연결한 상태에서 ID를 바꿔 주세요.
ID 변경 명령은 제조사 프로토콜 문서의 `01 06 00 1E 00 04 ...` 형식입니다.

**`HTTP 401`**
기기 키가 틀렸거나 기기가 비활성 상태입니다. 화면에서 활성 여부를 확인하세요.

**`HTTP 429`**
너무 자주 보내고 있습니다. 서버는 기기당 분당 60회로 제한합니다. `interval_seconds`를 늘리세요.

**LCD에 아무것도 안 나옴**
`sudo i2cdetect -y 1` 로 주소가 보이는지 확인하세요. 아무것도 없으면 배선(SDA/SCL)이나
I2C 활성화를 다시 보세요. 주소는 보이는데 화면이 빈칸이면 백팩 뒷면의 가변저항(대비)을
돌려 주세요. 권한 문제면 `sudo usermod -aG i2c shrimp365` 후 재시작합니다.

**값이 이상함**
센서 교정이 필요합니다. 교정 절차는 제조사 문서를 따르세요.
pH는 6.86(또는 7.00) 중간점을 **먼저** 잡고 4.01, 9.18 순으로 진행합니다.

---

## 서버에 저장되는 값

수질 기록으로 저장되는 항목은 **수온·pH·DO·염도** 네 가지입니다.
전도도·TDS·ORP·DO 포화도도 함께 전송되며, 기기 카드의 **마지막 수신값**에 표시됩니다.
