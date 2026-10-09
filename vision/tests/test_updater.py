"""원격 업데이트 — 무엇을 거부해야 하는가.

이 코드는 **남의 장비에서 코드를 실행하는 통로**다. 여기서 한 겹이 뚫리면
농장 수십 곳의 카메라 파이가 한꺼번에 넘어간다. 그래서 이 파일은 "잘 되는가"
보다 **"제대로 거부하는가"** 를 본다.

서명을 쓰지 않기로 했으므로(deploy/updater.py 머리말), 남은 방어선은 둘이다 —
**해시**(받아 온 것이 올린 것과 같은가)와 **모양**(경로·종류·크기). 둘 다
여기서 본다.

업데이터는 설치본(/opt)과 systemd 를 건드리므로, 경로를 받는 함수는 임시
폴더로, 그렇지 않은 것은 실제 꾸러미를 만들어 확인한다.
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parent.parent / "deploy"


def _load(name: str):
    """deploy/ 의 스크립트를 모듈로 불러온다(패키지가 아니다)."""
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


updater = _load("updater")

# ── 꾸러미 만들기 도우미 ────────────────────────────────────────────────────
def make_tar(entries: dict[str, bytes], *, kind: str = "file") -> bytes:
    """이름 → 내용으로 tar.gz 를 만든다. kind 로 수상한 항목도 만들 수 있다."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, body in entries.items():
            if kind == "symlink":
                info = tarfile.TarInfo(name)
                info.type = tarfile.SYMTYPE
                info.linkname = body.decode()
                tar.addfile(info)
                continue
            info = tarfile.TarInfo(name)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return buf.getvalue()


def good_payload(version: str = "1.1.0") -> dict[str, bytes]:
    return {
        "app/__init__.py": b"",
        "app/main.py": b"VALUE = 2\n",
        "app/services/thing.py": b"X = 1\n",
        "VERSION": f"{version}\n".encode(),
        "pyproject.toml": b"[project]\nname='x'\n",
        "deploy/updater.py": "# 자기 자신도 고칠 수 있어야 한다\n".encode(),
    }


def entry_for(blob: bytes, version: str = "1.1.0") -> dict:
    """목록에 적히는 한 줄. release.py 가 만드는 것과 같은 모양."""
    return {
        "file": f"shrimp365-vision-{version}.tar.gz",
        "sha256": hashlib.sha256(blob).hexdigest(),
    }


# ── 받아 온 것이 올린 것과 같은가 ─────────────────────────────────────────
#
# 농장 회선에서 내려받기가 잘리는 일은 흔하다. 잘린 tar 를 그대로 풀면
# 반쪽짜리 설치본이 되고, 그 장비는 사람이 가야 산다.
def test_matching_package_passes():
    blob = make_tar(good_payload())
    updater.verify_payload(blob, entry_for(blob))


def test_tampered_bytes_are_rejected():
    blob = make_tar(good_payload())
    with pytest.raises(ValueError, match="해시"):
        updater.verify_payload(blob + b"x", entry_for(blob))


