"use client";

import { useState } from "react";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";

// Keep the class-creation entry point at the top of the page on phones,
// rather than hiding it below a potentially long list of existing sessions.
export function SessionCreatePanel({
  studios,
  classTypes,
  instructors,
}: {
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Add a class</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Schedule group or private classes at either studio.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 lg:hidden"
          aria-expanded={mobileOpen}
          aria-controls="admin-new-class-form"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? "Close" : "+ Add class"}
        </button>
      </div>
      <div
        id="admin-new-class-form"
        className={`mt-4 ${mobileOpen ? "block" : "hidden"} lg:block`}
      >
        <SessionForm
          studios={studios}
          classTypes={classTypes}
          instructors={instructors}
        />
      </div>
    </div>
  );
}
