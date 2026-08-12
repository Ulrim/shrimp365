#!/bin/sh
# 시방서 PDF 생성
#
#   sh docs/build.sh
#
# docs/spec.html 을 만들고 헤드리스 크로미움으로 PDF 로 굽습니다.
# 도면(SVG)과 3D 렌더(PNG)는 HTML 안에 인라인되므로 별도 파일이 필요 없습니다.
set -e

cd "$(dirname "$0")/.."

python3 raspberry-pi/enclosure/make-drawings.py
python3 raspberry-pi/enclosure/make-wiring.py
python3 docs/make-figures.py
python3 docs/make-spec.py

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in \
    /opt/pw-browsers/chromium-*/chrome-linux/chrome \
    "$(command -v chromium 2>/dev/null || true)" \
    "$(command -v google-chrome 2>/dev/null || true)"
  do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -n "$CHROME" ] || { echo "크로미움을 찾지 못했습니다. CHROME=<경로> 로 지정하십시오." >&2; exit 1; }

"$CHROME" --headless --no-sandbox --disable-gpu \
  --print-to-pdf=docs/water-quality-monitoring-spec.pdf \
  --no-pdf-header-footer \
  "file://$(pwd)/docs/spec.html" 2>/dev/null

echo "완료 — docs/water-quality-monitoring-spec.pdf"
