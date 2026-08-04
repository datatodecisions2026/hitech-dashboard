-- Migration name (for Supabase migration history): add_planning_implementation_rpc
--
-- Backs GET /api/planning-implementation (src/app/api/planning-implementation/route.ts)
-- and the new /planning-implementation page.
--
-- hitech_construction_entities has ~580k rows (4,046 distinct global_id values —
-- each logical entity spans many row segments), so this must run as an RPC, never
-- as a fetchAll()-into-JS reduce — same reasoning as the existing progress_* RPCs
-- (see CLAUDE.md's 2026-07-22 "/progress timing out" changelog entry).
--
-- "Section" does not exist as a column on the planning side (hitech_construction_entities
-- has no section_name) — only hitech_report_hitechreport does. So a planning entity's
-- section is derived by joining its global_id to a matching activity report's globalid
-- and taking that report's section_name; entities with no matching report fall into
-- 'Unlinked / No Section'.
--
-- Definitions (confirmed with the user before building this):
--   Total       = distinct global_id count in hitech_construction_entities for the project
--   Planned     = of those, entities with a non-null planned_date
--   Implemented = of those, entities that have at least one matching report
--                 (hitech_report_hitechreport.globalid = hitech_construction_entities.global_id)
--                 — i.e. field-confirmed, not just planning-table status/date_completed.

CREATE OR REPLACE FUNCTION progress_section_breakdown(p_project text)
RETURNS TABLE (
  section text,
  total_count bigint,
  planned_count bigint,
  implemented_count bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH entity_agg AS (
    SELECT
      global_id,
      bool_or(planned_date IS NOT NULL) AS has_planned
    FROM hitech_construction_entities
    WHERE project_name ILIKE p_project
      AND global_id IS NOT NULL
    GROUP BY global_id
  ),
  report_section AS (
    SELECT DISTINCT ON (globalid)
      globalid,
      section_name
    FROM hitech_report_hitechreport
    WHERE project_name ILIKE p_project
      AND globalid IS NOT NULL
    ORDER BY globalid, id DESC
  )
  SELECT
    COALESCE(NULLIF(rs.section_name, ''), 'Unlinked / No Section') AS section,
    COUNT(*)::bigint AS total_count,
    COUNT(*) FILTER (WHERE ea.has_planned)::bigint AS planned_count,
    COUNT(*) FILTER (WHERE rs.globalid IS NOT NULL)::bigint AS implemented_count
  FROM entity_agg ea
  LEFT JOIN report_section rs ON rs.globalid = ea.global_id
  GROUP BY 1
  ORDER BY total_count DESC;
$$;

-- Not behind PostgREST RLS — restrict to service_role only, same convention as
-- every other progress_*/streetlights_* RPC in this project.
REVOKE ALL ON FUNCTION progress_section_breakdown(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION progress_section_breakdown(text) FROM anon;
REVOKE ALL ON FUNCTION progress_section_breakdown(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION progress_section_breakdown(text) TO service_role;

-- Verification, once applied — run against the real project data before shipping:
--   select * from progress_section_breakdown('Coastal Road');
--   explain analyze select * from progress_section_breakdown('Coastal Road');
-- Expect well under the authenticator role's 8s statement_timeout given the
-- entities table collapses to ~4k distinct global_id rows before the join.
-- If EXPLAIN ANALYZE shows this struggling, the first things to check are (a)
-- whether project_name has an index (progress_summary_counts etc. rely on the
-- same ILIKE-exact-match pattern without one and stay fast at this row count,
-- so likely fine) and (b) whether PARALLEL SAFE helps or hurts here — it was a
-- measured net negative for one bbox-branching function (streetlights_cluster,
-- see 2026-07-30 changelog) but a measured net positive for every progress_*
-- function doing a plain aggregate like this one (2026-07-22 changelog) — don't
-- assume, verify.
