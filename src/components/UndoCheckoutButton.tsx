"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoCheckoutAction } from "@/lib/checkout/actions";

export function UndoCheckoutButton({ checkoutId }: { checkoutId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!confirming) return <button type="button" className="btn-secondary text-xs"
    onClick={() => { setError(null); setConfirming(true); }}>Undo collected payment</button>;
  return <div className="w-full max-w-sm space-y-2 rounded-lg border border-rose-200 p-3">
    <p className="text-xs text-rose-800">Reverse this receipt and remove its unused issued credits? This does not issue a bank/card refund.</p>
    <label className="block text-xs font-medium">Reason for reversal
      <input className="input mt-1 w-full" value={reason} maxLength={500}
        onChange={e=>setReason(e.target.value)} placeholder="e.g. Recorded for wrong customer"/>
    </label>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    <div className="flex gap-2">
      <button type="button" className="btn-secondary text-xs" disabled={pending}
        onClick={()=>setConfirming(false)}>Cancel</button>
      <button type="button" className="btn-primary text-xs" disabled={pending||reason.trim().length<3}
        onClick={()=>startTransition(async()=>{
          setError(null);
          const form = new FormData();
          form.set("checkout_id",checkoutId);
          form.set("reason",reason.trim());
          try {
            const result = await undoCheckoutAction({},form);
            if(result.error) { setError(result.error); return; }
            setConfirming(false);
            router.refresh();
          } catch { setError("Could not reverse payment. Try again."); }
        })}>{pending?"Reversing…":"Confirm reversal"}</button>
    </div>
  </div>;
}
