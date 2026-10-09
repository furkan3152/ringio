import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

import { commitmentHash } from "../src/lib/ringio/commitment";
import { INSTRUCTION_DISCRIMINATORS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/lib/ringio/constants";
import {
  abortUncoveredRoundIx,
  activateGroupIx,
  cancelGroupIx,
  contributeIx,
  coverDefaultIx,
  createAtaIdempotentIx,
  createGroupIx,
  finalizeOrderIx,
  initializeConfigIx,
  inviteMemberIx,
  joinGroupIx,
  postCollateralIx,
  refundCollateralIx,
  refundFailedRoundIx,
  revealSecretIx,
  settleRoundIx,
} from "../src/lib/ringio/instructions";
import {
  associatedTokenAddress,
  collateralVaultPda,
  configPda,
  groupPda,
  invitePda,
  memberPda,
  potVaultPda,
} from "../src/lib/ringio/pda";
import {
  ANCHOR_REFERENCE_PROGRAM,
  createHarness,
  DAY,
  LOCAL_PROGRAM,
  mintData,
  PROGRAM_ID,
  START,
  tokenAccountData,
  type Harness,
  type Outcome,
} from "./harness";

/**
 * Differential test: every transaction runs against both the original Anchor
 * bytecode (see `ANCHOR_REFERENCE_PROGRAM`) and the Pinocchio rewrite built
 * from this repository (`cargo build-sbf`). Success/failure, error codes, emitted events, and the bytes of
 * every watched account must match after every step. Many steps are
 * deliberately adversarial (wrong signer, substituted accounts, forged
 * accounts, replays) and must fail identically on both programs.
 */

const enabled = Boolean(LOCAL_PROGRAM && ANCHOR_REFERENCE_PROGRAM);
if (!enabled) {
  console.warn("Skipping differential suite: needs target/deploy/ringio.so and the Anchor reference binary.");
}
const CONTRIBUTION = BigInt(10_000_000);

type Expect = "ok" | number;

class Twin {
  readonly watched = new Map<string, PublicKey>();
  readonly old: Harness;
  readonly next: Harness;

  constructor(options: { withConfig?: boolean } = {}) {
    const admin = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    this.old = createHarness(ANCHOR_REFERENCE_PROGRAM!, { admin, mint, withConfig: options.withConfig });
    this.next = createHarness(LOCAL_PROGRAM!, { admin, mint, withConfig: options.withConfig });
    this.watch(configPda(PROGRAM_ID), mint);
  }

  get mint() {
    return this.old.mint;
  }

  get admin() {
    return this.old.admin;
  }

  both(action: (h: Harness) => void) {
    action(this.old);
    action(this.next);
  }

  watch(...keys: PublicKey[]) {
    for (const key of keys) this.watched.set(key.toBase58(), key);
  }

  fund(keypair: Keypair) {
    this.both((h) => h.fund(keypair));
    this.watch(associatedTokenAddress(keypair.publicKey, this.mint));
  }

  wallet() {
    const keypair = Keypair.generate();
    this.fund(keypair);
    return keypair;
  }

  setTime(unix: number) {
    this.both((h) => h.setTime(unix));
  }

  step(name: string, signers: Keypair[], instructions: TransactionInstruction[], expect: Expect, feePayer?: Keypair): Outcome {
    const before = this.old.now();
    const a = this.old.run(signers, instructions, feePayer);
    const b = this.next.run(signers, instructions, feePayer);
    assert.equal(this.next.now(), before);
    const context = `${name}\n--- anchor ---\n${a.logs.join("\n")}\n--- pinocchio ---\n${b.logs.join("\n")}`;
    assert.equal(b.ok, a.ok, `success differs: ${context}`);
    assert.equal(b.code, a.code, `error code differs: ${context}`);
    if (expect === "ok") assert.ok(a.ok, `expected success: ${context}`);
    else assert.equal(a.code, expect, `unexpected code: ${context}`);
    const events = (logs: string[]) => logs.filter((line) => line.startsWith("Program data: "));
    assert.deepEqual(events(b.logs), events(a.logs), `events differ: ${name}`);
    this.compare(name);
    return b;
  }

  compare(label: string) {
    for (const [name, key] of this.watched) {
      const a = this.old.read(key);
      const b = this.next.read(key);
      assert.equal(Boolean(b), Boolean(a), `${label}: existence of ${name} differs`);
      if (!a || !b) continue;
      assert.equal(b.owner, a.owner, `${label}: owner of ${name} differs`);
      assert.equal(b.lamports, a.lamports, `${label}: lamports of ${name} differ`);
      assert.deepEqual(Buffer.from(b.data), Buffer.from(a.data), `${label}: data of ${name} differs`);
    }
  }
}

function raw(data: number[] | Uint8Array, keys: [PublicKey, boolean, boolean][]): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.from(data),
  });
}

