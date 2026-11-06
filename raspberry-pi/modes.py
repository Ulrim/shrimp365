"""장비의 운전 모드 — 이 장비가 무엇을 하는 기계인가.

    shrimp       양식장   수질 측정이 본업. 지금까지의 기본 동작.
    agriculture  스마트팜 Farm365 화면(이름·라벨·강조색)과 농업 판정. 양액 관리는 [nutrient] 가 따로 켠다.
    mrv          탄소 MRV 기계실 계량기 옆 전력 입력 단말.

이름은 수집기 1.10 의 `[webui] mode` 값(shrimp|agriculture)을 그대로 쓴다 — 현장 장비의
설정 파일에 이미 그 이름이 적혀 있다. 이 모듈이 먼저 쓰던 aquaculture·smartfarm 은
읽을 때 같은 뜻으로 맞춘다(resolve).

**상호 배타**다. 한 장비는 한 모드로만 돈다.

왜 1급으로 올렸는가
  지금까지 수경재배는 `[nutrient] enabled` 에 묶여 **암묵적으로** 갈렸다. 그 플래그
  하나가 판정 밴드(limits.NUTRIENT_BANDS)와 운전 권고(advice.py)를 동시에 바꾸는데,
  설정 화면에는 "양액 관리 사용" 이라고만 적혀 있어 무엇이 함께 바뀌는지 보이지 않았다.
  거기에 MRV 를 더 얹을 수는 없다 — **MRV 현장 장비는 기계실에 놓이는 단말이라
  RS-485 수질 센서가 아예 안 붙어 있을 수 있고**, 그러면 기본 화면의 수온·pH·DO·염도가
  전부 '--' 로 뜬다. 보여 줄 것이 없는 화면을 기본으로 두는 것이 문제였다.

이 파일에 모은 이유
  모드가 무엇을 켜고 끄는지를 화면(webui.py)과 수집기(shrimp365_sensor.py)가 각자
  판단하면 반드시 어긋난다. 한 곳에서만 답한다. pyserial 도 네트워크도 쓰지 않으므로
  자체점검(verify.py)이 그대로 불러 쓸 수 있다.
"""

from __future__ import annotations

MODES = ("shrimp", "agriculture", "mrv")
DEFAULT = "shrimp"
#: 이 모듈이 먼저 쓰던 이름. 설정 파일에 적혀 있으면 운영 이름으로 읽는다.
ALIASES = {"aquaculture": "shrimp", "smartfarm": "agriculture"}


def resolve(declared: str | None, nutrient_enabled: bool = False) -> str:
    """설정 파일이 말하는 모드를 정한다.

    `[webui] mode`(옛 파일은 `[device] mode`)가 적혀 있으면 그대로 쓴다. 옛 이름
    (aquaculture·smartfarm)은 같은 뜻의 운영 이름으로 읽는다. **적혀 있지 않거나 모르는
    값이면 양식장**이다 — 기존 장비는 그대로 돌아야 한다.

    `nutrient_enabled` 는 더 쓰지 않는다. 수집기 1.10 이 스마트팜을 양액 플래그와
    무관한 화면 모드로 두었으므로(양식장 화면에서도 양액 관리를 켤 수 있다), 양액
    플래그로 모드를 추론하면 그 장비들의 화면 이름·색이 바뀐다. 인자는 옛 호출을
    깨지 않으려고 남겨 둔다.

    **추론으로 mrv 가 되는 길은 없다.** MRV 수집 키를 들고 있다는 사실만으로 모드를
    옮기면, 수질을 보던 장비의 기본 화면이 어느 날 전력 입력 단말로 바뀐다. MRV 는
    사람이 설정 화면에서 고를 때만 된다.
    """
    del nutrient_enabled
    value = (declared or "").strip().lower()
    value = ALIASES.get(value, value)
    return value if value in MODES else DEFAULT


def shows_nutrient(mode: str) -> bool:
    """양액 보충 안내를 띄울 수 있는가. 켜고 끄는 것은 [nutrient] enabled 이고, 여기서는
    MRV 단말만 막는다 — 그 화면 앞에 선 사람은 계량기를 읽으러 온 사람이다."""
    return mode != "mrv"


def shows_advice(mode: str) -> bool:
    """설비 운전 권고를 띄우는가.

    스마트팜에서도 True 다 — 그 모드에서 권고를 비우는 판단은 advice.py 안에 있다
    (새우 기준 권고를 양액 수조에 들이대지 않기 위한 것). 여기서 또 끄면 같은
    판단이 두 곳에 생긴다. MRV 단말에서는 수질을 보고 설비를 돌릴 사람이 그 화면
    앞에 없으므로 끈다.
    """
    return mode != "mrv"


def shows_power(mode: str) -> bool:
    """전력 수기 입력 창구를 여는가. MRV 모드 전용이다."""
    return mode == "mrv"


def water_first(mode: str) -> bool:
    """기본 화면이 수질 측정값인가.

    MRV 모드에서는 아니다 — 기본 화면이 전력 입력 단말이 된다. 다만 **수질 수집과
    전송은 모드와 무관하게 계속된다**(센서가 붙어 있으면 한 장비가 둘 다 한다).
    끄는 것은 화면이지 수집이 아니다.
    """
    return mode != "mrv"
