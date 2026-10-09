import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
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
import { ACCOUNT_DISCRIMINATORS, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/lib/ringio/constants";
import { associatedTokenAddress, configPda, memberPda, programDataPda } from "../src/lib/ringio/pda";

/** Shared LiteSVM harness for the Ringio program binaries. */

export const PROGRAM_ID = new PublicKey("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
export const START = 1_800_000_000;
export const DAY = 86_400;
export const STARTING_BALANCE = BigInt(1_000_000_000);

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The program built from this repository (`cargo build-sbf`). */
export const LOCAL_PROGRAM = [process.env.RINGIO_PROGRAM_SO, resolve(webRoot, "../target/deploy/ringio.so")].find(
  (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
);
/** The bytecode currently deployed on devnet (`npm run program:fetch`). */
export const DEPLOYED_PROGRAM = [resolve(webRoot, ".cache/ringio-devnet.so")].find((candidate) => existsSync(candidate));

/** SHA-256 of the original Anchor build (devnet, before the Pinocchio rewrite). */
export const ANCHOR_REFERENCE_SHA256 = "c6a8367a70bab933f61220deb0fc7133229d2b876ee5b6e980530b778a874ee9";

/**
 * The original Anchor bytecode, used as the reference implementation by the
 * differential suite. `program:fetch` keeps a copy in `.cache/` while devnet
 * still serves it; `RINGIO_REFERENCE_SO` can point at any other copy.
 */
export const ANCHOR_REFERENCE_PROGRAM = [
  process.env.RINGIO_REFERENCE_SO,
  resolve(webRoot, ".cache/ringio-anchor-reference.so"),
  DEPLOYED_PROGRAM,
].find(
  (candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)) &&
    createHash("sha256").update(readFileSync(candidate!)).digest("hex") === ANCHOR_REFERENCE_SHA256,
);

export type Outcome = { ok: boolean; code: number | null; logs: string[] };

export type Harness = {
  svm: LiteSVM;
  mint: PublicKey;
  admin: Keypair;
  setTime(unix: number): void;
  now(): number;
  run(signers: Keypair[], instructions: TransactionInstruction[], feePayer?: Keypair): Outcome;
  send(signers: Keypair[], instructions: TransactionInstruction[]): void;
  fail(signers: Keypair[], instructions: TransactionInstruction[], expectedCode: number): void;
  wallet(): Keypair;
  fund(keypair: Keypair, usdc?: bigint): void;
  airdrop(key: PublicKey): void;
  put(key: PublicKey, owner: PublicKey, data: Uint8Array, lamportsOverride?: bigint): void;
  read(key: PublicKey): { owner: string; lamports: bigint; data: Uint8Array } | null;
  balance(owner: PublicKey): bigint;
  vault(address: PublicKey): bigint;
  group(address: PublicKey): GroupAccount;
  member(group: PublicKey, wallet: PublicKey): MemberAccount;
  setPaused(paused: boolean): void;
  setUpgradeAuthority(authority: PublicKey | null): void;
  removeConfig(): void;
};

const decodeTransaction = getTransactionDecoder();

function addr(key: PublicKey): Address {
  return address(key.toBase58());
}

/** Custom program error from the failed instruction (or Anchor's log line). */
export function errorCode(result: FailedTransactionMetadata): number | null {
  const err = result.err() as unknown as { err?: () => { code?: unknown } };
  const code = typeof err.err === "function" ? err.err().code : undefined;
  if (typeof code === "number") return code;
  const logged = result.meta().logs().join("\n").match(/Error Number: (\d+)/);
  return logged ? Number(logged[1]) : null;
}

export function configData(admin: PublicKey, paused: boolean): Uint8Array {
  const [, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const data = Buffer.alloc(136);
  Buffer.from(ACCOUNT_DISCRIMINATORS.config).copy(data, 0);
  admin.toBuffer().copy(data, 8);
  admin.toBuffer().copy(data, 40);
  data.writeBigInt64LE(BigInt(paused ? START : 0), 72);
  data.writeUInt8(paused ? 1 : 0, 88);
  data.writeUInt8(bump, 89);
  data.writeUInt8(1, 90);
  return data;
}

export function mintData(authority: PublicKey, decimals = 6): Uint8Array {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  authority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(BigInt(10) ** BigInt(15), 36);
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45);
  return data;
}

export function tokenAccountData(mint: PublicKey, owner: PublicKey, amount: bigint): Uint8Array {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  return data;
}

export function createHarness(
  programPath: string,
  options: { admin?: Keypair; mint?: PublicKey; withConfig?: boolean } = {},
): Harness {
  const svm = new LiteSVM();
  svm.addProgram(addr(PROGRAM_ID), readFileSync(programPath));
  const admin = options.admin ?? Keypair.generate();
  const mint = options.mint ?? Keypair.generate().publicKey;

  const put = (key: PublicKey, owner: PublicKey, data: Uint8Array, lamportsOverride?: bigint) =>
    svm.setAccount({
      address: addr(key),
      data,
      executable: false,
      lamports: lamports(lamportsOverride ?? svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: addr(owner),
      space: BigInt(data.length),
    });
  const read = (key: PublicKey) => {
    const account = svm.getAccount(addr(key));
    return account.exists
      ? { owner: account.programAddress as string, lamports: BigInt(account.lamports), data: Uint8Array.from(account.data) }
      : null;
  };
  const run = (signers: Keypair[], instructions: TransactionInstruction[], feePayer?: Keypair): Outcome => {
    const tx = new Transaction().add(...instructions);
    const payer = feePayer ?? signers[0];
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = svm.latestBlockhash();
    const unique = [payer, ...signers].filter(
      (keypair, index, all) => all.findIndex((other) => other.publicKey.equals(keypair.publicKey)) === index,
    );
    tx.sign(...unique);
    const result = svm.sendTransaction(decodeTransaction.decode(tx.serialize()));
    svm.expireBlockhash();
    if (result instanceof FailedTransactionMetadata) {
      return { ok: false, code: errorCode(result), logs: result.meta().logs() };
    }
    return { ok: true, code: null, logs: result.logs() };
  };

  const writeConfig = (paused: boolean) => put(configPda(PROGRAM_ID), PROGRAM_ID, configData(admin.publicKey, paused));
  if (options.withConfig ?? true) writeConfig(false);
  put(mint, TOKEN_PROGRAM_ID, mintData(admin.publicKey));

  const h: Harness = {
    svm,
    mint,
    admin,
    setTime(unix) {
      const clock = svm.getClock();
      clock.unixTimestamp = BigInt(unix);
      svm.setClock(clock);
    },
    now() {
      return Number(svm.getClock().unixTimestamp);
    },
    run,
    send(signers, instructions) {
      const outcome = run(signers, instructions);
      if (!outcome.ok) assert.fail(`Transaction failed (code ${outcome.code}):\n${outcome.logs.join("\n")}`);
    },
    fail(signers, instructions, expectedCode) {
      const outcome = run(signers, instructions);
      assert.equal(outcome.ok, false, `Expected failure ${expectedCode}`);
      assert.equal(outcome.code, expectedCode, outcome.logs.join("\n"));
    },
    fund(keypair, usdc = STARTING_BALANCE) {
      svm.airdrop(addr(keypair.publicKey), lamports(BigInt(10 * LAMPORTS_PER_SOL)));
      put(associatedTokenAddress(keypair.publicKey, mint), TOKEN_PROGRAM_ID, tokenAccountData(mint, keypair.publicKey, usdc));
    },
    wallet() {
      const keypair = Keypair.generate();
      h.fund(keypair);
      return keypair;
    },
    airdrop(key) {
      svm.airdrop(addr(key), lamports(BigInt(LAMPORTS_PER_SOL)));
    },
    put,
    read,
    balance(owner) {
      return h.vault(associatedTokenAddress(owner, mint));
    },
    vault(key) {
      const account = read(key);
      return account ? decodeTokenAccount(key.toBase58(), account.data).amount : BigInt(0);
    },
    group(key) {
      const account = read(key);
      assert.ok(account, "Group missing");
      return decodeGroup(key.toBase58(), account.data);
    },
    member(group, wallet) {
      const key = memberPda(PROGRAM_ID, group, wallet);
      const account = read(key);
      assert.ok(account, "Member missing");
      return decodeMember(key.toBase58(), account.data);
    },
    setPaused(paused) {
      writeConfig(paused);
      const account = read(configPda(PROGRAM_ID));
      assert.ok(account);
      assert.equal(decodeConfig("config", account.data).paused, paused);
    },
    setUpgradeAuthority(authority) {
      const key = programDataPda(PROGRAM_ID);
      const account = read(key);
      assert.ok(account, "ProgramData missing");
      const data = Buffer.from(account.data);
      data.fill(0, 12, 45);
      if (authority) {
        data[12] = 1;
        authority.toBuffer().copy(data, 13);
      }
      put(key, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, data, account.lamports);
    },
    removeConfig() {
      svm.setAccount({
        address: addr(configPda(PROGRAM_ID)),
        data: new Uint8Array(0),
        executable: false,
        lamports: lamports(BigInt(0)),
        programAddress: address("11111111111111111111111111111111"),
        space: BigInt(0),
      });
    },
  };
  h.setTime(START);
  return h;
}
