// ============================================================================
// StudioRow — one studio in the list. It shows the at-a-glance details and can
// expand into an inline edit form. The active on/off switch posts directly to a
// server action; editing reuses the shared StudioForm in "edit" mode.
// ============================================================================
"use client";

import { useState } from "react";
import type { Studio } from "@/lib/types";
import { StudioForm } from "./StudioForm";
import { toggleStudioActiveAction, disconnectGoogleAction } from "./actions";

// Small badge describing the studio's Google Calendar connection at a glance.
// Colours mirror the active/inactive badges used elsewhere in this row.
function googleBadge(studio: Studio) {
  switch (studio.google_token_status) {
    case "connected":
      return (
        <span
          className="badge bg-emerald-50 text-emerald-700"
          title={
            studio.google_account_email
              ? `Connected as ${studio.google_account_email}`
              : "Google Calendar connected"
          }
        >
          Calendar on
        </span>
      );
    case "error":
      return (
        <span
          className="badge bg-amber-50 text-amber-700"
          title="Google Calendar sync error — reconnect to fix"
        >
          Calendar error
        </span>
      );
    default:
      return (
        <span className="badge bg-stone-100 text-ink-muted">
          Calendar off
        </span>
      );
  }
}

export function StudioRow({ studio }: { studio: Studio }) {
  const [editing, setEditing] = useState(false);
  const calendarConnected = studio.google_token_status === "connected";

  return (
    <li className="card overflow-hidden">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-4 sm:flex sm:gap-4 sm:px-5">
        <span
          className="h-10 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: studio.brand_color ?? "#a8a29e" }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{studio.name}</p>
            {studio.active ? (
              <span className="badge bg-emerald-50 text-emerald-700">
                Active
              </span>
            ) : (
              <span className="badge bg-stone-100 text-ink-muted">
                Inactive
              </span>
            )}
            {googleBadge(studio)}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {studio.timezone}
            {studio.address ? ` · ${studio.address}` : ""}
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

          {calendarConnected ? (
            <form action={disconnectGoogleAction} className="w-full sm:w-auto">
              <input type="hidden" name="id" value={studio.id} />
              <button
                type="submit"
                className="btn-ghost w-full sm:w-auto"
                title="Disconnect Google Calendar"
              >
                Disconnect
              </button>
            </form>
          ) : (
            <a
              href={`/api/google/connect?studio=${studio.id}`}
              className="btn-ghost w-full sm:w-auto"
              title="Connect Google Calendar"
            >
              Connect Calendar
            </a>
          )}

          <form action={toggleStudioActiveAction} className="w-full sm:w-auto">
            <input type="hidden" name="id" value={studio.id} />
            <input
              type="hidden"
              name="active"
              value={studio.active ? "false" : "true"}
            />
            <button
              type="submit"
              className="btn-ghost w-full sm:w-auto"
              title={studio.active ? "Deactivate studio" : "Reactivate studio"}
            >
              {studio.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <StudioForm studio={studio} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}
