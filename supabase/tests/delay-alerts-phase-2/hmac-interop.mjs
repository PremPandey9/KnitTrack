import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildDelayAlertPayload, signDelayAlertPayload } from "../../../src/lib/delay-alert-signing-core.ts";

const key = Buffer.from("a5".repeat(32), "hex"); // disposable test-only key
const project = process.env.KNITTRACK_DELAY_TEST_COMPOSE_PROJECT;
if (!/^knittrack-delay-alerts-[0-9a-f]{32}$/.test(project ?? "")) {
  throw new Error("Run this helper through run.ps1 so it uses that run's isolated Compose project.");
}
const payload = buildDelayAlertPayload({
  requestId: "10111111-1111-4111-8111-111111111111",
  actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orderId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  buyerId: "11111111-1111-4111-8111-111111111111",
  calculatedAt: new Date("2026-11-08T12:34:56.789Z"),
  totalQuantity: 100,
  completedQuantity: 0,
  finalProductionStage: "Finishing",
  exFactoryDate: "2026-11-07",
  observationWindowStart: "2026-10-26",
  observationWindowEnd: "2026-11-08",
  risk: {
    status: "Overdue",
    remainingQuantity: 100,
    daysRemaining: 0,
    observedDailyOutput: null,
    requiredDailyOutput: null,
    paceRatio: null,
    historyDates: 0,
    reason: "test fixture",
  },
});
const jsSignature = signDelayAlertPayload(payload, key);
const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
const query = `SELECT encode(extensions.hmac(convert_to(${sqlLiteral(payload)}, 'UTF8'), decode('${key.toString("hex")}', 'hex'), 'sha256'), 'hex');`;
const result = spawnSync("docker", [
  "compose", "--project-name", project,
  "--file", "supabase/tests/delay-alerts-phase-2/compose.yaml",
  "exec", "--no-TTY", "db", "psql", "--username", "postgres", "--dbname", "postgres",
  "--no-align", "--tuples-only", "--quiet", "--set", "ON_ERROR_STOP=1", "--file", "-",
], { encoding: "utf8", input: query, windowsHide: true });

if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr.trim() || "PostgreSQL HMAC query failed.");
assert.equal(result.stdout.trim(), jsSignature, "Node and pgcrypto must sign identical UTF-8 payload bytes.");
console.log("Node/pgcrypto HMAC byte contract passed.");
