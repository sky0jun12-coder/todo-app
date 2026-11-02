"use client";

import { FormEvent, useState } from "react";
import { api, type User } from "@/lib/api";
import { ErrorMessage } from "./shared";

type Mode = "login" | "signup";

export function LoginForm(props: { notice: string; onSuccess: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";
  const title = isSignup ? "회원가입" : "로그인";

  function switchMode() {
    setMode(isSignup ? "login" : "signup");
    setPassword("");
    setConfirm("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (isSignup && password !== confirm) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>(`/api/auth/${mode}`, "POST", { username, password });
      props.onSuccess(user);
    } catch (failure) {
      setError((failure as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1 className="auth-title">{title}</h1>
        {props.notice && <p className="auth-notice">{props.notice}</p>}

        <label className="field">
          아이디
          <input
            type="text"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={30}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
          {isSignup && <span className="hint">영문 소문자, 숫자, -, _ 로 3~30자</span>}
        </label>

        <label className="field">
          비밀번호
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={200}
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />
          {isSignup && <span className="hint">8자 이상</span>}
        </label>

        {isSignup && (
          <label className="field">
            비밀번호 확인
            <input
              type="password"
              name="confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              maxLength={200}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        <ErrorMessage message={error} />

        <button type="submit" className="primary" disabled={submitting}>
          {title}
        </button>
        <button type="button" className="switch-mode" onClick={switchMode}>
          {isSignup ? "이미 계정이 있나요? 로그인" : "계정이 없나요? 회원가입"}
        </button>
      </form>
    </main>
  );
}
