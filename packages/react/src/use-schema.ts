/* SPDX-License-Identifier: Apache-2.0 */
import { useCallback, useEffect, useReducer } from "react";
import {
  SchemaResponseSchema,
  type SchemaFetchStatus,
  type SchemaOwner,
  type UseSchemaOptions,
  type UseSchemaReturn,
} from "./types.js";

interface SchemaState {
  catalog: Record<string, unknown> | null;
  entities: Record<string, unknown>[];
  owner: SchemaOwner | null;
  status: SchemaFetchStatus;
}

type SchemaAction =
  | { type: "fetch_start" }
  | {
      type: "fetch_success";
      catalog: Record<string, unknown>;
      entities: Record<string, unknown>[];
      owner: SchemaOwner;
    }
  | { type: "fetch_error" };

function schemaReducer(state: SchemaState, action: SchemaAction): SchemaState {
  switch (action.type) {
    case "fetch_start":
      return { ...state, status: "loading" };
    case "fetch_success":
      return {
        catalog: action.catalog,
        entities: action.entities,
        owner: action.owner,
        status: "idle",
      };
    case "fetch_error":
      return { ...state, status: "error" };
    default:
      return state;
  }
}

function schemaUrl(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}/schema`;
}

export function useSchema(opts: UseSchemaOptions): UseSchemaReturn {
  const [state, dispatch] = useReducer(schemaReducer, {
    catalog: null,
    entities: [],
    owner: null,
    status: "idle",
  });

  const fetchSchema = useCallback(async () => {
    dispatch({ type: "fetch_start" });
    try {
      const response = await fetch(schemaUrl(opts.endpoint));
      if (!response.ok) {
        dispatch({ type: "fetch_error" });
        return;
      }
      const json: unknown = await response.json();
      const parsed = SchemaResponseSchema.safeParse(json);
      if (!parsed.success) {
        dispatch({ type: "fetch_error" });
        return;
      }
      dispatch({
        type: "fetch_success",
        catalog: parsed.data.catalog,
        entities: parsed.data.entities,
        owner: parsed.data.owner,
      });
    } catch {
      dispatch({ type: "fetch_error" });
    }
  }, [opts.endpoint]);

  useEffect(() => {
    void fetchSchema();
  }, [fetchSchema]);

  return {
    catalog: state.catalog,
    entities: state.entities,
    owner: state.owner,
    status: state.status,
    refetch: () => {
      void fetchSchema();
    },
  };
}
