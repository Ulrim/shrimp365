# AMP AquaPilot — 에이엠피판 장비 설치

에이엠피(AMP)에 납품하는 장비는 **같은 프로그램**에 설정 한 줄(`[brand] edition = amp`)만
더해 띄운다. 측정·서버 전송·원격 업데이트·서명 검증은 기본(Shrimp365) 장비와 똑같고,
바뀌는 것은 **화면과 이름**뿐이다.

- 장비 소프트웨어: 1.11.0 이상 (`webui_amp.py` 가 들어 있어야 한다)
- 화면 코드: `raspberry-pi/webui_amp.py` · 설계: [`design.md`](design.md) · 시안: [`prototype/amp-kiosk-prototype.html`](prototype/amp-kiosk-prototype.html)

---

## 1. 설치 절차

1. **기본 설치를 그대로 한다** — [`raspberry-pi/INSTALL.md`](../../raspberry-pi/INSTALL.md) 1~8번
   (OS 굽기 → 프로그램 받기 → `sudo ./install.sh` → 배선 → 설정 → 점검 → 상시 실행).
2. **에디션을 AMP 로 바꾼다.**

   ```bash
   sudo nano /etc/shrimp365/config.ini
   ```

   ```ini
   [brand]
   edition = amp
   ; 에이엠피 자료가 오면 채운다. 비워 두면 그 줄을 화면에서 숨긴다.
   support_phone =
   app_name =
   pair_url =
   ```

   예전 설정 파일에는 `[brand]` 구간이 없다. 파일 끝에 위 구간을 그대로 붙이면 된다.

3. **다시 시작한다.**

   ```bash
   sudo systemctl restart shrimp365-sensor
   journalctl -u shrimp365-sensor -n 5     # 첫 줄이 "AMP AquaPilot 센서 수집기 1.11.0 시작" 이면 된 것
   ```

4. **터치스크린** — INSTALL.md 10번 그대로 `sudo ./setup-kiosk.sh` → 재부팅.
   크로미움 창 제목은 페이지 제목(`AMP AquaPilot`)을 따른다. 문자 LCD 를 달았다면
   시작 화면 첫 줄도 `AMP AquaPilot` 이다.
5. **계정 연결** — 화면 [설정] → [기기 연결] 의 6자리 코드. 연결 서버는 기본 장비와 같다
   (`[server] endpoint` 를 바꾸지 않는다).

### 확인

| 볼 곳 | 기대 |
|---|---|
| 부팅 직후 화면 | AMP AquaPilot 워드마크, "센서 확인 중…" |
| 대시보드 | 수온·pH·용존산소·염도 4칸, 위에 AI 칩과 서버 칩. 모드 메뉴가 없다 |
| [설정] | 센서 설정 · 센서 테스트 · 보정 · Wi‑Fi · 언어 · 전력 회로 · 기기 연결 · 재시작 |
| [기기 정보] 맨 아래 | `Powered by Shrimp365` — Shrimp365 표기는 이 한 곳뿐 |
| `python3 /opt/shrimp365/verify.py` | 마지막 줄 "모두 통과" (⑭ 에디션 절 포함) |

### 되돌리기

`edition = shrimp365` 로 바꾸거나 `[brand]` 구간을 지우고 다시 시작하면 기본 화면으로 돌아온다.
측정 이력·보관함·계정 연결은 그대로 남는다.

---

## 2. AMP판에서 달라지는 것

| 항목 | AMP판 |
|---|---|
| 장비 모드 | **양식장 고정.** `[webui] mode = agriculture` 가 적혀 있어도 양식장 판정으로 돈다 |
| 숨긴 화면 | 모드 전환, 스마트팜·양액, 지그비 농업 센서(무선 센서 등록), 관수, 전력 켜고 끄기·예약 |
| 전력 회로 | [설정] → [전력 회로] 에서 **보기만** 한다. 계측이 없으면 "연결된 계측기 없음" |
| 네 번째 칸 | `[sensors] ec_mode` 를 따른다 — salinity 면 염도(‰), conductivity 면 장비가 준 전도도 값 그대로 |
| 1시간 변화 | 장비 이력(그래프와 같은 DB)의 최근 1시간 첫 값과 지금 값의 차. 이력이 45분 미만이면 숨긴다 |
| AI 근거 한 줄 | 운전 권고·이상징후·센서 오류가 실제로 넘겨 준 값(지금 값·기준·비교값·기간)으로만 만든다. 근거가 없으면 줄을 생략한다 |
| 색 | 1안 딥네이비 + 시안, 다크 기본. [설정] 위의 다크/라이트로 바꾸며 이 선택은 화면 브라우저에 남는다 |
| 슬레이브 ID · 선 훑기 · 자동 배치 | 화면에 없다. 설치 기사가 `config.ini [sensors]` 나 `--scan` / `--auto` / `--set-id` 명령으로 맞춘다 |

