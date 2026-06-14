// ============================================================================
// InstructorForm — a client form used for both inviting a new instructor and
// editing an existing one. It drives a server action through useFormState so
// validation errors surface inline, and resets itself after a successful add.
//
// The email field only appears when creating: it seeds the instructor's login.
// Editing changes the display name and bio, never the underlying account email.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { Instructor } from "@/lib/types";
import {
  createInstructorAction,
  updateInstructorAction,
  type InstructorActionState,
} from "./actions";

const initialState: InstructorActionState = {};

export function InstructorForm({
  instructor,
  onDone,
}: {
  instructor?: Instructor;
  onDone?: () => void;
}) {
  const editing = Boolean(instructor);
  const action = editing ? updateInstructorAction : createInstructorAction;
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
      {editing && <input type="hidden" name="id" value={instructor!.id} />}

      <div>
        <label className="label" htmlFor="display_name">
          Name
        </label>
        <input
          id="display_name"
          name="display_name"
          className="input"
          placeholder="Alex Rivera"
          defaultValue={instructor?.display_name ?? ""}
          required
        />
      </div>

      {!editing && (
        <div>
          <label className="label" htmlFor="email">
            Login email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            placeholder="alex@studioflow.app"
            required
          />
          <p className="mt-1 text-xs text-ink-soft">
            They&apos;ll use this to sign in. A confirmed account is created
            right away — share a password-reset link so they can set a password.
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="bio">
          Bio <span className="text-ink-soft">(optional)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          className="input min-h-[72px] resize-y"
          placeholder="Senior reformer instructor with 8 years' experience."
          defaultValue={instructor?.bio ?? ""}
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Add instructor"}</SubmitButton>
    </form>
  );
}
