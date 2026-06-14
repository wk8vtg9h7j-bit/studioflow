// ============================================================================
// Admin · Packages — create/edit form
//
// Mirrors ClassTypeForm: a useFormState form that drives either
// createPackageAction or updatePackageAction depending on whether an existing
// package was passed in. On a successful create it resets so the admin can add
// another; on a successful edit it calls onDone to collapse the inline editor.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { Package } from "@/lib/types";
import {
  createPackageAction,
  updatePackageAction,
  type PackageActionState,
} from "./actions";

const initialState: PackageActionState = {};

export function PackageForm({
  pkg,
  onDone,
}: {
  pkg?: Package;
  onDone?: () => void;
}) {
  const editing = Boolean(pkg);
  const action = editing ? updatePackageAction : createPackageAction;
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
      {editing && <input type="hidden" name="id" value={pkg!.id} />}

      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          defaultValue={pkg?.name ?? ""}
          placeholder="10-class clip card"
          className="input"
        />
      </div>

      <div>
        <label htmlFor="description" className="label">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          maxLength={500}
          defaultValue={pkg?.description ?? ""}
          placeholder="Best value for regulars — 10 clips, valid 3 months."
          className="input min-h-[72px] resize-y"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="credits" className="label">
            Credits
          </label>
          <input
            id="credits"
            name="credits"
            type="number"
            required
            min={1}
            max={1000}
            step={1}
            defaultValue={pkg?.credits ?? 10}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="price_cents" className="label">
            Price (smallest unit)
          </label>
          <input
            id="price_cents"
            name="price_cents"
            type="number"
            required
            min={0}
            max={100_000_000}
            step={1}
            defaultValue={pkg?.price_cents ?? 0}
            className="input"
            placeholder="1600000"
          />
        </div>

        <div>
          <label htmlFor="currency" className="label">
            Currency
          </label>
          <input
            id="currency"
            name="currency"
            type="text"
            required
            minLength={3}
            maxLength={3}
            defaultValue={pkg?.currency ?? "VND"}
            placeholder="VND"
            className="input uppercase"
          />
        </div>
      </div>

      <div>
        <label htmlFor="validity_days" className="label">
          Validity (days)
        </label>
        <input
          id="validity_days"
          name="validity_days"
          type="number"
          required
          min={1}
          max={3650}
          step={1}
          defaultValue={pkg?.validity_days ?? 90}
          className="input"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Add package"}</SubmitButton>
    </form>
  );
}
