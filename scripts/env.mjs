// .env 파일을 읽어 환경 변수로 설정한다. 이미 설정된 값은 덮어쓰지 않는다.
// process.loadEnvFile이 없는 Node 18에서도 동작해야 한다.
import { existsSync, readFileSync } from "node:fs";

export const REQUIRED_DB_ENV = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];

export function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
  }
}

export const missingDbEnv = () => REQUIRED_DB_ENV.filter((name) => !process.env[name]);
