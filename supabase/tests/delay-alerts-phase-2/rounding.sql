-- Differential vectors: PostgreSQL side of the JS toFixed vs numeric round test.
-- `js_to_fixed` is captured from Node Number(value).toFixed(10) and is included
-- to make known disagreement cases visible. Phase 1 now uses `phase1_decimal`
-- which must match PostgreSQL's numeric rounding of Number#toString() payloads.
WITH vectors(label, input_numeric, js_to_fixed, phase1_decimal) AS (
  VALUES
    ('below-0.80-half', 0.79999999995::numeric, 0.8000000000::numeric, 0.8000000000::numeric),
    ('above-0.80-half', 0.80000000005::numeric, 0.8000000001::numeric, 0.8000000001::numeric),
    ('below-1.00-half', 0.99999999995::numeric, 0.9999999999::numeric, 1.0000000000::numeric),
    ('above-1.00-half', 1.00000000005::numeric, 1.0000000001::numeric, 1.0000000001::numeric),
    ('below-1.10-half', 1.09999999995::numeric, 1.1000000000::numeric, 1.1000000000::numeric),
    ('above-1.10-half', 1.10000000005::numeric, 1.1000000001::numeric, 1.1000000001::numeric)
)
SELECT label,
       round(input_numeric, 10) AS postgres_numeric_round,
       js_to_fixed,
       phase1_decimal,
       round(input_numeric, 10) = phase1_decimal AS phase1_matches_postgres,
       round(input_numeric, 10) = js_to_fixed AS old_to_fixed_matches_postgres
FROM vectors
ORDER BY label;

DO $$
BEGIN
  IF round(0.99999999995::numeric, 10) <> 1.0000000000::numeric THEN
    RAISE EXCEPTION 'Unexpected PostgreSQL numeric rounding behavior';
  END IF;
END;
$$;
