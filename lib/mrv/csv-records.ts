/**
 * 표준 기록지(CSV) 해석 — MASTER 4장 화면 #4 「수동 입력 폼 + 표준 기록지(CSV 업로드)
 * + 입력 검증」의 해석·검증 부분.
 *
 * 순수 함수만 둔다(네트워크·DOM 없음). 그래서 이 규칙을 화면 밖에서도 그대로 돌려 볼 수
 * 있다 — `scripts/mrv/verify-csv.mjs` 가 이 파일을 직접 불러 검증한다.
 *
 * **왜 보내기 전에 전부 검사하는가.** 급이·폐사는 FCR 과 폐사율의 분자다. 80번째 줄에
 * 오타가 있는 파일을 한 줄씩 보내면 79줄이 들어간 뒤 멈추고, 운영자는 어디까지 들어갔는지
 * 모르는 채 같은 파일을 다시 올려 중복을 만든다. 그래서 **한 줄이라도 틀리면 아무것도
 * 보내지 않는다**(all-or-nothing on validation). 서버 검증을 대신하는 것이 아니라,
 * 서버에 보내기 전에 사람이 고칠 수 있게 하는 것이다 — 최종 판정은 서버가 한다.
 *
 * **시각 규약.** 시간대를 적지 않은 값은 **브라우저 로컬 시각**으로 읽는다. 수기 입력
 * 폼(`datetime-local`)과 같은 규약이어서, 같은 "2026-10-01 14:30" 을 폼으로 넣든 CSV 로
 * 넣든 같은 순간이 저장된다. `Z` 나 `+09:00` 이 붙어 있으면 그대로 존중한다.
 * (KPI 기간 경계는 UTC 지만, 그 변환은 여기서 ISO UTC 로 만들어 보내므로 한 번만 일어난다.)
 */

/** 해석된 급이 1건 — POST /sites/{id}/feed-logs 본문 그대로. */
export interface FeedCsvRecord {
  batch_id: string;
  /** ISO8601 UTC */
  ts: string;
  feed_kg: number;
  /**
   * 출처. 스키마가 `check (source in ('manual','csv','device'))` 로 구분을 못 박아 두었고
   * (`mrv_feed_logs`), 라우트는 안 주면 'manual' 로 채운다. 기록지에서 일괄 들어온 값을
   * 수기 입력과 같은 출처로 적으면 **증빙에서 "누가 어떻게 넣은 값인가" 가 사라진다.**
   * 감사 로그에도 이 값이 실린다.
   */
  source: "csv";
}

/**
 * 해석된 폐사 1건 — POST /sites/{id}/mortality-logs 본문 그대로.
 *
 * 급이와 달리 `source` 가 없다. `mrv_mortality_logs` 에 그 열이 없기 때문이고
 * (`mrv_feed_logs` 에만 있다), 열을 새로 뚫는 것은 마이그레이션이 필요한 별건이다.
 * 없는 열을 보내면 PostgREST 가 그 요청을 거절한다.
 */
export interface MortalityCsvRecord {
  batch_id: string;
  /** ISO8601 UTC */
  ts: string;
  dead_count: number;
  cause_note: string | null;
}

/** 전력 기록지가 쓸 수 있는 계측 원표현. 파일 하나에 한 가지만 쓴다(아래 설명 참고). */
export type PowerReadingKind = "interval_kwh" | "cumulative_kwh";

/**
 * 해석된 전력 계측값 1건 — POST /sites/{id}/readings 의 `readings[]` 원소 그대로.
 *
 * **표현을 행마다 섞지 않는 이유.** 적산 지침과 구간 사용량은 같은 숫자가 전혀 다른 뜻이다
 * (12,345 는 "계량기가 12,345 를 가리킨다" 이거나 "12,345 kWh 를 썼다" 이다). 기록지는
 * 사람이 손으로 채우는 종이에 가까우므로, 한 파일 안에서 행마다 뜻이 바뀌면 틀린 해석이
 * 조용히 저장된다. 그래서 표현은 **업로드 단위로 한 번** 고르고 모든 행에 같게 적는다.
 */
