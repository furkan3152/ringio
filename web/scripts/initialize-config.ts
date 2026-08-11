import { readFileSync } from "node:fs";

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_PROGRAM_ID = new PublicKey(
  "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy",
);
const DEFAULT_RPC = "https://api.devnet.solana.com";
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const INITIALIZE_CONFIG_DISCRIMINATOR = Buffer.from([
  208, 127, 21, 1, 194, 190, 196, 70,
]);
const GLOBAL_CONFIG_DISCRIMINATOR = Buffer.from([
  149, 8, 156, 202, 160, 252, 176, 217,
]);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
const keypairPath = option("--keypair");
if (!keypairPath) {
  throw new Error("Usage: npm run initialize:config -- --keypair /absolute/path.json [--rpc URL] [--pause-authority PUBKEY]");
}

const secret = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
const programId = new PublicKey(option("--program-id") ?? DEFAULT_PROGRAM_ID);
const pauseAuthority = new PublicKey(
  option("--pause-authority") ?? admin.publicKey,
);
const connection = new Connection(option("--rpc") ?? DEFAULT_RPC, "confirmed");

const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from("config")],
  programId,
);
const [programData] = PublicKey.findProgramAddressSync(
  [programId.toBuffer()],
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
);

const existing = await connection.getAccountInfo(config, "confirmed");
if (existing) {
  if (
    !existing.owner.equals(programId) ||
    existing.data.length !== 136 ||
    !existing.data.subarray(0, 8).equals(GLOBAL_CONFIG_DISCRIMINATOR)
  ) {
    throw new Error("Existing config PDA failed owner, size, or discriminator verification");
  }
  console.log(JSON.stringify({
    status: "already-initialized",
    programId: programId.toBase58(),
    config: config.toBase58(),
    admin: new PublicKey(existing.data.subarray(8, 40)).toBase58(),
    pauseAuthority: new PublicKey(existing.data.subarray(40, 72)).toBase58(),
    paused: existing.data.readUInt8(88) === 1,
    version: existing.data.readUInt8(90),
  }));
  process.exit(0);
}

const data = Buffer.concat([
  INITIALIZE_CONFIG_DISCRIMINATOR,
  pauseAuthority.toBuffer(),
]);
const instruction = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: programId, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const signature = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(instruction),
  [admin],
  { commitment: "confirmed" },
);

console.log(JSON.stringify({
  status: "initialized",
  signature,
  programId: programId.toBase58(),
  config: config.toBase58(),
  admin: admin.publicKey.toBase58(),
  pauseAuthority: pauseAuthority.toBase58(),
}));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
