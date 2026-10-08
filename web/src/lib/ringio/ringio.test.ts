import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import type { GroupAccount, MemberAccount } from "./accounts";
import { formatTokenAmount, parseTokenAmount } from "./amounts";
import { commitmentHash, commitmentMessage, secretFromSignature } from "./commitment";
import { ACCOUNT_DISCRIMINATORS, INSTRUCTION_DISCRIMINATORS, UNSET_ROUND } from "./constants";
import { describeTransactionError } from "./errors";
import { createGroupIx, joinGroupIx, settleRoundIx, validateCreateGroupParams } from "./instructions";
import { collateralRequired, planActions, totalCollateralRequired } from "./lifecycle";
import { groupPda, memberPda } from "./pda";

function anchorDiscriminator(namespace: string, name: string): number[] {
  return [...createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8)];
}

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

test("instruction discriminators match sha256('global:<name>')", () => {
  for (const [name, bytes] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    assert.deepEqual([...bytes], anchorDiscriminator("global", snake(name)), name);
  }
});

test("account discriminators match sha256('account:<Name>')", () => {
  const names = { config: "GlobalConfig", group: "Group", invite: "Invite", member: "Member" } as const;
  for (const [key, name] of Object.entries(names)) {
    assert.deepEqual([...ACCOUNT_DISCRIMINATORS[key as keyof typeof names]], anchorDiscriminator("account", name));
  }
});

test("create_group encodes Borsh args in declaration order", () => {
  const programId = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const ix = createGroupIx({
    programId,
    creator,
    mint,
    groupId: BigInt(42),
    memberCount: 5,
    contributionAmount: BigInt(250_000_000),
    periodSeconds: 604_800,
    graceSeconds: 86_400,
    joinDeadline: 1_900_000_000,
    revealWindowSeconds: 172_800,
    collateralWindowSeconds: 172_800,
    creatorCommitment: new Uint8Array(32).fill(7),
  });
  assert.equal(ix.data.length, 8 + 8 + 2 + 8 + 8 * 5 + 32);
  assert.equal(ix.data.readBigUInt64LE(8), BigInt(42));
  assert.equal(ix.data.readUInt16LE(16), 5);
  assert.equal(ix.data.readBigUInt64LE(18), BigInt(250_000_000));
  assert.equal(ix.data.readBigInt64LE(26), BigInt(604_800));
  assert.equal(ix.data.readBigInt64LE(42), BigInt(1_900_000_000));
  assert.equal(ix.keys.length, 10);
  assert.ok(ix.keys[1].pubkey.equals(groupPda(programId, creator, BigInt(42))));
  assert.ok(ix.keys[6].pubkey.equals(creator) && ix.keys[6].isSigner && ix.keys[6].isWritable);
});

test("builders reject all-zero commitments before a wallet is asked to sign", () => {
  const key = Keypair.generate().publicKey;
  assert.throws(() => joinGroupIx({ programId: key, group: key, participant: key, commitment: new Uint8Array(32) }));
});

test("settle_round targets the recipient's Member PDA and only the keeper signs", () => {
  const programId = Keypair.generate().publicKey;
  const group = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const keeper = Keypair.generate().publicKey;
  const ix = settleRoundIx({ programId, group, mint: Keypair.generate().publicKey, recipient, keeper });
  assert.ok(ix.keys[2].pubkey.equals(memberPda(programId, group, recipient)));
  assert.deepEqual(ix.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58()), [keeper.toBase58()]);
});

test("create validation mirrors the program's bounds", () => {
  const key = Keypair.generate().publicKey;
  const base = {
    programId: key,
    creator: key,
    mint: key,
    groupId: BigInt(1),
    memberCount: 4,
    contributionAmount: BigInt(1_000_000),
    periodSeconds: 3_600,
    graceSeconds: 600,
    joinDeadline: 2_000,
    revealWindowSeconds: 600,
    collateralWindowSeconds: 600,
    creatorCommitment: new Uint8Array(32).fill(1),
  };
  assert.equal(validateCreateGroupParams(base, 1_000), null);
  assert.match(validateCreateGroupParams({ ...base, memberCount: 33 }, 1_000) ?? "", /2–32/);
  assert.match(validateCreateGroupParams({ ...base, joinDeadline: 900 }, 1_000) ?? "", /future/);
  assert.match(validateCreateGroupParams({ ...base, periodSeconds: 400 * 86_400 }, 1_000) ?? "", /366/);
});

test("commitment hash matches the program's domain-separated sha256", async () => {
  const group = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  const secret = new Uint8Array(32).fill(9);
  const expected = createHash("sha256")
    .update("ringio-commitment-v1")
    .update(group.toBuffer())
    .update(wallet.toBuffer())
    .update(secret)
    .digest();
  assert.deepEqual(Buffer.from(await commitmentHash(group, wallet, secret)), expected);
});

test("wallet-derived secrets are deterministic per signature and bound to the circle in the message", async () => {
  const signature = new Uint8Array(64).fill(3);
  assert.deepEqual(await secretFromSignature(signature), await secretFromSignature(signature));
  const message = commitmentMessage({ cluster: "devnet", programId: "P", group: "G", wallet: "W" });
  assert.match(message, /Circle: G/);
  assert.match(message, /never moves funds/);
});

