import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

import {
  getEligiblePublicGroups,
  getPublicGroupByCode,
  isGroupEligible,
  normalizeGroupCode,
} from "@/lib/groups/catalog";
import { fetchOnchainGroups, ProgramUnavailableError, programIdFor } from "@/lib/groups/onchain";
import { DEFAULT_CLUSTER, ENABLED_CLUSTERS, parseClusterId } from "@/lib/solana/networks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GROUP_CODE_NOTICE =
  "Public identifier derived from the Group account; it is not authentication, an invite credential, or join authorization.";
const HEADERS = {
  "Cache-Control": "public, max-age=10, stale-while-revalidate=20",
  "X-Content-Type-Options": "nosniff",
};

function error(status: number, code: string, message: string) {
  return NextResponse.json(
    { code, message, groups: [] },
    { status, headers: { ...HEADERS, "Cache-Control": "no-store" } },
  );
}

/**
 * GET /api/groups?cluster=devnet[&wallet=PUBKEY][&code=RNG-…][&eligibleOnly=true]
 * Without `wallet`, lists circles that are still forming (discovery).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedCluster = url.searchParams.get("cluster");
  const cluster = requestedCluster === null ? DEFAULT_CLUSTER : parseClusterId(requestedCluster);
  if (!cluster || !ENABLED_CLUSTERS.includes(cluster)) {
    return error(400, "INVALID_CLUSTER", `cluster must be one of ${ENABLED_CLUSTERS.join(", ")}.`);
  }

  let wallet: string | undefined;
  const requestedWallet = url.searchParams.get("wallet");
  if (requestedWallet !== null) {
    try {
      wallet = new PublicKey(requestedWallet).toBase58();
    } catch {
      return error(400, "INVALID_WALLET", "wallet must be a valid Solana public key.");
    }
  }

  try {
    const groups = await fetchOnchainGroups(cluster, { wallet });
    const meta = {
      catalogMode: `solana-${cluster}`,
      cluster,
      programId: programIdFor(cluster).toBase58(),
      groupCodeNotice: GROUP_CODE_NOTICE,
    };

    const requestedCode = url.searchParams.get("code");
    if (requestedCode !== null) {
      const normalizedCode = normalizeGroupCode(requestedCode);
      if (!normalizedCode) {
        return error(400, "INVALID_GROUP_CODE", "Group codes use the RNG- plus 12 hexadecimal character format.");
      }
      const group = getPublicGroupByCode(groups, normalizedCode);
      if (!group) return error(404, "GROUP_NOT_FOUND", `No forming Group account resolves to ${normalizedCode}.`);
      return NextResponse.json({ ...meta, group, eligible: isGroupEligible(group) }, { headers: HEADERS });
    }

    const eligibleOnly = url.searchParams.get("eligibleOnly") === "true";
    const listed = eligibleOnly ? getEligiblePublicGroups(groups) : groups;
    return NextResponse.json(
      { ...meta, groups: listed, total: listed.length, eligibleTotal: getEligiblePublicGroups(groups).length },
      { headers: HEADERS },
    );
  } catch (caught) {
    if (caught instanceof ProgramUnavailableError) {
      return error(404, "PROGRAM_UNAVAILABLE", caught.message);
    }
    console.error("Failed to load Ringio Group accounts", caught);
    return error(503, "SOLANA_RPC_UNAVAILABLE", `Ringio could not verify ${cluster} Group accounts. No mock data was returned.`);
  }
}
