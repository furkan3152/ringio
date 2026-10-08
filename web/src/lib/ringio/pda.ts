import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  SEEDS,
  TOKEN_PROGRAM_ID,
} from "./constants";

const encoder = new TextEncoder();

function seed(value: string): Uint8Array {
  return encoder.encode(value);
}

export function u64Le(value: bigint): Uint8Array {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("u64 out of range");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.config)], programId)[0];
}

export function groupPda(programId: PublicKey, creator: PublicKey, groupId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.group), creator.toBytes(), u64Le(groupId)],
    programId,
  )[0];
}

export function memberPda(programId: PublicKey, group: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.member), group.toBytes(), wallet.toBytes()],
    programId,
  )[0];
}

export function invitePda(programId: PublicKey, group: PublicKey, invitee: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.invite), group.toBytes(), invitee.toBytes()],
    programId,
  )[0];
}

export function potVaultPda(programId: PublicKey, group: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.potVault), group.toBytes()], programId)[0];
}

export function collateralVaultPda(programId: PublicKey, group: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.collateralVault), group.toBytes()], programId)[0];
}

export function programDataPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([programId.toBytes()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];
}

/** Classic SPL Token associated token account. */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
