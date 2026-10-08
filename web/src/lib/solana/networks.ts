import { PublicKey } from "@solana/web3.js";

/**
 * Ringio supports three Solana clusters. Every value below can be overridden
 * per deployment through public environment variables; the defaults are the
 * public endpoints and canonical Circle USDC mints.
 *
 * Next.js only inlines `NEXT_PUBLIC_*` variables that are referenced
 * literally, so each variable is spelled out instead of built dynamically.
 */
export const CLUSTER_IDS = ["mainnet-beta", "devnet", "testnet"] as const;
export type ClusterId = (typeof CLUSTER_IDS)[number];

export const DEFAULT_PROGRAM_ID = "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy";

/** Canonical Circle USDC mints (6 decimals). Solana testnet has no Circle mint. */
export const CANONICAL_USDC: Readonly<Record<ClusterId, string | null>> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  testnet: null,
};

export type StableAsset = {
  mint: string;
  symbol: string;
  /** True only for the canonical Circle USDC mint on this cluster. */
  canonical: boolean;
};

export type NetworkConfig = {
  id: ClusterId;
  label: string;
  /** Short uppercase badge text. */
  badge: string;
  /** Public browser RPC used for reads and for submitting signed transactions. */
  rpcUrl: string;
  programId: string;
  asset: StableAsset | null;
  /** Real-value network: requires an explicit risk acknowledgement before signing. */
  realFunds: boolean;
  description: string;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validPublicKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return undefined;
  }
}

function asset(cluster: ClusterId, configured: string | undefined): StableAsset | null {
  const mint = validPublicKey(clean(configured)) ?? CANONICAL_USDC[cluster];
  if (!mint) return null;
  const canonical = mint === CANONICAL_USDC[cluster];
  return { mint, symbol: canonical ? "USDC" : "Test token", canonical };
}

const PUBLIC_RPC: Readonly<Record<ClusterId, string>> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
};

export const NETWORKS: Readonly<Record<ClusterId, NetworkConfig>> = {
  "mainnet-beta": {
    id: "mainnet-beta",
    label: "Mainnet",
    badge: "MAINNET",
    rpcUrl: clean(process.env.NEXT_PUBLIC_RPC_URL_MAINNET) ?? PUBLIC_RPC["mainnet-beta"],
    programId:
      validPublicKey(clean(process.env.NEXT_PUBLIC_PROGRAM_ID_MAINNET)) ?? DEFAULT_PROGRAM_ID,
    asset: asset("mainnet-beta", process.env.NEXT_PUBLIC_USDC_MINT_MAINNET),
    realFunds: true,
    description: "Real USDC. Transactions are final and cost real SOL.",
  },
  devnet: {
    id: "devnet",
    label: "Devnet",
    badge: "DEVNET",
    rpcUrl:
      clean(process.env.NEXT_PUBLIC_RPC_URL_DEVNET) ??
      clean(process.env.NEXT_PUBLIC_SOLANA_RPC_URL) ??
      PUBLIC_RPC.devnet,
    programId:
      validPublicKey(clean(process.env.NEXT_PUBLIC_PROGRAM_ID_DEVNET)) ??
      validPublicKey(clean(process.env.NEXT_PUBLIC_RINGIO_PROGRAM_ID)) ??
      DEFAULT_PROGRAM_ID,
    asset: asset("devnet", process.env.NEXT_PUBLIC_USDC_MINT_DEVNET ?? process.env.NEXT_PUBLIC_USDC_MINT),
    realFunds: false,
    description: "Test network. Devnet USDC has no value.",
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    badge: "TESTNET",
    rpcUrl: clean(process.env.NEXT_PUBLIC_RPC_URL_TESTNET) ?? PUBLIC_RPC.testnet,
    programId:
      validPublicKey(clean(process.env.NEXT_PUBLIC_PROGRAM_ID_TESTNET)) ?? DEFAULT_PROGRAM_ID,
    asset: asset("testnet", process.env.NEXT_PUBLIC_USDC_MINT_TESTNET),
    realFunds: false,
    description: "Validator test network. Tokens have no value.",
  },
};

export function isClusterId(value: unknown): value is ClusterId {
  return typeof value === "string" && (CLUSTER_IDS as readonly string[]).includes(value);
}

/** Accepts common aliases such as `mainnet` and normalizes them. */
export function parseClusterId(value: string | null | undefined): ClusterId | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "mainnet-beta") return "mainnet-beta";
  return isClusterId(normalized) ? normalized : null;
}

function enabledClusters(): ClusterId[] {
  const raw = clean(process.env.NEXT_PUBLIC_ENABLED_CLUSTERS);
  if (!raw) return [...CLUSTER_IDS];
  const parsed = raw
    .split(",")
    .map((entry) => parseClusterId(entry))
    .filter((entry): entry is ClusterId => entry !== null);
  return parsed.length > 0 ? [...new Set(parsed)] : [...CLUSTER_IDS];
}

export const ENABLED_CLUSTERS: readonly ClusterId[] = enabledClusters();

export const DEFAULT_CLUSTER: ClusterId = (() => {
  const configured =
    parseClusterId(process.env.NEXT_PUBLIC_DEFAULT_CLUSTER) ??
    parseClusterId(process.env.NEXT_PUBLIC_SOLANA_CLUSTER) ??
    "devnet";
  return ENABLED_CLUSTERS.includes(configured) ? configured : ENABLED_CLUSTERS[0];
})();

export function explorerUrl(
  cluster: ClusterId,
  kind: "address" | "tx",
  value: string,
): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}

/**
 * Server-side reads may use a private RPC (for example a keyed Helius URL)
 * that must never be shipped to the browser.
 */
export function serverRpcUrl(cluster: ClusterId): string {
  const privateUrl =
    cluster === "mainnet-beta"
      ? clean(process.env.SOLANA_RPC_URL_MAINNET)
      : cluster === "devnet"
        ? clean(process.env.SOLANA_RPC_URL_DEVNET) ?? clean(process.env.SOLANA_RPC_URL)
        : clean(process.env.SOLANA_RPC_URL_TESTNET);
  return privateUrl ?? NETWORKS[cluster].rpcUrl;
}
