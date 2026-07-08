/**
 * Stable string stored in VerificationCode.email and JWT `email` claim for registration OTP.
 * Email mode: lowercase email. Phone mode: `phone:` + digits only.
 */
export function registrationOtpIdentifier(
  registerMode: "email" | "phone",
  email: string,
  phone: string
): string | null {
  if (registerMode === "email") {
    const e = email.trim().toLowerCase();
    return e.includes("@") ? e : null;
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 6 ? `phone:${digits}` : null;
}
