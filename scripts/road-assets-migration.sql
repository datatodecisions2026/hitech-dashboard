-- Migration for the new /road-assets page (Calabar / Ogun / Kebbi asset-layer
-- coverage tracking). Run this in the Supabase SQL Editor — this session had
-- no DB-execution tool available to apply it directly.
--
-- v2: the first version's road_asset_gap_summary/road_asset_gaps_detail used
-- a `SELECT DISTINCT entity_type, side, station_m` CTE before the LEAD()
-- window function. Measured against the real data: this timed out (>8s)
-- on EVERY section, including the smallest (401K-row Ogun) — DISTINCT forced
-- a HashAggregate that couldn't use the new index's sort order, so the
-- window function needed a separate Sort afterward, which spilled to disk
-- under this instance's 2MB work_mem (same constraint noted in the
-- /progress 2026-07-22 changelog entry). Confirmed the ~0.6% station_m
-- duplication rate (28,924 rows / 28,746 distinct stations, one sample
-- combo) is real but tiny — and harmless to drop DISTINCT for, since a
-- duplicate consecutive station just produces a 0-length "gap" between
-- LEAD() rows, which the >p_min_gap_m filter already discards.
--
-- v3: after applying v2, road_asset_gap_summary (the LEAD()-window-function
-- query) measured fast (1-2.5s) — but road_asset_entity_summary, a *plainer*
-- `GROUP BY entity_type, side` with MIN/MAX and no window function, then
-- timed out on every section instead. The planner was evidently choosing a
-- sequential scan + HashAggregate for the plain aggregate (ignoring the
-- index entirely) while the window-function shape reliably forced an
-- index-ordered scan. Rather than fight the planner further, v3 merges both
-- into one function (road_asset_layer_summary) built on the same LEAD()
-- CTE that already measured fast — same computation, one scan, guaranteed
-- identical plan shape. road_asset_entity_summary/road_asset_gap_summary
-- are dropped; road_asset_gaps_detail (already fast, ~0.7s) is unchanged.
--
-- v4: after v3, Calabar (2.5-3s) and Ogun (0.7-1.1s) both measured healthy,
-- but Kebbi (~5.5M rows, ~4x Calabar) still timed out at ~8.2s — a genuine
-- scale ceiling (confirmed linear: Calabar's cost/row extrapolates to
-- ~11s for Kebbi's row count), not a stats/maintenance issue (VACUUM
-- ANALYZE road_assets, run manually, made no difference). Fixed by adding
-- an optional p_entity_type filter so the API route can split Kebbi's
-- query into one parallel call per entity_type instead of one call over
-- the whole section — confirmed via direct query that Kebbi has 8
-- entity_types (crcp/jersey_barrier/kerb/red_filling/shute/stonebase/
-- street_light/subbase), each 500K-1.05M rows — right in Calabar's
-- already-proven-fast range. Calabar/Ogun keep calling this function
-- unsplit (p_entity_type NULL) since they're already well under budget.
-- Incidentally, this query also surfaced a 'Median' side value for
-- jersey_barrier/street_light in Kebbi that earlier ad-hoc sampling (a
-- coarse 60-point ID-range scan, before this table had this migration's
-- index) had missed entirely — the API route already derives its side
-- list dynamically from the RPC result rather than assuming LHS/RHS, so
-- this needed no code change, just confirms why that choice mattered.

-- ── Index (unchanged) ─────────────────────────────────────────────────────
-- Serves both functions below: GROUP BY (entity_type, side) and the
-- window-function ordering both want rows pre-sorted by
-- (section, entity_type, side, station_m), which this index provides
-- without a separate sort step.
CREATE INDEX IF NOT EXISTS idx_road_assets_section_entity_side_station
  ON road_assets (section, entity_type, side, station_m);

-- ── road_asset_layer_summary ─────────────────────────────────────────────
-- Per (entity_type, side) in one pass: built envelope (min/max station) and
-- gap count/length (gaps bigger than p_min_gap_m — default 10m, filters out
-- routine 1-2m survey-point jitter and the occasional duplicate-station
-- 0-length "gap"). "Stations built" within the envelope is derived in the
-- API route as (max_station - min_station + 1) - total_gap_m — no separate
-- COUNT(DISTINCT) needed.
DROP FUNCTION IF EXISTS road_asset_entity_summary(text);
DROP FUNCTION IF EXISTS road_asset_gap_summary(text, numeric);
DROP FUNCTION IF EXISTS road_asset_layer_summary(text, numeric);
CREATE FUNCTION road_asset_layer_summary(p_section text, p_min_gap_m numeric DEFAULT 10, p_entity_type text DEFAULT NULL)
RETURNS TABLE (
  entity_type text,
  side text,
  min_station numeric,
  max_station numeric,
  gap_count bigint,
  total_gap_m numeric
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH ordered AS (
    SELECT entity_type, side, station_m,
           LEAD(station_m) OVER (PARTITION BY entity_type, side ORDER BY station_m) AS next_station
    FROM road_assets
    WHERE section = p_section
      AND (p_entity_type IS NULL OR entity_type = p_entity_type)
  )
  SELECT entity_type, side,
         MIN(station_m) AS min_station,
         MAX(station_m) AS max_station,
         COUNT(*) FILTER (WHERE next_station - station_m > p_min_gap_m) AS gap_count,
         COALESCE(SUM(next_station - station_m) FILTER (WHERE next_station - station_m > p_min_gap_m), 0) AS total_gap_m
  FROM ordered
  GROUP BY entity_type, side
$$;

REVOKE ALL ON FUNCTION road_asset_layer_summary(text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION road_asset_layer_summary(text, numeric, text) TO service_role;

-- ── road_asset_gaps_detail ───────────────────────────────────────────────
-- The actual list of gap ranges for one (entity_type, side) drill-down.
-- Capped at p_limit (default 200) — same defensive-ceiling convention as
-- map_chainage_line / streetlights_cluster.
DROP FUNCTION IF EXISTS road_asset_gaps_detail(text, text, text, numeric, int);
CREATE FUNCTION road_asset_gaps_detail(
  p_section text,
  p_entity_type text,
  p_side text,
  p_min_gap_m numeric DEFAULT 10,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  from_station numeric,
  to_station numeric,
  gap_m numeric
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH ordered AS (
    SELECT station_m,
           LEAD(station_m) OVER (ORDER BY station_m) AS next_station
    FROM road_assets
    WHERE section = p_section AND entity_type = p_entity_type AND side = p_side
  )
  SELECT station_m AS from_station, next_station AS to_station, (next_station - station_m) AS gap_m
  FROM ordered
  WHERE next_station IS NOT NULL AND (next_station - station_m) > p_min_gap_m
  ORDER BY gap_m DESC
  LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION road_asset_gaps_detail(text, text, text, numeric, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION road_asset_gaps_detail(text, text, text, numeric, int) TO service_role;

-- ── Verification (run manually after applying) ───────────────────────────
-- EXPLAIN ANALYZE SELECT * FROM road_asset_layer_summary('Section 3 - Calabar');
-- EXPLAIN ANALYZE SELECT * FROM road_asset_layer_summary('Kebbi section', 10, 'crcp');
-- 'Kebbi section' with p_entity_type NULL (the whole ~5.5M-row section in
-- one call) is expected to still be slow/timeout — the API route always
-- splits Kebbi into 8 parallel per-entity_type calls instead (see
-- SPLIT_ENTITY_TYPES in src/app/api/road-assets/route.ts), each of which
-- should be fast on its own.
