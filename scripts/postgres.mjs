// PostgreSQL 접속과 프로젝트 전용 클러스터 관리. 실행 스크립트와 테스트가 함께 쓴다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATE_BIN_DIRS = [
  process.env.PG_BIN,
  "/opt/homebrew/opt/postgresql@18/bin",
  "/usr/local/opt/postgresql@18/bin",
].filter(Boolean);

function pgBinary(name) {
  const dir = CANDIDATE_BIN_DIRS.find((candidate) => existsSync(join(candidate, name)));
  return dir ? join(dir, name) : name; // 없으면 PATH에서 찾는다.
}

function run(name, args, options = {}) {
  return execFileSync(pgBinary(name), args, { stdio: "pipe", encoding: "utf8", ...options });
}

export function createPostgres({ dataDir, logFile, host, port, user, password, database }) {
  const psql = (db, args) =>
    run("psql", ["-h", host, "-p", String(port), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args], {
      env: { ...process.env, PGPASSWORD: password },
    });

  return {
    sql: (text) => psql(database, ["-tA", "-c", text]).trim(),

    isInitialized: () => existsSync(join(dataDir, "PG_VERSION")),

    init() {
      const tmp = mkdtempSync(join(tmpdir(), "todo-pg-"));
      try {
        const passwordFile = join(tmp, "password");
        writeFileSync(passwordFile, password, { mode: 0o600 });
        run("initdb", [
          "-D", dataDir,
          "-U", user,
          `--pwfile=${passwordFile}`,
          "--auth=scram-sha-256",
          "-E", "UTF8",
          "--locale=en_US.UTF-8",
        ]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },

    isRunning() {
      try {
        run("pg_ctl", ["status", "-D", dataDir]);
        return true;
      } catch {
        return false;
      }
    },

    start() {
      // 지정한 주소에서만 받고 유닉스 소켓은 쓰지 않는다.
      const options = `-p ${port} -c listen_addresses=${host} -c unix_socket_directories=''`;
      try {
        run("pg_ctl", ["start", "-D", dataDir, "-w", "-t", "30", "-l", logFile, "-o", options], { stdio: "ignore" });
      } catch {
        const log = existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").slice(-8).join("\n") : "";
        throw new Error(`PostgreSQL을 시작하지 못했습니다. (포트 ${port})\n${log}`);
      }
    },

    stop() {
      run("pg_ctl", ["stop", "-D", dataDir, "-w", "-m", "fast"], { stdio: "ignore" });
    },

    ensureDatabase() {
      const exists = psql("postgres", ["-tA", "-c", `SELECT 1 FROM pg_database WHERE datname = '${database}'`]);
      if (exists.trim() !== "1") psql("postgres", ["-c", `CREATE DATABASE "${database}"`]);
    },

    // 아직 적용하지 않은 마이그레이션을 파일 이름 순서로, 파일마다 한 트랜잭션으로 적용한다.
    migrate(directory) {
      psql(database, ["-c", "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"]);
      const applied = new Set(psql(database, ["-tA", "-c", "SELECT name FROM schema_migrations"]).split("\n"));
      const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        psql(database, ["-1", "-f", join(directory, file), "-c", `INSERT INTO schema_migrations (name) VALUES ('${file}')`]);
      }
    },
  };
}
