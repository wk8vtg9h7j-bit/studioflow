// ============================================================================
// ClassTypeRow — one class type in the list. It shows the at-a-glance details
// and can expand into an inline edit form. The active on/off switch posts
// directly to a server action; editing reuses the shared ClassTypeForm.
// ============================================================================
"use client";

import { useState } from "react";
import type { ClassType } from "@/lib/types";
import { ClassTypeForm } from "./ClassTypeForm";
import { toggleClassTypeActiveAction } from "./actions";

export function ClassTypeRow({ classType }: { classType: ClassType }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="h-10 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: classType.color ?? "#0ea5e9" }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-ink">{classType.name}</p>
            {classType.active ? (
              <span className="badge bg-emerald-50 text-emerald-700">
                Active
              </span>
            ) : (
              <span className="badge bg-stone-100 text-ink-muted">
                Inactive
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {classType.default_duration_min} min · {classType.default_capacity}{" "}
            spots · {classType.credits_cost}{" "}
            {classType.credits_cost === 1 ? "credit" : "credits"}
            {classType.description ? ` · ${classType.description}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>

          <form action={toggleClassTypeActiveAction}>
            <input type="hidden" name="id" value={classType.id} />
            <input
              type="hidden"
              name="active"
              value={classType.active ? "false" : "true"}
            />
            <button
              type="submit"
              className="btn-ghost"
              title={
                classType.active
                  ? "Deactivate class type"
                  : "Reactivate class type"
              }
            >
              {classType.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <ClassTypeForm
            classType={classType}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}
