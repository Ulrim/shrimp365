/**
 * 전체 백업 검증 — `lib/zip.ts`(ZIP 만들기)와 `lib/admin-backup.ts`(내보낼 표·칸·CSV 규칙).
 *
 * 사양 기반 단위 검증이다. 지키는 것:
 *   ① 만든 ZIP 을 다른 구현(unzip, 없으면 건너뜀)이 온전히 풀고 내용이 같다
 *   ② 비밀 값 칸·표가 백업에 실리지 않는다
 *   ③ CSV 칸 규칙(수식 주입 방지·따옴표·jsonb)
 *   ④ SQL 에 정의된 표가 모두 "내보냄" 아니면 "일부러 뺌" 중 하나로 분류돼 있다
 *      — 새 표를 만들고 백업 목록에 넣는 것을 잊으면 여기서 걸린다.
 *
 * 실행: npm run verify:backup
 */

import { execFileSync, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const outDir = mkdtempSync(join(tmpdir(), "backup-verify-"))

const failures = []
let checked = 0

function check(name, actual, expected) {
  checked += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) failures.push(`${name}\n      실제: ${a}\n      기대: ${e}`)
}

try {
  for (const f of ["zip.ts", "admin-backup.ts"]) copyFileSync(join(ROOT, "lib", f), join(outDir, f))
  execFileSync(
    "npx",
    [
      "tsc", join(outDir, "zip.ts"), join(outDir, "admin-backup.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs", "--target", "es2022", "--lib", "es2022,dom",
      "--moduleResolution", "node", "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )
  const require = createRequire(join(outDir, "x.cjs"))
  const { crc32, zipEntry, buildZip } = require(join(outDir, "out", "zip.js"))
  const B = require(join(outDir, "out", "admin-backup.js"))
  const enc = new TextEncoder()

  // ── ① ZIP ────────────────────────────────────────────────────────────────
  check("① CRC-32 표준 검사값", crc32([enc.encode("123456789")]), 0xcbf43926)
  check("① CRC-32 는 조각을 나눠도 같다", crc32([enc.encode("1234"), enc.encode("56789")]), 0xcbf43926)

  const big = `id,note\r\n${Array.from({ length: 20000 }, (_, i) => `${i},새우 양식장 수질 기록 ${i % 7}`).join("\r\n")}\r\n`
  const files = {
    "README.txt": "﻿한글 안내문\r\n",
    "water_quality_readings.csv": big,
    "tiny.csv": "a\r\n", // 압축해도 줄지 않는다 → stored
  }
  const entries = []
  for (const [name, text] of Object.entries(files)) {
    // 조각을 둘로 나눠 넣는다 — 화면이 묶음마다 조각을 쌓는 것과 같은 모양.
    const bytes = enc.encode(text)
    const mid = Math.floor(bytes.length / 2)
    entries.push(await zipEntry(name, [bytes.slice(0, mid), bytes.slice(mid)]))
  }
  check("① 큰 CSV 는 압축된다(deflate)", entries[1].method, 8)
  check("① 줄지 않는 파일은 그대로 담는다(stored)", entries[2].method, 0)
  check("① 압축본이 원본보다 작다", entries[1].data.size < entries[1].size, true)

  const zip = buildZip(entries, new Date(2026, 10, 17, 9, 30, 0))
  const zipPath = join(outDir, "backup.zip")
  writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()))

  const hasUnzip = spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0
  if (hasUnzip) {
    const test = spawnSync("unzip", ["-t", zipPath], { encoding: "utf8" })
    check("① unzip -t 가 오류 없이 통과한다", test.status, 0)
    for (const [name, text] of Object.entries(files)) {
      const got = execFileSync("unzip", ["-p", zipPath, name], { maxBuffer: 64 * 1024 * 1024 })
      check(`① ${name} 내용이 그대로다`, Buffer.compare(got, Buffer.from(text, "utf8")), 0)
    }
  } else {
    console.log("  (unzip 이 없어 ① 의 풀기 검증은 건너뜀)")
  }
  check("① 빈 ZIP 도 만들 수 있다", buildZip([]).size, 22)

  // ── ② 비밀 값 ────────────────────────────────────────────────────────────
  for (const c of ["api_key", "pairing_secret", "key_hash", "issued_key", "p256dh", "access_token", "password"]) {
    check(`② ${c} 는 비밀 값 칸이다`, B.isSecretColumn(c), true)
  }
  for (const c of ["id", "tokens_used", "keyword", "created_at", "author_name", "code"]) {
    check(`② ${c} 는 비밀 값 칸이 아니다`, B.isSecretColumn(c), false)
  }
  check(
    "② sensor_devices 에서 api_key 가 빠진다",
    B.sanitizeRow(B.backupTable("sensor_devices"), { id: "1", name: "s", api_key: "SECRET" }),
    { id: "1", name: "s" },
  )
  check(
    "② vision_cameras 에서 api_key·stream_url 이 빠진다",
    B.sanitizeRow(B.backupTable("vision_cameras"), { id: "1", api_key: "K", stream_url: "rtsp://u:p@h", serial: "x" }),
    { id: "1", serial: "x" },
  )
  check(
    "② exclude 에 없어도 이름이 비밀 값이면 빠진다",
    B.sanitizeRow(B.backupTable("farms"), { id: "1", webhook_secret: "x" }),
    { id: "1" },
  )
  const names = B.BACKUP_TABLES.map((t) => t.name)
  check("② 표 이름이 겹치지 않는다", new Set(names).size, names.length)
  for (const t of B.BACKUP_EXCLUDED_TABLES) {
    check(`② ${t.name} 은 내보내는 목록에 없다`, B.backupTable(t.name), undefined)
  }
  check("② 목록에 없는 표는 찾지 못한다", B.backupTable("push_subscriptions; drop"), undefined)

  // ── ③ CSV ────────────────────────────────────────────────────────────────
  check("③ null·undefined 는 빈 칸", [B.backupCell(null), B.backupCell(undefined)], ["", ""])
  check("③ 숫자·불리언", [B.backupCell(7.5), B.backupCell(-3), B.backupCell(true), B.backupCell(NaN)], ["7.5", "-3", "true", ""])
  check("③ 쉼표·따옴표·줄바꿈은 감싼다", B.backupCell('a,"b"\nc'), '"a,""b""\nc"')
  check("③ 수식으로 읽힐 글자 앞에 ' 를 붙인다", [B.backupCell("=1+1"), B.backupCell("@x"), B.backupCell("-5도")], ["'=1+1", "'@x", "'-5도"])
  check("③ jsonb 는 JSON 글로", B.backupCell({ a: [1, 2] }), '"{""a"":[1,2]}"')
  check("③ 머리는 처음 나온 순서의 합집합", B.backupColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }]), ["a", "b", "c"])
  check(
    "③ 없는 칸은 빈 칸, 머리에 없는 칸은 버린다",
    B.backupCsvRows(["a", "b"], [{ a: 1, b: "x" }, { a: 2, z: 9 }]),
    "1,x\r\n2,\r\n",
  )
  check("③ 파일 이름은 한국 시각", B.backupFilename(Date.UTC(2026, 10, 16, 15, 5)), "shrimp365-backup-20261117-0005.zip")

  // ── ④ 표 분류 ────────────────────────────────────────────────────────────
  const sqlFiles = [
    join(ROOT, "supabase", "schema.sql"),
    ...readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).map((f) => join(ROOT, "supabase", "migrations", f)),
  ]
  const defined = new Set()
  for (const f of sqlFiles) {
    const sql = readFileSync(f, "utf8").replace(/--.*$/gm, "")
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi)) defined.add(m[1])
  }
  const known = new Set([...names, ...B.BACKUP_EXCLUDED_TABLES.map((t) => t.name)])
  check("④ SQL 의 모든 표가 분류돼 있다(없으면 lib/admin-backup.ts 에 추가)", [...defined].filter((t) => !known.has(t)).sort(), [])
  check("④ 목록의 표가 모두 SQL 에 있다(auth_users 제외)", names.filter((t) => t !== "auth_users" && !defined.has(t)), [])
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n전체 백업 검증 실패 — ${failures.length}/${checked}건\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`전체 백업 검증 통과 — ${checked}건 (사양 기반 단위 검증)`)