export interface PowerCsvRecord {
  meter_id: string;
  /** ISO8601 UTC */
  ts: string;
  value: number;
  reading_kind: PowerReadingKind;
}

/** 줄 단위 오류. `line` 은 **파일의 실제 줄 번호**(헤더 포함, 1부터)다 — 운영자가 에디터에서 바로 찾아간다. */
export interface CsvRowError {
  line: number;
  message: string;
}

export interface CsvParseResult<T> {
  records: T[];
  /**
   * `records[i]` 가 온 **파일의 실제 줄 번호**. 레코드와 같은 순서·같은 길이다.
   *
   * 레코드 객체 안에 넣지 않는 이유: 레코드는 POST 본문으로 그대로 나가므로 화면용 필드를
   * 섞으면 서버에 쓸데없는 값을 보낸다. 번호를 따로 들고 다니는 이유: 업로드가 중간에
   * 멈췄을 때 "몇 번째 줄에서 멈췄는가" 를 `index + 2` 로 **추정**하면 따옴표 안 개행이
   * 있는 파일에서 어긋난 줄을 가리킨다 — 운영자가 엉뚱한 줄을 고치게 된다.
   */
  lines: number[];
  errors: CsvRowError[];
  /** 해석을 시도한 데이터 줄 수(헤더·빈 줄 제외). */
  dataLineCount: number;
}

/** 분해 결과. 따옴표가 끝까지 닫히지 않았다는 사실을 셀 값이 아니라 **별도 필드**로 알린다. */
export interface CsvSplitResult {
  rows: { cells: string[]; line: number }[];
  /**
   * 닫히지 않은 따옴표가 시작된 줄. null 이면 정상이다.
   *
   * 예전에는 이것을 `cells[0] === "__UNTERMINATED_QUOTE__"` 라는 **대역 내 신호**로
   * 알렸다. 그러면 첫 셀에 그 문자열이 실제로 적힌 데이터 줄이 따옴표 오류로 보고된다 —
   * 현실성은 낮지만 공짜로 없앨 수 있는 함정이다.
   */
  unterminatedAtLine: number | null;
}

/**
 * RFC4180 계열 CSV 분해. 따옴표 안의 쉼표·개행·이중따옴표(`""`)를 처리한다.
 * 결과는 "줄별 셀 배열 + 그 줄이 시작한 파일 줄 번호" 다 — 따옴표 안 개행 때문에
 * 레코드 번호와 파일 줄 번호가 어긋나므로 줄 번호를 따로 들고 다녀야 한다.
 */
export function splitCsvRows(text: string): CsvSplitResult {
  // Excel(한국어 환경)이 저장한 UTF-8 CSV 앞에는 BOM 이 붙는다. 그대로 두면 첫 헤더가
  // "﻿batch_id" 가 되어 어떤 헤더도 못 찾는다.
  const src = text.replace(/^﻿/, "");

  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let rowHasContent = false;

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // 완전히 빈 줄은 레코드로 세지 않는다(파일 끝 개행, 중간 공백 줄).
    if (rowHasContent) rows.push({ cells, line: rowStartLine });
    cells = [];
    rowHasContent = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (ch === "\r") {
        // 따옴표 안의 CRLF. CR 을 값에 남기면 `cause_note` 안에 \r 이 섞인 채 DB 로 간다.
        // 줄바꿈 자체는 보존해야 하므로(메모를 여러 줄로 적었을 수 있다) \n 하나로 모은다.
        if (src[i + 1] === "\n") i += 1;
        line += 1;
        field += "\n";
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      rowHasContent = true;
      continue;
    }
    if (ch === ",") {
      endField();
      rowHasContent = true;
      continue;
    }
    if (ch === "\r") {
      // CRLF 의 CR 은 버린다. 단독 CR 개행은 다루지 않는다(현실에서 나오지 않는다).
      continue;
    }
    if (ch === "\n") {
      endRow();
      line += 1;
      rowStartLine = line;
      continue;
    }
    if (ch.trim() !== "") rowHasContent = true;
    field += ch;
  }
  // 마지막 줄이 개행 없이 끝난 경우.
  if (inQuotes) {
    // 따옴표가 닫히지 않았다. **그 줄은 레코드로 내보내지 않는다** — 어디서 끝나야 했는지
    // 알 수 없는 줄을 그럴듯한 값으로 내보내면, 잘려 나간 뒷부분이 조용히 사라진 채
    // 저장된다. 지금까지 온전히 닫힌 줄만 남기고(머리글은 그 안에 있다) 오류를 알린다.
    //
    // 중요: 따옴표가 **파일 중간**에서 열렸다면 그 뒤 모든 줄이 한 필드로 삼켜져 여기 온다.
    // 그래서 "이 줄 이후는 해석하지 못했다" 를 호출 측이 말할 수 있어야 한다.
    return { rows, unterminatedAtLine: rowStartLine };
  }
  endRow();
  return { rows, unterminatedAtLine: null };
}

