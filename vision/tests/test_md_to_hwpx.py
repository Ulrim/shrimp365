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


def test_quote_blank_lines_split_paragraphs(tmp_path):
    """인용문 안의 빈 줄은 문단 경계다 — 편지 초안이 한 덩어리가 되면 못 읽는다."""
    md = "> 머리말\n>\n> 본문 첫째\n>\n> 본문 둘째\n"
    zf = build(md, tmp_path)
    sec = zf.read("Contents/section0.xml").decode()
    assert sec.count(f'paraPrIDRef="{conv.P_QUOTE}"') == 3
    joined = "".join(body_texts(zf))
    assert "머리말" in joined and "본문 첫째" in joined and "본문 둘째" in joined


def test_bullets_inside_a_quote_stand_alone(tmp_path):
    """인용 안의 글머리는 한 줄씩 서야 한다 — 편지의 문의 항목이 붙으면 안 읽힌다."""
    md = "> 문의 사항\n>\n> - 첫째 항목\n> - 둘째 항목\n"
    zf = build(md, tmp_path)
    sec = zf.read("Contents/section0.xml").decode()
    assert sec.count(f'paraPrIDRef="{conv.P_QUOTE}"') == 3
    joined = "".join(body_texts(zf))
    assert "· 첫째 항목" in joined.replace("  ", " ") or "첫째 항목" in joined
    assert "- 첫째" not in joined


# ── 그림 ───────────────────────────────────────────────────────────────────
def _png(width: int, height: int) -> bytes:
    """작은 PNG 를 직접 만든다 — 시험에 외부 패키지를 끌어오지 않는다."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def test_png_size_is_read_from_the_header():
    assert conv.image_size(_png(40, 25)) == (40, 25)


def test_image_is_embedded_and_referenced(tmp_path):
    """그림은 BinData 에 들어가고, 본문·목록이 같은 id 를 가리켜야 한다.

    한 곳이라도 어긋나면 한글이 그림을 못 찾아 빈 칸으로 열리거나 파일을 거부한다.
    """
    (tmp_path / "그림.png").write_bytes(_png(300, 200))
    doc = conv.Builder()
    conv.convert("# 제목\n\n![그림 1. 설명](그림.png)\n", doc, tmp_path)
    dest = tmp_path / "out.hwpx"
    conv.package(doc, "시험", dest)
    zf = zipfile.ZipFile(dest)

    assert any(n.startswith("BinData/") for n in zf.namelist())
    sec = zf.read("Contents/section0.xml").decode()
    assert sec.count("<hp:pic ") == 1
    used = set(re.findall(r'binaryItemIDRef="([^"]+)"', sec))
    hpf = zf.read("Contents/content.hpf").decode()
    declared = set(re.findall(r'<opf:item id="(image\d+)"', hpf))
    assert used == declared and used
    assert "BinData/" in zf.read("META-INF/manifest.xml").decode()
    assert "그림 1. 설명" in "".join(body_texts(zf))


def test_image_is_not_stretched_beyond_the_text_width(tmp_path):
    """원본이 본문 폭보다 크면 줄이고, 작으면 그대로 둔다(늘리면 흐려진다)."""
    (tmp_path / "큰.png").write_bytes(_png(4000, 2000))
    (tmp_path / "작은.png").write_bytes(_png(100, 50))
    doc = conv.Builder()
    conv.convert("![a](큰.png)\n\n![b](작은.png)\n", doc, tmp_path)
    widths = [int(w) for w in re.findall(r'<hp:sz width="(\d+)"', "".join(doc.body))]
    assert max(widths) <= conv.TEXT_W
    assert min(widths) < conv.TEXT_W


def test_no_images_mode_leaves_a_placeholder(tmp_path):
    (tmp_path / "그림.png").write_bytes(_png(10, 10))
    doc = conv.Builder()
    conv.convert("![그림 1. 설명](그림.png)\n", doc, tmp_path, images=False)
    dest = tmp_path / "out.hwpx"
    conv.package(doc, "시험", dest)
    zf = zipfile.ZipFile(dest)
    assert not any(n.startswith("BinData/") for n in zf.namelist())
    assert "그림 1. 설명" in "".join(body_texts(zf))


def test_missing_image_does_not_break_the_document(tmp_path):
    doc = conv.Builder()
    conv.convert("![없는 그림](없음.png)\n", doc, tmp_path)
    dest = tmp_path / "out.hwpx"
    conv.package(doc, "시험", dest)
    assert "없는 그림" in "".join(body_texts(zipfile.ZipFile(dest)))
