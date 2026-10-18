"""장비의 운전 모드 — 이 장비가 무엇을 하는 기계인가.

    aquaculture  양식장   수질 측정이 본업. 지금까지의 기본 동작.
    smartfarm    스마트팜 수경재배. EC 로 양액 농도를 보고 보충량을 띄운다.
    mrv          탄소 MRV 기계실 계량기 옆 전력 입력 단말.

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

MODES = ("aquaculture", "smartfarm", "mrv")
DEFAULT = "aquaculture"


def resolve(declared: str | None, nutrient_enabled: bool) -> str:
    """설정 파일이 말하는 모드를 정한다.

    `[device] mode` 가 적혀 있으면 그대로 쓴다. **적혀 있지 않으면 기존 설치다** —
    그 장비들은 `[nutrient] enabled` 로 수경재배 여부를 말해 왔으므로 그것으로
    추론한다. 마이그레이션 없이 조용히 동작이 바뀌면 현장이 깨진다.

        적힌 값 없음 + 양액 켬  → smartfarm
        적힌 값 없음 + 양액 끔  → aquaculture

    **추론으로 mrv 가 되는 길은 없다.** MRV 수집 키를 들고 있다는 사실만으로 모드를
    옮기면, 수질을 보던 장비의 기본 화면이 어느 날 전력 입력 단말로 바뀐다. MRV 는
    사람이 설정 화면에서 고를 때만 된다.
    """
    value = (declared or "").strip().lower()
    if value in MODES:
        return value
    return "smartfarm" if nutrient_enabled else DEFAULT


def shows_nutrient(mode: str) -> bool:
    """양액 보충 안내와 수경재배 판정 밴드를 쓰는가."""
    return mode == "smartfarm"


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
