-- 로그인과 사용자별 데이터. 계정 없는 데이터가 남아 있으면 소유자를 정할 수 없으므로
-- 조용히 지우지 않고 실패한다. (전체가 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM todos) OR EXISTS (SELECT 1 FROM learnings) OR EXISTS (SELECT 1 FROM note) THEN
    RAISE EXCEPTION '소유자가 없는 기존 데이터가 있어 마이그레이션을 중단합니다.';
  END IF;
END $$;

CREATE TABLE users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다.
CREATE TABLE sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

ALTER TABLE todos ADD COLUMN user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX todos_user_id_idx ON todos (user_id, id DESC);

ALTER TABLE learnings ADD COLUMN user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX learnings_user_id_idx ON learnings (user_id, id DESC);

-- 노트는 사용자마다 한 건이다.
DROP TABLE note;
CREATE TABLE notes (
  user_id    INTEGER     PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
