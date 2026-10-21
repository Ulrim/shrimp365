// 자료집을 A4 PDF 한 권으로 묶는다.
//
// 왜 PDF 로도 내나
// ----------------
// assets/ 와 evidence/ 는 보고서를 **쓰는 사람**이 꺼내 쓰는 재료다. 그러나
// 과제 담당자·점검위원에게 건네는 것은 파일 더미가 아니라 한 권이어야 한다.
// 이 스크립트는 같은 재료로 인쇄용 한 권을 만든다 — 그림에는 캡션이 붙어 있고,
// 시험 결과에는 실행 환경과 명령이 그대로 들어간다.
//
// 그림과 결과를 다시 뜬 뒤 이것을 돌리면 PDF 도 같이 최신이 된다.
//
// 실행 (저장소 뿌리에서):
//
//     node docs/result-03-bluestartup/src/build-pdf.mjs
//
// 결과: docs/result-03-bluestartup/03_블루스타트업_결과보고서_자료집.pdf
import { chromium } from "playwright-core"
import { readFile, writeFile, readdir } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = path.resolve(HERE, "..")
const ROOT = path.resolve(BASE, "..", "..")
const ASSETS = path.join(BASE, "assets")
const EVIDENCE = path.join(BASE, "evidence")
const OUT = path.join(BASE, "03_블루스타트업_결과보고서_자료집.pdf")

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  try {
    const dir = readdirSync("/opt/pw-browsers").find((d) => d.startsWith("chromium-"))
    if (dir) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`
  } catch { /* 아래 후보로 */ }
  return ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]
    .find((p) => existsSync(p))
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

async function dataUri(file) {
  const buf = await readFile(path.join(ASSETS, file))
  return `data:image/png;base64,${buf.toString("base64")}`
}

/** 결과 파일에서 머리말과 마지막 판정만 꺼낸다. 전문을 다 실으면 수십 쪽이 된다. */
async function digest(file, keep = 10) {
  const text = await readFile(path.join(EVIDENCE, file), "utf8")
  const [head, ...rest] = text.split(/─{10,}\n/)
  const body = rest.join("").trim().split("\n")
  const tail = body.slice(-keep).join("\n")
  return { head: head.trim(), tail: tail.trim() }
}

// ── 그림 목록 ──────────────────────────────────────────────────────────────
const DIAGRAMS = [
  ["01_시스템구성도.png", "그림 1. 개체수 계측 시스템 구성",
   "수중 카메라 개체수 계측 시스템 구성 — 영상을 외부로 전송하지 않고 양식장 내 엣지 장비에서 추론을 완료하여, 개체수·신뢰도·추정 체장만 서버로 전송함."],
  ["02_공유기뒤_수조보기.png", "그림 2. 양식장 네트워크(NAT) 환경 대응",
   "외부에서 장비로 진입하는 연결 없이, 장비가 수조 영상을 주기적으로 송출하는 방식으로 원격 확인 기능을 구현함."],
  ["03_원격업데이트_흐름.png", "그림 3. 현장 장비 원격 업데이트 체계",
   "해시 대조·사전 기동 점검·원자적 교체·자동 롤백의 5단계로 구성하여 현장 방문 없이 프로그램을 갱신함."],
]

const WEB = [
  ["11_웹화면_개요.png", "그림 4. 개체수 모니터링 개요",
   "수조별 최신 개체수·상태를 한 화면에서 확인."],
  ["12_웹화면_실시간.png", "그림 5. 실시간 확인 화면",
   "탐지 결과(개체 박스)와 계수 범위(ROI)가 표시된 수조 영상, 현재 개체수·추정 체장·영상 경과 시간을 함께 제공."],
  ["13_웹화면_이력.png", "그림 6. 개체수 이력 조회",
   "24시간/7일/30일 구간 집계 및 CSV 내보내기."],
  ["14_웹화면_통합분석.png", "그림 7. 수질·개체수 통합 분석",
   "동일 시간 구간으로 정렬한 개체수와 용존산소의 상관 분석."],
  ["15_웹화면_설정.png", "그림 8. 카메라·경보 설정",
   "카메라 등록, 계수 범위 지정, 경보 임계값 설정."],
]

const DEVICE = [
  ["21_장비화면_정상계수.png", "그림 9. 현장 장비 운전 화면",
   "현재 개체수, 최근 30분 추이, 계수 범위와 탐지 결과가 표시된 영상."],
  ["22_장비화면_연결코드.png", "그림 10. 기기 등록",
   "6자리 코드를 웹에서 승인하여 장비를 수조에 연결(설치자가 키를 옮겨 적지 않음)."],
  ["23_장비화면_원격업데이트.png", "그림 11. 원격 업데이트 적용 후",
   "버전 표시가 갱신되며 현장 조작은 필요하지 않음."],
  ["24_장비화면_카메라신호없음.png", "그림 12. 카메라 신호 중단",
   "원인과 미전송 건수를 현장에서 바로 확인."],
  ["25_장비화면_업데이트되돌림.png", "그림 13. 업데이트 자동 롤백",
   "실패 시 이전 버전으로 자동 복귀하고 그 사실을 화면에 표시."],
]

const TESTS = [
  ["01_pytest.txt", "비전 서비스 단위·통합 시험", "339건 통과",
   "추론 루프, 계수 범위 거르기, 체장 환산, 동기화, 페어링, 경보, 장비 화면 API"],
  ["02_수조사진_API점검.txt", "장비→서버→웹 사진 경로", "26건 통과",
   "실제 서버를 띄우고 HTTP 로 주고받음. 기기 키로 남의 카메라에 사진을 심을 수 없음, JPEG 이 한 바이트도 변하지 않음, 로그인 없이 남의 수조를 볼 수 없음"],
  ["03_가동률SQL_점검.txt", "가동률 집계 SQL", "29건 통과",
   "PostgreSQL 16 에 실제로 올려 답을 대조. 빠짐없이 100%, 610초 단절 84.72%, 기록 없음 0%"],
  ["04_원격배포_왕복점검.txt", "원격 업데이트 꾸러미 왕복", "21건 통과",
   "꾸러미 생성→해시 대조→해제→교체→이전 버전 보관까지"],
  ["06_웹화면_점검.txt", "영상 두절 시 대체 화면", "14건 통과",
   "브라우저로 실제 확인 — 영상 실패 시 수조 사진으로 전환되고 경과 시간이 표시됨"],
]

// ── 문서 조립 ──────────────────────────────────────────────────────────────
const font = await readFile(path.join(ROOT, "public/fonts/PretendardVariable.woff2"))
const fontUri = `data:font/woff2;base64,${font.toString("base64")}`

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()
const today = new Date().toLocaleDateString("ko-KR", {
  year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul",
})

async function figure(list, cls = "") {
  const out = []
  for (const [file, title, caption] of list) {
    out.push(`<figure class="fig ${cls}">
      <img src="${await dataUri(file)}" alt="${esc(title)}">
      <figcaption><b>${esc(title)}</b><span>${esc(caption)}</span></figcaption>
    </figure>`)
  }
  return out.join("\n")
}

const modelSpec = await digest("05_모델사양.txt", 40)
const testBlocks = []
for (const [file, name, result, what] of TESTS) {
  const d = await digest(file, 8)
  testBlocks.push(`<div class="test">
    <h3>${esc(name)} <em>${esc(result)}</em></h3>
    <p class="what">${esc(what)}</p>
    <pre class="head">${esc(d.head)}</pre>
    <pre class="tail">${esc(d.tail)}</pre>
  </div>`)
}

const html = `<!doctype html>
<html lang="ko"><meta charset="utf-8"><title>03 블루스타트업 결과보고서 자료집</title>
<style>
@font-face { font-family: PretendardX; src: url(${fontUri}) format("woff2");
             font-weight: 100 900; font-display: block; }
@page { size: A4; margin: 17mm 16mm 15mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: PretendardX, system-ui, sans-serif; color: #0F172A;
       font-size: 10.2pt; line-height: 1.68; -webkit-print-color-adjust: exact;
       print-color-adjust: exact; }
.page { break-after: page; }
.page:last-child { break-after: auto; }

/* 표지 */
.cover { height: 247mm; display: flex; flex-direction: column; justify-content: center; }
.cover .kicker { font-size: 11pt; color: #1E40AF; font-weight: 700; letter-spacing: .5px; }
.cover h1 { font-size: 27pt; font-weight: 800; line-height: 1.25; margin-top: 10px;
            letter-spacing: -1px; }
.cover .lead { margin-top: 16px; font-size: 11pt; color: #475569; line-height: 1.75; }
.cover .meta { margin-top: 40px; border-top: 2px solid #1E40AF; padding-top: 18px; }
.cover .meta dl { display: grid; grid-template-columns: 90px 1fr; gap: 9px 14px; font-size: 10pt; }
.cover .meta dt { color: #64748B; font-weight: 650; }
.cover .meta dd { color: #0F172A; }
.cover code { font-family: ui-monospace, monospace; font-size: 8.6pt; background: #F1F5F9;
              padding: 1px 5px; border-radius: 3px; overflow-wrap: anywhere; }

h2 { font-size: 16pt; font-weight: 800; letter-spacing: -.4px; padding-bottom: 9px;
     border-bottom: 2.5px solid #1E40AF; margin-bottom: 7px; }
h2 + .note-lead { font-size: 9.6pt; color: #64748B; margin-bottom: 18px; line-height: 1.6; }
h3 { font-size: 11.6pt; font-weight: 750; margin-top: 16px; }

.fig { margin-top: 15px; break-inside: avoid; }
.fig img { width: 100%; border: 1px solid #E2E8F0; border-radius: 5px; display: block; }
.fig figcaption { margin-top: 7px; font-size: 9pt; line-height: 1.6; }
.fig figcaption b { display: block; font-weight: 750; }
.fig figcaption span { color: #475569; }
.half { width: 48.5%; display: inline-block; vertical-align: top; }
.half + .half { margin-left: 2.4%; }

table { width: 100%; border-collapse: collapse; font-size: 9.1pt; margin-top: 13px; }
th, td { border: 1px solid #CBD5E1; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #EFF4FF; font-weight: 700; color: #1E3A8A; }
td.ok { color: #0D9488; font-weight: 700; white-space: nowrap; }
td.no { color: #BE123C; font-weight: 700; white-space: nowrap; }

.callout { margin-top: 16px; border-left: 4px solid #B45309; background: #FFFBEB;
           padding: 12px 16px; font-size: 9.4pt; line-height: 1.72; border-radius: 0 6px 6px 0;
           break-inside: avoid; }
.callout.blue { border-color: #1E40AF; background: #F5F8FF; }
.callout.red  { border-color: #BE123C; background: #FFF5F6; }
.callout b { font-weight: 750; }
.callout h4 { font-size: 10.2pt; font-weight: 780; margin-bottom: 4px; }

.test { margin-top: 17px; break-inside: avoid; }
.test h3 { display: flex; align-items: baseline; gap: 10px; }
.test h3 em { font-style: normal; font-size: 9.4pt; color: #0D9488; font-weight: 750; }
.test .what { font-size: 9pt; color: #475569; margin-top: 3px; line-height: 1.6; }
pre { font-family: ui-monospace, Menlo, monospace; font-size: 7.6pt; line-height: 1.55;
      background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 5px;
      padding: 8px 10px; margin-top: 7px; white-space: pre-wrap; overflow-wrap: anywhere;
      color: #334155; }
pre.tail { background: #F0FDF9; border-color: #A7E8D8; }
ol, ul { margin: 9px 0 0 18px; }
li { margin-top: 5px; }
.muted { color: #64748B; }
</style>

<!-- ── 표지 ── -->
<section class="page cover">
  <div class="kicker">2026 블루스타트업 · 과제 03</div>
  <h1>수중 카메라 AI 개체수·성장 계측<br>결과보고서 자료집</h1>
  <p class="lead">
    결과보고서를 작성할 때 바로 사용하도록 설계 그림·화면·시험 결과를 모은 자료집입니다.<br>
    <b>그림은 실제 동작 화면에서 캡처</b>했고, <b>수치는 실행 기록</b>에서 가져왔습니다.
    증빙이 아직 확보되지 않은 항목은 6장에 그대로 적었습니다.
  </p>
  <div class="meta"><dl>
    <dt>과제 종료</dt><dd>2026. 11. 30.</dd>
    <dt>작성일</dt><dd>${esc(today)}</dd>
    <dt>대상</dt><dd>비전 서비스 <code>vision/</code> · 웹 <code>/vision</code> · 배포 <code>public/updates/vision/</code></dd>
    <dt>저장소</dt><dd>ulrim/shrimp365</dd>
    <dt>문서 생성</dt><dd>커밋 <code>${esc(commit)}</code>
      <span class="muted">— 시험을 실행한 커밋은 4-1장의 각 기록에 따로 적혀 있습니다.</span></dd>
    <dt>구성</dt><dd>그림 13장 · 시험 결과 6종(429건) · 재생성 스크립트 5종</dd>
  </dl></div>
</section>

<!-- ── 0. 자료집 사용법 ── -->
<section class="page">
  <h2>0. 이 자료집을 쓰는 법</h2>
  <p class="note-lead">무엇이 증빙이고 무엇이 아닌지를 먼저 구분합니다.</p>

  <h3>세 가지 원칙</h3>
  <ol>
    <li><b>그림은 실제 화면에서 캡처했습니다.</b> 시안을 그려 넣으면 그 순간부터 실물과 어긋나고,
        점검위원이 화면을 열어 보면 다른 그림이 나옵니다. 웹 화면은 운영에 배포된 코드를,
        장비 화면은 장비의 화면 코드를 그대로 띄워 촬영했습니다. 화면을 수정하면 스크립트를
        다시 실행하는 것만으로 첨부 그림이 따라옵니다.</li>
    <li><b>수치는 실행 기록입니다.</b> 사람이 옮겨 적은 "통과"는 증빙이 아닙니다. 각 시험 결과에
        실행일시·커밋·실행환경·실행명령을 함께 실었고, 같은 명령으로 누구든 재현할 수 있습니다.</li>
    <li><b>확보되지 않은 증빙은 그대로 적었습니다.</b> 6장이 그 목록입니다.</li>
  </ol>

  <div class="callout red">
    <h4>⚠ 화면 그림의 수치는 시연용 생성값입니다</h4>
    운영 데이터베이스의 실데이터는 타 농장 자료이므로 보고서에 실을 수 없고, 접근 키를
    저장소에 둘 수도 없습니다. 따라서 4·5장의 화면 그림은 <b>"화면이 이렇게 동작한다"의
    증빙이며, "현장에서 이 값이 측정되었다"의 증빙이 아닙니다.</b>
    캡션에 측정값처럼 기재하지 마십시오.<br>
    단, 수조 영상 한 장은 장비와 동일한 코드로 생성한 것이라 머리글·계수 범위·탐지 박스가
    현장과 같은 형태입니다.
  </div>

  <div class="callout blue">
    <h4>원본 파일 위치</h4>
    저장소 <code>docs/result-03-bluestartup/</code> 아래에 있습니다.<br>
    <code>assets/</code> 그림 13장(2배 배율 PNG) · <code>evidence/</code> 시험 결과 6종 ·
    <code>src/</code> 재생성 스크립트 · <code>README.md</code> 항목별 사용처와 캡션 문구
  </div>
</section>

<!-- ── 1. 설계 ── -->
<section class="page">
  <h2>1. 시스템 설계</h2>
  <p class="note-lead">계측이 어디에서 일어나고, 결과가 어떤 경로로 사용자에게 도달하는가.</p>
  ${await figure(DIAGRAMS.slice(0, 2))}
</section>
<section class="page">
  ${await figure(DIAGRAMS.slice(2))}
  <div class="callout blue">
    <h4>설계상의 핵심 선택 세 가지</h4>
    <b>① 영상이 아니라 숫자를 보냅니다.</b> 24시간 영상을 전송하면 카메라 한 대가 월 수백 GB 를
    사용합니다. 추론을 장비에서 완료하면 기록 한 줄에 100바이트 남짓이며, 인터넷이 끊겨도
    장비는 계속 계수하여 로컬에 보관했다가 회선 복구 시 전송합니다.<br>
    <b>② 장비는 데이터베이스 비밀번호를 갖지 않습니다.</b> 6자리 코드로 등록할 때 발급되는
    기기 키만 보관하며, 그 키로는 자신에게 연결된 카메라에만 기록할 수 있습니다.<br>
    <b>③ 업데이트에 서명을 쓰지 않습니다.</b> 서명을 도입하려면 개인키를 저장소 외부의 특정
    PC 에 두어야 하고, 그러면 버전을 배포할 수 있는 사람도 그 한 사람으로 제한됩니다.
    키를 저장소나 CI 에 두는 절충안은 보호 대상에게 열쇠를 맡기는 것과 같습니다.
    따라서 신뢰 경계를 <b>저장소 쓰기 권한</b>으로 두고, 계정 2단계 인증을 실질적 잠금장치로
    삼았습니다.
  </div>
</section>

<!-- ── 2. 웹 화면 ── -->
<section class="page">
  <h2>2. 웹 화면 — shrimp365.kr /vision</h2>
  <p class="note-lead">양식장 관리자가 PC·모바일에서 접속하여 확인하는 화면입니다.</p>
  ${await figure(WEB.slice(0, 2))}
</section>
<section class="page">${await figure(WEB.slice(2, 4))}</section>
<section class="page">
  ${await figure(WEB.slice(4))}
  <div class="callout">
    <h4>영상이 열리지 않을 때의 동작 (그림 5)</h4>
    양식장 공유기 뒤의 장비에는 외부에서 진입할 수 없어 실시간 영상이 열리지 않습니다.
    이때 화면은 <b>장비가 주기적으로 송출한 수조 사진</b>으로 전환되며, 사진이 얼마나
    경과했는지를 함께 표시합니다. 정지된 사진을 실시간으로 보이게 하지 않기 위한 장치입니다.
  </div>
</section>

<!-- ── 3. 장비 화면 ── -->
<section class="page">
  <h2>3. 현장 장비 화면 — 7인치 터치스크린</h2>
  <p class="note-lead">수조 옆 장비에 부착된 화면입니다. 현장에서 상태 확인과 기기 등록이 이루어집니다.</p>
  ${await figure(DEVICE.slice(0, 1))}
  ${await figure(DEVICE.slice(1, 3), "half")}
</section>
<section class="page">
  ${await figure(DEVICE.slice(3), "half")}
  <div class="callout">
    <h4>현장에서 사람이 할 일을 줄이는 설계</h4>
    설치자는 키를 옮겨 적지 않습니다(화면의 6자리 코드를 웹에서 승인). 업데이트를 위해
    농장을 방문하지 않습니다(부팅 5분 후·이후 1시간마다 자동 확인). 업데이트가 실패하면
    이전 버전으로 자동 복귀하고 그 사실을 화면에 남깁니다 — 현장에서 "왜 그대로인가"를
    묻지 않아도 되게 합니다.
  </div>
</section>

<!-- ── 4. 시험 결과 ── -->
<section class="page">
  <h2>4. 시험 결과</h2>
  <p class="note-lead">모두 본 저장소의 코드를 실행한 결과이며, 명시된 명령으로 재현할 수 있습니다.</p>
  <table>
    <tr><th style="width:30%">시험</th><th style="width:16%">결과</th><th>검증 범위</th></tr>
    ${TESTS.map(([, name, result, what]) =>
      `<tr><td>${esc(name)}</td><td class="ok">${esc(result)}</td><td>${esc(what)}</td></tr>`).join("")}
    <tr><td>배포 모델 사양·해시</td><td class="ok">측정값</td>
        <td>배포 중인 모델 파일에서 직접 계산한 값</td></tr>
    <tr><th colspan="2">합계</th><th>429건</th></tr>
  </table>

  <div class="callout">
    <h4>시험 과정에서 발견하여 조치한 사항</h4>
    <b>① 간헐적으로 실패하는 시험 1건을 수정했습니다(12회 중 1회).</b> 원인은 코드 결함이 아니라
    시험 방식이었습니다 — 고정된 1초 대기 후 결과를 확인하는 구조여서, 부하가 있는 첫 실행에서는
    정상 코드가 실패했습니다. 시간을 재는 대신 <b>결과가 나올 때까지 대기</b>하도록 변경했습니다.
    재현되지 않는 시험은 증빙이 되지 못합니다.<br>
    <b>② 화면 시험이 이미지 없이 통과하고 있었습니다.</b> 시험용 이미지를 환경변수로만 받아,
    값을 전달하지 않으면 빈 이미지로 시험이 통과했습니다. 장비와 동일한 코드로 생성한 이미지를
    파일로 고정했습니다.
  </div>
</section>

<section class="page">
  <h2>4-1. 시험별 실행 기록</h2>
  <p class="note-lead">각 시험의 실행 환경·명령과 결과 말미입니다. 전문은 저장소 <code>evidence/</code> 에 있습니다.</p>
  ${testBlocks.join("\n")}
</section>

<section class="page">
  <h2>4-2. 배포 모델 사양</h2>
  <p class="note-lead">문서에 옮겨 적은 값이 아니라, 배포 중인 모델 파일에서 직접 계산한 값입니다.</p>
  <pre>${esc(modelSpec.head)}

${esc(modelSpec.tail)}</pre>
</section>

<!-- ── 5. 항목 대비 상태 ── -->
<section class="page">
  <h2>5. 사업계획서 항목 대비 현재 상태</h2>
  <p class="note-lead">2026. 10. 21. 기준입니다.</p>
  <table>
    <tr><th style="width:34%">항목</th><th style="width:20%">상태</th><th>증빙</th></tr>
    <tr><td>수중 카메라 개체수 자동 계수</td><td class="ok">구현·시험 완료</td><td>시험 결과 1, 그림 9</td></tr>
    <tr><td>계수 범위(ROI) 지정 및 화면 표시</td><td class="ok">구현·시험 완료</td><td>그림 5 — 주황 테두리와 범위 밖 음영</td></tr>
    <tr><td>추정 체장 계측 (먹이망 격자 축척)</td><td class="ok">구현·시험 완료</td><td>8cm×7.5cm 격자 기준, 시험 결과 1</td></tr>
    <tr><td>수질 연동 통합 분석</td><td class="ok">구현 완료</td><td>그림 7</td></tr>
    <tr><td>원격 모니터링 (NAT 환경)</td><td class="ok">구현·시험 완료</td><td>그림 2, 시험 결과 2</td></tr>
    <tr><td>현장 장비 무인 업데이트</td><td class="ok">구현·시험 완료</td><td>그림 3, 시험 결과 4</td></tr>
    <tr><td>가동률 산출</td><td class="ok">함수 구현·시험 완료</td><td>시험 결과 3 — 단, 집계할 현장 운전 기록이 아직 없음</td></tr>
    <tr><td>계수 정확도 ±20%</td><td class="no">재계산 불가</td><td>6장 ① 참조</td></tr>
    <tr><td>탈피각 배제 (특허 A1)</td><td class="no">미착수</td><td>—</td></tr>
    <tr><td>급이 동기 신뢰도 (특허 A2)</td><td class="no">미착수</td><td>—</td></tr>
  </table>
</section>

<!-- ── 6. 빠진 것 ── -->
<section class="page">
  <h2>6. 아직 증빙이 확보되지 않은 항목</h2>
  <p class="note-lead">아래 네 가지는 코드로 해결되지 않습니다. 보고서에 해당 항목을 기재하려면 먼저 조치가 필요합니다.</p>

  <h3>① 모델 성능 수치를 재계산할 수 없습니다</h3>
  <p>개발 문서에 mAP@0.5 <b>0.924</b>, 계수 오차 <b>2.2%</b>(test 445장), ±20% 이내 <b>98.9%</b> 가
  기재되어 있으나, <b>학습·평가 데이터셋과 평가 출력 파일이 저장소에 없습니다.</b> 현재로서는 그
  수치를 다시 계산해 확인할 방법이 없으므로, 본 자료집도 해당 수치를 싣지 않았습니다.</p>
  <ul>
    <li>조치: 평가 데이터셋을 확보해 평가 스크립트를 재실행하고, <b>출력 파일을 저장소에 커밋</b>합니다.
        그러면 수치가 서술이 아니라 자료가 됩니다.</li>
    <li><b>보고에 사용할 모델을 먼저 확정해야 합니다.</b> 과거 보고된 0.7642 모델의 가중치는
        저장소에 없고, 현재 배포본은 2026-10-02 에 공개 데이터로 새로 학습한 다른 모델입니다.
        두 모델을 혼용하면 수치와 산출물이 어긋납니다.</li>
  </ul>

  <h3>② 현장 설치 실적이 없습니다</h3>
  <p>가장 큰 병목입니다. 카메라를 <b>실제 수조에 1~3대 고정</b>해야 ①의 현장 평가도, ③의 가동률도,
  현장 사진도 확보됩니다. 본 자료집의 그림은 모두 시연 환경에서 촬영한 것입니다.</p>

  <h3>③ 가동률 실측값이 없습니다</h3>
  <p>집계 함수는 구현하여 29건으로 검증했으나, 집계할 <b>현장 운전 기록이 아직 축적되지
  않았습니다.</b> 설치 후 2주면 의미 있는 표가 산출됩니다.
  <span class="muted">(함수 사용을 위해 데이터베이스에서 해당 SQL 을 1회 실행해야 합니다.)</span></p>

  <h3>④ 라이선스 검토가 필요합니다</h3>
  <p>배포 중인 계수 모델은 Ultralytics AGPL-3.0 계열입니다. 상용 판매 시 검토가 필요합니다.</p>
</section>

<!-- ── 7. 재생성 ── -->
<section class="page">
  <h2>7. 자료 재생성 방법</h2>
  <p class="note-lead">화면이나 코드를 수정한 뒤 아래를 실행하면 그림과 시험 결과가 함께 갱신됩니다.</p>
<pre># 시험 결과 6종 (10~15분)
./docs/result-03-bluestartup/src/collect-evidence.sh

# 설계 그림 3장
node docs/result-03-bluestartup/src/render-diagrams.mjs

# 웹 화면 5장 (3~5분)
node docs/result-03-bluestartup/src/capture-screens.mjs

# 장비 화면 5장
SHOT_SCALE=2 OUT_DIR=/tmp/kiosk node vision/tests/ui/check_kiosk_screens.js

# 본 PDF 다시 묶기
node docs/result-03-bluestartup/src/build-pdf.mjs

# 화면 시험이 빌드를 변경하므로, 작업 후 평소 빌드로 복구
VERCEL=1 npx next build</pre>
  <p style="margin-top:12px" class="muted">필요 환경: Python 가상환경(vision/.venv), Node.js, Chromium, PostgreSQL 16.</p>

  <div class="callout blue">
    <h4>폴더 구성</h4>
<pre style="background:#fff;border:none;padding:0;margin-top:6px">docs/result-03-bluestartup/
├── 03_블루스타트업_결과보고서_자료집.pdf   본 문서
├── README.md          항목별 사용처와 캡션 문구
├── assets/            그림 13장 (2배 배율 PNG)
├── evidence/          시험 결과 6종 (실행 기록 전문)
└── src/               재생성 스크립트 5종</pre>
  </div>
</section>
</html>`

await writeFile(path.join(BASE, "src", ".pdf-source.html"), html)

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox", "--no-proxy-server"],
})
const page = await browser.newPage()
await page.setContent(html, { waitUntil: "load" })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(600)
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div></div>`,
  footerTemplate: `<div style="width:100%;font-size:8px;color:#94A3B8;
    padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif">
    <span>03 블루스타트업 — 결과보고서 자료집</span>
    <span class="pageNumber"></span></div>`,
  margin: { top: "17mm", bottom: "15mm", left: "16mm", right: "16mm" },
})
await browser.close()

const { size } = await import("node:fs").then((m) => m.promises.stat(OUT))
console.log(`\n만들었습니다: ${path.relative(ROOT, OUT)}  (${(size / 1024 / 1024).toFixed(1)} MB)`)
