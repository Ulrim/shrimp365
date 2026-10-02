#!/usr/bin/env python3
"""설정 점검 — 서비스를 띄우지 않고 무엇이 잘못됐는지만 알려준다.

    sudo -u shrimp365 /opt/shrimp365-vision/.venv/bin/python \\
        /opt/shrimp365-vision/deploy/check-config.py

**비밀번호를 화면에 찍지 않는다.** 현장 사진으로 주고받을 때 그대로 노출되면
안 되므로, 값은 길이와 앞 글자 몇 개만 보여 준다.

systemd 로그는 파이썬 스택트레이스라 현장에서 읽기 어렵다. 이 스크립트는
"무엇이 비었는지 → 주소 모양이 맞는지 → 실제로 붙는지 → 표가 있는지" 를
순서대로 보고, 처음 걸리는 데서 할 일을 알려준다.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

ENV_PATH = Path("/etc/shrimp365-vision/env")
REQUIRED_TABLES = (
    "vision_cameras", "count_records", "vision_alert_configs",
    "tanks", "farms", "alerts",
)

OK, BAD, WARN = "  [OK]  ", "  [문제] ", "  [참고] "


def mask(value: str, keep: int = 4) -> str:
    """값을 알아볼 수는 있되 그대로 쓸 수는 없게."""
    if not value:
        return "(비어 있음)"
    return f"{value[:keep]}…({len(value)}자)"


def mask_url(url: str) -> str:
    """연결 문자열에서 비밀번호만 가린다. 나머지는 보여야 고칠 수 있다."""
    return re.sub(r"://([^:/@]+):([^@]*)@", r"://\1:***@", url)


def read_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        print(f"{BAD}설정 파일이 없습니다: {ENV_PATH}")
        print("        먼저 설치하세요:  sudo ./deploy/install.sh")
        raise SystemExit(1)
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def check_values(env: dict[str, str]) -> list[str]:
    problems = []
    for key, hint in (
        ("VISION_SERVICE_KEY", "웹(Vercel)에 넣은 것과 같은 값"),
        ("VISION_STREAM_SECRET", "웹(Vercel)에 넣은 것과 같은 값"),
        ("DATABASE_URL", "Supabase → Connect → Session pooler"),
    ):
        val = env.get(key, "")
        if not val:
            print(f"{BAD}{key} 가 비어 있습니다 — {hint}")
            problems.append(key)
        else:
            shown = mask_url(val) if key == "DATABASE_URL" else mask(val)
            print(f"{OK}{key} = {shown}")
    return problems


def check_url_shape(url: str) -> list[str]:
    problems = []
    if url.startswith(("postgresql://", "postgres://")):
        print(f"{BAD}접두사가 postgresql+asyncpg:// 여야 합니다")
        print("        Supabase 가 주는 postgresql:// 에 +asyncpg 를 끼워 넣으세요")
        problems.append("prefix")
    elif not url.startswith("postgresql+asyncpg://"):
        print(f"{BAD}DATABASE_URL 을 알아볼 수 없습니다")
        problems.append("prefix")

    if "YOUR-PASSWORD" in url or "[" in url or "]" in url:
        print(f"{BAD}자리표시자가 그대로 남아 있습니다 — [YOUR-PASSWORD] 를 실제 비밀번호로")
        print("        대괄호 [ ] 까지 지워야 합니다")
        problems.append("placeholder")

    # Direct connection 은 IPv6 전용이라 파이에서 대개 안 붙는다.
    if re.search(r"@db\.[a-z0-9]+\.supabase\.co", url):
        print(f"{BAD}Direct connection 주소입니다 (db.xxx.supabase.co)")
        print("        IPv6 전용이라 라즈베리파이에서 대개 실패합니다.")
        print("        Supabase 의 Connect → Session pooler 탭 문자열을 쓰세요")
        print("        (pooler.supabase.com 이 들어 있고 사용자가 postgres.<프로젝트ref> 인 쪽)")
        problems.append("direct")

    # 비밀번호에 인코딩이 필요한 글자가 있으면 조용히 인증 실패한다.
    m = re.search(r"://[^:/@]+:([^@]*)@", url)
    if m:
        pw = m.group(1)
        bad = [c for c in "#?&/ " if c in pw]
        if bad:
            print(f"{BAD}비밀번호에 인코딩이 필요한 글자가 있습니다: {' '.join(bad)}")
            print("        # → %23,  ? → %3F,  & → %26,  / → %2F,  공백 → %20")
            print("        또는 Supabase 에서 영문·숫자만으로 비밀번호를 재설정하세요")
            problems.append("encoding")
    return problems


async def check_connection(url: str) -> bool:
    try:
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import create_async_engine
    except ImportError:
        print(f"{BAD}sqlalchemy 를 찾을 수 없습니다 — 가상환경의 python 으로 실행하세요")
        return False

    engine = create_async_engine(url, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            rows = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = ANY(:names)"
                ),
                {"names": list(REQUIRED_TABLES)},
            )
            present = {r[0] for r in rows}
    except Exception as exc:  # noqa: BLE001 - 무엇이든 사람이 읽을 말로 바꾼다
        text_ = f"{type(exc).__name__}: {exc}"
        print(f"{BAD}DB 에 붙지 못했습니다")
        print(f"        {mask_url(text_)[:300]}")
        low = text_.lower()
        if "password authentication failed" in low:
            print("        → 비밀번호가 틀립니다. Supabase 에서 재설정하세요")
        elif "network is unreachable" in low or "connect call failed" in low:
            print("        → 주소에 닿지 못합니다. Session pooler 주소인지 확인하세요")
        elif "does not exist" in low and "role" in low:
            print("        → 사용자 이름이 틀립니다. postgres.<프로젝트ref> 형태여야 합니다")
        elif "name or service not known" in low or "nodename" in low:
            print("        → 호스트 주소 오타이거나 인터넷이 끊겼습니다")
        return False
    finally:
        await engine.dispose()

    print(f"{OK}DB 연결 성공")
    missing = [t for t in REQUIRED_TABLES if t not in present]
    if missing:
        print(f"{BAD}필요한 표가 없습니다: {', '.join(missing)}")
        print("        supabase/migrations/vision_monitoring.sql 을")
        print("        Supabase SQL Editor 에서 실행하세요")
        return False
    print(f"{OK}필요한 표 {len(REQUIRED_TABLES)}개 모두 있음")
    return True


def main() -> int:
    print("=" * 60)
    print("  Shrimp365 개체수 — 설정 점검")
    print("=" * 60)
    env = read_env()

    if check_values(env):
        print()
        print(f"  고치기:  sudo nano {ENV_PATH}")
        return 1

    print()
    if check_url_shape(env["DATABASE_URL"]):
        print()
        print(f"  고치기:  sudo nano {ENV_PATH}")
        return 1

    print()
    if not asyncio.run(check_connection(env["DATABASE_URL"])):
        print()
        print(f"  고치기:  sudo nano {ENV_PATH}")
        return 1

    model = env.get("MODEL_PATH", "/opt/shrimp365-vision/ai/models/shrimp_yolov8n_416.onnx")
    if Path(model).is_file() and Path(model).stat().st_size > 0:
        print(f"{OK}모델 파일 있음: {Path(model).name}")
    else:
        print(f"{BAD}모델 파일이 없습니다: {model}")
        print("        이대로 두면 개체수가 가짜로 쌓입니다(시뮬레이션)")
        return 1

    print()
    print("  설정에 문제가 없습니다. 시작하세요:")
    print("    sudo systemctl restart shrimp365-vision")
    return 0


if __name__ == "__main__":
    sys.exit(main())