`[nutrient] enabled = true` 가 남아 있으면 운전 권고가 꺼진다(양액 장비로 판단). AMP 장비는 꺼 둔다.

---

## 3. 교체할 자료 — 에이엠피에서 받으면 바꾸는 곳

지금 화면의 이름·로고·색은 **임시**다. 바꾸는 곳은 모두 `raspberry-pi/webui_amp.py` 한 파일이고,
파일 머리 주석에 같은 안내가 있다.

| 자료 | 바꾸는 곳 | 메모 |
|---|---|---|
| 제품명 | `BRAND_MARK = "AMP"`, `PRODUCT = "AquaPilot"` | 창 제목·워드마크·기기 정보·문자 LCD·로그 첫 줄이 모두 이 두 상수를 쓴다 |
| 로고(SVG) | `PAGE` 안 `<symbol id="amp-mark" viewBox="0 0 32 32">` 하나 | 모든 자리가 `<use href="#amp-mark">` 로 참조한다. 정사각 32 격자에 맞춰 넣는다 |
| 브랜드 색 | `PAGE` 안 `<style>` 맨 앞 **BRAND TOKENS** 블록 (`:root` = 다크, `:root[data-theme="light"]` = 라이트) | `--logo-*` `--brand*` `--bg` `--surface*` `--line*` `--text*`. 상태색(`--ok/--warn/--crit`)은 바꾸지 않는다. 바꾼 뒤 대비 4.5:1 재계산 |
| 고객센터 | `config.ini [brand] support_phone` | 비우면 [기기 정보] 에서 줄을 숨긴다 |
| 앱 이름 | `config.ini [brand] app_name` | [기기 연결] 1단계 "휴대폰에서 ○○ 앱을 열고 로그인". 비우면 1단계를 숨긴다 |
| 포털 주소 | `config.ini [brand] pair_url` | 앱 이름이 없으면 1단계 "○○ 에 접속해 로그인", 둘 다 있으면 "웹: ○○" 한 줄 |

바꾼 뒤에는 반드시:

```bash
python3 -m py_compile raspberry-pi/*.py
cd raspberry-pi && python3 verify.py        # ⑭ 절이 페이지·자리표시·외부 리소스를 확인한다
```

그리고 장비(또는 미리보기)에서 800×480 화면을 4개 언어로 한 번씩 열어 글자가 잘리지 않는지 본다.

---

## 4. 에이엠피에서 받아야 할 자료 (갱신)

| 자료 | 형식 | 지금 상태 |
|---|---|---|
| 로고 원본 | SVG(벡터), 단색·반전, 최소 크기·여백 | 임시 기하 심볼 |
| 브랜드 색 | 주색·보조색 hex, 금지 조합 | 1안 딥네이비 + 시안(임시) |
| 제품명·모델명 확정 | 국문·영문 표기, 상표 등록 여부 | "AMP AquaPilot" (상표 검색 전). 모델명은 화면에 넣지 않았다 |
| 고객센터 | 전화·운영 시간·(해외) 이메일·WhatsApp | 없음 → 줄 숨김 |
| 앱·포털 | 앱 이름, 웹 주소, **앱 안의 기기 연결 메뉴 경로** | 없음 → 1단계 숨김. 2·3단계 문구("양식장 › 수조 선택", "기기 추가 › 코드로 연결")는 시안 문구라 실제 앱 메뉴 이름으로 맞춰야 한다 |
| 계정·서버 | AMP 사용자가 로그인할 곳이 Shrimp365 서버와 같은지 | 지금은 같은 서버(`[server] endpoint`)로 연결한다 |
| 판매 국가·언어 | ko/en/vi/id 외 추가 여부 | 4개 언어 |
| 기본 판정 기준 | 대상 어종, 고객별 기준 변경 허용 | `limits.py`(흰다리새우) 그대로 |
| 보증·인증 표기 | KC 등 화면 문구 | 없음 |
| Powered by 표기 합의 | 위치·크기·문구 | [기기 정보] 하단 12px 한 줄 |
