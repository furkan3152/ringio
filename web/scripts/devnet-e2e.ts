import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  abortUncoveredRoundIx,
  activateGroupIx,
  cancelGroupIx,
  contributeIx,
  coverDefaultIx,
  createGroupIx,
  finalizeOrderIx,
  inviteMemberIx,
  joinGroupIx,
  postCollateralIx,
  refundCollateralIx,
  revealSecretIx,
  settleRoundIx,
} from "../src/lib/ringio/instructions";

const PROGRAM_ID = new PublicKey("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const COMMITMENT_DOMAIN = Buffer.from("ringio-commitment-v1");
const GROUP_ACCOUNT_SIZE = 2_387;
const MEMBER_ACCOUNT_SIZE = 190;
const CONTRIBUTION_RAW = BigInt(1_000_000);
const MEMBER_COUNT = 2;
// Public devnet RPC throttling can delay a confirmed transaction by tens of seconds.
// Keep the round window short enough for CI while long enough for real signed CPIs.
const PERIOD_SECONDS = 90;
const GRACE_SECONDS = 15;
const PHASE_WINDOW_SECONDS = 3_600;
const STATUS_NAMES = ["forming", "revealing", "collateralizing", "active", "completed", "cancelled", "defaulted"] as const;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

type Phase = "prepare" | "complete" | "all" | "cancel" | "cleanup";

type E2EState = {
  version: 1;
  groupId: string;
  group: string;
  creatorSecretHex: string;
  participantSecretHex: string;
  startingCombinedRaw?: string;
  expectedEarlyCoverRejected?: boolean;
  signatures: Record<string, string>;
};

type GroupState = {
  address: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  potVault: PublicKey;
  collateralVault: PublicKey;
  members: PublicKey[];
  payoutOrder: PublicKey[];
  id: bigint;
  contributionAmount: bigint;
  totalCollateralLocked: bigint;
  periodSeconds: bigint;
  graceSeconds: bigint;
  roundStartedAt: bigint;
  memberCount: number;
  joinedCount: number;
  revealedCount: number;
  collateralizedCount: number;
  currentRound: number;
  roundContributions: number;
  statusIndex: number;
  status: (typeof STATUS_NAMES)[number];
};

type MemberState = {
  address: PublicKey;
  wallet: PublicKey;
  collateralLocked: bigint;
  payoutRank: number;
  lastContributedRound: number;
  defaults: number;
  revealed: boolean;
  collateralPosted: boolean;
  payoutReceived: boolean;
  lastResolutionKind: number;
};

/** Fee payer and connection shared by every submitted transaction. */
type Sender = { connection: Connection; payer: Keypair };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required option ${name}`);
  return value;
}

function parsePhase(): Phase {
  const value = option("--phase") ?? "all";
  if (value !== "prepare" && value !== "complete" && value !== "all" && value !== "cancel" && value !== "cleanup") {
    throw new Error("--phase must be prepare, complete, all, cancel, or cleanup");
  }
  return value;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const candidate = error as Error & {
    logs?: unknown;
    error?: unknown;
    transactionMessage?: unknown;
    simulationResponse?: unknown;
  };
  return JSON.stringify({
    name: candidate.name,
    message: candidate.message || "(empty message)",
    stack: candidate.stack,
    logs: candidate.logs,
    cause: candidate.cause instanceof Error ? candidate.cause.message : candidate.cause,
    error: candidate.error,
    transactionMessage: candidate.transactionMessage,
    simulationResponse: candidate.simulationResponse,
  }, null, 2);
}

function assertOutsideRepository(path: string, label: string): void {
  const fromRepository = relative(repositoryRoot, path);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !resolve(path).startsWith("/tmp/"))) {
    throw new Error(`${label} must stay outside the repository`);
  }
}

function loadKeypair(path: string): Keypair {
  assertOutsideRepository(path, "Keypair");
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (bytes.length !== 64 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error(`Invalid keypair file ${path}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function writeState(path: string, state: E2EState): void {
  assertOutsideRepository(path, "State file");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function loadOrCreateState(path: string, creator: PublicKey): E2EState {
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as E2EState;
    if (
      parsed.version !== 1 ||
      !/^\d+$/.test(parsed.groupId) ||
      !/^[0-9a-f]{64}$/.test(parsed.creatorSecretHex) ||
      !/^[0-9a-f]{64}$/.test(parsed.participantSecretHex)
    ) {
      throw new Error("Invalid E2E state file");
    }
    return parsed;
  }

  const groupId = BigInt(Date.now());
  const [group] = PublicKey.findProgramAddressSync(
    [Buffer.from("group"), creator.toBuffer(), u64(groupId)],
    PROGRAM_ID,
  );
  const state: E2EState = {
    version: 1,
    groupId: groupId.toString(),
    group: group.toBase58(),
    creatorSecretHex: randomNonzeroSecret().toString("hex"),
    participantSecretHex: randomNonzeroSecret().toString("hex"),
    signatures: {},
  };
  writeState(path, state);
  return state;
}

function randomNonzeroSecret(): Buffer {
  let secret = randomBytes(32);
  while (secret.equals(Buffer.alloc(32))) secret = randomBytes(32);
  return secret;
}

function u64(value: bigint): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(value);
  return result;
}

