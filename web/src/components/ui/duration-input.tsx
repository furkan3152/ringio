"use client";

import type { DurationUnit, DurationValue } from "@/lib/duration";

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
