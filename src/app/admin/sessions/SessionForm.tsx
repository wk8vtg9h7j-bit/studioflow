// ============================================================================
// SessionForm — the client form for scheduling a class (create) or editing an
// existing session. It drives the server actions through useFormState so
// validation errors surface inline, and resets itself after a successful add.
//
// Time handling: the <input type="datetime-local"> emits a studio-local
// wall-clock value with no timezone. The server action reads the chosen studio's
// IANA zone and converts it to a real UTC instant, so the value the admin types
// is always interpreted in the studio's own clock.
//
// Picking a class type seeds the duration and capacity from that type's
// defaults (only while creating, and only until the admin overrides them), so
// the common case is a couple of clicks.
// ============================================================================
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { toDateTimeLocal } from "@/lib/format";
import type { SessionWithRelations } from "@/lib/types";
import {
  createSessionAction,
  updateSessionAction,
  type SessionActionState,
} from "./actions";

const initialState: SessionActionState = {};

export type StudioOption = { id: string; name: string; timezone: string };
export type ClassTypeOption = {
  id: string;
  name: string;
  default_duration_min: number;
  default_capacity: number;
  credits_cost: number;
};
export type InstructorOption = { id: string; display_name: string };

export function SessionForm({
  session,
  studios,
  classTypes,
  instructors,
  onDone,
}: {
  session?: SessionWithRelations;
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
  onDone?: () => void;
}) {
  const editing = Boolean(session);
  const action = editing ? updateSessionAction : createSessionAction;
  const [state, formAction] = useFormState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Duration and capacity are seeded from the chosen class type's defaults but
  // remain freely editable. We keep them in local state so changing the class
  // type can repopulate them while creating.
  const [durationMin, setDurationMin] = useState<number>(
    minutesBetween(session?.starts_at, session?.ends_at) ?? 60,
  );
  const [capacity, setCapacity] = useState<number>(session?.capacity ?? 10);

  useEffect(() => {
    if (state.ok) {
      if (!editing) formRef.current?.reset();
      onDone?.();
    }
  }, [state.ok, editing, onDone]);

  function onClassTypeChange(id: string) {
    // Only auto-seed while creating; editing should never silently overwrite
    // the saved duration/capacity just because the picker re-rendered.
    if (editing) return;
    const ct = classTypes.find((c) => c.id === id);
    if (!ct) return;
    setDurationMin(ct.default_duration_min);
    setCapacity(ct.default_capacity);
  }

  // For edit mode the datetime-local needs the stored UTC instant rendered back
  // into the studio's wall-clock. New sessions start blank.
  const startDefault = editing
    ? toDateTimeLocal(session!.starts_at, session!.studio?.timezone)
    : "";

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={session!.id} />}

      <div>
        <label className="label" htmlFor="studio_id">
          Studio
        </label>
        <select
          id="studio_id"
          name="studio_id"
          className="input"
          defaultValue={session?.studio_id ?? ""}
          required
        >
          <option value="" disabled>
            Choose a studio…
          </option>
          {studios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="class_type_id">
          Class type
        </label>
        <select
          id="class_type_id"
          name="class_type_id"
          className="input"
          defaultValue={session?.class_type_id ?? ""}
          onChange={(e) => onClassTypeChange(e.target.value)}
          required
        >
          <option value="" disabled>
            Choose a class type…
          </option>
          {classTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="instructor_id">
          Instructor <span className="text-ink-soft">(optional)</span>
        </label>
        <select
          id="instructor_id"
          name="instructor_id"
          className="input"
          defaultValue={session?.instructor_id ?? ""}
        >
          <option value="">Unassigned</option>
          {instructors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.display_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="starts_at">
          Starts at
        </label>
        <input
          id="starts_at"
          name="starts_at"
          type="datetime-local"
          className="input"
          defaultValue={startDefault}
          required
        />
        <p className="mt-1 text-xs text-ink-soft">
          Entered in the studio&apos;s local time.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="duration_min">
            Duration (min)
          </label>
          <input
            id="duration_min"
            name="duration_min"
            type="number"
            min={5}
            max={480}
            step={5}
            className="input"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="capacity">
            Capacity
          </label>
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            max={200}
            className="input"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="title">
          Title <span className="text-ink-soft">(optional)</span>
        </label>
        <input
          id="title"
          name="title"
          className="input"
          placeholder="Overrides the class type name on the calendar"
          defaultValue={session?.title ?? ""}
        />
      </div>

      <div>
        <label className="label" htmlFor="room">
          Room <span className="text-ink-soft">(optional)</span>
        </label>
        <input
          id="room"
          name="room"
          className="input"
          placeholder="Studio 2"
          defaultValue={session?.room ?? ""}
        />
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes <span className="text-ink-soft">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          className="input min-h-[72px] resize-y"
          placeholder="Anything the instructor should know."
          defaultValue={session?.notes ?? ""}
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Schedule class"}</SubmitButton>
    </form>
  );
}

// Difference between two ISO instants in whole minutes, or null if either is
// missing. Used to pre-fill the duration field when editing.
function minutesBetween(
  startsAt?: string | null,
  endsAt?: string | null,
): number | null {
  if (!startsAt || !endsAt) return null;
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return Math.round(ms / 60_000);
}
