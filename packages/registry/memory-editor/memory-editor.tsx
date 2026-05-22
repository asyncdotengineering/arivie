/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { useMemory } from "@arivie/react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface MemoryEditorProps {
  endpoint?: string;
  className?: string;
}

export function MemoryEditor({
  endpoint = "/api/arivie/memory",
  className,
}: MemoryEditorProps) {
  const { memories, save, remove, status } = useMemory({ endpoint });
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleCreate = useCallback(async () => {
    const key = draftKey.trim();
    const value = draftValue.trim();
    if (!key || !value) return;
    await save(key, value);
    setDraftKey("");
    setDraftValue("");
  }, [draftKey, draftValue, save]);

  const handleUpdate = useCallback(async () => {
    if (!editingKey) return;
    const value = editValue.trim();
    if (!value) return;
    await save(editingKey, value);
    setEditingKey(null);
    setEditValue("");
  }, [editValue, editingKey, save]);

  const busy = status === "loading";

  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Input
          placeholder="Key"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          disabled={busy}
          aria-label="Memory key"
        />
        <Input
          placeholder="Correction value"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          disabled={busy}
          aria-label="Memory value"
          className="sm:flex-1"
        />
        <Button type="submit" disabled={busy}>
          <Save className="mr-1 size-4" aria-hidden />
          Save
        </Button>
      </form>

      {busy && memories.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading memories…
        </p>
      ) : null}

      <ul className="divide-y rounded-md border">
        {memories.map((entry) => (
          <li key={entry.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
            {editingKey === entry.key ? (
              <>
                <span className="min-w-32 font-mono text-sm">{entry.key}</span>
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1"
                  aria-label={`Edit ${entry.key}`}
                />
                <Button type="button" size="sm" onClick={() => void handleUpdate()}>
                  Update
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingKey(null);
                    setEditValue("");
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-32 font-mono text-sm font-medium">
                  {entry.key}
                </span>
                <span className="flex-1 text-sm text-muted-foreground">
                  {entry.value}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingKey(entry.key);
                      setEditValue(entry.value);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void remove(entry.key)}
                    aria-label={`Delete ${entry.key}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {memories.length === 0 && !busy ? (
        <p className="text-sm text-muted-foreground">No saved corrections yet.</p>
      ) : null}
    </div>
  );
}
