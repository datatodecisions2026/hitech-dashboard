-- Road Corridors: raw survey-line fragments for Calabar / Ogun / Kebbi,
-- ingested directly from the user's own shapefiles (Downloads/shapefiles/
-- {Calabar_shapefile,Ogun_shapefile,Kebbi}.zip). See sync_road_corridors.py
-- for the reprojection + ingestion pipeline and the 2026-09-17 CLAUDE.md
-- changelog entry for why this table looks the way it does.
--
-- Real finding, not assumed: none of the three source files is a single
-- clean corridor line. Each is hundreds of thousands to millions of tiny
-- fragments (median fragment = 2 points) — almost certainly a CAD-export
-- artifact where one continuous alignment polyline got exploded into a
-- separate feature per vertex-to-vertex span, with no ordering/connectivity
-- preserved. Reconstructing exact topology (stitching fragments back into
-- one line via shared endpoints) was considered and rejected as too fragile
-- against real-world snapping tolerance issues; instead this is treated the
-- same way road_assets/streetlights already are in this project — ingest the
-- real data in full, get real aggregate stats via SQL, and render a
-- viewport/zoom-scoped decimated sample rather than pushing millions of
-- fragments to a browser at once.
--
-- Apply this manually via the Supabase SQL editor or MCP (this repo has no
-- Supabase CLI migration setup — same convention as every other
-- scripts/sql/*.sql file here). Run sync_road_corridors.py AFTER this is
-- applied — the script does inserts only, no DDL.

create extension if not exists postgis;

create table if not exists public.road_corridors (
  id        bigserial primary key,
  region    text not null check (region in ('calabar', 'ogun', 'kebbi')),
  geom      geometry(LineString, 4326) not null,
  length_m  numeric not null,
  npoints   int not null
);

create index if not exists idx_road_corridors_region on public.road_corridors (region);
create index if not exists idx_road_corridors_geom   on public.road_corridors using gist (geom);

-- Real aggregate stats — total_length_m/segment_count are genuine SUM/COUNT
-- over the full 4.87M-row table, computed once directly against the raw
-- table (no 8s statement_timeout risk in a manual SQL-editor session) and
-- cached in this tiny 3-row table. NOT the same "measure before assuming"
-- outcome originally guessed here — that guess (a live GROUP BY needs no
-- cache table) was wrong, and was corrected by actually measuring: a plain
-- `select region, count(*), sum(length_m) group by region` against the live
-- table measured 4.87–7.68s per call, uncomfortably close to (and on one
-- observed run, over) the authenticator role's 8s statement_timeout even
-- for a single request — before any concurrency is considered. Confirmed
-- live via a real Playwright pass: /road-corridors' default "All Regions"
-- view fires 3 concurrent per-region fetches on first load, and even with
-- the route-level in-process request-dedup already in place
-- (cachedSummary() in src/app/api/road-corridors/route.ts), the underlying
-- single query was still marginal enough to genuinely time out (57014) on
-- a real run, not just a contention artifact. A cache table removes the
-- risk at its root — reads become a 3-row lookup, effectively instant,
-- regardless of concurrency or Postgres cache warmth.
create table if not exists public.road_corridors_summary_cache (
  region         text primary key,
  segment_count  bigint not null,
  total_length_m numeric not null
);

-- Run this ONCE (re-run only if road_corridors is ever re-ingested) —
-- same one-time-population convention as road_corridors_grid above.
insert into public.road_corridors_summary_cache (region, segment_count, total_length_m)
select region, count(*)::bigint, coalesce(sum(length_m), 0)
from public.road_corridors
group by region
on conflict (region) do update set
  segment_count  = excluded.segment_count,
  total_length_m = excluded.total_length_m;

create or replace function public.road_corridor_summary()
returns table(region text, segment_count bigint, total_length_m numeric)
language sql stable parallel safe as $$
  select region, segment_count, total_length_m
  from public.road_corridors_summary_cache;
$$;

-- Real finding (found live, after real data existed — 4.87M rows across
-- 3 regions): the first version of road_corridor_segments() queried
-- road_corridors directly and timed out (57014, the authenticator role's 8s
-- statement_timeout) on EVERY call tested, not just the pathological one:
--   1. A bbox-scoped call (Kebbi, a real zoomed-in viewport) still timed out
--      at ~9s. Root cause: `where region = p_region and (not v_has_bbox or
--      geom && envelope)` is the exact same "OR in the WHERE clause defeats
--      the GIST index" bug this project already hit and fixed once before —
--      see streetlights_cluster in the 2026-07-30 changelog. The OR form
--      stops the planner from using idx_road_corridors_geom, so even a
--      viewport covering a tiny fraction of Kebbi's 3.3M rows forced a full
--      per-row ST_Centroid + windowed sort over the whole region.
--   2. A whole-region call (no bbox) timed out for a more fundamental
--      reason: there is no bbox to narrow a multi-million-row scan down
--      from in the first place — and this is not a rare edge case, it's the
--      FIRST fetch every region always makes (RoadCorridorMap's viewState
--      starts null, before any Google Maps `idle` event has fired once).
--
-- Fix: a small pre-computed grid cache table, same category of
-- infrastructure as road_assets_grid_mv / streetlights_grid_mv, but a plain
-- table populated once rather than a materialized view on a pg_cron
-- refresh — this data is a one-time static ingestion (sync_road_corridors.py
-- is run once, not on a schedule), so a periodic refresh mechanism would be
-- solving a problem that doesn't exist here. road_corridor_segments() now
-- ALWAYS reads this table, never the raw 4.87M-row road_corridors table, so
-- neither the index-defeat bug nor the no-bbox-full-scan problem can recur —
-- the live table it queries is small regardless of bbox presence, so it
-- doesn't matter whether the planner uses an index against it or not.
create table if not exists public.road_corridors_grid (
  region    text not null,
  gx        bigint not null,
  gy        bigint not null,
  id        bigint not null references public.road_corridors(id) on delete cascade,
  length_m  numeric not null,
  npoints   int not null,
  primary key (region, gx, gy)
);

create index if not exists idx_road_corridors_grid_region_length on public.road_corridors_grid (region, length_m desc);

-- Run this ONCE, after road_corridors is fully populated (re-run only if the
-- source shapefiles are ever re-ingested). A manual SQL-editor session has
-- no 8s statement_timeout — unlike the service_role RPC path above, this can
-- afford to scan all 4.87M rows. Base grid = 0.001 degrees (~111m) — fine
-- enough to match the finest zoom tier gridDegForZoom() (in
-- src/app/api/road-corridors/route.ts) ever requests; every coarser tier the
-- route asks for re-buckets cheaply from this table at query time.
-- ST_Centroid(rc.geom) is computed exactly once per row via the lateral
-- join below, then reused for both gx and gy — the straightforward version
-- (ST_Centroid(rc.geom) written out separately for gx, gy, and again inside
-- the window PARTITION BY) would recompute it up to 4x per row, needlessly
-- multiplying the cost of an already-large one-time 4.87M-row scan.
truncate public.road_corridors_grid;
insert into public.road_corridors_grid (region, gx, gy, id, length_m, npoints)
select region, gx, gy, id, length_m, npoints
from (
  select id, region, length_m, npoints, gx, gy,
         row_number() over (partition by region, gx, gy order by length_m desc) as rn
  from (
    select rc.id, rc.region, rc.length_m, rc.npoints,
           floor(ST_X(c.ctr) / 0.001) as gx,
           floor(ST_Y(c.ctr) / 0.001) as gy
    from public.road_corridors rc,
         lateral (select ST_Centroid(rc.geom) as ctr) c
  ) with_grid
) ranked_grid
where rn = 1;

-- Real finding (found live from a user screenshot comparison against the
-- source ArcGIS Pro data, not assumed): road_corridors_grid's fixed
-- 0.001-degree (~111m) base cell size is a hard ceiling — no matter how far
-- a caller zooms in, this function could never return more than one
-- representative segment per ~111m cell, because that decimation already
-- happened once, permanently, when the cache table was populated. Measured
-- live: a real ~1km x 1km Kebbi box holds 14,457 raw fragments in
-- road_corridors, but the grid-cache path could only ever surface 18 of
-- them there, regardless of how fine a p_grid_deg was requested. Worse, the
-- "keep the single longest fragment per cell" heuristic is actively wrong
-- at this data's real shape (median fragment = 2 points, most are short) —
-- it biases toward the rare long outliers and discards the dense short
-- fragments that give the real geometry its continuous, tightly-bundled
-- look, which is exactly why the rendered map looked "broken" (isolated
-- dashes with large gaps) next to the dense parallel-line bundle visible in
-- the real ArcGIS Pro source data.
--
-- Fix: once a caller is requesting detail finer than or equal to the grid
-- cache's base resolution (p_grid_deg <= v_base_grid — this is exactly the
-- finest tier gridDegForZoom() ever requests, zoom > 14), skip the grid
-- cache entirely and scan the raw road_corridors table directly within the
-- (now genuinely small, real-world ~1km-scale) viewport, capped by
-- p_max_segments with no per-cell winner-take-all — every real fragment in
-- view has an equal chance of being kept, not just the longest one per
-- cell. This is a real, separate query body (not one query branching on a
-- bare boolean OR) specifically to avoid the "OR in the WHERE clause
-- defeats the GIST index" bug this project has now hit twice on this exact
-- table (see the road_corridors_grid comment above) — the bbox is
-- unconditional here, so idx_road_corridors_geom can always be used, and a
-- defensive width/height cap (0.1 degrees, ~11km per side) keeps this path
-- bounded even if a caller ever sends an unexpectedly large "high zoom"
-- bbox.
--
-- p_after_id: a keyset-pagination cursor for this path only, added after a
-- real user screenshot showed a genuinely dense hotspot (confirmed live:
-- ~1000+ real fragments packed into a ~90m x 155m area) still looking
-- patchy/incomplete — PostgREST hard-caps every single response at 1000
-- rows regardless of p_max_segments, so one call can never surface more
-- than 1000 of a hotspot's real fragments. Keyset pagination (WHERE id >
-- p_after_id, not PostgREST's .range()/OFFSET) lets the API route make
-- several real calls to accumulate more of a hotspot's true density,
-- without depending on how PostgREST slices an RPC's result set (which
-- this project's own history notes as unreliable for RPCs — see the
-- 2026-07-22 "map freezing" changelog entry). `order by rc.id` was
-- confirmed live via EXPLAIN ANALYZE to be cheap (~176ms, a Postgres
-- top-N heapsort over a small ~1,515-row bbox-filtered candidate set, not
-- a full sort of a huge unbounded set) — the earlier version of this
-- comment claimed this was "tested both ways" without actually having run
-- the ORDER BY version live; that was inaccurate, corrected here by
-- actually measuring before deciding.
--
-- Real bug hit live applying this exact change: CREATE OR REPLACE FUNCTION
-- only replaces a function whose parameter signature (types + count)
-- matches exactly — adding p_after_id here changed the signature, so
-- Postgres created a SECOND overloaded function instead of replacing the
-- original 7-parameter one. PostgREST then couldn't resolve which overload
-- to call for any request that didn't explicitly supply all 8 named
-- params, surfacing as a live PGRST203 "Could not choose the best
-- candidate function" error on every real map request. The explicit DROP
-- below (matching the old signature exactly) is required before this
-- CREATE — do this any time a function's parameter list changes, not just
-- its body.
drop function if exists public.road_corridor_segments(text, double precision, double precision, double precision, double precision, double precision, int);

create or replace function public.road_corridor_segments(
  p_region     text,
  p_min_lat    double precision default null,
  p_max_lat    double precision default null,
  p_min_lng    double precision default null,
  p_max_lng    double precision default null,
  p_grid_deg   double precision default 0.01,
  p_max_segments int default 3000,
  p_after_id   bigint default null
)
returns table(id bigint, length_m numeric, npoints int, geojson text)
language plpgsql stable parallel safe as $$
declare
  v_has_bbox boolean := p_min_lat is not null and p_max_lat is not null and p_min_lng is not null and p_max_lng is not null;
  v_base_grid constant double precision := 0.001;
  v_factor int := greatest(1, round(p_grid_deg / v_base_grid)::int);
  v_max_bbox_span constant double precision := 0.1;
begin
  if v_has_bbox and p_grid_deg <= v_base_grid
     and (p_max_lat - p_min_lat) <= v_max_bbox_span
     and (p_max_lng - p_min_lng) <= v_max_bbox_span then
    -- Measured live: PostgREST hard-caps every response at 1000 rows
    -- project-wide (the same well-documented ceiling this project has hit
    -- repeatedly elsewhere — map_chainage_line, /api/map, /api/progress)
    -- regardless of what p_max_segments requests here, so LEAST(...,1000)
    -- avoids computing/transferring rows that would only be silently
    -- discarded downstream. `order by rc.id` + `p_after_id` together let
    -- the API route page past that 1000-row cap via keyset pagination when
    -- a real hotspot has more fragments than one call can return — see the
    -- p_after_id comment above the function signature for the full story
    -- (confirmed live via EXPLAIN ANALYZE that ordering is cheap here, not
    -- assumed).
    return query
    select rc.id, rc.length_m, rc.npoints, ST_AsGeoJSON(rc.geom)
    from public.road_corridors rc
    where rc.region = p_region
      and rc.geom && ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)
      and (p_after_id is null or rc.id > p_after_id)
    order by rc.id
    limit least(p_max_segments, 1000);
    return;
  end if;

  return query
  -- NB: every column reference below is fully qualified (base.length_m,
  -- ranked.length_m, etc.) rather than bare (length_m). RETURNS TABLE(...,
  -- length_m numeric, ...) implicitly declares `length_m` as a PL/pgSQL
  -- variable inside this function body, which makes any bare `length_m` in
  -- the query genuinely ambiguous — Postgres errors with 42702 rather than
  -- guessing. Caught live: the very first version of this function errored
  -- on every call once real data existed, never actually returning rows.
  --
  -- This path (grid-cache-backed, one representative-by-length segment per
  -- re-bucketed cell) is still exactly right for a zoomed-out overview —
  -- only the close-zoom case above needed the raw-table detail path.
  with base as (
    select g.id, g.length_m, g.npoints,
           floor(g.gx::double precision / v_factor) as cgx,
           floor(g.gy::double precision / v_factor) as cgy
    from public.road_corridors_grid g
    where g.region = p_region
      and (not v_has_bbox or (
        (g.gx * v_base_grid) between (p_min_lng - v_base_grid) and (p_max_lng + v_base_grid)
        and (g.gy * v_base_grid) between (p_min_lat - v_base_grid) and (p_max_lat + v_base_grid)
      ))
  ),
  ranked as (
    select base.id, base.length_m, base.npoints,
           row_number() over (partition by base.cgx, base.cgy order by base.length_m desc) as rn
    from base
  )
  select ranked.id, ranked.length_m, ranked.npoints, ST_AsGeoJSON(rc.geom)
  from ranked
  join public.road_corridors rc on rc.id = ranked.id
  where ranked.rn = 1
  order by ranked.length_m desc
  limit p_max_segments;
end;
$$;

revoke all on function public.road_corridor_summary  from public, anon, authenticated;
revoke all on function public.road_corridor_segments from public, anon, authenticated;
grant execute on function public.road_corridor_summary  to service_role;
grant execute on function public.road_corridor_segments to service_role;

-- Verification queries to run after applying + after sync_road_corridors.py:
-- select * from road_corridor_summary();
-- select count(*) from road_corridors where region = 'kebbi';
-- select count(*) from road_corridors_grid;
-- select * from road_corridor_segments('calabar', null, null, null, null, 0.02, 500);
-- explain analyze select * from road_corridor_segments('kebbi', 11.5,12.1,4.2,4.8, 0.005, 2000);
