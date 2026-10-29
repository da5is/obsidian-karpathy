import assert from "node:assert/strict";
import { test } from "node:test";
import { displayDate, relativeDate } from "../src/dates";

test("previous calendar day says yesterday even across midnight, month and year boundaries", () => {
  for (const [now, written] of [
    [new Date(2026, 9, 29, 16), new Date(2026, 9, 28, 8)],
    [new Date(2026, 9, 29, 0, 1), new Date(2026, 9, 28, 23, 59)],
    [new Date(2026, 10, 1, 12), new Date(2026, 9, 31, 8)],
    [new Date(2027, 0, 1, 12), new Date(2026, 11, 31, 8)]
  ]) assert.equal(relativeDate(written.toISOString(), now), "yesterday");
});

test("today keeps elapsed minutes and hours; older dates use month-first ordinals and include past years", () => {
  const now = new Date(2026, 9, 30, 16);
  assert.equal(relativeDate(new Date(2026, 9, 30, 16).toISOString(), now), "just now");
  assert.equal(relativeDate(new Date(2026, 9, 30, 15, 40).toISOString(), now), "20m ago");
  assert.equal(relativeDate(new Date(2026, 9, 30, 13).toISOString(), now), "3h ago");
  assert.equal(relativeDate(new Date(2026, 9, 28, 16).toISOString(), now), "Oct 28th");
  assert.equal(relativeDate(new Date(2025, 9, 28, 16).toISOString(), now), "Oct 28th, 2025");
  for (const [day, suffix] of [[1, "st"], [2, "nd"], [3, "rd"], [11, "th"], [12, "th"], [13, "th"], [21, "st"], [22, "nd"], [23, "rd"], [31, "st"]] as const) {
    assert.equal(displayDate(new Date(2026, 9, day), { compact: true }, now), `Oct ${day}${suffix}`);
  }
});

test("yesterday follows local calendar days through daylight-saving transitions", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    // 23-hour spring day and 25-hour fall day must both count as yesterday.
    assert.equal(relativeDate("2026-03-08T00:30:00-06:00", new Date("2026-03-09T00:15:00-05:00")), "yesterday");
    assert.equal(relativeDate("2026-11-01T00:30:00-05:00", new Date("2026-11-02T00:15:00-06:00")), "yesterday");
    assert.equal(relativeDate("2026-03-07T23:45:00-06:00", new Date("2026-03-09T00:15:00-05:00")), "Mar 7th");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
