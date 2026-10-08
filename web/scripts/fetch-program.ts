import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Downloads the deployed Ringio program bytecode from a cluster so the LiteSVM
 * suite can execute the exact on-chain binary. Read-only; no keys involved.
 *
 *   npm run program:fetch -- [--cluster devnet] [--program-id ID] [--out PATH] [--if-missing]
 */

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAMDATA_HEADER = 45;
const PUBLIC_RPC: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** ELF64 size = section header table offset + entries × entry size. */
function elfLength(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x7f454c46) throw new Error("Program data is not an ELF file");
  const sectionHeaderOffset = Number(view.getBigUint64(0x28, true));
  const entrySize = view.getUint16(0x3a, true);
  const entries = view.getUint16(0x3c, true);
  const length = sectionHeaderOffset + entrySize * entries;
  if (length <= 0 || length > bytes.length) throw new Error("Invalid ELF section header table");
  return length;
}

async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000 * 2 ** attempt));
    }
  }
  throw new Error(`${label} failed: ${String(lastError)}`);
}

async function main(): Promise<void> {
  const cluster = option("--cluster") ?? "devnet";
  const rpc = option("--rpc") ?? PUBLIC_RPC[cluster];
  if (!rpc) throw new Error(`Unknown cluster ${cluster}`);
  const programId = new PublicKey(option("--program-id") ?? "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy");
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(option("--out") ?? resolve(webRoot, `.cache/ringio-${cluster}.so`));
  if (process.argv.includes("--if-missing") && existsSync(out)) {
    console.log(`Using cached program binary ${out}`);
    return;
  }

  const connection = new Connection(rpc, "confirmed");
  const [programData] = PublicKey.findProgramAddressSync([programId.toBytes()], BPF_LOADER_UPGRADEABLE);
  const account = await withRetry("getAccountInfo", () => connection.getAccountInfo(programData, "confirmed"));
  if (!account || !account.owner.equals(BPF_LOADER_UPGRADEABLE)) {
    throw new Error(`Ringio is not deployed on ${cluster} at ${programId.toBase58()}`);
  }
  const elf = account.data.subarray(PROGRAMDATA_HEADER);
  const binary = elf.subarray(0, elfLength(elf));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, binary);
  console.log(JSON.stringify({ cluster, programId: programId.toBase58(), programData: programData.toBase58(), bytes: binary.length, out }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
