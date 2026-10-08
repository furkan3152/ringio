import { Connection, PublicKey } from "@solana/web3.js";

import { tokenToNumber } from "../ringio/amounts";
import type { MemberAccount } from "../ringio/accounts";
import {
  fetchCircles,
  fetchFormingGroupAddresses,
  fetchProgramStatus,
  fetchWalletIndex,
  type CircleSnapshot,
} from "../ringio/fetch";
import { circleDeadlines } from "../ringio/lifecycle";
import { NETWORKS, serverRpcUrl, type ClusterId } from "../solana/networks";
import { periodLabel } from "../duration";
import {
  groupCodeFromAddress,
  type GroupCadence,
  type GroupEnrollmentStatus,
  type ListingSource,
  type PublicGroup,
} from "./catalog";

/** Server-side catalog reads for the public API and the matcher. */

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
  status: CircleSnapshot["group"]["status"];
  members: readonly OnchainMember[];
};

export function programIdFor(cluster: ClusterId): PublicKey {
  return new PublicKey(NETWORKS[cluster].programId);
}

function cadenceFromSeconds(seconds: number): GroupCadence {
  if (seconds <= 10 * 86_400) return "weekly";
  if (seconds <= 21 * 86_400) return "biweekly";
  return "monthly";
}

function publicMember(member: MemberAccount): OnchainMember {
  return {
    accountAddress: member.address,
    wallet: member.wallet,
    joinedIndex: member.joinedIndex,
    payoutRank: member.payoutRank,
    lastContributedRound: member.lastContributedRound,
    defaults: member.defaults,
    collateralLockedRaw: member.collateralLocked.toString(),
    revealed: member.revealed,
    collateralPosted: member.collateralPosted,
    payoutReceived: member.payoutReceived,
  };
}

export function toOnchainGroup(
  snapshot: CircleSnapshot,
  cluster: ClusterId,
  pause: { paused: boolean; totalPausedSeconds: bigint },
  now: number,
): OnchainGroup {
  const { group, decimals } = snapshot;
  const contributionUsdc = tokenToNumber(group.contributionAmount, decimals);
  const code = groupCodeFromAddress(group.address);
  const filled = Math.min(group.joinedCount, group.memberCount);
  const joinDeadline = circleDeadlines(group, pause).join;
  const enrollmentStatus: GroupEnrollmentStatus =
    filled >= group.memberCount
      ? "full"
      : group.status === "forming" && !pause.paused && now <= joinDeadline
        ? "accepting-members"
        : "closed";
  const listingSource: ListingSource = `solana-${cluster}`;

  return {
    code,
    accountAddress: group.address,
    mint: group.mint,
    name: `Ringio ${code}`,
    description: {
      tr: `${group.memberCount} kişilik, her ${periodLabel(group.periodSeconds, "tr")} ${contributionUsdc} USDC katkılı zincir üstü tasarruf grubu.`,
      en: `A ${group.memberCount}-member on-chain savings circle contributing ${contributionUsdc} USDC every ${periodLabel(group.periodSeconds)}.`,
    },
    contributionUsdc,
    cadence: cadenceFromSeconds(group.periodSeconds),
    languages: [],
    location: { mode: "unspecified", city: null, countryCode: null },
    start: { isoDate: new Date(group.createdAt * 1_000).toISOString(), timezone: "UTC" },
    memberSlots: { total: group.memberCount, filled, available: group.memberCount - filled },
    postPayoutCollateral: {
      scope: "remaining-scheduled-contributions-after-payout",
      coveragePercent: 100,
      maximumUsdc: contributionUsdc * (group.memberCount - 1),
    },
    interests: [],
    enrollmentStatus,
    listingSource,
    creator: group.creator,
    potVault: group.potVault,
    collateralVault: group.collateralVault,
    payoutOrder: group.payoutOrder,
    currentRound: group.currentRound,
    roundContributions: group.roundContributions,
    periodSeconds: group.periodSeconds,
    graceSeconds: group.graceSeconds,
    roundStartedAt: group.roundStartedAt,
    potBalanceUsdc: tokenToNumber(snapshot.potBalance, decimals),
    collateralVaultBalanceUsdc: tokenToNumber(snapshot.collateralBalance, decimals),
    totalCollateralLockedUsdc: tokenToNumber(group.totalCollateralLocked, decimals),
    status: group.status,
    members: snapshot.members.map(publicMember),
  };
}

export class ProgramUnavailableError extends Error {
  constructor(
    readonly cluster: ClusterId,
    readonly state: "not-deployed" | "not-initialized",
  ) {
    super(`Ringio is ${state === "not-deployed" ? "not deployed" : "not initialized"} on ${cluster}`);
  }
}

/**
 * Loads circles from one cluster. By default only Forming circles are read
 * (discovery); `wallet` narrows to circles where that wallet is a member.
 */
export async function fetchOnchainGroups(
  cluster: ClusterId,
  options: { wallet?: string; connection?: Connection; limit?: number } = {},
): Promise<OnchainGroup[]> {
  const connection = options.connection ?? new Connection(serverRpcUrl(cluster), "confirmed");
  const programId = programIdFor(cluster);
  const status = await fetchProgramStatus(connection, programId);
  if (status.state !== "ready") throw new ProgramUnavailableError(cluster, status.state);

  let addresses: string[];
  if (options.wallet) {
    addresses = (await fetchWalletIndex(connection, programId, options.wallet)).memberGroups;
  } else {
    addresses = await fetchFormingGroupAddresses(connection, programId);
  }
  const snapshots = await fetchCircles(connection, programId, addresses.slice(0, options.limit ?? 50));
  const now = Math.floor(Date.now() / 1_000);
  return snapshots.map((snapshot) => toOnchainGroup(snapshot, cluster, status.config, now));
}
