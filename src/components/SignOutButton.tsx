// ============================================================================
// Sign-out control — a tiny form posting to the signOutAction server action.
// Used by every role's shell header.
// ============================================================================
import { signOutAction } from "@/app/(auth)/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="btn-ghost">
        Sign out
      </button>
    </form>
  );
}
