-- Migration name (for Supabase migration history): add_road_assets_infra
--
-- Backs GET /api/road-assets (src/app/api/road-assets/route.ts) and the new
-- /road-assets page + RoadAssetsMap component.
--
-- road_assets is 7,271,513 rows (confirmed live 2026-08-04) — larger than the
-- 3M-row streetlights table, which already needed a materialized view + two
-- clustering RPCs (see the 2026-07-30 streetlights changelog) to stay off the
-- authenticator role's 8s statement_timeout. Same category of problem here,
-- one size up. Columns actually present (confirmed live, not assumed):
--   id (int8 pk), project (text), section (text), entity_type (text),
--   x, y (projected coords), lat, lon (double precision), z (elevation),
--   side (text), station_m (numeric), station (text), geom (PostGIS point,
--   SRID 4326), extra (jsonb — e.g. {"name":"StoneBase","objectid":...}).
--
-- Confirmed project/section split (live queries, 2026-08-04):
--   project 'Coastal road'          -> 1,745,935 rows
--     section 'Section 3 - Calabar' ->   1,344,386 of those
--     section 'Section 3 - Ogun'    ->   the remainder (real name confirmed
--                                        live — NOT "Section 4A (Ogun)",
--                                        which is a different table's
--                                        naming; hitech_ogun_entities uses
--                                        its own unrelated section labels)
--   project 'Kebbi - Sokoto project' -> 5,525,578 rows, all 'Kebbi section'
--
-- DATA QUALITY ISSUE FOUND LIVE, NOT ASSUMED: a real subset of
-- 'Section 3 - Ogun' rows have NULL lat/lon (confirmed via direct sampling —
-- both null and non-null rows exist under that exact section value; Calabar
-- and Kebbi section samples came back fully populated). Those rows do still
-- have x/y (projected coordinates, CRS unknown/unconfirmed) and a NULL geom.
-- This looks like an incomplete coordinate conversion for part of one
-- import batch, not a bug in anything this migration does. Every clustering
-- query below naturally excludes NULL-lat/lon rows (a NULL fails any
-- BETWEEN/comparison predicate in SQL, so they're never grouped into a
-- bogus cell) — but this means some fraction of Ogun's assets will simply
-- never appear on the map or in any cluster count until that's fixed at the
-- source. Flag this to the user rather than silently rendering an
-- incomplete Ogun dataset with no explanation.
--
-- IMPORTANT DESIGN DIFFERENCE FROM STREETLIGHTS: streetlights routed *any*
-- section filter through the live table regardless of bbox, because even its
-- largest single section ("Kebbi", coincidentally) was only ~450k rows
-- (measured 428ms with no bbox). That reasoning does NOT carry over here —
-- 'Kebbi - Sokoto project' alone is 5.5M rows, so a project/section filter
-- with no bbox must still be answered from the materialized view, never the
-- live table. The live per-request RPC below is therefore designed to
-- REQUIRE a bbox (enforced by the caller in route.ts, which only invokes it
-- once zoom >= 12 and a real viewport is known) rather than optionally
-- accepting one — this also sidesteps the exact bug streetlights_cluster
-- shipped with (a single query body branching on "has bbox or not" defeated
-- idx_streetlights_latlon and needed PARALLEL UNSAFE to fix — see the
-- 2026-07-30 changelog). One deterministic query shape, always bbox-bound,
-- needs no such workaround — but verify with EXPLAIN ANALYZE regardless,
-- don't assume.

-- ── Indexes on the base table ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_road_assets_latlon  ON road_assets (lat, lon);
CREATE INDEX IF NOT EXISTS idx_road_assets_project ON road_assets (project);
CREATE INDEX IF NOT EXISTS idx_road_assets_section ON road_assets (section);

