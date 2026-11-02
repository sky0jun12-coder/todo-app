// 실제 PostgreSQL과 API 프로세스를 띄워 HTTP로 검증한다.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { freePort, startApi, startTempPostgres, waitFor } from "./helpers.mjs";

const PASSWORD = "correct-horse-battery";

let database;
let apiProcess;
let base;
let cookie = "";

async function call(method, path, payload, { raw, contentType = "application/json" } = {}) {
  const body = raw ?? (payload === undefined ? undefined : JSON.stringify(payload));
  const response = await fetch(base + path, {
    method,
    body,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": contentType }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// 응답의 세션 쿠키를 저장해 이후 요청에 사용한다.
async function authCall(path, payload) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(payload),
  });
  const setCookie = response.headers.get("set-cookie");
  const text = await response.text();
  return { status: response.status, setCookie, body: text ? JSON.parse(text) : null };
}

async function signUp(username, password = PASSWORD) {
  cookie = "";
  const result = await authCall("/api/auth/signup", { username, password });
  assert.equal(result.status, 201);
  cookie = result.setCookie.split(";")[0];
  return result;
}

// 다른 사용자로 잠시 전환해 실행한 뒤 되돌린다.
async function as(username, work) {
  const saved = cookie;
  try {
    await signUp(username);
    return await work();
  } finally {
    cookie = saved;
  }
}

before(async () => {
  database = await startTempPostgres();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  apiProcess = startApi(database.env, port);
  await waitFor(async () => (await fetch(`${base}/api/health`)).ok);
  await signUp("tester");
});

after(async () => {
  if (apiProcess) {
    apiProcess.kill();
    await new Promise((resolve) => apiProcess.once("exit", resolve));
  }
  database?.cleanup();
});

test("로그인 없이는 데이터에 접근할 수 없다", async () => {
  const saved = cookie;
  cookie = "";
  try {
    for (const [method, path, payload] of [
      ["GET", "/api/todos"],
      ["POST", "/api/todos", { title: "x" }],
      ["PATCH", "/api/todos/1", { completed: true }],
      ["DELETE", "/api/todos/1"],
      ["GET", "/api/learnings"],
      ["POST", "/api/learnings", { content: "x" }],
      ["GET", "/api/note"],
      ["PUT", "/api/note", { content: "x" }],
    ]) {
      assert.equal((await call(method, path, payload)).status, 401, `${method} ${path}`);
    }
    cookie = "session=forged-token";
    assert.equal((await call("GET", "/api/todos")).status, 401);
    assert.deepEqual((await call("GET", "/api/auth/me")).body, { user: null });
  } finally {
    cookie = saved;
  }
});

test("회원가입 검증", async () => {
  const saved = cookie;
  cookie = "";
  try {
    for (const payload of [
      { username: "ab", password: PASSWORD },
      { username: "a".repeat(31), password: PASSWORD },
      { username: "공백 포함", password: PASSWORD },
      { username: 1, password: PASSWORD },
      { username: "valid-name", password: "short" },
      { username: "valid-name", password: "가".repeat(201) },
      { username: "valid-name", password: 12345678 },
      { username: "valid-name" },
      {},
    ]) {
      assert.equal((await authCall("/api/auth/signup", payload)).status, 400, JSON.stringify(payload));
    }
    assert.equal((await authCall("/api/auth/signup", { username: "tester", password: PASSWORD })).status, 409);
    assert.equal((await authCall("/api/auth/signup", { username: "TESTER", password: PASSWORD })).status, 409, "대소문자 구분 없음");
  } finally {
    cookie = saved;
  }
});

