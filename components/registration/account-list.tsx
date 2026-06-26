"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KycBankAccountDraft } from "@/lib/validation/kyc-bank";
import { maskAccountNumber } from "@/lib/validation/kyc-bank";

type AccountListProps = {
  accounts: KycBankAccountDraft[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSetPrimary: (id: string) => void;
};

export function AccountList({
  accounts,
  onEdit,
  onDelete,
  onSetPrimary,
}: AccountListProps) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
        No accounts yet. Add at least one bank account to continue.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {accounts.map((a) => (
        <li key={a.id}>
          <Card className="overflow-hidden border-border/80 shadow-sm">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium leading-tight">{a.bankName}</p>
                  {a.isPrimary ? (
                    <Badge variant="secondary" className="text-xs">
                      Primary
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.branchName} · {a.accountName}
                </p>
                <p className="font-mono text-sm tracking-wide text-muted-foreground">
                  {maskAccountNumber(a.accountNumber)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="Account actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!a.isPrimary ? (
                    <DropdownMenuItem onClick={() => onSetPrimary(a.id)}>
                      Set as primary
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => onEdit(a.id)}>
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(a.id)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
