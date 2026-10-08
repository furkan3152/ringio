"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { useNetwork } from "@/components/providers/network-provider";
import { decodeInvite, type InviteAccount } from "@/lib/ringio/accounts";
import {
  fetchCircles,
  fetchFormingGroupAddresses,
  fetchProgramStatus,
  fetchWalletBalances,
  fetchWalletIndex,
  type CircleSnapshot,
  type ProgramStatus,
  type WalletBalances,
} from "@/lib/ringio/fetch";
import { invitePda } from "@/lib/ringio/pda";
import { useChainQuery } from "./use-chain-query";

export function useProgramId(): PublicKey {
  const { network } = useNetwork();
  return useMemo(() => new PublicKey(network.programId), [network.programId]);
}

export function useProgramStatus() {
  const { connection } = useConnection();
  const { cluster } = useNetwork();
  const programId = useProgramId();
  const query = useChainQuery<ProgramStatus>(
    `status:${cluster}:${programId.toBase58()}`,
    () => fetchProgramStatus(connection, programId),
  );
  return { ...query, ready: query.data?.state === "ready", config: query.data?.state === "ready" ? query.data.config : null };
}

export type WalletCircles = {
  circles: CircleSnapshot[];
  pendingInvites: InviteAccount[];
};

export function useWalletCircles() {
  const { connection } = useConnection();
  const { cluster } = useNetwork();
  const { publicKey } = useWallet();
  const programId = useProgramId();
  const status = useProgramStatus();
  const wallet = publicKey?.toBase58() ?? null;
  return useChainQuery<WalletCircles>(
    wallet && status.ready ? `wallet:${cluster}:${programId.toBase58()}:${wallet}` : null,
    async () => {
      if (!wallet) return { circles: [], pendingInvites: [] };
      const index = await fetchWalletIndex(connection, programId, wallet);
      const circles = await fetchCircles(connection, programId, [
        ...index.memberGroups,
        ...index.pendingInvites.map((invite) => invite.group),
      ]);
      return { circles, pendingInvites: index.pendingInvites };
    },
  );
}

export type CircleView = {
  snapshot: CircleSnapshot | null;
  invite: InviteAccount | null;
};

export function useCircle(address: string | null) {
  const { connection } = useConnection();
  const { cluster } = useNetwork();
  const { publicKey } = useWallet();
  const programId = useProgramId();
  const status = useProgramStatus();
  const wallet = publicKey?.toBase58() ?? null;
  return useChainQuery<CircleView>(
    address && status.ready ? `circle:${cluster}:${programId.toBase58()}:${address}:${wallet ?? "-"}` : null,
    async () => {
      if (!address) return { snapshot: null, invite: null };
      const group = new PublicKey(address);
      const [snapshots, inviteInfo] = await Promise.all([
        fetchCircles(connection, programId, [address]),
        publicKey ? connection.getAccountInfo(invitePda(programId, group, publicKey), "confirmed") : Promise.resolve(null),
      ]);
      const invite =
        inviteInfo && publicKey && inviteInfo.owner.equals(programId)
          ? decodeInvite(invitePda(programId, group, publicKey).toBase58(), inviteInfo.data)
          : null;
      return { snapshot: snapshots[0] ?? null, invite };
    },
    { pollMs: 20_000 },
  );
}

export function useOpenCircles(limit = 24) {
  const { connection } = useConnection();
  const { cluster } = useNetwork();
  const programId = useProgramId();
  const status = useProgramStatus();
  return useChainQuery<CircleSnapshot[]>(
    status.ready ? `open:${cluster}:${programId.toBase58()}` : null,
    async () => {
      const addresses = await fetchFormingGroupAddresses(connection, programId);
      const snapshots = await fetchCircles(connection, programId, addresses.slice(0, limit));
      return snapshots.sort((left, right) => right.group.createdAt - left.group.createdAt);
    },
  );
}

export function useWalletBalances(mint: string | null) {
  const { connection } = useConnection();
  const { cluster } = useNetwork();
  const { publicKey } = useWallet();
  return useChainQuery<WalletBalances>(
    publicKey ? `balances:${cluster}:${publicKey.toBase58()}:${mint ?? "-"}` : null,
    () => fetchWalletBalances(connection, publicKey!, mint ? new PublicKey(mint) : null),
  );
}
