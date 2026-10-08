"use client";

import type { ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

import { DataVersionProvider } from "@/components/providers/data-version";
import { MainnetAckProvider } from "@/components/providers/mainnet-ack";
import { NetworkProvider, useNetwork } from "@/components/providers/network-provider";
import { ToastProvider } from "@/components/providers/toast-provider";

const CONNECTION_CONFIG = { commitment: "confirmed" } as const;

function SolanaProviders({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  return (
    <ConnectionProvider endpoint={network.rpcUrl} config={CONNECTION_CONFIG}>
      {/* Wallet Standard wallets (Phantom, Solflare, Backpack, …) register themselves. */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <SolanaProviders>
        <DataVersionProvider>
          <ToastProvider>
            <MainnetAckProvider>{children}</MainnetAckProvider>
          </ToastProvider>
        </DataVersionProvider>
      </SolanaProviders>
    </NetworkProvider>
  );
}
