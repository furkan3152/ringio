"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { useDataVersion } from "@/components/providers/data-version";
import { useMainnetAck } from "@/components/providers/mainnet-ack";
import { useNetwork } from "@/components/providers/network-provider";
import { useToast } from "@/components/providers/toast-provider";
import { describeTransactionError } from "@/lib/ringio/errors";
import { explorerUrl } from "@/lib/solana/networks";

/**
 * Sends Ringio transactions: simulate first (so failures surface before any
 * wallet prompt), size the compute budget, add a priority fee on mainnet,
 * sign with the connected wallet, confirm, and refresh every chain query.
 */

export class RingioTxError extends Error {}

const MAX_COMPUTE_UNITS = 1_400_000;
const MAX_PRIORITY_MICROLAMPORTS = 2_000_000;

async function simulateUnits(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }), ...instructions],
  }).compileToV0Message();
  const simulation = await connection.simulateTransaction(new VersionedTransaction(message), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  if (simulation.value.err) {
    throw new RingioTxError(describeTransactionError(simulation.value.err, simulation.value.logs));
  }
  const consumed = simulation.value.unitsConsumed ?? 200_000;
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(consumed * 1.2) + 5_000);
}

async function priorityFee(connection: Connection, instructions: TransactionInstruction[]): Promise<number> {
  const writable = [
    ...new Map(
      instructions.flatMap((ix) => ix.keys.filter((key) => key.isWritable).map((key) => [key.pubkey.toBase58(), key.pubkey])),
    ).values(),
  ].slice(0, 128);
  try {
    const fees = (await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writable }))
      .map((entry) => entry.prioritizationFee)
      .filter((fee) => fee > 0)
      .sort((left, right) => left - right);
    if (fees.length === 0) return 10_000;
    const p75 = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
    return Math.min(MAX_PRIORITY_MICROLAMPORTS, Math.max(10_000, p75));
  } catch {
    return 10_000;
  }
}

/**
 * Polls signature status instead of relying on a websocket subscription, so
 * confirmation works behind HTTP-only RPC proxies too.
 */
async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
): Promise<{ err: unknown } | null> {
  const deadline = Date.now() + 120_000;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const status = value[0];
    if (status?.err) return { err: status.err };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return null;
    if (attempt % 5 === 4 && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new RingioTxError("The transaction expired before it was confirmed. Nothing was charged — try again.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new RingioTxError("Confirmation is taking longer than expected. Check the explorer before retrying.");
}

export type TxStep = {
  /** Short label used in notifications, e.g. "Contribute". */
  label: string;
  instructions: TransactionInstruction[];
};

export function useRingioTx() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { cluster, network } = useNetwork();
  const toast = useToast();
  const ack = useMainnetAck();
  const { bump } = useDataVersion();
  const [busy, setBusy] = useState<string | null>(null);

  const send = useCallback(
    async (step: TxStep): Promise<string> => {
      const payer = wallet.publicKey;
      if (!payer || !wallet.sendTransaction) throw new RingioTxError("Connect a wallet first.");
      const units = await simulateUnits(connection, payer, step.instructions);
      const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
      if (network.realFunds) {
        budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityFee(connection, step.instructions) }));
      }
      const instructions = [...budget, ...step.instructions];
      const latest = await connection.getLatestBlockhash("confirmed");
      const supportsV0 = wallet.wallet?.adapter.supportedTransactionVersions?.has(0) ?? false;
      const transaction = supportsV0
        ? new VersionedTransaction(
            new TransactionMessage({ payerKey: payer, recentBlockhash: latest.blockhash, instructions }).compileToV0Message(),
          )
        : new Transaction({
            feePayer: payer,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          }).add(...instructions);

      const signature = await wallet.sendTransaction(transaction, connection, { maxRetries: 3 });
      const failure = await confirmSignature(connection, signature, latest.lastValidBlockHeight);
      if (failure) {
        const details = await connection
          .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
          .catch(() => null);
        throw new RingioTxError(describeTransactionError(failure.err, details?.meta?.logMessages));
      }
      return signature;
    },
    [connection, network.realFunds, wallet],
  );

  /**
   * Runs one or more transactions in order. Returns the confirmed signatures,
   * or null when the user cancelled or a step failed (already reported).
   */
  const run = useCallback(
    async (label: string, steps: TxStep[] | (() => Promise<TxStep[]>)): Promise<string[] | null> => {
      if (busy) return null;
      setBusy(label);
      const toastId = toast.push({ tone: "pending", title: `${label}…`, message: `Preparing on ${network.label}` });
      try {
        if (!wallet.publicKey) throw new RingioTxError("Connect a wallet first.");
        if (network.realFunds && !(await ack.request())) {
          toast.update(toastId, { tone: "error", title: `${label} cancelled`, message: "Mainnet risk acknowledgement declined." });
          return null;
        }
        const resolved = typeof steps === "function" ? await steps() : steps;
        const signatures: string[] = [];
        for (const [index, step] of resolved.entries()) {
          toast.update(toastId, {
            title: `${step.label}…`,
            message:
              resolved.length > 1
                ? `Approve transaction ${index + 1} of ${resolved.length} in your wallet (${network.label})`
                : `Approve in your wallet (${network.label})`,
          });
          signatures.push(await send(step));
        }
        const last = signatures[signatures.length - 1];
        toast.update(toastId, {
          tone: "success",
          title: `${label} confirmed`,
          message: `Confirmed on ${network.label}.`,
          href: last ? explorerUrl(cluster, "tx", last) : undefined,
        });
        bump();
        return signatures;
      } catch (error) {
        const message = error instanceof RingioTxError ? error.message : describeTransactionError(error);
        toast.update(toastId, { tone: "error", title: `${label} failed`, message });
        bump();
        return null;
      } finally {
        setBusy(null);
      }
    },
    [ack, bump, busy, cluster, network.label, network.realFunds, send, toast, wallet.publicKey],
  );

  return { run, busy };
}
