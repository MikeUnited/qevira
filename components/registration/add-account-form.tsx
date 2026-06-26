"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { kycBankAccountDraftSchema } from "@/lib/validation/kyc-bank";
import type { KycBankAccountDraft } from "@/lib/validation/kyc-bank";

import { BankSelect } from "./bank-select";

type AddAccountFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  /** Only one account exists or will exist — primary is automatic; toggle hidden. */
  isOnlyAccount: boolean;
  initial: KycBankAccountDraft | null;
  onSave: (payload: {
    id?: string;
    bankName: string;
    branchName: string;
    accountName: string;
    accountNumber: string;
    isPrimary: boolean;
  }) => void;
};

export function AddAccountForm({
  open,
  onOpenChange,
  companyName,
  isOnlyAccount,
  initial,
  onSave,
}: AddAccountFormProps) {
  const formId = useId();
  const [bankName, setBankName] = useState(() => initial?.bankName ?? "");
  const [branchName, setBranchName] = useState(() => initial?.branchName ?? "");
  const [accountName, setAccountName] = useState(
    () => initial?.accountName ?? companyName.trim()
  );
  const [accountNumber, setAccountNumber] = useState(
    () => initial?.accountNumber ?? ""
  );
  const [setAsDefault, setSetAsDefault] = useState(
    () => initial?.isPrimary ?? false
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isPrimary = isOnlyAccount ? true : setAsDefault;
    const draftId = initial?.id ?? "new";
    const parsed = kycBankAccountDraftSchema.safeParse({
      id: draftId,
      bankName,
      branchName,
      accountName,
      accountNumber: accountNumber.replace(/\D/g, ""),
      isPrimary,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !next[key]) {
          next[key] = issue.message;
        }
      }
      setFieldErrors(next);
      return;
    }
    onSave({
      id: initial?.id,
      bankName: parsed.data.bankName,
      branchName: parsed.data.branchName,
      accountName: parsed.data.accountName,
      accountNumber: parsed.data.accountNumber,
      isPrimary: parsed.data.isPrimary,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit bank account" : "Add bank account"}
          </DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-bank`}>Bank</Label>
            <BankSelect
              id={`${formId}-bank`}
              value={bankName}
              onChange={(v) => {
                setBankName(v);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.bankName;
                  return n;
                });
              }}
              error={fieldErrors.bankName}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-branch`}>Branch name</Label>
            <Input
              id={`${formId}-branch`}
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.branchName;
                  return n;
                });
              }}
              autoComplete="off"
            />
            {fieldErrors.branchName ? (
              <p className="text-xs text-destructive">{fieldErrors.branchName}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-accname`}>Account name</Label>
            <Input
              id={`${formId}-accname`}
              value={accountName}
              onChange={(e) => {
                setAccountName(e.target.value);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.accountName;
                  return n;
                });
              }}
              autoComplete="organization"
            />
            {fieldErrors.accountName ? (
              <p className="text-xs text-destructive">{fieldErrors.accountName}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-accnum`}>Account number</Label>
            <Input
              id={`${formId}-accnum`}
              value={accountNumber}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(0, 18);
                setAccountNumber(d);
                setFieldErrors((p) => {
                  const n = { ...p };
                  delete n.accountNumber;
                  return n;
                });
              }}
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
            />
            {fieldErrors.accountNumber ? (
              <p className="text-xs text-destructive">{fieldErrors.accountNumber}</p>
            ) : null}
          </div>
          {!isOnlyAccount ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="space-y-0.5">
                <Label htmlFor={`${formId}-default`} className="text-sm font-medium">
                  Set as default
                </Label>
                <p className="text-xs text-muted-foreground">
                  Default account for payouts (ERPNext primary bank).
                </p>
              </div>
              <Switch
                id={`${formId}-default`}
                checked={setAsDefault}
                onCheckedChange={setSetAsDefault}
              />
            </div>
          ) : null}
        </form>
        <DialogFooter showCloseButton={false}>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            {initial ? "Save changes" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
