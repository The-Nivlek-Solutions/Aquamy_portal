// app/api/mpesa/callback/route.ts — v2
// Fixed: added ShareTransaction settlement branch.
// Order of settlement checks:
//   1. LoanRepayment  (linked via MpesaTransaction.loanRepayment)
//   2. Contribution   (linked via Contribution.mpesaTransactionId)
//   3. ShareTransaction (linked via ShareTransaction.mpesaTransactionId) ← NEW
//   4. Fine           (linked via Fine.mpesaTransactionId)
//   5. Unattributed fallback → creates monthly contribution

import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { ContributionType } from "@prisma/client";

async function appendLedger(
  description: string,
  entryType:   string,
  amount:      number,
  userId:      string
) {
  const latest = await prisma.groupLedgerEntry
    .findFirst({ orderBy: { recordedAt: "desc" } })
    .catch(() => null);

  await prisma.groupLedgerEntry.create({
    data: {
      description,
      entryType,
      amount,
      isCredit:     true,
      balanceAfter: (latest?.balanceAfter ?? 0) + amount,
      recordedBy:   userId,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body     = await req.json();
    const callback = body?.Body?.stkCallback;
    if (!callback) return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid payload" });

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

    const tx = await prisma.mpesaTransaction.findUnique({
      where:   { checkoutRequestId: CheckoutRequestID },
      include: { loanRepayment: true },
    });

    if (!tx) {
      console.error("[Callback] Unknown checkoutRequestId:", CheckoutRequestID);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── Payment FAILED or CANCELLED ────────────────────────────────────────
    if (ResultCode !== 0) {
      await prisma.mpesaTransaction.update({
        where: { id: tx.id },
        data: {
          status:            ResultCode === 1032 ? "CANCELLED" : "FAILED",
          resultCode:        ResultCode,
          resultDescription: ResultDesc,
          callbackPayload:   body,
          completedAt:       new Date(),
        },
      });

      // If a pending ShareTransaction was linked, remove it so it doesn't confuse the ledger
      await prisma.shareTransaction.deleteMany({
        where: {
          mpesaTransactionId: tx.id,
          notes:              { contains: "Pending" },
        },
      }).catch(() => null);

      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── Payment SUCCEEDED ─────────────────────────────────────────────────
    const meta: Record<string, string | number> = {};
    for (const item of CallbackMetadata?.Item ?? []) {
      meta[item.Name] = item.Value;
    }
    const receiptNumber = String(meta.MpesaReceiptNumber ?? "");
    const paidAmount    = Number(meta.Amount ?? tx.amount);

    // Mark transaction as successful
    await prisma.mpesaTransaction.update({
      where: { id: tx.id },
      data: {
        status:             "SUCCESS",
        mpesaReceiptNumber: receiptNumber,
        resultCode:         0,
        resultDescription:  ResultDesc,
        callbackPayload:    body,
        completedAt:        new Date(),
      },
    });

    // ── 1. LOAN REPAYMENT (inline relation) ──────────────────────────────
    if (tx.loanRepayment) {
      const rep     = tx.loanRepayment;
      const newPaid = rep.paidAmount + paidAmount;

      await prisma.loanRepayment.update({
        where: { id: rep.id },
        data:  {
          paidAmount: newPaid,
          status:     newPaid >= rep.expectedAmount ? "PAID" : "PARTIALLY_PAID",
          paidAt:     new Date(),
        },
      });

      await prisma.loan.update({
        where: { id: rep.loanId },
        data:  { outstandingBalance: { decrement: paidAmount } },
      });

      const updatedLoan = await prisma.loan.findUnique({
        where: { id: rep.loanId }, select: { outstandingBalance: true },
      });
      if (updatedLoan && updatedLoan.outstandingBalance <= 0) {
        await prisma.loan.update({
          where: { id: rep.loanId },
          data:  { status: "FULLY_REPAID", fullyRepaidAt: new Date() },
        });
      }

      await prisma.memberFinancialSummary.upsert({
        where:  { userId: tx.userId },
        create: { userId: tx.userId, totalLoansRepaid: paidAmount },
        update: { totalLoansRepaid: { increment: paidAmount }, outstandingLoanBalance: { decrement: paidAmount } },
      });

      await appendLedger(`Loan repayment — ${receiptNumber}`, "LOAN_REPAYMENT", paidAmount, tx.userId);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── 2. CONTRIBUTION ───────────────────────────────────────────────────
    const linkedContribution = await prisma.contribution.findFirst({
      where: { mpesaTransactionId: tx.id },
    });

    if (linkedContribution) {
      const newPaid  = linkedContribution.paidAmount + paidAmount;
      const newStatus = newPaid >= linkedContribution.expectedAmount ? "PAID" : "PARTIALLY_PAID";

      await prisma.contribution.update({
        where: { id: linkedContribution.id },
        data:  { paidAmount: newPaid, paidAt: new Date(), status: newStatus, mpesaReceiptId: receiptNumber },
      });

      await prisma.memberFinancialSummary.upsert({
        where:  { userId: tx.userId },
        create: { userId: tx.userId, totalContributed: paidAmount },
        update: { totalContributed: { increment: paidAmount } },
      });

      await appendLedger(`Contribution — ${receiptNumber}`, "MONTHLY_CONTRIBUTION", paidAmount, tx.userId);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── 3. SHARE PURCHASE ─────────────────────────────────────────────────
    const linkedShareTx = await prisma.shareTransaction.findFirst({
      where: { mpesaTransactionId: tx.id },
    });

    if (linkedShareTx) {
      // Credit the shares to the member's share ledger
      await prisma.share.update({
        where: { id: linkedShareTx.shareId },
        data:  {
          quantity:   { increment: linkedShareTx.units },
          totalValue: { increment: linkedShareTx.totalAmount },
        },
      });

      // Mark the share transaction as confirmed
      await prisma.shareTransaction.update({
        where: { id: linkedShareTx.id },
        data:  { notes: `Confirmed — M-Pesa receipt ${receiptNumber}` },
      });

      await prisma.memberFinancialSummary.upsert({
        where:  { userId: tx.userId },
        create: { userId: tx.userId, totalSharesValue: linkedShareTx.totalAmount },
        update: { totalSharesValue: { increment: linkedShareTx.totalAmount } },
      });

      await appendLedger(
        `Share purchase (${linkedShareTx.units} units) — ${receiptNumber}`,
        "SHARE_PURCHASE",
        paidAmount,
        tx.userId
      );
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── 4. FINE PAYMENT ───────────────────────────────────────────────────
    const linkedFine = await prisma.fine.findFirst({
      where: { mpesaTransactionId: tx.id },
    });

    if (linkedFine) {
      await prisma.fine.update({
        where: { id: linkedFine.id },
        data:  { isPaid: true, status: "PAID", paidAt: new Date() },
      });

      await prisma.memberFinancialSummary.upsert({
        where:  { userId: tx.userId },
        create: { userId: tx.userId, totalFinesPaid: paidAmount },
        update: { totalFinesPaid: { increment: paidAmount }, outstandingFines: { decrement: paidAmount } },
      });

      await appendLedger(`Fine payment — ${receiptNumber}`, "FINE_COLLECTED", paidAmount, tx.userId);
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // ── 5. UNATTRIBUTED FALLBACK ──────────────────────────────────────────
    // Only reached if nothing matched above. Creates a monthly contribution
    // so the money is never silently lost in the ledger.
    console.warn("[Callback] Unattributed payment — creating fallback contribution", { checkoutRequestId: CheckoutRequestID, userId: tx.userId, amount: paidAmount });

    const now = new Date();
    await prisma.contribution.create({
      data: {
        userId:             tx.userId,
        type:               ContributionType.MONTHLY,
        amount:             paidAmount,
        paidAmount,
        expectedAmount:     500,
        status:             "PAID",
        periodMonth:        now.getMonth() + 1,
        periodYear:         now.getFullYear(),
        paidAt:             now,
        mpesaReceiptId:     receiptNumber,
        mpesaTransactionId: tx.id,
      },
    });

    await prisma.memberFinancialSummary.upsert({
      where:  { userId: tx.userId },
      create: { userId: tx.userId, totalContributed: paidAmount },
      update: { totalContributed: { increment: paidAmount } },
    });

    await appendLedger(`Payment (unattributed) — ${receiptNumber}`, "MONTHLY_CONTRIBUTION", paidAmount, tx.userId);
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });

  } catch (error) {
    console.error("[M-Pesa Callback Error]", error);
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
}