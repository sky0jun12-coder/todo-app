# 3티어 Todo 앱

왼쪽에 배운 것, 가운데에 할 일, 오른쪽에 노트가 있는 앱입니다.
회원가입 후 로그인해서 사용하며, 데이터는 사용자별로 분리됩니다.
세 티어는 각각 별도 프로세스로 실행되며, 바로 옆 티어와만 통신합니다.

```
브라우저
   │
   ▼
웹 티어   web/  Next.js     :3000  화면, /api/* 를 API 티어로 전달
   │ HTTP
   ▼
API 티어  api/  Node.js     :4000  REST API(Express), 입력 검증과 업무 규칙
   │ SQL
   ▼
DB 티어   db/   PostgreSQL         접속정보는 환경 변수로 지정
```

## 준비

Node.js 22 이상과 PostgreSQL 18이 필요합니다.

```sh
brew install node postgresql@18
npm install
cp .env.example .env   # 값을 채웁니다.
```

DB 접속정보는 코드에 없고 환경 변수로만 받습니다. `.env` 또는 셸에서 지정하며,
셸에 설정한 값이 `.env`보다 우선합니다. 값이 빠져 있으면 앱이 시작되지 않습니다.

Homebrew 외의 경로에 PostgreSQL을 설치했다면 `PG_BIN`에 `bin` 폴더 경로를 지정합니다.

## 실행

```sh
npm run dev
```

브라우저에서 http://127.0.0.1:3000 을 엽니다. `Ctrl+C`를 누르면 세 티어가 모두 종료됩니다.

처음 실행하면 `.env`의 계정과 비밀번호로 `db/pgdata`에 프로젝트 전용 DB를 만듭니다.
이후 `.env`의 `DB_USER`, `DB_PASSWORD`만 바꾸면 기존 DB에 접속할 수 없으니,
바꾸려면 DB에서도 같은 값으로 변경하세요.
외부 PostgreSQL을 쓰려면 `PG_MANAGED=false`와 해당 접속정보를 지정합니다. 이때 그 DB는 미리 만들어 두어야 합니다.
모든 서버는 `127.0.0.1`에만 바인딩되어 다른 기기에서는 접속할 수 없습니다.

## 테스트

```sh
npm test            # 임시 DB로 실행하므로 실제 데이터에 영향이 없습니다.
npm run typecheck
```

Next.js 개발 서버는 폴더당 하나만 뜰 수 있으므로, 앱을 끈 상태에서 `npm test`를 실행하세요.

## API

| 메서드 | 경로 | 본문 | 설명 |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{"username": "...", "password": "..."}` | 회원가입 후 로그인 |
| POST | `/api/auth/login` | `{"username": "...", "password": "..."}` | 로그인 |
| POST | `/api/auth/logout` | | 로그아웃 |
| GET | `/api/auth/me` | | 현재 사용자 조회 (`user`, 미로그인이면 `null`) |
| GET | `/api/todos` | | 목록과 남은 개수(`remaining`) 조회 |
| POST | `/api/todos` | `{"title": "..."}` | 할 일 추가 |
| PATCH | `/api/todos/{id}` | `{"title": "...", "completed": true}` | 제목 또는 완료 상태 변경 |
| DELETE | `/api/todos/{id}` | | 삭제 |
| GET | `/api/learnings` | | 배운 것 목록 조회 |
| POST | `/api/learnings` | `{"content": "..."}` | 배운 것 추가 |
| PATCH | `/api/learnings/{id}` | `{"content": "..."}` | 배운 것 수정 |
| DELETE | `/api/learnings/{id}` | | 배운 것 삭제 |
| GET | `/api/note` | | 노트 조회 |
| PUT | `/api/note` | `{"content": "..."}` | 노트 저장 (전체 덮어쓰기) |
| GET | `/api/health` | | API와 DB 티어 상태 확인 |

`/api/auth/*`와 `/api/health`를 제외한 API는 로그인이 필요하며, 없으면 401을 반환합니다.

- 아이디: 영문 소문자, 숫자, `-`, `_` 로 3~30자 (대문자는 소문자로 바꿔 저장)
- 비밀번호: 8~200자, scrypt 해시로 저장
- 세션: 30일 유지, HttpOnly 쿠키. DB에는 토큰의 SHA-256 해시만 저장
- 로그인 실패 10회: 해당 아이디는 15분간 로그인 불가 (API를 재시작하면 초기화)
- 할 일 제목: 앞뒤 공백을 제거한 뒤 1~200자
- 배운 것: 앞뒤 공백을 제거한 뒤 1~500자
- 노트: 0~10,000자, 공백과 줄바꿈은 입력한 그대로 저장

## DB 스키마 변경

`db/migrations/`에 `003_설명.sql`처럼 번호를 붙여 파일을 추가하면, 다음 실행 때 파일마다 한 트랜잭션으로
한 번씩 적용됩니다. 적용 기록은 `schema_migrations` 테이블에 남습니다. 이미 적용한 파일은 고치지 마세요.

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DB_HOST` | 필수 | | DB 주소 |
| `DB_PORT` | 필수 | | DB 포트 |
| `DB_USER` | 필수 | | DB 계정 |
| `DB_PASSWORD` | 필수 | | DB 비밀번호 |
| `DB_NAME` | 필수 | | DB 이름 |
| `PG_MANAGED` | | `true` | `false`면 프로젝트 전용 DB를 켜지 않고 외부 DB에 접속 |
| `COOKIE_SECURE` | | `false` | HTTPS로 서비스할 때 `true` |
| `WEB_PORT` | | `3000` | 웹 티어 포트 |
| `API_PORT` | | `4000` | API 티어 포트 |
| `PGDATA_DIR` | | `db/pgdata` | 프로젝트 전용 DB의 데이터 폴더 |
