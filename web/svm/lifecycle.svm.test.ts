import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { address, getTransactionDecoder, lamports, type Address } from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

import {
  decodeConfig,
  decodeGroup,
  decodeMember,
  decodeTokenAccount,
  type GroupAccount,
  type MemberAccount,
} from "../src/lib/ringio/accounts";
import { commitmentHash } from "../src/lib/ringio/commitment";
import { ACCOUNT_DISCRIMINATORS, TOKEN_PROGRAM_ID } from "../src/lib/ringio/constants";
import {
  abortUncoveredRoundIx,
  activateGroupIx,
  cancelGroupIx,
  contributeIx,
  coverDefaultIx,
  createAtaIdempotentIx,
  createGroupIx,
  finalizeOrderIx,
  inviteMemberIx,
  joinGroupIx,
  postCollateralIx,
  refundCollateralIx,
  refundFailedRoundIx,
  revealSecretIx,
  settleRoundIx,
} from "../src/lib/ringio/instructions";
import { collateralRequired, planActions } from "../src/lib/ringio/lifecycle";
import {
  associatedTokenAddress,
  collateralVaultPda,
  configPda,
  groupPda,
  memberPda,
  potVaultPda,
} from "../src/lib/ringio/pda";

/**
 * Executes every client instruction builder against the deployed Ringio
 * bytecode inside LiteSVM. Fetch the binary first with `npm run program:fetch`
 * (or point RINGIO_PROGRAM_SO at a local `anchor build` artifact).
 */

const PROGRAM_ID = new PublicKey("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const programPath = [
  process.env.RINGIO_PROGRAM_SO,
  resolve(webRoot, "../target/deploy/ringio.so"),
  resolve(webRoot, ".cache/ringio-devnet.so"),
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

const START = 1_800_000_000;
const DAY = 86_400;
const CONTRIBUTION = BigInt(25_000_000); // 25 tokens at 6 decimals
const STARTING_BALANCE = BigInt(1_000_000_000);

type Harness = {
  svm: LiteSVM;
  mint: PublicKey;
  setTime(unix: number): void;
  send(signers: Keypair[], instructions: TransactionInstruction[]): void;
  fail(signers: Keypair[], instructions: TransactionInstruction[], expectedCode: number): void;
  wallet(): Keypair;
  balance(owner: PublicKey): bigint;
  vault(address: PublicKey): bigint;
  group(address: PublicKey): GroupAccount;
  member(group: PublicKey, wallet: PublicKey): MemberAccount;
  setPaused(paused: boolean): void;
  airdrop(key: PublicKey): void;
};

const decodeTransaction = getTransactionDecoder();

function addr(key: PublicKey): Address {
  return address(key.toBase58());
}

/** Reads the custom program error from the instruction error (or Anchor's log line). */
function errorCode(result: FailedTransactionMetadata): number | null {
  const err = result.err() as unknown as { err?: () => { code?: unknown } };
  const code = typeof err.err === "function" ? err.err().code : undefined;
  if (typeof code === "number") return code;
  const logged = result.meta().logs().join("\n").match(/Error Number: (\d+)/);
  return logged ? Number(logged[1]) : null;
}

function configData(admin: PublicKey, paused: boolean): Uint8Array {
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const data = Buffer.alloc(136);
  Buffer.from(ACCOUNT_DISCRIMINATORS.config).copy(data, 0);
  admin.toBuffer().copy(data, 8);
  admin.toBuffer().copy(data, 40);
  data.writeBigInt64LE(BigInt(paused ? START : 0), 72);
  data.writeBigUInt64LE(BigInt(0), 80);
  data.writeUInt8(paused ? 1 : 0, 88);
  data.writeUInt8(bump, 89);
  data.writeUInt8(1, 90);
  return data;
}

function mintData(authority: PublicKey): Uint8Array {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  authority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(BigInt(10) ** BigInt(15), 36);
  data.writeUInt8(6, 44);
  data.writeUInt8(1, 45);
  return data;
}

function tokenAccountData(mint: PublicKey, owner: PublicKey, amount: bigint): Uint8Array {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  return data;
}

function harness(): Harness {
  assert.ok(programPath, "Program binary missing: run `npm run program:fetch` first");
  const svm = new LiteSVM();
  svm.addProgram(addr(PROGRAM_ID), readFileSync(programPath));
  const admin = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array) =>
    svm.setAccount({
      address: addr(key),
      data,
      executable: false,
      lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: addr(owner),
      space: BigInt(data.length),
    });
  const read = (key: PublicKey): Uint8Array | null => {
    const account = svm.getAccount(addr(key));
    return account.exists ? Uint8Array.from(account.data) : null;
  };
  const submit = (signers: Keypair[], instructions: TransactionInstruction[]) => {
    const tx = new Transaction().add(...instructions);
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(...signers);
    const result = svm.sendTransaction(decodeTransaction.decode(tx.serialize()));
    svm.expireBlockhash();
    return result;
  };

  const writeConfig = (paused: boolean) => put(configPda(PROGRAM_ID), PROGRAM_ID, configData(admin.publicKey, paused));
  writeConfig(false);
  put(mint, TOKEN_PROGRAM_ID, mintData(admin.publicKey));

  const h: Harness = {
    svm,
    mint,
    setTime(unix) {
      const clock = svm.getClock();
      clock.unixTimestamp = BigInt(unix);
      svm.setClock(clock);
    },
    send(signers, instructions) {
      const result = submit(signers, instructions);
      if (result instanceof FailedTransactionMetadata) {
        assert.fail(`Transaction failed: ${result.toString()}\n${result.meta().logs().join("\n")}`);
      }
    },
    fail(signers, instructions, expectedCode) {
      const result = submit(signers, instructions);
      assert.ok(result instanceof FailedTransactionMetadata, `Expected failure ${expectedCode}`);
      assert.equal(errorCode(result), expectedCode, result.meta().logs().join("\n"));
    },
    wallet() {
      const keypair = Keypair.generate();
      svm.airdrop(addr(keypair.publicKey), lamports(BigInt(10 * LAMPORTS_PER_SOL)));
      put(
        associatedTokenAddress(keypair.publicKey, mint),
        TOKEN_PROGRAM_ID,
        tokenAccountData(mint, keypair.publicKey, STARTING_BALANCE),
      );
      return keypair;
    },
    balance(owner) {
      return h.vault(associatedTokenAddress(owner, mint));
    },
    vault(key) {
      const data = read(key);
      return data ? decodeTokenAccount(key.toBase58(), data).amount : BigInt(0);
    },
    group(key) {
      const data = read(key);
      assert.ok(data, "Group missing");
      return decodeGroup(key.toBase58(), data);
    },
    member(group, wallet) {
      const key = memberPda(PROGRAM_ID, group, wallet);
      const data = read(key);
      assert.ok(data, "Member missing");
      return decodeMember(key.toBase58(), data);
    },
    setPaused(paused) {
      writeConfig(paused);
      const data = read(configPda(PROGRAM_ID));
      assert.ok(data);
      assert.equal(decodeConfig("config", data).paused, paused);
    },
    airdrop(key) {
      svm.airdrop(addr(key), lamports(BigInt(LAMPORTS_PER_SOL)));
    },
  };
  h.setTime(START);
  return h;
}

