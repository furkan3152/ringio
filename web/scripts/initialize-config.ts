import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";

import { decodeConfig } from "../src/lib/ringio/accounts";
import { initializeConfigIx } from "../src/lib/ringio/instructions";
import { configPda } from "../src/lib/ringio/pda";

/**
 * One-time bootstrap of the GlobalConfig PDA on a cluster. Must be signed by
 * the program's upgrade authority.
 *
 *   npm run initialize:config -- --cluster devnet --keypair /abs/path.json \
 *     [--pause-authority PUBKEY] [--program-id ID] [--rpc URL] [--yes-mainnet]
 */

const PUBLIC_RPC: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const keypairPath = option("--keypair");
  const cluster = option("--cluster") ?? "devnet";
  if (!keypairPath || !PUBLIC_RPC[cluster]) {
    throw new Error(
      "Usage: npm run initialize:config -- --cluster <mainnet-beta|devnet|testnet> --keypair /absolute/path.json [--pause-authority PUBKEY] [--rpc URL]",
    );
  }
  if (cluster === "mainnet-beta" && !process.argv.includes("--yes-mainnet")) {
    throw new Error("Refusing to touch mainnet without --yes-mainnet. Prefer a multisig pause authority (see docs/mainnet-deployment.md).");
  }

  const secret = JSON.parse(readFileSync(resolve(keypairPath), "utf8")) as number[];
  const admin = Keypair.fromSecretKey(Uint8Array.from(secret));
  const programId = new PublicKey(option("--program-id") ?? "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
  const pauseAuthority = new PublicKey(option("--pause-authority") ?? admin.publicKey);
  const connection = new Connection(option("--rpc") ?? PUBLIC_RPC[cluster], "confirmed");
  const config = configPda(programId);

  const program = await connection.getAccountInfo(programId, "confirmed");
  if (!program?.executable) throw new Error(`Program ${programId.toBase58()} is not deployed on ${cluster}`);

  const existing = await connection.getAccountInfo(config, "confirmed");
  if (existing) {
    if (!existing.owner.equals(programId)) throw new Error("Config PDA has an unexpected owner");
    const decoded = decodeConfig(config.toBase58(), existing.data);
    console.log(JSON.stringify({ status: "already-initialized", cluster, programId: programId.toBase58(), ...decoded, totalPausedSeconds: decoded.totalPausedSeconds.toString() }, null, 2));
    return;
  }

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(initializeConfigIx({ programId, admin: admin.publicKey, pauseAuthority })),
    [admin],
    { commitment: "confirmed" },
  );
  console.log(
    JSON.stringify(
      {
        status: "initialized",
        cluster,
        signature,
        programId: programId.toBase58(),
        config: config.toBase58(),
        admin: admin.publicKey.toBase58(),
        pauseAuthority: pauseAuthority.toBase58(),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
