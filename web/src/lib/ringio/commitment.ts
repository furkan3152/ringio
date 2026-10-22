import { PublicKey } from "@solana/web3.js";

import { COMMITMENT_DOMAIN, REVEAL_DOMAIN, SECRET_DOMAIN } from "./constants";

/**
 * Commit–reveal helpers. The payout order is derived from every member's
 * secret, so each member commits `sha256(domain || group || wallet || secret)`
 * when joining and reveals the secret once the roster is full.
 *
 * Ringio derives the secret from a wallet signature over a fixed, readable
 * message. Ed25519 signatures are deterministic, so the same wallet can
 * re-derive the secret on any device at reveal time; a local copy is kept as a
 * fallback for wallets whose signatures are not deterministic.
 */

const encoder = new TextEncoder();

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", joined);
  return new Uint8Array(digest);
}

export function commitmentMessage(args: {
  cluster: string;
  programId: string;
  group: string;
  wallet: string;
}): string {
  return [
    "Ringio payout-order secret",
    "",
    "Signing is free and never moves funds.",
    "It derives the private secret that fixes your place in this circle's payout draw.",
    "",
    `Network: ${args.cluster}`,
    `Program: ${args.programId}`,
    `Circle: ${args.group}`,
    `Wallet: ${args.wallet}`,
  ].join("\n");
}

export async function secretFromSignature(signature: Uint8Array): Promise<Uint8Array> {
  const secret = await sha256([encoder.encode(SECRET_DOMAIN), signature]);
  if (secret.every((byte) => byte === 0)) throw new Error("Derived secret is zero");
  return secret;
}

export async function commitmentHash(
  group: PublicKey,
  wallet: PublicKey,
  secret: Uint8Array,
): Promise<Uint8Array> {
  return sha256([encoder.encode(COMMITMENT_DOMAIN), group.toBytes(), wallet.toBytes(), secret]);
}

export async function revealDigest(
  group: PublicKey,
  wallet: PublicKey,
  secret: Uint8Array,
): Promise<Uint8Array> {
  return sha256([encoder.encode(REVEAL_DOMAIN), group.toBytes(), wallet.toBytes(), secret]);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function storageKey(cluster: string, group: string, wallet: string): string {
  return `ringio:secret:v1:${cluster}:${group}:${wallet}`;
}

/** Best-effort local backup; storage can be unavailable (private mode, quotas). */
export function storeSecret(cluster: string, group: string, wallet: string, secret: Uint8Array): void {
  try {
    globalThis.localStorage?.setItem(storageKey(cluster, group, wallet), toHex(secret));
  } catch {
    // The secret can still be re-derived by signing the same message.
  }
}

export function loadSecret(cluster: string, group: string, wallet: string): Uint8Array | null {
  try {
    const value = globalThis.localStorage?.getItem(storageKey(cluster, group, wallet));
    return value ? fromHex(value) : null;
  } catch {
    return null;
  }
}
