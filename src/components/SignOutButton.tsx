// ============================================================================
// Sign-out control — a tiny form posting to the signOutAction server action.
// Used by every role's shell header.
// ============================================================================
import { signOutAction } from "@/app/(auth)/actions";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className="btn-ghost">
        {label}
      </button>
    </form>
  );
}