def test_truncated_download_is_rejected():
    """회선이 끊겨 반만 받아 온 경우. 가장 흔한 실패다."""
    blob = make_tar(good_payload())
    with pytest.raises(ValueError, match="해시"):
        updater.verify_payload(blob[: len(blob) // 2], entry_for(blob))


def test_entry_without_a_hash_is_rejected():
    """해시가 없으면 확인할 길이 없다 — 받지 않는다."""
    blob = make_tar(good_payload())
    with pytest.raises(ValueError, match="해시가 없어"):
        updater.verify_payload(blob, {"file": "x.tar.gz"})


def test_hash_comparison_ignores_case():
    blob = make_tar(good_payload())
    entry = entry_for(blob)
    entry["sha256"] = entry["sha256"].upper()
    updater.verify_payload(blob, entry)


def test_no_signing_key_is_left_in_the_updater():
    """서명을 쓰지 않기로 했다. 흔적이 남아 있으면 읽는 사람이 헷갈린다."""
    text = (DEPLOY / "updater.py").read_text(encoding="utf-8")
    assert "RELEASE_PUBLIC_KEY" not in text
    assert "Ed25519" not in text


# ── 버전 되감기 ─────────────────────────────────────────────────────────────
def test_same_version_is_not_reinstalled():
    """받아 봐야 달라지는 것이 없고, 실패하면 멀쩡한 장비만 흔든다."""
    manifest = {"latest": "1.2.0", "releases": {"1.2.0": {"file": "a.tar.gz"}}}
    assert updater.pick_target(manifest, "1.2.0") is None


def test_older_version_is_refused():
    """이미 서명된 예전 꾸러미를 다시 미는 수법을 막는다."""
    manifest = {"latest": "1.0.0", "releases": {"1.0.0": {"file": "a.tar.gz"}}}
    assert updater.pick_target(manifest, "1.5.0") is None


def test_newer_version_is_taken():
    entry = {"file": "a.tar.gz"}
    manifest = {"latest": "1.5.0", "releases": {"1.5.0": entry}}
    assert updater.pick_target(manifest, "1.0.0") == ("1.5.0", entry)


def test_malformed_version_is_refused():
    manifest = {"latest": "latest", "releases": {}}
    assert updater.pick_target(manifest, "1.0.0") is None


def test_missing_release_entry_is_refused():
    """목록의 latest 와 releases 가 어긋나면 받지 않는다."""
    manifest = {"latest": "2.0.0", "releases": {}}
    assert updater.pick_target(manifest, "1.0.0") is None


# ── 푸는 단계: 경로 탈출·심볼릭 링크·크기 ───────────────────────────────────
@pytest.mark.parametrize("name", [
    "../../etc/passwd",            # 상위로 빠져나가기
    "/etc/passwd",                 # 절대경로
    "app/../../../tmp/evil.py",    # 가운데 섞어 넣기
    "etc/cron.d/evil",             # app 밖
    "app/evil.sh",                 # 파이썬이 아닌 것
    "app/Evil.py",                 # 대문자(규칙 밖)
    "deploy/install.sh",           # deploy 아래라도 updater.py 만
    "deploy/evil.py",
])
def test_paths_outside_the_package_are_refused(name, tmp_path):
    blob = make_tar({name: b"x = 1\n"})
    with pytest.raises(ValueError, match="허용되지 않은 경로"):
        updater.safe_extract(blob, tmp_path / "stage")


def test_symlinks_are_refused(tmp_path):
    """심볼릭 링크를 걸어 바깥 파일을 덮어쓰게 만드는 수법."""
    blob = make_tar({"app/main.py": b"/etc/passwd"}, kind="symlink")
    with pytest.raises(ValueError, match="파일이 아닌"):
        updater.safe_extract(blob, tmp_path / "stage")


def test_empty_package_is_refused(tmp_path):
    with pytest.raises(ValueError, match="비어 있습니다"):
        updater.safe_extract(make_tar({}), tmp_path / "stage")


def test_zip_bomb_is_refused(tmp_path, monkeypatch):
    """작게 압축된 것이 풀리면서 SD 카드를 채우는 것을 막는다."""
    monkeypatch.setattr(updater, "MAX_UNPACKED_BYTES", 1024)
    blob = make_tar({"app/big.py": b"#" * 100_000})
    with pytest.raises(ValueError, match="푼 크기"):
        updater.safe_extract(blob, tmp_path / "stage")


def test_good_package_extracts(tmp_path):
    stage = tmp_path / "stage"
    updater.safe_extract(make_tar(good_payload()), stage)
    assert (stage / "app" / "main.py").read_bytes() == b"VALUE = 2\n"
    assert (stage / "app" / "services" / "thing.py").is_file()
    assert (stage / "deploy" / "updater.py").is_file()


# ── 내려받기: https 만 ───────────────────────────────────────────────────────
@pytest.mark.parametrize("url", [
    "http://www.shrimp365.kr/updates/vision/manifest.json",
    "file:///etc/passwd",
    "ftp://example.com/x.tar.gz",
])
def test_only_https_is_fetched(url):
    with pytest.raises(ValueError, match="https"):
        updater._fetch(url)


# ── 바꿔치기와 되돌리기 ─────────────────────────────────────────────────────
def _install(root: Path, version: str) -> None:
    (root / "app" / "services").mkdir(parents=True)
    (root / "app" / "main.py").write_text("VALUE = 1\n")
    (root / "app" / "services" / "old.py").write_text("GONE = True\n")
    (root / "VERSION").write_text(version + "\n")
    # 꾸러미가 건드리면 안 되는 것들
    (root / ".venv").mkdir()
    (root / ".venv" / "python").write_text("binary")
    (root / "ai").mkdir()
    (root / "ai" / "model.onnx").write_text("weights")


def test_swap_replaces_the_package_and_keeps_the_rest(tmp_path, monkeypatch):
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    (stage / "VERSION").write_text("1.1.0\n")

    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)

    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 2\n"
    assert (app_dir / "VERSION").read_text().strip() == "1.1.0"
    # 꾸러미에 없던 옛 모듈은 남지 않는다 — 새 코드가 옛 모듈을 부르면
    # 증상이 엉뚱한 곳에서 나온다.
    assert not (app_dir / "app" / "services" / "old.py").exists()
    # 가상환경과 모델은 꾸러미가 건드리지 않는다. 날아가면 다시 깔아야 산다.
    assert (app_dir / ".venv" / "python").read_text() == "binary"
    assert (app_dir / "ai" / "model.onnx").read_text() == "weights"


def test_rollback_restores_everything(tmp_path, monkeypatch):
    monkeypatch.setattr(updater.subprocess, "run", lambda *a, **k: None)
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    (stage / "VERSION").write_text("1.1.0\n")
    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)

    assert updater.roll_back(app_dir=app_dir, prev_dir=prev) is True
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 1\n"
    assert (app_dir / "VERSION").read_text().strip() == "1.0.0"
    # 되돌리면 지워졌던 모듈도 돌아와야 한다.
    assert (app_dir / "app" / "services" / "old.py").read_text() == "GONE = True\n"


