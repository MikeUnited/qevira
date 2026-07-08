import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Fallback when post-registration session creation fails; normal flow redirects to /dashboard. */
export default function SuccessPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Account Under Review
      </h1>
      <p className="max-w-md text-center text-zinc-600">
        Your registration is complete. Our team will verify your account within
        24 hours. You will receive an email confirmation shortly.
      </p>
      <Button asChild>
        <Link href="/marketplace">Back to Marketplace</Link>
      </Button>
    </div>
  );
}
