"""기기 페어링 — 신원 보관과 우선순위.

코드 발급·승인은 shrimp365(app/api/vision/pair)가 하고, 여기서는 장비 쪽이
받은 키를 어떻게 간수하는지만 본다.
"""
from __future__ import annotations

import json
import stat

import pytest

from app.config import settings
from app.services import pairing


@pytest.fixture
def state_file(tmp_path, monkeypatch):
    path = tmp_path / "device.json"
    monkeypatch.setattr(settings, "device_state_path", str(path))
    monkeypatch.setattr(settings, "device_key", "")
    return path


def test_save_then_load(state_file):
    assert pairing.load_device_key() is None
    assert pairing.save_device_key("abc123", "cam-1", "1번 수조")
    assert pairing.load_device_key() == "abc123"

    saved = json.loads(state_file.read_text())
    assert saved["camera_id"] == "cam-1"
    assert saved["tank_name"] == "1번 수조"


def test_key_file_is_not_world_readable(state_file):
    """기기 키가 들어 있는 파일이다. 다른 사용자가 읽을 수 있으면 안 된다."""
    pairing.save_device_key("abc123", None, None)
    mode = stat.S_IMODE(state_file.stat().st_mode)
    assert mode & (stat.S_IRWXG | stat.S_IRWXO) == 0


def test_env_key_wins_over_file(state_file, monkeypatch):
    """환경변수로 준 키가 상태 파일보다 우선한다.

    배포 도구가 키를 직접 넣는 경우(도커 등)에 페어링을 건너뛸 수 있어야 한다.
    """
    pairing.save_device_key("from-file", None, None)
    monkeypatch.setattr(settings, "device_key", "from-env")
    assert pairing.load_device_key() == "from-env"


def test_corrupt_state_file_is_ignored(state_file):
    """파일이 깨져 있으면 없는 것으로 본다 — 페어링을 다시 하면 된다."""
    state_file.write_text("{ 깨진 JSON")
    assert pairing.load_device_key() is None


async def test_ensure_device_key_returns_existing(state_file):
    pairing.save_device_key("already-paired", None, None)
    assert await pairing.ensure_device_key() == "already-paired"
    # 확보한 키는 설정에도 반영되어야 귀속 판정이 곧바로 먹는다.
    assert settings.device_key == "already-paired"


async def test_ensure_device_key_without_server_url(state_file, monkeypatch):
    """shrimp365 주소가 없으면 페어링을 시작할 수 없다 — 조용히 None."""
    monkeypatch.setattr(settings, "shrimp365_internal_url", "")
    assert await pairing.ensure_device_key() is None


def test_board_serial_always_returns_something():
    """라즈베리파이가 아닌 환경에서도 값이 있어야 한다(개발용 PC 등)."""
    assert pairing.board_serial()