function commitment(group: PublicKey, member: PublicKey, secret: Buffer): Uint8Array {
  return createHash("sha256")
    .update(COMMITMENT_DOMAIN)
    .update(group.toBuffer())
    .update(member.toBuffer())
    .update(secret)
    .digest();
}

function memberPda(group: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), group.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function associatedTokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function publicKeyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function decodeGroup(address: PublicKey, data: Buffer): GroupState {
  if (data.length !== GROUP_ACCOUNT_SIZE) throw new Error(`Invalid Group size ${data.length}`);
  const memberCount = data.readUInt16LE(2_328);
  const statusIndex = data.readUInt8(2_342);
  const status = STATUS_NAMES[statusIndex];
  if (!status || memberCount !== MEMBER_COUNT) throw new Error("Unexpected Group layout/state");
  return {
    address,
    creator: publicKeyAt(data, 8),
    mint: publicKeyAt(data, 40),
    potVault: publicKeyAt(data, 72),
    collateralVault: publicKeyAt(data, 104),
    members: Array.from({ length: memberCount }, (_, index) => publicKeyAt(data, 168 + index * 32)),
    payoutOrder: Array.from({ length: memberCount }, (_, index) => publicKeyAt(data, 1_192 + index * 32)),
    id: data.readBigUInt64LE(2_216),
    contributionAmount: data.readBigUInt64LE(2_224),
    totalCollateralLocked: data.readBigUInt64LE(2_232),
    periodSeconds: data.readBigInt64LE(2_240),
    graceSeconds: data.readBigInt64LE(2_248),
    roundStartedAt: data.readBigInt64LE(2_320),
    memberCount,
    joinedCount: data.readUInt16LE(2_330),
    revealedCount: data.readUInt16LE(2_332),
    collateralizedCount: data.readUInt16LE(2_334),
    currentRound: data.readUInt16LE(2_336),
    roundContributions: data.readUInt16LE(2_338),
    statusIndex,
    status,
  };
}

function decodeMember(address: PublicKey, data: Buffer): MemberState {
  if (data.length !== MEMBER_ACCOUNT_SIZE) throw new Error(`Invalid Member size ${data.length}`);
  return {
    address,
    wallet: publicKeyAt(data, 40),
    collateralLocked: data.readBigUInt64LE(136),
    payoutRank: data.readUInt16LE(146),
    lastContributedRound: data.readUInt16LE(148),
    defaults: data.readUInt16LE(152),
    revealed: data.readUInt8(154) === 1,
    collateralPosted: data.readUInt8(155) === 1,
    payoutReceived: data.readUInt8(156) === 1,
    lastResolutionKind: data.readUInt8(157),
  };
}

