// app/(portal)/layout.tsx — v3
// Fetches unread notification count server-side and passes to Sidebar.
// This is what drives the red badge on the Announcements nav link.

import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Sidebar from "@/components/Sidebar";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const user = session.user as {
    name?:         string;
    role?:         string;
    memberNumber?: string;
    firstName?:    string;
    email?:        string;
  };

  // ── Unread notification count ──────────────────────────────────────────────
  // Read from DB so the badge is always accurate on every page load.
  // Kept lightweight: single COUNT query, no joins.
  let unreadCount = 0;
  let profilePhotoUrl = null; // <-- ADDED: Variable to hold the photo

  if (user.email) {
    const dbUser = await prisma.user.findUnique({
      where:  { email: user.email },
      select: { id: true, profilePhotoUrl: true }, // <-- ADDED: Fetch profilePhotoUrl
    });
    if (dbUser) {
      profilePhotoUrl = dbUser.profilePhotoUrl; // <-- ADDED: Assign it from the DB
      unreadCount = await prisma.notification.count({
        where: { userId: dbUser.id, readAt: null },
      });
    }
  }

  const displayName = user.firstName?.trim() || user.name || "Member";

  return (
    <div className="flex min-h-screen bg-[#F7F5F0] dark:bg-stone-950 font-sans">
        <Sidebar
          role={user.role ?? "MEMBER"}
          name={displayName}
          memberNumber={user.memberNumber ?? ""}
          unreadCount={unreadCount}
        />
      <div className="flex-1 overflow-auto min-w-0">
        {children}
      </div>
    </div>
  );
}