"use client";

import { useCallback, useEffect, useState } from "react";
import { api, SESSION_EXPIRED_EVENT, type User } from "@/lib/api";
import { beforeLogout } from "@/lib/before-logout";
import { LearnedPanel } from "./LearnedPanel";
import { LoginForm } from "./LoginForm";
import { NotePanel } from "./NotePanel";
import { ErrorMessage } from "./shared";
import { TodoPanel } from "./TodoPanel";

type Status = "loading" | "failed" | "ready";

export function AuthGate() {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState("");
  const [logoutError, setLogoutError] = useState("");

  const loadUser = useCallback(async () => {
    setStatus("loading");
    try {
      setUser((await api<{ user: User | null }>("/api/auth/me")).user);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setNotice("세션이 만료되었습니다. 다시 로그인해 주세요.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  async function logout() {
    try {
      await Promise.all([...beforeLogout].map((task) => task()));
      await api("/api/auth/logout", "POST");
      setLogoutError("");
      setNotice("");
      setUser(null);
    } catch (error) {
      setLogoutError((error as Error).message);
    }
  }

  if (status === "loading") {
    return <h1 className="visually-hidden">할 일, 배운 것, 노트</h1>;
  }

  if (status === "failed") {
    return (
      <main className="auth-page">
        <div className="card auth-card">
          <h1 className="auth-title">서버에 연결할 수 없습니다</h1>
          <button type="button" className="primary" onClick={loadUser}>
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginForm
        notice={notice}
        onSuccess={(next) => {
          setNotice("");
          setUser(next);
        }}
      />
    );
  }

  return (
    <>
      <h1 className="visually-hidden">할 일, 배운 것, 노트</h1>
      <header className="topbar">
        <ErrorMessage message={logoutError} />
        <span className="username" data-testid="username">{user.username}</span>
        <button type="button" className="logout" onClick={logout}>
          로그아웃
        </button>
      </header>
      {/* 사용자가 바뀌면 패널 상태를 모두 새로 시작한다. */}
      <main className="layout" key={user.id}>
        <LearnedPanel />
        <TodoPanel />
        <NotePanel />
      </main>
    </>
  );
}
