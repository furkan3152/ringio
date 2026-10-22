/** Mirrors `programs/ringio/src/error.rs`; Anchor numbers custom errors from 6000. */
export const RINGIO_ERRORS = [
  ["ProtocolPaused", "Ringio is paused by the pause authority. Refunds stay available."],
  ["Unauthorized", "This wallet is not allowed to perform that action."],
  ["InvalidGroupState", "The circle is not in the right stage for this action. Refresh and try again."],
  ["InvalidMemberCount", "A circle needs between 2 and 32 members."],
  ["InvalidContributionAmount", "The contribution must be greater than zero."],
  ["InvalidDuration", "Every period and window must be between 1 second and 366 days."],
  ["InvalidDeadline", "That deadline has passed or is invalid."],
  ["GroupFull", "The circle is already full."],
  ["InvalidInvite", "This wallet has no valid, unused invitation to the circle."],
  ["DuplicateMember", "This wallet is already part of the circle."],
  ["InvalidCommitment", "The payout-order commitment is invalid."],
  ["CommitmentMismatch", "The revealed secret does not match the commitment made when joining."],
  ["AlreadyRevealed", "You already revealed your secret."],
  ["RevealIncomplete", "Not every member has revealed yet."],
  ["OrderNotFinalized", "The payout order is not final yet."],
  ["MemberNotRanked", "This wallet is not in the payout order."],
  ["CollateralAlreadyPosted", "Protection is already posted for this wallet."],
  ["CollateralIncomplete", "Not every member has posted protection yet."],
  ["CollateralVaultShortfall", "The protection vault holds less than the tracked requirement."],
  ["ContributionAlreadyResolved", "This turn's contribution is already recorded."],
  ["ContributionWindowClosed", "The contribution window for this turn has closed."],
  ["GracePeriodActive", "The grace period is still running."],
  ["DefaultNotCoverable", "This missed contribution cannot be covered from protection."],
  ["DefaultIsCoverable", "This missed contribution can be covered from protection instead."],
  ["RoundIncomplete", "Not every contribution for this turn is in yet."],
  ["WrongRecipient", "That wallet is not the next recipient in the payout order."],
  ["PayoutAlreadyReceived", "This payout has already been made."],
  ["NothingToRefund", "There is nothing to refund for this wallet."],
  ["PendingRoundRefunds", "Refund the failed turn's contributions before protection refunds."],
  ["CancellationNotAllowed", "The circle cannot be cancelled yet."],
  ["WrongMint", "The token account uses a different asset than this circle."],
  ["WrongTokenAuthority", "The token account belongs to a different wallet."],
  ["WrongVault", "That is not this circle's vault."],
  ["MathOverflow", "The amounts overflow the supported range."],
  ["InvariantViolation", "The program rejected an inconsistent state."],
] as const;

const ANCHOR_FRAMEWORK_ERRORS: Readonly<Record<number, string>> = {
  2006: "A program address did not match its expected seeds.",
  3007: "An account is owned by the wrong program.",
  3012: "A required account does not exist yet — for example, this wallet has no token account for the circle asset, or no invitation.",
};

function customCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const instructionError = (error as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length < 2) return null;
  const detail = instructionError[1] as { Custom?: unknown } | string;
  if (typeof detail === "object" && detail !== null && typeof detail.Custom === "number") return detail.Custom;
  return null;
}

function codeFromLogs(logs: readonly string[] | null | undefined): number | null {
  for (const line of logs ?? []) {
    const anchor = line.match(/Error Number: (\d+)/);
    if (anchor) return Number(anchor[1]);
  }
  return null;
}

function codeFromMessage(error: unknown): number | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const hex = message.match(/custom program error: 0x([0-9a-f]+)/i);
  return hex ? parseInt(hex[1], 16) : null;
}

const GENERIC_FAILURE = "The transaction failed. Check the explorer for details.";

/** Turns a transaction error (and optional simulation logs) into user copy. */
export function describeTransactionError(error: unknown, logs?: readonly string[] | null): string {
  const code = codeFromLogs(logs) ?? customCode(error) ?? codeFromMessage(error);
  if (code !== null) {
    if (code >= 6000 && code < 6000 + RINGIO_ERRORS.length) return RINGIO_ERRORS[code - 6000][1];
    if (ANCHOR_FRAMEWORK_ERRORS[code]) return ANCHOR_FRAMEWORK_ERRORS[code];
    const joined = (logs ?? []).join("\n");
    if (code === 1 && joined.includes("Tokenkeg")) return "Not enough tokens in your wallet for this step.";
    if (code === 0 && joined.includes("already in use")) {
      return "That account already exists — for example, the wallet was already invited.";
    }
  }

  const joinedLogs = (logs ?? []).join("\n");
  if (joinedLogs.includes("insufficient funds")) return "Not enough tokens in your wallet for this step.";
  if (joinedLogs.includes("AccountNotInitialized") || joinedLogs.includes("account does not exist")) {
    return "A required token account does not exist. Make sure this wallet holds the circle asset.";
  }

  if (error === "AccountNotFound") return "This wallet has no SOL on this network to pay fees.";
  if (error === "InsufficientFundsForFee" || error === "InsufficientFundsForRent") {
    return "Not enough SOL to pay network fees and account rent.";
  }
  if (error === "BlockhashNotFound") return "The network moved on before the transaction landed. Try again.";

  // Wallet adapter errors wrap the underlying wallet/RPC error in `.error`.
  const inner = error && typeof error === "object" ? (error as { error?: unknown }).error : undefined;
  if (inner && inner !== error) {
    const innerLogs = (inner as { logs?: string[]; transactionLogs?: string[] }).logs ?? (inner as { transactionLogs?: string[] }).transactionLogs;
    const innerMessage = describeTransactionError(inner, innerLogs ?? logs);
    if (innerMessage !== GENERIC_FAILURE) return innerMessage;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/user rejected|rejected the request|declined/i.test(message)) return "You declined the request in your wallet.";
  if (/blockhash|expired/i.test(message)) return "The transaction expired before confirmation. Try again.";
  if (/403|429|rate/i.test(message)) return "The RPC endpoint is rate-limiting requests. Try again shortly.";
  return message || GENERIC_FAILURE;
}
