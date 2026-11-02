"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// 목록 하나를 불러오고, 변경 요청 뒤 다시 불러오는 공통 로직.
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const current = ++latest.current;
    const next = await api<T>(path);
    if (current === latest.current) setData(next); // 가장 최근 요청의 결과만 반영한다.
  }, [path]);

  // 실패하면 오류를 표시하고 false를 반환한다.
  const mutate = useCallback(
    async (target: string, method: string, payload?: unknown) => {
      try {
        await api(target, method, payload);
        setError("");
        await reload();
        return true;
      } catch (failure) {
        setError((failure as Error).message);
        return false;
      }
    },
    [reload],
  );

  useEffect(() => {
    reload().catch((failure) => setError(failure.message));
  }, [reload]);

  return { data, setData, error, setError, mutate };
}