test("token amounts round-trip exactly", () => {
  assert.equal(parseTokenAmount("12.5", 6), BigInt(12_500_000));
  assert.equal(parseTokenAmount("0.000001", 6), BigInt(1));
  assert.equal(parseTokenAmount("1.0000001", 6), null);
  assert.equal(parseTokenAmount("abc", 6), null);
  assert.equal(formatTokenAmount(BigInt(1_234_500_000), 6), "1,234.50");
  assert.equal(formatTokenAmount(BigInt(1), 6), "0.000001");
});

test("collateral declines with payout rank", () => {
  assert.equal(collateralRequired(6, 0, BigInt(100)), BigInt(500));
  assert.equal(collateralRequired(6, 5, BigInt(100)), BigInt(0));
  assert.equal(totalCollateralRequired(6, BigInt(100)), BigInt(1_500));
});

test("Anchor errors decode into product copy", () => {
  assert.match(describeTransactionError({ InstructionError: [0, { Custom: 6007 }] }), /already full/);
  assert.match(describeTransactionError("AccountNotFound"), /no SOL/);
  assert.match(describeTransactionError(new Error("User rejected the request.")), /declined/);
  assert.match(
    describeTransactionError(Object.assign(new Error(""), { error: new Error("Transaction simulation failed: custom program error: 0x1785") })),
    /grace period/i,
  );
});

function fakeGroup(overrides: Partial<GroupAccount> = {}): GroupAccount {
  const keys = Array.from({ length: 3 }, () => Keypair.generate().publicKey.toBase58());
  return {
    address: Keypair.generate().publicKey.toBase58(),
    creator: keys[0],
    mint: PublicKey.default.toBase58(),
    potVault: PublicKey.default.toBase58(),
    collateralVault: PublicKey.default.toBase58(),
    members: keys,
    payoutOrder: [keys[1], keys[0], keys[2]],
    id: BigInt(1),
    contributionAmount: BigInt(100),
    totalCollateralLocked: BigInt(300),
    periodSeconds: 1_000,
    graceSeconds: 100,
    joinDeadline: 5_000,
    revealWindowSeconds: 100,
    collateralWindowSeconds: 100,
    revealDeadline: 0,
    collateralDeadline: 0,
    createdAt: 0,
    revealStartedAt: 0,
    collateralStartedAt: 0,
    roundStartedAt: 10_000,
    memberCount: 3,
    joinedCount: 3,
    revealedCount: 3,
    collateralizedCount: 3,
    currentRound: 1,
    roundContributions: 1,
    failedRound: UNSET_ROUND,
    status: "active",
    phasePauseSnapshot: BigInt(0),
    ...overrides,
  };
}

function fakeMember(group: GroupAccount, wallet: string, overrides: Partial<MemberAccount> = {}): MemberAccount {
  const rank = group.payoutOrder.indexOf(wallet);
  return {
    address: Keypair.generate().publicKey.toBase58(),
    group: group.address,
    wallet,
    commitment: new Uint8Array(32),
    collateralLocked: collateralRequired(group.memberCount, rank, group.contributionAmount),
    joinedIndex: group.members.indexOf(wallet),
    payoutRank: rank,
    lastContributedRound: 0,
    lastRefundedRound: UNSET_ROUND,
    defaults: 0,
    revealed: true,
    collateralPosted: true,
    payoutReceived: rank < group.currentRound,
    lastResolutionKind: 1,
    ...overrides,
  };
}

test("action plan: an unpaid member's next step is to contribute, with collateral release after payout", () => {
  const group = fakeGroup();
  const earlyRecipient = group.payoutOrder[0];
  const members = group.members.map((wallet) => fakeMember(group, wallet));
  const config = { paused: false, totalPausedSeconds: BigInt(0) };
  const plan = planActions({ group, members, config, wallet: earlyRecipient, invite: null, now: 10_500 });
  assert.equal(plan.primary?.id, "contribute");
  assert.equal(plan.primary?.release, BigInt(100));
});

test("action plan: after grace, coverable and uncovered defaults route to different cranks", () => {
  const group = fakeGroup();
  const members = group.members.map((wallet) => fakeMember(group, wallet));
  const config = { paused: false, totalPausedSeconds: BigInt(0) };
  const plan = planActions({ group, members, config, wallet: null, invite: null, now: 11_200 });
  const ids = plan.secondary.map((action) => action.id).concat(plan.primary ? [plan.primary.id] : []);
  assert.ok(ids.includes("cover-default"));
  assert.ok(ids.includes("abort-round"));
});

test("action plan: pausing blocks progress but never refunds", () => {
  const group = fakeGroup({ status: "cancelled" });
  const members = group.members.map((wallet) => fakeMember(group, wallet));
  const plan = planActions({
    group,
    members,
    config: { paused: true, totalPausedSeconds: BigInt(0) },
    wallet: group.payoutOrder[0],
    invite: null,
    now: 0,
  });
  assert.equal(plan.primary?.id, "refund-collateral");
  assert.equal(plan.primary?.enabled, true);
});

test("action plan: paused time extends live deadlines", () => {
  const group = fakeGroup({ status: "forming", joinedCount: 1, members: [], payoutOrder: [], joinDeadline: 1_000 });
  const invitee = Keypair.generate().publicKey.toBase58();
  const invite = { address: "", group: group.address, invitee, used: false };
  const args = { group, members: [], wallet: invitee, invite, now: 1_050 };
  assert.equal(planActions({ ...args, config: { paused: false, totalPausedSeconds: BigInt(0) } }).primary?.enabled, false);
  assert.equal(planActions({ ...args, config: { paused: false, totalPausedSeconds: BigInt(100) } }).primary?.enabled, true);
});