function withMeta(ix: TransactionInstruction, index: number, patch: Partial<AccountMeta>): TransactionInstruction {
  const keys = ix.keys.map((key, position) => (position === index ? { ...key, ...patch } : key));
  return new TransactionInstruction({ programId: ix.programId, keys, data: ix.data });
}

function setPausedIx(authority: PublicKey, paused: boolean) {
  return raw([...INSTRUCTION_DISCRIMINATORS_EXTRA.setPaused, paused ? 1 : 0], [
    [configPda(PROGRAM_ID), false, true],
    [authority, true, false],
  ]);
}

function updatePauseAuthorityIx(admin: PublicKey, next: PublicKey) {
  return raw([...INSTRUCTION_DISCRIMINATORS_EXTRA.updatePauseAuthority, ...next.toBytes()], [
    [configPda(PROGRAM_ID), false, true],
    [admin, true, false],
  ]);
}

const INSTRUCTION_DISCRIMINATORS_EXTRA = {
  setPaused: [91, 60, 125, 192, 176, 225, 166, 218],
  updatePauseAuthority: [79, 153, 171, 110, 33, 64, 245, 76],
};

/** The client refuses all-zero commitments; patch the encoded bytes to reach the on-chain check. */
function zeroCommitment(ix: TransactionInstruction): TransactionInstruction {
  ix.data.fill(0, ix.data.length - 32);
  return ix;
}

type Circle = { group: PublicKey; id: bigint; creator: Keypair; secrets: Map<string, Buffer> };

async function createCircle(
  twin: Twin,
  creator: Keypair,
  size: number,
  options: { id?: bigint; period?: number; grace?: number; expect?: Expect; zeroCommitment?: boolean } = {},
): Promise<Circle> {
  const id = options.id ?? BigInt(1_000 + Math.floor(Math.random() * 1_000_000));
  const group = groupPda(PROGRAM_ID, creator.publicKey, id);
  const secret = randomBytes(32);
  const ix = createGroupIx({
    programId: PROGRAM_ID,
    creator: creator.publicKey,
    mint: twin.mint,
    groupId: id,
    memberCount: size,
    contributionAmount: CONTRIBUTION,
    periodSeconds: options.period ?? 7 * DAY,
    graceSeconds: options.grace ?? DAY,
    joinDeadline: START + 3 * DAY,
    revealWindowSeconds: 2 * DAY,
    collateralWindowSeconds: 2 * DAY,
    creatorCommitment: await commitmentHash(group, creator.publicKey, secret),
  });
  if (options.zeroCommitment) zeroCommitment(ix);
  twin.watch(group, memberPda(PROGRAM_ID, group, creator.publicKey), potVaultPda(PROGRAM_ID, group), collateralVaultPda(PROGRAM_ID, group));
  twin.step(`create_group ${id}`, [creator], [ix], options.expect ?? "ok");
  return { group, id, creator, secrets: new Map([[creator.publicKey.toBase58(), secret]]) };
}

