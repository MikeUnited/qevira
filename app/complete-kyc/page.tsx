import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RegistrationWizard } from "@/components/registration/registration-wizard";
import { decrypt } from "@/lib/session";

export default async function CompleteKycPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("bamys_session")?.value;
  if (!token) {
    redirect("/login");
  }

  const payload = await decrypt(token);
  const emailRaw = payload?.email;
  const userEmail =
    typeof emailRaw === "string" && emailRaw.trim().length > 0
      ? emailRaw.trim()
      : null;
  if (!userEmail) {
    redirect("/login");
  }

  return (
    <div className="bg-muted/30 flex min-h-svh w-full items-center justify-center p-4 sm:p-6">
      <RegistrationWizard initialStep={3} userEmail={userEmail} />
    </div>
  );
}
