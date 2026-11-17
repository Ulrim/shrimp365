"""STA 시험 꾸러미 조립(scripts/sta_make_kit.py)."""

from __future__ import annotations

import importlib.util
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("sta_make_kit", ROOT / "scripts" / "sta_make_kit.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["sta_make_kit"] = module
    spec.loader.exec_module(module)
    return module


def test_kit_has_simple_layout_and_ascii_launchers(tmp_path):
    kit = _load()
    out = kit.build(tmp_path / "STA_AI_nozi_test_kit", pdf=False)

    assert sorted(p.name for p in out.iterdir() if p.is_dir()) == [
        "data", "model", "program", "reference", "result"]
    assert (out / "읽어_주세요.md").read_text(encoding="utf-8").startswith("# AI 노지 시험 꾸러미")
    for step in ("1_setup", "2_check", "3_rehearsal", "4_test", "9_train_model"):
        bat = (out / f"{step}.bat").read_bytes()
        assert bat.isascii() and b"\r\n" in bat and b"\n" not in bat.replace(b"\r\n", b"")
        assert (out / f"{step}.sh").read_bytes().isascii()
    assert b'--models "%~dp0model"' in (out / "4_test.bat").read_bytes()
    assert b"--mode testday" in (out / "4_test.bat").read_bytes()
    assert b'"${KIT}data/dataset.pkl"' in (out / "3_rehearsal.sh").read_bytes()

    # 프로그램은 판단 코드와 해시 목록을 함께 가져간다. 모델·자료는 넣지 않는다
    assert (out / "program" / "src" / "ofdf" / "cli.py").exists()
    assert (out / "program" / "reports" / "시험의뢰" / "판단코드해시_5ff054f.txt").exists()
    assert [p.name for p in (out / "model").iterdir()] == ["여기는.md"]
    assert not list(out.rglob("*.pkl")) and not list(out.rglob("model_*.txt"))


def test_kit_program_copy_matches_target_code_without_git(tmp_path):
    kit = _load()
    out = kit.build(tmp_path / "kit", pdf=False)
    spec = importlib.util.spec_from_file_location("kit_common", out / "program" / "scripts" / "sta_common.py")
    common = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(common)
    checked = common.verify_code_hashes()
    assert checked is not None and checked[1] == []


def test_kit_zip_marks_korean_names_as_utf8(tmp_path):
    kit = _load()
    archive = kit.make_zip(kit.build(tmp_path / "kit", pdf=False))
    infos = zipfile.ZipFile(archive).infolist()
    korean = [i for i in infos if not i.filename.isascii()]
    assert korean and all(i.flag_bits & 0x800 for i in korean)
    assert any(i.filename == "kit/data/aaos/" for i in infos)        # 빈 폴더도 들어간다