def test_rollback_without_a_backup_says_so(tmp_path):
    assert updater.roll_back(app_dir=tmp_path / "opt", prev_dir=tmp_path / "nope") is False


# ── 설정 ────────────────────────────────────────────────────────────────────
def test_disabled_by_config(tmp_path):
    conf = tmp_path / "env"
    conf.write_text("UPDATE_ENABLED=false\n")
    assert updater.read_settings(conf)["enabled"] is False


def test_enabled_by_default_when_unset(tmp_path):
    conf = tmp_path / "env"
    conf.write_text("SHRIMP365_URL=https://www.shrimp365.kr\n")
    s = updater.read_settings(conf)
    assert s["enabled"] is True
    assert s["manifest"] == updater.DEFAULT_MANIFEST


def test_missing_config_still_works(tmp_path):
    """설정 파일이 없어도 기본값으로 돈다 — 켜진 채로."""
    assert updater.read_settings(tmp_path / "없음")["enabled"] is True


def test_quoted_values_are_read(tmp_path):
    conf = tmp_path / "env"
    conf.write_text('UPDATE_MANIFEST_URL="https://example.com/m.json"\n')
    assert updater.read_settings(conf)["manifest"] == "https://example.com/m.json"


# ── 버전 읽기 ───────────────────────────────────────────────────────────────
def test_version_file_is_read(tmp_path):
    (tmp_path / "VERSION").write_text("2.3.4\n")
    assert updater.current_version(tmp_path) == "2.3.4"


def test_missing_version_reads_as_zero(tmp_path):
    """읽지 못하면 0.0.0 — 무엇이든 새 것으로 보고 받아 온다."""
    assert updater.current_version(tmp_path) == "0.0.0"


def test_garbage_version_reads_as_zero(tmp_path):
    (tmp_path / "VERSION").write_text("아무거나\n")
    assert updater.current_version(tmp_path) == "0.0.0"


def test_updater_and_app_read_the_same_file():
    """업데이터가 적는 자리와 프로그램이 읽는 자리가 같아야 한다.

    어긋나면 서버에 보고되는 버전이 실제와 달라지고, 되감기 방지도 무너진다.
    """
    from app import version as appver
    root = Path(appver.__file__).resolve().parent.parent
    assert (root / "VERSION").is_file()
    assert appver.VERSION == updater.current_version(root)


# ── 교체 도중 전원이 나갔을 때 ──────────────────────────────────────────────
def test_interrupted_swap_is_recovered(tmp_path):
    """`app/` 이 없고 `app.retiring/` 만 남은 상태 — 서비스가 못 뜬다.

    지우고 복사하는 방식이었다면 이 상태에서 되돌릴 것조차 없다. 농장에
    사람이 가야만 풀리는데, 그것이 이 기능이 없애려던 상황이다.
    """
    app_dir = tmp_path / "opt"
    (app_dir / "app.retiring").mkdir(parents=True)
    (app_dir / "app.retiring" / "main.py").write_text("VALUE = 1\n")

    assert updater.recover_interrupted(app_dir) is True
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 1\n"
    assert not (app_dir / "app.retiring").exists()


