export const MAX_PERIOD_SECONDS = 366 * 24 * 60 * 60;

export type PeriodPreset = "weekly" | "monthly";
export type CustomPeriodUnit = "minutes" | "hours" | "days" | "weeks";

const UNIT_SECONDS: Readonly<Record<CustomPeriodUnit, number>> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
  weeks: 7 * 24 * 60 * 60,
};

export function presetPeriodSeconds(preset: PeriodPreset): number {
  return preset === "weekly" ? 7 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
}

export function customPeriodSeconds(rawValue: string, unit: CustomPeriodUnit): number | null {
  const normalized = rawValue.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value <= 0) return null;

  const seconds = value * UNIT_SECONDS[unit];
  if (!Number.isSafeInteger(seconds) || seconds > MAX_PERIOD_SECONDS) return null;
  return seconds;
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
