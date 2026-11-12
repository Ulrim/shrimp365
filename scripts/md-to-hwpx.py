#!/usr/bin/env python3
"""마크다운 문서를 한글(HWPX)로 바꾼다 — 표준 라이브러리만 쓴다.

왜 직접 만드나. 제출 서류는 한글 파일로 내야 하는데, 저장소의 문서는 마크다운
이다. 매번 손으로 옮겨 적으면 고칠 때마다 둘이 어긋난다. 마크다운을 원본으로
두고 필요할 때 변환한다.

HWPX 는 OWPML(KS X 6101) 을 담은 zip 이다. 외부 패키지 없이 그 구조를 직접
쓴다 — 변환기 하나 때문에 의존성을 늘리지 않는다.

    python scripts/md-to-hwpx.py docs/라벨링_기준.md -o out/라벨링_기준.hwpx

다루는 마크다운
  제목 # ## ### ####   문단   굵게 **..**   코드 `..`   코드블록 ```
  표 | a | b |         글머리 - *          번호 1.      인용 >
  가로줄 ---           링크 [글](주소)     취소선 ~~..~~

HWPUNIT = 1/7200 인치. 글자 크기는 1/100 pt.
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

# ── 단위 ───────────────────────────────────────────────────────────────────
MM = 7200 / 25.4                      # 1mm 가 몇 HWPUNIT 인가
PAGE_W, PAGE_H = round(210 * MM), round(297 * MM)
MARGIN = round(20 * MM)
HEADER_FOOTER = round(10 * MM)
TEXT_W = PAGE_W - MARGIN * 2

# charPr id
BODY, BOLD, CODE, H1, H2, H3, SMALL, TH, STRIKE = range(9)
# paraPr id
P_BODY, P_HEAD, P_LIST, P_CODE, P_CELL, P_QUOTE, P_FIG = range(7)

FONTS = ("함초롬바탕", "함초롬돋움", "D2Coding")
LANGS = ("HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER")


def image_size(raw: bytes) -> tuple[int, int]:
    """PNG·JPEG 의 픽셀 크기를 헤더에서 직접 읽는다 — 외부 패키지를 쓰지 않는다."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    if raw[:2] == b"\xff\xd8":                       # JPEG: SOF 조각을 찾는다
        i = 2
        while i + 9 < len(raw):
            if raw[i] != 0xFF:
                i += 1
                continue
            marker, size = raw[i + 1], int.from_bytes(raw[i + 2:i + 4], "big")
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                return (int.from_bytes(raw[i + 7:i + 9], "big"),
                        int.from_bytes(raw[i + 5:i + 7], "big"))
            i += 2 + size
    raise ValueError("PNG 또는 JPEG 만 넣을 수 있습니다")


def xml_header() -> str:
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


# ── 인라인 ─────────────────────────────────────────────────────────────────
INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|~~.+?~~|\[[^\]]+\]\([^)]*\))")


def inline_runs(text: str, base: int) -> list[tuple[int, str]]:
    """문장을 (글자모양, 글) 조각으로 나눈다. 굵게·코드만 모양이 달라진다."""
    out: list[tuple[int, str]] = []
    for piece in INLINE.split(text):
        if not piece:
            continue
        if piece.startswith("**") and piece.endswith("**"):
            # 굵게 안에 코드가 또 들어 있을 수 있다(`**`shrimp` 하나**`).
            out.extend(inline_runs(piece[2:-2], BOLD if base == BODY else base))
        elif piece.startswith("`") and piece.endswith("`"):
            out.append((CODE, piece[1:-1]))
        elif piece.startswith("~~") and piece.endswith("~~"):
            # 취소선을 평범한 글자로 떨구면 '끝난 일'이 아직 남은 일처럼 읽힌다.
            out.append((STRIKE, "".join(t for _, t in inline_runs(piece[2:-2], base))))
        elif piece.startswith("["):
            m = re.match(r"\[([^\]]+)\]\(([^)]*)\)", piece)
            # 링크 글자 안에 코드가 들어 있을 수 있다(`[`파일.md`](파일.md)`).
            out.extend(inline_runs(m.group(1), base) if m else [(base, piece)])
        else:
            out.append((base, piece))
    return out or [(base, "")]


