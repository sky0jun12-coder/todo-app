// 데이터 티어 접근. SQL은 이 파일에만 두고, 사용자 데이터 조회에는 항상 userId 조건을 건다.
import pg from "pg";
import { ApiError } from "./errors.js";

export function createStore(connection) {
  const pool = new pg.Pool({
    ...connection,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  // 유휴 연결이 끊겨도 프로세스가 죽지 않게 하고, 다음 요청에서 다시 연결한다.
  pool.on("error", (error) => console.error("[api] 유휴 DB 연결 오류:", error.message));

  async function rows(text, values) {
    try {
      return (await pool.query(text, values)).rows;
    } catch (error) {
      console.error("[api] DB 오류:", error.message);
      throw new ApiError(503, "데이터 저장소에 연결할 수 없습니다.");
    }
  }

  const TODO = "id, title, completed, created_at";
  const LEARNING = "id, content, created_at";

  return {
    ping: () => rows("SELECT 1"),
    close: () => pool.end(),

    // 이미 있는 아이디면 null을 반환한다.
    async createUser(username, passwordHash) {
      const created = await rows(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING
         RETURNING id, username`,
        [username, passwordHash],
      );
      return created[0] ?? null;
    },
    async findUserByUsername(username) {
      return (await rows("SELECT id, username, password_hash FROM users WHERE username = $1", [username]))[0] ?? null;
    },

    async createSession(tokenHash, userId, maxAgeMs) {
      await rows("DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()", [userId]);
      await rows(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 millisecond')",
        [tokenHash, userId, maxAgeMs],
      );
    },
    async findSessionUser(tokenHash) {
      const found = await rows(
        `SELECT users.id, users.username
           FROM sessions JOIN users ON users.id = sessions.user_id
          WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
        [tokenHash],
      );
      return found[0] ?? null;
    },
    deleteSession: (tokenHash) => rows("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]),

    listTodos: (userId) =>
      rows(`SELECT ${TODO} FROM todos WHERE user_id = $1 ORDER BY id DESC`, [userId]),
    async createTodo(userId, title) {
      return (await rows(`INSERT INTO todos (user_id, title) VALUES ($1, $2) RETURNING ${TODO}`, [userId, title]))[0];
    },
    async updateTodo(userId, id, { title = null, completed = null }) {
      const updated = await rows(
        `UPDATE todos
            SET title = COALESCE($3, title), completed = COALESCE($4, completed)
          WHERE id = $1 AND user_id = $2
        RETURNING ${TODO}`,
        [id, userId, title, completed],
      );
      return updated[0] ?? null;
    },
    async deleteTodo(userId, id) {
      return (await rows("DELETE FROM todos WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
    },

    listLearnings: (userId) =>
      rows(`SELECT ${LEARNING} FROM learnings WHERE user_id = $1 ORDER BY id DESC`, [userId]),
    async createLearning(userId, content) {
      return (await rows(`INSERT INTO learnings (user_id, content) VALUES ($1, $2) RETURNING ${LEARNING}`, [userId, content]))[0];
    },
    async updateLearning(userId, id, content) {
      const updated = await rows(
        `UPDATE learnings SET content = $3 WHERE id = $1 AND user_id = $2 RETURNING ${LEARNING}`,
        [id, userId, content],
      );
      return updated[0] ?? null;
    },
    async deleteLearning(userId, id) {
      return (await rows("DELETE FROM learnings WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
    },

    async getNote(userId) {
      const found = await rows("SELECT content, updated_at FROM notes WHERE user_id = $1", [userId]);
      return found[0] ?? { content: "", updated_at: null };
    },
    async saveNote(userId, content) {
      const saved = await rows(
        `INSERT INTO notes (user_id, content) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
         RETURNING content, updated_at`,
        [userId, content],
      );
      return saved[0];
    },
  };
}
