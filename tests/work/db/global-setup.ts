import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

// 테스트 전용 데이터베이스를 새로 만들고 현장관리 마이그레이션을 적용한다.
// 운영 DB 보호: 데이터베이스 이름이 _test 로 끝나지 않으면 실행하지 않는다.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://culiver_test:culiver_test@localhost:5432/culiver_test";

// vitest 는 저장소 루트에서 실행한다(package.json 의 work:test:db).
const ROOT = process.cwd();

/** 현장관리 마이그레이션. shrimp365 의 다른 마이그레이션은 적용하지 않는다. */
export const MIGRATION_FILE = path.join(ROOT, "supabase/migrations/dailywork.sql");
const SHIM_FILE = path.join(ROOT, "tests/work/db/supabase-shim.sql");

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`테스트 DB 이름은 _test 로 끝나야 합니다: ${dbName}`);
  }
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const db = new Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  for (const file of [SHIM_FILE, MIGRATION_FILE]) {
    try {
      await db.query(fs.readFileSync(file, "utf8"));
    } catch (error) {
      await db.end();
      throw new Error(`${path.basename(file)} 적용 실패: ${(error as Error).message}`);
    }
  }
  await db.end();
}
