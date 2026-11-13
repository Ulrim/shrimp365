"""train_tank.py — 장면 묶음 단위로 나눠 조각 자료를 만드는 규칙."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai" / "trainer"))

import train_tank as tt  # noqa: E402

SESSION = "tank1-s1"


@pytest.fixture
def labeled(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    root = tmp_path / "labeled"
    (root / "images").mkdir(parents=True)
    (root / "labels").mkdir()
    rows = ["파일\t장면묶음\t상자수\t보류수"]
    for number, scene in enumerate(["A", "A", "B", "C"], 1):
        name = f"{SESSION}.rf.{number:06d}"
        Image.new("RGB", (1000, 600), (90, 90, 70)).save(root / "images" / f"{name}.jpg")
        (root / "labels" / f"{name}.txt").write_text("0 0.1 0.1 0.1 0.1\n", encoding="utf-8")
        rows.append(f"{name}.jpg\t{scene}\t1\t0")
    (root / "index.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    return root


def _sources(folder: Path) -> set[str]:
    """조각 이름에서 원본 사진 이름을 되찾는다."""
    return {p.name.split("__")[0].removesuffix(".jpg") for p in folder.iterdir()}


class TestBuildFold:
    def test_뺀_묶음은_학습에_한_장도_없다(self, labeled, tmp_path):
        out = tmp_path / "out"
        counts = tt.build_fold(labeled, out, "A", tile=600, overlap=0.0)
        assert counts["학습_사진"] == 2 and counts["평가_사진"] == 2
        train = _sources(out / "train" / "images")
        held = _sources(out / "heldout" / "images")
        assert train == {f"{SESSION}.rf.000003", f"{SESSION}.rf.000004"}
        assert held == {f"{SESSION}.rf.000001", f"{SESSION}.rf.000002"}
        assert not train & held

    def test_평가용은_조각내지_않은_원본이다(self, labeled, tmp_path):
        out = tmp_path / "out"
        tt.build_fold(labeled, out, "B", tile=600, overlap=0.0)
        held = sorted(p.name for p in (out / "heldout" / "images").iterdir())
        assert held == [f"{SESSION}.rf.000003.jpg"]
        assert (out / "heldout" / "labels" / f"{SESSION}.rf.000003.txt").exists()

    def test_학습에는_조각과_원본이_함께_든다(self, labeled, tmp_path):
        out = tmp_path / "out"
        counts = tt.build_fold(labeled, out, "C", tile=600, overlap=0.0)
        names = [p.name for p in (out / "train" / "images").iterdir()]
        assert counts["조각"] == 6  # 3장 × 2조각
        assert len(names) == 6 + 3
        assert len(list((out / "train" / "labels").iterdir())) == len(names)

    def test_전부_학습(self, labeled, tmp_path):
        out = tmp_path / "out"
        counts = tt.build_fold(labeled, out, None, tile=600, overlap=0.0)
        assert counts["학습_사진"] == 4 and counts["평가_사진"] == 0
        assert not (out / "heldout").exists()
        assert "train: train/images" in (out / "data.yaml").read_text(encoding="utf-8")

    def test_없는_묶음은_거부(self, labeled, tmp_path):
        with pytest.raises(ValueError, match="Z"):
            tt.build_fold(labeled, tmp_path / "out", "Z")

    def test_다시_만들면_이전_것을_지운다(self, labeled, tmp_path):
        out = tmp_path / "out"
        tt.build_fold(labeled, out, "A", tile=600, overlap=0.0)
        tt.build_fold(labeled, out, "B", tile=600, overlap=0.0)
        assert _sources(out / "heldout" / "images") == {f"{SESSION}.rf.000003"}


class TestCli:
    def test_자료만_만들기(self, labeled, tmp_path, capsys):
        code = tt.main(
            ["--labeled", str(labeled), "--out", str(tmp_path / "out"),
             "--holdout", "none", "--tile", "600", "--build-only"]
        )
        assert code == 0
        assert "학습 4장" in capsys.readouterr().out

    def test_없는_묶음이면_실패(self, labeled, tmp_path):
        code = tt.main(
            ["--labeled", str(labeled), "--out", str(tmp_path / "out"),
             "--holdout", "Z", "--build-only"]
        )
        assert code == 1

    def test_검증_분할로_모델을_고르지_않는다(self):
        assert tt.RECIPE["val"] is False
