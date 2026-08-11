import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";

import { periodLabel } from "../duration";
import {
  groupCodeFromAddress,
  type GroupCadence,
  type GroupEnrollmentStatus,
  type PublicGroup,
} from "./catalog";

export const RINGIO_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_RINGIO_PROGRAM_ID ??
    "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy",
);
export const RINGIO_RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

const GROUP_DISCRIMINATOR = Uint8Array.from([209, 249, 208, 63, 182, 89, 186, 254]);
const MEMBER_DISCRIMINATOR = Uint8Array.from([54, 19, 162, 21, 29, 166, 17, 198]);
const GROUP_ACCOUNT_SIZE = 2_387;
const MEMBER_ACCOUNT_SIZE = 190;
const STATUS_NAMES = [
  "forming",
  "revealing",
  "collateralizing",
  "active",
  "completed",
  "cancelled",
  "defaulted",
] as const;

export type OnchainMember = {
  accountAddress: string;
  wallet: string;
  joinedIndex: number;
  payoutRank: number;
  lastContributedRound: number;
  defaults: number;
  collateralLockedRaw: string;
  revealed: boolean;
  collateralPosted: boolean;
  payoutReceived: boolean;
};

export type OnchainGroup = PublicGroup & {
  creator: string;
  potVault: string;
  collateralVault: string;
  payoutOrder: readonly string[];
  currentRound: number;
  roundContributions: number;
  periodSeconds: number;
  graceSeconds: number;
  roundStartedAt: number;
  potBalanceUsdc: number;
  collateralVaultBalanceUsdc: number;
  totalCollateralLockedUsdc: number;
  status: (typeof STATUS_NAMES)[number];
  members: readonly OnchainMember[];
};

type GlobalPause = {
  paused: boolean;
  totalPausedSeconds: bigint;
};

type RawGroup = {
  address: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  potVault: PublicKey;
  collateralVault: PublicKey;
  members: PublicKey[];
  payoutOrder: PublicKey[];
  contributionAmount: bigint;
  totalCollateralLocked: bigint;
  periodSeconds: bigint;
  graceSeconds: bigint;
  joinDeadline: bigint;
  createdAt: bigint;
  roundStartedAt: bigint;
  memberCount: number;
  joinedCount: number;
  currentRound: number;
  roundContributions: number;
  statusIndex: number;
  phasePauseSnapshot: bigint;
};

function publicKeyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function bigintToSafeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds JavaScript's safe integer range`);
  return result;
}

export function decodeGroupAccount(address: PublicKey, data: Buffer): RawGroup {
  if (data.length !== GROUP_ACCOUNT_SIZE || !data.subarray(0, 8).equals(GROUP_DISCRIMINATOR)) {
    throw new Error(`Invalid Group account ${address.toBase58()}`);
  }

  const memberCount = data.readUInt16LE(2_328);
  if (memberCount < 2 || memberCount > 32) throw new Error(`Invalid member count in ${address.toBase58()}`);
  const members = Array.from({ length: memberCount }, (_, index) => publicKeyAt(data, 168 + index * 32));
  const payoutOrder = Array.from({ length: memberCount }, (_, index) => publicKeyAt(data, 1_192 + index * 32));

  return {
    address,
    creator: publicKeyAt(data, 8),
    mint: publicKeyAt(data, 40),
    potVault: publicKeyAt(data, 72),
    collateralVault: publicKeyAt(data, 104),
    members,
    payoutOrder,
    contributionAmount: data.readBigUInt64LE(2_224),
    totalCollateralLocked: data.readBigUInt64LE(2_232),
    periodSeconds: data.readBigInt64LE(2_240),
    graceSeconds: data.readBigInt64LE(2_248),
    joinDeadline: data.readBigInt64LE(2_256),
    createdAt: data.readBigInt64LE(2_296),
    roundStartedAt: data.readBigInt64LE(2_320),
    memberCount,
    joinedCount: data.readUInt16LE(2_330),
    currentRound: data.readUInt16LE(2_336),
    roundContributions: data.readUInt16LE(2_338),
    statusIndex: data.readUInt8(2_342),
    phasePauseSnapshot: data.readBigUInt64LE(2_347),
  };
}

