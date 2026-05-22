/* SPDX-License-Identifier: Apache-2.0 */
import { useCallback, useEffect, useReducer } from "react";
import {
  MemoryListSchema,
  MemoryMutationSchema,
  type MemoryEntry,
  type MemoryFetchStatus,
  type UseMemoryOptions,
  type UseMemoryReturn,
} from "./types.js";

interface MemoryState {
  memories: MemoryEntry[];
  status: MemoryFetchStatus;
}

type MemoryAction =
  | { type: "fetch_start" }
  | { type: "fetch_success"; memories: MemoryEntry[] }
  | { type: "fetch_error" }
  | { type: "mutation_success"; memories: MemoryEntry[] };

function memoryReducer(state: MemoryState, action: MemoryAction): MemoryState {
  switch (action.type) {
    case "fetch_start":
      return { ...state, status: "loading" };
    case "fetch_success":
      return { memories: action.memories, status: "idle" };
    case "fetch_error":
      return { ...state, status: "error" };
    case "mutation_success":
      return { memories: action.memories, status: "idle" };
    default:
      return state;
  }
}

function memoryUrl(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}/memory`;
}

export function useMemory(opts: UseMemoryOptions): UseMemoryReturn {
  const [state, dispatch] = useReducer(memoryReducer, {
    memories: [],
    status: "idle",
  });

  const listMemories = useCallback(async () => {
    dispatch({ type: "fetch_start" });
    try {
      const response = await fetch(memoryUrl(opts.endpoint));
      if (!response.ok) {
        dispatch({ type: "fetch_error" });
        return;
      }
      const json: unknown = await response.json();
      const parsed = MemoryListSchema.safeParse(json);
      if (!parsed.success) {
        dispatch({ type: "fetch_error" });
        return;
      }
      dispatch({ type: "fetch_success", memories: parsed.data.memories });
    } catch {
      dispatch({ type: "fetch_error" });
    }
  }, [opts.endpoint]);

  useEffect(() => {
    void listMemories();
  }, [listMemories]);

  const save = useCallback(
    async (key: string, value: string) => {
      dispatch({ type: "fetch_start" });
      try {
        const response = await fetch(memoryUrl(opts.endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!response.ok) {
          dispatch({ type: "fetch_error" });
          return;
        }
        const json: unknown = await response.json();
        const parsed = MemoryMutationSchema.safeParse(json);
        if (!parsed.success) {
          dispatch({ type: "fetch_error" });
          return;
        }
        dispatch({
          type: "mutation_success",
          memories: parsed.data.memories,
        });
      } catch {
        dispatch({ type: "fetch_error" });
      }
    },
    [opts.endpoint],
  );

  const remove = useCallback(
    async (key: string) => {
      dispatch({ type: "fetch_start" });
      try {
        const response = await fetch(memoryUrl(opts.endpoint), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (!response.ok) {
          dispatch({ type: "fetch_error" });
          return;
        }
        const json: unknown = await response.json();
        const parsed = MemoryMutationSchema.safeParse(json);
        if (!parsed.success) {
          dispatch({ type: "fetch_error" });
          return;
        }
        dispatch({
          type: "mutation_success",
          memories: parsed.data.memories,
        });
      } catch {
        dispatch({ type: "fetch_error" });
      }
    },
    [opts.endpoint],
  );

  return {
    memories: state.memories,
    save,
    remove,
    status: state.status,
  };
}
