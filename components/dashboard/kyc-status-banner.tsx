"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

const STEP_MESSAGES: Record<number, string> = {
  3: "Account setup incomplete: Personal details missing.",
  4: "Account setup incomplete: Business information missing.",
  5: "Account setup incomplete: Compliance documents required.",
};

export function KycStatusBanner() {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/register/resume", {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setMessage(null);
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          suggestedStep?: unknown;
        } | null;
        const step =
          typeof data?.suggestedStep === "number" ? data.suggestedStep : null;
        if (cancelled) return;

        if (step == null || step < 3 || step >= 6) {
          setMessage(null);
          return;
        }

        const text = STEP_MESSAGES[step];
        setMessage(text ?? null);
      } catch {
        if (!cancelled) setMessage(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) return null;

  return (
    <div
      className="border-border bg-amber-50/90 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100 mb-6 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertCircle
          className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
        <p className="text-sm font-medium leading-snug">{message}</p>
      </div>
      <Button type="button" size="sm" className="shrink-0" asChild>
        <Link href="/complete-kyc">Complete KYC</Link>
      </Button>
    </div>
  );
}