/** 헤더 이름 정규화 — 공백·대소문자·하이픈 차이를 흡수한다. */
function normalizeHeader(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * 헤더 별칭. 운영자가 받는 기록지가 한국어일 수도 있고, 영문 컬럼명을 쓸 수도 있다.
 * 둘 다 받되 **뜻이 하나로 모이는 이름만** 받는다(예: "수량" 처럼 급이량인지 개체수인지
 * 알 수 없는 이름은 받지 않는다 — 잘못 붙으면 틀린 값이 조용히 저장된다).
 */
const HEADER_ALIASES: Record<string, string> = {
  batch_id: "batch_id",
  batch: "batch_id",
  배치: "batch_id",
  배치id: "batch_id",
  배치_id: "batch_id",
  ts: "ts",
  time: "ts",
  timestamp: "ts",
  datetime: "ts",
  시각: "ts",
  일시: "ts",
  기록시각: "ts",
  feed_kg: "feed_kg",
  급이량: "feed_kg",
  급이량_kg: "feed_kg",
  사료량: "feed_kg",
  사료량_kg: "feed_kg",
  dead_count: "dead_count",
  폐사: "dead_count",
  폐사수: "dead_count",
  폐사개체수: "dead_count",
  cause_note: "cause_note",
  note: "cause_note",
  메모: "cause_note",
  원인: "cause_note",
  원인메모: "cause_note",
  meter_id: "meter_id",
  meter: "meter_id",
  계측기: "meter_id",
  계측기id: "meter_id",
  계측기_id: "meter_id",
  계량기: "meter_id",
  // 전력값 열. "값"·"수치" 처럼 뜻이 모이지 않는 이름은 받지 않는다 — 적산 지침인지
  // 구간 사용량인지 알 수 없는 이름이 붙으면 틀린 해석이 조용히 저장된다. 표현은
  // 업로드 단위로 고르므로, 열 이름은 둘 중 어느 표현에서도 읽히는 것만 받는다.
  value: "value",
  kwh: "value",
  전력량: "value",
  전력량_kwh: "value",
  사용량: "value",
  사용량_kwh: "value",
  지침: "value",
  계량기지침: "value",
};

function mapHeaders(cells: string[]): Map<string, number> {
  const index = new Map<string, number>();
  cells.forEach((raw, i) => {
    const canonical = HEADER_ALIASES[normalizeHeader(raw)];
    // 같은 뜻의 열이 두 번 나오면 첫 번째만 쓴다(뒤엣것을 쓰면 왼쪽을 읽은 사람의
    // 기대와 어긋난다). 알 수 없는 열은 무시한다 — 기록지에 메모 열이 더 있을 수 있다.
    if (canonical && !index.has(canonical)) index.set(canonical, i);
  });
  return index;
}

/** (y, m, d) 가 달력에 실제로 있는 날짜인가. 윤년까지 본다. */
function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  // Date.UTC 로 만든 뒤 되읽어 비교한다 — 시간대와 무관하게 달력만 본다.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() + 1 === m && probe.getUTCDate() === d
  );
}

