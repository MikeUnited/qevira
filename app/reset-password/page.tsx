"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!isSuccess) return;
    const t = window.setTimeout(() => {
      router.push("/login");
    }, 3000);
    return () => window.clearTimeout(t);
  }, [isSuccess, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (res.ok) {
        setIsSuccess(true);
        return;
      }

      const msg =
        typeof json.error === "string" && json.error.trim()
          ? json.error.trim()
          : "Could not reset password.";
      toast.error(msg);
    } catch {
      toast.error("Could not reset password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-md border shadow-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-medium leading-snug tracking-tight">
            Invalid reset link. Please request a new one.
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex flex-col gap-4 border-t pt-6">
          <Button asChild className="w-full" size="lg" variant="default">
            <Link href="/forgot-password">Request a new link</Link>
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
      </Card>
    );
  }

  if (isSuccess) {
    return (
      <Card className="w-full max-w-md border shadow-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl tracking-tight">
            Password updated successfully.
          </CardTitle>
          <CardDescription className="text-base text-foreground">
            You will be redirected to login in 3 seconds.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-4 border-t pt-6">
          <Button asChild className="w-full" size="lg" variant="outline">
            <Link href="/login">Go to Login</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md border shadow-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl tracking-tight">
          Set a new password
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit} suppressHydrationWarning>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
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
                Resetting…
              </>
            ) : (
              "Reset Password"
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
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Suspense
        fallback={
          <Card className="w-full max-w-md border shadow-md">
            <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </CardContent>
          </Card>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
