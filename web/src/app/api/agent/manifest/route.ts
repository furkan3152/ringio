import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const programId =
    process.env.NEXT_PUBLIC_RINGIO_PROGRAM_ID ??
    "JBhfRyHLDdTyGKz78hzeA26kKmtwd37PFkX3tvwmbmYy";
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

  return NextResponse.json(
    {
      project: "Ringio",
      version: "0.1.0",
      cluster,
      programId,
      transactionMode: "read-only",
      supportedActions: [
        { name: "inspect_circle", capability: "read-only" },
        { name: "preview_contribution", capability: "simulation" },
        { name: "preview_settlement", capability: "simulation" },
      ],
      collateralGuarantee: {
        model: "declining_post_payout_obligation",
        covers: "A recipient's unpaid scheduled contributions after payout.",
        excludes:
          "Pre-payout missed contributions, smart-contract risk, token risk, and transaction execution guarantees.",
      },
      signableTransactions: false,
      notice:
        "Capability discovery only. This endpoint does not claim Solana Actions compliance and never returns a transaction to sign.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