test("로그인, 세션 쿠키, 로그아웃", async () => {
  const saved = cookie;
  cookie = "";
  try {
    const wrong = await authCall("/api/auth/login", { username: "tester", password: "wrong-password" });
    const unknown = await authCall("/api/auth/login", { username: "no-such-user", password: PASSWORD });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body, "아이디 존재 여부를 알 수 없어야 한다");
    assert.equal(wrong.setCookie, null);

    const login = await authCall("/api/auth/login", { username: " Tester ", password: PASSWORD });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.username, "tester");
    assert.equal("password_hash" in login.body.user, false);
    assert.match(login.setCookie, /HttpOnly/);
    assert.match(login.setCookie, /SameSite=Lax/);
    assert.match(login.setCookie, /Max-Age=2592000/);

    cookie = login.setCookie.split(";")[0];
    assert.equal((await call("GET", "/api/auth/me")).body.user.username, "tester");
    assert.equal((await call("GET", "/api/todos")).status, 200);

    assert.equal((await authCall("/api/auth/logout", {})).status, 204);
    assert.equal((await call("GET", "/api/todos")).status, 401, "로그아웃한 세션은 서버에서 무효화된다");
  } finally {
    cookie = saved;
  }
});

test("비밀번호와 세션 토큰은 원문으로 저장되지 않는다", async () => {
  const stored = database.postgres.sql("SELECT password_hash FROM users WHERE username = 'tester'");
  assert.match(stored, /^scrypt:/);
  assert.ok(!stored.includes(PASSWORD));
  const token = cookie.split("=")[1];
  assert.equal(database.postgres.sql(`SELECT count(*) FROM sessions WHERE token_hash = '${token}'`), "0");
});

test("만료된 세션은 거부된다", async () => {
  await as("expiring-user", async () => {
    assert.equal((await call("GET", "/api/todos")).status, 200);
    database.postgres.sql(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE username = 'expiring-user')",
    );
    assert.equal((await call("GET", "/api/todos")).status, 401);
  });
});

test("로그인 실패가 반복되면 올바른 비밀번호도 잠시 거절한다", async () => {
  const saved = cookie;
  await signUp("locked-user");
  cookie = "";
  try {
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await authCall("/api/auth/login", { username: "locked-user", password: "wrong-password" })).status, 401);
    }
    assert.equal((await authCall("/api/auth/login", { username: "locked-user", password: PASSWORD })).status, 429);
    assert.equal((await authCall("/api/auth/login", { username: "tester", password: PASSWORD })).status, 200, "다른 계정은 영향 없음");
  } finally {
    cookie = saved;
  }
});

test("다른 사용자의 데이터는 보거나 바꿀 수 없다", async () => {
  const todo = (await call("POST", "/api/todos", { title: "내 할 일" })).body;
  const learning = (await call("POST", "/api/learnings", { content: "내 기록" })).body;
  await call("PUT", "/api/note", { content: "내 노트" });

  await as("other-user", async () => {
    assert.deepEqual((await call("GET", "/api/todos")).body, { todos: [], remaining: 0 });
    assert.deepEqual((await call("GET", "/api/learnings")).body, []);
    assert.equal((await call("GET", "/api/note")).body.content, "");

    assert.equal((await call("PATCH", `/api/todos/${todo.id}`, { title: "탈취" })).status, 404);
    assert.equal((await call("DELETE", `/api/todos/${todo.id}`)).status, 404);
    assert.equal((await call("PATCH", `/api/learnings/${learning.id}`, { content: "탈취" })).status, 404);
    assert.equal((await call("DELETE", `/api/learnings/${learning.id}`)).status, 404);
    await call("PUT", "/api/note", { content: "남의 노트" });
  });

  assert.equal((await call("GET", "/api/todos")).body.todos[0].title, "내 할 일");
  assert.equal((await call("GET", "/api/learnings")).body[0].content, "내 기록");
  assert.equal((await call("GET", "/api/note")).body.content, "내 노트");

  await call("DELETE", `/api/todos/${todo.id}`);
  await call("DELETE", `/api/learnings/${learning.id}`);
  await call("PUT", "/api/note", { content: "" });
});

