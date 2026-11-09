import assert from "node:assert/strict";
import test from "node:test";
import { calculateDelayRisk, roundCanonicalDecimalToScaledInteger } from "./delay-risk.ts";

const now = new Date("2026-11-07T12:00:00.000Z"); // 17:30 in Kolkata
const baseOrder = {
  totalQuantity: 1000,
  completedQuantity: 0,
  finalProductionStage: " Finishing ",
  exFactoryDate: "2026-11-20",
};

function history(total, dates = ["2026-10-25", "2026-10-27", "2026-10-29", "2026-11-01", "2026-11-06"]) {
  const each = total / dates.length;
  return dates.map((updateDate) => ({ stage: "finishing", quantityCompleted: each, updateDate }));
}

function setPace(ratio, dueDate = "2026-11-20") {
  return calculateDelayRisk({ ...baseOrder, exFactoryDate: dueDate }, history(1000 * ratio), now);
}

test("classifies complete orders before needing a production rate", () => {
  const result = calculateDelayRisk({ ...baseOrder, completedQuantity: 1000 }, [], now);
  assert.equal(result.status, "Complete");
  assert.equal(result.remainingQuantity, 0);
});

test("classifies overdue orders with remaining finished goods", () => {
  const result = calculateDelayRisk({ ...baseOrder, exFactoryDate: "2026-11-06" }, history(1000), now);
  assert.equal(result.status, "Overdue");
  assert.equal(result.daysRemaining, 0);
});

test("classifies On Track, Watch, At Risk, and High Risk by pace ratio", () => {
  assert.equal(setPace(1.1).status, "On Track");
  assert.equal(setPace(1.05).status, "Watch");
  assert.equal(setPace(0.9).status, "At Risk");
  assert.equal(setPace(0.79).status, "High Risk");
});

test("uses PostgreSQL numeric half-away-from-zero rounding at risk thresholds", () => {
  const cases = [
    [0.8 - 0.5e-10, 8_000_000_000n],
    [0.8 + 0.5e-10, 8_000_000_001n],
    [1 - 0.5e-10, 10_000_000_000n],
    [1 + 0.5e-10, 10_000_000_001n],
    [1.1 - 0.5e-10, 11_000_000_000n],
    [1.1 + 0.5e-10, 11_000_000_001n],
  ];

  for (const [paceRatio, expectedScaled] of cases) {
    assert.equal(roundCanonicalDecimalToScaledInteger(paceRatio, 10), expectedScaled);
  }

  const differentialVectors = [
    ["0.79999999995", "0.8000000000", "0.8000000000"],
    ["0.80000000005", "0.8000000001", "0.8000000001"],
    ["0.99999999995", "0.9999999999", "1.0000000000"],
    ["1.00000000005", "1.0000000001", "1.0000000001"],
    ["1.09999999995", "1.1000000000", "1.1000000000"],
    ["1.10000000005", "1.1000000001", "1.1000000001"],
  ];
  for (const [canonicalText, jsToFixed, postgresNumericRound] of differentialVectors) {
    const paceRatio = Number(canonicalText);
    assert.equal(paceRatio.toFixed(10), jsToFixed);
    const roundedScaled = roundCanonicalDecimalToScaledInteger(paceRatio, 10);
    const roundedText = `${roundedScaled / 10_000_000_000n}.${(roundedScaled % 10_000_000_000n).toString().padStart(10, "0")}`;
    assert.equal(roundedText, postgresNumericRound);
  }

  // Differential reference: PostgreSQL rounds the decimal text emitted by
  // Number#toString(), while toFixed rounds the original binary Number. This
  // is a real mismatch immediately below 1.00 and the reason classification
  // now uses the canonical decimal rounding helper above.
  const boundary = Number("0.99999999995");
  assert.equal(Number(boundary.toFixed(10)), 0.9999999999);
  assert.equal(roundCanonicalDecimalToScaledInteger(boundary, 10), 10_000_000_000n);
});

test("returns Review Needed for a NULL final stage or insufficient history", () => {
  assert.equal(calculateDelayRisk({ ...baseOrder, finalProductionStage: null }, history(1000), now).status, "Review Needed");
  assert.equal(calculateDelayRisk(baseOrder, history(1000, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]), now).status, "Review Needed");
  assert.equal(calculateDelayRisk(baseOrder, history(1000, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]), now).status, "Review Needed");
  assert.equal(calculateDelayRisk(baseOrder, history(1000, ["2026-10-24", "2026-10-27", "2026-10-29", "2026-11-01", "2026-11-06"]), now).status, "Review Needed");
});

test("excludes intermediate stages and sums multiple final-stage entries on one date", () => {
  const result = calculateDelayRisk(baseOrder, [
    ...history(900),
    { stage: "Cutting", quantityCompleted: 100000, updateDate: "2026-11-07" },
    { stage: " FINISHING ", quantityCompleted: 300, updateDate: "2026-11-06" },
    { stage: "Finishing", quantityCompleted: 200, updateDate: "2026-11-06" },
  ], now);
  assert.equal(result.status, "On Track");
  assert.equal(result.observedDailyOutput, 100);
  assert.equal(result.historyDates, 5);
});

test("uses due date as an available day and ignores future updates", () => {
  const dueToday = calculateDelayRisk({ ...baseOrder, exFactoryDate: "2026-11-07" }, history(1400), now);
  assert.equal(dueToday.daysRemaining, 1);
  assert.equal(dueToday.requiredDailyOutput, 1000);

  const withFuture = calculateDelayRisk(baseOrder, [
    { stage: "Finishing", quantityCompleted: 100, updateDate: "2026-10-25" },
    { stage: "Finishing", quantityCompleted: 100, updateDate: "2026-10-27" },
    { stage: "Finishing", quantityCompleted: 100, updateDate: "2026-10-29" },
    { stage: "Finishing", quantityCompleted: 100, updateDate: "2026-11-01" },
    { stage: "Finishing", quantityCompleted: 100, updateDate: "2026-11-08" },
  ], now);
  assert.equal(withFuture.status, "Review Needed");
  assert.equal(withFuture.historyDates, 4);
});

test("uses the factory-local date when UTC and Kolkata dates differ", () => {
  const justAfterFactoryMidnight = new Date("2026-11-07T20:00:00.000Z");
  const result = calculateDelayRisk({ ...baseOrder, exFactoryDate: "2026-11-08" }, history(1400), justAfterFactoryMidnight);
  assert.equal(result.daysRemaining, 1);
});

test("returns Review Needed for missing or invalid order data", () => {
  assert.equal(calculateDelayRisk({ ...baseOrder, totalQuantity: null }, history(1000), now).status, "Review Needed");
  assert.equal(calculateDelayRisk({ ...baseOrder, totalQuantity: 0 }, history(1000), now).status, "Review Needed");
  assert.equal(calculateDelayRisk({ ...baseOrder, completedQuantity: -1 }, history(1000), now).status, "Review Needed");
  assert.equal(calculateDelayRisk({ ...baseOrder, exFactoryDate: "2026-02-30" }, history(1000), now).status, "Review Needed");
  assert.equal(calculateDelayRisk({ ...baseOrder, completedQuantity: 1000, exFactoryDate: null }, [], now).status, "Review Needed");
  const badUpdateHistory = history(1000);
  badUpdateHistory[0] = { stage: "Finishing", quantityCompleted: NaN, updateDate: "invalid-date" };
  assert.equal(calculateDelayRisk(baseOrder, badUpdateHistory, now).status, "Review Needed");
});
