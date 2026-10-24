/**
 * 표준 기록지(CSV) 해석 검증 — `lib/mrv/csv-records.ts`.
 *
 * **다른 검증들과 성격이 다르다.** verify-kpi/config/ingestion/pipeline/alerts 는 원본
 * Python 을 돌려 만든 기대값과 대조하는 **차분 검증**이다. CSV 업로드는 원본에 없던
 * 기능이라(원본 엔드포인트 41개에 기록지 업로드가 없다) 대조할 상대가 없다. 그래서 이것은
 * **사양 기반 단위 검증**이다 — 그 사실을 숨기지 않고 출력에도 적는다.
 *
 * 검증이 지키는 것: 따옴표·CRLF·BOM 처리, 헤더 별칭, 시각 해석(시간대 유무·존재하지 않는
 * 날짜), 급이/폐사의 0 취급 차이, 그리고 **한 줄이라도 틀리면 레코드를 내보내지 않는다**는
 * 규칙이 깨지지 않았는지.
 *
 * 실행: node scripts/mrv/verify-csv.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-csv-"))

const failures = []
let checked = 0

function check(name, actual, expected) {
  checked += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) failures.push(`${name}\n      실제: ${a}\n      기대: ${e}`)
}

function checkTrue(name, condition, detail = "") {
  checked += 1
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
}

try {
  copyFileSync(join(ROOT, "lib/mrv/csv-records.ts"), join(outDir, "csv-records.ts"))
  // 자료유형 해석(`parseMeasurementBasis`)은 저 모듈에 있고 파서가 그것을 쓴다.
  // 스텁으로 바꾸지 않는다 — "'실측 아님' 이 적힌 칸을 넘겨짚지 않는가" 가 이 검증의
  // 항목이므로, 그 판정이 실물이어야 한다.
  copyFileSync(
    join(ROOT, "lib/mrv/measurement-basis.ts"),
    join(outDir, "measurement-basis.ts"),
  )
  // 생산량 산정 근거 해석(`parseProductionBasis`·`parseSurvivalAdjusted`)도 실물을 쓴다 —
  // "'실측 아님' 이 적힌 칸을 넘겨짚지 않는가" 가 이 검증의 항목이므로 스텁으로 바꾸면
  // 정작 봐야 하는 판정이 빠진다.
  copyFileSync(
    join(ROOT, "lib/mrv/production-basis.ts"),
    join(outDir, "production-basis.ts"),
  )
  execFileSync(
    "npx",
    [
      "tsc",
      join(outDir, "csv-records.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const {
    splitCsvRows,
    parseFeedCsv,
    parseMortalityCsv,
    parseRecordTimestamp,
    parsePowerCsv,
    parseHarvestCsv,
    HARVEST_CSV_TEMPLATE,
    FEED_CSV_TEMPLATE,
    MORTALITY_CSV_TEMPLATE,
    POWER_INTERVAL_CSV_TEMPLATE,
    POWER_CUMULATIVE_CSV_TEMPLATE,
  } = require(join(outDir, "out", "csv-records.js"))

  // ── ① 저수준 분해 ───────────────────────────────────────────────────────
  /** splitCsvRows 는 `{ rows, unterminatedAtLine }` 을 준다. 줄 셀만 꺼내는 지름길. */
  const cellsOf = (text) => splitCsvRows(text).rows.map((r) => r.cells)
  const linesOf = (text) => splitCsvRows(text).rows.map((r) => r.line)

  check("① 단순 2줄", cellsOf("a,b\n1,2\n"), [["a", "b"], ["1", "2"]])
  check(
    "① CRLF 를 개행으로 본다",
    cellsOf("a,b\r\n1,2\r\n"),
    [["a", "b"], ["1", "2"]],
  )
  check(
    "① BOM 을 떼고 첫 헤더를 읽는다",
    cellsOf("﻿a,b\n1,2"),
    [["a", "b"], ["1", "2"]],
  )
  check(
    "① 따옴표 안의 CRLF 는 \\n 하나로 모은다(값에 \\r 을 남기지 않는다)",
    cellsOf('a\n"x\r\ny"'),
    [["a"], ["x\ny"]],
  )
  check("① 미종결 따옴표를 별도 필드로 알린다", splitCsvRows('a,b\n1,"2').unterminatedAtLine, 2)
  check("① 정상 파일은 unterminatedAtLine 이 null", splitCsvRows("a,b\n1,2").unterminatedAtLine, null)
  check(
    "① 따옴표 안의 쉼표는 셀을 나누지 않는다",
    cellsOf('a,b\n"x,y",2'),
    [["a", "b"], ["x,y", "2"]],
  )
  check(
    "① 이중따옴표는 따옴표 하나다",
    cellsOf('a\n"he said ""hi"""'),
    [["a"], ['he said "hi"']],
  )
  check(
    "① 따옴표 안 개행은 한 레코드다",
    cellsOf('a,b\n"line1\nline2",2'),
    [["a", "b"], ["line1\nline2", "2"]],
  )
  check(
    "① 따옴표 안 개행 뒤 줄 번호가 밀린다",
    linesOf('a,b\n"x\ny",2\nz,3'),
    [1, 2, 4],
  )
  check(
    "① 중간 빈 줄은 레코드로 세지 않는다",
    cellsOf("a,b\n\n1,2\n"),
    [["a", "b"], ["1", "2"]],
  )
  check(
    "① 마지막 줄에 개행이 없어도 읽는다",
    cellsOf("a,b\n1,2"),
    [["a", "b"], ["1", "2"]],
  )

  // ── ② 시각 해석 ─────────────────────────────────────────────────────────
  checkTrue(
    "② 시간대 없는 값은 로컬로 읽는다(수기 폼과 같은 규약)",
    parseRecordTimestamp("2026-10-01 14:30") ===
      new Date("2026-10-01T14:30").toISOString(),
    `얻은 값 ${parseRecordTimestamp("2026-10-01 14:30")}`,
  )
  check("② Z 는 그대로 존중한다", parseRecordTimestamp("2026-10-01T14:30:00Z"), "2026-10-01T14:30:00.000Z")
  check("② 오프셋도 존중한다", parseRecordTimestamp("2026-10-01T23:30:00+09:00"), "2026-10-01T14:30:00.000Z")
  check("② T 와 공백을 같게 읽는다", parseRecordTimestamp("2026-10-01T14:30"), parseRecordTimestamp("2026-10-01 14:30"))
  check("② 초까지 받는다", parseRecordTimestamp("2026-10-01 14:30:45") !== null, true)
  check("② 날짜만 있으면 거부한다", parseRecordTimestamp("2026-10-01"), null)
  check("② 빈 값은 거부한다", parseRecordTimestamp("   "), null)
  check("② 말이 안 되는 값은 거부한다", parseRecordTimestamp("어제 아침"), null)
  // JS 의 Date 는 2026-02-30 을 3월 2일로 굴려 버린다. 그걸 통과시키면 기록지의
  // 오타가 **다른 날의 급이**로 저장된다.
  check("② 존재하지 않는 날짜는 거부한다(2월 30일)", parseRecordTimestamp("2026-02-30 09:00"), null)
  check("② 13월도 거부한다", parseRecordTimestamp("2026-13-01 09:00"), null)
  check("② 25시도 거부한다", parseRecordTimestamp("2026-10-01 25:00"), null)
  check("② 32일도 거부한다", parseRecordTimestamp("2026-10-32 09:00"), null)
  // 시간대가 붙은 값도 같은 기준으로 본다. 느슨하게 보면 2월 30일이 3월 2일로 저장된다.
  check("② 시간대가 붙어도 2월 30일은 거부한다", parseRecordTimestamp("2026-02-30T09:00:00Z"), null)
  check("② 시간대가 붙어도 32일은 거부한다", parseRecordTimestamp("2026-10-32T09:00:00+09:00"), null)
  // 2028 은 윤년, 2026 은 아니다. 윤년 판정이 달력대로여야 2월 29일이 갈린다.
  check("② 윤년의 2월 29일은 받는다", parseRecordTimestamp("2028-02-29 09:00") !== null, true)
  check("② 평년의 2월 29일은 거부한다", parseRecordTimestamp("2026-02-29 09:00"), null)

  // ── ③ 급이 기록지 ───────────────────────────────────────────────────────
  const feedOk = parseFeedCsv(FEED_CSV_TEMPLATE)
  check("③ 견본 서식이 그대로 통과한다", feedOk.errors, [])
  check("③ 견본은 2건이다", feedOk.records.length, 2)
  check("③ 견본의 급이량", feedOk.records.map((r) => r.feed_kg), [12.5, 13])
  check("③ 견본의 배치", feedOk.records.map((r) => r.batch_id), ["batch-001", "batch-001"])
  checkTrue("③ ts 는 ISO UTC 로 바뀐다", /Z$/.test(feedOk.records[0].ts), feedOk.records[0].ts)

  check(
    "③ 한국어 머리글도 받는다",
    parseFeedCsv("배치,시각,급이량\nb1,2026-10-01 08:00,5").records.length,
    1,
  )
  check(
    "③ 머리글 공백·대문자를 흡수한다",
    parseFeedCsv(" Batch_ID , TS , Feed KG \nb1,2026-10-01 08:00,5").records.length,
    1,
  )
  check(
    "③ 모르는 열은 무시한다",
    parseFeedCsv("batch_id,ts,feed_kg,작업자\nb1,2026-10-01 08:00,5,홍길동").records.length,
    1,
  )
  check(
    "③ 필수 열이 없으면 머리글에서 멈춘다",
    parseFeedCsv("batch_id,ts\nb1,2026-10-01 08:00").errors.map((e) => e.line),
    [1],
  )
  check("③ 빈 파일", parseFeedCsv("").errors.map((e) => e.message), ["빈 파일입니다."])

  const feedBad = parseFeedCsv(
    "batch_id,ts,feed_kg\n" +
      "b1,2026-10-01 08:00,5\n" + // 2행 정상
      ",2026-10-01 09:00,5\n" + // 3행 배치 없음
      "b1,어제,5\n" + // 4행 시각 불량
      "b1,2026-10-01 10:00,0\n" + // 5행 급이량 0
      "b1,2026-10-01 11:00,-3\n" + // 6행 음수
      "b1,2026-10-01 12:00,abc\n", // 7행 숫자 아님
  )
  check("③ 불량 줄 번호가 파일 줄 번호와 같다", feedBad.errors.map((e) => e.line), [3, 4, 5, 6, 7])
  check("③ 정상 줄은 그대로 해석된다", feedBad.records.length, 1)
  check("③ 데이터 줄 수를 센다", feedBad.dataLineCount, 6)

  // ── ④ 폐사 기록지 ───────────────────────────────────────────────────────
  const mortOk = parseMortalityCsv(MORTALITY_CSV_TEMPLATE)
  check("④ 견본 서식이 그대로 통과한다", mortOk.errors, [])
  check("④ 폐사 0 건도 유효하다(그날 폐사 없음도 증빙)", mortOk.records.map((r) => r.dead_count), [3, 0])
  check("④ 빈 메모는 null 이다", mortOk.records[1].cause_note, null)
  check("④ 메모는 그대로 실린다", mortOk.records[0].cause_note, "고수온 의심")

  const mortBad = parseMortalityCsv(
    "batch_id,ts,dead_count\n" +
      "b1,2026-10-01 09:00,0\n" + // 2행 정상(0 허용)
      "b1,2026-10-01 09:00,-1\n" + // 3행 음수
      "b1,2026-10-01 09:00,2.5\n" + // 4행 정수 아님
      "b1,2026-10-01 09:00,\n", // 5행 빈 값
  )
  check("④ 불량 줄 번호", mortBad.errors.map((e) => e.line), [3, 4, 5])
  check("④ 0 은 통과한다", mortBad.records.map((r) => r.dead_count), [0])
  check(
    "④ 메모에 쉼표가 있어도 따옴표로 묶으면 한 셀이다",
    parseMortalityCsv('batch_id,ts,dead_count,cause_note\nb1,2026-10-01 09:00,1,"고수온, 저산소"')
      .records[0].cause_note,
    "고수온, 저산소",
  )

  // ── ⑤ 따옴표 미종결 ─────────────────────────────────────────────────────
  const unterminated = parseMortalityCsv('batch_id,ts,dead_count,cause_note\nb1,2026-10-01 09:00,1,"열린 따옴표')
  checkTrue(
    "⑤ 닫히지 않은 따옴표를 오류로 알린다",
    unterminated.errors.length > 0 && unterminated.records.length === 0,
    JSON.stringify(unterminated),
  )

  // ── ⑥ 줄 번호 동행(lines) ───────────────────────────────────────────────
  // 업로드가 중간에 멈췄을 때 "몇 번째 줄" 을 추정하지 않고 말할 수 있어야 한다.
  check("⑥ lines 는 records 와 같은 길이다", feedOk.lines.length, feedOk.records.length)
  check("⑥ 견본의 줄 번호", feedOk.lines, [2, 3])
  // 따옴표 안 개행이 있으면 index+2 추정은 어긋난다 — lines 는 어긋나지 않아야 한다.
  const wrapped = parseMortalityCsv(
    'batch_id,ts,dead_count,cause_note\n' +
      'b1,2026-10-01 09:00,1,"첫 줄\n둘째 줄"\n' + // 2~3행에 걸친 한 레코드
      'b1,2026-10-02 09:00,2,메모\n', // 4행
  )
  check("⑥ 따옴표 안 개행 뒤 줄 번호가 실제 줄과 같다", wrapped.lines, [2, 4])
  checkTrue(
    "⑥ index+2 추정은 실제로 어긋난다(그래서 lines 가 필요하다)",
    wrapped.lines[1] !== 1 + 2,
    `lines[1]=${wrapped.lines[1]}, index+2=${3}`,
  )
  check("⑥ 불량 줄이 섞이면 lines 는 정상 줄만 가리킨다", feedBad.lines, [2])

  // ── ⑦ 같은 파일 안의 중복 ───────────────────────────────────────────────
  // 서버에 급이·폐사 중복 방지가 없어서, 복사·붙여넣기 중복이 FCR 분자를 두 배로 만든다.
  const dupFeed = parseFeedCsv(
    "batch_id,ts,feed_kg\n" +
      "b1,2026-10-01 08:00,5\n" + // 2행
      "b1,2026-10-01 08:00,5\n" + // 3행 — 완전 중복
      "b1,2026-10-01 09:00,5\n", // 4행 — 시각이 달라 정상
  )
  check("⑦ 배치·시각이 겹치는 줄을 오류로 잡는다", dupFeed.errors.map((e) => e.line), [3])
  checkTrue(
    "⑦ 중복 메시지가 처음 나온 줄을 가리킨다",
    dupFeed.errors[0].message.includes("2번째 줄"),
    dupFeed.errors[0].message,
  )
  check(
    "⑦ 배치가 다르면 같은 시각도 정상",
    parseFeedCsv("batch_id,ts,feed_kg\nb1,2026-10-01 08:00,5\nb2,2026-10-01 08:00,5").errors,
    [],
  )
  check(
    "⑦ 폐사도 같은 기준으로 본다",
    parseMortalityCsv(
      "batch_id,ts,dead_count\nb1,2026-10-01 09:00,1\nb1,2026-10-01 09:00,2",
    ).errors.map((e) => e.line),
    [3],
  )
  check(
    "⑧ 오류 목록은 줄 번호 순이다",
    parseFeedCsv(
      "batch_id,ts,feed_kg\n" +
        "b1,2026-10-01 08:00,5\n" + // 2행 정상
        "b1,2026-10-01 08:00,5\n" + // 3행 중복
        "b1,어제,5\n", // 4행 형식 불량
    ).errors.map((e) => e.line),
    [3, 4],
  )

  // ── ⑩ 출처(source) ──────────────────────────────────────────────────────
  // 스키마가 check (source in ('manual','csv','device')) 로 구분을 못 박아 두었고,
  // 라우트는 안 주면 'manual' 로 채운다. 기록지에서 온 값을 수기와 같은 출처로 적으면
  // 증빙에서 "어떻게 들어온 값인가" 가 사라진다.
  check("⑩ 급이 레코드에 source='csv' 가 붙는다", feedOk.records.map((r) => r.source), ["csv", "csv"])
  // 폐사는 mrv_mortality_logs 에 source 열이 없다. 없는 열을 보내면 PostgREST 가 거절한다.
  checkTrue(
    "⑩ 폐사 레코드에는 source 를 붙이지 않는다(열이 없다)",
    mortOk.records.every((r) => !("source" in r)),
    JSON.stringify(mortOk.records[0]),
  )

  // ── ⑪ 숫자 칸을 십진수로만 읽는다 ──────────────────────────────────────
  // Number() 를 그냥 쓰면 0x10 이 16 kg 으로 통과한다.
  check(
    "⑪ 16진수 표기는 거부한다",
    parseFeedCsv("batch_id,ts,feed_kg\nb1,2026-10-01 08:00,0x10").errors.length,
    1,
  )
  check(
    "⑪ 지수 표기도 거부한다",
    parseFeedCsv("batch_id,ts,feed_kg\nb1,2026-10-01 08:00,1e3").errors.length,
    1,
  )
  check(
    "⑪ 공백만 있는 칸도 거부한다",
    parseFeedCsv("batch_id,ts,feed_kg\nb1,2026-10-01 08:00,   ").errors.length,
    1,
  )
  checkTrue(
    "⑪ 천단위 쉼표에는 그 이유를 알려 준다",
    parseFeedCsv('batch_id,ts,feed_kg\nb1,2026-10-01 08:00,"1,250"').errors[0].message.includes(
      "천단위 쉼표",
    ),
    parseFeedCsv('batch_id,ts,feed_kg\nb1,2026-10-01 08:00,"1,250"').errors[0].message,
  )
  check(
    "⑪ 소수점은 그대로 받는다",
    parseFeedCsv("batch_id,ts,feed_kg\nb1,2026-10-01 08:00,12.5").records[0].feed_kg,
    12.5,
  )

  // ── ⑫ 파일 중간에서 따옴표가 열린 경우 ─────────────────────────────────
  // 그 뒤 모든 줄이 한 필드로 삼켜진다. "이후를 해석하지 못했다" 를 말해야
  // 운영자가 "데이터가 한 줄뿐인 파일" 로 오해하지 않는다.
  const midOpen = parseFeedCsv(
    "batch_id,ts,feed_kg\n" +
      "b1,2026-10-01 08:00,5\n" + // 2행 정상
      'b2,"열린 따옴표,7\n' + // 3행에서 따옴표가 열린다
      "b3,2026-10-03 08:00,9\n", // 4행 — 삼켜진다
  )
  checkTrue(
    "⑫ 미종결 따옴표를 오류로 알린다",
    midOpen.errors.length >= 1,
    JSON.stringify(midOpen.errors),
  )
  checkTrue(
    "⑫ '이 줄과 그 이후는 해석하지 못했습니다' 를 적는다",
    midOpen.errors.some((e) => e.message.includes("이후는 해석하지 못했습니다")),
    JSON.stringify(midOpen.errors),
  )
  check("⑫ 삼켜진 줄은 레코드로 나가지 않는다", midOpen.records.length, 1)

  // ── ⑬ 중간 빈 줄에서도 줄 번호가 어긋나지 않는다 ───────────────────────
  const blanks = parseFeedCsv(
    "batch_id,ts,feed_kg\n" +
      "b1,2026-10-01 08:00,5\n" + // 2행
      "\n\n" + // 3·4행 빈 줄
      "b2,2026-10-02 08:00,6\n", // 5행
  )
  check("⑬ 빈 줄을 건너뛰고 실제 줄 번호를 지킨다", blanks.lines, [2, 5])
  checkTrue(
    "⑬ index+2 추정은 여기서도 어긋난다",
    blanks.lines[1] !== 1 + 2,
    `lines[1]=${blanks.lines[1]}`,
  )

  // ── ⑨ 전부-또는-무 규칙(호출 측 계약) ───────────────────────────────────
  // 파서는 정상 줄과 오류를 함께 돌려준다. "오류가 하나라도 있으면 아무것도 보내지
  // 않는다" 는 결정은 화면이 `errors.length > 0` 으로 내린다. 그 판단에 필요한 정보가
  // 빠짐없이 들어 있는지를 확인한다.
  checkTrue(
    "⑨ 오류가 있는 파일은 errors 가 비어 있지 않다",
    feedBad.errors.length > 0,
  )
  checkTrue(
    "⑨ 모든 오류에 줄 번호와 사유가 있다",
    [...feedBad.errors, ...mortBad.errors].every(
      (e) => Number.isInteger(e.line) && e.line > 0 && typeof e.message === "string" && e.message.length > 0,
    ),
  )

  // ── ⑩ 전력 기록지 ───────────────────────────────────────────────────────
  // 전력은 EI·폭기 EI·Scope2·기준선의 유일한 근거이고, 이 운영에서는 사람이 넣는다.
  // 그래서 "틀린 줄을 거부하는가" 뿐 아니라 **"조용히 산입에서 빠지는 파일을 미리
  // 막는가"** 까지 본다 — 저장은 됐는데 KPI 가 그대로인 실패가 가장 알아채기 어렵다.
  const powerOk = parsePowerCsv(POWER_INTERVAL_CSV_TEMPLATE, "interval_kwh")
  check("⑩ 구간 사용량 견본이 그대로 해석된다", powerOk.errors, [])
  check("⑩ 견본 4줄", powerOk.records.length, 4)
  check("⑩ 표현이 모든 행에 같게 붙는다", [...new Set(powerOk.records.map((r) => r.reading_kind))], [
    "interval_kwh",
  ])
  // 견본 서식에는 자료유형 열이 들어 있으므로 그 칸까지 그대로 실린다(⑪ 참고).
  check("⑩ 계측기·값을 그대로 싣는다", powerOk.records[0], {
    meter_id: "meter-total",
    ts: "2026-10-01T00:00:00.000Z",
    value: 412.5,
    reading_kind: "interval_kwh",
    measurement_basis: "metered",
  })
  check(
    "⑩ 한국어 머리글(계량기·지침)도 받는다",
    parsePowerCsv("계측기,시각,사용량\nm1,2026-10-01 00:00,12.5", "interval_kwh").records.length,
    1,
  )
  // 0 은 실제 계측이다(돌리지 않은 날). 거부하면 운영자가 줄을 비우게 되고, 그러면
  // 계측이 끊긴 것과 구분되지 않는다.
  check(
    "⑩ 0 kWh 는 받는다",
    parsePowerCsv("meter_id,ts,value\nm1,2026-10-01 00:00,0", "interval_kwh").records.length,
    1,
  )
  check(
    "⑩ 음수는 거부한다",
    parsePowerCsv("meter_id,ts,value\nm1,2026-10-01 00:00,-3", "interval_kwh").errors.map((e) => e.line),
    [2],
  )
  check(
    "⑩ 계측기가 비면 거부한다",
    parsePowerCsv("meter_id,ts,value\n,2026-10-01 00:00,5", "interval_kwh").errors.map((e) => e.line),
    [2],
  )
  check(
    "⑩ 같은 계측기·시각 중복은 거부한다",
    parsePowerCsv(
      "meter_id,ts,value\nm1,2026-10-01 00:00,5\nm1,2026-10-01 00:00,6",
      "interval_kwh",
    ).errors.length > 0,
    true,
  )
  // 다른 계측기의 같은 시각은 정상이다(총전력계와 폭기계를 같은 시각에 검침한다).
  check(
    "⑩ 다른 계측기의 같은 시각은 정상",
    parsePowerCsv(
      "meter_id,ts,value\nm1,2026-10-01 00:00,5\nm2,2026-10-01 00:00,6",
      "interval_kwh",
    ).errors,
    [],
  )
  check(
    "⑩ 필요한 열이 없으면 알린다",
    parsePowerCsv("meter_id,ts\nm1,2026-10-01 00:00", "interval_kwh").errors.length > 0,
    true,
  )

  // 적산 지침: 계측기당 2건 이상이어야 구간값이 나온다(ADR 0001 — 원 카운터는 되살릴 수
  // 없으므로 Δ는 같은 배치 안에서만 계산된다).
  const cumOk = parsePowerCsv(POWER_CUMULATIVE_CSV_TEMPLATE, "cumulative_kwh")
  check("⑩ 적산 지침 견본이 그대로 해석된다", cumOk.errors, [])
  check("⑩ 적산 표현이 붙는다", cumOk.records[0].reading_kind, "cumulative_kwh")
  const cumSingle = parsePowerCsv(
    "meter_id,ts,value\nm1,2026-10-01 00:00,128430",
    "cumulative_kwh",
  )
  checkTrue(
    "⑩ 지침이 1건뿐이면 보내기 전에 막는다",
    cumSingle.errors.length === 1,
    JSON.stringify(cumSingle.errors),
  )
  checkTrue(
    "⑩ 그 사유가 '직전 지침을 함께' 를 알려 준다",
    cumSingle.errors[0].message.includes("직전 지침"),
    cumSingle.errors[0]?.message,
  )
  // 한 계측기만 1건이면 그 계측기만 걸린다 — 나머지를 함께 막지 않는다.
  const cumMixed = parsePowerCsv(
    "meter_id,ts,value\nm1,2026-10-01 00:00,100\nm1,2026-10-02 00:00,150\nm2,2026-10-01 00:00,200",
    "cumulative_kwh",
  )
  check("⑩ 2건 있는 계측기는 통과, 1건인 계측기만 걸린다", cumMixed.errors.length, 1)
  checkTrue(
    "⑩ 걸린 계측기 이름을 지목한다",
    cumMixed.errors[0].message.includes("m2"),
    cumMixed.errors[0]?.message,
  )
  // 구간 사용량에는 이 제약이 없다 — 1건만으로도 그 자체가 사용량이다.
  check(
    "⑩ 구간 사용량은 1건도 정상",
    parsePowerCsv("meter_id,ts,value\nm1,2026-10-01 00:00,12.5", "interval_kwh").errors,
    [],
  )

  // ── ⑪ 전력 기록지의 자료유형 열 ─────────────────────────────────────────
  // 이 열이 없으면 **계량기 실측과 산식으로 계산한 값이 DB 에서 구분되지 않는다**
  // (supabase/migrations/mrv_readings_measurement_basis.sql). 그래서 ① 읽을 수 있는 표기는
  // 전부 읽고, ② 읽을 수 없는 값은 **넘겨짚지 않고 그 줄을 막고**, ③ 빈 칸은 「파일에
  // 없음」으로 남겨 화면에서 고른 값이 쓰이게 한다 — 세 가지가 이 검증의 항목이다.
  const basisMixed = parsePowerCsv(
    "meter_id,ts,value,measurement_basis\n" +
      "m1,2026-10-01 00:00,10,실측\n" +
      "m1,2026-10-02 00:00,11,계산값\n" +
      "m1,2026-10-03 00:00,12,어림값\n" +
      "m1,2026-10-04 00:00,13,metered\n" +
      "m1,2026-10-05 00:00,14,\n",
    "interval_kwh",
  )
  check("⑪ 자료유형이 섞인 파일도 오류가 없다", basisMixed.errors, [])
  check(
    "⑪ 한국어·영문 표기를 모두 읽고, 빈 칸은 칸 자체를 넣지 않는다",
    basisMixed.records.map((r) => r.measurement_basis ?? null),
    ["metered", "calculated", "estimated", "metered", null],
  )
  // 모르는 값을 그럴듯한 쪽으로 넘겨짚으면 "실측 아님" 이 실측으로 저장된다.
  const basisUnknown = parsePowerCsv(
    "meter_id,ts,value,measurement_basis\nm1,2026-10-01 00:00,10,실측여부\n",
    "interval_kwh",
  )
  check("⑪ 모르는 자료유형은 그 줄을 막는다", basisUnknown.errors.length, 1)
  check("⑪ 막힌 줄은 레코드로 나가지 않는다", basisUnknown.records.length, 0)
  checkTrue(
    "⑪ 사유에 읽을 수 없던 값이 그대로 적힌다",
    basisUnknown.errors[0].message.includes("실측여부"),
    basisUnknown.errors[0]?.message,
  )
  // 열이 아예 없는 파일은 종전과 똑같이 해석된다(이 열은 선택이다).
  const basisAbsent = parsePowerCsv(
    "meter_id,ts,value\nm1,2026-10-01 00:00,10\n",
    "interval_kwh",
  )
  check("⑪ 자료유형 열이 없어도 해석된다", basisAbsent.errors, [])
  check(
    "⑪ 열이 없으면 칸을 만들지 않는다(화면에서 고른 값이 쓰인다)",
    basisAbsent.records[0].measurement_basis ?? null,
    null,
  )
  // 한국어 머리글도 받는다(기존 별칭 방식 그대로).
  const basisKoHeader = parsePowerCsv(
    "계측기,시각,사용량,자료유형\nm1,2026-10-01 00:00,10,계산값\n",
    "interval_kwh",
  )
  check("⑪ 한국어 머리글(자료유형)도 받는다", basisKoHeader.errors, [])
  check(
    "⑪ 그 값이 정규 값으로 들어온다",
    basisKoHeader.records[0].measurement_basis,
    "calculated",
  )
  // 견본 서식에 그 열이 들어 있어야 한다 — 없으면 쓸 수 있다는 사실을 아무도 모른다.
  checkTrue(
    "⑪ 두 전력 견본 서식이 자료유형 열을 담는다",
    POWER_INTERVAL_CSV_TEMPLATE.includes("measurement_basis") &&
      POWER_CUMULATIVE_CSV_TEMPLATE.includes("measurement_basis"),
  )
  check(
    "⑪ 견본 서식이 그대로 해석된다(구간)",
    parsePowerCsv(POWER_INTERVAL_CSV_TEMPLATE, "interval_kwh").errors,
    [],
  )

  // ── ⑫ 생산량 기록지 — 산정 근거가 필수인 창구 ─────────────────────────
  //
  // 전력 기록지와 **다른 규칙**이라 따로 본다. 전력의 자료유형은 선택이고(파일에 없으면
  // 화면에서 고른 값이 쓰인다) 생산량의 산정 근거는 **필수**다 — 개시·마감 두 점이
  // "하나는 출하 전표, 하나는 입식수 × 평균체중" 인 것이 정상이라 한 값으로 뭉갤 수 없다.
  const harvestOk = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis,production_basis_note,survival_adjusted\n" +
      "b1,2026-08-01 09:00,1200,계산생체량,입식 100000미 × 12g,미적용\n" +
      "b1,2026-10-16 09:00,3500,실측,출하 전표,\n",
  )
  check("⑫ 정상 파일은 오류가 없다", harvestOk.errors, [])
  check("⑫ 두 줄을 읽는다", harvestOk.records.length, 2)
  check(
    "⑫ 한국어 산정 근거가 정규 값으로 들어온다",
    harvestOk.records.map((r) => r.production_basis),
    ["calculated", "measured"],
  )
  check(
    "⑫ '미적용' 은 false 로, 빈 칸은 null(미기재)로 — 둘은 다른 사실이다",
    harvestOk.records.map((r) => r.survival_adjusted),
    [false, null],
  )
  check(
    "⑫ 산정 근거 상세가 그대로 실린다",
    harvestOk.records[0].production_basis_note,
    "입식 100000미 × 12g",
  )

  // 산정 근거 열이 없으면 **머리글 오류**다(전력과 다른 점).
  const harvestNoBasisCol = parseHarvestCsv(
    "batch_id,ts,biomass_kg\nb1,2026-08-01 09:00,1200\n",
  )
  checkTrue(
    "⑫ 산정 근거 열이 없으면 머리글 오류이고 아무것도 내보내지 않는다",
    harvestNoBasisCol.errors.length === 1 && harvestNoBasisCol.records.length === 0,
    JSON.stringify(harvestNoBasisCol.errors),
  )

  // 칸이 비어 있어도 넘겨짚지 않는다 — 넘겨짚으면 계산생체량이 실측으로 저장된다.
  const harvestEmptyBasis = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\nb1,2026-08-01 09:00,1200,\n",
  )
  checkTrue(
    "⑫ 산정 근거 칸이 비면 그 줄이 오류다(기본값으로 메우지 않는다)",
    harvestEmptyBasis.records.length === 0 && harvestEmptyBasis.errors.length === 1,
    JSON.stringify(harvestEmptyBasis.errors),
  )

  // 모르는 값도 넘겨짚지 않는다.
  const harvestBadBasis = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\nb1,2026-08-01 09:00,1200,아마도 실측\n",
  )
  checkTrue(
    "⑫ 읽을 수 없는 산정 근거는 그 줄을 오류로 센다",
    harvestBadBasis.records.length === 0 && harvestBadBasis.errors.length === 1,
    JSON.stringify(harvestBadBasis.errors),
  )

  // 계산·어림인데 근거가 없으면 거절한다 — 근거 없는 딱지는 검산할 수 없는 주장이다.
  const harvestNoNote = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\nb1,2026-08-01 09:00,1200,계산생체량\n",
  )
  checkTrue(
    "⑫ 계산생체량에 근거가 없으면 그 줄을 거절한다",
    harvestNoNote.records.length === 0 && harvestNoNote.errors.length === 1,
    JSON.stringify(harvestNoNote.errors),
  )
  // 실측은 근거 없이도 통과한다(저울에 올린 값에 '무엇으로 계산했나' 는 없다).
  const harvestMeasuredNoNote = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\nb1,2026-08-01 09:00,1200,실측\n",
  )
  check("⑫ 실측은 근거 없이도 통과한다", harvestMeasuredNoNote.errors, [])
  check(
    "⑫ 그때 근거는 null 이다",
    harvestMeasuredNoNote.records[0].production_basis_note,
    null,
  )

  // 생체량 0 은 받지 않는다 — 폐사 0 건과 다르다(분모의 한쪽 끝으로 뽑히면 기간에 없던
  // 생산량이 산출된다).
  const harvestZero = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\nb1,2026-08-01 09:00,0,실측\n",
  )
  checkTrue(
    "⑫ 생체량 0 은 거절한다(전력의 0 kWh 와 다르다)",
    harvestZero.records.length === 0 && harvestZero.errors.length === 1,
    JSON.stringify(harvestZero.errors),
  )

  // 생존율 보정 칸을 읽을 수 없으면 그 줄이 오류다.
  const harvestBadSurvival = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis,survival_adjusted\nb1,2026-08-01 09:00,1200,실측,아마도\n",
  )
  checkTrue(
    "⑫ 읽을 수 없는 생존율 보정 값은 그 줄을 오류로 센다",
    harvestBadSurvival.records.length === 0 && harvestBadSurvival.errors.length === 1,
    JSON.stringify(harvestBadSurvival.errors),
  )

  // 한국어 머리글(받은 계산표의 칸 이름 그대로).
  const harvestKoHeader = parseHarvestCsv(
    "배치,시각,생산량,생산량_산정유형,계산근거,생존율보정_적용여부\n" +
      "b1,2026-08-01 09:00,3500,입식수×최종체중,입식 100000미 × 35g,미적용\n",
  )
  check("⑫ 한국어 머리글도 받는다", harvestKoHeader.errors, [])
  check(
    "⑫ 받은 계산표의 표기가 calculated 로 들어온다",
    harvestKoHeader.records[0].production_basis,
    "calculated",
  )
  check("⑫ 생체량도 같은 줄에서 읽힌다", harvestKoHeader.records[0].biomass_kg, 3500)

  // 같은 파일 안의 (배치, 시각) 중복은 급이·폐사와 같은 기준으로 막는다.
  const harvestDup = parseHarvestCsv(
    "batch_id,ts,biomass_kg,production_basis\n" +
      "b1,2026-08-01 09:00,1200,실측\n" +
      "b1,2026-08-01 09:00,1300,실측\n",
  )
  checkTrue(
    "⑫ 같은 배치·시각의 중복 줄을 막는다",
    harvestDup.errors.length === 1 && harvestDup.errors[0].line === 3,
    JSON.stringify(harvestDup.errors),
  )

  // 견본 서식이 그대로 해석돼야 한다 — 안 되면 내려 준 견본이 올리면 오류가 되는 파일이다.
  check("⑫ 견본 서식이 그대로 해석된다", parseHarvestCsv(HARVEST_CSV_TEMPLATE).errors, [])
  checkTrue(
    "⑫ 견본 서식이 두 점의 산정 근거를 다르게 적어 둔다(개시 계산 · 마감 실측)",
    (() => {
      const r = parseHarvestCsv(HARVEST_CSV_TEMPLATE).records
      return r.length === 2 && r[0].production_basis !== r[1].production_basis
    })(),
  )

  if (failures.length > 0) {
    console.error(`✗ 기록지 CSV 검증 실패 — ${failures.length}건\n`)
    for (const f of failures) console.error("  " + f)
    process.exitCode = 1
  } else {
    console.log(
      `✓ 기록지 CSV 해석 검증 통과 — ${checked}개 항목 ` +
        `(원본에 없던 기능이라 차분 검증이 아니라 사양 기반 단위 검증이다)`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
