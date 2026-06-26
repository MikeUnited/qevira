"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Phone,
  User,
} from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { userFacingFrappeMessage } from "@/lib/frappe-user-message";
import {
  getMaximumBirthDateForAge18,
  isDobAtLeast18YearsOld,
} from "@/lib/dob-age";
import { parseFullNameToParts } from "@/lib/parse-full-name";
import { cn } from "@/lib/utils";
import {
  parseKycBankDraftsForSubmit,
  type KycBankAccountDraft,
} from "@/lib/validation/kyc-bank";

import { AccountList } from "@/components/registration/account-list";
import { AddAccountForm } from "@/components/registration/add-account-form";

const TOTAL_STEPS = 7;

function newBankDraftId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `bank-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
}

/** Avoid duplicate auto-send when React Strict Mode remounts step 2. */
const OTP_STEP_SESSION_KEY = "bamys_otp_reg_step";

const ORGANIZATION_TYPES = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "importer", label: "Importer" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "hospital", label: "Healthcare (Hospital / clinic)" },
] as const;

/** OTP / e-sign step — appended as JSON in multipart. */
export type OtpPayload = {
  digits: [string, string, string, string, string, string];
};

function otpCodeFromPayload(otp: OtpPayload): string {
  return otp.digits.join("");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return local[0] + "***@" + domain;
}

function digitsFromOtpString(s: string): OtpPayload["digits"] {
  const clean = s.replace(/\D/g, "").slice(0, 6);
  const chars = clean.split("");
  return [
    chars[0] ?? "",
    chars[1] ?? "",
    chars[2] ?? "",
    chars[3] ?? "",
    chars[4] ?? "",
    chars[5] ?? "",
  ] as OtpPayload["digits"];
}

/** Banking — collected on step 7 (list of drafts). */
export type BankAccountsPayload = KycBankAccountDraft[];

/**
 * Unified registration state. Files are native `File` objects for multipart upload.
 */
export type RegistrationFormData = {
  registerMode: "email" | "phone";
  /** Full name collected on step 3; split when saving profile. */
  fullName: string;
  email: string;
  phone: string;
  firstName: string;
  middleName: string;
  lastName: string;
  /** yyyy-mm-dd from `<input type="date" />` */
  dob: string;
  password: string;
  confirmPassword: string;
  agreedToTerms: boolean;
  otp: OtpPayload;
  organizationType: string;
  companyName: string;
  contactPerson: string;
  businessLicenseNo: string;
  efdaLicenseNo: string;
  tin: string;
  bankAccounts: BankAccountsPayload;
  businessLicenseFile: File | null;
  efdaLicenseFile: File | null;
  tinCertificateFile: File | null;
};

const initialFormData: RegistrationFormData = {
  registerMode: "email",
  fullName: "",
  email: "",
  phone: "",
  firstName: "",
  middleName: "",
  lastName: "",
  dob: "",
  password: "",
  confirmPassword: "",
  agreedToTerms: false,
  otp: { digits: ["", "", "", "", "", ""] },
  organizationType: "",
  companyName: "",
  contactPerson: "",
  businessLicenseNo: "",
  efdaLicenseNo: "",
  tin: "",
  bankAccounts: [],
  businessLicenseFile: null,
  efdaLicenseFile: null,
  tinCertificateFile: null,
};

function normalizeBankDraftRow(
  raw: unknown,
  index: number
): KycBankAccountDraft {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const id =
      typeof o.id === "string" && o.id.length > 0 ? o.id : newBankDraftId();
    const bankName = typeof o.bankName === "string" ? o.bankName : "";
    const branchName = typeof o.branchName === "string" ? o.branchName : "";
    const accountName = typeof o.accountName === "string" ? o.accountName : "";
    const accountNumber =
      typeof o.accountNumber === "string" ? o.accountNumber : "";
    const isPrimary =
      typeof o.isPrimary === "boolean" ? o.isPrimary : index === 0;
    return {
      id,
      bankName,
      branchName,
      accountName,
      accountNumber,
      isPrimary,
    };
  }
  return {
    id: newBankDraftId(),
    bankName: "",
    branchName: "",
    accountName: "",
    accountNumber: "",
    isPrimary: index === 0,
  };
}

/** Merge GET /api/register/resume `formData` into local state; keep File fields and unspecified keys. */
function mergeResumeFormData(
  prev: RegistrationFormData,
  partial: Record<string, unknown>
): RegistrationFormData {
  const out: RegistrationFormData = { ...prev };
  const skipFiles = new Set([
    "businessLicenseFile",
    "efdaLicenseFile",
    "tinCertificateFile",
  ]);
  for (const key of Object.keys(partial)) {
    if (skipFiles.has(key)) continue;
    const v = partial[key];
    if (v === undefined || v === null) continue;
    if (key === "otp") {
      if (
        v &&
        typeof v === "object" &&
        "digits" in (v as object) &&
        Array.isArray((v as OtpPayload).digits) &&
        (v as OtpPayload).digits.length === 6
      ) {
        const digits = (v as OtpPayload).digits.map((d) =>
          String(d ?? "").slice(0, 1)
        ) as OtpPayload["digits"];
        out.otp = { digits };
      }
      continue;
    }
    if (key === "bankAccounts") {
      if (Array.isArray(v)) {
        out.bankAccounts = (v as unknown[]).map((row, i) =>
          normalizeBankDraftRow(row, i)
        );
        if (out.bankAccounts.length > 0 && !out.bankAccounts.some((a) => a.isPrimary)) {
          out.bankAccounts = out.bankAccounts.map((a, i) => ({
            ...a,
            isPrimary: i === 0,
          }));
        }
      } else if (
        v &&
        typeof v === "object" &&
        "bankAccount" in (v as object) &&
        !Array.isArray(v)
      ) {
        const o = v as { bankName?: string; bankAccount?: string };
        const bn = o.bankName?.trim() ?? "";
        const digits = (o.bankAccount ?? "").replace(/\D/g, "");
        if (bn && digits.length >= 10 && digits.length <= 18) {
          out.bankAccounts = [
            {
              id: newBankDraftId(),
              bankName: bn,
              branchName: "",
              accountName: out.companyName.trim() || "",
              accountNumber: digits,
              isPrimary: true,
            },
          ];
        }
      }
      continue;
    }
    if (key in out) {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * Build multipart body: plain strings appended as-is; nested objects JSON-stringified;
 * `File` values appended as files (omit null files).
 */
const MULTIPART_OMIT = new Set(["confirmPassword", "fullName", "agreedToTerms"]);

export function buildMultipartFormData(data: RegistrationFormData): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(data)) {
    if (MULTIPART_OMIT.has(key)) continue;
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

    form.append(key, String(value));
  }

  return form;
}

function isStep1Valid(fd: RegistrationFormData): boolean {
  if (fd.password.length < 8 || fd.password !== fd.confirmPassword) return false;
  if (!fd.agreedToTerms) return false;
  if (fd.registerMode === "email") {
    return fd.email.trim().length > 3 && fd.email.includes("@");
  }
  return fd.phone.trim().length >= 6;
}

/** Step 3 — full name, DOB, and the contact not collected on step 1. */
function isStep3PersonalDetailsValid(fd: RegistrationFormData): boolean {
  const wordCount = fd.fullName.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 2) return false;
  if (!fd.dob.trim()) return false;
  if (!isDobAtLeast18YearsOld(fd.dob)) return false;
  if (fd.registerMode === "email") {
    return fd.phone.trim().length >= 6;
  }
  return fd.email.trim().length > 3 && fd.email.includes("@");
}

function isStep2OtpComplete(fd: RegistrationFormData): boolean {
  const code = otpCodeFromPayload(fd.otp);
  return code.length === 6 && /^\d{6}$/.test(code);
}

function isStep4OrganizationValid(fd: RegistrationFormData): boolean {
  return (
    fd.organizationType.trim().length > 0 &&
    fd.companyName.trim().length > 0 &&
    fd.contactPerson.trim().length > 0
  );
}

function isStep5LicensesValid(fd: RegistrationFormData): boolean {
  return (
    fd.businessLicenseNo.trim().length > 0 &&
    fd.efdaLicenseNo.trim().length > 0 &&
    fd.businessLicenseFile instanceof File &&
    fd.businessLicenseFile.size > 0 &&
    fd.efdaLicenseFile instanceof File &&
    fd.efdaLicenseFile.size > 0
  );
}

/** Step 6: TIN + taxpayer certificate (org + licenses saved on prior steps). */
function isStep6TaxReady(fd: RegistrationFormData): boolean {
  return (
    fd.tin.trim().length > 0 &&
    fd.tinCertificateFile instanceof File &&
    fd.tinCertificateFile.size > 0
  );
}

/** Step 7: payout banking (after tax KYC is submitted on step 6). */
function isStep7BankReady(fd: RegistrationFormData): boolean {
  return parseKycBankDraftsForSubmit(fd.bankAccounts).success;
}

/** Stable fingerprint for `File` comparison without reading bytes. */
function fileFingerprint(f: File | null): string {
  if (!f || f.size === 0) return "";
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function snapshotPersonal(fd: RegistrationFormData): string {
  return JSON.stringify({
    registerMode: fd.registerMode,
    fullName: fd.fullName.trim(),
    dob: fd.dob.trim(),
    email: fd.email.trim(),
    phone: fd.phone.trim(),
  });
}

function snapshotOrganization(fd: RegistrationFormData): string {
  return JSON.stringify({
    organizationType: fd.organizationType.trim(),
    companyName: fd.companyName.trim(),
    contactPerson: fd.contactPerson.trim(),
  });
}

function snapshotLicenses(fd: RegistrationFormData): string {
  return JSON.stringify({
    businessLicenseNo: fd.businessLicenseNo.trim(),
    efdaLicenseNo: fd.efdaLicenseNo.trim(),
    bl: fileFingerprint(fd.businessLicenseFile),
    ef: fileFingerprint(fd.efdaLicenseFile),
  });
}

function snapshotTax(fd: RegistrationFormData): string {
  return JSON.stringify({
    tin: fd.tin.trim(),
    cert: fileFingerprint(fd.tinCertificateFile),
  });
}

function snapshotBank(fd: RegistrationFormData): string {
  const rows = [...fd.bankAccounts]
    .map(
      ({
        bankName,
        branchName,
        accountName,
        accountNumber,
        isPrimary,
      }) => ({
        bankName: bankName.trim(),
        branchName: branchName.trim(),
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        isPrimary,
      })
    )
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  return JSON.stringify(rows);
}

type SavedKycSnapshots = {
  personal?: string;
  organization?: string;
  licenses?: string;
  tax?: string;
  bank?: string;
};

export type RegistrationWizardProps = {
  /** Initial step (1–7). Use `3` when continuing KYC from `/complete-kyc` (personal details onward). */
  initialStep?: number;
  /** When set (e.g. from session), pre-fills email for KYC continuation. */
  userEmail?: string | null;
};

export function RegistrationWizard({
  initialStep = 1,
  userEmail = null,
}: RegistrationWizardProps) {
  const router = useRouter();
  const initialStepSafe = Math.min(
    Math.max(initialStep, 1),
    TOTAL_STEPS
  );
  /** Users continuing KYC from `/complete-kyc` start at step 3; they cannot go back to account/OTP. */
  const minStep = initialStepSafe >= 3 ? initialStepSafe : 1;
  const isKycContinuation = initialStepSafe >= 3;

  const [step, setStep] = useState(initialStepSafe);
  const [formData, setFormData] = useState<RegistrationFormData>(() => ({
    ...initialFormData,
    ...(userEmail
      ? { email: userEmail.trim(), registerMode: "email" as const }
      : {}),
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingKyc, setIsSavingKyc] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isResuming, setIsResuming] = useState(true);
  const otpStepContainerRef = useRef<HTMLDivElement>(null);
  /** Kept in sync in the OTP onChange handler so onComplete runs before React re-renders. */
  const otpDigitsRef = useRef<OtpPayload["digits"]>(initialFormData.otp.digits);
  const isVerifyingRef = useRef(false);
  /** Last successful save fingerprints (steps 3–6); `undefined` = never saved for that step. */
  const savedKycRef = useRef<SavedKycSnapshots>({});
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [bankDialogNonce, setBankDialogNonce] = useState(0);

  const openBankDialog = useCallback((editId: string | null) => {
    setEditingBankId(editId);
    setBankDialogNonce((n) => n + 1);
    setBankDialogOpen(true);
  }, []);

  const maxBirthDate = useMemo(() => getMaximumBirthDateForAge18(), []);

  const updateField = useCallback(
    <K extends keyof RegistrationFormData>(
      key: K,
      value: RegistrationFormData[K]
    ) => {
      setFormData((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSaveBankAccount = useCallback(
    (payload: {
      id?: string;
      bankName: string;
      branchName: string;
      accountName: string;
      accountNumber: string;
      isPrimary: boolean;
    }) => {
      if (payload.id) {
        setFormData((prev) => {
          const next = prev.bankAccounts.map((a) => {
            if (a.id !== payload.id) {
              return payload.isPrimary ? { ...a, isPrimary: false } : a;
            }
            return {
              id: a.id,
              bankName: payload.bankName,
              branchName: payload.branchName,
              accountName: payload.accountName,
              accountNumber: payload.accountNumber,
              isPrimary: payload.isPrimary,
            };
          });
          const hasPrimary = next.some((a) => a.isPrimary);
          const fixed =
            !hasPrimary && next.length > 0
              ? next.map((a, i) => ({ ...a, isPrimary: i === 0 }))
              : next;
          return { ...prev, bankAccounts: fixed };
        });
      } else {
        const id = newBankDraftId();
        setFormData((prev) => {
          let next = [...prev.bankAccounts];
          if (payload.isPrimary) {
            next = next.map((a) => ({ ...a, isPrimary: false }));
          }
          next.push({
            id,
            bankName: payload.bankName,
            branchName: payload.branchName,
            accountName: payload.accountName,
            accountNumber: payload.accountNumber,
            isPrimary: payload.isPrimary,
          });
          if (!next.some((a) => a.isPrimary)) {
            next = next.map((a, i) => ({ ...a, isPrimary: i === 0 }));
          }
          return { ...prev, bankAccounts: next };
        });
      }
      setEditingBankId(null);
    },
    []
  );

  const handleSetPrimaryBank = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      bankAccounts: prev.bankAccounts.map((a) => ({
        ...a,
        isPrimary: a.id === id,
      })),
    }));
  }, []);

  const handleDeleteBank = useCallback((id: string) => {
    setFormData((prev) => {
      const next = prev.bankAccounts.filter((a) => a.id !== id);
      if (next.length === 0) return { ...prev, bankAccounts: [] };
      if (!next.some((a) => a.isPrimary)) {
        return {
          ...prev,
          bankAccounts: next.map((a, i) => ({ ...a, isPrimary: i === 0 })),
        };
      }
      return { ...prev, bankAccounts: next };
    });
  }, []);

  const requestOtp = useCallback(async () => {
    setIsRequestingOtp(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registerMode: formData.registerMode,
          email: formData.email,
          phone: formData.phone,
        }),
      });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        if (res.status === 429) {
          const msg =
            data &&
            typeof data === "object" &&
            typeof (data as { error?: unknown }).error === "string" &&
            (data as { error: string }).error.trim()
              ? (data as { error: string }).error.trim()
              : "Please wait before requesting another code.";
          toast.error(msg);
          return;
        }
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }
      setVerifiedToken(null);
      toast.success("Verification code sent.");
      setResendCooldownSec(60);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsRequestingOtp(false);
    }
  }, [formData.registerMode, formData.email, formData.phone]);

  useEffect(() => {
    if (step === 1) {
      sessionStorage.removeItem(OTP_STEP_SESSION_KEY);
    }
  }, [step]);

  useEffect(() => {
    if (step !== 2 || isKycContinuation) {
      return;
    }
    if (sessionStorage.getItem(OTP_STEP_SESSION_KEY)) {
      return;
    }
    sessionStorage.setItem(OTP_STEP_SESSION_KEY, "1");
    void requestOtp();
  }, [step, isKycContinuation, requestOtp]);

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const id = window.setTimeout(() => {
      setResendCooldownSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldownSec]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch("/api/register/resume", {
          credentials: "include",
        });
        if (cancelled) return;

        if (!res.ok) {
          if (res.status !== 401) {
            setStep(3);
          }
          return;
        }

        let data: { formData?: unknown; suggestedStep?: number };
        try {
          data = (await res.json()) as {
            formData?: unknown;
            suggestedStep?: number;
          };
        } catch {
          if (!cancelled) {
            setStep(3);
          }
          return;
        }
        if (cancelled) return;

        const payload = data.formData;
        if (payload && typeof payload === "object") {
          setFormData((prev) => {
            const resumedFormData = mergeResumeFormData(
              prev,
              payload as Record<string, unknown>
            );
            otpDigitsRef.current = resumedFormData.otp.digits;
            return { ...prev, ...resumedFormData };
          });
        }

        const suggested = Math.max(Number(data.suggestedStep) || 3, 3);
        setStep(suggested);
      } catch {
        if (!cancelled) {
          setStep(3);
        }
      } finally {
        if (!cancelled) {
          setIsResuming(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  const otpCodeStr = otpCodeFromPayload(formData.otp);
  useEffect(() => {
    setVerifiedToken(null);
  }, [otpCodeStr]);

  const handleVerifyOtp = useCallback(async (codeOverride?: string) => {
    if (isVerifyingRef.current) return;
    const code =
      codeOverride ??
      otpCodeFromPayload({ digits: otpDigitsRef.current } as OtpPayload);
    if (code.length !== 6) return;

    isVerifyingRef.current = true;
    setIsVerifying(true);
    try {
      let token = verifiedToken;

      if (!token) {
        const verifyRes = await fetch("/api/auth/otp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registerMode: formData.registerMode,
            email: formData.email,
            phone: formData.phone,
            otpCode: code,
          }),
        });
        let verifyJson: { verifiedToken?: string; error?: string } = {};
        try {
          verifyJson = (await verifyRes.json()) as typeof verifyJson;
        } catch {
          verifyJson = {};
        }
        if (!verifyRes.ok) {
          setOtpError("Invalid code. Please try again.");
          const empty: OtpPayload["digits"] = ["", "", "", "", "", ""];
          otpDigitsRef.current = empty;
          updateField("otp", { digits: empty });
          queueMicrotask(() => {
            otpStepContainerRef.current
              ?.querySelector<HTMLInputElement>("input")
              ?.focus();
          });
          return;
        }
        const t =
          typeof verifyJson.verifiedToken === "string"
            ? verifyJson.verifiedToken
            : "";
        if (!t) {
          setOtpError("Invalid code. Please try again.");
          const empty: OtpPayload["digits"] = ["", "", "", "", "", ""];
          otpDigitsRef.current = empty;
          updateField("otp", { digits: empty });
          queueMicrotask(() => {
            otpStepContainerRef.current
              ?.querySelector<HTMLInputElement>("input")
              ?.focus();
          });
          return;
        }
        setVerifiedToken(t);
        token = t;
      }

      const res = await fetch("/api/register/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minimal: true,
          registerMode: formData.registerMode,
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
          verifiedToken: token,
        }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      setVerifiedToken(null);
      setOtpError(null);
      toast.success("Account created! Securely saving your session...");
      setStep(3);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      isVerifyingRef.current = false;
      setIsVerifying(false);
    }
  }, [formData, verifiedToken, updateField]);

  const handleOtpPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement | HTMLDivElement>) => {
      e.preventDefault();
      const digits = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, 6);
      const d = digitsFromOtpString(digits);
      otpDigitsRef.current = d;
      setOtpError(null);
      updateField("otp", { digits: d });
      if (digits.length === 6) {
        void handleVerifyOtp(digits);
      }
    },
    [updateField, handleVerifyOtp]
  );

  const handleSavePersonalDetails = useCallback(async () => {
    if (!isStep3PersonalDetailsValid(formData)) {
      if (formData.dob.trim() && !isDobAtLeast18YearsOld(formData.dob)) {
        toast.error("You must be at least 18 years old to register.");
      } else {
        toast.error(
          "Enter your full name (at least two words), date of birth, and the missing contact."
        );
      }
      return;
    }

    const snap = snapshotPersonal(formData);
    if (
      savedKycRef.current.personal !== undefined &&
      snap === savedKycRef.current.personal
    ) {
      setStep(4);
      return;
    }

    setIsSavingProfile(true);
    try {
      const res = await fetch("/api/register/personal-details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registerMode: formData.registerMode,
          fullName: formData.fullName,
          dob: formData.dob,
          email: formData.email,
          phone: formData.phone,
        }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      const { firstName, middleName, lastName } = parseFullNameToParts(
        formData.fullName
      );
      setFormData((prev) => ({
        ...prev,
        firstName,
        middleName,
        lastName,
      }));

      savedKycRef.current.personal = snap;
      savedKycRef.current.organization = undefined;
      savedKycRef.current.licenses = undefined;
      savedKycRef.current.tax = undefined;
      savedKycRef.current.bank = undefined;

      toast.success("Profile saved.");
      setStep(4);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSavingProfile(false);
    }
  }, [formData]);

  const handleSaveOrganization = useCallback(async () => {
    if (!isStep4OrganizationValid(formData)) {
      toast.error(
        "Select organization type, company name, and contact person."
      );
      return;
    }

    const snap = snapshotOrganization(formData);
    if (
      savedKycRef.current.organization !== undefined &&
      snap === savedKycRef.current.organization
    ) {
      setStep(5);
      return;
    }

    setIsSavingKyc(true);
    try {
      const res = await fetch("/api/register/kyc/organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationType: formData.organizationType,
          companyName: formData.companyName,
          contactPerson: formData.contactPerson,
        }),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      savedKycRef.current.organization = snap;
      savedKycRef.current.licenses = undefined;
      savedKycRef.current.tax = undefined;
      savedKycRef.current.bank = undefined;

      toast.success("Organization saved.");
      setStep(5);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSavingKyc(false);
    }
  }, [formData]);

  const handleSaveLicenses = useCallback(async () => {
    if (!isStep5LicensesValid(formData)) {
      toast.error(
        "Enter both license numbers and upload the business and EFDA license documents."
      );
      return;
    }

    const snap = snapshotLicenses(formData);
    if (
      savedKycRef.current.licenses !== undefined &&
      snap === savedKycRef.current.licenses
    ) {
      setStep(6);
      return;
    }

    setIsSavingKyc(true);
    try {
      const fd = new FormData();
      fd.append("organizationType", formData.organizationType);
      fd.append("companyName", formData.companyName);
      fd.append("contactPerson", formData.contactPerson);
      fd.append("tin", formData.tin);
      fd.append("businessLicenseNo", formData.businessLicenseNo);
      fd.append("efdaLicenseNo", formData.efdaLicenseNo);
      fd.append("businessLicenseFile", formData.businessLicenseFile!);
      fd.append("efdaLicenseFile", formData.efdaLicenseFile!);

      const res = await fetch("/api/register/kyc/licenses", {
        method: "POST",
        body: fd,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      savedKycRef.current.licenses = snap;
      savedKycRef.current.tax = undefined;
      savedKycRef.current.bank = undefined;

      toast.success("Licenses saved.");
      setStep(6);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSavingKyc(false);
    }
  }, [formData]);

  const handleSaveTax = useCallback(async () => {
    if (!isStep6TaxReady(formData)) {
      toast.error("Enter your TIN and upload taxpayer certificate.");
      return;
    }

    const taxSnap = snapshotTax(formData);
    if (
      savedKycRef.current.tax !== undefined &&
      taxSnap === savedKycRef.current.tax
    ) {
      savedKycRef.current.bank = undefined;
      setStep(7);
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("organizationType", formData.organizationType);
      fd.append("companyName", formData.companyName);
      fd.append("contactPerson", formData.contactPerson);
      fd.append("tin", formData.tin);
      fd.append("businessLicenseNo", formData.businessLicenseNo);
      fd.append("efdaLicenseNo", formData.efdaLicenseNo);
      fd.append("businessLicenseFile", formData.businessLicenseFile!);
      fd.append("efdaLicenseFile", formData.efdaLicenseFile!);
      fd.append("taxpayerCertFile", formData.tinCertificateFile!);

      const res = await fetch("/api/register/kyc/tax", {
        method: "POST",
        body: fd,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      savedKycRef.current.tax = taxSnap;
      savedKycRef.current.bank = undefined;

      toast.success("Tax documents uploaded. Add your banking details next.");
      setStep(7);
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [formData]);

  const handleComplete = useCallback(async () => {
    const parsedSubmit = parseKycBankDraftsForSubmit(formData.bankAccounts);
    if (!parsedSubmit.success) {
      toast.error(
        parsedSubmit.error.issues[0]?.message ??
          "Add at least one valid bank account with branch and account details."
      );
      return;
    }

    const bankSnap = snapshotBank(formData);
    if (
      savedKycRef.current.bank !== undefined &&
      bankSnap === savedKycRef.current.bank
    ) {
      router.push("/dashboard");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/register/kyc/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedSubmit.data),
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = userFacingFrappeMessage(data, res.status);
        toast.error(msg);
        return;
      }

      savedKycRef.current.bank = bankSnap;

      if (isKycContinuation) {
        toast.success("KYC Verified & Uploaded");
        router.push("/dashboard");
        return;
      }

      const sessionCreated =
        data !== null &&
        typeof data === "object" &&
        (data as { sessionCreated?: unknown }).sessionCreated === true;

      if (sessionCreated) {
        toast.success("KYC Verified & Uploaded");
        window.location.href = "/dashboard";
        return;
      }

      toast.info("Account created! Please sign in to continue.");
      router.push("/login?callbackUrl=/dashboard");
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, router, isKycContinuation]);

  const canGoNext = step < TOTAL_STEPS;
  const step1Ok = useMemo(() => isStep1Valid(formData), [formData]);
  const step2OtpComplete = useMemo(
    () => isStep2OtpComplete(formData),
    [formData]
  );
  const step3PersonalOk = useMemo(
    () => isStep3PersonalDetailsValid(formData),
    [formData]
  );
  const step4OrgOk = useMemo(
    () => isStep4OrganizationValid(formData),
    [formData]
  );
  const step5LicOk = useMemo(
    () => isStep5LicensesValid(formData),
    [formData]
  );
  const step6TaxOk = useMemo(
    () => isStep6TaxReady(formData),
    [formData]
  );
  const step7BankOk = useMemo(
    () => isStep7BankReady(formData),
    [formData]
  );

  const goNext = () => {
    if (step === 1) {
      if (!step1Ok) {
        toast.error(
          "Enter a valid email or phone, matching passwords (min 8 characters), and accept the terms."
        );
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      void handleVerifyOtp();
      return;
    }
    if (step === 3) {
      void handleSavePersonalDetails();
      return;
    }
    if (step === 4) {
      void handleSaveOrganization();
      return;
    }
    if (step === 5) {
      void handleSaveLicenses();
      return;
    }
    if (step === 6) {
      void handleSaveTax();
      return;
    }
    if (canGoNext) setStep((s) => s + 1);
  };
  const goBack = () => {
    setStep((s) => {
      if (s <= 2) {
        return Math.max(minStep, s - 1);
      }
      if (s >= 4) {
        return Math.max(s - 1, 3);
      }
      return s;
    });
  };

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Still leave the app so the user is not stuck on a broken session.
    } finally {
      setIsLoggingOut(false);
    }
    router.push("/login");
  }, [router]);

  const fileAccept = ".pdf,.jpg,.jpeg,image/jpeg,application/pdf";

  const nextDisabled =
    isSubmitting ||
    isVerifying ||
    isSavingProfile ||
    isSavingKyc ||
    (step === 1 && !step1Ok) ||
    (step === 2 && (!step2OtpComplete || isRequestingOtp)) ||
    (step === 3 && !step3PersonalOk) ||
    (step === 4 && !step4OrgOk) ||
    (step === 5 && !step5LicOk) ||
    (step === 6 && !step6TaxOk);

  return (
    <div className="mx-auto w-full max-w-md space-y-8">
      {isResuming ? (
        <Card
          className={cn(
            "rounded-xl border border-border bg-card shadow-sm",
            "p-6"
          )}
        >
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-3 p-0">
            <Loader2
              className="text-muted-foreground size-8 animate-spin"
              aria-hidden
            />
            <p className="text-muted-foreground text-sm">
              Loading your progress...
            </p>
          </CardContent>
        </Card>
      ) : null}
      {!isResuming && step !== 1 ? (
        <div className={cn(step === 2 ? "mb-8 space-y-2" : "space-y-1")}>
          <p className="text-sm text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
          </p>
          <h1
            className={cn(
              step === 2
                ? "text-3xl font-bold tracking-tight"
                : "text-2xl font-semibold tracking-tight"
            )}
          >
            {isKycContinuation ? "Complete your KYC" : "BAMYS registration"}
          </h1>
          {isKycContinuation && step !== 2 ? (
            <p className="text-sm text-muted-foreground">
              Finish your organization and upload documents to access the dashboard.
            </p>
          ) : null}
        </div>
      ) : null}

      {!isResuming && step === 1 ? (
        <Card className="border shadow-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-semibold tracking-tight">
              Create Account
            </CardTitle>
            <CardDescription>Join us today and get started</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs
              value={formData.registerMode}
              onValueChange={(v) =>
                updateField("registerMode", v as "email" | "phone")
              }
            >
              <TabsList className="bg-muted grid h-11 w-full grid-cols-2 rounded-lg p-1">
                <TabsTrigger
                  value="email"
                  className="gap-2 rounded-md data-[state=active]:shadow-sm"
                >
                  <Mail className="size-4 shrink-0" aria-hidden />
                  Email
                </TabsTrigger>
                <TabsTrigger
                  value="phone"
                  className="gap-2 rounded-md data-[state=active]:shadow-sm"
                >
                  <Phone className="size-4 shrink-0" aria-hidden />
                  Phone
                </TabsTrigger>
              </TabsList>
              <TabsContent value="email" className="mt-6 space-y-4 outline-none">
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email address</Label>
                  <div className="relative">
                    <Mail
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                      aria-hidden
                    />
                    <Input
                      id="reg-email"
                      type="email"
                      autoComplete="email"
                      placeholder="john@example.com"
                      value={formData.email}
                      onChange={(e) => updateField("email", e.target.value)}
                      className="bg-muted/50 pl-10"
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="phone" className="mt-6 space-y-4 outline-none">
                <div className="space-y-2">
                  <Label htmlFor="reg-phone">Phone number</Label>
                  <div className="relative">
                    <Phone
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                      aria-hidden
                    />
                    <Input
                      id="reg-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="+251…"
                      value={formData.phone}
                      onChange={(e) => updateField("phone", e.target.value)}
                      className="bg-muted/50 pl-10"
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="reg-password">Password</Label>
              <div className="relative">
                <Lock
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  className="bg-muted/50 pr-11 pl-10"
                  minLength={8}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-9 -translate-y-1/2"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-confirm-password">Confirm password</Label>
              <div className="relative">
                <Lock
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="reg-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    updateField("confirmPassword", e.target.value)
                  }
                  className="bg-muted/50 pr-11 pl-10"
                  minLength={8}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-9 -translate-y-1/2"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="reg-terms"
                checked={formData.agreedToTerms}
                onCheckedChange={(c) =>
                  updateField("agreedToTerms", c === true)
                }
                className="mt-0.5"
              />
              <Label
                htmlFor="reg-terms"
                className="text-muted-foreground cursor-pointer text-sm leading-snug font-normal"
              >
                I agree to the Terms of Service and Privacy Policy
              </Label>
            </div>

            <Button
              type="button"
              className="h-11 w-full font-semibold"
              size="lg"
              disabled={!step1Ok}
              onClick={goNext}
            >
              Create Account
            </Button>
          </CardContent>
          <CardFooter className="flex justify-center border-t pt-6">
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-primary font-medium underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </CardFooter>
        </Card>
      ) : null}

      {!isResuming && step !== 1 ? (
        <div
          className={cn(
            "p-6",
            step >= 3 && "relative pt-14",
            step === 2
              ? "rounded-2xl border border-slate-200 bg-white shadow-sm"
              : "rounded-xl border border-border bg-card shadow-sm"
          )}
        >
        {step >= 3 ? (
          <div className="absolute top-6 right-6 z-10">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              Logout
            </Button>
          </div>
        ) : null}
        {step === 2 && (
          <div className="grid gap-6">
            <h2 className="text-xl font-semibold tracking-tight">
              Electronic signature
            </h2>

            {formData.registerMode === "email" ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
                <Mail
                  className="size-5 shrink-0 text-primary"
                  aria-hidden
                />
                <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                  {maskEmail(formData.email.trim() || "")}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
                <Phone
                  className="size-5 shrink-0 text-primary"
                  aria-hidden
                />
                <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                  Code sent to your phone number
                </p>
              </div>
            )}

            <div ref={otpStepContainerRef} className="grid gap-3">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  value={otpCodeStr}
                  disabled={isVerifying}
                  autoComplete="one-time-code"
                  onChange={(v) => {
                    const d = digitsFromOtpString(v);
                    otpDigitsRef.current = d;
                    setOtpError(null);
                    updateField("otp", { digits: d });
                  }}
                  onComplete={() => void handleVerifyOtp()}
                  pasteTransformer={(pasted) =>
                    pasted.replace(/\D/g, "").slice(0, 6)
                  }
                  onPaste={handleOtpPaste}
                >
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }, (_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        {...(i === 0 ? { onPaste: handleOtpPaste } : {})}
                        className={cn(
                          "relative flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-base font-semibold tabular-nums shadow-sm transition-colors duration-200",
                          otpError && "border-red-500"
                        )}
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {otpError ? (
                <p
                  className="text-red-500 text-sm flex items-center justify-center"
                  role="alert"
                >
                  <AlertCircle
                    className="w-4 h-4 inline mr-1 shrink-0"
                    aria-hidden
                  />
                  Invalid code. Please try again.
                </p>
              ) : null}
              <p
                id="otp-hint"
                className="text-center text-sm text-muted-foreground"
              >
                Enter all 6 digits to enable Confirm.
              </p>
            </div>

            <div className="grid gap-2">
              {isRequestingOtp ? (
                <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Sending code…
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full rounded-xl border bg-slate-50 py-3 font-normal text-slate-800 shadow-none hover:bg-slate-100"
                disabled={
                  isRequestingOtp ||
                  resendCooldownSec > 0 ||
                  isVerifying
                }
                onClick={() => void requestOtp()}
              >
                {resendCooldownSec > 0 ? (
                  <>
                    Resend code in{" "}
                    <span className="font-semibold text-primary">
                      {Math.floor(resendCooldownSec / 60)}:
                      {(resendCooldownSec % 60)
                        .toString()
                        .padStart(2, "0")}
                    </span>
                  </>
                ) : (
                  "Resend code"
                )}
              </Button>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 text-sm text-muted-foreground">
              Didn&apos;t receive the code? Check your spam folder or try
              resending the code.
            </div>
          </div>
        )}

        {step === 3 && (
          <StepFields
            title="Personal details"
            description="Your full name, date of birth, and the contact method you did not use when creating your account."
            fields={
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-full-name-kyc">Full name</Label>
                  <div className="relative">
                    <User
                      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                      aria-hidden
                    />
                    <Input
                      id="reg-full-name-kyc"
                      autoComplete="name"
                      placeholder="John Doe"
                      value={formData.fullName}
                      onChange={(e) => updateField("fullName", e.target.value)}
                      className="bg-muted/50 pl-10"
                    />
                  </div>
                </div>
                <label className="grid w-full gap-2">
                  <span className="text-sm font-medium">Date of birth</span>
                  <Input
                    type="date"
                    value={formData.dob}
                    max={maxBirthDate}
                    onChange={(e) => updateField("dob", e.target.value)}
                    className="w-full"
                    required
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Email address</span>
                    <Input
                      type="email"
                      autoComplete="email"
                      value={formData.email}
                      onChange={(e) => updateField("email", e.target.value)}
                      disabled={formData.registerMode === "email"}
                      className={cn(
                        "w-full",
                        formData.registerMode === "email"
                          ? "cursor-not-allowed bg-muted"
                          : "bg-muted/50"
                      )}
                      required
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Telephone number</span>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formData.phone}
                      onChange={(e) => updateField("phone", e.target.value)}
                      disabled={formData.registerMode === "phone"}
                      className={cn(
                        "w-full",
                        formData.registerMode === "phone"
                          ? "cursor-not-allowed bg-muted"
                          : "bg-muted/50"
                      )}
                      required
                    />
                  </label>
                </div>
              </div>
            }
          />
        )}

        {step === 4 && (
          <StepFields
            title="Organization"
            fields={
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Organization type</span>
                  <select
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={formData.organizationType}
                    onChange={(e) =>
                      updateField("organizationType", e.target.value)
                    }
                  >
                    <option value="">Select type</option>
                    {ORGANIZATION_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Company name</span>
                  <Input
                    className="w-full"
                    value={formData.companyName}
                    onChange={(e) => updateField("companyName", e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Contact person</span>
                  <Input
                    className="w-full"
                    value={formData.contactPerson}
                    onChange={(e) =>
                      updateField("contactPerson", e.target.value)
                    }
                  />
                </label>
              </>
            }
          />
        )}

        {step === 5 && (
          <StepFields
            title="Licenses"
            description="License numbers and documents (PDF or JPG)."
            fields={
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">
                    Business license number
                  </span>
                  <Input
                    className="w-full"
                    value={formData.businessLicenseNo}
                    onChange={(e) =>
                      updateField("businessLicenseNo", e.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">EFDA license number</span>
                  <Input
                    className="w-full"
                    value={formData.efdaLicenseNo}
                    onChange={(e) =>
                      updateField("efdaLicenseNo", e.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">
                    Business license (file)
                  </span>
                  <Input
                    type="file"
                    accept={fileAccept}
                    className="w-full cursor-pointer py-0 leading-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      updateField("businessLicenseFile", f);
                    }}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">
                    EFDA license (file)
                  </span>
                  <Input
                    type="file"
                    accept={fileAccept}
                    className="w-full cursor-pointer py-0 leading-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      updateField("efdaLicenseFile", f);
                    }}
                  />
                </label>
              </>
            }
          />
        )}

        {step === 6 && (
          <StepFields
            title="Tax & KYC submission"
            description="Enter your TIN and upload your taxpayer certificate, then continue to add banking details."
            fields={
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">TIN</span>
                  <Input
                    className="w-full"
                    value={formData.tin}
                    onChange={(e) => updateField("tin", e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">
                    Taxpayer certificate (file)
                  </span>
                  <Input
                    type="file"
                    accept={fileAccept}
                    className="w-full cursor-pointer py-0 leading-none file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      updateField("tinCertificateFile", f);
                    }}
                  />
                </label>
              </>
            }
          />
        )}

        {step === 7 && (
          <>
            <StepFields
              title="Banking details"
              description="Add at least one payout account. The default account is synced to ERPNext as the primary bank account."
              fields={
                <>
                  <AccountList
                    accounts={formData.bankAccounts}
                    onEdit={(id) => openBankDialog(id)}
                    onDelete={handleDeleteBank}
                    onSetPrimary={handleSetPrimaryBank}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => openBankDialog(null)}
                  >
                    Add bank account
                  </Button>
                </>
              }
            />
            <AddAccountForm
              key={bankDialogNonce}
              open={bankDialogOpen}
              onOpenChange={(o) => {
                setBankDialogOpen(o);
                if (!o) setEditingBankId(null);
              }}
              companyName={formData.companyName}
              isOnlyAccount={
                editingBankId
                  ? formData.bankAccounts.length === 1
                  : formData.bankAccounts.length === 0
              }
              initial={
                editingBankId
                  ? formData.bankAccounts.find((a) => a.id === editingBankId) ??
                    null
                  : null
              }
              onSave={handleSaveBankAccount}
            />
          </>
        )}

        <div
          className={cn(
            "mt-8 flex flex-wrap items-center gap-3",
            step === TOTAL_STEPS ? "justify-between" : "justify-end",
            step === 2 && "flex-nowrap justify-end"
          )}
        >
          {step >= 2 && (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={
                step === 3 ||
                isSubmitting ||
                isVerifying ||
                isSavingProfile ||
                isSavingKyc
              }
            >
              Back
            </Button>
          )}
          {step < TOTAL_STEPS && (
            <Button
              type="button"
              onClick={goNext}
              disabled={nextDisabled}
              className="min-w-[120px] gap-2"
            >
              {step === 2 && isVerifying ? (
                <>
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Verifying...</span>
                </>
              ) : step === 3 && isSavingProfile ? (
                <>
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Saving...</span>
                </>
              ) : (step === 4 || step === 5) && isSavingKyc ? (
                <>
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Saving...</span>
                </>
              ) : step === 6 && isSubmitting ? (
                <>
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Uploading KYC...</span>
                </>
              ) : step === 2 ? (
                "Confirm"
              ) : (
                "Continue"
              )}
            </Button>
          )}
          {step === TOTAL_STEPS && (
            <Button
              type="button"
              onClick={handleComplete}
              disabled={isSubmitting || !step7BankOk}
              className="min-w-[200px] gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span>Finalizing your account...</span>
                </>
              ) : (
                "Complete registration"
              )}
            </Button>
          )}
        </div>
        </div>
      ) : null}
    </div>
  );
}

function StepFields({
  title,
  description,
  fields,
}: {
  title: string;
  description?: string;
  fields: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="grid gap-4">{fields}</div>
    </div>
  );
}