def test_recovery_does_nothing_when_healthy(tmp_path):
    app_dir = tmp_path / "opt"
    (app_dir / "app").mkdir(parents=True)
    (app_dir / "app" / "main.py").write_text("VALUE = 1\n")
    assert updater.recover_interrupted(app_dir) is False
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 1\n"


def test_recovery_clears_leftovers(tmp_path):
    """끊긴 복사가 남긴 찌꺼기는 지운다 — 자리만 먹고 다음 교체를 헷갈리게 한다."""
    app_dir = tmp_path / "opt"
    (app_dir / "app").mkdir(parents=True)
    (app_dir / "app" / "main.py").write_text("X\n")
    (app_dir / "app.incoming").mkdir()
    (app_dir / "app.incoming" / "half.py").write_text("절반만 복사됨\n")

    updater.recover_interrupted(app_dir)
    assert not (app_dir / "app.incoming").exists()
    assert (app_dir / "app" / "main.py").is_file()


def test_swap_leaves_no_temporary_directories(tmp_path):
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)
    leftovers = [p.name for p in app_dir.iterdir() if p.name.startswith("app.")]
    assert leftovers == [], leftovers


def test_version_is_written_after_the_package(tmp_path):
    """VERSION 을 먼저 적고 교체가 실패하면 장비가 자기를 새 버전이라 믿는다.

    그러면 다음 확인에서 "이미 최신" 으로 보고 영영 올라가지 않는다.
    """
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    (stage / "VERSION").write_text("1.1.0\n")
    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)
    # 둘이 함께 바뀌었는가
    assert updater.current_version(app_dir) == "1.1.0"
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 2\n"


# ── 한 바퀴(run) — 결정이 실제로 그렇게 나는가 ──────────────────────────────
#
# 조각이 다 맞아도 run() 이 순서를 잘못 밟으면 소용이 없다. 특히 "거부했는데
# 적용까지 가는" 길이 생기면 앞의 검증이 전부 장식이 된다.
@pytest.fixture
def wired(tmp_path, monkeypatch):
    """설정·상태 파일을 임시 폴더로 돌리고, 적용 단계는 기록만 한다."""
    conf = tmp_path / "env"
    conf.write_text("UPDATE_ENABLED=true\n")
    monkeypatch.setattr(updater, "CONF", conf)
    monkeypatch.setattr(updater, "STATE_DIR", tmp_path / "state")
    monkeypatch.setattr(updater, "RESULT_PATH", tmp_path / "state" / "update-result.json")
    monkeypatch.setattr(updater, "APP_DIR", tmp_path / "opt")
    (tmp_path / "opt").mkdir()
    (tmp_path / "opt" / "VERSION").write_text("1.0.0\n")
    # run() 은 적용 전에 설치본의 파이썬이 있는지 본다.
    (tmp_path / "opt" / ".venv" / "bin").mkdir(parents=True)
    (tmp_path / "opt" / ".venv" / "bin" / "python").write_text("#!/bin/sh\n")

    applied = []
    def fake_apply(blob, version, python):
        applied.append(version)
        return "applied", "정상"
    monkeypatch.setattr(updater, "apply_update", fake_apply)
    return {"conf": conf, "applied": applied, "result": tmp_path / "state" / "update-result.json",
            "tmp": tmp_path}


def _serve(monkeypatch, manifest: dict, blob: bytes):
    def fake_fetch(url, timeout=60, limit=updater.MAX_PACKAGE_BYTES):
        if url.endswith("manifest.json"):
            return json.dumps(manifest).encode()
        return blob
    monkeypatch.setattr(updater, "_fetch", fake_fetch)


def test_run_applies_a_good_release(wired, monkeypatch, tmp_path):
    blob = make_tar(good_payload())
    entry = entry_for(blob, "1.1.0")
    _serve(monkeypatch, {"latest": "1.1.0", "releases": {"1.1.0": entry}}, blob)

    assert updater.run(dry_run=False) == 0
    assert wired["applied"] == ["1.1.0"]
    assert json.loads(wired["result"].read_text())["status"] == "applied"


