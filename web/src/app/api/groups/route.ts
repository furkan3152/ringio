import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  getEligiblePublicGroups,
  getPublicGroupByCode,
  isGroupEligible,
  normalizeGroupCode,
} from "@/lib/groups/catalog";
import { fetchOnchainGroups, RINGIO_PROGRAM_ID } from "@/lib/groups/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUP_CODE_NOTICE =
  "Public identifier derived from the Group account; it is not authentication, an invite credential, or join authorization.";
const HEADERS = {
  "Cache-Control": "public, max-age=10, stale-while-revalidate=20",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedCode = url.searchParams.get("code");
  const requestedWallet = url.searchParams.get("wallet");

  let wallet: string | null = null;
  if (requestedWallet !== null) {
    try {
      wallet = new PublicKey(requestedWallet).toBase58();
    } catch {
      return NextResponse.json(
        { code: "INVALID_WALLET", message: "wallet must be a valid Solana public key." },
        { status: 400, headers: HEADERS },
      );
    }
  }

  try {
    const allGroups = await fetchOnchainGroups();
    const walletGroups = wallet
      ? allGroups.filter((group) => group.members.some((member) => member.wallet === wallet))
      : allGroups;

    if (requestedCode !== null) {
      const normalizedCode = normalizeGroupCode(requestedCode);
      if (!normalizedCode) {
        return NextResponse.json(
          { code: "INVALID_GROUP_CODE", message: "Group codes use the RNG- plus 12 hexadecimal character format." },
          { status: 400, headers: HEADERS },
        );
      }
      const group = getPublicGroupByCode(walletGroups, normalizedCode);
      if (!group) {
        return NextResponse.json(
          { code: "GROUP_NOT_FOUND", message: `No on-chain Group account resolves to ${normalizedCode}.` },
          { status: 404, headers: HEADERS },
        );
      }
      return NextResponse.json(
        {
          catalogMode: "solana-devnet",
          programId: RINGIO_PROGRAM_ID.toBase58(),
          group,
          eligible: isGroupEligible(group),
          groupCodeNotice: GROUP_CODE_NOTICE,
        },
        { headers: HEADERS },
      );
    }

    const eligibleOnly = url.searchParams.get("eligibleOnly") === "true";
    const groups = eligibleOnly ? getEligiblePublicGroups(walletGroups) : walletGroups;
    return NextResponse.json(
      {
        catalogMode: "solana-devnet",
        programId: RINGIO_PROGRAM_ID.toBase58(),
        groups,
        total: groups.length,
        eligibleTotal: getEligiblePublicGroups(walletGroups).length,
        groupCodeNotice: GROUP_CODE_NOTICE,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    console.error("Failed to load Ringio Group accounts", error);
    return NextResponse.json(
      {
        code: "SOLANA_RPC_UNAVAILABLE",
        message: "Ringio could not verify devnet Group accounts. No fallback or mock groups were returned.",
        groups: [],
      },
      { status: 503, headers: { ...HEADERS, "Cache-Control": "no-store" } },
    );
  }
}
