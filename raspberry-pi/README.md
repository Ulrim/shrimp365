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
sudo cp shrimp365_sensor.py /opt/shrimp365/
sudo cp config.example.ini /etc/shrimp365/config.ini
sudo chmod 600 /etc/shrimp365/config.ini   # 기기 키가 들어가므로 권한을 좁힙니다
```

## 4. 기기 키 발급

1. Shrimp365 로그인 → **양식장·수조 관리**
2. 수조 카드의 **센서 기기** 펼치기 → **기기 등록**
3. 이름과 종류를 넣고 등록하면 **API 엔드포인트**와 **X-Device-Key**가 나옵니다

> 키는 **등록 직후 한 번만** 표시됩니다. 그 자리에서 복사해 두세요.
> 잃어버리면 기기를 지우고 다시 등록하면 됩니다.

`/etc/shrimp365/config.ini`를 열어 두 줄을 채웁니다.

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

**값이 이상함**
센서 교정이 필요합니다. 교정 절차는 제조사 문서를 따르세요.
pH는 6.86(또는 7.00) 중간점을 **먼저** 잡고 4.01, 9.18 순으로 진행합니다.

---

## 서버에 저장되는 값

수질 기록으로 저장되는 항목은 **수온·pH·DO·염도** 네 가지입니다.
전도도·TDS·ORP·DO 포화도도 함께 전송되며, 기기 카드의 **마지막 수신값**에 표시됩니다.