-- ── Grid materialized view ───────────────────────────────────────────────
-- Keyed by (grid_lat, grid_lon, project, section) rather than just
-- (grid_lat, grid_lon) like streetlights_grid_mv — this is what lets a
-- project/section filter with no bbox stay cheap (filter the ~few-thousand
-- row MV, never the live 7.27M-row table). A 0.02deg cell (~2.2km) is not
-- expected to straddle both projects given their real geographic separation
-- (Kebbi ~11.5N vs Coastal Road/Calabar ~6.4N), so this shouldn't multiply
-- row count much versus a plain (grid_lat, grid_lon) key — confirm the MV's
-- actual row count after refresh (see verification queries at the bottom)
-- and reconsider if it's surprisingly large.
-- WHERE lat/lon IS NOT NULL is required, not defensive fluff — see the
-- "DATA QUALITY ISSUE" note above. Without it, every NULL-coordinate row
-- (round(NULL/0.02) = NULL) collapses into one grid_lat=NULL/grid_lon=NULL
-- row that would silently vanish from every bbox query anyway (NULL BETWEEN
-- always evaluates NULL, never true) — excluding them explicitly here just
-- makes that intentional instead of incidental.
CREATE MATERIALIZED VIEW IF NOT EXISTS road_assets_grid_mv AS
SELECT
  round(lat / 0.02) * 0.02 AS grid_lat,
  round(lon / 0.02) * 0.02 AS grid_lon,
  project,
  section,
  count(*) AS point_count
FROM road_assets
WHERE lat IS NOT NULL AND lon IS NOT NULL
GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX IF NOT EXISTS idx_road_assets_grid_mv_pk
  ON road_assets_grid_mv (grid_lat, grid_lon, project, section);
CREATE INDEX IF NOT EXISTS idx_road_assets_grid_mv_project ON road_assets_grid_mv (project);
CREATE INDEX IF NOT EXISTS idx_road_assets_grid_mv_section ON road_assets_grid_mv (section);

