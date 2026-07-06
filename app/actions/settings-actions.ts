// app/actions/settings-actions.ts — v3
// Uses actionError() for production-safe error messages.
// All logic preserved from v2.
"use server";

import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { revalidatePath } from "next/cache";
import { actionError } from "@/lib/action-utils";

// =============================================================================
// UPDATE PROFILE
// =============================================================================

export async function updateProfile(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw actionError("Not authenticated.");

  const firstName       = (formData.get("firstName")       as string)?.trim();
  const lastName        = (formData.get("lastName")        as string)?.trim();
  const phone           = (formData.get("phone")           as string)?.trim();
  const profilePhotoUrl = (formData.get("profilePhotoUrl") as string)?.trim() || null;

  if (!firstName || !lastName) throw actionError("First and last name are required.");
  if (!phone)                  throw actionError("Phone number is required.");

  const currentUser = await prisma.user.findUnique({
    where:  { email: session.user.email },
    select: { id: true },
  });
  if (!currentUser) throw actionError("User not found.");

  const phoneConflict = await prisma.user.findFirst({
    where: { phone, id: { not: currentUser.id } },
  });
  if (phoneConflict) throw actionError("This phone number is already registered to another member.");

  await prisma.user.update({
    where: { id: currentUser.id },
    data:  {
      firstName,
      lastName,
      name:            `${firstName} ${lastName}`,
      phone,
      profilePhotoUrl: profilePhotoUrl || null,
    },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
}

// =============================================================================
// CHANGE PASSWORD
// =============================================================================

export async function changePassword(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw actionError("Not authenticated.");

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword     = formData.get("newPassword")     as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword)
    throw actionError("All password fields are required.");
  if (newPassword !== confirmPassword)
    throw actionError("New passwords do not match.");
  if (newPassword.length < 8)
    throw actionError("New password must be at least 8 characters.");
  if (newPassword === currentPassword)
    throw actionError("New password must be different from your current password.");

  const user = await prisma.user.findUnique({
    where:  { email: session.user.email },
    select: { id: true, password: true },
  });
  if (!user) throw actionError("User not found.");

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw actionError("Current password is incorrect.");

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
}

// =============================================================================
// ADMIN: UPDATE MEMBER
// =============================================================================

export async function adminUpdateMember(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw actionError("Not authenticated.");

  const actorRole = (session.user as { role?: string }).role ?? "MEMBER";
  if (!["ADMIN","CHAIRPERSON","SECRETARY","TREASURER"].includes(actorRole))
    throw actionError("Insufficient permissions to update member records.");

  const userId      = formData.get("userId")    as string;
  const firstName   = (formData.get("firstName") as string)?.trim();
  const lastName    = (formData.get("lastName")  as string)?.trim();
  const phone       = (formData.get("phone")     as string)?.trim();
  const role        = formData.get("role")        as string;
  const status      = formData.get("status")      as string;
  const joinedAtRaw = formData.get("joinedAt")   as string;

  if (!userId) throw actionError("Member ID is required.");

  const updateData: Record<string, unknown> = {};

  if (firstName && lastName) {
    updateData.firstName = firstName;
    updateData.lastName  = lastName;
    updateData.name      = `${firstName} ${lastName}`;
  }
  if (phone)  updateData.phone  = phone;
  if (role)   updateData.role   = role;
  if (status) {
    updateData.status   = status;
    updateData.isActive = status === "ACTIVE";
  }

  if (joinedAtRaw) {
    const joinedAt = new Date(joinedAtRaw);
    if (isNaN(joinedAt.getTime())) throw actionError("Invalid joining date.");
    if (joinedAt > new Date())     throw actionError("Joining date cannot be in the future.");
    updateData.createdAt = joinedAt;
  }

  await prisma.user.update({ where: { id: userId }, data: updateData });

  const actor = await prisma.user.findUnique({
    where: { email: session.user.email }, select: { id: true },
  });
  if (actor) {
    await prisma.auditLog.create({
      data: {
        actorId:    actor.id,
        action:     "ADMIN_MEMBER_UPDATE",
        entityType: "User",
        entityId:   userId,
        newValues:  updateData as object,
      },
    });
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin/data-entry");
}