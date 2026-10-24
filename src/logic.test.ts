import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  approxDate,
  computePeriods,
  diffDays,
  monthAdherence,
  periodStart,
  periodStatus,
  todayRome,
  warmth,
  HEART_WEIGHT,
  yearSummary,
} from "./logic.js";

test("dates", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(diffDays("2026-11-01", "2026-10-24"), 8);
  assert.equal(periodStart("2026-10-24", 7), "2026-10-19"); // Saturday -> Monday
  assert.equal(approxDate("ieri", "2026-10-24"), "2026-10-23");
  assert.throws(() => approxDate("esatta", "2026-10-24", "2026-02-30"));
  // 23:30 UTC on Oct 24 is already Oct 25 in Rome (UTC+2)
  assert.equal(todayRome(new Date("2026-10-24T23:30:00Z")), "2026-10-25");
});

test("daily habit: missed teeth carry into the next day, capped at one day", () => {
  const counts = new Map([
    ["2026-10-20", 3],
    ["2026-10-21", 1], // missed 2
    ["2026-10-22", 3], // target 5 -> missed 2, carry capped at 3? no: min(base=3, 2) = 2
    ["2026-10-23", 0], // target 5 -> missed 5, carry capped at 3
  ]);
  const ps = computePeriods({ periodDays: 1, base: 3 }, counts, "2026-10-20", "2026-10-24");
  assert.deepEqual(
    ps.map((p) => [p.start, p.target, p.done]),
    [
      ["2026-10-20", 3, 3],
      ["2026-10-21", 3, 1],
      ["2026-10-22", 5, 3],
      ["2026-10-23", 5, 0],
      ["2026-10-24", 6, 0],
    ],
  );
});

test("weekly chore carries one missed week", () => {
  const counts = new Map([["2026-10-14", 1]]);
  const ps = computePeriods({ periodDays: 7, base: 1 }, counts, "2026-10-12", "2026-10-24");
  assert.deepEqual(
    ps.map((p) => [p.start, p.target, p.done]),
    [
      ["2026-10-12", 1, 1],
      ["2026-10-19", 1, 0],
    ],
  );
  const ps2 = computePeriods({ periodDays: 7, base: 1 }, new Map(), "2026-10-12", "2026-10-24");
  assert.equal(ps2[1].target, 2);
  assert.equal(periodStatus(ps2[1], "2026-10-24", "2026-10-12"), "pending");
  assert.equal(periodStatus(ps2[0], "2026-10-24", "2026-10-12"), "missed");
});

test("month adherence ignores running and pre-tracking periods", () => {
  const counts = new Map([
    ["2026-10-22", 1],
    ["2026-10-23", 0],
  ]);
  const ps = computePeriods({ periodDays: 1, base: 1 }, counts, "2026-10-22", "2026-10-24");
  // 22: 1/1, 23: 0/1, 24: running -> excluded
  assert.equal(monthAdherence(ps, "2026-10", "2026-10-24", "2026-10-22"), 0.5);
});

test("warmth hearts expire after 30 days and fade after 23", () => {
  const w = warmth(
    [
      { event_date: "2026-10-24", delta: 2 },
      { event_date: "2026-09-28", delta: 1 }, // 26 days old -> fading
      { event_date: "2026-09-01", delta: 3 }, // expired
    ],
    "2026-10-24",
  );
  assert.deepEqual(w, { hearts: 3, fading: 1, expiresOn: "2026-10-28" });
});

test("year summary: months before tracking and in the future are empty", () => {
  const counts = new Map([
    ["2026-10-22", 1],
    ["2026-10-23", 0],
  ]);
  const ps = computePeriods({ periodDays: 1, base: 1 }, counts, "2026-10-22", "2026-12-31");
  const y = yearSummary({ doccia: ps }, 2026, "2026-10-24", "2026-10-22");
  assert.equal(y.months[8].total, null); // September: before tracking
  assert.equal(y.months[9].total, 0.5); // October: 1 of 2 finished days
  assert.equal(y.months[10].total, null); // November: future
  assert.equal(y.perGoalYear.doccia, 0.5);
});

test("hearts are weighted by relationship", () => {
  const coffee = [{ event_date: "2026-10-24", delta: 4 }]; // outrovert 1 + cuisine 1 + intimate 2
  assert.equal(warmth(coffee, "2026-10-24", HEART_WEIGHT.amici).hearts, 2);
  const dinner = [{ event_date: "2026-10-24", delta: 4 }]; // family dinner, same raw points
  assert.equal(warmth(dinner, "2026-10-24", HEART_WEIGHT.famiglia).hearts, 5);
  assert.equal(warmth([{ event_date: "2026-10-24", delta: 1 }], "2026-10-24", HEART_WEIGHT.amici).hearts, 1);
});
