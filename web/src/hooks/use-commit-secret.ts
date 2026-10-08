"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { useNetwork } from "@/components/providers/network-provider";
import { RingioTxError } from "@/hooks/use-ringio-tx";
import {
  bytesEqual,
  commitmentHash,
  commitmentMessage,
  loadSecret,
  secretFromSignature,
  storeSecret,
} from "@/lib/ringio/commitment";

/**
 * Produces the payout-draw secret for (circle, wallet). Prefers a wallet
 * signature (re-derivable on any device); wallets without message signing fall
 * back to a random secret kept in this browser.
 */
export function useCommitSecret() {
  const wallet = useWallet();
  const { cluster, network } = useNetwork();

  const derive = useCallback(
    async (group: PublicKey): Promise<{ secret: Uint8Array; commitment: Uint8Array; localOnly: boolean }> => {
      const owner = wallet.publicKey;
      if (!owner) throw new RingioTxError("Connect a wallet first.");
      let secret: Uint8Array;
      let localOnly = false;
      if (wallet.signMessage) {
        const message = commitmentMessage({
          cluster,
          programId: network.programId,
          group: group.toBase58(),
          wallet: owner.toBase58(),
        });
        try {
          secret = await secretFromSignature(await wallet.signMessage(new TextEncoder().encode(message)));
        } catch (error) {
          throw new RingioTxError(
            error instanceof Error && /reject|declin/i.test(error.message)
              ? "You declined the signature that creates your payout-draw secret."
              : "Your wallet could not sign the payout-draw message.",
          );
        }
      } else {
        secret = globalThis.crypto.getRandomValues(new Uint8Array(32));
        localOnly = true;
      }
      storeSecret(cluster, group.toBase58(), owner.toBase58(), secret);
      return { secret, commitment: await commitmentHash(group, owner, secret), localOnly };
    },
    [cluster, network.programId, wallet],
  );

  /** Finds a secret that matches the on-chain commitment (local copy first, then re-derive). */
  const recover = useCallback(
    async (group: PublicKey, onchainCommitment: Uint8Array): Promise<Uint8Array> => {
      const owner = wallet.publicKey;
      if (!owner) throw new RingioTxError("Connect a wallet first.");
      const stored = loadSecret(cluster, group.toBase58(), owner.toBase58());
      if (stored && bytesEqual(await commitmentHash(group, owner, stored), onchainCommitment)) return stored;
      if (!wallet.signMessage) {
        throw new RingioTxError("This browser has no saved secret and the wallet cannot sign messages. Use the browser you joined with.");
      }
      const derived = await derive(group);
      if (!bytesEqual(derived.commitment, onchainCommitment)) {
        throw new RingioTxError(
          "The re-derived secret does not match your commitment. Reveal from the browser and wallet you joined with.",
        );
      }
      return derived.secret;
    },
    [cluster, derive, wallet],
  );

  return { derive, recover };
}
