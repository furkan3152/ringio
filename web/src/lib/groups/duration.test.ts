import assert from "node:assert/strict";
import test from "node:test";

import { durationSeconds, periodLabel } from "../duration";

test("durations convert integer units without rounding", () => {
  assert.equal(durationSeconds({ value: "90", unit: "minutes" }), 90 * 60);
  assert.equal(durationSeconds({ value: "36", unit: "hours" }), 36 * 60 * 60);
  assert.equal(durationSeconds({ value: "12", unit: "days" }), 12 * 24 * 60 * 60);
  assert.equal(durationSeconds({ value: "8", unit: "weeks" }), 8 * 7 * 24 * 60 * 60);
});

test("durations reject empty, fractional, zero, and unsafe values", () => {
  assert.equal(durationSeconds({ value: "", unit: "days" }), null);
  assert.equal(durationSeconds({ value: "1.5", unit: "days" }), null);
  assert.equal(durationSeconds({ value: "0", unit: "days" }), null);
  assert.equal(durationSeconds({ value: "999999999999999999999999", unit: "minutes" }), null);
});

test("period labels stay concise and explicit", () => {
  assert.equal(periodLabel(60), "1 minute");
  assert.equal(periodLabel(2 * 60 * 60), "2 hours");
  assert.equal(periodLabel(7 * 24 * 60 * 60), "1 week");
  assert.equal(periodLabel(30 * 24 * 60 * 60), "30 days");
  assert.equal(periodLabel(90, "tr"), "90 saniye");
  assert.equal(periodLabel(14 * 24 * 60 * 60, "tr"), "2 hafta");
});
