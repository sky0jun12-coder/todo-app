"use client";

import { useState } from "react";
import type { Todo, TodoList } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { AddForm, ErrorMessage, InlineEditor, ItemActions } from "./shared";

type Filter = "all" | "active" | "completed";

const FILTERS: { value: Filter; label: string; empty: string }[] = [
  { value: "all", label: "전체", empty: "아직 할 일이 없습니다." },
  { value: "active", label: "진행 중", empty: "진행 중인 할 일이 없습니다." },
  { value: "completed", label: "완료", empty: "완료한 할 일이 없습니다." },
];

function matches(todo: Todo, filter: Filter) {
  if (filter === "active") return !todo.completed;
  if (filter === "completed") return todo.completed;
  return true;
}

export function TodoPanel() {
  const { data, setData, error, mutate } = useResource<TodoList>("/api/todos");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);

  const todos = data?.todos.filter((todo) => matches(todo, filter));

  async function toggle(todo: Todo, completed: boolean) {
    // 체크 표시를 바로 반영하고, 실패하면 되돌린다.
    const previous = data;
    if (previous) {
      setData({
        ...previous,
        todos: previous.todos.map((item) => (item.id === todo.id ? { ...item, completed } : item)),
      });
    }
    const saved = await mutate(`/api/todos/${todo.id}`, "PATCH", { completed });
    if (!saved) setData(previous);
  }

  return (
    <section className="card todos-panel" aria-labelledby="todos-heading">
      <h2 id="todos-heading">할 일</h2>
      <AddForm
        label="새 할 일"
        placeholder="할 일을 입력하세요"
        maxLength={200}
        autoFocus
        onAdd={(title) => mutate("/api/todos", "POST", { title })}
      />
      <ErrorMessage message={error} />

      <div className="filters" role="group" aria-label="목록 필터">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setEditingId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="list" data-testid="todo-list">
        {todos?.map((todo) => (
          <li className={todo.completed ? "item completed" : "item"} key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              aria-label={`${todo.title} 완료 표시`}
              onChange={(event) => toggle(todo, event.target.checked)}
            />
            {editingId === todo.id ? (
              <InlineEditor
                initial={todo.title}
                maxLength={200}
                onFinish={(title, save) => {
                  setEditingId(null);
                  if (save && title !== todo.title) {
                    mutate(`/api/todos/${todo.id}`, "PATCH", { title });
                  }
                }}
              />
            ) : (
              <>
                <div className="body">
                  <span className="title">{todo.title}</span>
                </div>
                <ItemActions
                  name={todo.title}
                  onEdit={() => setEditingId(todo.id)}
                  onDelete={() => mutate(`/api/todos/${todo.id}`, "DELETE")}
                />
              </>
            )}
          </li>
        ))}
      </ul>
      {todos?.length === 0 && (
        <p className="empty">{FILTERS.find(({ value }) => value === filter)?.empty}</p>
      )}

      <p className="remaining" aria-live="polite">
        {data && `남은 할 일 ${data.todos.filter((todo) => !todo.completed).length}개`}
      </p>
    </section>
  );
}
