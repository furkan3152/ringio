import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Prints how much SOL deploying the local program build needs, and fails when
 * the binary exceeds `--max-bytes` (the CI size budget). Read-only.
 *
 *   npm run program:cost -- [--so PATH] [--max-bytes N] [--rpc URL]
 *
 * Rent is a refundable deposit, not a fee: the ProgramData rent stays locked
 * while the program is deployed (recoverable only by closing the program), and
 * the buffer rent is returned as soon as the deploy finishes.
 */

const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAMDATA_HEADER = 45;
const BUFFER_HEADER = 37;
/** Approximate program bytes carried by one `solana program deploy` write transaction. */
const BYTES_PER_WRITE = 1_000;
const SIGNATURE_FEE = 5_000;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Rent-exempt minimum on every public cluster today: (128 + bytes) × 3480 × 2. */
function defaultRent(bytes: number): number {
  return (128 + bytes) * 3_480 * 2;
}

function sol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

async function main(): Promise<void> {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const path = resolve(option("--so") ?? resolve(webRoot, "../target/deploy/ringio.so"));
  if (!existsSync(path)) throw new Error(`Missing ${path}; run cargo build-sbf --manifest-path programs/ringio/Cargo.toml`);
  const bytes = statSync(path).size;

  const rpc = option("--rpc");
  const connection = rpc ? new Connection(rpc, "confirmed") : null;
  const rent = async (size: number) =>
    connection ? connection.getMinimumBalanceForRentExemption(size) : defaultRent(size);

  const programAccount = await rent(PROGRAM_ACCOUNT_BYTES);
  const programData = await rent(PROGRAMDATA_HEADER + bytes);
  const buffer = await rent(BUFFER_HEADER + bytes);
  const writes = Math.ceil(bytes / BYTES_PER_WRITE);
  const fees = (writes + 4) * SIGNATURE_FEE;

  const rows: [string, string][] = [
    ["Program binary", path],
    ["Size", `${bytes.toLocaleString("en-US")} bytes`],
    ["Locked while deployed", `${sol(programAccount + programData)} SOL (program + ProgramData rent)`],
    ["Temporary deploy buffer", `${sol(buffer)} SOL (refunded when the deploy completes)`],
    ["Transaction fees", `~${sol(fees)} SOL (${writes} write transactions, before priority fees)`],
    ["Wallet needs at deploy", `~${sol(programAccount + programData + buffer + fees)} SOL`],
  ];
  for (const [label, value] of rows) console.log(`${label.padEnd(24)}${value}`);

  const maxBytes = option("--max-bytes");
  if (maxBytes && bytes > Number(maxBytes)) {
    throw new Error(`Program is ${bytes} bytes, over the ${maxBytes}-byte budget`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