async function fetchGroup(connection: Connection, group: PublicKey): Promise<GroupState | null> {
  const account = await connection.getAccountInfo(group, "confirmed");
  return account ? decodeGroup(group, account.data) : null;
}

async function fetchMember(connection: Connection, address: PublicKey): Promise<MemberState> {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) throw new Error(`Missing Member ${address.toBase58()}`);
  return decodeMember(address, account.data);
}

async function tokenBalance(connection: Connection, address: PublicKey): Promise<bigint> {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length < 72) {
    throw new Error(`Missing classic SPL token account ${address.toBase58()}`);
  }
  return account.data.readBigUInt64LE(64);
}

async function waitForFinalized(connection: Connection, signature: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "finalized") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Transaction did not finalize in time: ${signature}`);
}

async function signedTransaction(
  sender: Sender,
  instruction: TransactionInstruction,
  signers: Keypair[],
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await sender.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: sender.payer.publicKey, blockhash, lastValidBlockHeight }).add(instruction);
  const extra = signers.filter((signer) => !signer.publicKey.equals(sender.payer.publicKey));
  transaction.sign(sender.payer, ...extra);
  return transaction;
}

async function simulate(sender: Sender, transaction: Transaction) {
  const result = await sender.connection.simulateTransaction(VersionedTransaction.deserialize(transaction.serialize()), {
    sigVerify: true,
    commitment: "confirmed",
  });
  return result.value;
}

async function simulateAndSend(
  sender: Sender,
  label: string,
  instruction: TransactionInstruction,
  signers: Keypair[],
  state: E2EState,
  statePath: string,
): Promise<string> {
  // Simulate the exact signed bytes first, then submit them with preflight.
  const transaction = await signedTransaction(sender, instruction, signers);
  const simulation = await simulate(sender, transaction);
  if (simulation.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.err)}\n${(simulation.logs ?? []).join("\n")}`);
  }
  const signature = await sender.connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await waitForFinalized(sender.connection, signature);
  state.signatures[label] = signature;
  writeState(statePath, state);
  console.log(`${label}: ${signature}`);
  return signature;
}

async function expectSimulationFailure(
  sender: Sender,
  label: string,
  instruction: TransactionInstruction,
  signers: Keypair[],
): Promise<void> {
  const simulation = await simulate(sender, await signedTransaction(sender, instruction, signers));
  if (!simulation.err) throw new Error(`${label} unexpectedly succeeded`);
  const details = `${JSON.stringify(simulation.err)}\n${(simulation.logs ?? []).join("\n")}`;
  if (!details.includes('"Custom":6021') && !details.includes("0x1785")) {
    throw new Error(`${label} failed for an unexpected reason: ${details}`);
  }
  console.log(`${label}: expected GracePeriodActive rejection`);
}

async function chainTimestamp(connection: Connection): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime === null) throw new Error("Devnet block time unavailable");
  return blockTime;
}

async function waitPastGrace(connection: Connection, group: PublicKey): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await fetchGroup(connection, group);
    if (!current) throw new Error("Group disappeared while waiting for grace");
    const threshold = Number(current.roundStartedAt + current.periodSeconds + current.graceSeconds);
    const remainingSeconds = threshold - (await chainTimestamp(connection)) + 1;
    if (remainingSeconds <= 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(remainingSeconds * 1_000, 10_000)));
  }
  throw new Error("Devnet grace window did not elapse in time");
}

