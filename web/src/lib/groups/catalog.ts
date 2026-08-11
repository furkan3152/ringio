import { PublicKey } from "@solana/web3.js";

export const GROUP_CODE_PATTERN = /^RNG-[A-F0-9]{12}$/;

export type GroupCadence = "weekly" | "biweekly" | "monthly";
export type GroupLanguage = "tr" | "en";
export type GroupLocationMode = "remote" | "in-person" | "hybrid" | "unspecified";
export type GroupEnrollmentStatus = "accepting-members" | "full" | "closed";

export type PublicGroup = {
  code: string;
  accountAddress: string;
  mint: string;
  name: string;
  description: Readonly<Record<GroupLanguage, string>>;
  contributionUsdc: number;
  cadence: GroupCadence;
  languages: readonly GroupLanguage[];
  location: {
    mode: GroupLocationMode;
    city: string | null;
    countryCode: "TR" | null;
  };
  start: {
    isoDate: string;
    timezone: "UTC";
  };
  memberSlots: {
    total: number;
    filled: number;
    available: number;
  };
  postPayoutCollateral: {
    scope: "remaining-scheduled-contributions-after-payout";
    coveragePercent: 100;
    maximumUsdc: number;
  };
  interests: readonly string[];
  enrollmentStatus: GroupEnrollmentStatus;
  listingSource: "solana-devnet";
};

export function groupCodeFromAddress(address: string): string {
  const bytes = new PublicKey(address).toBytes();
  const prefix = Array.from(bytes.subarray(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `RNG-${prefix.toUpperCase()}`;
}

export function normalizeGroupCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s_]+/g, "-");
  const match = compact.match(/^RNG-?([A-F0-9]{12})$/);
  if (!match) return null;
  const normalized = `RNG-${match[1]}`;
  return GROUP_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function getPublicGroupByCode(
  groups: readonly PublicGroup[],
  value: string,
): PublicGroup | null {
  const code = normalizeGroupCode(value);
  return code ? groups.find((group) => group.code === code) ?? null : null;
}

export function isGroupEligible(group: PublicGroup): boolean {
  return (
    group.enrollmentStatus === "accepting-members" &&
    group.memberSlots.available > 0 &&
    group.memberSlots.filled < group.memberSlots.total
  );
}

export function getEligiblePublicGroups(
  groups: readonly PublicGroup[],
): readonly PublicGroup[] {
  return groups.filter(isGroupEligible);
}

export function validatePublicGroupCatalog(
  groups: readonly PublicGroup[],
): readonly string[] {
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  for (const group of groups) {
    if (!GROUP_CODE_PATTERN.test(group.code)) errors.push(`Invalid public group code: ${group.code}`);
    if (seenCodes.has(group.code)) errors.push(`Duplicate public group code: ${group.code}`);
    seenCodes.add(group.code);
    if (group.code !== groupCodeFromAddress(group.accountAddress)) {
      errors.push(`Code is not derived from the Group account: ${group.code}`);
    }
    if (group.memberSlots.available !== group.memberSlots.total - group.memberSlots.filled) {
      errors.push(`Inconsistent member slots for ${group.code}`);
    }
    if (group.contributionUsdc <= 0 || !Number.isFinite(group.contributionUsdc)) {
      errors.push(`Invalid contribution for ${group.code}`);
    }
    if (group.postPayoutCollateral.coveragePercent !== 100) {
      errors.push(`Unsupported collateral coverage for ${group.code}`);
    }
    if (Number.isNaN(Date.parse(group.start.isoDate))) errors.push(`Invalid start date for ${group.code}`);
    if (group.listingSource !== "solana-devnet") errors.push(`Non-chain listing source for ${group.code}`);
  }

  return errors;
}
