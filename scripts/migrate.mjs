// DB 마이그레이션만 적용한다. 배포 환경처럼 DB를 따로 운영할 때 쓴다.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgres } from "./postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = process.env.ENV_FILE ?? join(ROOT, ".env");
const REQUIRED_DB_ENV = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const missing = REQUIRED_DB_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[migrate] 환경 변수가 없습니다: ${missing.join(", ")}`);
  process.exit(1);
}

try {
  createPostgres({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  }).migrate(join(ROOT, "db", "migrations"));
  console.log("[migrate] 완료");
} catch (error) {
  console.error(`[migrate] 실패: ${error.stderr || error.message}`);
  process.exit(1);
}