/**
 * 시각 해석. 시간대 표기가 없으면 로컬로 읽는다(수기 폼과 같은 규약).
 * 받아들이는 모양: `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS]`, 그리고 뒤에
 * `Z` 또는 `±HH:MM` 이 붙은 형태.
 */
export function parseRecordTimestamp(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const normalized = value.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/.test(normalized)) return null;

  // 존재하지 않는 날짜(예: 2026-02-30)를 JS 가 다음 달로 굴려 버리는 것을 막는다.
  // **시간대가 붙어 있든 없든 똑같이 본다** — 날짜 부분은 어느 경우에도 그 표기의
  // 달력 날짜이므로, 한쪽만 느슨하게 보면 `2026-02-30T09:00:00Z` 가 3월 2일로 저장된다.
  const [datePart] = normalized.split("T");
  const [y, m, day] = datePart.split("-").map(Number);
  if (!isRealCalendarDate(y, m, day)) return null;

  // 시간대가 없으면 `new Date("2026-10-01T14:30")` 가 로컬로 해석한다(ES2015 이후 규약).
  // 날짜만 있는 문자열은 UTC 로 해석되므로 위 정규식으로 미리 걸러 뒀다.
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

type FieldSpec = { canonical: string; label: string };

function readRequiredHeaders(
  rows: { cells: string[]; line: number }[],
  required: FieldSpec[],
): { index: Map<string, number>; headerLine: number } | CsvRowError {
  if (rows.length === 0) return { line: 1, message: "빈 파일입니다." };

  const index = mapHeaders(rows[0].cells);
  const missing = required.filter((f) => !index.has(f.canonical));
  if (missing.length > 0) {
    return {
      line: rows[0].line,
      message: `머리글에 ${missing.map((f) => `'${f.label}'`).join(", ")} 열이 없습니다.`,
    };
  }
  return { index, headerLine: rows[0].line };
}

function cell(cells: string[], index: Map<string, number>, key: string): string {
  const i = index.get(key);
  return i === undefined ? "" : (cells[i] ?? "").trim();
}

/**
 * 십진수만 받는다. `Number()` 를 그냥 쓰면 `0x10` 이 **16 kg 으로 통과**하고 `1e-9` 도
 * 통과한다 — 기록지에 그런 값이 적힐 이유가 없으므로, 적혀 있다면 다른 것을 잘못 붙인
 * 것이고 통과시키면 틀린 급이량이 저장된다.
 */
