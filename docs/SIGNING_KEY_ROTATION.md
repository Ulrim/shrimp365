# 서명키 교체 — 미뤄 둔 일

> 2026-10 작성. **아직 하지 않았다.** 할 때가 되면 이 문서대로 한다.

## 무슨 일이 있었나

저장소를 공개로 바꾸면서 `raspberry-pi/secrets/release-key.pem` 이 노출됐다.
수질 센서 파이의 원격 업데이트(OTA)를 서명하는 Ed25519 개인키이고,
`raspberry-pi/updater.py` 의 `RELEASE_PUBLIC_KEY` 와 짝이 맞는다.

```
RELEASE_PUBLIC_KEY = "nd//EqamOY3+Kwpite46c1IppbdkOoBw+0z6T3fRpPI="   ← 노출된 키의 짝
```

지금은 저장소에서 빼고 `.gitignore` 로 막아 두었다(커밋 `2a008a9`). 다시
올라가지는 않지만, **이미 공개된 것은 되돌릴 수 없다** — git 기록에 남는다.

## 왜 당장 급하지 않은가

꾸러미를 받아오는 주소가 우리 쪽에 박혀 있다.

```python
# updater.py:461
"manifest": cfg.get("update", "manifest_url",
                    fallback=f"{base}/updates/manifest.json")
#   base = https://www.shrimp365.kr
```

장비는 **www.shrimp365.kr 에서만** 꾸러미를 받는다. 서명키만 가진 사람은
올릴 곳이 없다. 악용하려면 다음이 더 있어야 한다.

- 저장소 push 권한 또는 Vercel 접근 (꾸러미를 올릴 곳), **그리고**
- 서버가 그 버전을 승인하도록 만들기 (`/api/sensors/update` 의 approved)

즉 열쇠는 복사됐지만 자물쇠는 우리 집 안에 있다. 그래도 **서명이 주는 방어가
사라진 상태**이므로, 저장소나 Vercel이 한 번 뚫리면 막을 것이 없다. 미뤄 둘
일이지 안 할 일은 아니다.

## 왜 당장 못 하는가

현장 장비(10대 이상, 남의 농장 포함)에는 **옛 공개키가 박힌 `updater.py` 가
이미 깔려 있다.** 저장소의 파일을 바꿔도 그 장비들은 모른다. 바꾸는 길은 둘.

| 방법 | 가능한가 |
|---|---|
| 장비마다 SSH 로 `updater.py` 교체 | 남의 농장에 있어 사실상 불가 |
| **옛 키로 서명한 업데이트를 한 번 더 내보내기** | 이것만 현실적 |

두 번째는 표준적인 키 교체 방식이다. 옛 키로 서명한 꾸러미 안에 **새 공개키가
박힌 `updater.py`** 를 넣어 보낸다. 장비는 옛 키로 검증해 받아들이고, 그
순간부터 새 키만 신뢰한다.

그러려면 저장소 clone 과 옛 개인키가 필요하다 — 둘 다 개발용 PC 가 있어야 한다.
(2026-10 현재 오너 PC 에 저장소가 없다.)

## 할 때의 절차

개발용 PC 에 git·python 을 깔고 clone 한 뒤:

```bash
# 1. 옛 개인키를 기록에서 꺼낸다 (교체 꾸러미에 서명할 때 쓴다)
mkdir -p raspberry-pi/secrets
git show 2a008a9^:raspberry-pi/secrets/release-key.pem > raspberry-pi/secrets/release-key.pem
chmod 600 raspberry-pi/secrets/release-key.pem

# 2. 짝이 맞는지 확인 — nd//Eqam… 이 나와야 한다
python3 - <<'PY'
import base64
from cryptography.hazmat.primitives import serialization
k = serialization.load_pem_private_key(
    open("raspberry-pi/secrets/release-key.pem","rb").read(), password=None)
print(base64.b64encode(k.public_key().public_bytes(
    encoding=serialization.Encoding.Raw,
    format=serialization.PublicFormat.Raw)).decode())
PY
```

여기서 **순서를 틀리면 현장 장비가 영구히 업데이트를 못 받는다.**

```
① 새 키를 만들되, 옛 키는 아직 지우지 않는다
     python3 raspberry-pi/release.py init --force
   → 출력된 새 공개키를 적어 둔다. 새 개인키가 옛 것을 덮어쓰므로
     **옛 키를 먼저 다른 이름으로 복사해 둔다**:
     cp raspberry-pi/secrets/release-key.pem /안전한곳/old-key.pem

② updater.py 의 RELEASE_PUBLIC_KEY 를 **새 공개키**로 바꾼다

③ 꾸러미를 만든다 — 이때 서명은 **옛 키**로 해야 한다
     cp /안전한곳/old-key.pem raspberry-pi/secrets/release-key.pem
     python3 raspberry-pi/release.py build <새버전>
   (현장 장비는 아직 옛 키만 신뢰하므로, 옛 키로 서명해야 받아들인다)

④ 커밋·푸시하고 서버에서 그 버전을 승인한다

⑤ 모든 장비가 올라온 것을 확인한다 — Supabase:
     select agent_version, count(*) from sensor_devices group by 1;
   전부 새 버전이 되면 ⑥으로. 한 대라도 남아 있으면 기다린다
   (꺼져 있는 장비가 있으면 켤 때까지 기다려야 한다)

⑥ 그 뒤의 릴리스는 **새 키**로 서명한다
     cp /새키위치/release-key.pem raspberry-pi/secrets/release-key.pem
     rm /안전한곳/old-key.pem    ← 모두 올라온 것을 확인한 뒤에만

⑦ 새 개인키를 백업한다. 잃으면 다시 이 고생을 한다
```

⑤에서 끝까지 올라오지 않는 장비가 있으면 그 장비는 **손으로 가야 한다.**
옛 키를 지우기 전에 반드시 확인한다.

## 그 전까지 지킬 것

- `raspberry-pi/secrets/` 를 커밋하지 않는다(`.gitignore` 가 막고 있다)
- 저장소 push 권한과 Vercel 접근을 좁게 유지한다 — 지금은 그것이 유일한 방어다