export function decodeMemberAccount(accountAddress: PublicKey, data: Buffer): OnchainMember & { group: string } {
  if (data.length !== MEMBER_ACCOUNT_SIZE || !data.subarray(0, 8).equals(MEMBER_DISCRIMINATOR)) {
    throw new Error(`Invalid Member account ${accountAddress.toBase58()}`);
  }
  return {
    accountAddress: accountAddress.toBase58(),
    group: publicKeyAt(data, 8).toBase58(),
    wallet: publicKeyAt(data, 40).toBase58(),
    collateralLockedRaw: data.readBigUInt64LE(136).toString(),
    joinedIndex: data.readUInt16LE(144),
    payoutRank: data.readUInt16LE(146),
    lastContributedRound: data.readUInt16LE(148),
    defaults: data.readUInt16LE(152),
    revealed: data.readUInt8(154) === 1,
    collateralPosted: data.readUInt8(155) === 1,
    payoutReceived: data.readUInt8(156) === 1,
  };
}

function cadenceFromSeconds(seconds: bigint): GroupCadence {
  if (seconds <= BigInt(10 * 86_400)) return "weekly";
  if (seconds <= BigInt(21 * 86_400)) return "biweekly";
  return "monthly";
}

function tokenAmount(raw: bigint, decimals: number): number {
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const wholeNumber = bigintToSafeNumber(whole, "Token amount");
  return wholeNumber + Number(fraction) / 10 ** decimals;
}

function effectiveJoinDeadline(group: RawGroup, pause: GlobalPause): bigint | null {
  if (pause.totalPausedSeconds < group.phasePauseSnapshot) return null;
  return group.joinDeadline + pause.totalPausedSeconds - group.phasePauseSnapshot;
}

function enrollmentStatus(group: RawGroup, pause: GlobalPause, now: bigint): GroupEnrollmentStatus {
  if (group.joinedCount >= group.memberCount) return "full";
  const deadline = effectiveJoinDeadline(group, pause);
  return group.statusIndex === 0 && !pause.paused && deadline !== null && now <= deadline
    ? "accepting-members"
    : "closed";
}

async function fetchPause(connection: Connection): Promise<GlobalPause> {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], RINGIO_PROGRAM_ID);
  const account = await connection.getAccountInfo(config, "confirmed");
  if (!account || account.data.length < 89) return { paused: false, totalPausedSeconds: BigInt(0) };
  return {
    totalPausedSeconds: account.data.readBigUInt64LE(80),
    paused: account.data.readUInt8(88) === 1,
  };
}

