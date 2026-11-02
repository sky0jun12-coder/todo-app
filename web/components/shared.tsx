"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

export function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="error" role="alert" hidden={!message}>
      {message}
    </p>
  );
}

export function AddForm(props: {
  label: string;
  placeholder: string;
  maxLength: number;
  autoFocus?: boolean;
  onAdd: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await props.onAdd(value)) setValue("");
    input.current?.focus();
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <input
        ref={input}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        aria-label={props.label}
        autoComplete="off"
        autoFocus={props.autoFocus}
      />
      <button type="submit">추가</button>
    </form>
  );
}

// 한 줄 수정 입력창. Enter와 포커스 이탈은 저장, Esc는 취소이며 한 번만 처리된다.
export function InlineEditor(props: {
  initial: string;
  maxLength: number;
  onFinish: (value: string, save: boolean) => void;
}) {
  const [value, setValue] = useState(props.initial);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    props.onFinish(value.trim(), save);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return; // 한글 조합 중의 Enter는 저장으로 처리하지 않는다.
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  }

  return (
    <input
      ref={input}
      type="text"
      value={value}
      maxLength={props.maxLength}
      aria-label="수정할 내용"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

export function ItemActions(props: { name: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="actions">
      <button type="button" className="edit" aria-label={`${props.name} 수정`} onClick={props.onEdit}>
        수정
      </button>
      <button type="button" className="delete" aria-label={`${props.name} 삭제`} onClick={props.onDelete}>
        삭제
      </button>
    </div>
  );
}
