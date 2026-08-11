import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import { validateOpenRouterMatchOutput } from "../ai/openrouter";
import { findPrivacyIssue, findPrivacyIssueInText } from "../ai/privacy";
import { InMemoryRateLimiter } from "../ai/rate-limit";
import { validateMatchRequest } from "../ai/request";
import {
  GROUP_CODE_PATTERN,
  getPublicGroupByCode,
  groupCodeFromAddress,
  normalizeGroupCode,
  validatePublicGroupCatalog,
  type GroupCadence,
  type PublicGroup,
} from "./catalog";
import { matchPublicGroups } from "./matcher";

function address(seed: number): string {
  const bytes = new Uint8Array(32);
  bytes.fill(seed);
  return new PublicKey(bytes).toBase58();
}

function testGroup(
  seed: number,
  cadence: GroupCadence,
  contributionUsdc: number,
  filled: number,
  total: number,
): PublicGroup {
  const accountAddress = address(seed);
  const code = groupCodeFromAddress(accountAddress);
  return {
    code,
    accountAddress,
    mint: address(99),
    name: `Ringio ${code}`,
    description: { tr: "Zincir üstü test grubu.", en: "On-chain test group." },
    contributionUsdc,
    cadence,
    languages: [],
    location: { mode: "unspecified", city: null, countryCode: null },
    start: { isoDate: "2026-08-11T00:00:00.000Z", timezone: "UTC" },
    memberSlots: { total, filled, available: total - filled },
    postPayoutCollateral: {
      scope: "remaining-scheduled-contributions-after-payout",
      coveragePercent: 100,
      maximumUsdc: contributionUsdc * (total - 1),
    },
    interests: [],
    enrollmentStatus: filled === total ? "full" : "accepting-members",
    listingSource: "solana-devnet",
  };
}

const TEST_GROUPS = [
  testGroup(1, "weekly", 100, 4, 6),
  testGroup(2, "biweekly", 75, 4, 8),
  testGroup(3, "monthly", 100, 6, 6),
  testGroup(4, "monthly", 250, 4, 5),
] as const;

test("on-chain group codes are unique, derived, and structurally valid", () => {
  assert.deepEqual(validatePublicGroupCatalog(TEST_GROUPS), []);
  assert.equal(new Set(TEST_GROUPS.map((group) => group.code)).size, TEST_GROUPS.length);
  assert.equal(TEST_GROUPS.every((group) => GROUP_CODE_PATTERN.test(group.code)), true);
  const code = TEST_GROUPS[0].code;
  assert.equal(normalizeGroupCode(` ${code.toLowerCase()} `), code);
  assert.equal(normalizeGroupCode(code.replace("-", "")), code);
  assert.equal(normalizeGroupCode("not-a-code"), null);
  assert.equal(getPublicGroupByCode(TEST_GROUPS, code)?.accountAddress, TEST_GROUPS[0].accountAddress);
});

test("Turkish weekly budget preferences rank the matching on-chain group first", () => {
  const result = matchPublicGroups({
    message: "Haftalik ve en fazla 100 USDC butceli bir grup istiyorum",
    groups: TEST_GROUPS,
  });
  assert.equal(result.locale, "tr");
  assert.equal(result.matches[0]?.groupCode, TEST_GROUPS[0].code);
  assert.ok(result.matches[0]?.reasons.length);
  assert.ok(result.matches[0]?.tradeoffs.length);
});

test("English biweekly preferences rank the matching on-chain group first", () => {
  const result = matchPublicGroups({
    message: "I want a biweekly group with a budget up to 80 USDC",
    locale: "en",
    groups: TEST_GROUPS,
  });
  assert.equal(result.matches[0]?.groupCode, TEST_GROUPS[1].code);
  assert.ok(result.matches.every((match) => match.reasons.length <= 3));
  assert.ok(result.matches.every((match) => match.tradeoffs.length <= 2));
});

