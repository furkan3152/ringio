import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_PROGRAM_ID = new PublicKey("JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
const DEFAULT_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CREATE_GROUP_DISCRIMINATOR = Buffer.from([79, 60, 158, 134, 61, 199, 56, 248]);
const COMMITMENT_DOMAIN = Buffer.from("ringio-commitment-v1");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required option ${name}`);
  return value;
}

function u64(value: bigint): Buffer {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("u64 value out of range");
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function i64(value: bigint): Buffer {
  const data = Buffer.alloc(8);
  data.writeBigInt64LE(value);
  return data;
}

function groupCode(address: PublicKey): string {
  const prefix = Array.from(address.toBytes().subarray(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `RNG-${prefix.toUpperCase()}`;
}

async function main(): Promise<void> {
  const keypairPath = resolve(requiredOption("--keypair"));
  const secretPath = resolve(requiredOption("--secret-file"));
  const rpc = option("--rpc") ?? "https://api.devnet.solana.com";
  const programId = new PublicKey(option("--program-id") ?? DEFAULT_PROGRAM_ID);
  const mint = new PublicKey(option("--mint") ?? DEFAULT_MINT);
  const groupId = BigInt(option("--group-id") ?? Date.now().toString());
  const memberCount = Number(option("--members") ?? "2");
  const contributionAmount = BigInt(option("--contribution-raw") ?? "1000000");
  if (!Number.isInteger(memberCount) || memberCount < 2 || memberCount > 32) throw new Error("members must be 2..32");

  const secretBytes = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
  const creator = Keypair.fromSecretKey(Uint8Array.from(secretBytes));
  const connection = new Connection(rpc, "confirmed");
  const groupIdBytes = u64(groupId);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [group] = PublicKey.findProgramAddressSync(
    [Buffer.from("group"), creator.publicKey.toBuffer(), groupIdBytes],
    programId,
  );
  const [creatorMember] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), group.toBuffer(), creator.publicKey.toBuffer()],
    programId,
  );
  const [potVault] = PublicKey.findProgramAddressSync([Buffer.from("pot-vault"), group.toBuffer()], programId);
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral-vault"), group.toBuffer()],
    programId,
  );

  if (await connection.getAccountInfo(group, "confirmed")) throw new Error(`Group already exists: ${group.toBase58()}`);
  const [configAccount, mintAccount] = await Promise.all([
    connection.getAccountInfo(config, "confirmed"),
    connection.getAccountInfo(mint, "confirmed"),
  ]);
  if (!configAccount) throw new Error("GlobalConfig is not initialized");
  if (!mintAccount || !mintAccount.owner.equals(TOKEN_PROGRAM_ID) || mintAccount.data.length < 45) {
    throw new Error("Mint is not a classic SPL Token mint");
  }
  if (mintAccount.data.readUInt8(44) !== 6) throw new Error("Smoke mint must use six decimals");

  const revealSecret = randomBytes(32);
  const commitment = createHash("sha256")
    .update(COMMITMENT_DOMAIN)
    .update(group.toBuffer())
    .update(creator.publicKey.toBuffer())
    .update(revealSecret)
    .digest();

  mkdirSync(dirname(secretPath), { recursive: true, mode: 0o700 });
  writeFileSync(secretPath, revealSecret, { flag: "wx", mode: 0o600 });
  chmodSync(secretPath, 0o600);

  const now = BigInt(Math.floor(Date.now() / 1_000));
  const instructionData = Buffer.concat([
    CREATE_GROUP_DISCRIMINATOR,
    groupIdBytes,
    Buffer.from([memberCount & 0xff, (memberCount >> 8) & 0xff]),
    u64(contributionAmount),
    i64(BigInt(7 * 24 * 60 * 60)),
    i64(BigInt(24 * 60 * 60)),
    i64(now + BigInt(7 * 24 * 60 * 60)),
    i64(BigInt(2 * 24 * 60 * 60)),
    i64(BigInt(2 * 24 * 60 * 60)),
    commitment,
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: creatorMember, isSigner: false, isWritable: true },
      { pubkey: potVault, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [creator],
      { commitment: "confirmed", skipPreflight: false },
    );
    const account = await connection.getAccountInfo(group, "confirmed");
    if (!account || !account.owner.equals(programId) || account.data.length !== 2_387) {
      throw new Error("Created Group account failed owner/size verification");
    }
    console.log(JSON.stringify({
      status: "created",
      signature,
      group: group.toBase58(),
      groupCode: groupCode(group),
      creatorMember: creatorMember.toBase58(),
      potVault: potVault.toBase58(),
      collateralVault: collateralVault.toBase58(),
      mint: mint.toBase58(),
      groupId: groupId.toString(),
      revealSecretFile: secretPath,
    }));
  } catch (error) {
    throw new Error(`Group creation failed; reveal secret remains at ${secretPath}`, { cause: error });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
