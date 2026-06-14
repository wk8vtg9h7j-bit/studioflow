// ============================================================================
// AddCustomer — reception's "add a customer" panel for the admin Customers page.
//   • Walk-in: a CRM record with no login (name + optional contact).
//   • With login: creates an account (email required) the member can later use.
// ============================================================================
"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import {
  createWalkInCustomerAction,
  createCustomerWithLoginAction,
  type AddCustomerState,
} from "./actions";

const initial: AddCustomerState = {};

export function AddCustomer() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"walkin" | "login">("walkin");
  const [walkInState, walkInAction] = useFormState(
    createWalkInCustomerAction,
    initial,
  );
  const [loginState, loginAction] = useFormState(
    createCustomerWithLoginAction,
    initial,
  );

  const state = mode === "walkin" ? walkInState : loginState;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Add a customer</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-secondary"
        >
          {open ? "Close" : "Add"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="flex gap-2">
            <ModeTab active={mode === "walkin"} onClick={() => setMode("walkin")}>
              Walk-in (no login)
            </ModeTab>
            <ModeTab active={mode === "login"} onClick={() => setMode("login")}>
              With login
            </ModeTab>
          </div>

          <form
            // a fresh form per mode so fields/validation reset cleanly
            key={mode}
            action={mode === "walkin" ? walkInAction : loginAction}
            className="space-y-3"
          >
            <div>
              <label className="label" htmlFor="add-name">
                Full name
              </label>
              <input id="add-name" name="name" className="input" required />
            </div>

            <div>
              <label className="label" htmlFor="add-email">
                Email{" "}
                {mode === "walkin" ? (
                  <span className="text-ink-soft">(optional)</span>
                ) : (
                  <span className="text-ink-soft">(required for login)</span>
                )}
              </label>
              <input
                id="add-email"
                name="email"
                type="email"
                className="input"
                required={mode === "login"}
              />
            </div>

            {mode === "walkin" && (
              <div>
                <label className="label" htmlFor="add-phone">
                  Phone <span className="text-ink-soft">(optional)</span>
                </label>
                <input id="add-phone" name="phone" className="input" />
              </div>
            )}

            <p className="text-xs text-ink-soft">
              {mode === "walkin"
                ? "Creates an in-studio record with no login. You can attach an email/login later."
                : "Creates an account. The member sets their password via “forgot password”. They also get the starter credit."}
            </p>

            {state.error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {state.error}
              </p>
            )}
            {state.ok && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {state.message ?? "Customer added."}
              </p>
            )}

            <SubmitButton>
              {mode === "walkin" ? "Add walk-in" : "Create account"}
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-brand-50 text-brand-700"
          : "text-ink-muted hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}
