"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Note } from "@/lib/api";
import { beforeLogout } from "@/lib/before-logout";

const SAVE_DELAY_MS = 500;

export function NotePanel() {
  const [value, setValue] = useState("");
  // 불러오기에 실패하면 입력을 막는다. 빈 입력창이 저장된 노트를 덮어쓰지 않게 하기 위해서다.
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState({ message: "", failed: false });

  const latestValue = useRef("");
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api<Note>("/api/note")
      .then((note) => {
        if (!active) return;
        latestValue.current = note.content;
        setValue(note.content);
        setLoaded(true);
        setStatus({ message: "입력하면 자동으로 저장됩니다.", failed: false });
      })
      .catch((error) => {
        if (active) setStatus({ message: `노트를 불러오지 못했습니다. ${error.message}`, failed: true });
      });
    return () => {
      active = false;
    };
  }, []);

  // 저장 대기 중에 탭을 닫거나 로그아웃해도 마지막 입력을 보낸다.
  useEffect(() => {
    const flush = async () => {
      if (!dirty.current) return;
      dirty.current = false;
      clearTimeout(timer.current);
      await fetch("/api/note", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: latestValue.current }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    beforeLogout.add(flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      beforeLogout.delete(flush);
      clearTimeout(timer.current);
    };
  }, []);

  // 저장은 한 번에 하나만 보낸다. 저장 중에 바뀐 내용은 끝난 뒤 이어서 저장해 순서가 꼬이지 않게 한다.
  async function save() {
    clearTimeout(timer.current);
    if (!dirty.current || saving.current) return;
    dirty.current = false;
    saving.current = true;
    setStatus({ message: "저장 중…", failed: false });
    try {
      await api("/api/note", "PUT", { content: latestValue.current });
      if (!dirty.current) setStatus({ message: "저장됨", failed: false });
    } catch (error) {
      dirty.current = true;
      saving.current = false;
      setStatus({ message: `저장하지 못했습니다. ${(error as Error).message}`, failed: true });
      return; // 다음 입력이나 포커스 이탈 때 다시 시도한다.
    }
    saving.current = false;
    save();
  }

  function onChange(next: string) {
    latestValue.current = next;
    dirty.current = true;
    setValue(next);
    setStatus({ message: "입력 중…", failed: false });
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }

  return (
    <section className="card" aria-labelledby="note-heading">
      <h2 id="note-heading">노트</h2>
      <textarea
        data-testid="note-input"
        value={value}
        maxLength={10000}
        placeholder="간단히 메모해 보세요"
        aria-labelledby="note-heading"
        disabled={!loaded}
        onChange={(event) => onChange(event.target.value)}
        onBlur={save}
      />
      <p className={status.failed ? "note-status failed" : "note-status"} aria-live="polite" data-testid="note-status">
        {status.message}
      </p>
    </section>
  );
}
