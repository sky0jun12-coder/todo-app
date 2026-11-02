export type Todo = {
  id: number;
  title: string;
  completed: boolean;
  created_at: string;
};

export type TodoList = { todos: Todo[]; remaining: number };

export type Learning = { id: number; content: string; created_at: string };

export type Note = { content: string; updated_at: string | null };

export type User = { id: number; username: string };

export const SESSION_EXPIRED_EVENT = "auth:session-expired";

export async function api<T = unknown>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const options: RequestInit = { method };
  if (payload !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("서버에 연결할 수 없습니다.");
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  // 로그인 실패도 401이므로, 인증 API 외의 401만 세션 만료로 본다.
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok) {
    throw new Error(data?.error ?? "서버에 연결할 수 없습니다.");
  }
  return data as T;
}
