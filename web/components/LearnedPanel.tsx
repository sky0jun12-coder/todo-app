"use client";

import { useState } from "react";
import type { Learning } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { AddForm, ErrorMessage, InlineEditor, ItemActions } from "./shared";

export function LearnedPanel() {
  const { data, error, mutate } = useResource<Learning[]>("/api/learnings");
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <section className="card" aria-labelledby="learned-heading">
      <h2 id="learned-heading">배운 것</h2>
      <AddForm
        label="새로 배운 것"
        placeholder="오늘 배운 것을 적어 보세요"
        maxLength={500}
        onAdd={(content) => mutate("/api/learnings", "POST", { content })}
      />
      <ErrorMessage message={error} />

      <div className="side-list">
        <ul className="list" data-testid="learned-list">
          {data?.map((learning) => (
            <li className="item" key={learning.id}>
              {editingId === learning.id ? (
                <InlineEditor
                  initial={learning.content}
                  maxLength={500}
                  onFinish={(content, save) => {
                    setEditingId(null);
                    if (save && content !== learning.content) {
                      mutate(`/api/learnings/${learning.id}`, "PATCH", { content });
                    }
                  }}
                />
              ) : (
                <>
                  <div className="body">
                    <span className="title">{learning.content}</span>
                    <time className="meta" dateTime={learning.created_at}>
                      {new Date(learning.created_at).toLocaleDateString("ko-KR")}
                    </time>
                  </div>
                  <ItemActions
                    name={learning.content}
                    onEdit={() => setEditingId(learning.id)}
                    onDelete={() => mutate(`/api/learnings/${learning.id}`, "DELETE")}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        {data?.length === 0 && <p className="empty">아직 기록이 없습니다.</p>}
      </div>
    </section>
  );
}
