// ZIP 파일 만들기 — 브라우저에서 여러 파일을 하나로 묶어 내려받게 한다(전체 백업).
//
// 의존성 없이 직접 쓴다: 묶을 것이 글(CSV)뿐이고 필요한 기능이 "파일 여러 개 + 압축"
// 하나라서다. 압축은 브라우저의 CompressionStream("deflate-raw")에 맡기고, 없는
// 브라우저에서는 압축 없이(stored) 담는다 — 어느 쪽이든 표준 ZIP 이다.
//
// 한계: ZIP64 를 쓰지 않는다. 파일 하나·전체 크기 4GB, 파일 65,535개가 상한이고
// 넘으면 깨진 파일을 만드는 대신 오류를 던진다.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** 여러 조각을 이어 붙인 것의 CRC-32. */
export function crc32(chunks: Uint8Array[]): number {
  let crc = 0xffffffff
  for (const bytes of chunks) {
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = {
  name: string
  /** 담길 바이트(압축했으면 압축된 것). */
  data: Blob
  crc32: number
  /** 원래 크기. */
  size: number
  /** 8 = deflate, 0 = stored. */
  method: 0 | 8
}

const MAX32 = 0xffffffff

async function deflateRaw(raw: Blob): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null
  try {
    const stream = raw.stream().pipeThrough(new CompressionStream("deflate-raw"))
    return await new Response(stream).blob()
  } catch {
    return null // "deflate-raw" 를 모르는 브라우저 — 압축 없이 담는다.
  }
}

/** 파일 하나를 ZIP 에 넣을 모양으로 만든다. 압축해서 줄어들 때만 압축본을 쓴다. */
export async function zipEntry(name: string, chunks: Uint8Array[]): Promise<ZipEntry> {
  const raw = new Blob(chunks as BlobPart[])
  if (raw.size > MAX32) throw new Error(`${name}: 4GB 를 넘는 파일은 담을 수 없습니다`)
  const base = { name, crc32: crc32(chunks), size: raw.size }
  const packed = raw.size > 0 ? await deflateRaw(raw) : null
  return packed && packed.size < raw.size
    ? { ...base, data: packed, method: 8 }
    : { ...base, data: raw, method: 0 }
}

/** DOS 날짜·시각(로컬 시각). ZIP 은 1980년 이전을 담지 못한다. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** 항목들을 ZIP 하나로 묶는다. 이름은 UTF-8 로 적는다(일반 목적 비트 11). */
export function buildZip(entries: ZipEntry[], now: Date = new Date()): Blob {
  if (entries.length > 0xffff) throw new Error("파일이 너무 많습니다")
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const name = encoder.encode(e.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)            // 푸는 데 필요한 버전
    lv.setUint16(6, 0x0800, true)        // UTF-8 이름
    lv.setUint16(8, e.method, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, e.crc32, true)
    lv.setUint32(18, e.data.size, true)
    lv.setUint32(22, e.size, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)            // 만든 버전
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, e.method, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, e.crc32, true)
    cv.setUint32(20, e.data.size, true)
    cv.setUint32(24, e.size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)       // 30~41(추가 필드·주석·디스크·속성)은 0
    cd.set(name, 46)
    central.push(cd)

    parts.push(local as BlobPart, e.data)
    offset += local.length + e.data.size
    if (offset > MAX32) throw new Error("백업 파일이 4GB 를 넘습니다 — 묶음을 나눠 받아 주세요")
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  if (offset + centralSize > MAX32) throw new Error("백업 파일이 4GB 를 넘습니다 — 묶음을 나눠 받아 주세요")
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...parts, ...(central as BlobPart[]), end as BlobPart], { type: "application/zip" })
}
