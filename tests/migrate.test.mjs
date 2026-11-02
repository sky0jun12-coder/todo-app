// 마이그레이션의 안전성을 검증한다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, startTempPostgres } from "./helpers.mjs";

const MIGRATIONS = join(ROOT, "db", "migrations");

test("migrate 스크립트: 환경 변수로 접속해 적용하고, 값이 없으면 실패한다", async () => {
  const db = await startTempPostgres();
  const script = join(ROOT, "scripts", "migrate.mjs");
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("DB_")));
  try {
    db.postgres.sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const applied = spawnSync(process.execPath, [script], {
      env: { ...base, ...db.env, ENV_FILE: "/nonexistent" },
      encoding: "utf8",
    });
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(db.postgres.sql("SELECT count(*) FROM schema_migrations"), "2");

    const missing = spawnSync(process.execPath, [script], {
      env: { ...base, ENV_FILE: "/nonexistent" },
      encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /DB_HOST/);
  } finally {
    db.cleanup();
  }
});

test("반복 적용해도 안전하다", async () => {
  const db = await startTempPostgres();
  try {
    db.postgres.migrate(MIGRATIONS);
    assert.equal(db.postgres.sql("SELECT count(*) FROM schema_migrations"), "2");
  } finally {
    db.cleanup();
  }
});

test("소유자 없는 데이터가 있으면 002는 실패하고 데이터와 스키마를 그대로 둔다", async () => {
  const db = await startTempPostgres();
  const dir = mkdtempSync(join(tmpdir(), "todo-migrate-"));
  try {
    // 001만 적용된 예전 상태로 되돌린다.
    db.postgres.sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    cpSync(join(MIGRATIONS, "001_init.sql"), join(dir, "001_init.sql"));
    db.postgres.migrate(dir);
    db.postgres.sql("INSERT INTO todos (title) VALUES ('예전 할 일')");

    assert.throws(() => db.postgres.migrate(MIGRATIONS), /소유자가 없는 기존 데이터/);

    assert.equal(db.postgres.sql("SELECT title FROM todos"), "예전 할 일");
    assert.equal(db.postgres.sql("SELECT to_regclass('public.users') IS NULL"), "t");
    assert.equal(db.postgres.sql("SELECT count(*) FROM schema_migrations"), "1");
  } finally {
    db.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
