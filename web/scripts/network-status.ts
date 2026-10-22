import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";

import { decodeConfig, decodeMintDecimals } from "../src/lib/ringio/accounts";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/lib/ringio/constants";
import { configPda, programDataPda } from "../src/lib/ringio/pda";

/**
 * Read-only readiness report for one or all clusters: is the program deployed,
 * who can upgrade it, is the config initialized, is the USDC mint valid, and
 * does the on-chain bytecode match a local build artifact?
 *
 *   npm run network:status -- [--cluster devnet] [--program-id ID] [--rpc URL]
 */

const CLUSTERS: Record<string, { rpc: string; usdc: string | null }> = {
  "mainnet-beta": { rpc: "https://api.mainnet-beta.solana.com", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  devnet: { rpc: "https://api.devnet.solana.com", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  testnet: { rpc: "https://api.testnet.solana.com", usdc: null },
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function elfHash(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = Number(view.getBigUint64(0x28, true)) + view.getUint16(0x3a, true) * view.getUint16(0x3c, true);
  return createHash("sha256").update(bytes.subarray(0, Math.min(length, bytes.length))).digest("hex");
}

async function report(cluster: string, programId: PublicKey, rpc: string) {
  const connection = new Connection(rpc, "confirmed");
  const programData = programDataPda(programId);
  const config = configPda(programId);
  const usdc = CLUSTERS[cluster].usdc;
  const [program, data, configInfo, mint] = await connection.getMultipleAccountsInfo(
    [programId, programData, config, ...(usdc ? [new PublicKey(usdc)] : [])],
    "confirmed",
  );

  const deployed = Boolean(program?.executable && data?.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID));
  const upgradeAuthority = data && data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)).toBase58() : deployed ? "immutable" : null;
  const onchainHash = deployed && data ? elfHash(data.data.subarray(45)) : null;
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const artifact = resolve(webRoot, "../target/deploy/ringio.so");
  const localHash = existsSync(artifact) ? elfHash(readFileSync(artifact)) : null;
  const decodedConfig = configInfo?.owner.equals(programId) ? decodeConfig(config.toBase58(), configInfo.data) : null;

  return {
    cluster,
    programId: programId.toBase58(),
    deployed,
    upgradeAuthority,
    configInitialized: Boolean(decodedConfig),
    admin: decodedConfig?.admin ?? null,
    pauseAuthority: decodedConfig?.pauseAuthority ?? null,
    paused: decodedConfig?.paused ?? null,
    usdcMint: usdc,
    usdcValid: usdc ? Boolean(mint?.owner.equals(TOKEN_PROGRAM_ID) && decodeMintDecimals(usdc, mint.data) === 6) : null,
    bytecodeSha256: onchainHash,
    matchesLocalArtifact: onchainHash && localHash ? onchainHash === localHash : null,
    readyForUi: deployed && Boolean(decodedConfig),
  };
}

async function main(): Promise<void> {
  const programId = new PublicKey(option("--program-id") ?? "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
  const only = option("--cluster");
  const clusters = only ? [only] : Object.keys(CLUSTERS);
  for (const cluster of clusters) {
    if (!CLUSTERS[cluster]) throw new Error(`Unknown cluster ${cluster}`);
    const rpc = option("--rpc") ?? CLUSTERS[cluster].rpc;
    try {
      console.log(JSON.stringify(await report(cluster, programId, rpc), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ cluster, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
