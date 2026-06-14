// ============================================================================
// StudioForm — a client form used for both creating and editing a studio. It
// drives a server action through useFormState so validation errors surface
// inline, and resets itself after a successful create.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { Studio } from "@/lib/types";
import {
  createStudioAction,
  updateStudioAction,
  type StudioActionState,
} from "./actions";

// A small, sensible list of zones for the picker. Studios can be anywhere, but
// these cover the common cases without making the field a free-text foot-gun.
const COMMON_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Dubai",
  "UTC",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

const initialState: StudioActionState = {};

export function StudioForm({
  studio,
  onDone,
}: {
  studio?: Studio;
  onDone?: () => void;
}) {
  const editing = Boolean(studio);
  const action = editing ? updateStudioAction : createStudioAction;
  const [state, formAction] = useFormState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      if (!editing) formRef.current?.reset();
      onDone?.();
    }
  }, [state.ok, editing, onDone]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={studio!.id} />}

      <div>
        <label className="label" htmlFor="name">
          Studio name
        </label>
        <input
          id="name"
          name="name"
          className="input"
          placeholder="Sydney CBD"
          defaultValue={studio?.name ?? ""}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="address">
          Address <span className="text-ink-soft">(optional)</span>
        </label>
        <input
          id="address"
          name="address"
          className="input"
          placeholder="12 George St, Sydney NSW"
          defaultValue={studio?.address ?? ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="timezone">
            Timezone
          </label>
          <select
            id="timezone"
            name="timezone"
            className="input"
            defaultValue={studio?.timezone ?? "Asia/Ho_Chi_Minh"}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="brand_color">
            Brand colour
          </label>
          <input
            id="brand_color"
            name="brand_color"
            type="color"
            className="h-[42px] w-full cursor-pointer rounded-lg border border-stone-300 bg-white px-1.5 py-1"
            defaultValue={studio?.brand_color ?? "#7c3aed"}
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Add studio"}</SubmitButton>
    </form>
  );
}