test("할 일 CRUD", async () => {
  const created = await call("POST", "/api/todos", { title: "  우유 사기  " });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, "우유 사기");
  assert.equal(created.body.completed, false);
  const path = `/api/todos/${created.body.id}`;

  const before = (await call("GET", "/api/todos")).body;
  assert.ok(before.todos.some((todo) => todo.id === created.body.id));

  const updated = await call("PATCH", path, { completed: true, title: "두유 사기" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.completed, true);
  assert.equal(updated.body.title, "두유 사기");

  const onlyCompleted = await call("PATCH", path, { completed: false });
  assert.equal(onlyCompleted.body.title, "두유 사기", "지정하지 않은 필드는 유지된다");
  await call("PATCH", path, { completed: true });

  const after = (await call("GET", "/api/todos")).body;
  assert.equal(after.remaining, before.remaining - 1);

  assert.equal((await call("DELETE", path)).status, 204);
  const final = (await call("GET", "/api/todos")).body;
  assert.ok(!final.todos.some((todo) => todo.id === created.body.id));
});

test("할 일 입력 검증", async () => {
  const cases = [
    ["POST", "/api/todos", { title: "   " }],
    ["POST", "/api/todos", { title: "가".repeat(201) }],
    ["POST", "/api/todos", { title: 123 }],
    ["POST", "/api/todos", {}],
    ["POST", "/api/todos", { title: "널\u0000문자" }],
    ["PATCH", "/api/todos/1", {}],
    ["PATCH", "/api/todos/1", { completed: "true" }],
  ];
  for (const [method, path, payload] of cases) {
    const result = await call(method, path, payload);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.ok(result.body.error);
  }
});

test("글자 수 상한은 포함되고, 이모지는 한 글자로 센다", async () => {
  for (const title of ["가".repeat(200), "😀".repeat(200)]) {
    const created = await call("POST", "/api/todos", { title });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, title);
    await call("DELETE", `/api/todos/${created.body.id}`);
  }
});

test("잘못된 요청 형식", async () => {
  assert.equal((await call("POST", "/api/todos", undefined, { raw: "{oops" })).status, 400);
  assert.equal((await call("POST", "/api/todos", undefined, { raw: "[1]" })).status, 400);
  assert.equal((await call("POST", "/api/todos", undefined, { raw: "null" })).status, 400);
  assert.equal(
    (await call("POST", "/api/todos", undefined, { raw: '{"title":"x"}', contentType: "text/plain" })).status,
    415,
  );
  assert.equal((await call("POST", "/api/todos")).status, 415);
  assert.equal(
    (await call("PUT", "/api/note", { content: "가".repeat(30000) })).status,
    413,
  );
});

test("없는 항목과 경로, 허용되지 않는 메서드", async () => {
  for (const id of ["999999", "2147483648", "99999999999999999999", "abc", "-1", "1.5"]) {
    assert.equal((await call("PATCH", `/api/todos/${id}`, { completed: true })).status, 404, id);
    assert.equal((await call("DELETE", `/api/learnings/${id}`)).status, 404, id);
  }
  assert.equal((await call("GET", "/api/unknown")).status, 404);
  assert.equal((await call("DELETE", "/api/todos")).status, 405);
  assert.equal((await call("DELETE", "/api/note")).status, 405);
});

test("SQL 인젝션 문자열은 글자 그대로 저장된다", async () => {
  const title = "'); DROP TABLE todos; --";
  const created = await call("POST", "/api/todos", { title });
  assert.equal(created.body.title, title);
  assert.equal((await call("GET", "/api/todos")).status, 200);
  await call("DELETE", `/api/todos/${created.body.id}`);
});