test("a full exact-code lookup is explained and never recommended", () => {
  const fullCode = TEST_GROUPS[2].code;
  const result = matchPublicGroups({ message: `Show me ${fullCode}`, locale: "en", groups: TEST_GROUPS });
  assert.equal(result.requestedCodeStatus, "unavailable");
  assert.ok(result.notice?.includes("not open to join"));
  assert.equal(result.matches.some((match) => match.groupCode === fullCode), false);
});

test("an unknown well-formed group code gets an explicit status", () => {
  const result = matchPublicGroups({ message: "RNG-FFFFFFFFFFFF", locale: "en", groups: TEST_GROUPS });
  assert.equal(result.requestedCodeStatus, "not-found");
  assert.ok(result.answer.includes("could not find"));
});

test("an explicit maximum contribution is a hard eligibility constraint", () => {
  const result = matchPublicGroups({
    message: "I need a weekly group with a maximum budget of 30 USDC",
    locale: "en",
    groups: TEST_GROUPS,
  });
  assert.deepEqual(result.matches, []);
  assert.ok(result.answer.includes("no eligible on-chain devnet groups"));
});

test("fallback output is deterministic for the same input and account set", () => {
  const input = {
    message: "Iki haftada bir ve 90 USDC civari bir grup",
    locale: "tr" as const,
    groups: TEST_GROUPS,
  };
  assert.deepEqual(matchPublicGroups(input), matchPublicGroups(input));
});

test("privacy guard blocks contact/auth data but permits a public group code", () => {
  assert.equal(findPrivacyIssueInText(TEST_GROUPS[0].code), null);
  assert.equal(findPrivacyIssueInText("person@example.com")?.kind, "email-address");
  assert.equal(findPrivacyIssueInText("call +90 555 111 22 33")?.kind, "phone-number");
  assert.equal(findPrivacyIssueInText(`wallet ${"A".repeat(32)}`)?.kind, "wallet-address");
  assert.equal(findPrivacyIssueInText("my private key is here")?.kind, "wallet-secret");
  assert.equal(findPrivacyIssue({ message: "weekly", wallet: "omitted" })?.kind, "sensitive-field");
});

test("request validation bounds message and history and rejects extra fields", () => {
  assert.equal(validateMatchRequest({ message: "weekly", history: [] }).ok, true);
  assert.equal(validateMatchRequest({ message: "x".repeat(801) }).ok, false);
  assert.equal(
    validateMatchRequest({ message: "weekly", history: Array.from({ length: 9 }, () => ({ role: "user", content: "x" })) }).ok,
    false,
  );
  assert.equal(validateMatchRequest({ message: "weekly", wallet: "anything" }).ok, false);
});

test("in-memory limiter enforces its window and resets deterministically", () => {
  const limiter = new InMemoryRateLimiter(2, 1_000, 4);
  assert.equal(limiter.consume("client", 0).allowed, true);
  assert.equal(limiter.consume("client", 1).allowed, true);
  const blocked = limiter.consume("client", 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume("client", 1_000).allowed, true);
});

test("OpenRouter output accepts only allowlisted on-chain codes and bounded explanations", () => {
  const valid = {
    answer: "A concise result.",
    matches: [{ groupCode: TEST_GROUPS[0].code, reasons: ["Cadence fits."], tradeoffs: ["Review collateral."] }],
  };
  assert.deepEqual(validateOpenRouterMatchOutput(valid, new Set([TEST_GROUPS[0].code])), valid);
  assert.equal(validateOpenRouterMatchOutput(valid, new Set([TEST_GROUPS[1].code])), null);
  assert.equal(
    validateOpenRouterMatchOutput({ ...valid, matches: [{ ...valid.matches[0], reasons: ["x".repeat(161)] }] }, new Set([TEST_GROUPS[0].code])),
    null,
  );
  assert.equal(validateOpenRouterMatchOutput({ ...valid, answer: "This group guarantees profit with zero risk." }, new Set([TEST_GROUPS[0].code])), null);
});
