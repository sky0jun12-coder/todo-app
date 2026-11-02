import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgres } from "../scripts/postgres.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function waitFor(check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(100);
  }
  throw new Error("대기 시간을 초과했습니다.");
}

// 실제 DB를 건드리지 않도록 임시 클러스터를 띄운다. 비밀번호는 매번 무작위로 만든다.
export async function startTempPostgres() {
  const dir = mkdtempSync(join(tmpdir(), "todo-test-"));
  const connection = {
    host: "127.0.0.1",
    port: await freePort(),
    user: "test_user",
    password: randomBytes(18).toString("hex"),
    database: "test_db",
  };
  const postgres = createPostgres({
    ...connection,
    dataDir: join(dir, "pgdata"),
    logFile: join(dir, "postgres.log"),
  });
  postgres.init();
  postgres.start();
  postgres.ensureDatabase();
  postgres.migrate(join(ROOT, "db", "migrations"));
  return {
    postgres,
    env: {
      DB_HOST: connection.host,
      DB_PORT: String(connection.port),
      DB_USER: connection.user,
      DB_PASSWORD: connection.password,
      DB_NAME: connection.database,
    },
    cleanup() {
      if (postgres.isRunning()) postgres.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function startApi(dbEnv, port) {
  return spawn(process.execPath, [join(ROOT, "api", "src", "server.js")], {
    env: { ...process.env, ...dbEnv, API_PORT: String(port) },
    stdio: "ignore",
  });
}
