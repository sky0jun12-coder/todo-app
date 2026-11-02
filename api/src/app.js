// 애플리케이션 티어: REST API와 업무 규칙. 저장은 store에 맡긴다.
import express from "express";
import {
  createLoginThrottle,
  DUMMY_HASH,
  hashPassword,
  hashToken,
  newSessionToken,
  readCookie,
  verifyPassword,
} from "./auth.js";
import { ApiError } from "./errors.js";

const MAX_TITLE_LENGTH = 200;
const MAX_LEARNING_LENGTH = 500;
const MAX_NOTE_LENGTH = 10000;
const MAX_ID = 2147483647; // PostgreSQL INTEGER 상한
const USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const length = (text) => [...text].length; // 이모지도 한 글자로 센다.

function assertString(value, name) {
  if (typeof value !== "string") throw new ApiError(400, `${name}은 문자열이어야 합니다.`);
  // PostgreSQL TEXT는 NUL 문자를 저장할 수 없다.
  if (value.includes("\u0000")) throw new ApiError(400, `${name}에 허용되지 않는 문자가 있습니다.`);
}

function cleanText(value, name, limit) {
  assertString(value, name);
  const text = value.trim();
  if (!text) throw new ApiError(400, `${name}을 입력해 주세요.`);
  if (length(text) > limit) throw new ApiError(400, `${name}은 ${limit}자 이하로 입력해 주세요.`);
  return text;
}

// 노트는 비워 둘 수 있고, 사용자가 입력한 공백과 줄바꿈을 그대로 보존한다.
function cleanNote(value) {
  assertString(value, "노트");
  if (length(value) > MAX_NOTE_LENGTH) {
    throw new ApiError(400, `노트는 ${MAX_NOTE_LENGTH}자 이하로 입력해 주세요.`);
  }
  return value;
}

function cleanUsername(value) {
  assertString(value, "아이디");
  return value.trim().toLowerCase();
}

function parseId(raw) {
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(id <= MAX_ID)) throw new ApiError(404, "항목을 찾을 수 없습니다.");
  return id;
}

function jsonBody(req) {
  if (!req.is("application/json")) {
    throw new ApiError(415, "Content-Type은 application/json이어야 합니다.");
  }
  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "요청 본문은 JSON 객체여야 합니다.");
  }
  return body;
}

function found(value) {
  if (!value) throw new ApiError(404, "항목을 찾을 수 없습니다.");
  return value;
}

function methodNotAllowed() {
  throw new ApiError(405, "허용되지 않는 메서드입니다.");
}

