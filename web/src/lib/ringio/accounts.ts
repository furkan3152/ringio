import { PublicKey } from "@solana/web3.js";

import {
  ACCOUNT_DISCRIMINATORS,
  ACCOUNT_SIZES,
  GROUP_STATUSES,
  MAX_MEMBERS,
  MIN_MEMBERS,
  type GroupStatus,
} from "./constants";

/**
 * Binary decoders for Ringio's program accounts (Anchor-compatible layout). Offsets mirror
 * `programs/ringio/src/state.rs` (8-byte discriminator + Borsh fields).
 * DataView keeps the decoders identical in Node and in the browser.
 */

export type ConfigAccount = {
  address: string;
  admin: string;
  pauseAuthority: string;
  pausedAt: number;
  totalPausedSeconds: bigint;
  paused: boolean;
  version: number;
};

export type GroupAccount = {
  address: string;
  creator: string;
  mint: string;
  potVault: string;
  collateralVault: string;
  /** Joined wallets in join order (creator first). */
  members: string[];
  /** Finalized payout order; empty until `finalize_order`. */
  payoutOrder: string[];
  id: bigint;
  contributionAmount: bigint;
  totalCollateralLocked: bigint;
  periodSeconds: number;
  graceSeconds: number;
  joinDeadline: number;
  revealWindowSeconds: number;
  collateralWindowSeconds: number;
  revealDeadline: number;
  collateralDeadline: number;
  createdAt: number;
  revealStartedAt: number;
  collateralStartedAt: number;
  roundStartedAt: number;
  memberCount: number;
  joinedCount: number;
  revealedCount: number;
  collateralizedCount: number;
  currentRound: number;
  roundContributions: number;
  failedRound: number;
  status: GroupStatus;
  phasePauseSnapshot: bigint;
};

export type MemberAccount = {
  address: string;
  group: string;
  wallet: string;
  commitment: Uint8Array;
  collateralLocked: bigint;
  joinedIndex: number;
  payoutRank: number;
  lastContributedRound: number;
  lastRefundedRound: number;
  defaults: number;
  revealed: boolean;
  collateralPosted: boolean;
  payoutReceived: boolean;
  lastResolutionKind: number;
};

export type InviteAccount = {
  address: string;
  group: string;
  invitee: string;
  used: boolean;
};

export type TokenAccountInfo = {
  address: string;
  mint: string;
  owner: string;
  amount: bigint;
};

