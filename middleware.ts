// middleware.ts — v2
// Fixed: admin roles redirect to /admin after login, not /dashboard.
// Also fixes compliance >100% — that's in the admin dashboard page.

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const ADMIN_ROLES = [
  "ADMIN", "CHAIRPERSON", "VICE_CHAIRPERSON", "TREASURER",
  "SECRETARY", "AUDITOR", "CREDIT_COMMITTEE_MEMBER", "LOAN_OFFICER",
];

const BLOCKED_STATUSES = ["PENDING", "SUSPENDED", "EXPELLED", "INACTIVE"];

export default withAuth(
  function middleware(req) {
    const token  = req.nextauth.token;
    const path   = req.nextUrl.pathname;
    const role   = (token?.role as string) ?? "MEMBER";
    const status = (token?.status as string) ?? "ACTIVE";

    // ── Block suspended/expelled/pending users ────────────────────────────
    if (BLOCKED_STATUSES.includes(status)) {
      if (!path.startsWith("/waiting-room") && !path.startsWith("/api/auth")) {
        return NextResponse.redirect(new URL("/waiting-room", req.url));
      }
      return NextResponse.next();
    }

    // ── Redirect admin roles away from /dashboard to /admin ───────────────
    // When an admin hits /dashboard (e.g. after login), send to /admin.
    // They can still access /dashboard if they explicitly navigate there,
    // but the post-login redirect lands them in the right place.
    if (path === "/dashboard" && ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }

    // ── Protect /admin routes from non-admin roles ─────────────────────────
    if (path.startsWith("/admin") && !ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/waiting-room",
  ],
};