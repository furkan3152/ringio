import type { GroupLanguage } from "../groups/catalog";
import { normalizeSearchText } from "../groups/matcher";

export type PrivacyIssueKind =
  | "wallet-address"
  | "phone-number"
  | "email-address"
  | "wallet-secret"
  | "sensitive-field";

export type PrivacyIssue = {
  kind: PrivacyIssueKind;
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const BASE58_CANDIDATE_PATTERN = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?=$|[^1-9A-HJ-NP-Za-km-z])/;
const PHONE_CANDIDATE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g;
const PUBLIC_GROUP_CODE_PATTERN = /\bRNG-[A-F0-9]{12}\b/gi;
const SENSITIVE_FIELD_PATTERN = /^(?:wallet|walletaddress|publickey|phone|phonenumber|email|invite|invitesecret|invitesecret|invitetoken|secret|seed|seedphrase|mnemonic|privatekey|secretkey|recoveryphrase)$/;
const SECRET_PHRASES = [
  "seed phrase",
  "seed words",
  "secret phrase",
  "recovery phrase",
  "mnemonic phrase",
  "private key",
  "secret key",
  "invite secret",
  "invite token",
  "davet sifresi",
  "davet sirri",
  "gizli davet",
  "ozel anahtar",
  "gizli anahtar",
  "kurtarma ifadesi",
  "kurtarma kelimeleri",
] as const;

function hasPhoneNumber(value: string): boolean {
  for (const candidate of value.matchAll(PHONE_CANDIDATE_PATTERN)) {
    const digits = candidate[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return true;
  }
  return false;
}

export function findPrivacyIssueInText(value: string): PrivacyIssue | null {
  if (EMAIL_PATTERN.test(value)) return { kind: "email-address" };
  if (BASE58_CANDIDATE_PATTERN.test(value)) return { kind: "wallet-address" };
  if (hasPhoneNumber(value.replace(PUBLIC_GROUP_CODE_PATTERN, ""))) return { kind: "phone-number" };

  const normalized = normalizeSearchText(value);
  if (SECRET_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return { kind: "wallet-secret" };
  }
  return null;
}

function normalizeFieldName(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
}

/**
 * Scans the complete parsed request, not just the current chat message. This
 * guarantees rejected PII/secrets never reach the OpenRouter request builder.
 */
export function findPrivacyIssue(value: unknown, depth = 0): PrivacyIssue | null {
  if (depth > 8) return { kind: "sensitive-field" };
  if (typeof value === "string") return findPrivacyIssueInText(value);
  if (value === null || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const issue = findPrivacyIssue(item, depth + 1);
      if (issue) return issue;
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(normalizeFieldName(key))) {
      return { kind: "sensitive-field" };
    }
    const issue = findPrivacyIssue(nestedValue, depth + 1);
    if (issue) return issue;
  }
  return null;
}

export function privacySafeResponse(locale: GroupLanguage): string {
  return locale === "tr"
    ? "Güvenliğin için cüzdan adresi, telefon, e-posta, seed phrase, private key veya gizli davet bilgisi kabul etmiyorum. Bu bilgiyi kaldırıp yalnızca bütçe, sıklık, konum, dil ve ilgi alanlarını yazarak tekrar dene."
    : "For your safety, I cannot accept wallet addresses, phone numbers, email, seed phrases, private keys, or secret invite data. Remove it and try again using only budget, cadence, location, language, and interests.";
}