const DEFAULT_KEY = PublicKey.default.toBase58();

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function keyAt(data: Uint8Array, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range`);
  return result;
}

function hasDiscriminator(data: Uint8Array, expected: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let index = 0; index < 8; index += 1) {
    if (data[index] !== expected[index]) return false;
  }
  return true;
}

function assertAccount(
  data: Uint8Array,
  size: number,
  discriminator: Uint8Array,
  label: string,
  address: string,
): void {
  if (data.length !== size || !hasDiscriminator(data, discriminator)) {
    throw new Error(`Invalid ${label} account ${address}`);
  }
}

export function decodeConfig(address: string, data: Uint8Array): ConfigAccount {
  assertAccount(data, ACCOUNT_SIZES.config, ACCOUNT_DISCRIMINATORS.config, "GlobalConfig", address);
  const dv = view(data);
  return {
    address,
    admin: keyAt(data, 8),
    pauseAuthority: keyAt(data, 40),
    pausedAt: safeNumber(dv.getBigInt64(72, true), "paused_at"),
    totalPausedSeconds: dv.getBigUint64(80, true),
    paused: data[88] === 1,
    version: data[90],
  };
}

export function decodeGroup(address: string, data: Uint8Array): GroupAccount {
  assertAccount(data, ACCOUNT_SIZES.group, ACCOUNT_DISCRIMINATORS.group, "Group", address);
  const dv = view(data);
  const memberCount = dv.getUint16(2_328, true);
  if (memberCount < MIN_MEMBERS || memberCount > MAX_MEMBERS) {
    throw new Error(`Invalid member count in ${address}`);
  }
  const joinedCount = Math.min(dv.getUint16(2_330, true), memberCount);
  const statusIndex = data[2_342];
  const status = GROUP_STATUSES[statusIndex];
  if (!status) throw new Error(`Invalid group status in ${address}`);

  const members = Array.from({ length: joinedCount }, (_, index) => keyAt(data, 168 + index * 32));
  const order = Array.from({ length: memberCount }, (_, index) => keyAt(data, 1_192 + index * 32));
  const payoutOrder = order.every((wallet) => wallet !== DEFAULT_KEY) ? order : [];
  const i64 = (offset: number, label: string) => safeNumber(dv.getBigInt64(offset, true), label);

  return {
    address,
    creator: keyAt(data, 8),
    mint: keyAt(data, 40),
    potVault: keyAt(data, 72),
    collateralVault: keyAt(data, 104),
    members,
    payoutOrder,
    id: dv.getBigUint64(2_216, true),
    contributionAmount: dv.getBigUint64(2_224, true),
    totalCollateralLocked: dv.getBigUint64(2_232, true),
    periodSeconds: i64(2_240, "period_seconds"),
    graceSeconds: i64(2_248, "grace_seconds"),
    joinDeadline: i64(2_256, "join_deadline"),
    revealWindowSeconds: i64(2_264, "reveal_window_seconds"),
    collateralWindowSeconds: i64(2_272, "collateral_window_seconds"),
    revealDeadline: i64(2_280, "reveal_deadline"),
    collateralDeadline: i64(2_288, "collateral_deadline"),
    createdAt: i64(2_296, "created_at"),
    revealStartedAt: i64(2_304, "reveal_started_at"),
    collateralStartedAt: i64(2_312, "collateral_started_at"),
    roundStartedAt: i64(2_320, "round_started_at"),
    memberCount,
    joinedCount,
    revealedCount: dv.getUint16(2_332, true),
    collateralizedCount: dv.getUint16(2_334, true),
    currentRound: dv.getUint16(2_336, true),
    roundContributions: dv.getUint16(2_338, true),
    failedRound: dv.getUint16(2_340, true),
    status,
    phasePauseSnapshot: dv.getBigUint64(2_347, true),
  };
}

export function decodeMember(address: string, data: Uint8Array): MemberAccount {
  assertAccount(data, ACCOUNT_SIZES.member, ACCOUNT_DISCRIMINATORS.member, "Member", address);
  const dv = view(data);
  return {
    address,
    group: keyAt(data, 8),
    wallet: keyAt(data, 40),
    commitment: data.slice(72, 104),
    collateralLocked: dv.getBigUint64(136, true),
    joinedIndex: dv.getUint16(144, true),
    payoutRank: dv.getUint16(146, true),
    lastContributedRound: dv.getUint16(148, true),
    lastRefundedRound: dv.getUint16(150, true),
    defaults: dv.getUint16(152, true),
    revealed: data[154] === 1,
    collateralPosted: data[155] === 1,
    payoutReceived: data[156] === 1,
    lastResolutionKind: data[157],
  };
}

export function decodeInvite(address: string, data: Uint8Array): InviteAccount {
  assertAccount(data, ACCOUNT_SIZES.invite, ACCOUNT_DISCRIMINATORS.invite, "Invite", address);
  return {
    address,
    group: keyAt(data, 8),
    invitee: keyAt(data, 40),
    used: data[72] === 1,
  };
}

/** Classic SPL Token account (165 bytes): mint, owner, amount. */
export function decodeTokenAccount(address: string, data: Uint8Array): TokenAccountInfo {
  if (data.length < 72) throw new Error(`Invalid token account ${address}`);
  return {
    address,
    mint: keyAt(data, 0),
    owner: keyAt(data, 32),
    amount: view(data).getBigUint64(64, true),
  };
}

/** SPL Mint decimals live at byte 44. */
export function decodeMintDecimals(address: string, data: Uint8Array): number {
  if (data.length < 82) throw new Error(`Invalid mint account ${address}`);
  return data[44];
}
