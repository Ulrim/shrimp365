"""여러 Roboflow YOLOv8 내보내기를 하나의 학습 데이터셋으로 합치는 도구.

구글 드라이브 `01. 흰다리새우 학습 데이터` 의 두 라벨 데이터셋을 그대로 쓸 수
없는 이유가 두 가지 있어서 이 스크립트가 필요하다.

1. **shrimp_cf 의 라벨은 바운딩 박스가 아니라 세그멘테이션 폴리곤이다.**
   한 줄이 `class x1 y1 x2 y2 ... x24 y24` (49개 필드) 꼴이다. 이걸 그대로
   `yolov8n.pt`(detect) 학습에 넣으면 좌표가 잘못 해석된다. 여기서 폴리곤의
   최소/최대 좌표로 박스를 만들어 `class xc yc w h` 로 바꾼다.
2. **클래스 이름이 서로 다르다.** shrimp_cf 는 `shrimp`, Counting PL 은
   `Shrimp-baby` 다. 둘 다 nc=1 이라 각자 클래스 인덱스가 0 이므로, 합치면
   서로 다른 대상이 같은 0 번이 된다. 기본값(`--merge-classes`)은 "새우는 새우"
   로 보고 단일 클래스로 합치고, `--stage-classes` 를 주면 성체/자어를 두
   클래스로 분리한다. 계수용 검출기(app/services/detector.py)는 클래스를
   구분하지 않고 박스 개수를 세므로 기본값이 운영과 맞는다.

추가로 학습 전에 반드시 봐야 하는 것들을 같이 검사한다.

- 이미지/라벨 짝 누락
- 좌표 범위 이탈, 폭·높이가 0 인 박스
- **분할 누수(leakage)**: 같은 원본 프레임이 train 과 valid 에 함께 있으면
  검증 점수가 부풀려진다. 파일 내용 해시와 Roboflow 원본 파일명(`.rf.` 앞부분)
  두 가지로 잡아낸다.

사용법:

    python ai/trainer/prepare_dataset.py \
        --source shrimp_cf=/content/drive/MyDrive/.../shrimp_cf.v1i.yolov8 \
        --source counting_pl=/content/drive/MyDrive/.../"Counting PL.v1i.yolov8" \
        --out datasets/shrimp

    # 빠른 점검만 (파일을 쓰지 않는다)
    python ai/trainer/prepare_dataset.py --source a=... --dry-run

무거운 의존성이 없다(표준 라이브러리만 쓴다). ultralytics/opencv/PIL 없이도 돈다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
# Roboflow 는 valid 를 'valid' 로 내보내지만 'val' 도 허용한다.
SPLIT_ALIASES = {"train": "train", "valid": "valid", "val": "valid", "test": "test"}
OUT_SPLITS = ("train", "valid", "test")

MERGED_CLASS = "shrimp"
# --stage-classes 에서 쓰는 성장 단계 분류. 원본 클래스 이름(소문자)으로 찾는다.
STAGE_CLASSES = ("shrimp", "shrimp_pl")
PL_CLASS_HINTS = ("baby", "larva", "postlarva", "post-larva", "pl", "seed", "자어", "치하")


# ---------------------------------------------------------------------------
# 라벨 변환
# ---------------------------------------------------------------------------


def polygon_to_bbox(coords: list[float]) -> tuple[float, float, float, float]:
    """폴리곤 좌표열 -> YOLO 박스(중심x, 중심y, 폭, 높이). 모두 0~1 정규화."""
    xs = coords[0::2]
    ys = coords[1::2]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    return ((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1)


def _clamp_box(
    xc: float, yc: float, w: float, h: float
) -> tuple[float, float, float, float] | None:
    """이미지 밖으로 나간 박스를 잘라 넣는다. 잘라서 사라지면 None."""
    x1 = max(0.0, min(1.0, xc - w / 2))
    x2 = max(0.0, min(1.0, xc + w / 2))
    y1 = max(0.0, min(1.0, yc - h / 2))
    y2 = max(0.0, min(1.0, yc + h / 2))
    w2, h2 = x2 - x1, y2 - y1
    if w2 <= 1e-6 or h2 <= 1e-6:
        return None
    return ((x1 + x2) / 2, (y1 + y2) / 2, w2, h2)


@dataclass
class LineIssue:
    kind: str
    detail: str


def convert_label_text(
    text: str, class_map: dict[int, int]
) -> tuple[list[str], Counter, list[LineIssue]]:
    """라벨 파일 한 개를 detect 형식으로 바꾼다.

    반환: (출력 줄들, 종류별 집계, 문제 목록).
    집계 키: bbox(원래 박스), polygon(폴리곤에서 변환), dropped(버린 것).
    """
    out: list[str] = []
    stats: Counter = Counter()
    issues: list[LineIssue] = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        try:
            cls_raw = int(float(parts[0]))
            values = [float(v) for v in parts[1:]]
        except (ValueError, IndexError):
            stats["dropped"] += 1
            issues.append(LineIssue("parse", line[:60]))
            continue

        if cls_raw not in class_map:
            stats["dropped"] += 1
            issues.append(LineIssue("class", f"알 수 없는 클래스 인덱스 {cls_raw}"))
            continue
        cls = class_map[cls_raw]

        if len(values) == 4:
            xc, yc, w, h = values
            kind = "bbox"
        elif len(values) >= 6 and len(values) % 2 == 0:
            xc, yc, w, h = polygon_to_bbox(values)
            kind = "polygon"
        else:
            stats["dropped"] += 1
            issues.append(LineIssue("arity", f"좌표 개수 {len(values)}"))
            continue

        # 자르기 전의 네 변을 먼저 본다. 중심이 안쪽이어도 변이 밖으로
        # 나간 박스가 흔하므로, 중심만 검사하면 잘린 사실을 놓친다.
        edges = (xc - w / 2, yc - h / 2, xc + w / 2, yc + h / 2)
        clamped = _clamp_box(xc, yc, w, h)
        if clamped is None:
            stats["dropped"] += 1
            issues.append(LineIssue("degenerate", f"{kind} 박스가 이미지 밖이거나 크기 0"))
            continue
        if any(v < -0.001 or v > 1.001 for v in edges):
            issues.append(LineIssue("out_of_range", f"{kind} 좌표를 0~1 로 잘라 넣었다"))

        xc, yc, w, h = clamped
        stats[kind] += 1
        out.append(f"{cls} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

    return out, stats, issues


# ---------------------------------------------------------------------------
# 원본 데이터셋 훑기
# ---------------------------------------------------------------------------


def frame_stem(name: str) -> str:
    """Roboflow 파일명에서 원본 프레임을 식별하는 부분만 남긴다.

    `IMG_0042_jpg.rf.9f8e....jpg` -> `IMG_0042_jpg`
    같은 원본 프레임의 증강 사본들은 이 값이 같으므로, train/valid 에 나뉘어
    들어간 경우를 잡을 수 있다.
    """
    base = Path(name).name
    marker = ".rf."
    if marker in base:
        return base.split(marker, 1)[0]
    return Path(base).stem


def read_source_classes(root: Path) -> list[str]:
    """원본 data.yaml 의 names 를 읽는다(PyYAML 없이 최소 파싱)."""
    yaml_path = root / "data.yaml"
    if not yaml_path.exists():
        return []
    for line in yaml_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped.startswith("names:"):
            continue
        value = stripped.split(":", 1)[1].strip()
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1]
            return [v.strip().strip("'\"") for v in inner.split(",") if v.strip()]
    return []


@dataclass
class Item:
    source: str
    split: str
    image: Path
    label: Path | None
    out_name: str
    stem: str
    digest: str = ""


@dataclass
class SourceInfo:
    name: str
    root: Path
    classes: list[str]
    splits: dict[str, int] = field(default_factory=dict)


def scan_source(name: str, root: Path, limit: int | None = None) -> tuple[SourceInfo, list[Item]]:
    if not root.is_dir():
        raise SystemExit(f"[오류] 데이터셋 경로가 없습니다: {root}")
    info = SourceInfo(name=name, root=root, classes=read_source_classes(root))
    items: list[Item] = []

    found_split = False
    for src_split, out_split in SPLIT_ALIASES.items():
        images_dir = root / src_split / "images"
        if not images_dir.is_dir():
            continue
        found_split = True
        labels_dir = root / src_split / "labels"
        names = sorted(
            p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES and p.is_file()
        )
        if limit:
            names = names[:limit]
        for image in names:
            label = labels_dir / f"{image.stem}.txt"
            items.append(
                Item(
                    source=name,
                    split=out_split,
                    image=image,
                    label=label if label.exists() else None,
                    out_name=f"{name}__{image.name}",
                    stem=f"{name}__{frame_stem(image.name)}",
                )
            )
        info.splits[out_split] = info.splits.get(out_split, 0) + len(names)

    if not found_split:
        raise SystemExit(
            f"[오류] {root} 안에 train/valid/test 중 어느 것도 없습니다.\n"
            "        Roboflow 'YOLOv8' 내보내기 폴더(압축 해제된 것)를 지정하세요."
        )
    return info, items


def file_digest(path: Path) -> str:
    digest = hashlib.blake2b(digest_size=16)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# 클래스 매핑
# ---------------------------------------------------------------------------


def _looks_like_pl(class_name: str) -> bool:
    low = class_name.lower().replace("_", "-")
    return any(hint in low for hint in PL_CLASS_HINTS)


def build_class_maps(
    sources: list[SourceInfo], stage_classes: bool
) -> tuple[list[str], dict[str, dict[int, int]]]:
    """원본별 {원본 클래스 인덱스: 출력 클래스 인덱스} 와 출력 names 를 만든다."""
    if not stage_classes:
        maps = {
            s.name: {i: 0 for i in range(max(len(s.classes), 1))} for s in sources
        }
        return [MERGED_CLASS], maps

    names = list(STAGE_CLASSES)
    maps: dict[str, dict[int, int]] = {}
    for source in sources:
        classes = source.classes or [MERGED_CLASS]
        maps[source.name] = {
            i: (1 if _looks_like_pl(cls) else 0) for i, cls in enumerate(classes)
        }
    return names, maps


# ---------------------------------------------------------------------------
# 누수 검사
# ---------------------------------------------------------------------------


@dataclass
class Leak:
    key: str
    kind: str  # "hash" | "frame"
    train_names: list[str]
    eval_names: list[str]


def find_leaks(items: list[Item], use_hash: bool) -> list[Leak]:
    """train 과 valid/test 에 동시에 들어간 프레임을 찾는다.

    같은 짝이 프레임 이름과 파일 해시 양쪽에 걸리는 경우가 흔하므로(증강 없는
    중복) 같은 이미지 묶음은 한 번만 보고한다.
    """
    leaks: list[Leak] = []
    seen: set[tuple[str, ...]] = set()
    for kind, key_of in (("frame", lambda i: i.stem), ("hash", lambda i: i.digest)):
        if kind == "hash" and not use_hash:
            continue
        buckets: dict[str, list[Item]] = {}
        for item in items:
            key = key_of(item)
            if not key:
                continue
            buckets.setdefault(key, []).append(item)
        for key, group in buckets.items():
            splits = {i.split for i in group}
            if "train" not in splits or not splits - {"train"}:
                continue
            fingerprint = tuple(sorted(i.out_name for i in group))
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            leaks.append(
                Leak(
                    key=key,
                    kind=kind,
                    train_names=[i.out_name for i in group if i.split == "train"],
                    eval_names=[i.out_name for i in group if i.split != "train"],
                )
            )
    return leaks


def _canonical_groups(items: list[Item]) -> dict[str, str]:
    """프레임 이름으로 묶고, 파일 내용이 같은 묶음끼리 다시 합친다.

    증강 사본은 프레임 이름이 같고, 이름이 달라도 바이트가 같은 중복이 있을 수
    있다. 둘 다 한 덩어리로 묶어야 재분할 뒤에도 누수가 남지 않는다.
    """
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            root = min(ra, rb)
            parent[ra] = root
            parent[rb] = root

    for item in items:
        find(item.stem)
    by_digest: dict[str, str] = {}
    for item in items:
        if not item.digest:
            continue
        if item.digest in by_digest:
            union(by_digest[item.digest], item.stem)
        else:
            by_digest[item.digest] = item.stem
    return {item.stem: find(item.stem) for item in items}


def regroup_splits(items: list[Item], seed: int = 20260101) -> dict:
    """같은 원본 프레임의 사본을 한 분할에 몰아넣어 누수를 없앤다.

    train 에서 덜어내는 `drop` 과 달리 **한 장도 버리지 않는다.** shrimp_cf 처럼
    증강한 뒤에 분할한 데이터셋은 사본이 train 과 valid 에 흩어져 있어서, 버리는
    방식으로는 학습 데이터가 크게 줄어든다(실제로 3,927장 -> 1,469장이 되었다).

    원본별로 따로 다시 나눠 각 데이터셋의 train/valid/test 비율을 지킨다.
    같은 입력에 대해 항상 같은 결과가 나오도록 씨앗을 고정한다.
    """
    canonical = _canonical_groups(items)
    moved = 0
    groups_total = 0

    by_source: dict[str, list[Item]] = {}
    for item in items:
        by_source.setdefault(item.source, []).append(item)

    for source, source_items in sorted(by_source.items()):
        ratios = Counter(i.split for i in source_items)
        total = sum(ratios.values())
        targets = {s: ratios.get(s, 0) / total for s in OUT_SPLITS}

        groups: dict[str, list[Item]] = {}
        for item in source_items:
            groups.setdefault(canonical[item.stem], []).append(item)
        groups_total += len(groups)

        keys = sorted(groups)
        random.Random(f"{seed}:{source}").shuffle(keys)
        # 큰 묶음부터 넣어야 마지막에 비율이 크게 틀어지지 않는다.
        keys.sort(key=lambda k: -len(groups[k]))

        filled = {s: 0 for s in OUT_SPLITS}
        for key in keys:
            # 목표 대비 가장 덜 찬 분할에 통째로 넣는다(목표가 0 인 분할은 제외).
            candidates = [s for s in OUT_SPLITS if targets[s] > 0]
            chosen = min(candidates, key=lambda s: (filled[s] / targets[s], s))
            for item in groups[key]:
                if item.split != chosen:
                    item.split = chosen
                    moved += 1
                filled[chosen] += 1

    return {"groups": groups_total, "moved": moved}


# ---------------------------------------------------------------------------
# 쓰기
# ---------------------------------------------------------------------------


def write_dataset(
    out_root: Path,
    items: list[Item],
    class_maps: dict[str, dict[int, int]],
    link: bool,
) -> dict:
    kinds: Counter = Counter()
    issues: Counter = Counter()
    per_split: dict[str, Counter] = {s: Counter() for s in OUT_SPLITS}
    objects_per_image: dict[str, list[int]] = {s: [] for s in OUT_SPLITS}

    for split in OUT_SPLITS:
        (out_root / split / "images").mkdir(parents=True, exist_ok=True)
        (out_root / split / "labels").mkdir(parents=True, exist_ok=True)

    for item in items:
        out_image = out_root / item.split / "images" / item.out_name
        out_label = out_root / item.split / "labels" / f"{Path(item.out_name).stem}.txt"

        if out_image.exists() or out_image.is_symlink():
            out_image.unlink()
        if link:
            os.symlink(item.image.resolve(), out_image)
        else:
            shutil.copy2(item.image, out_image)

        if item.label is None:
            lines: list[str] = []
            issues["missing_label"] += 1
        else:
            text = item.label.read_text(encoding="utf-8", errors="replace")
            lines, stats, line_issues = convert_label_text(text, class_maps[item.source])
            kinds.update(stats)
            for issue in line_issues:
                issues[issue.kind] += 1
        out_label.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

        per_split[item.split]["images"] += 1
        per_split[item.split]["objects"] += len(lines)
        if not lines:
            per_split[item.split]["empty"] += 1
        objects_per_image[item.split].append(len(lines))

    return {
        "label_kinds": dict(kinds),
        "issues": dict(issues),
        "splits": {s: dict(c) for s, c in per_split.items()},
        "objects_per_image": {
            s: _describe(v) for s, v in objects_per_image.items() if v
        },
    }


def _describe(values: list[int]) -> dict:
    ordered = sorted(values)
    n = len(ordered)

    def pct(p: float) -> int:
        return ordered[min(n - 1, int(p * n))]

    return {
        "n": n,
        "min": ordered[0],
        "p25": pct(0.25),
        "median": pct(0.5),
        "p75": pct(0.75),
        "p95": pct(0.95),
        "max": ordered[-1],
        "mean": round(sum(ordered) / n, 2),
    }


def write_data_yaml(out_root: Path, names: list[str]) -> Path:
    path = out_root / "data.yaml"
    rendered = ", ".join(f"'{n}'" for n in names)
    has_test = any((out_root / "test" / "images").glob("*"))
    lines = [
        "# prepare_dataset.py 가 생성한 파일입니다. 직접 고치지 마세요.",
        f"path: {out_root.resolve()}",
        "train: train/images",
        "val: valid/images",
    ]
    if has_test:
        lines.append("test: test/images")
    lines += ["", f"nc: {len(names)}", f"names: [{rendered}]", ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Roboflow YOLOv8 내보내기 여러 개를 학습용 데이터셋으로 합친다",
    )
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="원본 데이터셋. 여러 번 줄 수 있다. 예: shrimp_cf=/data/shrimp_cf.v1i.yolov8",
    )
    parser.add_argument("--out", default="datasets/shrimp", help="출력 데이터셋 경로")
    parser.add_argument(
        "--stage-classes",
        action="store_true",
        help="성체(shrimp)/자어(shrimp_pl) 두 클래스로 분리한다. 기본은 단일 클래스 병합",
    )
    parser.add_argument(
        "--link",
        action="store_true",
        help="이미지를 복사하지 않고 심볼릭 링크로 만든다(디스크 절약, 학습은 느려진다)",
    )
    parser.add_argument(
        "--no-hash",
        action="store_true",
        help="파일 내용 해시 검사를 생략한다(드라이브에서 느릴 때)",
    )
    parser.add_argument(
        "--on-leakage",
        choices=("report", "drop", "regroup"),
        default="report",
        help=(
            "train 과 valid/test 에 같은 프레임이 있을 때. "
            "report=보고만, drop=train 쪽을 뺀다, "
            "regroup=프레임 단위로 다시 나눈다(한 장도 버리지 않는다, 권장)"
        ),
    )
    parser.add_argument("--limit", type=int, default=None, help="원본 분할별 이미지 상한(연습용)")
    parser.add_argument("--dry-run", action="store_true", help="검사만 하고 파일을 쓰지 않는다")
    parser.add_argument("--report", default=None, help="검사 결과 JSON 을 저장할 경로")
    return parser.parse_args(argv)


def _parse_sources(raw: list[str]) -> list[tuple[str, Path]]:
    if not raw:
        raise SystemExit("[오류] --source NAME=PATH 를 최소 한 개 지정하세요.")
    out: list[tuple[str, Path]] = []
    for entry in raw:
        if "=" not in entry:
            raise SystemExit(f"[오류] --source 형식이 NAME=PATH 가 아닙니다: {entry}")
        name, path = entry.split("=", 1)
        name = name.strip()
        if not name.replace("_", "").isalnum():
            raise SystemExit(f"[오류] 원본 이름은 영문/숫자/밑줄만 쓰세요: {name}")
        out.append((name, Path(path.strip()).expanduser()))
    return out


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sources = _parse_sources(args.source)

    infos: list[SourceInfo] = []
    items: list[Item] = []
    for name, root in sources:
        info, source_items = scan_source(name, root, limit=args.limit)
        infos.append(info)
        items.extend(source_items)
        classes = ", ".join(info.classes) or "(data.yaml 없음)"
        counts = ", ".join(f"{s}={n}" for s, n in sorted(info.splits.items()))
        print(f"[원본] {name}: {counts} / 클래스 [{classes}]")

    names, class_maps = build_class_maps(infos, args.stage_classes)
    print(f"[클래스] nc={len(names)} names={names}")
    for info in infos:
        mapping = {
            (info.classes[i] if i < len(info.classes) else i): names[j]
            for i, j in sorted(class_maps[info.name].items())
        }
        print(f"         {info.name}: {mapping}")

    use_hash = not args.no_hash
    if use_hash:
        print(f"[검사] 파일 해시 계산 중 ({len(items)}장)...")
        for item in items:
            item.digest = file_digest(item.image)

    leaks = find_leaks(items, use_hash)
    dropped_leak = 0
    regrouped: dict | None = None
    if leaks:
        print(f"[경고] 분할 누수 {len(leaks)}건 — 같은 프레임이 train 과 valid/test 에 함께 있음")
        for leak in leaks[:10]:
            print(f"        ({leak.kind}) {leak.train_names[0]} ↔ {leak.eval_names[0]}")
        if len(leaks) > 10:
            print(f"        ... 외 {len(leaks) - 10}건")
        if args.on_leakage == "drop":
            drop_names = {n for leak in leaks for n in leak.train_names}
            before = len(items)
            items = [i for i in items if not (i.split == "train" and i.out_name in drop_names)]
            dropped_leak = before - len(items)
            print(f"        -> train 에서 {dropped_leak}장 제외했습니다(검증 점수 보호).")
        elif args.on_leakage == "regroup":
            stats = regroup_splits(items)
            regrouped = stats
            print(
                f"        -> 프레임 {stats['groups']}묶음 기준으로 다시 나눴습니다"
                f" ({stats['moved']}장 이동, 버린 것 없음)."
            )
            remaining = find_leaks(items, use_hash)
            if remaining:
                print(
                    f"[오류] 재분할 뒤에도 누수가 {len(remaining)}건 남았습니다.",
                    file=sys.stderr,
                )
                return 1
            print("        -> 재검사: 누수 0건")
            counts = Counter(i.split for i in items)
            print(f"        -> 새 분할: {dict(sorted(counts.items()))}")
    else:
        print("[검사] 분할 누수 없음")

    out_root = Path(args.out).expanduser()
    report: dict = {
        "sources": [
            {"name": i.name, "root": str(i.root), "classes": i.classes, "splits": i.splits}
            for i in infos
        ],
        "names": names,
        "leaks": len(leaks),
        "leak_examples": [
            {"kind": k.kind, "train": k.train_names[:3], "eval": k.eval_names[:3]}
            for k in leaks[:20]
        ],
        "leak_dropped_from_train": dropped_leak,
        "regrouped": regrouped,
        "dry_run": bool(args.dry_run),
    }

    if args.dry_run:
        print("[dry-run] 파일을 쓰지 않고 종료합니다.")
    else:
        stats = write_dataset(out_root, items, class_maps, link=args.link)
        report.update(stats)
        yaml_path = write_data_yaml(out_root, names)
        kinds = stats["label_kinds"]
        print(
            "[변환] 폴리곤→박스 {poly}개, 원래 박스 {bbox}개, 버린 것 {drop}개".format(
                poly=kinds.get("polygon", 0),
                bbox=kinds.get("bbox", 0),
                drop=kinds.get("dropped", 0),
            )
        )
        for split in OUT_SPLITS:
            row = stats["splits"].get(split, {})
            if row.get("images"):
                per = stats["objects_per_image"].get(split, {})
                print(
                    f"[{split:5}] 이미지 {row['images']}장, 객체 {row['objects']}개, "
                    f"라벨 없는 이미지 {row.get('empty', 0)}장, "
                    f"장당 중앙값 {per.get('median')} 최대 {per.get('max')}"
                )
        if stats["issues"]:
            print(f"[문제] {stats['issues']}")
        print(f"[완료] {yaml_path}")
        print(f"        학습: python ai/trainer/train.py --data {yaml_path} --epochs 100")

    if args.report:
        Path(args.report).expanduser().write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[보고서] {args.report}")

    if not args.dry_run and not any(
        report.get("splits", {}).get(s, {}).get("images") for s in ("train",)
    ):
        print("[오류] train 이미지가 0장입니다.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