type Circle = {
  group: PublicKey;
  wallets: Keypair[];
  secrets: Map<string, Uint8Array>;
};

async function formCircle(h: Harness, size: number, overrides: { periodSeconds?: number; graceSeconds?: number } = {}): Promise<Circle> {
  const creator = h.wallet();
  const groupId = BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1_000_000));
  const group = groupPda(PROGRAM_ID, creator.publicKey, groupId);
  const secrets = new Map<string, Uint8Array>();
  const secretFor = (wallet: PublicKey) => {
    const secret = randomBytes(32);
    secrets.set(wallet.toBase58(), secret);
    return secret;
  };

  h.send([creator], [
    createGroupIx({
      programId: PROGRAM_ID,
      creator: creator.publicKey,
      mint: h.mint,
      groupId,
      memberCount: size,
      contributionAmount: CONTRIBUTION,
      periodSeconds: overrides.periodSeconds ?? 7 * DAY,
      graceSeconds: overrides.graceSeconds ?? DAY,
      joinDeadline: START + 3 * DAY,
      revealWindowSeconds: 2 * DAY,
      collateralWindowSeconds: 2 * DAY,
      creatorCommitment: await commitmentHash(group, creator.publicKey, secretFor(creator.publicKey)),
    }),
  ]);
  assert.equal(h.group(group).status, "forming");

  const wallets = [creator];
  for (let index = 1; index < size; index += 1) {
    const invitee = h.wallet();
    h.send([creator], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: creator.publicKey, invitee: invitee.publicKey })]);
    h.send([invitee], [
      joinGroupIx({
        programId: PROGRAM_ID,
        group,
        participant: invitee.publicKey,
        commitment: await commitmentHash(group, invitee.publicKey, secretFor(invitee.publicKey)),
      }),
    ]);
    wallets.push(invitee);
  }
  return { group, wallets, secrets };
}

function revealAll(h: Harness, circle: Circle): void {
  for (const wallet of circle.wallets) {
    const secret = circle.secrets.get(wallet.publicKey.toBase58());
    assert.ok(secret);
    h.send([wallet], [revealSecretIx({ programId: PROGRAM_ID, group: circle.group, participant: wallet.publicKey, secret })]);
  }
}