-- ── Cache tables (refreshed by the cron job below, never queried live) ──
-- geolocated_estimate / geolocated_point_count columns below (not just
-- point_count) exist because of the NULL lat/lon issue documented above —
-- point_count is "how many rows exist", geolocated_point_count is "how many
-- of those can actually appear on the map". Both are worth keeping visible
-- rather than quietly only showing the smaller, mappable number.
CREATE TABLE IF NOT EXISTS road_assets_summary_cache (
  id                    integer PRIMARY KEY DEFAULT 1,
  total_estimate        bigint,
  geolocated_estimate   bigint,
  project_count         integer,
  section_count         integer,
  entity_type_count     integer,
  refreshed_at          timestamptz
);
INSERT INTO road_assets_summary_cache (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS road_assets_project_stats (
  project                 text PRIMARY KEY,
  point_count             bigint,
  geolocated_point_count  bigint
);

CREATE TABLE IF NOT EXISTS road_assets_section_stats (
  project                 text,
  section                 text,
  point_count             bigint,
  geolocated_point_count  bigint,
  PRIMARY KEY (project, section)
);

CREATE TABLE IF NOT EXISTS road_assets_entity_type_stats (
  entity_type  text PRIMARY KEY,
  point_count  bigint
);

-- ── Refresh function + cron job ──────────────────────────────────────────
-- Each GROUP BY here is a full scan of a 7.27M-row table — too slow for any
-- request path (streetlights measured 8-10s for a single such aggregate on
-- its 3M-row table, right at the authenticator role's 8s statement_timeout;
-- expect longer here). This function is NOT called from the app — it only
-- ever runs as a scheduled pg_cron job, which is not subject to that
-- request-path timeout. Test its real runtime after applying (see bottom)
-- and widen the schedule below if it's taking a large fraction of the
-- interval. road_assets looks like static survey/CAD data (unlike
-- streetlights' live-sensor framing), so a slower cadence than streetlights'
-- 10 minutes is likely fine — defaulted to 15 minutes here, adjust freely.
CREATE OR REPLACE FUNCTION road_assets_refresh_summary_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY road_assets_grid_mv;

  -- geolocated_point_count via a FILTER clause, not a second GROUP BY pass —
  -- one scan gives both point_count and geolocated_point_count together.
  DELETE FROM road_assets_project_stats;
  INSERT INTO road_assets_project_stats (project, point_count, geolocated_point_count)
  SELECT project, count(*), count(*) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL)
  FROM road_assets GROUP BY project;

  DELETE FROM road_assets_section_stats;
  INSERT INTO road_assets_section_stats (project, section, point_count, geolocated_point_count)
  SELECT project, section, count(*), count(*) FILTER (WHERE lat IS NOT NULL AND lon IS NOT NULL)
  FROM road_assets GROUP BY project, section;

  DELETE FROM road_assets_entity_type_stats;
  INSERT INTO road_assets_entity_type_stats (entity_type, point_count)
  SELECT entity_type, count(*) FROM road_assets GROUP BY entity_type;

  UPDATE road_assets_summary_cache SET
    total_estimate      = (SELECT reltuples::bigint FROM pg_class WHERE relname = 'road_assets'),
    geolocated_estimate = (SELECT coalesce(sum(geolocated_point_count), 0) FROM road_assets_project_stats),
    project_count        = (SELECT count(*) FROM road_assets_project_stats),
    section_count        = (SELECT count(*) FROM road_assets_section_stats),
    entity_type_count    = (SELECT count(*) FROM road_assets_entity_type_stats),
    refreshed_at          = now()
  WHERE id = 1;
END;
$$;

-- Run once immediately so the cache/MV aren't empty until the first cron
-- tick — this call itself may take a while (see comment above); that's
-- expected and fine to run manually/once, just not from a request.
SELECT road_assets_refresh_summary_cache();

SELECT cron.schedule(
  'refresh_road_assets_summary_cache',
  '*/15 * * * *',
  $$SELECT road_assets_refresh_summary_cache()$$
);

-- ── MV-backed cluster RPC — the safe default path (no bbox, or zoomed out,
-- or a project/section filter with no bbox yet) ─────────────────────────
CREATE OR REPLACE FUNCTION road_assets_clusters(
  min_lon double precision, min_lat double precision,
  max_lon double precision, max_lat double precision,
  grid_size double precision,
  p_project text DEFAULT NULL,
  p_section text DEFAULT NULL
)
RETURNS TABLE (cluster_lat double precision, cluster_lon double precision, point_count bigint)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    round(grid_lat / grid_size) * grid_size AS cluster_lat,
    round(grid_lon / grid_size) * grid_size AS cluster_lon,
    sum(point_count)::bigint AS point_count
  FROM road_assets_grid_mv
  WHERE grid_lat BETWEEN min_lat AND max_lat
    AND grid_lon BETWEEN min_lon AND max_lon
    AND (p_project IS NULL OR project = p_project)
    AND (p_section IS NULL OR section = p_section)
  GROUP BY 1, 2
  ORDER BY point_count DESC
  LIMIT 900;
$$;

REVOKE ALL ON FUNCTION road_assets_clusters(double precision,double precision,double precision,double precision,double precision,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION road_assets_clusters(double precision,double precision,double precision,double precision,double precision,text,text) FROM anon;
REVOKE ALL ON FUNCTION road_assets_clusters(double precision,double precision,double precision,double precision,double precision,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION road_assets_clusters(double precision,double precision,double precision,double precision,double precision,text,text) TO service_role;

-- ── Live cluster RPC — ONLY ever called by route.ts once a real bbox is
-- known (zoom >= 12). p_min_lat/p_max_lat/p_min_lng/p_max_lng are NOT
-- declared NOT NULL at the SQL level (Postgres function params can't be),
-- so this raises explicitly rather than silently scanning the whole table
-- if ever called without one — a deliberate guard against the exact
-- accidental-full-scan class of bug this whole design exists to prevent. ──
CREATE OR REPLACE FUNCTION road_assets_cluster(
  p_min_lat double precision, p_max_lat double precision,
  p_min_lng double precision, p_max_lng double precision,
  p_project text, p_section text,
  p_grid_deg double precision, p_max_points integer DEFAULT 900
)
RETURNS TABLE (
  cluster_lat double precision, cluster_lon double precision, point_count bigint,
  rep_id bigint, rep_entity_type text, rep_project text, rep_section text,
  rep_side text, rep_station text
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  v_grid  double precision := p_grid_deg;
  v_count integer;
BEGIN
  IF p_min_lat IS NULL OR p_max_lat IS NULL OR p_min_lng IS NULL OR p_max_lng IS NULL THEN
    RAISE EXCEPTION 'road_assets_cluster requires a bounding box (this table is 7.27M rows — no unbounded live query allowed)';
  END IF;

  -- Self-limiting: pre-count candidate cells at the requested grid size and
  -- coarsen until under the output budget, same technique as
  -- streetlights_cluster / map_chainage_line (both documented in CLAUDE.md).
  LOOP
    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM road_assets
      WHERE lat BETWEEN p_min_lat AND p_max_lat
        AND lon BETWEEN p_min_lng AND p_max_lng
        AND (p_project IS NULL OR project = p_project)
        AND (p_section IS NULL OR section = p_section)
      GROUP BY round(lat / v_grid), round(lon / v_grid)
    ) s;
    EXIT WHEN v_count <= p_max_points OR v_grid > 5.0;
    v_grid := v_grid * 2;
  END LOOP;

  RETURN QUERY
  WITH grid AS (
    SELECT id, lat, lon, entity_type, project, section, side, station,
           round(lat / v_grid) AS gy, round(lon / v_grid) AS gx
    FROM road_assets
    WHERE lat BETWEEN p_min_lat AND p_max_lat
      AND lon BETWEEN p_min_lng AND p_max_lng
      AND (p_project IS NULL OR project = p_project)
      AND (p_section IS NULL OR section = p_section)
  ),
  agg AS (
    SELECT gy, gx, count(*) AS point_count, min(id) AS rep_id,
           avg(lat) AS cluster_lat, avg(lon) AS cluster_lon
    FROM grid
    GROUP BY gy, gx
  )
  SELECT a.cluster_lat, a.cluster_lon, a.point_count,
         g.id, g.entity_type, g.project, g.section, g.side, g.station
  FROM agg a
  JOIN grid g ON g.id = a.rep_id
  ORDER BY a.point_count DESC
  LIMIT p_max_points;
END;
$$;

REVOKE ALL ON FUNCTION road_assets_cluster(double precision,double precision,double precision,double precision,text,text,double precision,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION road_assets_cluster(double precision,double precision,double precision,double precision,text,text,double precision,integer) FROM anon;
REVOKE ALL ON FUNCTION road_assets_cluster(double precision,double precision,double precision,double precision,text,text,double precision,integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION road_assets_cluster(double precision,double precision,double precision,double precision,text,text,double precision,integer) TO service_role;

-- ── Verification — run all of these after applying, before trusting the
-- page. This migration was written without any live DDL-execution access
-- (see the 2026-08-04 changelog), so none of the below has actually been
-- run against real data yet. ──────────────────────────────────────────────
--
-- 1. Confirm the presumed Ogun section (never directly confirmed live):
--   SELECT section, count(*) FROM road_assets WHERE project = 'Coastal road' GROUP BY section;
--
-- 2. Confirm the MV isn't unexpectedly large (expect low thousands of rows,
--    similar order to streetlights_grid_mv's 1,743):
--   SELECT count(*) FROM road_assets_grid_mv;
--
-- 3. Time the refresh function itself (decides whether */15 needs widening):
--   SELECT road_assets_refresh_summary_cache(); -- note wall time
--
-- 4. EXPLAIN ANALYZE the live RPC against a real dense bbox — confirm
--    idx_road_assets_latlon is actually used (index scan, not seq scan) and
--    total time stays well under 8s. Pick real bbox values from a section's
--    known lat/lon range first, e.g.:
--   EXPLAIN ANALYZE SELECT * FROM road_assets_cluster(11.4, 11.5, 4.5, 4.6, NULL, NULL, 0.0004, 900);
--
-- 5. Confirm the MV-backed RPC:
--   SELECT * FROM road_assets_clusters(-180, -90, 180, 90, 0.5, NULL, NULL) LIMIT 10;
--   SELECT * FROM road_assets_clusters(-180, -90, 180, 90, 0.5, 'Kebbi - Sokoto project', NULL) LIMIT 10;