function parseDecimal(raw: string): number | null {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 숫자 칸 오류 문구 — Excel 이 흔히 넣는 천단위 쉼표를 따로 짚어 준다. */
function numberFieldError(raw: string, requirement: string): string {
  const hint = /^\s*[+-]?[\d,]+(?:\.\d+)?\s*$/.test(raw) && raw.includes(",")
    ? " 천단위 쉼표(,)는 빼고 적어 주세요."
    : "";
  return `${requirement}: '${raw}'${hint}`;
}

/**
 * 같은 파일 안에서 (배치, 시각) 이 겹치는 줄을 찾는다.
 *
 * **이것을 오류로 다루는 이유.** 같은 배치의 같은 시각에 급이가 두 번 기록될 일은 없다 —
 * 기록지를 복사·붙여넣다 생긴 중복이 거의 전부다. 그런데 서버에는 이 두 창구에 중복
 * 방지가 없으므로(계측값 적재와 달리), 그대로 보내면 **FCR 의 분자가 조용히 두 배가 된다.**
 * 틀린 KPI 를 만드는 쪽이 올리지 못하게 막는 쪽보다 훨씬 나쁘므로 거절한다.
 */
function findDuplicateKeys(
  entries: { key: string; line: number }[],
): CsvRowError[] {
  const firstSeen = new Map<string, number>();
  const errors: CsvRowError[] = [];
  for (const { key, line } of entries) {
    const prev = firstSeen.get(key);
    if (prev === undefined) {
      firstSeen.set(key, line);
    } else {
      errors.push({
        line,
        message: `${prev}번째 줄과 배치·시각이 같습니다(같은 파일 안의 중복).`,
      });
    }
  }
  return errors;
}

/**
 * 닫히지 않은 따옴표 오류 문구. 그 줄 **이후가 통째로 해석되지 않았다**는 사실을 함께
 * 적는다 — 적지 않으면 "데이터가 몇 줄뿐인 파일" 로 오해한다.
 */
function unterminatedError(line: number): CsvRowError {
  return {
    line,
    message:
      '따옴표(")가 닫히지 않았습니다. 이 줄과 그 이후는 해석하지 못했습니다.',
  };
}

/** 급이 기록지 해석. */
export function parseFeedCsv(text: string): CsvParseResult<FeedCsvRecord> {
  const { rows, unterminatedAtLine } = splitCsvRows(text);
  const header = readRequiredHeaders(rows, [
    { canonical: "batch_id", label: "batch_id(배치)" },
    { canonical: "ts", label: "ts(시각)" },
    { canonical: "feed_kg", label: "feed_kg(급이량)" },
  ]);
  if ("message" in header) {
    const first =
      unterminatedAtLine !== null ? unterminatedError(unterminatedAtLine) : header;
    return { records: [], lines: [], errors: [first], dataLineCount: 0 };
  }

  const records: FeedCsvRecord[] = [];
  const lines: number[] = [];
  const errors: CsvRowError[] = [];
  const dataRows = rows.slice(1);
  if (unterminatedAtLine !== null) errors.push(unterminatedError(unterminatedAtLine));

  for (const row of dataRows) {
    const batchId = cell(row.cells, header.index, "batch_id");
    const tsRaw = cell(row.cells, header.index, "ts");
    const feedRaw = cell(row.cells, header.index, "feed_kg");

    if (!batchId) {
      errors.push({ line: row.line, message: "배치가 비어 있습니다." });
      continue;
    }
    const ts = parseRecordTimestamp(tsRaw);
    if (!ts) {
      errors.push({
        line: row.line,
        message: `시각을 읽을 수 없습니다: '${tsRaw}' (예: 2026-10-01 14:30)`,
      });
      continue;
    }
    const feedKg = parseDecimal(feedRaw);
    // 수기 폼과 같은 기준: 급이량은 0 보다 커야 한다(0 은 급이하지 않았다는 뜻이고,
    // 그것은 기록할 사건이 아니다 — 폐사 0 건과 달리 FCR 분자에 들어갈 값이 없다).
    if (feedKg === null || feedKg <= 0) {
      errors.push({
        line: row.line,
        message: numberFieldError(feedRaw, "급이량(kg)은 0보다 큰 숫자여야 합니다"),
      });
      continue;
    }
    records.push({ batch_id: batchId, ts, feed_kg: feedKg, source: "csv" });
    lines.push(row.line);
  }

  errors.push(
    ...findDuplicateKeys(
      records.map((r, i) => ({ key: `${r.batch_id}\u0000${r.ts}`, line: lines[i] })),
    ),
  );
  // 오류 목록은 줄 번호 순으로 보여 준다(중복 검사가 뒤에 붙어 순서가 섞인다).
  errors.sort((a, b) => a.line - b.line);

  return { records, lines, errors, dataLineCount: dataRows.length };
}

/** 폐사 기록지 해석. */
export function parseMortalityCsv(text: string): CsvParseResult<MortalityCsvRecord> {
  const { rows, unterminatedAtLine } = splitCsvRows(text);
  const header = readRequiredHeaders(rows, [
    { canonical: "batch_id", label: "batch_id(배치)" },
    { canonical: "ts", label: "ts(시각)" },
    { canonical: "dead_count", label: "dead_count(폐사 개체수)" },
  ]);
  if ("message" in header) {
    const first =
      unterminatedAtLine !== null ? unterminatedError(unterminatedAtLine) : header;
    return { records: [], lines: [], errors: [first], dataLineCount: 0 };
  }

  const records: MortalityCsvRecord[] = [];
  const lines: number[] = [];
  const errors: CsvRowError[] = [];
  const dataRows = rows.slice(1);
  if (unterminatedAtLine !== null) errors.push(unterminatedError(unterminatedAtLine));

  for (const row of dataRows) {
    const batchId = cell(row.cells, header.index, "batch_id");
    const tsRaw = cell(row.cells, header.index, "ts");
    const countRaw = cell(row.cells, header.index, "dead_count");
    const note = cell(row.cells, header.index, "cause_note");

    if (!batchId) {
      errors.push({ line: row.line, message: "배치가 비어 있습니다." });
      continue;
    }
    const ts = parseRecordTimestamp(tsRaw);
    if (!ts) {
      errors.push({
        line: row.line,
        message: `시각을 읽을 수 없습니다: '${tsRaw}' (예: 2026-10-01 14:30)`,
      });
      continue;
    }
    const deadCount = parseDecimal(countRaw);
    // 수기 폼과 같은 기준: 0 을 허용한다 — "그날 폐사가 없었다" 는 기록도 증빙이다.
    if (deadCount === null || !Number.isInteger(deadCount) || deadCount < 0) {
      errors.push({
        line: row.line,
        message: numberFieldError(countRaw, "폐사 개체수는 0 이상의 정수여야 합니다"),
      });
      continue;
    }
    records.push({
      batch_id: batchId,
      ts,
      dead_count: deadCount,
      cause_note: note || null,
    });
    lines.push(row.line);
  }

  errors.push(
    ...findDuplicateKeys(
      records.map((r, i) => ({ key: `${r.batch_id}\u0000${r.ts}`, line: lines[i] })),
    ),
  );
  errors.sort((a, b) => a.line - b.line);

  return { records, lines, errors, dataLineCount: dataRows.length };
}

/**
 * 전력 기록지 해석.
 *
 * **왜 값이 0 이어도 받는가.** 급이량과 달리 "이 구간에 0 kWh 를 썼다" 는 실제 계측이다
 * (블로어를 돌리지 않은 날). 0 을 거부하면 운영자는 그 줄을 지우게 되고, 그러면 기간에
 * 구멍이 생겨 **계측이 끊긴 것과 구분되지 않는다.** 음수만 거부한다.
 *
 * **적산 지침을 올릴 때의 제약(ADR 0001 의 귀결).** 저장되는 값은 구간 kWh 뿐이고 원
 * 카운터는 되살릴 수 없다. 그래서 구간 사용량은 **한 배치 안에서 직전 지침과의 차이**로만
 * 계산된다 — 계측기당 지침이 한 건뿐인 파일은 구간값을 하나도 만들지 못하고, 그 건은
 * 'suspect' 로 들어가 EI 산입에서 빠진다. 보내 놓고 "왜 EI 가 안 변하나" 가 되지 않게
 * **보내기 전에** 막고, 직전 지침을 같은 파일에 함께 넣으라고 알린다(이미 저장된 지침을
 * 다시 올려도 중복으로 흡수되므로 안전하다).
 */
export function parsePowerCsv(
  text: string,
  readingKind: PowerReadingKind,
): CsvParseResult<PowerCsvRecord> {
  const { rows, unterminatedAtLine } = splitCsvRows(text);
  const header = readRequiredHeaders(rows, [
    { canonical: "meter_id", label: "meter_id(계측기)" },
    { canonical: "ts", label: "ts(시각)" },
    {
      canonical: "value",
      label:
        readingKind === "cumulative_kwh" ? "value(계량기 지침)" : "value(구간 사용량 kWh)",
    },
  ]);
  if ("message" in header) {
    const first =
      unterminatedAtLine !== null ? unterminatedError(unterminatedAtLine) : header;
    return { records: [], lines: [], errors: [first], dataLineCount: 0 };
  }

  const records: PowerCsvRecord[] = [];
  const lines: number[] = [];
  const errors: CsvRowError[] = [];
  const dataRows = rows.slice(1);
  if (unterminatedAtLine !== null) errors.push(unterminatedError(unterminatedAtLine));

  const requirement =
    readingKind === "cumulative_kwh"
      ? "계량기 지침은 0 이상의 숫자여야 합니다"
      : "구간 사용량(kWh)은 0 이상의 숫자여야 합니다";

  for (const row of dataRows) {
    const meterId = cell(row.cells, header.index, "meter_id");
    const tsRaw = cell(row.cells, header.index, "ts");
    const valueRaw = cell(row.cells, header.index, "value");

    if (!meterId) {
      errors.push({ line: row.line, message: "계측기가 비어 있습니다." });
      continue;
    }
    const ts = parseRecordTimestamp(tsRaw);
    if (!ts) {
      errors.push({
        line: row.line,
        message: `시각을 읽을 수 없습니다: '${tsRaw}' (예: 2026-10-01 14:30)`,
      });
      continue;
    }
    const value = parseDecimal(valueRaw);
    if (value === null || value < 0) {
      errors.push({ line: row.line, message: numberFieldError(valueRaw, requirement) });
      continue;
    }
    records.push({ meter_id: meterId, ts, value, reading_kind: readingKind });
    lines.push(row.line);
  }

  errors.push(
    ...findDuplicateKeys(
      records.map((r, i) => ({ key: `${r.meter_id}\u0000${r.ts}`, line: lines[i] })),
    ),
  );

  // 적산 지침은 계측기당 2건 이상이어야 구간값이 나온다. 1건만 든 계측기를 그냥 보내면
  // 저장은 되지만 산입은 0 이다 — 성공처럼 보이는 실패라 보내기 전에 막는다.
  if (readingKind === "cumulative_kwh") {
    const countByMeter = new Map<string, number>();
    const firstLineByMeter = new Map<string, number>();
    records.forEach((r, i) => {
      countByMeter.set(r.meter_id, (countByMeter.get(r.meter_id) ?? 0) + 1);
      if (!firstLineByMeter.has(r.meter_id)) firstLineByMeter.set(r.meter_id, lines[i]);
    });
    for (const [meterId, count] of countByMeter) {
      if (count >= 2) continue;
      errors.push({
        line: firstLineByMeter.get(meterId) as number,
        message:
          `계측기 '${meterId}' 의 지침이 1건뿐입니다. 지침 두 건의 차이가 구간 사용량이므로 ` +
          "1건만으로는 전력이 산출되지 않습니다. 직전 지침을 같은 파일에 함께 넣어 주세요 " +
          "(이미 올린 지침을 다시 넣어도 중복으로 흡수됩니다).",
      });
    }
  }

  // 오류 목록은 줄 번호 순으로 보여 준다(중복·건수 검사가 뒤에 붙어 순서가 섞인다).
  errors.sort((a, b) => a.line - b.line);

  return { records, lines, errors, dataLineCount: dataRows.length };
}

/** 화면이 내려 주는 기록지 서식 견본. 헤더 이름은 영문 정식 이름으로 둔다. */
export const FEED_CSV_TEMPLATE =
  "batch_id,ts,feed_kg\n" +
  "batch-001,2026-10-01 08:00,12.5\n" +
  "batch-001,2026-10-01 18:00,13\n";

export const MORTALITY_CSV_TEMPLATE =
  "batch_id,ts,dead_count,cause_note\n" +
  "batch-001,2026-10-01 09:00,3,고수온 의심\n" +
  "batch-001,2026-10-02 09:00,0,\n";

/**
 * 전력 기록지 견본은 표현마다 다르다 — 같은 `value` 열에 적을 숫자의 뜻이 다르기 때문이다.
 * 견본의 숫자도 그 차이가 보이게 골랐다(지침은 늘어나는 누적값, 사용량은 하루치).
 */
export const POWER_INTERVAL_CSV_TEMPLATE =
  "meter_id,ts,value\n" +
  "meter-total,2026-10-01 00:00,412.5\n" +
  "meter-total,2026-10-02 00:00,398.2\n" +
  "meter-aeration,2026-10-01 00:00,240.1\n" +
  "meter-aeration,2026-10-02 00:00,233.7\n";

export const POWER_CUMULATIVE_CSV_TEMPLATE =
  "meter_id,ts,value\n" +
  "meter-total,2026-10-01 00:00,128430.0\n" +
  "meter-total,2026-10-02 00:00,128842.5\n" +
  "meter-total,2026-10-03 00:00,129240.7\n";
