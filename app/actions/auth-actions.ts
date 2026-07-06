// app/actions/auth-actions.ts — v5
// Uses actionError() so messages survive Next.js production sanitization.
// All other logic preserved exactly.
"use server";

import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { actionError } from "@/lib/action-utils";
import {
  sendVerificationEmail,
  sendRegistrationConfirmationEmail,
  sendApprovalEmail,
  sendRejectionEmail,
} from "@/lib/email";

// =============================================================================
// HELPERS
// =============================================================================

async function generateMemberNumber(): Promise<string> {
  const users = await prisma.user.findMany({
    where:  { memberNumber: { startsWith: "AQUAMY-" } },
    select: { memberNumber: true },
  });
  let max = 0;
  for (const u of users) {
    const match = u.memberNumber.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  let next = max + 1;
  while (true) {
    const candidate = `AQUAMY-${String(next).padStart(4, "0")}`;
    const exists = await prisma.user.findUnique({
      where: { memberNumber: candidate }, select: { id: true },
    });
    if (!exists) return candidate;
    next++;
  }
}

function getAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// =============================================================================
// REGISTER MEMBER
// =============================================================================

export async function registerMember(formData: FormData) {
  const firstName     = (formData.get("firstName")    as string)?.trim();
  const lastName      = (formData.get("lastName")     as string)?.trim();
  const middleName    = (formData.get("middleName")   as string)?.trim() || "";
  const email         = (formData.get("email")        as string)?.trim().toLowerCase();
  const phone         = (formData.get("phone")        as string)?.trim();
  const nationalId    = (formData.get("nationalId")   as string)?.trim();
  const dobRaw        = formData.get("dob")           as string;
  const password      = formData.get("password")      as string;
  const inviteCode    = (formData.get("inviteCode")   as string)?.trim().toUpperCase();
  const acceptedTerms = formData.get("acceptedTerms") === "true";

  if (!firstName || !lastName || !email || !phone || !nationalId || !dobRaw || !password || !inviteCode)
    throw actionError("All required fields must be filled in.");
  if (!acceptedTerms)
    throw actionError("You must accept the Terms and Conditions to register.");

  const idClean = nationalId.replace(/\s/g, "");
  if (!/^\d{6,8}$/.test(idClean))
    throw actionError("Please enter a valid National ID number (6–8 digits, numbers only).");

  const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
  if (!invite)       throw actionError("Invalid invite code. Please check your code and try again.");
  if (invite.isUsed) throw actionError("This invite code has already been used.");

  const dateOfBirth = new Date(dobRaw);
  if (isNaN(dateOfBirth.getTime())) throw actionError("Invalid date of birth.");
  const age = getAge(dateOfBirth);
  if (age > 35) throw actionError(`AQUAMY membership is limited to persons aged 35 and below. Your current age is ${age}.`);
  if (age < 18) throw actionError("Members must be at least 18 years old.");

  const [emailExists, phoneExists, idExists] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { phone } }),
    prisma.user.findFirst({ where: { nationalId: idClean } }),
  ]);
  if (emailExists) throw actionError("An account with this email address already exists.");
  if (phoneExists) throw actionError("An account with this phone number already exists.");
  if (idExists)    throw actionError("An account with this National ID number already exists.");

  const fullName     = [firstName, middleName, lastName].filter(Boolean).join(" ");
  const passwordHash = await bcrypt.hash(password, 12);
  const memberNumber = await generateMemberNumber();

  const newUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        memberNumber, name: fullName, firstName, lastName,
        email, phone, nationalId: idClean, dateOfBirth,
        password: passwordHash, role: "MEMBER", status: "PENDING", isActive: false,
      },
    });
    await tx.inviteCode.update({ where: { code: inviteCode }, data: { isUsed: true } });
    return user;
  });

  await Promise.allSettled([
    sendRegistrationConfirmationEmail(newUser.email!, fullName),
    sendVerificationEmail(newUser.id, newUser.email!, fullName),
  ]);
}

// =============================================================================
// GET PENDING MEMBERS
// =============================================================================

export async function getPendingMembers() {
  return prisma.user.findMany({
    where:   { OR: [{ status: "PENDING" }, { isActive: false }], NOT: { status: "ACTIVE" } },
    select:  {
      id: true, name: true, firstName: true, lastName: true,
      email: true, phone: true, nationalId: true,
      memberNumber: true, createdAt: true, emailVerified: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

// =============================================================================
// APPROVE MEMBER
// =============================================================================

export async function approveMember(userId: string) {
  if (!userId) throw actionError("No user ID provided.");

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { status: true, email: true, name: true, firstName: true },
  });
  if (!user)                    throw actionError("Member not found.");
  if (user.status === "ACTIVE") throw actionError("Member is already active.");

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE", isActive: true } }),
    prisma.memberFinancialSummary.upsert({
      where:  { userId },
      create: { userId, totalContributed: 0, totalSharesValue: 0, totalPenaltiesPaid: 0, totalFinesPaid: 0, outstandingArrears: 0, outstandingFines: 0, outstandingLoanBalance: 0, totalLoansRepaid: 0 },
      update: {},
    }),
    prisma.share.upsert({
      where:  { userId },
      create: { userId, quantity: 0, totalValue: 0 },
      update: {},
    }),
  ]);

  if (user.email) {
    const displayName = user.firstName ?? user.name;
    await sendApprovalEmail(user.email, displayName).catch(console.error);
  }

  revalidatePath("/admin/approvals");
  revalidatePath("/dashboard");
}

// =============================================================================
// REJECT MEMBER
// =============================================================================

export async function rejectMember(userId: string) {
  if (!userId) throw actionError("No user ID provided.");

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { status: true, email: true, name: true, firstName: true },
  });
  if (!user) throw actionError("Member not found.");

  await prisma.user.update({
    where: { id: userId },
    data:  { status: "INACTIVE", isActive: false },
  });

  if (user.email) {
    const displayName = user.firstName ?? user.name;
    await sendRejectionEmail(user.email, displayName).catch(console.error);
  }

  revalidatePath("/admin/approvals");
}