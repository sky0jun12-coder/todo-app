// 실행 스크립트를 임시 환경에서 돌려 세 티어 연결, 환경 변수 처리, 종료 정리를 검증한다.
// Next.js 개발 서버는 폴더당 하나만 뜨므로, 앱을 끈 상태에서 실행해야 한다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { freePort, isListening, ROOT, startTempPostgres, waitFor } from "./helpers.mjs";

// 실제 .env나 셸의 DB 설정이 테스트에 섞이지 않게 한다.
function cleanEnv(extra) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("DB_") && name !== "PG_MANAGED"),
  );
  return { ...env, ...extra };
}

function launch(env) {
  const launcher = spawn(process.execPath, [join(ROOT, "scripts", "run.mjs")], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
    detached: true, // 터미널의 Ctrl+C처럼 그룹 전체에 신호를 보낼 수 있게 한다.
  });
  launcher.stderrText = "";
  launcher.stderr.on("data", (chunk) => (launcher.stderrText += chunk));
  launcher.exited = new Promise((resolve) => launcher.once("exit", resolve));
  return launcher;
}

// 브라우저 → 웹 → API → DB 전체 경로로 확인한다.
async function exerciseWebTier(web) {
  await waitFor(async () => (await fetch(`${web}/api/health`)).ok, 120000);

  assert.equal((await fetch(`${web}/api/note`)).status, 401);

  const signup = await fetch(`${web}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "web-user", password: "web-tier-password" }),
  });
  assert.equal(signup.status, 201);
  const setCookie = signup.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/, "웹 티어를 거쳐도 쿠키 속성이 유지된다");
  const Cookie = setCookie.split(";")[0];

  const saved = await fetch(`${web}/api/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie },
    body: JSON.stringify({ content: "웹 티어를 거쳐 저장" }),
  });
  assert.equal(saved.status, 200);
  const note = await (await fetch(`${web}/api/note`, { headers: { Cookie } })).json();
  assert.equal(note.content, "웹 티어를 거쳐 저장");
  assert.equal((await fetch(web)).status, 200);
}

async function runAndStop(stop) {
  const dir = mkdtempSync(join(tmpdir(), "todo-run-"));
  const [dbPort, apiPort, webPort] = [await freePort(), await freePort(), await freePort()];
  // 접속정보를 파일로만 넘겨 .env 읽기까지 확인한다.
  const envFile = join(dir, ".env");
  writeFileSync(
    envFile,
    `DB_HOST=127.0.0.1\nDB_PORT=${dbPort}\nDB_USER=run_user\nDB_PASSWORD=${randomBytes(18).toString("hex")}\nDB_NAME=run_db\n`,
  );
  const launcher = launch(
    cleanEnv({
      ENV_FILE: envFile,
      PGDATA_DIR: join(dir, "pgdata"),
      PG_LOG_FILE: join(dir, "postgres.log"),
      API_PORT: String(apiPort),
      WEB_PORT: String(webPort),
    }),
  );

  try {
    await exerciseWebTier(`http://127.0.0.1:${webPort}`);
    stop(launcher);
    assert.equal(await launcher.exited, 0, launcher.stderrText);
    for (const port of [dbPort, apiPort, webPort]) {
      assert.equal(await isListening(port), false, `포트 ${port}가 아직 열려 있습니다.`);
    }
  } finally {
    if (launcher.exitCode === null) {
      process.kill(-launcher.pid, "SIGKILL");
      await launcher.exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("SIGTERM으로 세 티어가 모두 종료된다", { timeout: 180000 }, () =>
  runAndStop((launcher) => launcher.kill("SIGTERM")));

test("Ctrl+C로 세 티어가 모두 종료된다", { timeout: 180000 }, () =>
  runAndStop((launcher) => process.kill(-launcher.pid, "SIGINT")));

for (const name of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  test(`${name}이 없으면 시작하지 않고 이유를 알려준다`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-run-"));
    const secret = randomBytes(18).toString("hex");
    const values = { DB_HOST: "127.0.0.1", DB_PORT: "1", DB_USER: "u", DB_PASSWORD: secret, DB_NAME: "d" };
    delete values[name];
    try {
      const launcher = launch(
        cleanEnv({ ...values, ENV_FILE: join(dir, "missing.env"), PGDATA_DIR: join(dir, "pgdata") }),
      );
      assert.equal(await launcher.exited, 1);
      assert.match(launcher.stderrText, new RegExp(name));
      assert.ok(!launcher.stderrText.includes(secret), "비밀번호를 출력하지 않는다");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("API는 DB 접속정보 없이 시작하지 않는다", async () => {
  const api = spawn(process.execPath, [join(ROOT, "api", "src", "server.js")], {
    env: cleanEnv({ API_PORT: String(await freePort()) }),
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  api.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolve) => api.once("exit", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/);
});

test("환경 변수의 주소로 외부 DB에 접속하고, 종료할 때 그 DB는 끄지 않는다", { timeout: 180000 }, async () => {
  const external = await startTempPostgres();
  const dir = mkdtempSync(join(tmpdir(), "todo-run-"));
  const [apiPort, webPort] = [await freePort(), await freePort()];
  const launcher = launch(
    cleanEnv({
      ...external.env,
      PG_MANAGED: "false",
      ENV_FILE: join(dir, "missing.env"),
      PGDATA_DIR: join(dir, "must-not-be-created"),
      API_PORT: String(apiPort),
      WEB_PORT: String(webPort),
    }),
  );
  try {
    await exerciseWebTier(`http://127.0.0.1:${webPort}`);
    assert.equal(external.postgres.sql("SELECT username FROM users"), "web-user");
    launcher.kill("SIGTERM");
    assert.equal(await launcher.exited, 0, launcher.stderrText);
    assert.equal(external.postgres.isRunning(), true);
  } finally {
    if (launcher.exitCode === null) {
      process.kill(-launcher.pid, "SIGKILL");
      await launcher.exited;
    }
    external.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("잘못된 비밀번호면 시작하지 않고 비밀번호를 출력하지 않는다", { timeout: 60000 }, async () => {
  const external = await startTempPostgres();
  const dir = mkdtempSync(join(tmpdir(), "todo-run-"));
  const wrong = randomBytes(18).toString("hex");
  const launcher = launch(
    cleanEnv({
      ...external.env,
      DB_PASSWORD: wrong,
      PG_MANAGED: "false",
      ENV_FILE: join(dir, "missing.env"),
      API_PORT: String(await freePort()),
      WEB_PORT: String(await freePort()),
    }),
  );
  try {
    assert.equal(await launcher.exited, 1);
    assert.ok(!launcher.stderrText.includes(wrong));
  } finally {
    external.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
