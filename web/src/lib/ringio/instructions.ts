import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  INSTRUCTION_DISCRIMINATORS,
  MAX_MEMBERS,
  MAX_PHASE_SECONDS,
  MIN_MEMBERS,
  TOKEN_PROGRAM_ID,
} from "./constants";
import {
  associatedTokenAddress,
  collateralVaultPda,
  configPda,
  groupPda,
  invitePda,
  memberPda,
  potVaultPda,
  programDataPda,
  u64Le,
} from "./pda";

/**
 * Hand-encoded Anchor instructions. Account order and argument layout mirror
 * the `#[derive(Accounts)]` structs in `programs/ringio/src/lib.rs`; the
 * LiteSVM suite executes every builder against the deployed program binary.
 */

type Meta = [pubkey: PublicKey, isSigner: boolean, isWritable: boolean];

function metas(entries: Meta[]): AccountMeta[] {
  return entries.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable }));
}

function concat(parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function u16Le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error("u16 out of range");
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function i64Le(value: bigint): Uint8Array {
  if (value < BigInt("-9223372036854775808") || value > BigInt("9223372036854775807")) {
    throw new Error("i64 out of range");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function bytes32(value: Uint8Array, label: string): Uint8Array {
  if (value.length !== 32) throw new Error(`${label} must be 32 bytes`);
  if (value.every((byte) => byte === 0)) throw new Error(`${label} must not be all zero`);
  return value;
}

function instruction(programId: PublicKey, keys: Meta[], data: Uint8Array[]): TransactionInstruction {
  return new TransactionInstruction({ programId, keys: metas(keys), data: concat(data) });
}

export type CreateGroupParams = {
  programId: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  groupId: bigint;
  memberCount: number;
  contributionAmount: bigint;
  periodSeconds: number;
  graceSeconds: number;
  joinDeadline: number;
  revealWindowSeconds: number;
  collateralWindowSeconds: number;
  creatorCommitment: Uint8Array;
};

/** Mirrors `validate_group_args` so the wallet never signs a doomed transaction. */
export function validateCreateGroupParams(params: CreateGroupParams, now: number): string | null {
  if (!Number.isInteger(params.memberCount) || params.memberCount < MIN_MEMBERS || params.memberCount > MAX_MEMBERS) {
    return `A circle needs ${MIN_MEMBERS}–${MAX_MEMBERS} members.`;
  }
  if (params.contributionAmount <= BigInt(0)) return "The contribution must be greater than zero.";
  const windows = [
    params.periodSeconds,
    params.graceSeconds,
    params.revealWindowSeconds,
    params.collateralWindowSeconds,
  ];
  if (windows.some((value) => !Number.isSafeInteger(value) || value <= 0 || value > MAX_PHASE_SECONDS)) {
    return "Every period and window must be between 1 second and 366 days.";
  }
  if (!Number.isSafeInteger(params.joinDeadline) || params.joinDeadline <= now) {
    return "The join deadline must be in the future.";
  }
  if (params.joinDeadline - now > MAX_PHASE_SECONDS) return "The join window can be at most 366 days.";
  const maxU64 = BigInt("18446744073709551615");
  const n = BigInt(params.memberCount);
  if (params.contributionAmount * n > maxU64) return "The round pot overflows.";
  if ((n * (n - BigInt(1))) / BigInt(2) * params.contributionAmount > maxU64) return "Total collateral overflows.";
  return null;
}

export function createGroupIx(params: CreateGroupParams): TransactionInstruction {
  const { programId, creator, mint } = params;
  const group = groupPda(programId, creator, params.groupId);
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, creator), false, true],
      [potVaultPda(programId, group), false, true],
      [collateralVaultPda(programId, group), false, true],
      [mint, false, false],
      [creator, true, true],
      [TOKEN_PROGRAM_ID, false, false],
      [SystemProgram.programId, false, false],
      [SYSVAR_RENT_PUBKEY, false, false],
    ],
    [
      INSTRUCTION_DISCRIMINATORS.createGroup,
      u64Le(params.groupId),
      u16Le(params.memberCount),
      u64Le(params.contributionAmount),
      i64Le(BigInt(params.periodSeconds)),
      i64Le(BigInt(params.graceSeconds)),
      i64Le(BigInt(params.joinDeadline)),
      i64Le(BigInt(params.revealWindowSeconds)),
      i64Le(BigInt(params.collateralWindowSeconds)),
      bytes32(params.creatorCommitment, "Creator commitment"),
    ],
  );
}

export function inviteMemberIx(args: {
  programId: PublicKey;
  group: PublicKey;
  creator: PublicKey;
  invitee: PublicKey;
}): TransactionInstruction {
  const { programId, group, creator, invitee } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, false],
      [invitePda(programId, group, invitee), false, true],
      [creator, true, true],
      [SystemProgram.programId, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.inviteMember, invitee.toBytes()],
  );
}

export function joinGroupIx(args: {
  programId: PublicKey;
  group: PublicKey;
  participant: PublicKey;
  commitment: Uint8Array;
}): TransactionInstruction {
  const { programId, group, participant } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [invitePda(programId, group, participant), false, true],
      [memberPda(programId, group, participant), false, true],
      [participant, true, true],
      [SystemProgram.programId, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.joinGroup, bytes32(args.commitment, "Commitment")],
  );
}

