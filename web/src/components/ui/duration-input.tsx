"use client";

export type DurationUnit = "minutes" | "hours" | "days" | "weeks";

export const UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
  weeks: 604_800,
};

export type DurationValue = { value: string; unit: DurationUnit };

export function durationSeconds(duration: DurationValue): number | null {
  if (!/^\d+$/.test(duration.value.trim())) return null;
  const value = Number(duration.value);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value * UNIT_SECONDS[duration.unit];
}

export function DurationInput({
  id,
  value,
  onChange,
  units = ["minutes", "hours", "days", "weeks"],
  invalid,
  describedBy,
}: {
  id: string;
  value: DurationValue;
  onChange(next: DurationValue): void;
  units?: DurationUnit[];
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="field-row" style={{ marginTop: 0, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
      <input
        id={id}
        className="input mono"
        inputMode="numeric"
        autoComplete="off"
        value={value.value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange({ ...value, value: event.target.value.replace(/[^\d]/g, "") })}
      />
      <select
        className="select"
        aria-label="Unit"
        value={value.unit}
        onChange={(event) => onChange({ ...value, unit: event.target.value as DurationUnit })}
      >
        {units.map((unit) => (
          <option key={unit} value={unit}>
            {unit[0].toUpperCase() + unit.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
