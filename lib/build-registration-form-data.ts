/**
 * Builds multipart FormData from the registration wizard state.
 * - Primitives: appended as strings.
 * - Arrays & plain objects: JSON.stringify (e.g. otp digits, bankAccounts).
 * - File | null: append file only when non-null.
 */
export type RegistrationWizardState = {
  registerMode: "email" | "phone";
  email: string;
  phone: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  password: string;
  otp: string[];
  organizationType: string | null;
  region: string;
  zoneSubCity: string;
  woreda: string;
  cityTown: string;
  specificLocation: string;
  businessLicenseNo: string;
  efdaLicenseNo: string;
  tin: string;
  businessLicenseFile: File | null;
  efdaLicenseFile: File | null;
  taxpayerCertFile: File | null;
  bankAccounts: { bankName: string; accountNumber: string }[];
  agreedToTerms: boolean;
};

export function buildMultipartFormData(data: RegistrationWizardState): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;

    if (value instanceof File) {
      form.append(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      form.append(key, JSON.stringify(value));
      continue;
    }

    if (typeof value === "object") {
      form.append(key, JSON.stringify(value));
      continue;
    }

    if (typeof value === "boolean") {
      form.append(key, value ? "true" : "false");
      continue;
    }

    form.append(key, String(value));
  }

  return form;
}
