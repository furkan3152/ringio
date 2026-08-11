const EMPTY_VALUE = "--";

const usdcFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  notation: "standard",
  useGrouping: true,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  notation: "standard",
  useGrouping: true,
});

function normalize(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

/** Formats a human-readable USDC token quantity. The `USDC` unit stays in the caller. */
export function formatUsdc(value: number | null | undefined) {
  const normalized = normalize(value);
  return normalized == null ? EMPTY_VALUE : usdcFormatter.format(normalized);
}

export function formatPercent(value: number | null | undefined) {
  const normalized = normalize(value);
  return normalized == null
    ? EMPTY_VALUE
    : `${percentFormatter.format(normalized)}%`;
}