export function revealSecretIx(args: {
  programId: PublicKey;
  group: PublicKey;
  participant: PublicKey;
  secret: Uint8Array;
}): TransactionInstruction {
  const { programId, group, participant } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, participant), false, true],
      [participant, true, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.revealSecret, bytes32(args.secret, "Secret")],
  );
}

export function finalizeOrderIx(args: { programId: PublicKey; group: PublicKey }): TransactionInstruction {
  return instruction(
    args.programId,
    [
      [configPda(args.programId), false, false],
      [args.group, false, true],
    ],
    [INSTRUCTION_DISCRIMINATORS.finalizeOrder],
  );
}

type GroupRefs = {
  programId: PublicKey;
  group: PublicKey;
  mint: PublicKey;
};

export function postCollateralIx(args: GroupRefs & { participant: PublicKey }): TransactionInstruction {
  const { programId, group, mint, participant } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, participant), false, true],
      [associatedTokenAddress(participant, mint), false, true],
      [collateralVaultPda(programId, group), false, true],
      [mint, false, false],
      [participant, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.postCollateral],
  );
}

export function activateGroupIx(args: { programId: PublicKey; group: PublicKey }): TransactionInstruction {
  const { programId, group } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [collateralVaultPda(programId, group), false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.activateGroup],
  );
}

export function contributeIx(args: GroupRefs & { participant: PublicKey }): TransactionInstruction {
  const { programId, group, mint, participant } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, participant), false, true],
      [associatedTokenAddress(participant, mint), false, true],
      [potVaultPda(programId, group), false, true],
      [collateralVaultPda(programId, group), false, true],
      [mint, false, false],
      [participant, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.contribute],
  );
}

export function coverDefaultIx(
  args: GroupRefs & { memberWallet: PublicKey; keeper: PublicKey },
): TransactionInstruction {
  const { programId, group, mint } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, args.memberWallet), false, true],
      [potVaultPda(programId, group), false, true],
      [collateralVaultPda(programId, group), false, true],
      [mint, false, false],
      [args.keeper, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.coverDefault],
  );
}

export function settleRoundIx(
  args: GroupRefs & { recipient: PublicKey; keeper: PublicKey },
): TransactionInstruction {
  const { programId, group, mint, recipient } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, recipient), false, true],
      [potVaultPda(programId, group), false, true],
      [associatedTokenAddress(recipient, mint), false, true],
      [mint, false, false],
      [args.keeper, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.settleRound],
  );
}

export function abortUncoveredRoundIx(args: {
  programId: PublicKey;
  group: PublicKey;
  delinquentWallet: PublicKey;
  keeper: PublicKey;
}): TransactionInstruction {
  const { programId, group } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, false],
      [group, false, true],
      [memberPda(programId, group, args.delinquentWallet), false, false],
      [args.keeper, true, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.abortUncoveredRound],
  );
}

export function cancelGroupIx(args: {
  programId: PublicKey;
  group: PublicKey;
  caller: PublicKey;
}): TransactionInstruction {
  return instruction(
    args.programId,
    [
      [configPda(args.programId), false, false],
      [args.group, false, true],
      [args.caller, true, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.cancelGroup],
  );
}

export function refundFailedRoundIx(
  args: GroupRefs & { memberWallet: PublicKey; keeper: PublicKey },
): TransactionInstruction {
  const { programId, group, mint, memberWallet } = args;
  return instruction(
    programId,
    [
      [group, false, true],
      [memberPda(programId, group, memberWallet), false, true],
      [potVaultPda(programId, group), false, true],
      [collateralVaultPda(programId, group), false, true],
      [associatedTokenAddress(memberWallet, mint), false, true],
      [mint, false, false],
      [args.keeper, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.refundFailedRound],
  );
}

export function refundCollateralIx(args: GroupRefs & { participant: PublicKey }): TransactionInstruction {
  const { programId, group, mint, participant } = args;
  return instruction(
    programId,
    [
      [group, false, true],
      [memberPda(programId, group, participant), false, true],
      [collateralVaultPda(programId, group), false, true],
      [associatedTokenAddress(participant, mint), false, true],
      [mint, false, false],
      [participant, true, false],
      [TOKEN_PROGRAM_ID, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.refundCollateral],
  );
}

/** Admin-only bootstrap; requires the program's upgrade authority as signer. */
export function initializeConfigIx(args: {
  programId: PublicKey;
  admin: PublicKey;
  pauseAuthority: PublicKey;
}): TransactionInstruction {
  const { programId } = args;
  return instruction(
    programId,
    [
      [configPda(programId), false, true],
      [args.admin, true, true],
      [programId, false, false],
      [programDataPda(programId), false, false],
      [SystemProgram.programId, false, false],
    ],
    [INSTRUCTION_DISCRIMINATORS.initializeConfig, args.pauseAuthority.toBytes()],
  );
}

/** `CreateIdempotent` on the Associated Token Account program. */
export function createAtaIdempotentIx(args: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: metas([
      [args.payer, true, true],
      [associatedTokenAddress(args.owner, args.mint), false, true],
      [args.owner, false, false],
      [args.mint, false, false],
      [SystemProgram.programId, false, false],
      [TOKEN_PROGRAM_ID, false, false],
    ]),
    data: Buffer.from([1]),
  });
}
