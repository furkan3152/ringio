import { NextResponse } from "next/server";
import {
  mergeOpenRouterMatches,
  openRouterCapability,
  requestOpenRouterMatch,
} from "@/lib/ai/openrouter";
import { findPrivacyIssue, privacySafeResponse } from "@/lib/ai/privacy";
import {
  consumeAiRateLimit,
  RATE_LIMIT_DEPLOYMENT_NOTICE,
  AI_RATE_LIMIT,
  type RateLimitResult,
} from "@/lib/ai/rate-limit";
import {
  AI_MATCH_LIMITS,
  inferRequestLocale,
  validateMatchRequest,
} from "@/lib/ai/request";
import { getEligiblePublicGroups } from "@/lib/groups/catalog";
import { fetchOnchainGroups, RINGIO_PROGRAM_ID } from "@/lib/groups/onchain";
import { matchPublicGroups } from "@/lib/groups/matcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
  };
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

export async function GET() {
  const capability = openRouterCapability();
  let groups;
  try {
    groups = await fetchOnchainGroups();
  } catch {
    return json({
      status: "degraded",
      capability: "onchain-group-discovery",
      mode: "rpc-unavailable",
      groups: 0,
      message: "No mock fallback is enabled.",
    }, 503);
  }
  return json({
    status: "ok",
    capability: "onchain-group-discovery",
    mode: capability.configured ? "openrouter-with-deterministic-fallback" : "deterministic",
    catalog: {
      mode: "solana-devnet",
      programId: RINGIO_PROGRAM_ID.toBase58(),
      eligibleGroups: getEligiblePublicGroups(groups).length,
      onchainEnrollment: true,
      groupCodeNotice: "A group code is a public identifier, not authentication or join authorization.",
    },
    provider: capability,
    privacy: {
      acceptedPreferences: ["contribution", "cadence", "language", "location", "start", "member-count", "interests"],
      rejectedData: ["wallet-address", "phone", "email", "wallet-secret", "secret-invite-data"],
      historySentUpstream: false,
    },
    limits: {
      ...AI_MATCH_LIMITS,
      requestsPerWindow: AI_RATE_LIMIT.requests,
      rateLimitWindowMs: AI_RATE_LIMIT.windowMs,
    },
    productionNotice: RATE_LIMIT_DEPLOYMENT_NOTICE,
  });
}

export async function POST(request: Request) {
  const rateLimit = consumeAiRateLimit(request);
  if (!rateLimit.allowed) {
    return json(
      {
        code: "RATE_LIMITED",
        mode: "rate-limited",
        answer: "Too many requests. Wait briefly before trying the group matcher again.",
        matches: [],
      },
      429,
      {
        ...rateLimitHeaders(rateLimit),
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(
      { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json." },
      415,
      rateLimitHeaders(rateLimit),
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > AI_MATCH_LIMITS.maxBodyChars) {
    return json(
      { code: "BODY_TOO_LARGE", message: `Request body must be at most ${AI_MATCH_LIMITS.maxBodyChars} characters.` },
      413,
      rateLimitHeaders(rateLimit),
    );
  }

  let parsed: unknown;
  try {
    const raw = await request.text();
    if (raw.length > AI_MATCH_LIMITS.maxBodyChars) {
      return json(
        { code: "BODY_TOO_LARGE", message: `Request body must be at most ${AI_MATCH_LIMITS.maxBodyChars} characters.` },
        413,
        rateLimitHeaders(rateLimit),
      );
    }
    parsed = JSON.parse(raw);
  } catch {
    return json(
      { code: "INVALID_JSON", message: "Request body must be valid JSON." },
      400,
      rateLimitHeaders(rateLimit),
    );
  }

  const locale = inferRequestLocale(parsed);
  const privacyIssue = findPrivacyIssue(parsed);
  if (privacyIssue) {
    // A privacy block is an intentional, usable chat response. No catalog
    // retrieval or model call occurs after this branch.
    return json(
      {
        code: "PRIVACY_BLOCKED",
        mode: "privacy-blocked",
        answer: privacySafeResponse(locale),
        matches: [],
      },
      200,
      rateLimitHeaders(rateLimit),
    );
  }

  const validation = validateMatchRequest(parsed);
  if (!validation.ok) {
    return json(
      { code: validation.code, message: validation.message },
      400,
      rateLimitHeaders(rateLimit),
    );
  }

  // Eligibility is resolved locally before any optional model call. Full and
  // closed groups can never enter the model allowlist or the response matches.
  let groups;
  try {
    groups = await fetchOnchainGroups();
  } catch {
    return json(
      {
        code: "SOLANA_RPC_UNAVAILABLE",
        mode: "rpc-unavailable",
        answer: "Ringio could not verify current devnet groups. No mock recommendations were returned.",
        matches: [],
      },
      503,
      rateLimitHeaders(rateLimit),
    );
  }

  const deterministic = matchPublicGroups({
    message: validation.value.message,
    groups,
    history: validation.value.history,
    locale: validation.value.locale,
    limit: 5,
  });

  const canUseAiForRequest =
    deterministic.requestedCodeStatus !== "unavailable" &&
    deterministic.requestedCodeStatus !== "constraint-mismatch" &&
    deterministic.requestedCodeStatus !== "not-found";
  const aiOutput = canUseAiForRequest
    ? await requestOpenRouterMatch({
        message: validation.value.message,
        locale: deterministic.locale,
        candidates: deterministic.matches,
      })
    : null;

  const usedOpenRouter = aiOutput !== null;
  const matches = usedOpenRouter
    ? mergeOpenRouterMatches(aiOutput, deterministic.matches)
    : deterministic.matches.slice(0, 3);

  return json(
    {
      answer: aiOutput?.answer ?? deterministic.answer,
      mode: usedOpenRouter ? "openrouter" : "deterministic",
      matches,
      locale: deterministic.locale,
      notice: deterministic.notice,
      requestedCodeStatus: deterministic.requestedCodeStatus,
      catalogMode: "solana-devnet",
      programId: RINGIO_PROGRAM_ID.toBase58(),
      groupCodeNotice: "Public discovery identifier only; never an authentication or invite credential.",
    },
    200,
    rateLimitHeaders(rateLimit),
  );
}