function activate(h: Harness, circle: Circle, keeper: Keypair): void {
  revealAll(h, circle);
  h.send([keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group: circle.group })]);
  assert.equal(h.group(circle.group).status, "collateralizing");
  for (const wallet of circle.wallets) {
    h.send([wallet], [postCollateralIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: wallet.publicKey })]);
  }
  h.send([keeper], [activateGroupIx({ programId: PROGRAM_ID, group: circle.group })]);
  assert.equal(h.group(circle.group).status, "active");
}

function contribute(h: Harness, circle: Circle, wallet: Keypair): void {
  h.send([wallet], [contributeIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: wallet.publicKey })]);
}

function settle(h: Harness, circle: Circle, keeper: Keypair): PublicKey {
  const group = h.group(circle.group);
  const recipient = new PublicKey(group.payoutOrder[group.currentRound]);
  h.send([keeper], [
    createAtaIdempotentIx({ payer: keeper.publicKey, owner: recipient, mint: h.mint }),
    settleRoundIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, recipient, keeper: keeper.publicKey }),
  ]);
  return recipient;
}

function plan(h: Harness, circle: Circle, wallet: PublicKey | null, now: number) {
  const group = h.group(circle.group);
  const members = group.members.map((member) => h.member(circle.group, new PublicKey(member)));
  return planActions({
    group,
    members,
    config: { paused: false, totalPausedSeconds: BigInt(0) },
    wallet: wallet?.toBase58() ?? null,
    invite: null,
    now,
  });
}

test("three-member circle completes with one collateral-covered default and conserves every token", { skip: !programPath }, async () => {
  const h = harness();
  const keeper = Keypair.generate();
  h.airdrop(keeper.publicKey);
  const circle = await formCircle(h, 3);
  assert.equal(h.group(circle.group).status, "revealing");

  // A wrong secret is rejected (CommitmentMismatch = 6011).
  const [first] = circle.wallets;
  h.fail([first], [
    revealSecretIx({ programId: PROGRAM_ID, group: circle.group, participant: first.publicKey, secret: new Uint8Array(32).fill(5) }),
  ], 6011);

  assert.equal(plan(h, circle, first.publicKey, START).primary?.id, "reveal");
  activate(h, circle, keeper);

  const group = h.group(circle.group);
  const ranked = group.payoutOrder.map((address) => circle.wallets.find((wallet) => wallet.publicKey.toBase58() === address)!);
  ranked.forEach((wallet, rank) => {
    assert.equal(h.member(circle.group, wallet.publicKey).collateralLocked, collateralRequired(3, rank, CONTRIBUTION));
  });
  assert.equal(h.vault(collateralVaultPda(PROGRAM_ID, circle.group)), CONTRIBUTION * BigInt(3));

  // Round 0: everyone pays; double payment and early settlement are rejected.
  contribute(h, circle, ranked[0]);
  h.fail([ranked[0]], [contributeIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: ranked[0].publicKey })], 6019);
  h.fail([keeper], [settleRoundIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, recipient: ranked[0].publicKey, keeper: keeper.publicKey })], 6024);
  contribute(h, circle, ranked[1]);
  contribute(h, circle, ranked[2]);
  assert.equal(plan(h, circle, keeper.publicKey, START).primary?.id, "settle");
  // Only the ranked recipient can be paid (WrongRecipient = 6025).
  h.fail([keeper], [settleRoundIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, recipient: ranked[1].publicKey, keeper: keeper.publicKey })], 6025);
  assert.ok(settle(h, circle, keeper).equals(ranked[0].publicKey));

  // Round 1: the early recipient skips; after grace their collateral covers it.
  const roundOneStart = h.group(circle.group).roundStartedAt;
  contribute(h, circle, ranked[1]);
  contribute(h, circle, ranked[2]);
  h.fail([keeper], [coverDefaultIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, memberWallet: ranked[0].publicKey, keeper: keeper.publicKey })], 6021);
  h.setTime(roundOneStart + 8 * DAY + 1);
  const afterGrace = plan(h, circle, keeper.publicKey, roundOneStart + 8 * DAY + 1);
  assert.ok([afterGrace.primary, ...afterGrace.secondary].some((action) => action?.id === "cover-default"));
  h.send([keeper], [coverDefaultIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, memberWallet: ranked[0].publicKey, keeper: keeper.publicKey })]);
  assert.equal(h.member(circle.group, ranked[0].publicKey).defaults, 1);
  assert.ok(settle(h, circle, keeper).equals(ranked[1].publicKey));

  // Round 2: the early recipient pays again and gets a collateral slice back.
  const beforeEarly = h.balance(ranked[0].publicKey);
  for (const wallet of ranked) contribute(h, circle, wallet);
  assert.equal(h.balance(ranked[0].publicKey), beforeEarly);
  assert.ok(settle(h, circle, keeper).equals(ranked[2].publicKey));

  const finalGroup = h.group(circle.group);
  assert.equal(finalGroup.status, "completed");
  assert.equal(finalGroup.totalCollateralLocked, BigInt(0));
  assert.equal(h.vault(potVaultPda(PROGRAM_ID, circle.group)), BigInt(0));
  assert.equal(h.vault(collateralVaultPda(PROGRAM_ID, circle.group)), BigInt(0));
  const total = ranked.reduce((sum, wallet) => sum + h.balance(wallet.publicKey), BigInt(0));
  assert.equal(total, STARTING_BALANCE * BigInt(3));
  for (const wallet of ranked) {
    const member = h.member(circle.group, wallet.publicKey);
    assert.equal(member.payoutReceived, true);
    assert.equal(member.collateralLocked, BigInt(0));
  }
  assert.equal(plan(h, circle, ranked[0].publicKey, START + 30 * DAY).primary, null);
});

