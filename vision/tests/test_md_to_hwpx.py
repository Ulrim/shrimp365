"""마크다운 → 한글(HWPX) 변환기 — 열리는 파일이 나오는지, 글이 보존되는지.

HWPX 는 한글이 열어 봐야 진짜로 확인되지만, 깨지는 경우의 대부분은 **파일을
열기도 전에** 판별된다 — mimetype 이 맨 앞에 압축 없이 들어갔는가, XML 이
올바른가, 필요한 조각이 다 있는가. 그 셋을 여기서 막는다.

글이 사라지거나 마크다운 기호가 그대로 남는 쪽도 함께 본다. 서류로 내는
문서라 `**굵게**` 가 글자 그대로 찍히면 그대로 제출된다.
"""
from __future__ import annotations

import importlib.util
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "md-to-hwpx.py"

_spec = importlib.util.spec_from_file_location("md_to_hwpx", MODULE_PATH)
conv = importlib.util.module_from_spec(_spec)
sys.modules["md_to_hwpx"] = conv
_spec.loader.exec_module(conv)


def build(markdown: str, tmp_path: Path) -> zipfile.ZipFile:
    doc = conv.Builder()
    conv.convert(markdown, doc)
    dest = tmp_path / "out.hwpx"
    conv.package(doc, "시험", dest)
    return zipfile.ZipFile(dest)


def body_texts(zf: zipfile.ZipFile) -> list[str]:
    sec = zf.read("Contents/section0.xml").decode()
    return re.findall(r"<hp:t>(.*?)</hp:t>", sec, re.S)


# ── 열리는 파일인가 ────────────────────────────────────────────────────────
def test_mimetype_is_first_and_uncompressed(tmp_path):
    """한글은 zip 의 첫 항목 mimetype 으로 파일 종류를 가린다. 압축하면 못 연다."""
    zf = build("# 제목\n\n본문\n", tmp_path)
    first = zf.infolist()[0]
    assert first.filename == "mimetype"
    assert first.compress_type == zipfile.ZIP_STORED
    assert zf.read("mimetype") == b"application/hwp+zip"


def test_all_required_parts_are_present(tmp_path):
    zf = build("# 제목\n", tmp_path)
    names = set(zf.namelist())
    for need in ("version.xml", "settings.xml", "META-INF/container.xml",
                 "META-INF/manifest.xml", "Contents/content.hpf",
                 "Contents/header.xml", "Contents/section0.xml"):
        assert need in names, need


def test_every_xml_part_parses(tmp_path):
    zf = build("# 제목\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n", tmp_path)
    for name in zf.namelist():
        if name.endswith((".xml", ".hpf")):
            ET.fromstring(zf.read(name).decode())


def test_section_properties_appear_once(tmp_path):
    """구역 설정이 두 번 들어가면 한글이 쪽 모양을 엉뚱하게 잡는다."""
    sec = build("# 제목\n\n본문\n\n## 둘\n\n본문\n", tmp_path).read(
        "Contents/section0.xml").decode()
    assert sec.count("<hp:secPr") == 1


def test_document_starting_with_a_table_still_has_section_properties(tmp_path):
    sec = build("| 가 | 나 |\n|---|---|\n| 1 | 2 |\n", tmp_path).read(
        "Contents/section0.xml").decode()
    assert sec.count("<hp:secPr") == 1


# ── 글이 보존되는가 ────────────────────────────────────────────────────────
def test_markdown_markers_do_not_survive_into_the_document(tmp_path):
    md = "본문 **굵게** 와 `코드` 와 [글](주소) 와 ~~취소~~ 입니다.\n"
    texts = body_texts(build(md, tmp_path))
    joined = "".join(texts)
    assert "굵게" in joined and "코드" in joined and "글" in joined and "취소" in joined
    assert "**" not in joined and "`" not in joined and "](" not in joined


def test_code_inside_bold_is_unwrapped(tmp_path):
    """`**`shrimp` 하나**` 처럼 겹쳐 있어도 기호가 남으면 안 된다."""
    texts = body_texts(build("클래스는 **`shrimp` 하나** 입니다.\n", tmp_path))
    joined = "".join(texts)
    assert "shrimp" in joined
    assert "`" not in joined and "*" not in joined


def test_code_inside_link_is_unwrapped(tmp_path):
    texts = body_texts(build("관련 [`계획.md`](계획.md) 참고\n", tmp_path))
    joined = "".join(texts)
    assert "계획.md" in joined
    assert "`" not in joined and "](" not in joined


def test_bold_spanning_two_lines_in_a_list_item(tmp_path):
    """목록 항목이 다음 줄로 이어질 때 굵게 표시가 짝을 잃으면 안 된다."""
    md = "1. 규칙으로 **앞서 작업한 것도\n   다시 확인**합니다.\n"
    joined = "".join(body_texts(build(md, tmp_path)))
    assert "앞서 작업한 것도 다시 확인" in joined
    assert "**" not in joined


def test_quote_spanning_two_lines_is_one_paragraph(tmp_path):
    md = "> 앞줄 **굵은\n> 뒷줄** 끝\n"
    joined = "".join(body_texts(build(md, tmp_path)))
    assert "굵은 뒷줄" in joined
    assert "**" not in joined


def test_code_block_is_kept_verbatim(tmp_path):
    """코드블록 안은 마크다운으로 해석하지 않는다 — 그림이 깨진다."""
    md = "```\n  ~~~~ 더듬이는 상자 밖 ~~~~\n```\n"
    joined = "".join(body_texts(build(md, tmp_path)))
    assert "~~~~ 더듬이는 상자 밖 ~~~~" in joined


# ── 표 ─────────────────────────────────────────────────────────────────────
def test_table_shape(tmp_path):
    md = "| 가 | 나 | 다 |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n"
    sec = build(md, tmp_path).read("Contents/section0.xml").decode()
    assert sec.count("<hp:tbl ") == 1
    assert 'rowCnt="3"' in sec and 'colCnt="3"' in sec
    assert sec.count("<hp:tc ") == 9


def test_ragged_table_rows_are_padded(tmp_path):
    """칸 수가 모자란 줄이 있어도 표가 깨지지 않아야 한다."""
    md = "| 가 | 나 | 다 |\n|---|---|---|\n| 1 |\n"
    sec = build(md, tmp_path).read("Contents/section0.xml").decode()
    assert sec.count("<hp:tc ") == 6


def test_heading_levels_use_different_sizes(tmp_path):
    sec = build("# 하나\n\n## 둘\n\n### 셋\n", tmp_path).read(
        "Contents/section0.xml").decode()
    for char_pr in (conv.H1, conv.H2, conv.H3):
        assert f'charPrIDRef="{char_pr}"' in sec


def test_strikethrough_is_actually_struck_through(tmp_path):
    """취소선을 평범한 글자로 떨구면 '끝난 일'이 남은 일처럼 읽힌다."""
    zf = build("| 날짜 | 할 일 |\n|---|---|\n| ~~11/13~~ | ~~기준 정리~~ 완료 |\n", tmp_path)
    sec = zf.read("Contents/section0.xml").decode()
    head = zf.read("Contents/header.xml").decode()
    assert f'charPrIDRef="{conv.STRIKE}"' in sec
    assert "<hh:strikeout" in head
    assert "~~" not in "".join(body_texts(zf))
