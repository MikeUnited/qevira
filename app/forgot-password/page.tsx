"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  function resetToForm() {
    setIsSuccess(false);
    setEmail("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (res.status === 429) {
        const msg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "Too many reset attempts. Please try again later.";
        toast.error(msg);
        return;
      }

      setIsSuccess(true);
    } catch {
      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border shadow-md">
        {isSuccess ? (
          <>
            <CardHeader className="sr-only">
              <CardTitle>Password reset email sent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-8 pb-2 text-center">
              <div className="flex justify-center">
                <CheckCircle
                  className="size-16 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              </div>
              <div className="space-y-2">
                <h2 className="text-foreground text-xl font-semibold tracking-tight">
                  Check your inbox
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  If we find an account associated with this email address, you
                  will receive a password reset link within a few minutes.
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Didn&apos;t receive an email? Check your spam folder or try
                  again.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t pt-6">
              <Button asChild className="w-full" size="lg" variant="default">
                <Link href="/login">Back to Sign In</Link>
              </Button>
              <Button
                type="button"
                className="w-full"
                size="lg"
                variant="outline"
                onClick={resetToForm}
              >
                Try a different email
              </Button>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl tracking-tight">
                Forgot your password?
              </CardTitle>
              <CardDescription>
                Enter your email and we will send you a reset link.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4 border-t pt-6">
                <Button
                  type="submit"
                  className="w-full gap-2"
                  size="lg"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2
                        className="size-4 shrink-0 animate-spin"
                        aria-hidden
                      />
                      Sending…
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  <Link
                    href="/login"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Back to Login
                  </Link>
                </p>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