test("creator can cancel a forming circle and an uninvited wallet cannot join", { skip: !programPath }, async () => {
  const h = harness();
  const creator = h.wallet();
  const stranger = h.wallet();
  const groupId = BigInt(7);
  const group = groupPda(PROGRAM_ID, creator.publicKey, groupId);
  h.send([creator], [
    createGroupIx({
      programId: PROGRAM_ID,
      creator: creator.publicKey,
      mint: h.mint,
      groupId,
      memberCount: 4,
      contributionAmount: CONTRIBUTION,
      periodSeconds: 7 * DAY,
      graceSeconds: DAY,
      joinDeadline: START + DAY,
      revealWindowSeconds: DAY,
      collateralWindowSeconds: DAY,
      creatorCommitment: await commitmentHash(group, creator.publicKey, randomBytes(32)),
    }),
  ]);
  // No invite PDA exists for the stranger (AccountNotInitialized = 3012).
  h.fail([stranger], [
    joinGroupIx({ programId: PROGRAM_ID, group, participant: stranger.publicKey, commitment: randomBytes(32) }),
  ], 3012);
  // Non-creators cannot cancel before the join deadline (CancellationNotAllowed = 6029).
  h.fail([stranger], [cancelGroupIx({ programId: PROGRAM_ID, group, caller: stranger.publicKey })], 6029);
  h.send([creator], [cancelGroupIx({ programId: PROGRAM_ID, group, caller: creator.publicKey })]);
  assert.equal(h.group(group).status, "cancelled");
});

test("a pre-payout default fails closed, refunds contributions, and refunds stay open while paused", { skip: !programPath }, async () => {
  const h = harness();
  const keeper = Keypair.generate();
  h.airdrop(keeper.publicKey);
  const circle = await formCircle(h, 2);
  activate(h, circle, keeper);
  const group = h.group(circle.group);
  const [firstRecipient, lastRecipient] = group.payoutOrder.map(
    (address) => circle.wallets.find((wallet) => wallet.publicKey.toBase58() === address)!,
  );

  // Only the first recipient pays; the last recipient (pre-payout) misses.
  contribute(h, circle, firstRecipient);
  h.setTime(group.roundStartedAt + 8 * DAY + 1);
  h.fail([keeper], [coverDefaultIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, memberWallet: lastRecipient.publicKey, keeper: keeper.publicKey })], 6022);
  h.send([keeper], [abortUncoveredRoundIx({ programId: PROGRAM_ID, group: circle.group, delinquentWallet: lastRecipient.publicKey, keeper: keeper.publicKey })]);
  assert.equal(h.group(circle.group).status, "defaulted");

  h.setPaused(true);
  // Collateral refunds wait for failed-round refunds (PendingRoundRefunds = 6028).
  h.fail([firstRecipient], [refundCollateralIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: firstRecipient.publicKey })], 6028);
  h.send([keeper], [
    refundFailedRoundIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, memberWallet: firstRecipient.publicKey, keeper: keeper.publicKey }),
  ]);
  h.send([firstRecipient], [refundCollateralIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: firstRecipient.publicKey })]);

  assert.equal(h.vault(potVaultPda(PROGRAM_ID, circle.group)), BigInt(0));
  assert.equal(h.vault(collateralVaultPda(PROGRAM_ID, circle.group)), BigInt(0));
  assert.equal(h.balance(firstRecipient.publicKey), STARTING_BALANCE);
  assert.equal(h.balance(lastRecipient.publicKey), STARTING_BALANCE);
});

test("paused protocol blocks contributions", { skip: !programPath }, async () => {
  const h = harness();
  const keeper = Keypair.generate();
  h.airdrop(keeper.publicKey);
  const circle = await formCircle(h, 2);
  activate(h, circle, keeper);
  h.setPaused(true);
  const [wallet] = circle.wallets;
  h.fail([wallet], [contributeIx({ programId: PROGRAM_ID, group: circle.group, mint: h.mint, participant: wallet.publicKey })], 6000);
});
