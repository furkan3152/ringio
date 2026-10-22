/** Exact conversions between raw token units (bigint) and decimal strings. */

export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const normalized = input.trim().replace(/,/g, ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  const raw = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return raw;
}

export function formatTokenAmount(raw: bigint, decimals: number, options: { minFraction?: number } = {}): string {
  const negative = raw < BigInt(0);
  const absolute = negative ? -raw : raw;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0");
  const minFraction = Math.min(options.minFraction ?? 2, decimals);
  let trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length < minFraction) trimmed = trimmed.padEnd(minFraction, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${trimmed ? `.${trimmed}` : ""}`;
}

/** Lossy conversion for charts and ratios only; never use for value movement. */
export function tokenToNumber(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}