async function joinCircle(twin: Twin, circle: Circle, wallet: Keypair) {
  twin.watch(invitePda(PROGRAM_ID, circle.group, wallet.publicKey), memberPda(PROGRAM_ID, circle.group, wallet.publicKey));
  twin.step("invite", [circle.creator], [inviteMemberIx({ programId: PROGRAM_ID, group: circle.group, creator: circle.creator.publicKey, invitee: wallet.publicKey })], "ok");
  const secret = randomBytes(32);
  circle.secrets.set(wallet.publicKey.toBase58(), secret);
  twin.step(
    "join",
    [wallet],
    [joinGroupIx({ programId: PROGRAM_ID, group: circle.group, participant: wallet.publicKey, commitment: await commitmentHash(circle.group, wallet.publicKey, secret) })],
    "ok",
  );
}

function refs(twin: Twin, circle: Circle) {
  return { programId: PROGRAM_ID, group: circle.group, mint: twin.mint };
}

test("Pinocchio rewrite matches the Anchor program across a full adversarial lifecycle", { skip: !enabled }, async () => {
  const twin = new Twin();
  const [alice, bob, carol, dave, keeper] = [twin.wallet(), twin.wallet(), twin.wallet(), twin.wallet(), twin.wallet()];

  // --- creation -------------------------------------------------------------
  await createCircle(twin, alice, 3, { zeroCommitment: true, expect: 6010, id: BigInt(77) });
  const circle = await createCircle(twin, alice, 3, { id: BigInt(77) });
  await createCircle(twin, alice, 3, { id: BigInt(77), expect: 0 }); // already in use
  await createCircle(twin, alice, 40, { expect: 6003 });
  const { group } = circle;
  const R = refs(twin, circle);

  // --- invitations and joining ---------------------------------------------
  twin.step("stranger invites", [dave], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: dave.publicKey, invitee: bob.publicKey })], 6001);
  twin.step("invite creator", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: alice.publicKey })], 6009);
  twin.step("join without invite", [dave], [joinGroupIx({ programId: PROGRAM_ID, group, participant: dave.publicKey, commitment: randomBytes(32) })], 3012);
  twin.watch(invitePda(PROGRAM_ID, group, bob.publicKey), memberPda(PROGRAM_ID, group, bob.publicKey));
  twin.step("invite bob", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: bob.publicKey })], "ok");
  twin.step("invite bob twice", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: bob.publicKey })], 0);
  twin.step("bob zero commitment", [bob], [zeroCommitment(joinGroupIx({ programId: PROGRAM_ID, group, participant: bob.publicKey, commitment: randomBytes(32) }))], 6010);
  const bobSecret = randomBytes(32);
  circle.secrets.set(bob.publicKey.toBase58(), bobSecret);
  const bobJoin = joinGroupIx({ programId: PROGRAM_ID, group, participant: bob.publicKey, commitment: await commitmentHash(group, bob.publicKey, bobSecret) });
  twin.step("bob joins", [bob], [bobJoin], "ok");
  twin.step("bob joins twice", [bob], [bobJoin], 0);
  twin.step("reveal before full", [alice], [revealSecretIx({ programId: PROGRAM_ID, group, participant: alice.publicKey, secret: circle.secrets.get(alice.publicKey.toBase58())! })], 6002);
  await joinCircle(twin, circle, carol);
  assert.equal(twin.next.group(group).status, "revealing");

  // --- reveal and order -------------------------------------------------------
  twin.step("wrong secret", [alice], [revealSecretIx({ programId: PROGRAM_ID, group, participant: alice.publicKey, secret: new Uint8Array(32).fill(3) })], 6011);
  twin.step(
    "reveal someone else's member",
    [dave],
    [withMeta(revealSecretIx({ programId: PROGRAM_ID, group, participant: dave.publicKey, secret: new Uint8Array(32).fill(3) }), 2, { pubkey: memberPda(PROGRAM_ID, group, alice.publicKey) })],
    2006,
  );
  twin.step("finalize too early", [keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group })], 6013);
  for (const wallet of [alice, bob, carol]) {
    const secret = circle.secrets.get(wallet.publicKey.toBase58())!;
    twin.step("reveal", [wallet], [revealSecretIx({ programId: PROGRAM_ID, group, participant: wallet.publicKey, secret })], "ok");
  }
  twin.step("reveal twice", [bob], [revealSecretIx({ programId: PROGRAM_ID, group, participant: bob.publicKey, secret: bobSecret })], 6012);
  twin.step("finalize", [keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group })], "ok");
  twin.step("finalize twice", [keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group })], 6002);

  const order = twin.next.group(group).payoutOrder.map((key) => [alice, bob, carol].find((wallet) => wallet.publicKey.toBase58() === key)!);
  assert.deepEqual(twin.next.group(group).payoutOrder, twin.old.group(group).payoutOrder);

  // --- protection -------------------------------------------------------------
  const attackerVault = Keypair.generate().publicKey;
  twin.both((h) => h.put(attackerVault, TOKEN_PROGRAM_ID, tokenAccountData(twin.mint, dave.publicKey, BigInt(5))));
  const otherMint = Keypair.generate().publicKey;
  twin.both((h) => h.put(otherMint, TOKEN_PROGRAM_ID, mintData(dave.publicKey)));
  const first = order[0];
  const post = postCollateralIx({ ...R, participant: first.publicKey });
  twin.step("collateral from someone else's account", [first], [withMeta(post, 3, { pubkey: associatedTokenAddress(dave.publicKey, twin.mint) })], 6031);
  twin.step("collateral into attacker vault", [first], [withMeta(post, 4, { pubkey: attackerVault })], 6032);
  twin.step("collateral with another mint", [first], [withMeta(post, 5, { pubkey: otherMint })], 6030);
  twin.step("collateral with fake token program", [first], [withMeta(post, 7, { pubkey: SystemProgram.programId })], 3008);
  twin.step("activate too early", [keeper], [activateGroupIx({ programId: PROGRAM_ID, group })], 6017);
  for (const wallet of order) twin.step("post collateral", [wallet], [postCollateralIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step("post twice", [first], [post], 6016);
  twin.step("activate", [keeper], [activateGroupIx({ programId: PROGRAM_ID, group })], "ok");

  // --- round 1 ----------------------------------------------------------------
  twin.step("stranger contributes", [dave], [contributeIx({ ...R, participant: dave.publicKey })], 3012);
  const contribution = contributeIx({ ...R, participant: first.publicKey });
  twin.step("contribution without signature", [keeper], [withMeta(contribution, 7, { isSigner: false })], 3010, keeper);
  twin.step("contribute", [first], [contribution], "ok");
  twin.step("contribute twice", [first], [contribution], 6019);
  const settleFor = (recipient: Keypair) => [
    createAtaIdempotentIx({ payer: keeper.publicKey, owner: recipient.publicKey, mint: twin.mint }),
    settleRoundIx({ ...R, recipient: recipient.publicKey, keeper: keeper.publicKey }),
  ];
  twin.step("settle early", [keeper], settleFor(first), 6024);
  for (const wallet of order.slice(1)) twin.step("contribute", [wallet], [contributeIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step("settle to wrong recipient", [keeper], settleFor(order[1]), 6025);
  twin.step(
    "settle into someone else's token account",
    [keeper],
    [withMeta(settleRoundIx({ ...R, recipient: first.publicKey, keeper: keeper.publicKey }), 4, { pubkey: associatedTokenAddress(dave.publicKey, twin.mint) })],
    6031,
  );
  twin.step("settle", [keeper], settleFor(first), "ok");
  twin.step("settle replay", [keeper], settleFor(first), 6024);

  // --- round 2: the paid-out member skips --------------------------------------
  const started = twin.next.group(group).roundStartedAt;
  for (const wallet of order.slice(1)) twin.step("contribute r2", [wallet], [contributeIx({ ...R, participant: wallet.publicKey })], "ok");
  const cover = coverDefaultIx({ ...R, memberWallet: first.publicKey, keeper: keeper.publicKey });
  twin.step("cover before grace", [keeper], [cover], 6021);
  twin.step("abort before grace", [keeper], [abortUncoveredRoundIx({ programId: PROGRAM_ID, group, delinquentWallet: first.publicKey, keeper: keeper.publicKey })], 6021);
  twin.setTime(started + 8 * DAY + 1);
  twin.step("late contribution", [first], [contributeIx({ ...R, participant: first.publicKey })], 6020);
  twin.step("abort a coverable default", [keeper], [abortUncoveredRoundIx({ programId: PROGRAM_ID, group, delinquentWallet: first.publicKey, keeper: keeper.publicKey })], 6023);
  twin.step("cover a member who paid", [keeper], [coverDefaultIx({ ...R, memberWallet: order[1].publicKey, keeper: keeper.publicKey })], 6019);
  twin.step("cover", [keeper], [cover], "ok");
  twin.step("cover twice", [keeper], [cover], 6019);
  twin.step("settle r2", [keeper], settleFor(order[1]), "ok");

  // --- round 3 and completion ---------------------------------------------------
  for (const wallet of order) twin.step("contribute r3", [wallet], [contributeIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step("settle r3", [keeper], settleFor(order[2]), "ok");
  assert.equal(twin.next.group(group).status, "completed");
  twin.step("nothing to refund", [first], [refundCollateralIx({ ...R, participant: first.publicKey })], 6027);
  twin.step("cancel completed", [alice], [cancelGroupIx({ programId: PROGRAM_ID, group, caller: alice.publicKey })], 6029);
});

test("Pinocchio rewrite matches Anchor on cancellation, defaults, refunds, pause, and forged accounts", { skip: !enabled }, async () => {
  const twin = new Twin();
  const [alice, bob, dave, keeper] = [twin.wallet(), twin.wallet(), twin.wallet(), twin.wallet()];

  // Pre-funding the future Group PDA must not block creation.
  const id = BigInt(4242);
  const futureGroup = groupPda(PROGRAM_ID, alice.publicKey, id);
  twin.watch(futureGroup);
  twin.step("prefund group pda", [dave], [SystemProgram.transfer({ fromPubkey: dave.publicKey, toPubkey: futureGroup, lamports: 5_000_000 })], "ok");
  const circle = await createCircle(twin, alice, 2, { id });
  const { group } = circle;
  const R = refs(twin, circle);

  // Forged Group accounts: right bytes at a non-PDA address, or owned by another program.
  const forged = Keypair.generate().publicKey;
  const groupBytes = twin.next.read(group)!.data;
  twin.both((h) => h.put(forged, PROGRAM_ID, groupBytes));
  twin.step("forged group pda", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group: forged, creator: alice.publicKey, invitee: bob.publicKey })], 2006);
  const foreign = Keypair.generate().publicKey;
  twin.both((h) => h.put(foreign, SystemProgram.programId, groupBytes));
  twin.step("foreign-owned group", [alice], [cancelGroupIx({ programId: PROGRAM_ID, group: foreign, caller: alice.publicKey })], 3007);

  // Token-2022 mints are rejected.
  const mint2022 = Keypair.generate().publicKey;
  twin.both((h) => h.put(mint2022, TOKEN_2022_PROGRAM_ID, mintData(alice.publicKey)));
  const badMint = createGroupIx({
    programId: PROGRAM_ID,
    creator: alice.publicKey,
    mint: mint2022,
    groupId: BigInt(9),
    memberCount: 2,
    contributionAmount: CONTRIBUTION,
    periodSeconds: DAY,
    graceSeconds: DAY,
    joinDeadline: START + DAY,
    revealWindowSeconds: DAY,
    collateralWindowSeconds: DAY,
    creatorCommitment: new Uint8Array(32).fill(1),
  });
  const badMintOutcome = { old: twin.old.run([alice], [badMint]), next: twin.next.run([alice], [badMint]) };
  assert.equal(badMintOutcome.old.ok, false);
  assert.equal(badMintOutcome.next.ok, false);
  twin.compare("token-2022 mint");

  // Non-creator cannot cancel before the deadline; creator can.
  twin.step("stranger cancels", [dave], [cancelGroupIx({ programId: PROGRAM_ID, group, caller: dave.publicKey })], 6029);

  // Second circle runs to a pre-payout default with refunds.
  await joinCircle(twin, circle, bob);
  for (const wallet of [alice, bob]) {
    twin.step("reveal", [wallet], [revealSecretIx({ programId: PROGRAM_ID, group, participant: wallet.publicKey, secret: circle.secrets.get(wallet.publicKey.toBase58())! })], "ok");
  }
  twin.step("finalize", [keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group })], "ok");
  for (const wallet of [alice, bob]) twin.step("collateral", [wallet], [postCollateralIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step("activate", [keeper], [activateGroupIx({ programId: PROGRAM_ID, group })], "ok");
  const order = twin.next.group(group).payoutOrder.map((key) => [alice, bob].find((wallet) => wallet.publicKey.toBase58() === key)!);
  twin.step("first pays", [order[0]], [contributeIx({ ...R, participant: order[0].publicKey })], "ok");
  twin.setTime(twin.next.group(group).roundStartedAt + 8 * DAY + 1);
  twin.step("cover uncoverable", [keeper], [coverDefaultIx({ ...R, memberWallet: order[1].publicKey, keeper: keeper.publicKey })], 6022);
  twin.step("abort", [keeper], [abortUncoveredRoundIx({ programId: PROGRAM_ID, group, delinquentWallet: order[1].publicKey, keeper: keeper.publicKey })], "ok");

  // Pause through the real instruction: progress stops, refunds continue.
  const admin = twin.admin;
  twin.both((h) => h.airdrop(admin.publicKey));
  twin.step("stranger pauses", [dave], [setPausedIx(dave.publicKey, true)], 6001);
  twin.step("pause", [admin], [setPausedIx(admin.publicKey, true)], "ok");
  twin.step("pause twice is a no-op", [admin], [setPausedIx(admin.publicKey, true)], "ok");
  await createCircle(twin, dave, 2, { expect: 6000 });
  twin.step("collateral refund waits for round refunds", [order[0]], [refundCollateralIx({ ...R, participant: order[0].publicKey })], 6028);
  twin.step(
    "refund failed round",
    [keeper],
    [
      createAtaIdempotentIx({ payer: keeper.publicKey, owner: order[0].publicKey, mint: twin.mint }),
      refundFailedRoundIx({ ...R, memberWallet: order[0].publicKey, keeper: keeper.publicKey }),
    ],
    "ok",
  );
  twin.step("refund failed round twice", [keeper], [refundFailedRoundIx({ ...R, memberWallet: order[0].publicKey, keeper: keeper.publicKey })], 6027);
  twin.step("refund collateral", [order[0]], [refundCollateralIx({ ...R, participant: order[0].publicKey })], "ok");
  twin.step("refund collateral twice", [order[0]], [refundCollateralIx({ ...R, participant: order[0].publicKey })], 6027);
  twin.step("unpause", [admin], [setPausedIx(admin.publicKey, false)], "ok");

  // Pause authority rotation.
  twin.step("stranger rotates", [dave], [updatePauseAuthorityIx(dave.publicKey, keeper.publicKey)], 6001);
  twin.step("rotate to default key", [admin], [updatePauseAuthorityIx(admin.publicKey, PublicKey.default)], 6001);
  twin.step("rotate", [admin], [updatePauseAuthorityIx(admin.publicKey, keeper.publicKey)], "ok");
  twin.step("old authority cannot pause", [admin], [setPausedIx(admin.publicKey, true)], 6001);
  twin.step("new authority pauses", [keeper], [setPausedIx(keeper.publicKey, true)], "ok");
});

test("Pinocchio rewrite matches Anchor on config initialization", { skip: !enabled }, async () => {
  const twin = new Twin({ withConfig: false });
  const admin = twin.admin;
  const dave = twin.wallet();
  twin.both((h) => h.airdrop(admin.publicKey));
  twin.both((h) => h.setUpgradeAuthority(admin.publicKey));
  const init = (signer: Keypair, pause: PublicKey) => initializeConfigIx({ programId: PROGRAM_ID, admin: signer.publicKey, pauseAuthority: pause });

  twin.step("non-authority initializes", [dave], [init(dave, dave.publicKey)], 6001);
  twin.step("default pause authority", [admin], [init(admin, PublicKey.default)], 6001);
  twin.step("initialize", [admin], [init(admin, dave.publicKey)], "ok");
  twin.step("initialize twice", [admin], [init(admin, dave.publicKey)], 0);
  twin.both((h) => h.setUpgradeAuthority(null));
});

test("Pinocchio rewrite matches Anchor on instruction decoding and repeated submissions", { skip: !enabled }, async () => {
  const twin = new Twin();
  const [alice, bob, dave] = [twin.wallet(), twin.wallet(), twin.wallet()];
  const admin = twin.admin;
  twin.both((h) => h.airdrop(admin.publicKey));
  const config: [PublicKey, boolean, boolean] = [configPda(PROGRAM_ID), false, true];
  const signer = (key: PublicKey): [PublicKey, boolean, boolean] => [key, true, false];
  const withData = (ix: TransactionInstruction, data: Uint8Array) =>
    new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: Buffer.from(data) });

  // Dispatcher: short, empty, and unknown discriminators.
  twin.step("empty data", [alice], [raw([], [])], 101);
  twin.step("short discriminator", [alice], [raw([91, 60, 125, 192, 176, 225, 166], [config, signer(alice.publicKey)])], 101);
  twin.step("unknown discriminator", [alice], [raw([1, 2, 3, 4, 5, 6, 7, 8], [config])], 101);

  // Argument decoding: Borsh bools, missing bytes, and ignored trailing bytes.
  const pause = INSTRUCTION_DISCRIMINATORS_EXTRA.setPaused;
  twin.step("bool out of range", [admin], [raw([...pause, 2], [config, signer(admin.publicKey)])], 102);
  twin.step("missing argument", [admin], [raw(pause, [config, signer(admin.publicKey)])], 102);
  twin.step("trailing bytes are ignored", [admin], [raw([...pause, 1, 9, 9], [config, signer(admin.publicKey)])], "ok");
  twin.step("unpause", [admin], [setPausedIx(admin.publicKey, false)], "ok");
  twin.step("not enough accounts", [admin], [raw([...pause, 1], [config])], 3005);
  twin.step("no accounts", [alice], [raw(INSTRUCTION_DISCRIMINATORS.finalizeOrder, [])], 3005);

  const circle = await createCircle(twin, alice, 3, { id: BigInt(5) });
  const { group } = circle;
  twin.step("no-arg instruction with trailing bytes", [alice], [withData(finalizeOrderIx({ programId: PROGRAM_ID, group }), Uint8Array.from([...INSTRUCTION_DISCRIMINATORS.finalizeOrder, 7]))], 6002);
  twin.step("truncated pubkey argument", [alice], [withData(inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: bob.publicKey }), Uint8Array.from([...INSTRUCTION_DISCRIMINATORS.inviteMember, 1, 2, 3]))], 102);

  // Re-submitting an `init` instruction fails on the existing account first.
  await joinCircle(twin, circle, bob);
  twin.step("invite a member who already joined", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: bob.publicKey })], 0);
  twin.step("stranger re-invites a joined member", [dave], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: dave.publicKey, invitee: bob.publicKey })], 0);
  const join = joinGroupIx({ programId: PROGRAM_ID, group, participant: bob.publicKey, commitment: randomBytes(32) });
  twin.step("join again with a new commitment", [bob], [join], 0);
  twin.step("pause", [admin], [setPausedIx(admin.publicKey, true)], "ok");
  await createCircle(twin, alice, 3, { id: BigInt(5), expect: 0 });
  await createCircle(twin, alice, 3, { id: BigInt(6), expect: 6000 });
  twin.step("invite while paused", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: dave.publicKey })], 6000);
  twin.step("unpause again", [admin], [setPausedIx(admin.publicKey, false)], "ok");

  // Joining with trailing bytes after the commitment behaves like a normal join.
  const carol = twin.wallet();
  twin.watch(invitePda(PROGRAM_ID, group, carol.publicKey), memberPda(PROGRAM_ID, group, carol.publicKey));
  twin.step("invite carol", [alice], [inviteMemberIx({ programId: PROGRAM_ID, group, creator: alice.publicKey, invitee: carol.publicKey })], "ok");
  const carolJoin = joinGroupIx({ programId: PROGRAM_ID, group, participant: carol.publicKey, commitment: randomBytes(32) });
  twin.step("join with trailing bytes", [carol], [withData(carolJoin, Uint8Array.from([...carolJoin.data, 0xff]))], "ok");
  assert.equal(twin.next.group(group).status, "revealing");
});

