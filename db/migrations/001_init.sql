-- 초기 스키마.
CREATE TABLE IF NOT EXISTS todos (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      TEXT        NOT NULL,
  completed  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learnings (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 노트는 한 건만 존재한다.
CREATE TABLE IF NOT EXISTS note (
  id         SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content    TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