# ── 문서 조각 ──────────────────────────────────────────────────────────────
class Builder:
    def __init__(self) -> None:
        self.body: list[str] = []
        self._pid = 0
        self._tbl = 0
        self._shape = 0
        self.images: dict[str, tuple[str, bytes]] = {}   # id -> (파일이름, 내용)
        self.plain: list[str] = []

    # 한 문단
    def para(self, runs: list[tuple[int, str]], para_pr: int = P_BODY,
             *, first: bool = False) -> None:
        self._pid += 1
        chunks = []
        if first:
            chunks.append(f'<hp:run charPrIDRef="{BODY}">{self._sec_pr()}</hp:run>')
        for char_pr, text in runs:
            if text == "":
                chunks.append(f'<hp:run charPrIDRef="{char_pr}"/>')
            else:
                chunks.append(f'<hp:run charPrIDRef="{char_pr}">'
                              f"<hp:t>{escape(text)}</hp:t></hp:run>")
        self.body.append(
            f'<hp:p id="{self._pid}" paraPrIDRef="{para_pr}" styleIDRef="0"'
            f' pageBreak="0" columnBreak="0" merged="0">'
            + "".join(chunks) + self._lineseg() + "</hp:p>"
        )
        self.plain.append("".join(t for _, t in runs))

    def _lineseg(self) -> str:
        return ('<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"'
                ' textheight="1000" baseline="850" spacing="600" horzpos="0"'
                f' horzsize="{TEXT_W}" flags="393216"/></hp:linesegarray>')

    def _sec_pr(self) -> str:
        return (
            '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134"'
            ' tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1"'
            ' memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">'
            '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0" strtnum="0"/>'
            '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
            '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0"'
            ' border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0"'
            ' showLineNumber="0"/>'
            f'<hp:pagePr landscape="WIDELY" width="{PAGE_W}" height="{PAGE_H}"'
            ' gutterType="LEFT_ONLY">'
            f'<hp:margin header="{HEADER_FOOTER}" footer="{HEADER_FOOTER}" gutter="0"'
            f' left="{MARGIN}" right="{MARGIN}" top="{MARGIN}" bottom="{MARGIN}"/>'
            '</hp:pagePr>'
            '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar=""'
            ' suffixChar=")" supescript="0"/><hp:noteLine length="-1" type="SOLID"'
            ' width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283"'
            ' belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS"'
            ' newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/>'
            '</hp:footNotePr>'
            '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar=""'
            ' suffixChar=")" supescript="0"/><hp:noteLine length="14692" type="SOLID"'
            ' width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0"'
            ' belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS"'
            ' newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/>'
            '</hp:endNotePr>'
            + "".join(
                f'<hp:pageBorderFill type="{t}" borderFillIDRef="1" textBorder="PAPER"'
                ' headerInside="0" footerInside="0" fillArea="PAPER">'
                '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>'
                '</hp:pageBorderFill>' for t in ("BOTH", "EVEN", "ODD"))
            + "</hp:secPr>"
        )

    # 그림
    def picture(self, path: Path, caption: str) -> None:
        raw = path.read_bytes()
        px_w, px_h = image_size(raw)
        # 본문 폭에 맞춰 줄인다. 원본이 더 작으면 그대로 둔다(늘리면 흐려진다).
        width = min(TEXT_W, round(px_w * 7200 / 96))
        height = round(width * px_h / px_w)
        self._shape += 1
        img_id = f"image{self._shape}"
        self.images[img_id] = (f"{img_id}{path.suffix.lower()}", raw)
        pic = (
            f'<hp:pic id="{self._shape}" zOrder="{self._shape - 1}"'
            ' numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES"'
            f' lock="0" dropcapstyle="None" href="" groupLevel="0" instid="{self._shape}"'
            ' reverse="0">'
            f'<hp:sz width="{width}" widthRelTo="ABSOLUTE" height="{height}"'
            ' heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"'
            ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"'
            ' horzAlign="CENTER" vertOffset="0" horzOffset="0"/>'
            '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            '<hp:offset x="0" y="0"/>'
            f'<hp:orgSz width="{width}" height="{height}"/>'
            f'<hp:curSz width="{width}" height="{height}"/>'
            '<hp:flip horizontal="0" vertical="0"/>'
            '<hp:rotationInfo angle="0" centerX="0" centerY="0" rotateimage="1"/>'
            '<hp:renderingInfo>'
            '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '</hp:renderingInfo>'
            f'<hc:img binaryItemIDRef="{img_id}" bright="0" contrast="0"'
            ' effect="REAL_PIC" alpha="0.0"/>'
            '<hp:imgRect><hc:pt0 x="0" y="0"/>'
            f'<hc:pt1 x="{width}" y="0"/><hc:pt2 x="{width}" y="{height}"/>'
            f'<hc:pt3 x="0" y="{height}"/></hp:imgRect>'
            f'<hp:imgClip left="0" right="{px_w}" top="0" bottom="{px_h}"/>'
            '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:imgDim dimwidth="{px_w}" dimheight="{px_h}"/>'
            "</hp:pic>")
        self._pid += 1
        self.body.append(
            f'<hp:p id="{self._pid}" paraPrIDRef="{P_FIG}" styleIDRef="0"'
            ' pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{BODY}">{pic}</hp:run>'
            + self._lineseg() + "</hp:p>")
        self.plain.append(f"[그림] {caption}")
        if caption:
            self.para(inline_runs(caption, SMALL), P_FIG)

    # 표
    def table(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        cols = max(len(r) for r in rows)
        rows = [r + [""] * (cols - len(r)) for r in rows]
        col_w = TEXT_W // cols
        row_h = round(7 * MM)
        self._tbl += 1
        self._pid += 1
        trs = []
        for ri, row in enumerate(rows):
            tcs = []
            for ci, cell in enumerate(row):
                is_head = ri == 0
                cell_pid = f"{self._tbl}{ri}{ci}"
                runs = inline_runs(cell.strip(), TH if is_head else BODY)
                inner = "".join(
                    f'<hp:run charPrIDRef="{cp}"><hp:t>{escape(tx)}</hp:t></hp:run>'
                    if tx else f'<hp:run charPrIDRef="{cp}"/>' for cp, tx in runs)
                tcs.append(
                    f'<hp:tc name="" header="{1 if is_head else 0}" hasMargin="0"'
                    f' protect="0" editable="0" dirty="0" borderFillIDRef="{3 if is_head else 1}">'
                    f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK"'
                    ' vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0"'
                    ' textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                    f'<hp:p id="{cell_pid}" paraPrIDRef="{P_CELL}" styleIDRef="0"'
                    ' pageBreak="0" columnBreak="0" merged="0">'
                    + inner + self._lineseg() + "</hp:p></hp:subList>"
                    f'<hp:cellAddr colAddr="{ci}" rowAddr="{ri}"/>'
                    '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                    f'<hp:cellSz width="{col_w}" height="{row_h}"/>'
                    '<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                    "</hp:tc>")
            trs.append("<hp:tr>" + "".join(tcs) + "</hp:tr>")
        tbl = (
            f'<hp:tbl id="{self._tbl}" zOrder="0" numberingType="TABLE"'
            ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0"'
            ' dropcapstyle="None" pageBreak="CELL" repeatHeader="1"'
            f' rowCnt="{len(rows)}" colCnt="{cols}" cellSpacing="0"'
            ' borderFillIDRef="1" noAdjust="0">'
            f'<hp:sz width="{col_w * cols}" widthRelTo="ABSOLUTE"'
            f' height="{row_h * len(rows)}" heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"'
            ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"'
            ' horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
            '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            '<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
            + "".join(trs) + "</hp:tbl>")
        self._pid += 1
        self.body.append(
            f'<hp:p id="{self._pid}" paraPrIDRef="{P_BODY}" styleIDRef="0"'
            ' pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{BODY}">{tbl}</hp:run>'
            + self._lineseg() + "</hp:p>")
        for r in rows:                      # 미리보기에도 표시 기호가 남지 않게
            self.plain.append(" | ".join(
                "".join(t for _, t in inline_runs(c.strip(), BODY)) for c in r))


# ── 머리글(글자모양·문단모양 정의) ─────────────────────────────────────────
def header_xml() -> str:
    faces = []
    for lang in LANGS:
        fonts = "".join(
            f'<hh:font id="{i}" face={quoteattr(name)} type="TTF" isEmbedded="0">'
            '<hh:typeInfo familyType="FCAT_GOTHIC" weight="0" proportion="0"'
            ' contrast="0" strokeVariation="0" armStyle="0" letterform="0"'
            ' midline="0" xHeight="0"/></hh:font>'
            for i, name in enumerate(FONTS))
        faces.append(f'<hh:fontface lang="{lang}" fontCnt="{len(FONTS)}">{fonts}</hh:fontface>')

    def char_pr(idx: int, height: int, *, bold: bool = False, font: int = 0,
                color: str = "#000000", shade: str = "none",
                strike: bool = False) -> str:
        ref = (f'<hh:fontRef hangul="{font}" latin="{font}" hanja="{font}"'
               f' japanese="{font}" other="{font}" symbol="{font}" user="{font}"/>')
        ratio = ('<hh:ratio hangul="100" latin="100" hanja="100" japanese="100"'
                 ' other="100" symbol="100" user="100"/>')
        spacing = ('<hh:spacing hangul="0" latin="0" hanja="0" japanese="0"'
                   ' other="0" symbol="0" user="0"/>')
        rel = ('<hh:relSz hangul="100" latin="100" hanja="100" japanese="100"'
               ' other="100" symbol="100" user="100"/>')
        off = ('<hh:offset hangul="0" latin="0" hanja="0" japanese="0"'
               ' other="0" symbol="0" user="0"/>')
        return (f'<hh:charPr id="{idx}" height="{height}" textColor="{color}"'
                f' shadeColor="{shade}" useFontSpace="0" useKerning="0" symMark="NONE"'
                ' borderFillIDRef="2">' + ref + ratio + spacing + rel + off
                + ("<hh:bold/>" if bold else "")
                + ('<hh:strikeout type="SOLID" shape="SOLID" color="#000000"/>'
                   if strike else "")
                + "</hh:charPr>")

    chars = "".join([
        char_pr(BODY, 1000),
        char_pr(BOLD, 1000, bold=True),
        char_pr(CODE, 900, font=2, color="#1F2937"),
        char_pr(H1, 1800, bold=True, font=1),
        char_pr(H2, 1400, bold=True, font=1),
        char_pr(H3, 1150, bold=True, font=1),
        char_pr(SMALL, 900, color="#555555"),
        char_pr(TH, 1000, bold=True, font=1),
        char_pr(STRIKE, 1000, color="#777777", strike=True),
    ])

    def para_pr(idx: int, *, left: int = 0, indent: int = 0, before: int = 0,
                after: int = 0, spacing: int = 160, align: str = "JUSTIFY") -> str:
        return (f'<hh:paraPr id="{idx}" tabPrIDRef="0" condense="0"'
                ' fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">'
                f'<hh:align horizontal="{align}" vertical="BASELINE"/>'
                '<hh:heading type="NONE" idRef="0" level="0"/>'
                '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD"'
                ' widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0"'
                ' lineWrap="BREAK"/>'
                '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
                f'<hh:switch><hh:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">'
                f'<hh:margin><hc:intent value="{indent}" unit="HWPUNIT"/>'
                f'<hc:left value="{left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/>'
                f'<hc:prev value="{before}" unit="HWPUNIT"/>'
                f'<hc:next value="{after}" unit="HWPUNIT"/></hh:margin>'
                f'<hh:lineSpacing type="PERCENT" value="{spacing}" unit="HWPUNIT"/>'
                '</hh:case><hh:default>'
                f'<hh:margin><hc:intent value="{indent}" unit="HWPUNIT"/>'
                f'<hc:left value="{left}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/>'
                f'<hc:prev value="{before}" unit="HWPUNIT"/>'
                f'<hc:next value="{after}" unit="HWPUNIT"/></hh:margin>'
                f'<hh:lineSpacing type="PERCENT" value="{spacing}" unit="HWPUNIT"/>'
                '</hh:default></hh:switch>'
                '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0"'
                ' offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>'
                '</hh:paraPr>')

    paras = "".join([
        para_pr(P_BODY, after=300),
        para_pr(P_HEAD, before=700, after=300, align="LEFT"),
        para_pr(P_LIST, left=1200, indent=-600, after=120),
        para_pr(P_CODE, left=800, after=0, spacing=130, align="LEFT"),
        para_pr(P_CELL, after=0, spacing=140, align="LEFT"),
        para_pr(P_QUOTE, left=1000, after=300),
        para_pr(P_FIG, before=200, after=300, align="CENTER"),
    ])

    def border_fill(idx: int, *, line: bool, fill: str | None) -> str:
        edge = ('type="SOLID" width="0.12 mm" color="#000000"' if line
                else 'type="NONE" width="0.1 mm" color="#000000"')
        body = (f'<hc:fillBrush><hc:winBrush faceColor="{fill}" hatchColor="#000000"'
                ' alpha="0"/></hc:fillBrush>' if fill else "")
        return (f'<hh:borderFill id="{idx}" threeD="0" shadow="0" centerLine="NONE"'
                ' breakCellSeparateLine="0">'
                '<hh:slash type="NONE" Crooked="0" isCounter="0"/>'
                '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
                f'<hh:leftBorder {edge}/><hh:rightBorder {edge}/>'
                f'<hh:topBorder {edge}/><hh:bottomBorder {edge}/>'
                '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>'
                + body + "</hh:borderFill>")

    fills = "".join([
        border_fill(0, line=False, fill=None),
        border_fill(1, line=True, fill=None),
        border_fill(2, line=False, fill=None),
        border_fill(3, line=True, fill="#EFEFEF"),
    ])

    return (
        xml_header()
        + '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'
        ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
        ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"'
        ' version="1.4" secCnt="1">'
        '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>'
        '<hh:refList>'
        f'<hh:fontfaces itemCnt="{len(LANGS)}">' + "".join(faces) + "</hh:fontfaces>"
        '<hh:borderFills itemCnt="4">' + fills + "</hh:borderFills>"
        '<hh:charProperties itemCnt="9">' + chars + "</hh:charProperties>"
        '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/>'
        "</hh:tabProperties>"
        '<hh:paraProperties itemCnt="7">' + paras + "</hh:paraProperties>"
        '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글"'
        ' engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0"'
        ' langID="1042" lockForm="0"/></hh:styles>'
        "</hh:refList></hh:head>"
    )


# ── 마크다운 읽기 ──────────────────────────────────────────────────────────
HEAD_CHARPR = {1: H1, 2: H2, 3: H3, 4: H3}
BULLET = re.compile(r"^(\s*)[-*]\s+(.*)$")
NUMBER = re.compile(r"^(\s*)(\d+)\.\s+(.*)$")
TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$")


def split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def _item_text(lines: list[str], i: int, head: str) -> tuple[str, int]:
    """목록 한 항목의 글을 모은다 — 다음 줄로 이어진 경우를 포함해서.

    줄 단위로 끊으면 줄을 넘나드는 **굵게** 가 짝을 잃어 별표가 그대로 남는다.
    """
    parts = [head]
    i += 1
    while i < len(lines):
        nxt = lines[i]
        if (not nxt.strip() or BULLET.match(nxt) or NUMBER.match(nxt)
                or nxt.lstrip().startswith(("#", ">", "|", "```"))
                or (nxt.lstrip().startswith("---") and set(nxt.strip()) <= {"-"})):
            break
        parts.append(nxt.strip())
        i += 1
    return " ".join(p for p in parts if p), i


IMAGE = re.compile(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$")


def convert(markdown: str, doc: Builder, base: Path | None = None,
            *, images: bool = True) -> None:
    lines = markdown.splitlines()
    i, first = 0, True
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf, first
        if buf:
            doc.para(inline_runs(" ".join(buf), BODY), P_BODY, first=first)
            first = False
            buf = []

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()

        if line.startswith("```"):                       # 코드블록
            flush()
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            for text in block or [""]:
                doc.para([(CODE, text)], P_CODE, first=first)
                first = False
            doc.para([(BODY, "")], P_BODY)
            continue

        if (line.lstrip().startswith("|") and i + 1 < len(lines)
                and TABLE_SEP.match(lines[i + 1]) and "|" in lines[i + 1]):
            flush()
            rows = [split_row(line)]
            i += 2
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            if first:                                    # 표가 맨 앞이면 빈 문단으로 구역 설정
                doc.para([(BODY, "")], P_BODY, first=True)
                first = False
            doc.table(rows)
            doc.para([(BODY, "")], P_BODY)
            continue

        m = IMAGE.match(line.strip())
        if m:
            flush()
            src = (base or Path(".")) / m.group(2)
            if images and src.exists():
                if first:            # 그림이 맨 앞이면 구역 설정 자리를 먼저 만든다
                    doc.para([(BODY, "")], P_BODY, first=True)
                    first = False
                doc.picture(src, m.group(1))
            else:
                doc.para(inline_runs(f"[그림 자리] {m.group(1)}", SMALL), P_FIG,
                         first=first)
                first = False
            i += 1
            continue

        if not line.strip():
            flush()
            i += 1
            continue

        if line.lstrip().startswith("---") and set(line.strip()) <= {"-"}:
            flush()
            doc.para([(SMALL, "─" * 40)], P_BODY, first=first)
            first = False
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush()
            level = len(m.group(1))
            doc.para(inline_runs(m.group(2), HEAD_CHARPR[level]), P_HEAD, first=first)
            first = False
            i += 1
            continue

        if line.lstrip().startswith(">"):
            flush()
            # 여러 줄에 걸친 인용은 한 문단으로 모은다. 줄 단위로 쪼개면 줄을
            # 넘나드는 **굵게** 가 짝을 잃는다.
            quote: list[str] = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quote.append(lines[i].lstrip()[1:].strip())
                i += 1
            # 빈 `>` 줄은 문단 경계다. 전부 합치면 편지 초안 같은 글이 한 덩어리로
            # 뭉개져 읽을 수 없게 된다. 인용 안의 글머리(`> - `)도 한 줄씩 세운다.
            block: list[str] = []
            mark = ""

            def emit() -> None:
                nonlocal block, mark, first
                if block:
                    runs = inline_runs(" ".join(block), BODY)
                    doc.para(([(BODY, mark)] if mark else []) + runs,
                             P_QUOTE, first=first)
                    first = False
                block, mark = [], ""

            for q in quote + [""]:
                m2 = BULLET.match(q)
                if m2:
                    emit()
                    mark, block = "· ", [m2.group(2)]
                elif q:
                    block.append(q)
                else:
                    emit()
            continue

        m = BULLET.match(line)
        if m:
            flush()
            mark = "· " if len(m.group(1)) >= 2 else "• "
            text, i = _item_text(lines, i, m.group(2))
            doc.para([(BODY, mark), *inline_runs(text, BODY)], P_LIST, first=first)
            first = False
            continue

        m = NUMBER.match(line)
        if m:
            flush()
            text, i = _item_text(lines, i, m.group(3))
            doc.para([(BODY, f"{m.group(2)}. "), *inline_runs(text, BODY)],
                     P_LIST, first=first)
            first = False
            continue

        buf.append(line.strip())
        i += 1
    flush()


# ── 포장 ───────────────────────────────────────────────────────────────────
def package(doc: Builder, title: str, dest: Path) -> None:
    section = (xml_header()
               + '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'
               ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
               ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">'
               + "".join(doc.body) + "</hs:sec>")

    version = (xml_header()
               + '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"'
               ' tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5"'
               ' buildNumber="0" os="1" xmlVersion="1.4"'
               ' application="Hancom Office Hangul" appVersion="9, 1, 1, 5656"/>')

    container = (xml_header()
                 + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"'
                 ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles>'
                 '<ocf:rootfile full-path="Contents/content.hpf"'
                 ' media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>')

    manifest = (xml_header()
                + '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"'
                ' version="1.2">'
                '<odf:file-entry odf:full-path="/"'
                ' odf:media-type="application/hwp+zip"/>'
                + "".join(
                    f'<odf:file-entry odf:full-path="{path}"'
                    ' odf:media-type="application/xml"/>'
                    for path in ("Contents/content.hpf", "Contents/header.xml",
                                 "Contents/section0.xml", "settings.xml"))
                + "".join(
                    f'<odf:file-entry odf:full-path="BinData/{name}"'
                    f' odf:media-type="image/{"png" if name.endswith(".png") else "jpeg"}"/>'
                    for name, _ in doc.images.values())
                + "</odf:manifest>")

    content = (xml_header()
               + '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"'
               ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"'
               ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
               ' version="" unique-identifier="" id=""><opf:metadata>'
               f"<opf:title>{escape(title)}</opf:title>"
               "<opf:language>ko</opf:language></opf:metadata><opf:manifest>"
               '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
               '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>'
               '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>'
               + "".join(
                   f'<opf:item id="{iid}" href="BinData/{name}"'
                   f' media-type="image/{"png" if name.endswith(".png") else "jpeg"}"'
                   ' isEmbeded="1"/>'
                   for iid, (name, _) in doc.images.items())
               + "</opf:manifest><opf:spine>"
               '<opf:itemref idref="header" linear="yes"/>'
               '<opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>')

    settings = (xml_header()
                + '<ha:HWPApplicationSetting'
                ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"'
                ' xmlns:config="http://www.hancom.co.kr/hwpml/2011/config-item">'
                '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>'
                '<ha:views><ha:view type="document"/></ha:views>'
                "</ha:HWPApplicationSetting>")

    parts = {
        "version.xml": version,
        "settings.xml": settings,
        "META-INF/container.xml": container,
        "META-INF/manifest.xml": manifest,
        "Contents/content.hpf": content,
        "Contents/header.xml": header_xml(),
        "Contents/section0.xml": section,
        "Preview/PrvText.txt": "\n".join(doc.plain),
    }

    import xml.etree.ElementTree as ET
    for name, text in parts.items():                  # 깨진 XML 을 내보내지 않는다
        if name.endswith((".xml", ".hpf")):
            try:
                ET.fromstring(text)
            except ET.ParseError as exc:
                sys.exit(f"[오류] {name} 이(가) 올바른 XML 이 아닙니다: {exc}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        # mimetype 은 반드시 **맨 앞**에 **압축하지 않고** 넣는다. 한글이 이것으로
        # 파일 종류를 판별한다.
        zf.writestr(zipfile.ZipInfo("mimetype"), "application/hwp+zip",
                    compress_type=zipfile.ZIP_STORED)
        for name, text in parts.items():
            zf.writestr(name, text.encode("utf-8"))
        for name, raw in doc.images.values():
            zf.writestr(f"BinData/{name}", raw)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="마크다운을 한글(HWPX)로 바꾼다")
    ap.add_argument("source", help="입력 .md")
    ap.add_argument("-o", "--out", required=True, help="출력 .hwpx")
    ap.add_argument("--title", default=None, help="문서 제목(생략하면 첫 제목 줄)")
    ap.add_argument("--no-images", action="store_true",
                    help="그림을 넣지 않고 자리만 표시한다(그림 때문에 안 열릴 때)")
    args = ap.parse_args(argv)

    text = Path(args.source).read_text(encoding="utf-8")
    title = args.title or next(
        (ln[2:].strip() for ln in text.splitlines() if ln.startswith("# ")),
        Path(args.source).stem)

    doc = Builder()
    convert(text, doc, Path(args.source).parent, images=not args.no_images)
    dest = Path(args.out)
    package(doc, title, dest)
    print(f"만들었습니다: {dest}  ({dest.stat().st_size:,} 바이트,"
          f" 문단 {len(doc.body)}개, 그림 {len(doc.images)}장)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
