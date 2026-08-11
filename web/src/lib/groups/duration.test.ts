import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PERIOD_SECONDS,
  customPeriodSeconds,
  periodLabel,
  presetPeriodSeconds,
} from "../duration";

test("preset periods have exact, documented second values", () => {
  assert.equal(presetPeriodSeconds("weekly"), 7 * 24 * 60 * 60);
  assert.equal(presetPeriodSeconds("monthly"), 30 * 24 * 60 * 60);
});

test("custom periods convert integer units without rounding", () => {
  assert.equal(customPeriodSeconds("90", "minutes"), 90 * 60);
  assert.equal(customPeriodSeconds("36", "hours"), 36 * 60 * 60);
  assert.equal(customPeriodSeconds("12", "days"), 12 * 24 * 60 * 60);
  assert.equal(customPeriodSeconds("8", "weeks"), 8 * 7 * 24 * 60 * 60);
});

test("custom periods reject empty, fractional, zero, unsafe, and oversized values", () => {
  assert.equal(customPeriodSeconds("", "days"), null);
  assert.equal(customPeriodSeconds("1.5", "days"), null);
  assert.equal(customPeriodSeconds("0", "days"), null);
  assert.equal(customPeriodSeconds("999999999999999999999999", "minutes"), null);
  assert.equal(customPeriodSeconds("53", "weeks"), null);
  assert.equal(customPeriodSeconds("366", "days"), MAX_PERIOD_SECONDS);
});

test("period labels stay concise and explicit", () => {
  assert.equal(periodLabel(60), "1 minute");
  assert.equal(periodLabel(2 * 60 * 60), "2 hours");
  assert.equal(periodLabel(7 * 24 * 60 * 60), "1 week");
  assert.equal(periodLabel(30 * 24 * 60 * 60), "30 days");
  assert.equal(periodLabel(90, "tr"), "90 saniye");
  assert.equal(periodLabel(14 * 24 * 60 * 60, "tr"), "2 hafta");
});