async function main(): Promise<void> {
  const phase = parsePhase();
  const rpc = option("--rpc") ?? "https://api.devnet.solana.com";
  const deployerPath = resolve(requiredOption("--deployer"));
  const participantPath = resolve(requiredOption("--participant"));
  const keeperPath = resolve(requiredOption("--keeper"));
  const statePath = resolve(requiredOption("--state-file"));
  assertOutsideRepository(statePath, "State file");

  const deployer = loadKeypair(deployerPath);
  const participant = loadKeypair(participantPath);
  const keeper = loadKeypair(keeperPath);
  const state = loadOrCreateState(statePath, deployer.publicKey);
  const groupId = BigInt(state.groupId);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const [group] = PublicKey.findProgramAddressSync(
    [Buffer.from("group"), deployer.publicKey.toBuffer(), u64(groupId)],
    PROGRAM_ID,
  );
  if (state.group !== group.toBase58()) throw new Error("State file Group does not match its group id");
  const creatorMember = memberPda(group, deployer.publicKey);
  const participantMember = memberPda(group, participant.publicKey);
  const [invite] = PublicKey.findProgramAddressSync(
    [Buffer.from("invite"), group.toBuffer(), participant.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [potVault] = PublicKey.findProgramAddressSync([Buffer.from("pot-vault"), group.toBuffer()], PROGRAM_ID);
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral-vault"), group.toBuffer()],
    PROGRAM_ID,
  );
  const creatorAta = associatedTokenAddress(deployer.publicKey);
  const participantAta = associatedTokenAddress(participant.publicKey);
  const connection = new Connection(rpc, "confirmed");

  const sender: Sender = { connection, payer: deployer };
  const refs = { programId: PROGRAM_ID, group, mint: USDC_MINT };

  const configAccount = await connection.getAccountInfo(config, "confirmed");
  const mintAccount = await connection.getAccountInfo(USDC_MINT, "confirmed");
  if (!configAccount?.owner.equals(PROGRAM_ID)) throw new Error("GlobalConfig is missing or has the wrong owner");
  if (!mintAccount?.owner.equals(TOKEN_PROGRAM_ID) || mintAccount.data.readUInt8(44) !== 6) {
    throw new Error("Configured devnet USDC mint failed owner/decimal verification");
  }

  if (phase === "cancel") {
    const current = await fetchGroup(connection, group);
    if (!current) throw new Error("Cannot cancel a missing Group");
    if (current.status === "cancelled") {
      console.log(JSON.stringify({ phase: "cancelled", group: group.toBase58(), alreadyCancelled: true }, null, 2));
      return;
    }
    await simulateAndSend(
      sender,
      "cancelGroup",
      cancelGroupIx({ programId: PROGRAM_ID, group, caller: deployer.publicKey }),
      [],
      state,
      statePath,
    );
    const cancelled = await fetchGroup(connection, group);
    if (cancelled?.status !== "cancelled") throw new Error("Cancelled Group state was not confirmed");
    console.log(JSON.stringify({ phase: "cancelled", group: group.toBase58(), status: cancelled.status }, null, 2));
    return;
  }

  if (phase === "cleanup") {
    let current = await fetchGroup(connection, group);
    if (!current) throw new Error("Cannot clean up a missing Group");
    if (current.status === "active") {
      if (current.roundContributions !== 0) {
        throw new Error("Cleanup refuses an active group with pending direct contributions");
      }
      await waitPastGrace(connection, group);
      const delinquentWallet = current.members[0];
      await simulateAndSend(
        sender,
        "abortUncoveredRound",
        abortUncoveredRoundIx({ programId: PROGRAM_ID, group, delinquentWallet, keeper: keeper.publicKey }),
        [keeper],
        state,
        statePath,
      );
      current = await fetchGroup(connection, group);
    }
    if (current?.status !== "defaulted") {
      throw new Error(`Cleanup expected a defaulted Group, received ${current?.status ?? "missing"}`);
    }

    const refundableMembers = [
      { keypair: deployer, member: creatorMember, ata: creatorAta },
      { keypair: participant, member: participantMember, ata: participantAta },
    ];
    for (const actor of refundableMembers) {
      const memberState = await fetchMember(connection, actor.member);
      if (memberState.collateralLocked === BigInt(0)) continue;
      await simulateAndSend(
        sender,
        `refundCollateral-${actor.keypair.publicKey.equals(deployer.publicKey) ? "creator" : "participant"}`,
        refundCollateralIx({ ...refs, participant: actor.keypair.publicKey }),
        actor.keypair.publicKey.equals(deployer.publicKey) ? [] : [actor.keypair],
        state,
        statePath,
      );
    }
    const collateralBalance = await tokenBalance(connection, collateralVault);
    if (collateralBalance !== BigInt(0)) throw new Error("Cleanup left collateral in the Group vault");
    console.log(JSON.stringify({ phase: "cleaned-up", group: group.toBase58(), status: "defaulted" }, null, 2));
    return;
  }

  if (phase === "prepare" || phase === "all") {
    let current = await fetchGroup(connection, group);
    if (!current) {
      const now = Math.floor(Date.now() / 1_000);
      await simulateAndSend(
        sender,
        "createGroup",
        createGroupIx({
          programId: PROGRAM_ID,
          creator: deployer.publicKey,
          mint: USDC_MINT,
          groupId,
          memberCount: MEMBER_COUNT,
          contributionAmount: CONTRIBUTION_RAW,
          periodSeconds: PERIOD_SECONDS,
          graceSeconds: GRACE_SECONDS,
          joinDeadline: now + PHASE_WINDOW_SECONDS,
          revealWindowSeconds: PHASE_WINDOW_SECONDS,
          collateralWindowSeconds: PHASE_WINDOW_SECONDS,
          creatorCommitment: commitment(group, deployer.publicKey, Buffer.from(state.creatorSecretHex, "hex")),
        }),
        [],
        state,
        statePath,
      );
      current = await fetchGroup(connection, group);
    }
    if (!current) throw new Error("Group creation did not produce an account");
    if (
      !current.creator.equals(deployer.publicKey) ||
      !current.mint.equals(USDC_MINT) ||
      current.id !== groupId ||
      current.contributionAmount !== CONTRIBUTION_RAW ||
      current.periodSeconds !== BigInt(PERIOD_SECONDS) ||
      current.graceSeconds !== BigInt(GRACE_SECONDS)
    ) {
      throw new Error("Created Group economics do not match the requested test terms");
    }

    if (current.status === "forming") {
      if (!(await connection.getAccountInfo(invite, "confirmed"))) {
        await simulateAndSend(
          sender,
          "inviteMember",
          inviteMemberIx({ programId: PROGRAM_ID, group, creator: deployer.publicKey, invitee: participant.publicKey }),
          [],
          state,
          statePath,
        );
      }
      await simulateAndSend(
        sender,
        "joinGroup",
        joinGroupIx({
          programId: PROGRAM_ID,
          group,
          participant: participant.publicKey,
          commitment: commitment(group, participant.publicKey, Buffer.from(state.participantSecretHex, "hex")),
        }),
        [participant],
        state,
        statePath,
      );
      current = await fetchGroup(connection, group);
    }
    if (!current) throw new Error("Group disappeared after join");

    if (current.status === "revealing") {
      const creatorState = await fetchMember(connection, creatorMember);
      const participantState = await fetchMember(connection, participantMember);
      if (!creatorState.revealed) {
        await simulateAndSend(
          sender,
          "revealCreator",
          revealSecretIx({ programId: PROGRAM_ID, group, participant: deployer.publicKey, secret: Buffer.from(state.creatorSecretHex, "hex") }),
          [],
          state,
          statePath,
        );
      }
      if (!participantState.revealed) {
        await simulateAndSend(
          sender,
          "revealParticipant",
          revealSecretIx({ programId: PROGRAM_ID, group, participant: participant.publicKey, secret: Buffer.from(state.participantSecretHex, "hex") }),
          [participant],
          state,
          statePath,
        );
      }
      current = await fetchGroup(connection, group);
      if (current?.status === "revealing") {
        await simulateAndSend(
          sender,
          "finalizeOrder",
          finalizeOrderIx({ programId: PROGRAM_ID, group }),
          [],
          state,
          statePath,
        );
      }
    }

    current = await fetchGroup(connection, group);
    if (!current || !["collateralizing", "active", "completed"].includes(current.status)) {
      throw new Error(`Preparation ended in unexpected state ${current?.status ?? "missing"}`);
    }
    console.log(JSON.stringify({ phase: "prepared", group: group.toBase58(), status: current.status }, null, 2));
    if (phase === "prepare") return;
  }

  let current = await fetchGroup(connection, group);
  if (!current) throw new Error("Prepared E2E Group does not exist");
  const creatorStarting = await tokenBalance(connection, creatorAta);
  const participantStarting = await tokenBalance(connection, participantAta);
  if (current.status === "collateralizing" && (creatorStarting < BigInt(2_000_000) || participantStarting < BigInt(2_000_000))) {
    console.log(JSON.stringify({
      phase: "awaiting-usdc",
      mint: USDC_MINT.toBase58(),
      creator: deployer.publicKey.toBase58(),
      creatorAta: creatorAta.toBase58(),
      creatorBalanceRaw: creatorStarting.toString(),
      participant: participant.publicKey.toBase58(),
      participantAta: participantAta.toBase58(),
      participantBalanceRaw: participantStarting.toString(),
      minimumPerWalletRaw: "2000000",
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  if (current.status === "collateralizing") {
    if (!state.startingCombinedRaw) {
      state.startingCombinedRaw = (creatorStarting + participantStarting).toString();
      writeState(statePath, state);
    }
    const creatorState = await fetchMember(connection, creatorMember);
    const participantState = await fetchMember(connection, participantMember);
    if (!creatorState.collateralPosted) {
      await simulateAndSend(
        sender,
        "postCollateralCreator",
        postCollateralIx({ ...refs, participant: deployer.publicKey }),
        [],
        state,
        statePath,
      );
    }
    if (!participantState.collateralPosted) {
      await simulateAndSend(
        sender,
        "postCollateralParticipant",
        postCollateralIx({ ...refs, participant: participant.publicKey }),
        [participant],
        state,
        statePath,
      );
    }
    await simulateAndSend(
      sender,
      "activateGroup",
      activateGroupIx({ programId: PROGRAM_ID, group }),
      [],
      state,
      statePath,
    );
    current = await fetchGroup(connection, group);
  }

  if (!current || (current.status !== "active" && current.status !== "completed")) {
    throw new Error(`Completion started from unexpected state ${current?.status ?? "missing"}`);
  }

  const walletByAddress = new Map([
    [deployer.publicKey.toBase58(), { keypair: deployer, member: creatorMember, ata: creatorAta }],
    [participant.publicKey.toBase58(), { keypair: participant, member: participantMember, ata: participantAta }],
  ]);

  if (current.status === "active" && current.currentRound === 0) {
    for (const wallet of [deployer.publicKey, participant.publicKey]) {
      const actor = walletByAddress.get(wallet.toBase58());
      if (!actor) throw new Error("Missing round-zero actor");
      const memberState = await fetchMember(connection, actor.member);
      if (memberState.lastContributedRound !== 0) {
        await simulateAndSend(
          sender,
          `contributeRound0-${wallet.equals(deployer.publicKey) ? "creator" : "participant"}`,
          contributeIx({ ...refs, participant: wallet }),
          wallet.equals(deployer.publicKey) ? [] : [actor.keypair],
          state,
          statePath,
        );
      }
    }
    current = await fetchGroup(connection, group);
    if (!current || current.roundContributions !== MEMBER_COUNT) throw new Error("Round zero is not fully funded");
    const recipient = current.payoutOrder[0];
    const actor = walletByAddress.get(recipient.toBase58());
    if (!actor) throw new Error("Round-zero recipient is not a known member");
    await simulateAndSend(
      sender,
      "settleRound0",
      settleRoundIx({ ...refs, recipient, keeper: keeper.publicKey }),
      [keeper],
      state,
      statePath,
    );
    current = await fetchGroup(connection, group);
  }

  if (current?.status === "active" && current.currentRound === 1) {
    const earlyRecipient = current.payoutOrder[0];
    const finalRecipient = current.payoutOrder[1];
    const earlyActor = walletByAddress.get(earlyRecipient.toBase58());
    const finalActor = walletByAddress.get(finalRecipient.toBase58());
    if (!earlyActor || !finalActor) throw new Error("Final-round recipients are not known members");

    const finalMemberState = await fetchMember(connection, finalActor.member);
    if (finalMemberState.lastContributedRound !== 1) {
      await simulateAndSend(
        sender,
        "contributeRound1-finalRecipient",
        contributeIx({ ...refs, participant: finalRecipient }),
        finalRecipient.equals(deployer.publicKey) ? [] : [finalActor.keypair],
        state,
        statePath,
      );
    }

    const coverBuilder = () => coverDefaultIx({ ...refs, memberWallet: earlyRecipient, keeper: keeper.publicKey });
    if (!state.expectedEarlyCoverRejected) {
      await expectSimulationFailure(sender, "coverDefault-before-grace", coverBuilder(), [keeper]);
      state.expectedEarlyCoverRejected = true;
      writeState(statePath, state);
    }
    await waitPastGrace(connection, group);
    const earlyMemberState = await fetchMember(connection, earlyActor.member);
    if (earlyMemberState.lastContributedRound !== 1) {
      await simulateAndSend(
        sender,
        "coverDefaultRound1",
        coverBuilder(),
        [keeper],
        state,
        statePath,
      );
    }
    await simulateAndSend(
      sender,
      "settleRound1",
      settleRoundIx({ ...refs, recipient: finalRecipient, keeper: keeper.publicKey }),
      [keeper],
      state,
      statePath,
    );
    current = await fetchGroup(connection, group);
  }

  if (!current || current.status !== "completed" || current.currentRound !== MEMBER_COUNT) {
    throw new Error(`E2E Group did not complete: ${current?.status ?? "missing"}`);
  }
  const creatorFinal = await fetchMember(connection, creatorMember);
  const participantFinal = await fetchMember(connection, participantMember);
  const potFinal = await tokenBalance(connection, potVault);
  const collateralFinal = await tokenBalance(connection, collateralVault);
  const creatorBalanceFinal = await tokenBalance(connection, creatorAta);
  const participantBalanceFinal = await tokenBalance(connection, participantAta);
  const earlyDefault = [creatorFinal, participantFinal].find((member) => member.payoutRank === 0);
  if (
    !earlyDefault ||
    earlyDefault.defaults !== 1 ||
    earlyDefault.lastResolutionKind !== 2 ||
    !creatorFinal.payoutReceived ||
    !participantFinal.payoutReceived ||
    creatorFinal.collateralLocked !== BigInt(0) ||
    participantFinal.collateralLocked !== BigInt(0) ||
    current.totalCollateralLocked !== BigInt(0) ||
    potFinal !== BigInt(0) ||
    collateralFinal !== BigInt(0)
  ) {
    throw new Error("Final account invariants failed");
  }
  if (
    state.startingCombinedRaw &&
    creatorBalanceFinal + participantBalanceFinal !== BigInt(state.startingCombinedRaw)
  ) {
    throw new Error("Participant USDC conservation failed");
  }

  console.log(JSON.stringify({
    phase: "completed",
    programId: PROGRAM_ID.toBase58(),
    group: group.toBase58(),
    groupId: state.groupId,
    mint: USDC_MINT.toBase58(),
    status: current.status,
    rounds: current.currentRound,
    defaultCoveredWallet: earlyDefault.wallet.toBase58(),
    defaults: earlyDefault.defaults,
    potRaw: potFinal.toString(),
    collateralRaw: collateralFinal.toString(),
    participantCombinedRaw: (creatorBalanceFinal + participantBalanceFinal).toString(),
    signatures: state.signatures,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
