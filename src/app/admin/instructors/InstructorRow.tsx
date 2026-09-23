// ============================================================================
// InstructorRow — one instructor in the list. It shows the at-a-glance details
// (name, login email, bio) and can expand into an inline edit form. The active
// on/off switch posts directly to a server action; editing reuses the shared
// InstructorForm. The login email comes from the joined profile and is shown
// for reference only — it can't be changed here.
// ============================================================================
"use client";

import { useState } from "react";
import type { Instructor } from "@/lib/types";
import { InstructorForm } from "./InstructorForm";
import { toggleInstructorActiveAction } from "./actions";

export function InstructorRow({
  instructor,
  email,
}: {
  instructor: Instructor;
  email?: string | null;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="card overflow-hidden">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-4 sm:flex sm:gap-4 sm:px-5">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
          aria-hidden
        >
          {initials(instructor.display_name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">
              {instructor.display_name}
            </p>
            {instructor.active ? (
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
            {email ?? "No login email"}
            {instructor.bio ? ` · ${instructor.bio}` : ""}
          </p>
        </div>

        <div className="col-span-2 grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:shrink-0 sm:items-center">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary w-full sm:w-auto"
          >
            {editing ? "Close" : "Edit"}
          </button>

          <form action={toggleInstructorActiveAction} className="w-full sm:w-auto">
            <input type="hidden" name="id" value={instructor.id} />
            <input
              type="hidden"
              name="active"
              value={instructor.active ? "false" : "true"}
            />
            <button
              type="submit"
              className="btn-ghost w-full sm:w-auto"
              title={
                instructor.active
                  ? "Deactivate instructor"
                  : "Reactivate instructor"
              }
            >
              {instructor.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <InstructorForm
            instructor={instructor}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
