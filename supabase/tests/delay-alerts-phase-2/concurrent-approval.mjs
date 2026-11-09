import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const composeFile = "supabase/tests/delay-alerts-phase-2/compose.yaml";
const project = process.env.KNITTRACK_DELAY_TEST_COMPOSE_PROJECT;
if (!/^knittrack-delay-alerts-[0-9a-f]{32}$/.test(project ?? "")) {
  throw new Error("Run this helper through run.ps1 so it uses that run's isolated Compose project.");
}
const merchandiserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buyerBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const buyerCId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function dockerPsql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "compose", "--project-name", project, "--file", composeFile,
      "exec", "--no-TTY", "db", "psql", "--username", "postgres", "--dbname", "postgres",
      "--no-align", "--tuples-only", "--quiet", "--set", "ON_ERROR_STOP=1", "--command", sql,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  });
}

const alertId = await dockerPsql("SELECT id FROM test_harness.concurrent_alert LIMIT 1");
assert.match(alertId, /^[0-9a-f-]{36}$/);

const staleSnapshot = JSON.parse(await dockerPsql("SELECT snapshot::text FROM test_harness.stale_snapshot LIMIT 1"));
const snapshotFields = [
  ["risk_level", "text"],
  ["calculated_at", "timestamptz"],
  ["calculation_version", "text"],
  ["total_quantity", "integer"],
  ["completed_quantity", "integer"],
  ["remaining_quantity", "integer"],
  ["final_production_stage", "text"],
  ["ex_factory_date", "date"],
  ["observation_window_start", "date"],
  ["observation_window_end", "date"],
  ["history_date_count", "integer"],
  ["observed_daily_output", "numeric"],
  ["required_daily_output", "numeric"],
  ["pace_ratio", "numeric"],
  ["days_remaining", "integer"],
];

function sqlLiteral(value) {
  return value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function snapshotPredicate(snapshot) {
  return snapshotFields.map(([field, type]) =>
    `${field} IS NOT DISTINCT FROM ${sqlLiteral(snapshot[field])}::${type}`,
  ).join(" AND ");
}

// Buyer and supervisor sessions must not approve, dismiss, or edit a pending
// alert, even though both use the shared authenticated database role.
for (const userId of [buyerBId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"]) {
  const approveAttempt = await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub='${userId}'; UPDATE public.delay_alerts SET approval_status='approved' WHERE id='${alertId}' AND approval_status='pending' RETURNING id; RESET ROLE;`);
  const dismissAttempt = await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub='${userId}'; UPDATE public.delay_alerts SET approval_status='dismissed', dismissal_reason='unauthorized test' WHERE id='${alertId}' AND approval_status='pending' RETURNING id; RESET ROLE;`);
  const editAttempt = await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub='${userId}'; UPDATE public.delay_alerts SET dismissal_reason='unauthorized edit' WHERE id='${alertId}' AND approval_status='pending' RETURNING id; RESET ROLE;`);
  assert.equal(approveAttempt.includes(alertId), false, "Buyers and supervisors must not approve alerts.");
  assert.equal(dismissAttempt.includes(alertId), false, "Buyers and supervisors must not dismiss alerts.");
  assert.equal(editAttempt.includes(alertId), false, "Buyers and supervisors must not edit alert fields.");
}

// The old displayed calculation must not be approvable after the pending row
// has been refreshed with materially different order values.
const staleUpdate = await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub = '${merchandiserId}'; UPDATE public.delay_alerts SET approval_status='approved' WHERE id='${alertId}' AND approval_status='pending' AND ${snapshotPredicate(staleSnapshot)} RETURNING id;`);
assert.equal(staleUpdate.includes(alertId), false, "A stale snapshot predicate must update zero rows.");
const currentSnapshot = JSON.parse(await dockerPsql(`SELECT row_to_json(a)::text FROM public.delay_alerts a WHERE id='${alertId}'`));

function transition(status, snapshot, reason = "") {
  const setClause = status === "approved"
    ? "approval_status = 'approved'"
    : `approval_status = 'dismissed', dismissal_reason = '${reason}'`;
  const sql = `BEGIN; SET ROLE authenticated; SET request.jwt.claim.sub = '${merchandiserId}'; UPDATE public.delay_alerts SET ${setClause} WHERE id = '${alertId}' AND approval_status = 'pending' AND ${snapshotPredicate(snapshot)} RETURNING id; SELECT pg_sleep(1); COMMIT;`;
  return dockerPsql(sql);
}

// The first session holds its row lock while the other conditional UPDATE waits.
const first = transition("approved", currentSnapshot);
await new Promise((resolve) => setTimeout(resolve, 150));
const second = transition("dismissed", currentSnapshot, "concurrent fixture");
const outcomes = await Promise.all([first, second]);
assert.equal(outcomes.filter((output) => output.split(/\s+/).includes(alertId)).length, 1,
  "Exactly one pending-state action must win; the loser must update zero rows.");

const alertState = await dockerPsql(`SELECT approval_status FROM public.delay_alerts WHERE id='${alertId}'`);
assert.ok(alertState === "approved" || alertState === "dismissed");
const duplicateDecision = await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub = '${merchandiserId}'; UPDATE public.delay_alerts SET approval_status='${alertState === "approved" ? "dismissed" : "approved"}' WHERE id='${alertId}' AND approval_status='pending' AND ${snapshotPredicate(currentSnapshot)} RETURNING id; RESET ROLE;`);
assert.equal(duplicateDecision.includes(alertId), false, "A repeated decision must update zero rows.");
const eventTypes = await dockerPsql(`SELECT string_agg(event_type, ',' ORDER BY event_at, id) FROM public.delay_alert_events WHERE alert_id='${alertId}'`);
assert.ok(eventTypes === "created,calculation_changed,approved" || eventTypes === "created,calculation_changed,dismissed");

async function countAs(userId, table) {
  return Number(await dockerPsql(`SET ROLE authenticated; SET request.jwt.claim.sub='${userId}'; SELECT count(*) FROM public.${table}; RESET ROLE;`));
}

assert.equal(await countAs(buyerCId, "delay_alerts"), 0, "Company C must not see Company B's alert.");
assert.equal(await countAs(buyerCId, "delay_alert_events"), 0, "Company C must not see Company B's events.");
const buyerBAlertCount = await countAs(buyerBId, "delay_alerts");
assert.equal(buyerBAlertCount, alertState === "approved" ? 1 : 0,
  "Company B sees the alert only if it won approval.");
const buyerBEventCount = await countAs(buyerBId, "delay_alert_events");
assert.equal(buyerBEventCount, alertState === "approved" ? 3 : 0,
  "Company B sees approved alert history only while the parent alert is approved.");

console.log("Concurrent approval/dismissal, audit, and buyer isolation checks passed.");
