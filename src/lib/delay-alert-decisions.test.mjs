import assert from "node:assert/strict";
import test from "node:test";
import { decideDelayAlert } from "./delay-alert-decisions.ts";

const alertId = "10111111-1111-4111-8111-111111111111";

function makeSnapshot() {
  return {
    risk_level: "Overdue",
    calculated_at: "2026-11-08T12:34:56.789Z",
    calculation_version: "phase1-v1",
    total_quantity: 100,
    completed_quantity: 0,
    remaining_quantity: 100,
    final_production_stage: "Finishing",
    ex_factory_date: "2026-11-07",
    observation_window_start: "2026-10-26",
    observation_window_end: "2026-11-08",
    history_date_count: 0,
    observed_daily_output: null,
    required_daily_output: null,
    pace_ratio: null,
    days_remaining: 0,
  };
}

function makeStore() {
  const state = { approvalStatus: "pending", snapshot: makeSnapshot(), events: [] };
  let loadCount = 0;
  const store = {
    state,
    get loadCount() { return loadCount; },
    async load(id) {
      loadCount += 1;
      if (id !== alertId) return { alert: null, error: false };
      return {
        alert: { approval_status: state.approvalStatus, snapshot: { ...state.snapshot } },
        error: false,
      };
    },
    async transition(id, snapshot, status, reason) {
      if (id !== alertId || state.approvalStatus !== "pending" ||
          Object.keys(state.snapshot).some((key) => !Object.is(state.snapshot[key], snapshot[key]))) {
        return { updated: false, error: false };
      }
      state.approvalStatus = status;
      state.events.push({ eventType: status, dismissalReason: reason });
      return { updated: true, error: false };
    },
  };
  return store;
}

test("approves a pending alert and records its audit event", async () => {
  const store = makeStore();
  const result = await decideDelayAlert({
    role: "merchandiser", store, alertId, displayedSnapshot: makeSnapshot(), decision: "approved",
  });
  assert.equal(result.status, "success");
  assert.equal(store.state.approvalStatus, "approved");
  assert.deepEqual(store.state.events, [{ eventType: "approved", dismissalReason: null }]);
});

test("dismisses a pending alert with a trimmed reason and records its audit event", async () => {
  const store = makeStore();
  const result = await decideDelayAlert({
    role: "merchandiser", store, alertId, displayedSnapshot: makeSnapshot(),
    decision: "dismissed", dismissalReason: "  Not a delivery delay  ",
  });
  assert.equal(result.status, "success");
  assert.equal(store.state.approvalStatus, "dismissed");
  assert.deepEqual(store.state.events, [{ eventType: "dismissed", dismissalReason: "Not a delivery delay" }]);
});

test("rejects dismissal reasons above the database character limit", async () => {
  const store = makeStore();
  const result = await decideDelayAlert({
    role: "merchandiser", store, alertId, displayedSnapshot: makeSnapshot(),
    decision: "dismissed", dismissalReason: "x".repeat(2001),
  });
  assert.equal(result.status, "invalid");
  assert.equal(store.loadCount, 0);
});

test("a repeated decision conflicts after the first transition", async () => {
  const store = makeStore();
  const displayedSnapshot = makeSnapshot();
  const first = await decideDelayAlert({ role: "merchandiser", store, alertId, displayedSnapshot, decision: "approved" });
  const duplicate = await decideDelayAlert({ role: "merchandiser", store, alertId, displayedSnapshot, decision: "dismissed" });
  assert.equal(first.status, "success");
  assert.equal(duplicate.status, "conflict");
  assert.equal(store.state.events.length, 1);
});

test("only one concurrent approval or dismissal wins for a pending alert", async () => {
  const store = makeStore();
  const displayedSnapshot = makeSnapshot();
  const results = await Promise.all([
    decideDelayAlert({ role: "merchandiser", store, alertId, displayedSnapshot, decision: "approved" }),
    decideDelayAlert({ role: "merchandiser", store, alertId, displayedSnapshot, decision: "dismissed", dismissalReason: "Concurrent" }),
  ]);
  assert.equal(results.filter((result) => result.status === "success").length, 1);
  assert.equal(results.filter((result) => result.status === "conflict").length, 1);
  assert.equal(store.state.events.length, 1);
});

test("rejects a stale displayed snapshot without updating or writing an event", async () => {
  const store = makeStore();
  const staleSnapshot = { ...makeSnapshot(), remaining_quantity: 99 };
  const result = await decideDelayAlert({
    role: "merchandiser", store, alertId, displayedSnapshot: staleSnapshot, decision: "approved",
  });
  assert.equal(result.status, "conflict");
  assert.equal(store.state.approvalStatus, "pending");
  assert.equal(store.state.events.length, 0);
});

test("buyers and supervisors cannot use the decision path", async () => {
  for (const role of ["buyer", "supervisor"]) {
    const store = makeStore();
    const result = await decideDelayAlert({
      role, store, alertId, displayedSnapshot: makeSnapshot(), decision: "approved",
    });
    assert.equal(result.status, "unauthorized");
    assert.equal(store.loadCount, 0);
    assert.equal(store.state.events.length, 0);
  }
});
