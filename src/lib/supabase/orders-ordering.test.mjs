import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ordersSource = await readFile(new URL("./orders.ts", import.meta.url), "utf8");

test("buyer queries sort by the schema column company_name", () => {
  const sortedBuyerQueries = ordersSource.match(
    /\.from\("buyers"\)\s*\.select\("\*"\)\s*\.order\("company_name",\s*\{\s*ascending:\s*true\s*\}\)/g,
  ) || [];
  assert.equal(sortedBuyerQueries.length, 2, "both buyers list queries should use company_name");
  assert.doesNotMatch(
    ordersSource,
    /\.from\("buyers"\)[\s\S]{0,160}?\.order\("name"/,
    "buyer queries must not order by the nonexistent name column",
  );
});
