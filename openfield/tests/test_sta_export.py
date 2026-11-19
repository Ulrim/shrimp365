"""학습·검증 데이터 내보내기(scripts/sta_export_data.py)."""

from __future__ import annotations

import csv
import importlib.util
import pickle
import sys
from pathlib import Path

from ofdf.models import weather_risk
from test_sta_evaluate import _synthetic_dataset

ROOT = Path(__file__).resolve().parents[1]


def _load():
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location("sta_export_data", ROOT / "scripts" / "sta_export_data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def test_export_writes_each_split_with_the_same_split_as_training(tmp_path):
    export = _load()
    ds = _synthetic_dataset(days=60)
    cache = tmp_path / "dataset.pkl"
    cache.write_bytes(pickle.dumps(ds))
    before = cache.read_bytes()
    out = tmp_path / "학습데이터"

    assert export.main(["--cache", str(cache), "--year-round-cache", str(cache), "--out", str(out),
                        "--parts", "train,valid,test", "--with-off-season", "--zip"]) == 0

    meta, states = ds.meta.reset_index(drop=True), ds.states.reset_index(drop=True)
    train, valid, test = weather_risk.split_by_event(weather_risk.shared_group_keys(meta, states), seed=42)
    rows = {name: _rows(out / f"{name}.csv") for name in ("학습데이터", "검증데이터", "시험데이터")}
    assert [len(rows[n]) for n in rows] == [len(train), len(valid), len(test)]

    # 분할끼리 기상사례 블록이 겹치지 않는다
    blocks = {n: {r["기상사례블록"] for r in rows[n]} for n in rows}
    assert not (blocks["학습데이터"] & blocks["시험데이터"]) and not (blocks["검증데이터"] & blocks["시험데이터"])

    first = rows["학습데이터"][0]
    assert list(first)[:3] == ["시각", "관측지점", "기상사례블록"]
    assert "정답등급_복합위험 3시간" in first and first["정답등급_저온·서리 1시간"] in ("0", "1", "2")
    stats = (out / "통계.txt").read_text(encoding="utf-8")
    assert "train∩test: 0" in stats and "작기 밖 학습 보강" in stats
    assert (out / "학습보강_작기밖.csv").exists() and (tmp_path / "학습데이터.zip").exists()
    assert len((out / "sha256.txt").read_text(encoding="utf-8").splitlines()) == 5
    assert cache.read_bytes() == before          # 읽기만 한다


def test_export_stops_without_cache(tmp_path):
    assert _load().main(["--cache", str(tmp_path / "없음.pkl"), "--out", str(tmp_path / "out")]) == 2
