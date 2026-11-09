import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  buildDelayAlertPayload,
  canSubmitDelayAlertForRole,
  decodeDelayAlertSigningKey,
  isDelayAlertFeatureEnabled,
  isCanonicalUuid,
  isDelayAlertCandidateStatus,
  parseDelayAlertOrderId,
  signDelayAlertPayload,
} from "./delay-alert-signing-core.ts";

const ids = {
  request: "a1111111-1111-4111-8111-111111111111",
  actor: "b2222222-2222-4222-8222-222222222222",
  order: "c3333333-3333-4333-8333-333333333333",
  buyer: "d4444444-4444-4444-8444-444444444444",
};

function snapshot(overrides = {}) {
  return {
    requestId: ids.request,
    actorId: ids.actor,
    orderId: ids.order,
    buyerId: ids.buyer,
    calculatedAt: new Date("2026-11-08T12:34:56.789Z"),
    totalQuantity: 1000,
    completedQuantity: 400,
    finalProductionStage: "Final Stage",
    exFactoryDate: "2026-11-30",
    observationWindowStart: "2026-10-26",
    observationWindowEnd: "2026-11-08",
    risk: {
      status: "High Risk",
      remainingQuantity: 600,
      daysRemaining: 23,
      observedDailyOutput: 10.5,
      requiredDailyOutput: 26.08695652173913,
      paceRatio: 0.4025,
      historyDates: 8,
      reason: null,
    },
    ...overrides,
  };
}

test("builds all 21 payload lines in exact SQL contract order", () => {
  const lines = buildDelayAlertPayload(snapshot()).split("\n");
  assert.equal(lines.length, 21);
  assert.deepEqual(lines.map((line) => line.split("=", 1)[0]), [
    "knittrack-delay-v1", "key_id", "request_id", "actor_id", "order_id", "buyer_id",
    "risk_level", "calculated_at", "calculation_version", "total_quantity", "completed_quantity",
    "remaining_quantity", "final_production_stage_b64url", "ex_factory_date", "observation_window_start",
    "observation_window_end", "history_date_count", "observed_daily_output", "required_daily_output",
    "pace_ratio", "days_remaining",
  ]);
  assert.equal(lines[0], "knittrack-delay-v1");
  assert.equal(lines[1], "key_id=v1");
  assert.equal(lines[2], `request_id=${ids.request}`);
  assert.equal(lines[6], "risk_level=High Risk");
  assert.equal(lines[7], "calculated_at=2026-11-08T12:34:56.789Z");
  assert.equal(lines[8], "calculation_version=phase1-v1");
});

test("uses LF only and has no trailing newline", () => {
  const payload = buildDelayAlertPayload(snapshot());
  assert.equal(payload.includes("\r"), false);
  assert.equal(payload.endsWith("\n"), false);
  assert.equal(Buffer.from(payload, "utf8").toString("utf8"), payload);
});

