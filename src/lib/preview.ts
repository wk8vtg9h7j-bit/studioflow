// ============================================================================
// Preview-mode helpers — a UI-only click-through bypass for local testing.
//
// Enabled ONLY when NEXT_PUBLIC_PREVIEW_MODE === "1" (set in .env.local). In
// production this flag is unset, so every export here is inert and the real
// Supabase auth/data path runs unchanged.
//
// What it provides:
//   - PREVIEW_MODE / PREVIEW_COOKIE   — the gate flag and the role cookie name.
//   - syntheticProfile(role)          — a fake Profile so getProfile() can skip
//                                       the network entirely.
//   - isPreviewRole(value)            — type guard for the cookie value.
//   - previewFetch(input)             — a fetch shim handed to the Supabase
//                                       clients so calls to the dead stub host
//                                       resolve to benign empty results instead
//                                       of throwing on DNS/fetch failure.
// ============================================================================
import type { Profile, UserRole } from "@/lib/types";

export const PREVIEW_MODE = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1";
export const PREVIEW_COOKIE = "preview_role";

const PREVIEW_ROLES: UserRole[] = ["admin", "instructor", "customer"];

export function isPreviewRole(value: unknown): value is UserRole {
  return typeof value === "string" && (PREVIEW_ROLES as string[]).includes(value);
}

// Friendly display names for each synthetic preview user.
const PREVIEW_NAMES: Record<UserRole, string> = {
  admin: "Preview Admin",
  instructor: "Preview Instructor",
  customer: "Preview Member",
};

// Build a fully-formed Profile for the chosen role without touching the DB.
export function syntheticProfile(role: UserRole): Profile {
  const now = new Date().toISOString();
  return {
    id: `preview-${role}`,
    role,
    full_name: PREVIEW_NAMES[role],
    email: `${role}@preview.local`,
    phone: null,
    avatar_url: null,
    created_at: now,
    updated_at: now,
  };
}

// A drop-in fetch for the Supabase clients in preview mode. The stub host
// (https://stub.supabase.co) does not resolve, so a real fetch would reject and
// 500 the page. Instead we return shape-correct empty responses:
//   - /auth/v1/*      -> 400 JSON error (no session; getProfile won't call this)
//   - /rest/v1/rpc/*  -> [] 200       (RPCs resolve to an empty array)
//   - /rest/v1/*      -> [] 200 with `content-range: */0` so head-count queries
//                        parse a count of 0
//   - anything else   -> {} 200
export function previewFetch(
  input: RequestInfo | URL,
  _init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (url.includes("/auth/v1/")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: "preview_mode",
          error_description: "Auth is disabled in preview mode.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
  }

  if (url.includes("/rest/v1/rpc/")) {
    return Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  if (url.includes("/rest/v1/")) {
    return Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: {
          "content-type": "application/json",
          // PostgREST count header; "*/0" => total count of 0.
          "content-range": "*/0",
        },
      }),
    );
  }

  return Promise.resolve(
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}