test("Pinocchio rewrite matches Anchor on a maximum-size 32-member circle", { skip: !enabled }, async () => {
  const twin = new Twin();
  const keeper = twin.wallet();
  const creator = twin.wallet();
  const circle = await createCircle(twin, creator, 32, { id: BigInt(32) });
  const { group } = circle;
  const R = refs(twin, circle);
  const wallets = [creator];
  for (let index = 1; index < 32; index += 1) {
    const wallet = twin.wallet();
    await joinCircle(twin, circle, wallet);
    wallets.push(wallet);
  }
  assert.equal(twin.next.group(group).status, "revealing");
  for (const wallet of wallets) {
    const secret = circle.secrets.get(wallet.publicKey.toBase58())!;
    twin.step("reveal", [wallet], [revealSecretIx({ programId: PROGRAM_ID, group, participant: wallet.publicKey, secret })], "ok");
  }
  const finalize = twin.step("finalize 32", [keeper], [finalizeOrderIx({ programId: PROGRAM_ID, group })], "ok");
  const consumed = (logs: string[]) => Number(logs.join("\n").match(/consumed (\d+) of/)?.[1] ?? NaN);
  const finalizeUnits = consumed(finalize.logs);
  assert.ok(finalizeUnits < 200_000, `finalize_order used ${finalizeUnits} compute units`);
  console.log(`finalize_order with 32 members: ${finalizeUnits} compute units`);

  const byKey = new Map(wallets.map((wallet) => [wallet.publicKey.toBase58(), wallet]));
  const order = twin.next.group(group).payoutOrder.map((key) => byKey.get(key)!);
  assert.deepEqual(twin.next.group(group).payoutOrder, twin.old.group(group).payoutOrder);
  for (const wallet of order) twin.step("post collateral", [wallet], [postCollateralIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step("activate", [keeper], [activateGroupIx({ programId: PROGRAM_ID, group })], "ok");
  for (const wallet of order) twin.step("contribute", [wallet], [contributeIx({ ...R, participant: wallet.publicKey })], "ok");
  twin.step(
    "settle",
    [keeper],
    [
      createAtaIdempotentIx({ payer: keeper.publicKey, owner: order[0].publicKey, mint: twin.mint }),
      settleRoundIx({ ...R, recipient: order[0].publicKey, keeper: keeper.publicKey }),
    ],
    "ok",
  );
  assert.equal(twin.next.group(group).currentRound, 1);
});
