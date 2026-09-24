"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePaymentAction } from "./actions";

export function DeletePaymentButton({
  id,
  kind,
  label,
}: {
  id: string;
  kind: "package" | "retail";
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="text-xs font-medium text-rose-600 hover:text-rose-700"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="max-w-52 text-right text-[11px] leading-snug text-rose-700">
        Delete {label}? This cannot be undone.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="text-xs font-medium text-ink-muted hover:text-ink"
        >
          Keep
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const form = new FormData();
              form.set("id", id);
              form.set("kind", kind);
              const result = await deletePaymentAction(form);
              if (result.error) {
                setError(result.error);
                return;
              }
              setConfirming(false);
              router.refresh();
            })
          }
          className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete payment"}
        </button>
      </div>
      {error && (
        <p className="max-w-72 text-right text-[11px] leading-snug text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