def test_run_refuses_a_package_that_does_not_match_and_never_applies(wired, monkeypatch):
    """목록과 다른 바이트가 오면 적용 단계까지 가지 못한다.

    서명이 없으므로 이것이 **내용에 대한 유일한 검사**다. 여기가 뚫리면
    나머지는 전부 장식이다.
    """
    blob = make_tar(good_payload())
    entry = entry_for(blob)
    _serve(monkeypatch, {"latest": "1.1.0", "releases": {"1.1.0": entry}}, b"\x00" * len(blob))

    assert updater.run(dry_run=False) == 1
    assert wired["applied"] == []
    assert json.loads(wired["result"].read_text())["status"] == "rejected"


def test_run_refuses_tampered_bytes(wired, monkeypatch):
    blob = make_tar(good_payload())
    entry = entry_for(blob, "1.1.0")
    _serve(monkeypatch, {"latest": "1.1.0", "releases": {"1.1.0": entry}}, blob + b"evil")

    assert updater.run(dry_run=False) == 1
    assert wired["applied"] == []


def test_dry_run_verifies_but_does_not_apply(wired, monkeypatch):
    blob = make_tar(good_payload())
    entry = entry_for(blob, "1.1.0")
    _serve(monkeypatch, {"latest": "1.1.0", "releases": {"1.1.0": entry}}, blob)

    assert updater.run(dry_run=True) == 0
    assert wired["applied"] == []


def test_run_skips_when_already_latest(wired, monkeypatch):
    blob = make_tar(good_payload())
    _serve(monkeypatch, {"latest": "1.0.0",
                         "releases": {"1.0.0": entry_for(blob, "1.0.0")}}, blob)
    assert updater.run(dry_run=False) == 0
    assert wired["applied"] == []


def test_run_stops_when_disabled(wired, monkeypatch):
    wired["conf"].write_text("UPDATE_ENABLED=false\n")
    def boom(*a, **k):
        raise AssertionError("꺼져 있으면 아무것도 받지 않아야 한다")
    monkeypatch.setattr(updater, "_fetch", boom)
    assert updater.run(dry_run=False) == 0


def test_offline_is_not_an_error(wired, monkeypatch):
    """농장 회선은 끊긴다. 다음 차례에 다시 보면 된다."""
    def dead(*a, **k):
        raise OSError("연결 실패")
    monkeypatch.setattr(updater, "_fetch", dead)
    assert updater.run(dry_run=False) == 0
    assert wired["applied"] == []


# ── 실패한 꾸러미를 기억한다 ────────────────────────────────────────────────
#
# 없으면 나쁜 릴리스 하나가 전 농장을 매시간 흔든다. 1.1.0 이 건강 확인에
# 실패해 되돌아가도 목록의 latest 는 그대로라, 한 시간 뒤 같은 것을 다시
# 받아 다시 적용하고 다시 되돌린다. 그동안 카메라가 멈춘다. 끝이 없다.
def test_a_release_that_rolled_back_is_not_retried(wired, monkeypatch):
    blob = make_tar(good_payload())
    entry = entry_for(blob, "1.1.0")
    _serve(monkeypatch, {"latest": "1.1.0", "releases": {"1.1.0": entry}}, blob)
    monkeypatch.setattr(updater, "apply_update",
                        lambda b, v, p: ("rolled_back", "자리를 잡지 못했습니다"))

    assert updater.run(dry_run=False) == 1          # 한 번은 해 본다
    assert updater.run(dry_run=False) == 0          # 두 번째는 건너뛴다
    assert json.loads(wired["result"].read_text())["tried"] == "1.1.0"


def test_a_fixed_package_under_the_same_version_is_retried(wired, monkeypatch):
    """번호를 올리지 않고 고쳐 올리는 길을 막지는 않는다 — 해시가 다르다."""
    bad = make_tar(good_payload())
    _serve(monkeypatch,
           {"latest": "1.1.0", "releases": {"1.1.0": entry_for(bad, "1.1.0")}}, bad)
    monkeypatch.setattr(updater, "apply_update", lambda b, v, p: ("rolled_back", "실패"))
    updater.run(dry_run=False)

    fixed = make_tar({**good_payload(), "app/main.py": b"VALUE = 3\n"})
    _serve(monkeypatch,
           {"latest": "1.1.0", "releases": {"1.1.0": entry_for(fixed, "1.1.0")}}, fixed)
    tried = []
    monkeypatch.setattr(updater, "apply_update",
                        lambda b, v, p: (tried.append(v), ("applied", "정상"))[1])
    assert updater.run(dry_run=False) == 0
    assert tried == ["1.1.0"]


