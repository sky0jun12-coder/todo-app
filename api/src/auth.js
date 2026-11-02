// 비밀번호 해시, 세션 토큰, 로그인 시도 제한.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt, "hex"), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

// 없는 아이디로 로그인해도 같은 시간이 걸리게 해서, 응답 시간으로 아이디 존재 여부를 알 수 없게 한다.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export const newSessionToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// 아이디별 연속 실패 횟수를 프로세스 메모리에 기록한다. 재시작하면 초기화된다.
export function createLoginThrottle({ maxFailures, windowMs, maxEntries = 10000 }) {
  const failures = new Map();

  function current(key) {
    const entry = failures.get(key);
    if (entry && entry.resetAt <= Date.now()) {
      failures.delete(key);
      return null;
    }
    return entry ?? null;
  }

  return {
    isBlocked: (key) => (current(key)?.count ?? 0) >= maxFailures,
    recordFailure(key) {
      const entry = current(key);
      if (entry) {
        entry.count += 1;
        return;
      }
      if (failures.size >= maxEntries) {
        for (const [oldKey, old] of failures) {
          if (old.resetAt <= Date.now()) failures.delete(oldKey);
        }
        if (failures.size >= maxEntries) failures.clear();
      }
      failures.set(key, { count: 1, resetAt: Date.now() + windowMs });
    },
    reset: (key) => failures.delete(key),
  };
}