export function createApp(store, { cookieSecure = false } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  const loginThrottle = createLoginThrottle({
    maxFailures: LOGIN_MAX_FAILURES,
    windowMs: LOGIN_WINDOW_MS,
  });
  const cookieOptions = { httpOnly: true, sameSite: "lax", secure: cookieSecure, path: "/" };

  async function startSession(res, user) {
    const token = newSessionToken();
    await store.createSession(hashToken(token), user.id, SESSION_MAX_AGE_MS);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS });
  }

  async function sessionUser(req) {
    const token = readCookie(req, SESSION_COOKIE);
    return token ? store.findSessionUser(hashToken(token)) : null;
  }

  app.route("/api/health")
    .get(async (req, res) => {
      await store.ping();
      res.json({ status: "ok" });
    })
    .all(methodNotAllowed);

  app.route("/api/auth/signup")
    .post(async (req, res) => {
      const body = jsonBody(req);
      const username = cleanUsername(body.username);
      if (!USERNAME_PATTERN.test(username)) {
        throw new ApiError(400, "아이디는 영문 소문자, 숫자, -, _ 로 3~30자여야 합니다.");
      }
      assertString(body.password, "비밀번호");
      const passwordLength = length(body.password);
      if (passwordLength < MIN_PASSWORD_LENGTH || passwordLength > MAX_PASSWORD_LENGTH) {
        throw new ApiError(400, `비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자여야 합니다.`);
      }
      const user = await store.createUser(username, await hashPassword(body.password));
      if (!user) throw new ApiError(409, "이미 사용 중인 아이디입니다.");
      await startSession(res, user);
      res.status(201).json({ user });
    })
    .all(methodNotAllowed);

  app.route("/api/auth/login")
    .post(async (req, res) => {
      const body = jsonBody(req);
      const username = cleanUsername(body.username);
      assertString(body.password, "비밀번호");
      // 해시 계산 비용이 크므로 너무 긴 입력은 계산 전에 거절한다.
      if (length(body.password) > MAX_PASSWORD_LENGTH) {
        throw new ApiError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      if (loginThrottle.isBlocked(username)) {
        throw new ApiError(429, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      }
      const user = await store.findUserByUsername(username);
      const valid = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid) {
        loginThrottle.recordFailure(username);
        throw new ApiError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
      }
      loginThrottle.reset(username);
      await startSession(res, user);
      res.json({ user: { id: user.id, username: user.username } });
    })
    .all(methodNotAllowed);

  app.route("/api/auth/logout")
    .post(async (req, res) => {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await store.deleteSession(hashToken(token));
      res.clearCookie(SESSION_COOKIE, cookieOptions);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  app.route("/api/auth/me")
    .get(async (req, res) => res.json({ user: await sessionUser(req) }))
    .all(methodNotAllowed);

  // 여기부터는 로그인이 필요하다.
  app.use("/api", async (req, res, next) => {
    req.user = await sessionUser(req);
    if (!req.user) throw new ApiError(401, "로그인이 필요합니다.");
    next();
  });

  app.route("/api/todos")
    .get(async (req, res) => {
      const todos = await store.listTodos(req.user.id);
      res.json({ todos, remaining: todos.filter((todo) => !todo.completed).length });
    })
    .post(async (req, res) => {
      const title = cleanText(jsonBody(req).title, "제목", MAX_TITLE_LENGTH);
      res.status(201).json(await store.createTodo(req.user.id, title));
    })
    .all(methodNotAllowed);

  app.route("/api/todos/:id")
    .patch(async (req, res) => {
      const id = parseId(req.params.id);
      const body = jsonBody(req);
      const fields = {};
      if ("title" in body) fields.title = cleanText(body.title, "제목", MAX_TITLE_LENGTH);
      if ("completed" in body) {
        if (typeof body.completed !== "boolean") {
          throw new ApiError(400, "completed는 true 또는 false여야 합니다.");
        }
        fields.completed = body.completed;
      }
      if (Object.keys(fields).length === 0) throw new ApiError(400, "변경할 항목이 없습니다.");
      res.json(found(await store.updateTodo(req.user.id, id, fields)));
    })
    .delete(async (req, res) => {
      found(await store.deleteTodo(req.user.id, parseId(req.params.id)));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  app.route("/api/learnings")
    .get(async (req, res) => res.json(await store.listLearnings(req.user.id)))
    .post(async (req, res) => {
      const content = cleanText(jsonBody(req).content, "내용", MAX_LEARNING_LENGTH);
      res.status(201).json(await store.createLearning(req.user.id, content));
    })
    .all(methodNotAllowed);

  app.route("/api/learnings/:id")
    .patch(async (req, res) => {
      const id = parseId(req.params.id);
      const content = cleanText(jsonBody(req).content, "내용", MAX_LEARNING_LENGTH);
      res.json(found(await store.updateLearning(req.user.id, id, content)));
    })
    .delete(async (req, res) => {
      found(await store.deleteLearning(req.user.id, parseId(req.params.id)));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  app.route("/api/note")
    .get(async (req, res) => res.json(await store.getNote(req.user.id)))
    .put(async (req, res) => {
      res.json(await store.saveNote(req.user.id, cleanNote(jsonBody(req).content)));
    })
    .all(methodNotAllowed);

  app.use(() => {
    throw new ApiError(404, "경로를 찾을 수 없습니다.");
  });

  app.use((error, req, res, next) => {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON 형식이 올바르지 않습니다." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "요청 본문이 너무 큽니다." });
    }
    console.error("[api] 처리되지 않은 오류:", error);
    return res.status(500).json({ error: "서버 오류가 발생했습니다." });
  });

  return app;
}
