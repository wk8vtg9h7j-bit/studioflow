// ============================================================================
// Admin · Products — create/edit form
//
// Mirrors PackageForm: a useFormState form that drives either
// createProductAction or updateProductAction depending on whether an existing
// product was passed in. On a successful create it resets so the admin can add
// another; on a successful edit it calls onDone to collapse the inline editor.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { Product } from "@/lib/types";
import {
  createProductAction,
  updateProductAction,
  type ProductActionState,
} from "./actions";

const initialState: ProductActionState = {};

export function ProductForm({
  product,
  onDone,
}: {
  product?: Product;
  onDone?: () => void;
}) {
  const editing = Boolean(product);
  const action = editing ? updateProductAction : createProductAction;
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
      {editing && <input type="hidden" name="id" value={product!.id} />}

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
          defaultValue={product?.name ?? ""}
          placeholder="Grip socks"
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
          defaultValue={product?.description ?? ""}
          placeholder="Non-slip pilates socks — one size."
          className="input min-h-[72px] resize-y"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="sku" className="label">
            SKU (optional)
          </label>
          <input
            id="sku"
            name="sku"
            type="text"
            maxLength={60}
            defaultValue={product?.sku ?? ""}
            placeholder="SOCK-BLK"
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
            defaultValue={product?.price_cents ?? 0}
            className="input"
            placeholder="150000"
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
            defaultValue={product?.currency ?? "VND"}
            placeholder="VND"
            className="input uppercase"
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Add product"}</SubmitButton>
    </form>
  );
}
