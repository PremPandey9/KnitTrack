import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stages = JSON.parse(
  await readFile(new URL("./production-stages.json", import.meta.url), "utf8"),
);
const schemaSql = await readFile(
  new URL("../../supabase/migrations/20261109090001_core_schema.sql", import.meta.url),
  "utf8",
);
const securitySql = await readFile(
  new URL("../../supabase/migrations/20261109090002_core_security.sql", import.meta.url),
  "utf8",
);

function valuesInside(sql, startMarker, endMarker) {
  const start = sql.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing SQL marker: ${startMarker}`);
  const listStart = sql.indexOf("IN (", start);
  assert.notEqual(listStart, -1, `Missing IN list after SQL marker: ${startMarker}`);
  const bodyStart = listStart + "IN (".length;
  const listEnd = sql.indexOf("\n  )", bodyStart);
  assert.notEqual(listEnd, -1, `Missing SQL list terminator near: ${endMarker}`);
  return [...sql.slice(bodyStart, listEnd).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test("app and database accept the same current and final production stages", () => {
  assert.ok(stages.includes("Stitching"), "legacy Stitching stage remains supported");
  const expectedDatabaseStages = stages.map((stage) => stage.toLowerCase());

  for (const constraint of ["orders_current_stage_ck", "orders_final_stage_ck"]) {
    const body = valuesInside(
      schemaSql,
      `CONSTRAINT ${constraint} CHECK (`,
      "\n  ),",
    );
    assert.deepEqual(body, expectedDatabaseStages, `${constraint} stage list`);
  }

  for (const marker of ["IF lower(NEW.stage) NOT IN (", "IF lower(v_stage) NOT IN ("]) {
    const body = valuesInside(securitySql, marker, "\n  ) THEN");
    assert.deepEqual(body, expectedDatabaseStages, `${marker} stage list`);
  }

  const configureStages = valuesInside(
    securitySql,
    "IF v_stage NOT IN (",
    "\n  ) THEN",
  );
  assert.deepEqual(configureStages, stages, "final-stage RPC stage list");
});
