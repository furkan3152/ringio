import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const AI_RATE_LIMIT = {
  requests: 10,
  windowMs: 60_000,
  maxBuckets: 2_000,
} as const;

type RateLimitBucket = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number = AI_RATE_LIMIT.requests,
    private readonly windowMs: number = AI_RATE_LIMIT.windowMs,
    private readonly maxBuckets: number = AI_RATE_LIMIT.maxBuckets,
  ) {}

  consume(key: string, now = Date.now()): RateLimitResult {
    this.removeExpired(now);
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= this.windowMs) {
      if (!bucket && this.buckets.size >= this.maxBuckets) this.removeOldest();
      bucket = { count: 0, windowStartedAt: now, lastSeenAt: now };
      this.buckets.set(key, bucket);
    }

    bucket.lastSeenAt = now;
    const resetAt = bucket.windowStartedAt + this.windowMs;
    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStartedAt >= this.windowMs) this.buckets.delete(key);
    }
  }

  private removeOldest(): void {
    let oldestKey: string | null = null;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < oldestSeen) {
        oldestKey = key;
        oldestSeen = bucket.lastSeenAt;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

declare global {
  // Reuse the small best-effort store across Next.js development reloads.
  var __ringioAiRateLimiter: InMemoryRateLimiter | undefined;
}

const limiter = globalThis.__ringioAiRateLimiter ?? new InMemoryRateLimiter();
globalThis.__ringioAiRateLimiter = limiter;

function parseTrustedIp(value: string | null): string | null {
  if (!value) return null;
  let candidate = value.split(",", 1)[0]?.trim() ?? "";
  const bracketedIpv6 = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6) candidate = bracketedIpv6[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate : null;
}

/**
 * Proxy IP headers are considered only on Vercel or after an explicit trusted
 * proxy opt-in. Client-supplied forwarding headers are otherwise ignored.
 * The resulting value is hashed and never logged.
 */
export function rateLimitIdentity(request: Request): string {
  const onVercel = process.env.VERCEL === "1";
  const trustConfiguredProxy = process.env.RINGIO_TRUST_PROXY_IP_HEADERS === "true";
  let ip: string | null = null;

  if (onVercel) {
    ip = parseTrustedIp(
      request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for"),
    );
  } else if (trustConfiguredProxy) {
    ip = parseTrustedIp(
      request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for"),
    );
  }

  const source = ip ? `ip:${ip}` : "shared:unverified-client";
  return createHash("sha256").update(source).digest("hex");
}

export function consumeAiRateLimit(request: Request): RateLimitResult {
  return limiter.consume(rateLimitIdentity(request));
}

/**
 * This limiter is deliberately best-effort. Serverless instances do not share
 * memory, so production must add a durable distributed limiter before exposing
 * a paid model key to untrusted traffic.
 */
export const RATE_LIMIT_DEPLOYMENT_NOTICE =
  "In-memory best effort only; use a durable distributed rate limiter before public paid-key production.";
