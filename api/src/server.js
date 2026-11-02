import { createApp } from "./app.js";
import { createStore } from "./store.js";

const HOST = process.env.API_HOST ?? "127.0.0.1"; // 컨테이너에서는 0.0.0.0으로 지정한다.
const PORT = Number(process.env.API_PORT ?? 4000);
const REQUIRED_DB_ENV = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];

const missing = REQUIRED_DB_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[api] 환경 변수가 없습니다: ${missing.join(", ")}`);
  process.exit(1);
}

const store = createStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const app = createApp(store, { cookieSecure: process.env.COOKIE_SECURE === "true" });

const server = app.listen(PORT, HOST, (error) => {
  if (error) {
    console.error(`[api] 포트 ${PORT}에서 시작하지 못했습니다:`, error.message);
    process.exit(1);
  }
  console.log(`[api] http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => store.close().finally(() => process.exit(0)));
  server.closeAllConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
