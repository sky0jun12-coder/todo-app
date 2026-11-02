// 세 티어를 함께 실행한다: PostgreSQL → API → Next.js. Ctrl+C를 누르면 모두 종료된다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgres } from "./postgres.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = process.env.ENV_FILE ?? join(ROOT, ".env");
const DATA_DIR = process.env.PGDATA_DIR ?? join(ROOT, "db", "pgdata");
const REQUIRED_DB_ENV = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];

const children = new Map();
let startedPostgres = false;
let postgres;
let stopping = false;

function startChild(name, args, options) {
  const child = spawn(process.execPath, args, { stdio: "inherit", ...options });
  children.set(name, child);
  child.on("exit", () => {
    children.delete(name);
    if (!stopping) {
      console.error(`[run] ${name} 티어가 종료되어 전체를 중단합니다.`);
      shutdown(1);
    }
  });
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  const running = [...children.values()];
  await Promise.all(
    running.map(
      (child) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill("SIGTERM");
        }),
    ),
  );
  if (startedPostgres) postgres.stop();
  process.exit(code);
}

function main() {
  // 이미 설정된 환경 변수는 덮어쓰지 않는다.
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

  const missing = REQUIRED_DB_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `환경 변수가 없습니다: ${missing.join(", ")}\n` +
        "      cp .env.example .env 로 파일을 만든 뒤 값을 채우세요.",
    );
  }

  const apiPort = process.env.API_PORT ?? "4000";
  const webPort = process.env.WEB_PORT ?? "3000";
  const managed = process.env.PG_MANAGED !== "false";

  postgres = createPostgres({
    dataDir: DATA_DIR,
    logFile: process.env.PG_LOG_FILE ?? join(ROOT, "db", "postgres.log"),
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  if (managed) {
    mkdirSync(dirname(DATA_DIR), { recursive: true });
    if (!postgres.isInitialized()) postgres.init();
    if (!postgres.isRunning()) {
      postgres.start();
      startedPostgres = true;
    }
    postgres.ensureDatabase();
  }
  postgres.migrate(join(ROOT, "db", "migrations"));

  startChild("api", [join(ROOT, "api", "src", "server.js")], {
    env: { ...process.env, API_PORT: apiPort },
  });

  // 웹 티어는 DB에 접근하지 않으므로 DB 접속정보를 넘기지 않는다.
  const webEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("DB_")),
  );
  const webDir = join(ROOT, "web");
  const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
  startChild("web", [nextBin, "dev", "-H", "127.0.0.1", "-p", webPort], {
    cwd: webDir,
    env: { ...webEnv, API_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: "1" },
  });

  console.log(`\n[run] 앱 주소: http://127.0.0.1:${webPort}\n`);
}

try {
  main();
} catch (error) {
  console.error(`[run] ${error.message}`);
  if (startedPostgres) postgres.stop();
  process.exit(1);
}
