export type DurationUnit = "minutes" | "hours" | "days" | "weeks";
export type DurationValue = { value: string; unit: DurationUnit };

const UNIT_SECONDS: Readonly<Record<DurationUnit, number>> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
  weeks: 7 * 24 * 60 * 60,
};

/** Converts a whole-number duration to seconds; null for empty, fractional, zero, or unsafe input. */
export function durationSeconds(duration: DurationValue): number | null {
  if (!/^\d+$/.test(duration.value.trim())) return null;
  const value = Number(duration.value);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value * UNIT_SECONDS[duration.unit];
}

export function periodLabel(seconds: number, locale: "en" | "tr" = "en"): string {
  const units = [
    [7 * 24 * 60 * 60, "week", "hafta"],
    [24 * 60 * 60, "day", "gün"],
    [60 * 60, "hour", "saat"],
    [60, "minute", "dakika"],
  ] as const;

  for (const [unitSeconds, englishName, turkishName] of units) {
    if (seconds >= unitSeconds && seconds % unitSeconds === 0) {
      const value = seconds / unitSeconds;
      if (locale === "tr") return `${value} ${turkishName}`;
      return `${value} ${englishName}${value === 1 ? "" : "s"}`;
    }
  }

  return locale === "tr" ? `${seconds} saniye` : `${seconds} seconds`;
}
