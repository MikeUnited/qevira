import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BamysDashboardShell } from "@/components/bamys-dashboard-shell";
import { readErpnextEnv } from "@/lib/erpnext-auth";
import { getResumeSuggestedStep } from "@/lib/kyc-suggested-step";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("bamys_session")?.value;
  if (!token) {
    redirect("/login");
  }

  const payload = await decrypt(token);
  if (!payload) {
    redirect("/login");
  }

  const emailRaw = payload.email;
  const email =
    typeof emailRaw === "string" && emailRaw.trim().length > 0
      ? emailRaw.trim()
      : null;
  if (!email) {
    redirect("/login");
  }

  // TODO: consolidate KYC status into a single server context to avoid duplicate fetches
  const suggestedStep = await getResumeSuggestedStep();
  const kycComplete = suggestedStep >= 6;
  const kycStep = suggestedStep;

  const env = readErpnextEnv();
  if ("error" in env) {
    console.error("[dashboard/layout] ERPNext env:", env.error);
    return (
      <BamysDashboardShell
        profile={{
          email,
          fullName: email.split("@")[0] ?? email,
          isDualRole: false,
          customerGroup: null,
          supplierGroup: null,
          supplierDocName: null,
        }}
        kycComplete={kycComplete}
        kycStep={kycStep}
      >
        {children}
      </BamysDashboardShell>
    );
  }

  const profileResult = await getUserProfile();
  if (!profileResult.ok && profileResult.status === 401) {
    redirect("/login");
  }

  const profile =
    profileResult.ok
      ? profileResult.data
      : {
          email,
          fullName: email.split("@")[0] ?? email,
          isDualRole: false,
          customerGroup: null,
          supplierGroup: null,
          supplierDocName: null,
        };

  return (
    <BamysDashboardShell
      profile={profile}
      kycComplete={kycComplete}
      kycStep={kycStep}
    >
      {children}
    </BamysDashboardShell>
  );
}