test("배운 것 CRUD와 검증", async () => {
  const created = await call("POST", "/api/learnings", { content: "  CSS grid  " });
  assert.equal(created.status, 201);
  assert.equal(created.body.content, "CSS grid");
  const path = `/api/learnings/${created.body.id}`;

  assert.ok((await call("GET", "/api/learnings")).body.some((item) => item.id === created.body.id));

  const updated = await call("PATCH", path, { content: "Grid 정리" });
  assert.equal(updated.body.content, "Grid 정리");

  assert.equal((await call("DELETE", path)).status, 204);
  assert.equal((await call("DELETE", path)).status, 404);
  assert.equal((await call("PATCH", path, { content: "x" })).status, 404);

  for (const payload of [{ content: "  " }, { content: "가".repeat(501) }, { content: 1 }, {}]) {
    assert.equal((await call("POST", "/api/learnings", payload)).status, 400);
  }
  const atLimit = await call("POST", "/api/learnings", { content: "가".repeat(500) });
  assert.equal(atLimit.status, 201);
  await call("DELETE", `/api/learnings/${atLimit.body.id}`);
});

test("할 일과 배운 것은 서로 독립적이다", async () => {
  const learning = (await call("POST", "/api/learnings", { content: "독립" })).body;
  const todo = (await call("POST", "/api/todos", { title: "독립" })).body;
  await call("DELETE", `/api/todos/${todo.id}`);
  assert.ok((await call("GET", "/api/learnings")).body.some((item) => item.id === learning.id));
  await call("DELETE", `/api/learnings/${learning.id}`);
});

test("노트: 처음엔 비어 있고, 내용을 그대로 저장하며, 비울 수 있다", async () => {
  await as("note-owner", async () => {
    assert.deepEqual((await call("GET", "/api/note")).body, { content: "", updated_at: null });
  });

  const text = "  첫 줄\n\n  들여쓴 줄 <b>태그</b> '); DROP TABLE note; --\n";
  const saved = await call("PUT", "/api/note", { content: text });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.content, text);
  assert.equal((await call("GET", "/api/note")).body.content, text);

  assert.equal((await call("PUT", "/api/note", { content: "덮어쓰기" })).body.content, "덮어쓰기");
  assert.equal((await call("PUT", "/api/note", { content: "" })).status, 200);
  assert.equal((await call("GET", "/api/note")).body.content, "");
});

test("노트 검증: 실패해도 기존 내용이 유지된다", async () => {
  await call("PUT", "/api/note", { content: "유지" });
  for (const payload of [{ content: "가".repeat(10001) }, { content: 1 }, {}, { content: "\u0000" }]) {
    assert.equal((await call("PUT", "/api/note", payload)).status, 400);
  }
  assert.equal((await call("GET", "/api/note")).body.content, "유지");
  assert.equal((await call("PUT", "/api/note", { content: "가".repeat(10000) })).status, 200);
  await call("PUT", "/api/note", { content: "" });
});

test("동시에 저장해도 노트는 한 건이다", async () => {
  await Promise.all(
    Array.from({ length: 20 }, (_, index) => call("PUT", "/api/note", { content: String(index) })),
  );
  const { body } = await call("GET", "/api/note");
  assert.ok(/^\d+$/.test(body.content));
  await call("PUT", "/api/note", { content: "" });
});

// 다른 테스트에 영향을 주지 않도록 마지막에 둔다.
test("DB가 멈추면 503을 반환하고, 복구되면 데이터가 그대로 있다", async () => {
  const todo = (await call("POST", "/api/todos", { title: "재시작 후에도 유지" })).body;
  const learning = (await call("POST", "/api/learnings", { content: "재시작 후에도 유지" })).body;
  await call("PUT", "/api/note", { content: "재시작 후에도 유지" });

  database.postgres.stop();
  for (const path of ["/api/todos", "/api/learnings", "/api/note", "/api/health"]) {
    const result = await call("GET", path);
    assert.equal(result.status, 503, path);
    assert.ok(result.body.error);
  }
  assert.equal((await call("POST", "/api/todos", { title: "x" })).status, 503);

  database.postgres.start();
  await waitFor(async () => (await fetch(`${base}/api/health`)).ok, 10000);

  assert.ok((await call("GET", "/api/todos")).body.todos.some((item) => item.id === todo.id));
  assert.ok((await call("GET", "/api/learnings")).body.some((item) => item.id === learning.id));
  assert.equal((await call("GET", "/api/note")).body.content, "재시작 후에도 유지");
});
