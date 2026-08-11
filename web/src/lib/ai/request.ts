import type { GroupLanguage } from "../groups/catalog";
import type { MatchConversationEntry } from "../groups/matcher";

export const AI_MATCH_LIMITS = {
  maxBodyChars: 12_000,
  maxMessageChars: 800,
  maxHistoryEntries: 8,
  maxHistoryEntryChars: 500,
  maxHistoryChars: 3_000,
} as const;

export type ValidMatchRequest = {
  message: string;
  history: MatchConversationEntry[];
  locale?: GroupLanguage;
};

export type MatchRequestValidation =
  | { ok: true; value: ValidMatchRequest }
  | { ok: false; code: "INVALID_BODY" | "MESSAGE_TOO_LONG" | "HISTORY_TOO_LONG"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function validateMatchRequest(value: unknown): MatchRequestValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["message", "history", "locale"])) {
    return {
      ok: false,
      code: "INVALID_BODY",
      message: "Expected only message, optional history, and optional locale.",
    };
  }

  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    return { ok: false, code: "INVALID_BODY", message: "message must be a non-empty string." };
  }
  if (value.message.length > AI_MATCH_LIMITS.maxMessageChars) {
    return {
      ok: false,
      code: "MESSAGE_TOO_LONG",
      message: `message must be at most ${AI_MATCH_LIMITS.maxMessageChars} characters.`,
    };
  }

  if (value.locale !== undefined && value.locale !== "tr" && value.locale !== "en") {
    return { ok: false, code: "INVALID_BODY", message: "locale must be tr or en." };
  }

  const historyValue = value.history ?? [];
  if (!Array.isArray(historyValue) || historyValue.length > AI_MATCH_LIMITS.maxHistoryEntries) {
    return {
      ok: false,
      code: "HISTORY_TOO_LONG",
      message: `history may contain at most ${AI_MATCH_LIMITS.maxHistoryEntries} entries.`,
    };
  }

  const history: MatchConversationEntry[] = [];
  let historyCharacters = 0;
  for (const entry of historyValue) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["role", "content"]) ||
      (entry.role !== "user" && entry.role !== "assistant") ||
      typeof entry.content !== "string" ||
      entry.content.trim().length === 0
    ) {
      return {
        ok: false,
        code: "INVALID_BODY",
        message: "Each history entry requires only a user/assistant role and non-empty content.",
      };
    }
    if (entry.content.length > AI_MATCH_LIMITS.maxHistoryEntryChars) {
      return {
        ok: false,
        code: "HISTORY_TOO_LONG",
        message: `Each history entry must be at most ${AI_MATCH_LIMITS.maxHistoryEntryChars} characters.`,
      };
    }
    historyCharacters += entry.content.length;
    history.push({ role: entry.role, content: entry.content.trim() });
  }

  if (historyCharacters > AI_MATCH_LIMITS.maxHistoryChars) {
    return {
      ok: false,
      code: "HISTORY_TOO_LONG",
      message: `Combined history must be at most ${AI_MATCH_LIMITS.maxHistoryChars} characters.`,
    };
  }

  return {
    ok: true,
    value: {
      message: value.message.trim(),
      history,
      ...(value.locale ? { locale: value.locale } : {}),
    },
  };
}

export function inferRequestLocale(value: unknown): GroupLanguage {
  if (isRecord(value) && (value.locale === "tr" || value.locale === "en")) return value.locale;
  if (!isRecord(value) || typeof value.message !== "string") return "en";
  return /[çğıöşü]/i.test(value.message) ||
    /\b(?:icin|istiyorum|ariyorum|butce|haftalik|aylik|uzaktan|grup)\b/i.test(value.message)
    ? "tr"
    : "en";
}
