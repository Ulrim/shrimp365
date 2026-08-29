"""PDF 렌더링 파이프라인 — Jinja2 HTML → WeasyPrint PDF(ADR 0004, phase-3.md 1.8절).

★ Rule 1 무관: 이 모듈은 KPI/MRV 산식을 계산하지 않는다. 이미 산출된 값(mrv_report_service
가 조립한 dict)을 HTML/PDF 로 **표현**만 한다.

WeasyPrint 는 네이티브 라이브러리(pango/cairo/gdk-pixbuf) 의존이라 일부 환경(경량
컨테이너·샌드박스)에서 임포트/렌더링이 실패할 수 있다. 정상 환경(Dockerfile 에 apt 패키지
반영, ADR 0004 4절)에서는 완전히 동작하도록 작성하되, 실패 시 명확한 에러 로그와 함께
HTML 폴백 저장으로 넘어간다(사용자 지시 — 과설계로 막히지 않는다).
"""

from __future__ import annotations

import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("culiver.api")

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)

# 폰트 파일 실제 존재 여부(1.8절 "가능하면 실제 폰트 파일 포함, 없으면 시스템 폰트 폴백").
_FONT_REGULAR = _FONT_DIR / "Pretendard-Regular.subset.woff2"
FONT_EMBEDDED = _FONT_REGULAR.exists()


def render_comparison_bar_svg(
    *,
    label_before: str,
    value_before: float | None,
    label_after: str,
    value_after: float | None,
    unit: str,
    width: int = 320,
    height: int = 180,
) -> str:
    """전/후 비교 막대그래프(MASTER 3.3 ④). 외부 플로팅 라이브러리 없이 결정론적으로 생성
    (ADR 0004 2절 — 수치 2개 수준이므로 서버 SVG 생성으로 충분).

    값이 None(산출 불가)이면 0 높이 막대 + "N/A" 라벨로 표시한다(조용히 숨기지 않는다).
    """
    bar_area_h = height - 50
    values = [v for v in (value_before, value_after) if v is not None]
    max_v = max(values) if values else 0.0
    max_v = max_v if max_v > 0 else 1.0  # 0 나눗셈 방지(표시 전용, 산식 아님)

    def _bar_h(v: float | None) -> float:
        if v is None:
            return 0.0
        return max(2.0, (v / max_v) * bar_area_h)

    bar_w = 70
    gap = 60
    x_before = 40
    x_after = x_before + bar_w + gap

    h_before = _bar_h(value_before)
    h_after = _bar_h(value_after)

    def _label(v: float | None) -> str:
        return "N/A" if v is None else f"{v:.4g}"

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="전후 비교 그래프">',
        f'<line x1="20" y1="{bar_area_h + 20}" x2="{width - 10}" y2="{bar_area_h + 20}" '
        'stroke="#333" stroke-width="1"/>',
        # before bar
        f'<rect x="{x_before}" y="{bar_area_h + 20 - h_before}" width="{bar_w}" '
        f'height="{h_before}" fill="#94a3b8"/>',
        f'<text x="{x_before + bar_w / 2}" y="{bar_area_h + 40}" text-anchor="middle" '
        f'font-size="12">{label_before}</text>',
        f'<text x="{x_before + bar_w / 2}" y="{bar_area_h + 20 - h_before - 6}" '
        f'text-anchor="middle" font-size="12">{_label(value_before)} {unit}</text>',
        # after bar
        f'<rect x="{x_after}" y="{bar_area_h + 20 - h_after}" width="{bar_w}" '
        f'height="{h_after}" fill="#16a34a"/>',
        f'<text x="{x_after + bar_w / 2}" y="{bar_area_h + 40}" text-anchor="middle" '
        f'font-size="12">{label_after}</text>',
        f'<text x="{x_after + bar_w / 2}" y="{bar_area_h + 20 - h_after - 6}" '
        f'text-anchor="middle" font-size="12">{_label(value_after)} {unit}</text>',
        "</svg>",
    ]
    return "".join(parts)


def render_mrv_report_html(context: dict) -> str:
    """Jinja2 템플릿(mrv_report.html)에 context 를 채워 HTML 문자열 반환."""
    template = _env.get_template("mrv_report.html")
    return template.render(
        **context,
        font_dir_uri=_FONT_DIR.as_uri(),
        font_embedded=FONT_EMBEDDED,
    )


def render_pdf(report_id: str, html: str, output_dir: str) -> tuple[str, bool]:
    """HTML → PDF 렌더링 후 파일로 저장. (파일경로, pdf_rendered 여부) 반환.

    - 성공: `{output_dir}/{report_id}.pdf` 저장, pdf_rendered=True.
    - 실패(WeasyPrint 네이티브 의존성 미구성 등): `{output_dir}/{report_id}.html` 폴백 저장,
      pdf_rendered=False(원인은 서버 로그에 남기고 응답에는 노출하지 않는다, 8.5절과 동형).
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        from weasyprint import HTML  # 지연 임포트: 네이티브 의존성 미구성 환경 방어

        pdf_bytes = HTML(string=html, base_url=str(_TEMPLATE_DIR)).write_pdf()
        pdf_path = out_dir / f"{report_id}.pdf"
        pdf_path.write_bytes(pdf_bytes)
        return str(pdf_path), True
    except Exception:  # noqa: BLE001 — 원인이 다양(임포트/폰트/레이아웃)해 폭넓게 방어(1.8절 지시)
        logger.error(
            "MRV PDF 렌더링 실패(WeasyPrint 미구성 또는 렌더링 오류) — HTML 폴백 저장: "
            "report_id=%s",
            report_id,
            exc_info=True,
        )
        html_path = out_dir / f"{report_id}.html"
        html_path.write_text(html, encoding="utf-8")
        return str(html_path), False