test("matches the RFC 4231 HMAC-SHA256 known test vector", () => {
  const key = Buffer.from("0b".repeat(20), "hex");
  const signature = signDelayAlertPayload("Hi There", key);
  assert.equal(signature, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  assert.equal(signature, createHmac("sha256", key).update(Buffer.from("Hi There", "utf8")).digest("hex"));
  assert.match(signature, /^[0-9a-f]{64}$/);
});

test("validates canonical lowercase UUIDs and rejects browser snapshot objects", () => {
  assert.equal(isCanonicalUuid(ids.order), true);
  assert.equal(isCanonicalUuid(ids.order.toUpperCase()), false);
  assert.equal(isCanonicalUuid("not-a-uuid"), false);
  assert.equal(parseDelayAlertOrderId(ids.order), ids.order);
  assert.equal(parseDelayAlertOrderId({ orderId: ids.order, risk: "On Track", buyerId: ids.buyer }), null);
  assert.equal(parseDelayAlertOrderId(""), null);
});

test("serializes final stage with canonical unpadded base64url", () => {
  const line = buildDelayAlertPayload(snapshot()).split("\n")[12];
  assert.equal(line, "final_production_stage_b64url=RmluYWwgU3RhZ2U");
  assert.equal(line.slice(line.indexOf("=") + 1).includes("="), false);
});

test("serializes null rates as tilde and canonicalizes negative zero", () => {
  const lines = buildDelayAlertPayload(snapshot({ risk: {
    ...snapshot().risk,
    status: "Review Needed",
    observedDailyOutput: null,
    requiredDailyOutput: null,
    paceRatio: null,
  } })).split("\n");
  assert.equal(lines[17], "observed_daily_output=~");
  assert.equal(lines[18], "required_daily_output=~");
  assert.equal(lines[19], "pace_ratio=~");
  const negativeZero = buildDelayAlertPayload(snapshot({ risk: { ...snapshot().risk, paceRatio: -0 } }));
  assert.match(negativeZero, /\npace_ratio=0\n/);
});

test("requires a configured hexadecimal key of at least 32 bytes without revealing it", () => {
  assert.throws(() => decodeDelayAlertSigningKey(undefined), /not configured/);
  assert.throws(() => decodeDelayAlertSigningKey("ab".repeat(31)), /at least 32 bytes/);
  assert.throws(() => decodeDelayAlertSigningKey("zz".repeat(32)), /hexadecimal/);
  const testOnlyKey = "a5".repeat(32);
  assert.equal(decodeDelayAlertSigningKey(testOnlyKey).length, 32);
});

test("rejects malformed payload fields and invalid timestamps", () => {
  assert.throws(() => buildDelayAlertPayload(snapshot({ orderId: "bad" })), /UUID/);
  assert.throws(() => buildDelayAlertPayload(snapshot({ calculatedAt: new Date("invalid") })), /timestamp/);
  assert.throws(() => buildDelayAlertPayload(snapshot({ exFactoryDate: "2026-02-30" })), /date/);
  assert.throws(() => buildDelayAlertPayload(snapshot({ totalQuantity: 1.5 })), /safe integer/);
  assert.throws(() => signDelayAlertPayload("line1\r\nline2", Buffer.alloc(32)), /LF separators/);
});

test("only merchandisers are authorized to submit", () => {
  assert.equal(canSubmitDelayAlertForRole("merchandiser"), true);
  assert.equal(canSubmitDelayAlertForRole("buyer"), false);
  assert.equal(canSubmitDelayAlertForRole("supervisor"), false);
  assert.equal(canSubmitDelayAlertForRole(undefined), false);
});

test("candidate RPC feature flag defaults off and requires explicit true", () => {
  assert.equal(isDelayAlertFeatureEnabled(undefined), false);
  assert.equal(isDelayAlertFeatureEnabled("false"), false);
  assert.equal(isDelayAlertFeatureEnabled("TRUE"), false);
  assert.equal(isDelayAlertFeatureEnabled("true"), true);
});

test("marks non-candidate classifications for superseding, never as candidate alerts", () => {
  for (const status of ["Complete", "On Track", "Review Needed"]) {
    assert.equal(isDelayAlertCandidateStatus(status), false);
  }
  for (const status of ["Overdue", "High Risk", "At Risk", "Watch"]) {
    assert.equal(isDelayAlertCandidateStatus(status), true);
  }
});

test("supports a Review Needed snapshot without inventing missing quantities or rates", () => {
  const payload = buildDelayAlertPayload(snapshot({
    totalQuantity: null,
    completedQuantity: null,
    finalProductionStage: null,
    exFactoryDate: null,
    observationWindowStart: null,
    observationWindowEnd: null,
    risk: {
      status: "Review Needed",
      remainingQuantity: null,
      daysRemaining: null,
      observedDailyOutput: null,
      requiredDailyOutput: null,
      paceRatio: null,
      historyDates: 0,
      reason: "Missing order data",
    },
  }));
  assert.match(payload, /total_quantity=~/);
  assert.match(payload, /completed_quantity=~/);
  assert.match(payload, /remaining_quantity=~/);
  assert.match(payload, /final_production_stage_b64url=~/);
  assert.match(payload, /ex_factory_date=~/);
  assert.match(payload, /observation_window_start=~/);
  assert.match(payload, /observation_window_end=~/);
  assert.match(payload, /days_remaining=~/);
  assert.equal(payload.includes("=0\n"), true); // history_date_count is the actual Phase 1 value.
});
