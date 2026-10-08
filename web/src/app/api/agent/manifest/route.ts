import { NextResponse } from "next/server";

import { DEFAULT_CLUSTER, ENABLED_CLUSTERS, NETWORKS } from "@/lib/solana/networks";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      project: "Ringio",
      version: "0.2.0",
      defaultCluster: DEFAULT_CLUSTER,
      networks: ENABLED_CLUSTERS.map((id) => ({
        cluster: id,
        programId: NETWORKS[id].programId,
        assetMint: NETWORKS[id].asset?.mint ?? null,
        realFunds: NETWORKS[id].realFunds,
      })),
      transactionMode: "wallet-signed-in-browser",
      supportedActions: [
        { name: "inspect_circle", capability: "read-only", endpoint: "/api/groups?cluster=<cluster>" },
        { name: "create_circle", capability: "wallet-signed", surface: "/create" },
        { name: "join_contribute_settle_refund", capability: "wallet-signed", surface: "/circles/<group-address>" },
      ],
      collateralGuarantee: {
        model: "declining_post_payout_obligation",
        covers: "A recipient's unpaid scheduled contributions after payout.",
        excludes:
          "Pre-payout missed contributions, smart-contract risk, token risk, and transaction execution guarantees.",
      },
      signableTransactions: false,
      notice:
        "Capability discovery only. Transactions are built and signed in the user's browser wallet; this endpoint never returns a transaction to sign and does not claim Solana Actions compliance.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