export async function fetchOnchainGroups(connection = new Connection(RINGIO_RPC_URL, "confirmed")): Promise<OnchainGroup[]> {
  const [groupAccounts, memberAccounts, pause] = await Promise.all([
    connection.getProgramAccounts(RINGIO_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: GROUP_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: bs58.encode(GROUP_DISCRIMINATOR) } },
      ],
    }),
    connection.getProgramAccounts(RINGIO_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: MEMBER_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: bs58.encode(MEMBER_DISCRIMINATOR) } },
      ],
    }),
    fetchPause(connection),
  ]);

  const rawGroups = groupAccounts.map(({ pubkey, account }) => decodeGroupAccount(pubkey, account.data));
  if (rawGroups.length === 0) return [];
  const decodedMembers = memberAccounts.map(({ pubkey, account }) => decodeMemberAccount(pubkey, account.data));
  const membersByGroup = new Map<string, OnchainMember[]>();
  for (const member of decodedMembers) {
    const list = membersByGroup.get(member.group) ?? [];
    list.push(member);
    membersByGroup.set(member.group, list);
  }

  const uniqueMints = [...new Map(rawGroups.map((group) => [group.mint.toBase58(), group.mint])).values()];
  const uniqueVaults = [
    ...new Map(
      rawGroups.flatMap((group) => [group.potVault, group.collateralVault]).map((vault) => [vault.toBase58(), vault]),
    ).values(),
  ];
  const [mintAccounts, vaultAccounts] = await Promise.all([
    connection.getMultipleAccountsInfo(uniqueMints, "confirmed"),
    connection.getMultipleAccountsInfo(uniqueVaults, "confirmed"),
  ]);
  const decimalsByMint = new Map<string, number>();
  uniqueMints.forEach((mint, index) => {
    const account = mintAccounts[index];
    if (!account || account.data.length < 45) throw new Error(`Mint account unavailable: ${mint.toBase58()}`);
    decimalsByMint.set(mint.toBase58(), account.data.readUInt8(44));
  });
  const rawBalanceByVault = new Map<string, bigint>();
  uniqueVaults.forEach((vault, index) => {
    const account = vaultAccounts[index];
    if (!account || account.data.length < 72) throw new Error(`Vault account unavailable: ${vault.toBase58()}`);
    rawBalanceByVault.set(vault.toBase58(), account.data.readBigUInt64LE(64));
  });

  const now = BigInt(Math.floor(Date.now() / 1_000));
  return rawGroups.map((group) => {
    const address = group.address.toBase58();
    const mint = group.mint.toBase58();
    const decimals = decimalsByMint.get(mint);
    if (decimals === undefined) throw new Error(`Mint decimals unavailable: ${mint}`);
    const contributionUsdc = tokenAmount(group.contributionAmount, decimals);
    const potBalanceRaw = rawBalanceByVault.get(group.potVault.toBase58());
    const collateralBalanceRaw = rawBalanceByVault.get(group.collateralVault.toBase58());
    if (potBalanceRaw === undefined || collateralBalanceRaw === undefined) {
      throw new Error(`Vault balance unavailable for ${address}`);
    }
    const periodSeconds = bigintToSafeNumber(group.periodSeconds, "Period seconds");
    const cadence = cadenceFromSeconds(group.periodSeconds);
    const exactPeriodLabel = periodLabel(periodSeconds);
    const exactPeriodLabelTr = periodLabel(periodSeconds, "tr");
    const code = groupCodeFromAddress(address);
    const filled = Math.min(group.joinedCount, group.memberCount);
    const status = STATUS_NAMES[group.statusIndex];
    if (!status) throw new Error(`Invalid group status in ${address}`);

    return {
      code,
      accountAddress: address,
      mint,
      name: `Ringio ${code}`,
      description: {
        tr: `${group.memberCount} kişilik, her ${exactPeriodLabelTr} ${contributionUsdc} USDC katkılı zincir üstü tasarruf grubu.`,
        en: `A ${group.memberCount}-member on-chain savings circle contributing ${contributionUsdc} USDC every ${exactPeriodLabel}.`,
      },
      contributionUsdc,
      cadence,
      languages: [],
      location: { mode: "unspecified", city: null, countryCode: null },
      start: {
        isoDate: new Date(bigintToSafeNumber(group.createdAt, "Created timestamp") * 1_000).toISOString(),
        timezone: "UTC",
      },
      memberSlots: { total: group.memberCount, filled, available: group.memberCount - filled },
      postPayoutCollateral: {
        scope: "remaining-scheduled-contributions-after-payout",
        coveragePercent: 100,
        maximumUsdc: contributionUsdc * (group.memberCount - 1),
      },
      interests: [],
      enrollmentStatus: enrollmentStatus(group, pause, now),
      listingSource: "solana-devnet",
      creator: group.creator.toBase58(),
      potVault: group.potVault.toBase58(),
      collateralVault: group.collateralVault.toBase58(),
      payoutOrder: group.payoutOrder.map((member) => member.toBase58()),
      currentRound: group.currentRound,
      roundContributions: group.roundContributions,
      periodSeconds,
      graceSeconds: bigintToSafeNumber(group.graceSeconds, "Grace seconds"),
      roundStartedAt: bigintToSafeNumber(group.roundStartedAt, "Round start timestamp"),
      potBalanceUsdc: tokenAmount(potBalanceRaw, decimals),
      collateralVaultBalanceUsdc: tokenAmount(collateralBalanceRaw, decimals),
      totalCollateralLockedUsdc: tokenAmount(group.totalCollateralLocked, decimals),
      status,
      members: (membersByGroup.get(address) ?? []).sort((a, b) => a.joinedIndex - b.joinedIndex),
    } satisfies OnchainGroup;
  });
}
