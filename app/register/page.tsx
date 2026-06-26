import { RegistrationWizard } from "@/components/registration/registration-wizard";

export default function RegisterPage() {
  return (
    <div className="bg-muted/30 flex min-h-svh w-full items-center justify-center p-4 sm:p-6">
      <RegistrationWizard initialStep={1} />
    </div>
  );
}
