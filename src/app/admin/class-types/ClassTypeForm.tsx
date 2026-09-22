// ============================================================================
// ClassTypeForm — a client form used for both creating and editing a class
// type. It drives a server action through useFormState so validation errors
// surface inline, and resets itself after a successful create.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { ClassType } from "@/lib/types";
import {
  createClassTypeAction,
  updateClassTypeAction,
  type ClassTypeActionState,
} from "./actions";

const initialState: ClassTypeActionState = {};

export function ClassTypeForm({
  classType,
  onDone,
}: {
  classType?: ClassType;
  onDone?: () => void;
}) {
  const editing = Boolean(classType);
  const action = editing ? updateClassTypeAction : createClassTypeAction;
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
      {editing && <input type="hidden" name="id" value={classType!.id} />}

      <div>
        <label className="label" htmlFor="name">
          Class name
        </label>
        <input
          id="name"
          name="name"
          className="input"
          placeholder="Reformer Flow"
          defaultValue={classType?.name ?? ""}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description <span className="text-ink-soft">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          className="input min-h-[72px] resize-y"
          placeholder="A flowing, full-body reformer class suitable for all levels."
          defaultValue={classType?.description ?? ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="default_duration_min">
            Duration (min)
          </label>
          <input
            id="default_duration_min"
            name="default_duration_min"
            type="number"
            min={5}
            max={480}
            step={5}
            className="input"
            defaultValue={classType?.default_duration_min ?? 50}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="default_capacity">
            Capacity
          </label>
          <input
            id="default_capacity"
            name="default_capacity"
            type="number"
            min={1}
            max={200}
            className="input"
            defaultValue={classType?.default_capacity ?? 10}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="credits_cost">
            Credits
          </label>
          <input
            id="credits_cost"
            name="credits_cost"
            type="number"
            min={0}
            max={100}
            className="input"
            defaultValue={classType?.credits_cost ?? 1}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="pool">
          Credit type
        </label>
        <select
          id="pool"
          name="pool"
          className="input"
          defaultValue={classType?.pool ?? "regular"}
          required
        >
          <option value="regular">Regular credits</option>
          <option value="private">Private credits</option>
        </select>
        <p className="mt-1 text-xs text-ink-soft">
          Private classes spend private credits; regular classes spend regular credits.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="color">
          Schedule colour
        </label>
        <input
          id="color"
          name="color"
          type="color"
          className="h-[42px] w-full cursor-pointer rounded-lg border border-stone-300 bg-white px-1.5 py-1"
          defaultValue={classType?.color ?? "#0ea5e9"}
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Add class type"}</SubmitButton>
    </form>
  );
}
