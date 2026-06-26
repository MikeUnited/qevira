import { z } from "zod";

/** Single draft row in the registration wizard (client id for React keys). */
export const kycBankAccountDraftSchema = z.object({
  id: z.string().min(1),
  bankName: z.string().trim().min(1, "Bank name is required"),
  branchName: z.string().trim().min(1, "Branch name is required"),
  accountName: z.string().trim().min(1, "Account name is required"),
  accountNumber: z
    .string()
    .regex(/^\d{10,18}$/, "Account number must be 10–18 digits"),
  isPrimary: z.boolean(),
});

export type KycBankAccountDraft = z.infer<typeof kycBankAccountDraftSchema>;

/** Payload sent to `POST /api/register/kyc/bank` (no client id). */
export const kycBankAccountPayloadSchema = kycBankAccountDraftSchema.omit({
  id: true,
});

export type KycBankAccountPayload = z.infer<typeof kycBankAccountPayloadSchema>;

export const kycBankSubmitBodySchema = z.object({
  accounts: z
    .array(kycBankAccountPayloadSchema)
    .min(1, "Add at least one bank account")
    .superRefine((accounts, ctx) => {
      const primaryCount = accounts.filter((a) => a.isPrimary).length;
      if (primaryCount !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "Exactly one account must be marked as primary",
          path: ["accounts"],
        });
      }
    }),
});

export type KycBankSubmitBody = z.infer<typeof kycBankSubmitBodySchema>;

export function validateKycBankDrafts(accounts: KycBankAccountDraft[]) {
  const arr = z.array(kycBankAccountDraftSchema).min(1);
  return arr.safeParse(accounts);
}

/** Strip client ids for API / snapshot comparison. */
export function parseKycBankDraftsForSubmit(accounts: KycBankAccountDraft[]) {
  const payloads = accounts.map((a) => ({
    bankName: a.bankName,
    branchName: a.branchName,
    accountName: a.accountName,
    accountNumber: a.accountNumber,
    isPrimary: a.isPrimary,
  }));
  return kycBankSubmitBodySchema.safeParse({ accounts: payloads });
}

export function maskAccountNumber(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length < 4) return "****";
  return `****${d.slice(-4)}`;
}