def test_a_release_that_only_failed_to_prepare_is_retried(wired, monkeypatch):
    """준비 단계 실패는 설치본을 건드리지 않았다 — 회선 탓일 수 있으니 다시 해 본다."""
    blob = make_tar(good_payload())
    _serve(monkeypatch,
           {"latest": "1.1.0", "releases": {"1.1.0": entry_for(blob, "1.1.0")}}, blob)
    monkeypatch.setattr(updater, "apply_update", lambda b, v, p: ("failed", "준비 단계 실패"))
    assert updater.run(dry_run=False) == 1
    assert updater.run(dry_run=False) == 1   # 건너뛰지 않는다


# ── 되돌리기가 거짓말을 하지 않는다 ─────────────────────────────────────────
def test_rollback_refuses_an_incomplete_backup(tmp_path, monkeypatch):
    """반쪽짜리 백업으로 덮으면 **멀쩡하던 설치본까지 깨진다.**

    되돌리기는 마지막 보루다. 그것이 상황을 악화시키면 사람이 가야 한다.
    """
    monkeypatch.setattr(updater.subprocess, "run", lambda *a, **k: None)
    app_dir, prev = tmp_path / "opt", tmp_path / "prev"
    _install(app_dir, "1.0.0")
    (prev / "app").mkdir(parents=True)      # app/main.py 가 없다 — 보관 도중 끊겼다
    (prev / "VERSION").write_text("0.9.0\n")

    assert updater.roll_back(app_dir=app_dir, prev_dir=prev) is False
    # 멀쩡하던 설치본은 그대로여야 한다
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 1\n"


def test_rollback_refuses_a_backup_without_a_version(tmp_path, monkeypatch):
    monkeypatch.setattr(updater.subprocess, "run", lambda *a, **k: None)
    app_dir, prev = tmp_path / "opt", tmp_path / "prev"
    _install(app_dir, "1.0.0")
    (prev / "app").mkdir(parents=True)
    (prev / "app" / "main.py").write_text("X\n")

    assert updater.roll_back(app_dir=app_dir, prev_dir=prev) is False
    assert (app_dir / "app" / "main.py").read_text() == "VALUE = 1\n"


def test_a_device_that_could_not_roll_back_says_broken(wired, monkeypatch):
    """화면이 "되돌렸습니다" 라고 하면 사람이 안 간다. 실제로는 죽어 있는데."""
    blob = make_tar(good_payload())
    _serve(monkeypatch,
           {"latest": "1.1.0", "releases": {"1.1.0": entry_for(blob, "1.1.0")}}, blob)
    monkeypatch.setattr(updater, "apply_update",
                        lambda b, v, p: ("broken", "되돌리지 못했습니다"))
    assert updater.run(dry_run=False) == 1
    assert json.loads(wired["result"].read_text())["status"] == "broken"


# ── 바이트코드 캐시가 설치본까지 실려 가지 않는다 ───────────────────────────
def test_pycache_is_not_carried_into_the_install(tmp_path):
    """install.sh 와 release.py 는 둘 다 일부러 뺀다. 업데이트만 넣고 있었다."""
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    (stage / "app" / "__pycache__").mkdir()
    (stage / "app" / "__pycache__" / "main.cpython-311.pyc").write_bytes(b"\x00")

    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)
    assert not (app_dir / "app" / "__pycache__").exists()


# ── 낱개 파일을 원자적으로 바꾼다 ───────────────────────────────────────────
def test_files_are_replaced_atomically(tmp_path, monkeypatch):
    """updater.py 가 반쯤 잘리면 그 장비는 다시는 원격 업데이트를 못 받는다."""
    seen = []
    real_replace = updater.os.replace
    monkeypatch.setattr(updater.os, "replace",
                        lambda a, b: (seen.append(Path(b).name), real_replace(a, b))[1])
    app_dir, prev, stage = tmp_path / "opt", tmp_path / "prev", tmp_path / "stage"
    _install(app_dir, "1.0.0")
    updater.safe_extract(make_tar(good_payload()), stage)
    updater.swap_in(stage, app_dir=app_dir, prev_dir=prev)

    assert "updater.py" in seen and "VERSION" in seen
    assert not list(app_dir.rglob("*.tmp"))
