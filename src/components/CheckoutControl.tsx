"use client";
import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { formatMoney } from "@/lib/format";
import { markDeskAttendanceAction, recordCheckoutAction, type CheckoutState } from "@/lib/checkout/actions";

export type CheckoutPackage = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  currency: string;
  pool: string;
};

const initial: CheckoutState = {};
export function CheckInActions({ bookingId, status, canMark }: {
  bookingId: string; status: string; canMark: boolean;
}) {
  const [state, action] = useFormState(markDeskAttendanceAction, initial);
  const router = useRouter();
  useEffect(() => { if (state.ok) router.refresh(); }, [state.ok, router]);
  if (!["booked","attended","no_show"].includes(status)) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="status" value={status === "booked" ? "attended" : "booked"} />
      <button type="submit" className="btn-secondary text-xs" disabled={!canMark && status==="booked"}>
        {status === "booked" ? "Check in" : "Undo check-in"}
      </button>
      {state.error && <span className="text-xs text-rose-700">{state.error}</span>}
    </form>
  );
}
export function CheckoutControl({
  bookingId, pool, creditsSpent, packages, eligibleStarter, onSuccess, instructorName,
}: {
  bookingId: string; pool: string; creditsSpent: number;
  packages: CheckoutPackage[]; eligibleStarter: boolean;
  onSuccess?: () => void;
  instructorName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"single" | "package">("single");
  const [packageId, setPackageId] = useState("");
  const [price, setPrice] = useState(pool === "regular" ? "400000" : "");
  const [state, action] = useFormState(recordCheckoutAction, initial);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
      onSuccess?.();
    }
  }, [state.ok, router, onSuccess]);
  const available = useMemo(() => packages.filter(
    p => p.pool === pool && p.credits >= creditsSpent && p.price_cents > 0
  ), [packages, pool, creditsSpent]);
  const selected = available.find(p=>p.id===packageId);
  return <div className="space-y-2">
    <button type="button" aria-expanded={open} className="btn-primary min-h-10 w-full text-sm sm:w-auto" onClick={()=>setOpen(x=>!x)}>
      {open ? "Close checkout" : "Collect payment"}
    </button>
    {open && <form action={action} className="grid min-w-0 max-w-full grid-cols-1 gap-3 rounded-xl border border-stone-200 bg-white p-3 sm:grid-cols-2 sm:p-4">
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="package_id" value={kind==="package"?packageId:""} />
      <label className="block min-w-0 sm:col-span-2 text-sm font-medium text-ink">
        What is the customer paying for?
        <select className="input mt-1 min-w-0 max-w-full" value={kind} onChange={e=>{
          const next=e.target.value as "single"|"package";
          setKind(next); setPackageId(""); setPrice(next==="single"?(pool==="regular"?"400000":""):"");
        }}>
          <option value="single">Single class + next booking credit</option>
          {eligibleStarter && available.length>0 && <option value="package">Package (today included)</option>}
        </select>
      </label>
      {kind==="package" && <label className="block min-w-0 sm:col-span-2 text-sm font-medium text-ink">
        Package
        <select name="package_selector" className="input mt-1 min-w-0 max-w-full" value={packageId} required onChange={e=>{
          const pkg=available.find(p=>p.id===e.target.value);
          setPackageId(e.target.value); setPrice(pkg?String(pkg.price_cents):"");
        }}>
          <option value="">Choose package…</option>
          {available.map(pkg=><option key={pkg.id} value={pkg.id}>
            {pkg.name} · {pkg.credits} classes · {formatMoney(pkg.price_cents,pkg.currency)}
          </option>)}
        </select>
      </label>}
      {kind==="single" && <div className="sm:col-span-2 rounded-lg bg-white p-3 text-sm text-ink"><strong>1 new class credit</strong> will be added to the customer's balance for their next booking. Today's attended class is marked paid.</div>}
      {kind==="package" && selected && <div className="sm:col-span-2 rounded-lg bg-white p-3 text-sm">
        <p><strong>{selected.credits}</strong> package classes − <strong>{creditsSpent}</strong> already attended = <strong>{selected.credits-creditsSpent} new credits</strong></p>
        <p className="mt-1 text-xs text-ink-muted">Today's class is included in the amount charged. It will not be charged twice.</p>
      </div>}
      <label className="block min-w-0 text-sm font-medium text-ink">
        Amount paid ({kind==="package" ? selected?.currency ?? "VND" : "VND"})
        <input name="amount_cents" className="input mt-1 w-full min-w-0" type="number" min="1"
          max={kind==="package" ? selected?.price_cents : 100000000} step="1" value={price}
          onChange={e=>setPrice(e.target.value)} required />
      </label>
      <label className="block min-w-0 text-sm font-medium text-ink">
        Payment method
        <select name="payment_method" className="input mt-1 min-w-0 max-w-full" required defaultValue="">
          <option value="" disabled>Choose method…</option>
          <option value="qr">QR transfer</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
        </select>
      </label>
      {kind==="package" && selected && (
        <p className="min-w-0 break-words rounded-lg bg-violet-50 p-3 text-xs leading-relaxed text-violet-900 sm:col-span-2">
          Teaching commission (2.5%): <strong>{formatMoney(Math.round(Number(price||0)*0.025), selected.currency)}</strong>.
          {instructorName && instructorName !== "Unassigned"
            ? ` ${instructorName} receives this even when an admin records the payment.`
            : " The class must have a linked instructor to earn this commission."}
        </p>
      )}
      {state.error && <p role="alert" className="sm:col-span-2 text-sm text-rose-700">{state.error}</p>}
      <div className="min-w-0 sm:col-span-2 [&_button]:w-full"><SubmitButton>Confirm payment</SubmitButton></div>
    </form>}
    {state.ok && <p className="text-xs text-emerald-700">Payment recorded · +{state.grantedCredits ?? 0} credits issued · Remaining classes: {state.remainingCredits}.</p>}
  </div>;
}
