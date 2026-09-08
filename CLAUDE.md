# Hitech Analytics Dashboard — Claude Code Context

Standalone analytics dashboard for Hitech Construction Ltd. Built with Next.js 16.2.6 (App Router, Turbopack), Supabase, and iron-session auth.

> **Next.js version note:** This uses Next.js 16.2.6 which may have APIs that differ from your training data. Read `node_modules/next/dist/docs/` before writing any Next.js-specific code. Heed deprecation notices.

---

## Project Structure

```
src/
  app/
    layout.tsx              # Root layout — mounts DashHeader + SideNav, loads fonts
    page.tsx                # Redirects / → /dashboard
    globals.css             # Minimal CSS reset + keyframes
    login/page.tsx          # Login page (amber theme, dark card)
    dashboard/page.tsx      # Main dashboard (skeuomorphic, ~990 lines, self-contained)
    progress/page.tsx       # Construction progress dashboard (~820 lines, self-contained — own Panel/KPICard/Reveal, not shared with dashboard/page.tsx)
    machines/page.tsx       # Machines-focused view of dashboard data, self-contained (own Panel/KPICard/FilterBar)
    personnel/page.tsx      # Personnel-focused view of dashboard data, self-contained (near-identical structure to machines/page.tsx)
    planning-implementation/page.tsx  # Per-section Total/Planned/Implemented activity comparison COMBINED with the 7.27M-row road_assets map/KPIs/section breakdown — project+section filter bar cross-filters both, self-contained (own Panel/KPICard/Reveal). See 2026-08-05 changelog
    road-assets/page.tsx    # Redirect only (next/navigation redirect('/planning-implementation')) — the map-clustering view of road_assets is no longer a standalone page, folded into planning-implementation/page.tsx. Kept so old links don't 404. See 2026-08-05 changelog
    road-assets-coverage/page.tsx    # Calabar/Ogun/Kebbi as-built asset-layer coverage page, self-contained — own Panel/KPICard/Reveal. Overview + Timeline (gauges/bar chart/histogram/Gantt) + By Chainage (real per-segment coverage bar + fabricated itemized completion log, entity/date/chainage filters) tabs — real data mixed with a fabricated planned schedule throughout, not visually distinguished in the UI as of 2026-08-01 (3). A different view of the road_assets table than the map-clustering one now embedded in planning-implementation/page.tsx — two people independently built two different views in parallel; both kept, see the 2026-08-05 changelog entry. See 2026-08-01 changelog entries
    api/
      auth/
        login/route.ts      # POST — authenticate against Supabase auth_user table
        logout/route.ts     # POST — destroy iron-session cookie
        me/route.ts         # GET  — return session user or 401
      dashboard/route.ts    # GET  — aggregate all dashboard data from Supabase (session-guarded)
      progress/route.ts     # GET  — aggregate construction-progress data from Supabase (session-guarded)
      map/route.ts          # GET  — chainage stations + geotagged reports for HitechMap (no session guard)
      road-design/route.ts  # GET  — ArcGIS road-design CAD overlay (pavement/slope/drainage/culverts/ducts/markings) for HitechMap (session-guarded). See 2026-07-30 changelog
      planning-implementation/route.ts  # GET — per-section Total/Planned/Implemented activity counts via the progress_section_breakdown RPC, PLUS road_assets stats (summary/project/section/entity-type) and a combined total/implemented figure (session-guarded). See 2026-08-05 changelog
      road-assets/route.ts  # GET — clustered road-design asset points + summary/project/section/entity-type stats from Supabase (session-guarded) — still used by RoadAssetsMap, now embedded in /planning-implementation rather than its own page. See 2026-08-04/2026-08-05 changelog
      road-assets-coverage/route.ts  # GET  — as-built asset-layer coverage/gap stats for road_assets (session-guarded). See 2026-08-01 changelog
  components/
    DashHeader.tsx          # Sticky 52px header — logo, title, user name, logout button. Text nav links are mobile-only fallback (hidden ≥641px, SideNav covers desktop)
    SideNav.tsx             # 64px icon rail (Dashboard/Progress/Machines/Personnel/Planning & Implementation/Asset Coverage), sticky below header, hidden on /login and <640px. Road Assets was removed as a separate entry 2026-08-05 — merged into Planning & Implementation. Streetlights removed 2026-09-07 — see changelog
    HitechMap.tsx           # Google Maps JS API map (hybrid/satellite) — chainage stations + report points + ArcGIS road-design CAD overlay, used on /dashboard. Was Mapbox GL until 2026-07-22 — see changelog
    RoadAssetsMap.tsx       # Google Maps JS API map for the 7.27M-row road_assets table — clustered points, project/section filtering, no images. Was originally modeled on StreetlightsMap.tsx (removed 2026-09-07, see changelog) — internal comments still reference it as design lineage. See 2026-08-04 changelog
  lib/
    session.ts              # iron-session config (cookie: hitech-dashboard-session)
scripts/                    # Node maintenance/verification scripts (run manually, not part of the app) — backfill-chainage.mjs, check-ranges.mjs, click-filter-check.mjs, mint-session.mjs, verify-hr-filters.mjs, visual-check.mjs, road-assets-migration.sql (one-off SQL for /road-assets-coverage — see 2026-08-01 changelog)
scripts/sql/                # One-off Postgres migration SQL not tracked by any Supabase CLI setup in this repo — apply manually via the Supabase SQL editor or MCP. add_planning_implementation_rpc.sql adds progress_section_breakdown(); add_road_assets_infra.sql adds the road_assets clustering/cache infrastructure. See 2026-08-04 changelog
sync_to_supabase.py         # Pulls Main_Survey_Data/photos/employees/supervisors/engineers/machines from Google Drive Excel, upserts into hitech_report_* tables (dedupes on globalid)
sync_progress.py            # Uploads construction progress data (blocks/entities/BOQ) into hitech_construction_* tables from local CSV/XLSX
sync_ogun.py                # Append-only sync of "Ogun - Total entities.xlsx" into hitech_ogun_entities (checks row count, inserts only new rows)
```

> The three `sync_*.py` scripts are run manually/out-of-band (not deployed with the app) to populate Supabase from source Excel/CSV files exported elsewhere. They read `.env.local` for `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

---

## API Routes

### `POST /api/auth/login`

Authenticate a user. Verifies against Django-style pbkdf2_sha256 password hashes stored in the `auth_user` Supabase table.

**Request body:**
```json
{ "identifier": "user@example.com", "password": "plaintext" }
```

**Response (200):**
```json
{ "ok": true }
```

**Response (400/401):**
```json
{ "error": "Invalid credentials." }
```

Sets a `hitech-dashboard-session` cookie (httpOnly, iron-session encrypted).

---

### `POST /api/auth/logout`

Destroys the session cookie.

**Request body:** none

**Response (200):**
```json
{ "ok": true }
```

---

### `GET /api/auth/me`

Returns the currently authenticated user from the session.

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "first_name": "Kwame",
    "last_name": "Asante",
    "email": "kwame@example.com",
    "is_staff": true,
    "is_superuser": false,
    "role": "admin"
  }
}
```

**Response (401):**
```json
{ "user": null }
```

---

### `GET /api/dashboard`

Returns all aggregated analytics data. Requires a valid session (401 if not authenticated).

**Query params (all optional — combine freely, HR params are AND'd together):**
```
category, project, section, weather   — case-insensitive .ilike() match on the report columns (section matches section_name)
date_from, date_to           — inclusive date range on date_of_activity
ch_from, ch_to                — inclusive chainage range on start_chainage_val (only applied if both are valid numbers with ch_to > ch_from)
search                        — matches reporter_name/project_name/section_name/activity_type/comment_activity
machine, employee, engineer, supervisor — resolved in-memory against the HR join tables, not real columns on hitech_report_hitechreport
```

**Response (200):**
```json
{
  "summary": {
    "totalReports": 420,
    "reportsThisMonth": 38,
    "activeProjects": 5,
    "totalPhotos": 812,
    "uniqueReporters": 14,
    "completionRate": 74
  },
  "byCategory": [{ "name": "Earthworks", "count": 120 }],
  "byProject": [{ "name": "Ring Road Phase 2", "count": 85 }],
  "byDay": [{ "date": "2026-04-16", "count": 4 }],
  "byWeather": [{ "name": "Sunny", "count": 210 }],
  "byStatus": [{ "name": "Completed", "count": 310 }],
  "byMachine": [{ "name": "Excavator 12", "count": 40 }],
  "byEmployee": [{ "name": "Kofi Mensah", "count": 30 }],
  "byEngineer": [{ "name": "Ama Owusu", "count": 22 }],
  "bySupervisor": [{ "name": "Yaw Boateng", "count": 18 }],
  "byOwnership": [{ "name": "Hitech", "count": 210 }],
  "mediaItems": [
    { "file": "https://…/photo.jpg", "media_type": "image", "project_name": "Ring Road Phase 2" }
  ],
  "mapPoints": [
    {
      "lat": 5.603,  "lng": -0.187,
      "lat2": 5.605, "lng2": -0.185,
      "project": "Ring Road Phase 2",
      "category": "Earthworks",
      "status": "Completed"
    }
  ],
  "activityCalendar": [
    { "date": "2026-01-05", "count": 3, "projects": ["Ring Road Phase 2"] }
  ],
  "recentReports": [
    {
      "id": 99,
      "date_of_activity": "2026-05-14",
      "reporter_name": "Kofi Mensah",
      "project_name": "Ring Road Phase 2",
      "section_name": "Section A",
      "activity_category": "Earthworks",
      "activity_type": "Excavation",
      "activity_status": "Completed",
      "comment_activity": "Completed 50m of cut",
      "weather": "Sunny",
      "start_chainage": 1500, "end_chainage": 1550,
      "start_chainage_lat": "5.603", "start_chainage_long": "-0.187",
      "end_chainage_lat": "5.605", "end_chainage_long": "-0.185"
    }
  ],
  "filterOptions": {
    "categories": ["Earthworks", "Drainage"],
    "projects": ["Ring Road Phase 2", "N1 Highway"],
    "sections": ["Section 1-A", "Section 2"]
  },
  "activeFilters": {
    "filterCategory": "", "filterProject": "", "filterSection": "", "filterDateFrom": "", "filterDateTo": "",
    "filterChFrom": "", "filterChTo": "", "filterSearch": "",
    "filterWeather": "", "filterMachine": "", "filterEmployee": "", "filterEngineer": "", "filterSupervisor": ""
  }
}
```

`byMachine`/`byEmployee`/`byEngineer`/`bySupervisor`/`byOwnership` are computed by cross-referencing the HR join tables (fetched in full every request, joined in-memory via `report_id`) against whichever reports match the active filters — see the 2026-07-16/2026-07-18 changelog entries below for the filtering/remount bugs this shape was built to fix.

The `by*` person/weather series have the literal `"Unknown"` entry (blank raw value) **stripped out** in the route (`applyUnknownHandling` in `src/app/api/dashboard/_lib.ts`) so charts rank/percent over named entities only; the removed counts come back as a separate `unattributed: { byEngineer: 4499, byWeather: 3676, … }` map (non-zero keys only) which the pages surface as a muted "N not shown in ranking" caption. Blank `employee_name` additionally falls back to `employee_missing_name` inside `dashboard_core`. See the 2026-09-08 (3)/(4) changelog entries. `byEngineerParty`/`bySupervisorParty` are also run through `normalizePartySeries` to merge dirty label variants (`HITECH employees`, `Sub-contactor` typo) down to the two real parties.

---

### `GET /api/progress`

Returns aggregated construction-progress data (entity/block completion, delays, BOQ, Gantt). Requires a valid session (401 if not authenticated). Backs `/progress`, not `/dashboard`.

**Query params (all optional):**
```
project             — matched via .ilike() on project_name using the first word of the value (e.g. "Coastal Road" → "%Coastal%")
entity               — exact match on entity_name, plus .ilike() on activity_type for BOQ/report cross-reference
side                 — exact match, one of LHS / RHS / MEDIAN
month                — "YYYY-MM" prefix match on planned_date
ch_from, ch_to        — inclusive chainage range (only applied if both are valid numbers with ch_to > ch_from)
```

**Response (200) — shape:**
```json
{
  "summary": {
    "totalEntities": 340, "totalCompleted": 210, "overallPct": 62,
    "delayed": 48, "onSchedule": 292, "totalBoqQty": 18500,
    "totalReports": 1200, "linkedEntities": 190
  },
  "ganttData": [{ "entity": "Culvert C-12", "start": "2026-01-05", "end": "2026-02-01", "segments": 3 }],
  "progressCurve": [{ "date": "2026-01-10", "count": 5, "pct": 1.47 }],
  "monthlyProgress": [{ "entity": "Culvert C-12", "side": "LHS", "months": [{ "month": "2026-01", "completion_pct": 40, "pending_pct": 60, "cumulative_pct": 40 }], "total_completion": 72 }],
  "allMonths": ["2026-01", "2026-02"],
  "delayData": [{ "entity_name": "Culvert C-12", "side": "LHS", "label": 1500, "planned_date": "2026-01-01", "date_started": "2026-01-04", "date_completed": "2026-01-20", "delay_days": 3, "performance_status": "Delayed", "status": "Completed" }],
  "daysByEntity": [{ "entity": "Culvert C-12", "lhs": 12, "rhs": 14, "median": null }],
  "boqItems": [{ "description": "…", "activity_category": "Earthworks", "activity_type": "Excavation", "qty": 500, "unit": "m3", "rate": 12, "amount": 6000, "report_count": 8 }],
  "boqByCategory": [{ "category": "Earthworks", "qty": 12000, "amount": 144000, "items": 40 }],
  "reportsByType": [{ "type": "Excavation", "count": 120, "completed": 90, "inProgress": 20, "latest": "2026-07-10", "linked": 60 }],
  "recentReports": [ "…up to 50 most recent hitech_report_hitechreport rows matching the filters…" ],
  "activeFilters": { "filterEntity": "", "filterSide": "", "filterMonth": "", "filterChFrom": "", "filterChTo": "" },
  "filterOptions": { "entities": ["Culvert C-12"], "sides": ["LHS", "RHS", "MEDIAN"], "months": ["2026-01"] }
}
```

Reads from `hitech_construction_entities`, `hitech_construction_blocks`, `hitech_construction_boq` (all populated by `sync_progress.py`, not by the portal app), plus `hitech_report_hitechreport` for the activity-report cross-reference (`reportsByType`, `linkedEntities`).

---

### `GET /api/map`

Returns chainage stations and geotagged activity reports for `HitechMap`, keyed by project. **No session guard** — do not add sensitive data to this response without adding one.

**Query params:**
```
project                          — project display name (default "Coastal Road"), mapped to a numeric project_id via a hardcoded PROJECT_ID_MAP in the route file — add new projects there when onboarding a new road
zoom                              — current map zoom level; chooses a chainage-sampling interval (coarser when zoomed out) via intervalForZoom() in the route file
swLat, swLng, neLat, neLng        — current map viewport bounds; only applied once zoom >= 12 (at lower zoom the viewport already ≈ the whole road)
category                          — matched via .ilike() on activity_category; filters the reports array only (not chainage stations) — used by HitechMap to also zoom to fit that category's reports
```

`stations` is sampled, not exhaustive — see `hitech_report_chainage` below and the 2026-07-22 "map freezing" changelog entry for why (that table is one row per metre of road, up to 423k rows for one project).

**Response (200):**
```json
{
  "stations": [{ "label": "1+500", "chainage": 1500, "latitude": 5.603, "longitude": -0.187, "project_id": 1 }],
  "reports": [
    {
      "id": 99, "start_chainage": "1+500", "end_chainage": "1+550",
      "start_chainage_val": 1500, "end_chainage_val": 1550,
      "activity_category": "Earthworks", "activity_type": "Excavation", "activity_status": "Completed",
      "reporter_name": "Kofi Mensah", "date_of_activity": "2026-05-14",
      "project_name": "Ring Road Phase 2", "section_name": "Section A",
      "start_chainage_lat": "5.603", "start_chainage_long": "-0.187",
      "end_chainage_lat": "5.605", "end_chainage_long": "-0.185"
    }
  ],
  "projectId": 1,
  "project": "Coastal Road"
}
```

Reads `hitech_report_chainage` (station markers) and `hitech_report_hitechreport` (report chainage points), filtered by project via `.ilike()` on the first word of the project name.

---

### `GET /api/road-design`

Returns the road-design CAD geometry (pavement, slope, drainage, culverts, ducts, road markings) for `HitechMap`'s road-design overlay, sourced from an external ArcGIS Online FeatureServer the user's team publishes to — not Supabase. Session-guarded.

**Query params (all optional):**
```
project                          — project display name (default "Coastal Road"); looked up in ROAD_DESIGN_LAYERS in the route file — a project with no entry returns { layers: [] }, not an error
zoom                              — current map zoom; only used to decide whether to apply the viewport bbox below (requires zoom >= 12, same gate /api/map uses)
swLat, swLng, neLat, neLng        — current map viewport bounds; used once zoomed in enough, else the query falls back to the project's configured defaultBounds
```

`ROAD_DESIGN_LAYERS` (in the route file) maps project name → an ArcGIS FeatureServer base URL, a list of sub-layer ids with display label/color/line-style/weight, and a `defaultBounds` envelope. **Add new road sections there when onboarding them** — a config edit, not a code change (mirrors `PROJECT_ID_MAP`'s convention in `src/app/api/map/route.ts`). Only `'Coastal Road'` is configured as of this writing (Section 1c's FeatureServer, 6 layers). The ArcGIS org's content is fully public/anonymous-readable as of this writing — no API key/token needed; if that ever changes, the single `fetch()` call inside `queryLayer()` in the route file is the one place to add `&token=`.

Every ArcGIS query is always bbox-scoped (never unbounded) and paginated (`resultOffset`/`resultRecordCount`, capped at 5 pages/10,000 features per layer as a defensive ceiling) — the underlying FeatureServer's `maxRecordCount` is 2000. Field names are **not** consistent across a FeatureServer's own sub-layers (found the hard way: some layers use `Entity_Name`/`Road_Section`, others use a completely different `SJ_*` spatial-join schema — `SJ_project`/`SJ_section`/`SJ_item`/`SJ_Side`/`SJ_Status`/`SJ_Chainag`) — the route always requests `outFields=*` and tries a list of candidate field names per logical field (`pickField()` in the route file) rather than assuming one schema, so a newly onboarded section's layers work without per-layer field configuration.

**Response (200):**
```json
{
  "project": "Coastal Road",
  "source": "viewport",
  "layers": [
    {
      "id": 75, "label": "Pavement (CRCP)", "color": "#a8a29e", "dash": "solid", "weight": 4, "zIndex": 2.6,
      "features": [
        {
          "objectId": 1, "entityName": "CRCP", "roadSection": "Section 1C", "shapeLength": 7622.89,
          "side": null, "status": null, "chainage": null,
          "paths": [[{ "lat": 6.428, "lng": 3.577 }, { "lat": 6.428, "lng": 3.576 }]]
        }
      ]
    }
  ]
}
```

`source` is `"viewport"` (bbox from the map's current view), `"default-extent"` (project's configured `defaultBounds`, used pre-`idle`/at low zoom), or `"none"` (no config for this project). `paths` is already flattened from GeoJSON `LineString`/`MultiLineString` to `{lat,lng}[][]` server-side — `HitechMap` builds `google.maps.Polyline`s directly from it, no GeoJSON handling on the client.

---

### `GET /api/road-assets-coverage`

Returns as-built asset-layer coverage/gap stats for `/road-assets-coverage`, backing Calabar/Ogun/Kebbi — a different data model from `/api/progress` (no planned dates; "coverage" is derived from station presence vs. total road length). Session-guarded.

**Query params:**
```
section                    — 'Calabar' | 'Ogun' | 'Kebbi' (default 'Calabar'), mapped via SECTION_MAP in the route file to the real `road_assets.section`/`chainages.project` string — add new sections there when onboarding
entity_type, side          — both required together to trigger the gap-detail drill-down AND the by-chainage analysis; otherwise `gapDetail`/`chainageAnalysis` are both null
date_from, date_to         — 'YYYY-MM-DD'; filters chainageAnalysis.log by completedDate and gates the completedInRangeM summary figure. Only meaningful alongside entity_type+side
ch_from, ch_to             — numeric station metres; filters chainageAnalysis.log AND scopes the completedToday/ThisMonth/SoFar summary figures to that chainage range. Only meaningful alongside entity_type+side
```

**Response (200) — shape:**
```json
{
  "section": "Kebbi", "totalLengthM": 226039,
  "summary": { "entityTypeCount": 8, "avgCompletionPct": 72.4, "totalGaps": 42161 },
  "entities": [
    {
      "entityType": "crcp", "label": "CRCP",
      "sides": { "LHS": { "stationsBuilt": 224073, "minStation": 0, "maxStation": 226038, "completionPct": 99.1, "gapCount": 0, "totalGapM": 0 }, "RHS": { "...": "..." } },
      "combinedCompletionPct": 99.1,
      "plannedPct": 100, "gapPct": -0.91,
      "plannedStart": "2025-09-12", "plannedEnd": "2026-01-08", "status": "Completed"
    }
  ],
  "gapDetail": null,
  "chainageAnalysis": null,
  "timeline": {
    "isSynthetic": true,
    "daily": [{ "date": "2025-04-01", "plannedPct": 0, "actualPct": 0 }, { "...": "future dates have actualPct: null" }],
    "plannedPctToday": 94.5, "actualPctToday": 74.43, "gapPctToday": -20.07,
    "startDate": "2025-04-01", "endDate": "2027-01-01"
  },
  "filterOptions": { "sections": ["Calabar", "Ogun", "Kebbi"], "entityTypes": ["crcp", "..."], "sides": ["LHS", "RHS"] },
  "activeFilters": { "section": "Kebbi", "entityType": "", "side": "" }
}
```

`completionPct` per side = `min(100, stationsBuilt / totalLengthM * 100)`, where `stationsBuilt = (maxStation - minStation + 1) - totalGapM` (envelope minus material gaps — no `COUNT(DISTINCT station_m)`, see the `road_asset_layer_summary` RPC). Backed by two RPCs (`road_asset_layer_summary`, `road_asset_gaps_detail`, defined in `scripts/road-assets-migration.sql`) — `road_assets` is 7.27M rows, so this route never `fetchAll()`s it. Kebbi (~5.5M rows) is split into one RPC call per `entity_type` (`SPLIT_ENTITY_TYPES` in the route file, batched 4-at-a-time with a retry-once — see the 2026-08-01 changelog for why both the split and the batching were necessary). Calabar/Ogun query unsplit. See that changelog entry for the full story of getting this to perform at scale — it's the main thing worth reading before touching this route or its RPCs.

**`timeline`, `entities[].plannedPct`/`gapPct`/`plannedStart`/`plannedEnd`/`status` are fabricated illustrative data, not real project plans** — `road_assets`/`chainages` have no planned-date columns at all. `timeline.isSynthetic: true` is always present in the response even though **the UI no longer visually discloses this** (removed 2026-08-01 (3), on explicit user instruction given after the risk was raised — see that changelog entry). Read `isSynthetic` before assuming any `planned*`/`gapPct`/`status` field is real. Generated deterministically (seeded PRNG keyed by section/entity name, not `Math.random()`, so the same curve/schedule renders on every request rather than jittering on reload) by `generateTimeline()`/`entityPlannedPct()`/`generateEntitySchedule()` in the route file — see the 2026-08-01 (2) changelog for the design and the one invariant that must always hold: `timeline.daily`'s last non-null `actualPct` must exactly equal `summary.avgCompletionPct` (the real number) — `status` is likewise derived by crossing the synthetic window against the entity's real `combinedCompletionPct`, not fabricated independently. `daily` covers the full synthetic project duration (`startDate`→`endDate`, "today" sits 55–80% through it); `actualPct` is `null` for any date after today, since no "actual" exists yet for the future — the frontend's `aggregateTimeline()` (`src/app/road-assets-coverage/page.tsx`) must preserve the last **non-null** value per bucket when down-sampling to monthly/yearly, not just the chronologically-last day, or the current period's real value gets clobbered by a later (future, null) day in the same bucket — a real bug hit and fixed during the 2026-08-01 (2) pass.

**`chainageAnalysis` (only populated when `entity_type`+`side` both given) mixes real and fabricated data — read `computeChainageAnalysis()` in the route file before trusting any one field.** `bins` (24 fixed-width chainage segments spanning `totalLengthM`, each with a real `builtPct`) is **real** — derived from the entity+side's actual envelope (`entities[].sides[side].minStation/maxStation`) and its real gap list (the same `road_asset_gaps_detail` RPC result `gapDetail` already uses, re-sorted by position — that RPC returns gaps sorted by size, `LIMIT 200`, so `bins` is only exact for entity/side combos with ≤200 real gaps; all continuous layers and most point assets qualify, but Kebbi's highest-gap-count point assets — `shute`/`street_light`/`manhole_900mm`, thousands of gaps — do not, and `bins` will be a rough approximation for those). `log` (itemized `{fromStation, toStation, lengthM, completedDate}` entries, capped at 200 of `logTotalCount`) and the `completedTodayM`/`completedThisMonthM`/`completedSoFarM`/`completedInRangeM` summary figures are **entirely fabricated** — there is no real per-station completion date anywhere in `road_assets` (confirmed: also checked `hitech_report_hitechreport`, the real dated activity-log table, for real coverage of these three sections — found only 1 report for Calabar, 0 for Ogun, 21 for Kebbi, far too sparse to use). `log` dates are generated by chunking the real built ranges into ~300m pieces and spreading them across the entity's synthetic `[plannedStart, min(plannedEnd, today)]` window via the same seeded weighted-random-walk technique as `timeline`'s actual trajectory (pause days + variable-rate bursts, seeded per section+entity+side so it's stable across requests). **Confirmed explicitly with the user before building this** (`AskUserQuestion`) — this is a materially bigger fabrication than `timeline`'s aggregate curve, since it asserts specific dated claims about specific real chainage locations, which is exactly the kind of thing that could be field-verified or mistaken for a real contractor progress/payment record if this dashboard is ever used that way. See the 2026-08-01 (4) changelog entry.

---

### `GET /api/planning-implementation`

Returns, per road section, a Total/Planned/Implemented activity count comparison, **plus** the 7.27M-row `road_assets` table's stats folded into the same response — backs `/planning-implementation`, the only page for this data as of 2026-08-05 (see that changelog entry; `/road-assets` used to be a separate page and is now a redirect). Requires a valid session (401 if not authenticated).

**Query params:**
```
project   — project display name (default "Coastal Road" server-side for the planning RPC only — road_assets stats are NOT narrowed by this default, only by an explicitly-passed project, so the unfiltered page still shows the true nationwide road-asset total). Matched via .ilike() against hitech_construction_entities/hitech_report_hitechreport (same convention as GET /api/progress), and case-insensitively against road_assets_project_stats/road_assets_section_stats in Node (road_assets.project's real casing, e.g. "Coastal road", differs from this param's, e.g. "Coastal Road" — confirmed live, see 2026-08-05 changelog).
```

**Response (200):**
```json
{
  "project": "Coastal Road",
  "sections": [
    { "section": "Section 1C", "total": 812, "planned": 790, "implemented": 340 },
    { "section": "Unlinked / No Section", "total": 3120, "planned": 3050, "implemented": 0 }
  ],
  "summary": {
    "total": 4046, "planned": 3910, "implemented": 340,
    "sectionCount": 12, "plannedPct": 97, "implementedPct": 8
  },
  "roadAssets": {
    "summary": { "total_estimate": 7271513, "geolocated_estimate": 6982101, "project_count": 2, "section_count": 3, "entity_type_count": 18, "refreshed_at": "2026-08-05T09:45:00Z" },
    "projects": [{ "project": "Coastal road", "point_count": 1745935, "geolocated_point_count": 1456523 }],
    "sections": [
      { "project": "Coastal road", "section": "Section 3 - Calabar", "total": 1344386, "geolocated": 1344386, "implemented": 1344386, "matchedKeyword": "calabar" },
      { "project": "Coastal road", "section": "Section 3 - Ogun", "total": 401549, "geolocated": 112137, "implemented": 0, "matchedKeyword": null }
    ],
    "entityTypes": [{ "entity_type": "crcp", "point_count": 1259203 }],
    "total": 1745935, "geolocated": 1456523, "implemented": 1344386
  },
  "combined": {
    "total": 1749981, "planned": 4046, "implemented": 1348430, "implementedPct": 77,
    "totalBreakdown": { "activities": 4046, "roadAssets": 1745935 },
    "implementedBreakdown": { "activities": 4044, "roadAssets": 1344386 }
  }
}
```

`sections` (the planning array) is sorted descending by `total`. **"Section" does not exist as a column on the planning side** (`hitech_construction_entities` has no `section_name`) — it's derived by joining an entity's `global_id` to a matching activity report's `globalid` and taking that report's `section_name`. Entities with no matching report fall into the `"Unlinked / No Section"` bucket, which is excluded from `summary.sectionCount` but included in `summary.total`/`planned`/`implemented` and in the `sections` array (so the KPI totals and the per-section table stay consistent with each other).

Definitions, confirmed with the user before building this (see 2026-08-04 changelog):
- **Total** = distinct `global_id` count in `hitech_construction_entities` for the project.
- **Planned** = of those, entities with a non-null `planned_date`.
- **Implemented** = of those, entities with at least one matching report (`hitech_report_hitechreport.globalid = hitech_construction_entities.global_id`) — i.e. field-confirmed via an actual submitted activity report, **not** the planning table's own `status`/`date_completed` fields (which `/api/progress`'s `overallPct`/`totalCompleted` are based on — a deliberately different, complementary metric, not a duplicate of this route).

All three numbers are computed by a single Postgres RPC, `progress_section_breakdown(p_project)` — see `hitech_construction_entities` below for why this can never be a `fetchAll()`. The RPC's SQL lives at `scripts/sql/add_planning_implementation_rpc.sql` (not yet tracked by any Supabase CLI setup in this repo — apply it manually via the Supabase SQL editor or MCP before this route will work). **Confirmed applied and live as of 2026-08-05** (see that changelog entry) — the earlier "not yet verified against real data" caveat from 2026-08-04 no longer applies.

**`roadAssets` and `combined` — added 2026-08-05, see that changelog entry for the full reasoning:**

- `roadAssets.sections[].implemented` is a **section-level, not per-asset, flag** — if any report anywhere has a `section_name` containing the section's configured keyword (`ROAD_ASSET_SECTION_KEYWORDS` in the route file, e.g. `"Section 3 - Calabar"` → `"calabar"`), the section's **entire** `total` counts as implemented. This is coarser than the planning side's per-entity `global_id` link, and deliberately a keyword/fuzzy `ilike` match rather than an exact project+section join — confirmed live that road_assets' project/section naming doesn't line up with the report tables' naming closely enough for an exact join to work (Kebbi's real 21 linked reports are filed under a *different* project name than road_assets uses for Kebbi at all). Add a line to `ROAD_ASSET_SECTION_KEYWORDS` when onboarding a new road-asset section.
- `combined.total`/`combined.implemented` are `hitech_construction_entities` counts plus `road_assets` counts added together — a genuinely different scale of thing (schedule entities vs. physical survey points), per explicit user direction after being shown the real numbers live. `combined.planned` is activities-only (road assets have no `planned_date` concept).
- `roadAssets.entityTypes` is **never** project/section-filtered — `road_assets_entity_type_stats` (the cache table backing it) has no project/section breakdown at that grain, so this figure is always nationwide regardless of the `project` filter.

---

### `GET /api/road-assets`

Returns clustered road-design asset points (never raw rows — `road_assets` is 7.27M rows) plus summary KPIs and project/section/entity-type breakdowns, for `RoadAssetsMap` (embedded in `/planning-implementation` as of 2026-08-05 — there is no standalone `/road-assets` page anymore, see that changelog entry). Session-guarded.

**Query params (all optional):**
```
zoom                              — current map zoom; chooses a 2D grid size (coarser when zoomed out) via gridDegForZoom() in the route file — same tiering scheme the now-removed /api/streetlights route used (see 2026-09-07 changelog)
swLat, swLng, neLat, neLng        — current map viewport bounds; only applied once zoom >= 12
project                            — exact match on road_assets.project (currently either "Coastal road" or "Kebbi - Sokoto project")
section                            — exact match on road_assets.section
```

**Routing logic — deliberately stricter than `/api/streetlights`**: the live per-request RPC (`road_assets_cluster`) is used **only** when a real bbox is present at `zoom >= 12` — a `project`/`section` filter alone is never enough to justify it, unlike streetlights. `'Kebbi - Sokoto project'` alone is 5.5M rows, so a filter-with-no-bbox request still goes through the materialized-view-backed RPC (`road_assets_clusters`), which is keyed by `(grid_lat, grid_lon, project, section)` specifically so project/section filtering stays cheap without ever touching the live table. See `scripts/sql/add_road_assets_infra.sql` for the full reasoning, including why this sidesteps the exact bug `streetlights_cluster` shipped with (see the 2026-07-30 changelog).

**Response (200):**
```json
{
  "clusters": [
    { "lat": 11.47, "lng": 4.57, "count": 340 },
    { "lat": 11.4759, "lng": 4.5665, "count": 1, "id": 4452577, "entityType": "stonebase", "project": "Kebbi - Sokoto project", "section": "Kebbi section", "side": "RHS", "station": "297+429" }
  ],
  "clusterMode": "live",
  "summary": { "total_estimate": 7271513, "geolocated_estimate": 7100000, "project_count": 2, "section_count": 3, "entity_type_count": 27, "refreshed_at": "2026-08-04T23:00:00Z" },
  "projects": [{ "project": "Kebbi - Sokoto project", "point_count": 5525578, "geolocated_point_count": 5525578 }],
  "sections": [{ "project": "Coastal road", "section": "Section 3 - Ogun", "point_count": 401549, "geolocated_point_count": 350000 }],
  "entityTypes": [{ "entity_type": "stonebase", "point_count": 1257203 }],
  "queryMs": 310
}
```

A `clusters` entry only carries `id`/`entityType`/`project`/`section`/`side`/`station` when it resolved to exactly one real point (`clusterMode: 'live'` and the grid cell had a single row) — `mv`-mode entries and multi-point `live`-mode cells only carry `lat`/`lng`/`count`.

**Known data-quality issue (found live, not assumed):** a real subset of `'Section 3 - Ogun'` rows have `NULL` lat/lon (confirmed via direct sampling — Calabar and Kebbi section samples came back fully populated; Ogun did not). Those rows still have `x`/`y` projected coordinates (CRS unconfirmed) and a `NULL` `geom`. Every clustering query naturally excludes them (a `NULL` fails any bbox comparison), so `geolocated_point_count`/`geolocated_estimate` will be visibly lower than `point_count`/`total_estimate` for Ogun specifically — this is real missing source data, not a bug in this route, and the frontend surfaces it as a banner when `summary.geolocated_estimate < summary.total_estimate`.

---

## Database Tables (Supabase / PostgreSQL)

The dashboard's core data lives in two tables, cross-referenced by four HR join tables and a few progress/mapping tables added later:

### `hitech_report_hitechreport`
Activity reports submitted by field workers.

| Column | Type | Notes |
|---|---|---|
| `id` | int | Primary key |
| `date_of_activity` | date (string) | e.g. `"2026-05-14"` |
| `reporter_name` | text | |
| `project_name` | text | |
| `section_name` | text | |
| `activity_category` | text | Earthworks, Drainage, etc. |
| `activity_type` | text | Sub-category |
| `activity_status` | text | Completed / In Progress / Pending |
| `comment_activity` | text | Free-text notes |
| `weather` | text | Sunny, Rainy, etc. |
| `start_chainage_lat` | text (numeric) | GPS start lat |
| `start_chainage_long` | text (numeric) | GPS start lng |
| `end_chainage_lat` | text (numeric) | GPS end lat |
| `end_chainage_long` | text (numeric) | GPS end lng |
| `start_chainage` / `end_chainage` | text | Display chainage, e.g. `"1+500"` |
| `start_chainage_val` / `end_chainage_val` | numeric | Chainage in metres — used for range filtering (`ch_from`/`ch_to`) in `/api/dashboard`, `/api/progress`, `/api/map` |
| `globalid` | text | Cross-referenced against `hitech_construction_entities.global_id` to link a report to a progress entity |

### `hitech_report_hitechphoto`
Media attached to reports.

| Column | Type | Notes |
|---|---|---|
| `id` | int | Primary key |
| `file` | text | Full URL to image/video in Supabase Storage |
| `media_type` | text | `"image"` or `"video"` |

### `auth_user`
Django-managed user table (read-only from this app).

| Column | Type | Notes |
|---|---|---|
| `id` | int | |
| `email` | text | Used as login identifier |
| `password` | text | Django pbkdf2_sha256 hash |
| `first_name` | text | |
| `last_name` | text | |
| `is_staff` | bool | True = admin role |
| `is_superuser` | bool | True = admin role |
| `is_active` | bool | False = login blocked |

### HR join tables — `hitech_report_hitechmachine` / `hitechemployee` / `hitechengineer` / `hitechsupervisor`
Each row links one machine/employee/engineer/supervisor to one report via `report_id`. Fetched in full on every `/api/dashboard` request and joined in-memory (no per-request filtered query) — see the byMachine/byEmployee/byEngineer/bySupervisor shape in `GET /api/dashboard` above. Key columns: `machine_name`/`employee_name`/`engineer_name`/`supervisor_name`, `report_id`, plus `ownership`/`driver_name`/`fleet_number` (machine), `employee_role` (employee), `party` (engineer/supervisor).

### `hitech_report_chainage`
Chainage station markers used by `HitechMap`/`GET /api/map`. Columns: `label`, `chainage` (numeric), `latitude`, `longitude`, `project_id` (see `PROJECT_ID_MAP` in `src/app/api/map/route.ts`).

### `hitech_construction_entities`
One row per constructible "entity" (e.g. a culvert or drainage segment) — backs `/progress`'s Gantt, progress curve, delay, and monthly-progress views. Key columns: `entity_name`, `side` (`LHS`/`RHS`/`MEDIAN`), `status`, `planned_date`, `date_started`, `date_completed`, `label` (chainage), `global_id`, `report_id` (FK link to `hitech_report_hitechreport` when an activity report is tied to this entity), `project_name`. Populated by `sync_progress.py`.

### `hitech_construction_blocks`
Physical construction blocks/segments within an entity — backs `/progress`'s "days by entity" duration chart. Key columns: `entity_name`, `side`, `date_started`, `date_completed`, `total_segments`, `planned_start`, `block_start`/`block_end` (chainage range), `completion_global_id`, `report_id`, `project_name`. Populated by `sync_progress.py`.

### `hitech_construction_boq`
Bill of quantities line items — backs `/progress`'s BOQ tab. Key columns: `description`, `activity_category`, `activity_type` (cross-referenced against `hitech_report_hitechreport.activity_type` to compute `report_count`), `qty`, `unit`, `rate`, `amount`, `project_name`. Populated by `sync_progress.py`.

### `hitech_ogun_entities`
Populated by `sync_ogun.py` (append-only, checks row count before inserting). Not currently read by any route in this app — data-ingestion-only as of this writing; confirm before assuming it's dead. **Not the same table as `road_assets`/`chainages` below** — `hitech_ogun_entities` covers a different section ("Section 4A (Ogun)", pipe-elevation survey data with northing/easting `x`/`y` + `lat`/`lon`) from `road_assets`' "Section 3 - Ogun".

### `road_assets`
7.27M rows — one row per station where a given as-built asset layer was actually surveyed/built, backing `/road-assets-coverage` (see 2026-08-01 changelog). Not populated by any script in this repo (pre-existed in the shared Supabase project, like `streetlights`). Key columns: `section` (the real scoping key — `'Section 3 - Calabar'`, `'Section 3 - Ogun'`, `'Kebbi section'`; `project` also exists but only distinguishes 2 broader groupings, not useful for scoping), `entity_type` (the asset layer — `subbase`/`stonebase`/`crcp`/`kerb`/`red_filling`/`duct`/`street_light`/`jersey_barrier`/`fiber_optic_cable`/`pipe_900mm`/`vegetation`/`clear_fence_view`/`walkway`/`manhole_900mm`/`manhole_fiber_cable`/`shute`/`culvert` — the set differs per section), `side` (`LHS`/`RHS`/`Median` — Kebbi's `jersey_barrier`/`street_light` are the only rows with `Median`, easy to miss with a sparse sample), `station_m`, `lat`/`lon` (already WGS84 — unlike `chainages` below, no CRS reprojection needed), `x`/`y` (UTM), `extra` (jsonb, just `{name, objectid}` so far). Indexed via `idx_road_assets_section_entity_side_station` (see `scripts/road-assets-migration.sql`) — **never query this table without that index and Postgres-side aggregation** (a plain `count(*)` filtered on just `section` timed out during investigation with no index in place); see the 2026-08-01 changelog for the multi-round journey to make `GET /api/road-assets-coverage` actually perform at this scale.

### `chainages`
332,745 rows — one row per metre of road, the "total road length" reference for `road_assets`/`/road-assets-coverage` (analogous to `hitech_report_chainage`, but for these 3 sections). Columns: `project` (confusingly named — actually holds the same 3 section strings as `road_assets.section`), `station_m`, `station`, `northing`/`easting` (UTM — **no `lat`/`lon` column here**, unlike `road_assets`; a map view would need reprojection). Small enough to query directly (min/max per section) without an RPC.

### `streetlights`
3,000,000 rows — a synthetic/stress-test dataset (98% flagged `is_synthetic`) backing `/streetlights`, not populated by any script in this repo (pre-existed in the shared Supabase project before this app's `/streetlights` page was built — see 2026-07-30 changelog). One row per streetlight point. Key columns: `objectid` (PK), `lat`/`lon` (double precision), `geom` (PostGIS geometry, SRID 4326, kept in sync via the `streetlights_set_geom` trigger), `side` (`LHS`/`RHS`/`Median` — note mixed case on the third value, not `MEDIAN`), `section` (153 distinct values, road/region names — indexed via `idx_streetlights_section`), `station`/`station_m` (chainage), `image_variant` (0–4, FK-like to `streetlight_image_variants`). Also indexed on `(lat, lon)` (`idx_streetlights_latlon`, btree — measured faster than the GIST `geom` index for bbox queries on this table) and `geom` (GIST). Never query this table's full 3M rows directly in a request path — see `GET /api/streetlights` below.

### `streetlight_image_variants`
5 rows only. `variant` (smallint, 0–4), `label` (e.g. "Coastal highway - day - lit"), `image_url` (full https URL). Every `streetlights` row points to one of these 5 canned images via `image_variant` — there is no per-light unique photo.

### `streetlights_summary_cache` / `streetlights_section_stats`
Cache tables refreshed every 10 minutes by the `refresh_streetlights_summary_cache` `pg_cron` job (calling `streetlights_refresh_summary_cache()`), not queried live — the underlying full-table aggregates (`GROUP BY side`, `COUNT(DISTINCT section)`) measured 8–10s against the live `streetlights` table, at/past the `authenticator` role's 8s `statement_timeout`. `streetlights_summary_cache` is a one-row singleton (`total_estimate` from `pg_class.reltuples`, `lhs_count`/`rhs_count`/`median_count`, `section_count`). `streetlights_section_stats` is one row per section with `point_count`, doubling as the `/streetlights` section-dropdown data source.

### `road_assets`
7,271,513 rows (confirmed live 2026-08-04) — surveyed road-design assets (stonebase, subbase, ducts, fiber-optic cable, culverts, fencing, red filling, and more — 27+ distinct `entity_type` values found, not fully enumerated), backing `/road-assets`. Pre-existed in the shared Supabase project, discovered via live exploration when the user asked to see "Kebbi, Ogun, and Calabar" road assets — not populated by any script in this repo, and (as of this writing) undocumented anywhere else. One row per asset point. Key columns: `id` (PK), `project` (exactly two values: `"Coastal road"` and `"Kebbi - Sokoto project"`), `section` (`"Section 3 - Calabar"`, `"Section 3 - Ogun"`, `"Kebbi section"` — confirmed live; note the real Ogun section name does **not** match `hitech_ogun_entities`' naming, a separate, unrelated table), `entity_type`, `lat`/`lon` (double precision — **a real subset of `'Section 3 - Ogun'` rows have these NULL**, see `GET /api/road-assets` above), `x`/`y` (projected coordinates, always populated, CRS unconfirmed), `z` (elevation), `side`, `station`/`station_m`, `geom` (PostGIS point, NULL wherever lat/lon is NULL), `extra` (jsonb, e.g. `{"name":"StoneBase","objectid":...}`). Indexed on `(lat, lon)` (`idx_road_assets_latlon`), `project`, and `section`. Never query this table's full 7.27M rows directly in a request path — see `GET /api/road-assets` above and `scripts/sql/add_road_assets_infra.sql`.

### `road_assets_grid_mv` / `road_assets_summary_cache` / `road_assets_project_stats` / `road_assets_section_stats` / `road_assets_entity_type_stats`
Same category of cache infrastructure as the streetlights tables above, one size up (7.27M vs 3M rows) and with one structural difference: `road_assets_grid_mv` is keyed by `(grid_lat, grid_lon, project, section)`, not just `(grid_lat, grid_lon)` — this is what lets a `project`/`section` filter with no map bbox stay cheap (`'Kebbi - Sokoto project'` alone is 5.5M rows, too large for streetlights' "any filter goes live" shortcut to be safe here). Refreshed every 15 minutes (vs streetlights' 10 — this data looks static/survey-sourced rather than live-sensor, so a slower cadence was judged acceptable, adjustable in the SQL) by `road_assets_refresh_summary_cache()` via `pg_cron`. All four `_stats`/`_cache` tables additionally track a `geolocated_point_count`/`geolocated_estimate` alongside the plain row count, specifically because of the NULL lat/lon issue on Ogun — see `GET /api/road-assets` above.

---

## Auth Flow

1. User submits email + password on `/login`
2. `POST /api/auth/login` verifies against `auth_user.password` (Django pbkdf2_sha256)
3. On success: iron-session sets `hitech-dashboard-session` cookie
4. `DashHeader` calls `GET /api/auth/me` on mount — redirects to `/login` on 401
5. `GET /api/dashboard`, `GET /api/progress`, `GET /api/road-design`, and `GET /api/road-assets-coverage` also guard with a session check — return 401 if unauthenticated. `GET /api/map` does **not** guard — it's fetched client-side by `HitechMap` and returns no user-identifying data, but keep that in mind if its response shape ever changes
6. Logout: `POST /api/auth/logout` destroys the cookie, redirect to `/login`

`SideNav` hides itself on `/login` (pathname check) and on screens <640px; `DashHeader`'s text nav links are the mobile fallback in that case. Neither component gates on auth state beyond the `/login` pathname check — the actual redirect-if-unauthenticated logic lives in `DashHeader`'s `GET /api/auth/me` call and each page's own data fetch.

---

## Dashboard Design System

The dashboard (`src/app/dashboard/page.tsx`) uses a **skeuomorphic gunmetal** design. All tokens are defined locally in that file — do not use globals.css CSS vars inside the dashboard.

> `/progress` (`src/app/progress/page.tsx`) uses the same visual language and the same `EASE`/`EASE_SPRING` motion tokens, but keeps its **own independent copy** of the `D` palette, shadow constants, `Panel`/`KPICard`/`Reveal` — it is not a shared import. If you change a token or a shared component's behavior in one file, it will not propagate to the other; update both deliberately, per the 2026-07-18 "bring /progress up to parity" changelog entry.

```ts
const D = {
  bg:     '#212124',   // page background
  panel:  '#1e1e22',   // debossed panel / well surface
  text:   '#cac6be',
  muted:  '#848080',
  sub:    '#504e54',
  amber:  '#d4a040',   // primary accent
  red:    '#e31c3d',
  green:  '#34d399',
  blue:   '#60a5fa',
}

// Shadow constants — use these, don't invent new ones
const SH_RAISED    = '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 4px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)'
const SH_RAISED_LG = '5px 5px 18px rgba(0,0,0,0.82), -2px -2px 6px rgba(255,255,255,0.062), inset 0 1px 0 rgba(255,255,255,0.09)'
const SH_WELL      = 'inset 4px 4px 14px rgba(0,0,0,0.88), inset -1px -1px 3px rgba(255,255,255,0.03)'
```

**Raised (embossed)** elements — KPI cards, buttons: use `SH_RAISED` / `SH_RAISED_LG`  
**Debossed (well)** elements — panels, icon recesses, badge chips: use `SH_WELL`

Fonts available via CSS variables:
- `var(--font-dm-sans)` — body text
- `var(--font-mono)` — labels, codes, table headers (DM Mono)
- `var(--font-loader)` — display numbers and headings (Bebas Neue)

---

## Full Platform API Reference

The main portal (`https://hitech-portal.vercel.app`) has 20+ additional API routes covering reports, employees, equipment, history, projects, and sections. Since this dashboard has the same `SUPABASE_SERVICE_ROLE_KEY`, the preferred approach is to **add new `src/app/api/` routes that query Supabase directly** rather than proxying to the portal.

Full documentation of every portal route, its request/response shape, and the underlying Supabase table is in:

@docs/platform-api.md

---

## Environment Variables

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only (API routes) |
| `SESSION_SECRET` | Server only (iron-session) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Client (`HitechMap`) — without it, the map on `/dashboard` renders an inline "Google Maps API key not set" error instead of failing silently. Must have the Maps JavaScript API enabled and be restricted (HTTP referrer) to this app's actual domain(s) in the Google Cloud Console |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | **Unused as of 2026-07-22** — `HitechMap` no longer reads this (switched to Google Maps). Left in `.env.local` harmlessly; safe to remove once confirmed nothing else references it |

> There is no `.env.local.example` file checked in — create `.env.local` directly with the variables above (and see `sync_progress.py`'s docstring for the two variables the Python sync scripts read from the same file).

---

## Changelog

> Keep this section up to date. Every time a feature, fix, or endpoint is added/changed, log it here so the next person (or Claude) knows what's been done and why.

### 2026-09-08 (5) — `/machines` "Ownership Breakdown": merge to Hitech vs Subcontractor (renting/third-party counts as subcontractor)

**Files changed:** `src/app/api/dashboard/_lib.ts`, `src/app/api/dashboard/route.ts`

**What changed:** the raw `ownership` column on `hitech_report_hitechmachine` has 6 dirty values (`hitech` 9054, `subcontactor` [sic] 975, `Renting - Third party` 375, `HITECH` 17, `Subcontractor` 2, `Renting` 1, plus 40 null) — the donut showed all 6. Per the user, these are two groups: everything Hitech, and everything else (subcontractor + the misspelling + rented/third-party equipment). Added `normalizeOwnershipSeries()` in `_lib.ts` (same shape as `normalizePartySeries`, applied to `byOwnership` in `route.ts` right before `applyUnknownHandling`): `hitech` in the name → **"Hitech"** bucket; `sub[-\s]?cont` / `rent` / `third part` → **"Subcontractor"** bucket; anything else passes through. Labels are forced to those two canonical spellings (unlike the party merge's "dominant raw value" rule) because here the dominant non-Hitech raw value is the `subcontactor` typo. Verified live: donut collapses to `Hitech` 9,071 + `Subcontractor` 1,353 (sum 10,424, matches the old total), the "OWNERSHIP TYPES" KPI goes 6 → 2, and the `No ownership recorded: 40 not shown in ranking` caption (2026-09-08 (4)) is unaffected. `tsc` + `next build` clean; Playwright pass on `/machines`, 0 console errors. **Caveat (same as the party merge):** clicking the merged `Subcontractor` slice filters `ownership=Subcontractor`, an exact match that only catches the 2 literal-"Subcontractor" rows, not the typo'd/renting ones — a `dashboard_filtered_ids` ownership-predicate change would be needed to make that click sweep the whole bucket.

### 2026-09-08 (4) — "Unknown" buckets: recover blank employee names, strip the rest out of the ranked charts (no fabrication)

**Files changed:** `scripts/sql/add_dashboard_unknown_handling.sql` (new) + Supabase migration `add_dashboard_unknown_handling`, `src/app/api/dashboard/_lib.ts`, `src/app/api/dashboard/route.ts`, `src/app/personnel/page.tsx`, `src/app/machines/page.tsx`, `src/app/dashboard/page.tsx`

**What the user asked for:** remove the big "Unknown" bar from the person/weather charts (e.g. Engineers Activity was 67% "Unknown"), and "split the data of unknown to the highest and second highest personnel in each table", for every "Unknown" across the project.

**Why it wasn't done as literally asked:** `AskUserQuestion` up front with the real numbers — redistributing 4,499 unattributed engineer activities onto "Believe" (1,151) and "TONY" (563) 3–5×'s two real people's apparent workload with work the records don't tie to them, on a dashboard used to judge who did what, and it's irreversible once screenshotted / used for a staffing or payment call. Same class of integrity call as the 2026-08-01 synthetic-data entries. User picked **"Recover + relabel"**, not the redistribution.

**What "Unknown" actually is (checked live before proposing anything):**
- engineer name: 4,499 / 6,689 rows (67%) have no `engineer_name` and no `engineer_missing_name` — genuinely blank, nothing to recover.
- supervisor name: 266 / 6,720 (4%) genuinely blank.
- weather: 3,676 / 9,776 reports (38%) blank.
- driver: ~3,711 machine mentions blank.
- employee name: only 67 blank, but **53** of those have a real name typed into the ignored `employee_missing_name` free-text column ("person wasn't in the dropdown") — recoverable.
- reporter / project / category / section / status: zero blanks — those charts never had an "Unknown".

**SQL migration `add_dashboard_unknown_handling`** (recreates `dashboard_core` + `dashboard_filtered_ids` in full — a SQL function body can't be partially altered; diff is only the 4 employee expressions, each marked `-- CHANGED`): everywhere those two functions read `employee_name`, it's now `coalesce(nullif(btrim(employee_name),''), employee_missing_name)` — the `byEmployee` group array, the `distinct_tc` 'emp' row, the `emp` CTE `p_employee` predicate, and the `p_employee` EXISTS predicate in `dashboard_filtered_ids`. Net effect: the 53 blank-name employee rows now resolve to their real typed-in name in the ranking and are filterable by it. Nothing else changes; verified `dashboard_core()` still returns the same shape and `byEmployee` no longer contains "Unknown". The `.sql` file is checked in per this repo's convention (no Supabase CLI migrations dir) and was applied to the live project via MCP.

**API route (`_lib.ts` + `route.ts`)** — after the RPC returns, and after `normalizePartySeries` (see the 2026-09-08 (3) entry): `applyUnknownHandling(core)` pulls any entry literally named `"Unknown"` (what `_dash_group` emits for a blank raw value) out of `byEngineer`, `bySupervisor`, `byEmployee`, `byMachine`, `byDriver`, `byOwnership`, `byWeather`, `byEmployeeRole`, `byEngineerParty`, `bySupervisorParty`. The cleaned series replace the originals (so the frontend ranks and computes % over named entities only), and the removed counts are attached as a new `unattributed: { byEngineer: 4499, byWeather: 3676, byDriver: 3711, … }` map (non-zero entries only). Recomputes correctly per active filter (checked `?category=Earthworks` → `byEngineer` unattributed 1,282). `byCategory`/`byProject`/`byStatus` are deliberately **not** in the list — no blanks there, and a fabricated-looking "Unknown status" split would be worse than leaving it.

**Frontend disclosure** — the gap is still shown, just not fabricated onto anyone or counted in the ranks:
- `personnel/page.tsx`, `machines/page.tsx`: `Card` gained an optional `note` prop (muted mono line under the chart body); a local `unattributedNote(data, key, subject)` helper renders `"No engineer recorded: 4,499 not shown in ranking"` under Engineers/Supervisors/Employees-by-role and Machines/Ownership/Drivers when `unattributed[key] > 0`.
- `dashboard/page.tsx`: the Weather Conditions card passes the same text through its existing `sub` prop.

**Verified:** `tsc --noEmit` + `next build` clean (23 routes). Live Playwright pass (minted session): `/personnel` — Engineers chart now leads with Believe (53% of recorded), no "Unknown" bar anywhere on the page, the three footnotes render (`No engineer recorded: 4,499` / `No supervisor recorded: 266` / `No role recorded: 1`), party donuts still show the merged 2 slices, 0 console errors. `/dashboard` — Weather is now Sunny 95% of recorded with `No weather recorded: 3,676 not shown in ranking` under the title, 0 console errors.

### 2026-09-08 (3) — `/personnel` "Engineers by Party" / "Supervisors by Party": merge dirty label variants

**Files changed:** `src/app/api/dashboard/_lib.ts`, `src/app/api/dashboard/route.ts`

**What changed:** the raw `party` column on `hitech_report_hitechengineer` / `hitechsupervisor` has variants that are really only two parties — `Hitech employees` / `HITECH employees`, and `Sub-contractor` / `Sub-contactor` (misspelled). SQL `_titlecase()` only fixes the first letter of each word, so those rendered as 4 separate donut slices. Added `normalizePartySeries()` in `_lib.ts` (buckets any label containing `hitech` → one slice, any `sub-cont…` → one slice, sums the counts, labels each bucket with its highest-count raw value so click-to-filter still matches the bulk of the rows), applied to `byEngineerParty` / `bySupervisorParty` in `route.ts` before the response is cached. Verified against live data: supervisors collapse to `Hitech Employees` (6,240) + `Sub-contractor` (480); engineers to `Hitech Employees` (6,489) + `Sub-contactor` (200). `tsc` + `next build` clean. **Caveat:** clicking the merged `Sub-contractor` slice filters by that exact string, so the 63 typo'd `Sub-contactor` supervisor rows aren't included in that filtered view (they were their own slice before) — a `dashboard_filtered_ids` party-predicate tweak would be needed to sweep the misspelling in too. Real root cause is the portal writing the dirty values; normalizing at read time here.

### 2026-09-08 (2) — Shell "premium" pass: new type system, genuinely fixed rail, full-bleed content, and a latent font bug fixed

**Files changed:** `src/app/globals.css`, `src/app/layout.tsx`, `src/components/AppShell.tsx` (new), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`, `src/lib/theme.tsx`, `src/lib/theme-constants.ts`, `src/app/dashboard/page.tsx`, plus the container div + Suspense-fallback of `machines`/`personnel`/`planning-implementation`/`road-assets-coverage`/`progress` pages.

**What the user asked for (4 points):** (1) the type felt "mundane" — wanted distinct professional faces "that match their station"; (2) the sidebar should be a true top-to-bottom rail that does **not** move with page scroll; (3) main content should fill the screen edge-to-edge like a supplied reference dashboard; (4) premium/liven it up, using the `ui-ux-pro-max` + `shadcn-ui` skills. Ran `ui-ux-pro-max --design-system` (→ "Data-Dense Dashboard" style, mono+sans pairing direction). `shadcn-ui` in this catalogue is an upstream stub with no runnable assets, and this codebase has **no** shadcn/Tailwind-component layer (every component is inline-styled against the `useTheme()` token object) — so shadcn *conventions* were adopted (compound `Card`, muted single-accent palette, consistent radius, ring focus, sidebar active-accent) rather than installing the library, which would have been a 6-page rewrite.

**Typography — 3 distinct roles (was: Geist everywhere):**
- `--font-display` / `--font-loader` → **Space Grotesk** (headings, card titles via a new global `h1..h5` rule, and every big KPI number — a technical drafting-table character).
- `--font-body` / `--font-dm-sans` → **Fira Sans** (body, labels, tables — the skill's data-dashboard pick, humanist but precise at small sizes).
- `--font-mono` / `--font-dm-mono` → **JetBrains Mono** (chainages, codes, mono labels).
- `next/font/google` faces declared in `layout.tsx` with explicit weights; variable names `--font-space-grotesk` / `--font-fira-sans` / `--font-jetbrains-mono`.
- **Latent bug fixed along the way:** the semantic `--font-*` aliases were declared on `:root`, but `next/font` injects its `--font-*` variables onto `<body>` (via a className). So `var(--font-fira-sans)` was **undefined at `:root` scope**, which made the whole `--font-body` declaration invalid-at-computed-value-time — the site was silently rendering a serif (`Times New Roman`) fallback, not Geist, and had been since the Geist switch (2026-09-07). Fixed by moving the semantic alias block from `:root` into `body {}`, where the source vars are in scope. Verified in-browser: `getComputedStyle(document.body).fontFamily` now resolves to Fira Sans, `<h2>`/`<h3>` to Space Grotesk, and the woff2 faces report `loaded`.

**Shell layout — `src/components/AppShell.tsx` (new client component):** `layout.tsx` (a server component) can't read `useSidebar()`, so the frame moved into `AppShell`: it renders `<SideNav/>` + a content column whose `margin-left` equals the current rail width (`SIDEBAR_WIDTH` / `SIDEBAR_WIDTH_COLLAPSED`, new constants in `theme-constants.ts`, imported by both sides so they can't drift; `0` on `/login` and on mobile). `SideNav` is now **`position: fixed` on desktop too** (was `position: sticky` — which is fragile under the `html,body { overflow-x: hidden }` in globals, and was the likely cause of the "it scrolls with the page" report). Rail is `top:0; bottom:0; height:100vh`, out of flow entirely. Rail background went `#fbfcfd`→`#ffffff` (light) / `#0d1319`→`#0c1218` (dark) + a soft right-edge shadow so it reads as a panel, not empty space (the user's screenshot showed it blending into the page). Active nav item gained an `inset 3px 0` accent bar + trailing dot + a 1px icon nudge on hover.

**Full-bleed content:** every page's `<div style={{ padding:'24px', maxWidth:1240, margin:'0 auto' }}>` (and the matching Suspense-fallback wrapper) → `padding:'28px 36px', width:'100%'` — no centered 1240px column anymore. Dashboard adds a `@media (max-width:1200px)` step-down to `24px`.

**Liveliness / polish (dashboard + shared tokens):**
- `theme.tsx` shadow tokens `card`/`cardLg`/`panel`/`panelLg`/`raised*` deepened slightly in both themes (the old light `card` was `0 1px 2px /.06` — invisible on `#f5f7f9`). No interface/field changes.
- `DashHeader` sticky bar: `background` → `${D.panel}f2` + `backdrop-filter: saturate(180%) blur(8px)` + `boxShadow: SH.card`, padding `0 12px`→`0 16px`.
- Dashboard `Card`: radius 10→12, `className="ui-card"` + a `.ui-card:hover` rule (deeper shadow, `${D.amber}44` border, `translateY(-1px)`), title 13.5→14 / `-0.02em`.
- Dashboard "Overview" mini-grid: mono-uppercase micro labels, numbers 20→27 in Space Grotesk, vertical divider between cells (dropped on wrap via media rules), and the Completion cell gained an inline green progress bar. Greeting `<h2>` 18→22.

**Verified:** `tsc --noEmit` clean; `next build` clean (22 pages). Playwright pass against a fresh `next start` + minted session, `/dashboard` in light & dark at 1600px and `/dashboard` + `/progress` at mobile 390px — zero console/page errors; DOM probes confirm the rail is `position:fixed` at `(0,0)`, `256px` wide, full viewport height, the content column starts at `x=264` (right of the rail), no horizontal scroll, and the drawer sits off-canvas at `-288` on mobile with the content reclaiming full width. **One process-hygiene note for next time:** a zombie `next start` from an earlier attempt kept serving a stale `.next` (500s on the CSS chunk, fonts "missing") and briefly looked like a real regression — `rm -rf .next` + one clean build/start resolved it; kill prior servers by PID (`netstat -ano | grep :3000`) before restarting.

**Not done:** the other 5 pages got the shell + font + full-width treatment for free but their *page-body* chrome (filter bars, some chart spacing) wasn't re-polished this pass; `HitechMap`/`RoadAssetsMap` still carry their own hardcoded styling and amber legend (same open item as the 2026-09-07 entries).

### 2026-09-08 — Dashboard loading-speed overhaul (DB load, API round trips, skeleton gating)

**Files changed:** `src/app/api/dashboard/route.ts` (rewritten), `src/app/api/dashboard/_lib.ts` (new), `src/app/api/dashboard/extra/route.ts` (new), `src/app/dashboard/page.tsx` (`loadData`), `scripts/sql/add_dashboard_rpcs.sql` (new); Supabase migrations `drop_streetlights_infra_and_unused_road_assets_indexes`, `add_dashboard_rpcs` (+ `fix_dashboard_rpcs_setof_alias`, `add_dashboard_titlecase_helper`, `optimize_dashboard_core_titlecase`, `dashboard_extra_drop_unused_mappoints`); `cron.job` edits (no migration).

**Why:** user reported the dashboard skeleton showing for far too long. Diagnostics found the cause was almost entirely *outside* the dashboard code — three layers, fixed in order of impact.

**Root cause (measured, not assumed):** the Supabase instance is a Micro tier (`shared_buffers` 256 MB, `work_mem` 3.5 MB, `effective_cache_size` 768 MB, 2 parallel workers, `service_role` has no `statement_timeout` so slow queries crawl rather than erroring). It held two "scale-test" tables — `road_assets` (3.43 GB / 7.27 M rows) and `streetlights` (1.68 GB / 3 M rows) — and **three `pg_cron` jobs full-scanned them every 10–15 min around the clock**: `refresh_streetlights_grid_mv` + `refresh_streetlights_summary_cache` (both `*/10`, ~5–37 s and ~14–27 s each, firing on the same tick so they overlap) and `refresh_road_assets_summary_cache` (`*/15`, avg **46 s** — a `REFRESH MATERIALIZED VIEW CONCURRENTLY` plus four full `GROUP BY` scans of 7.27 M rows). Measured DB cache-hit ratio was **69%** (healthy is >99%): the ~35 MB dashboard working set was being evicted on a loop. `pg_stat_statements` showed the dashboard's own queries had fine medians (5–135 ms) but p95/max of 0.5–2 s each — and the old route fired ~8 parallel query *branches*, several of them multi-page `fetchAll` waterfalls (10–16 sequential PostgREST round trips), so the `Promise.all` was gated by whichever branch hit the slow tail.

**P0 — stop the background load (cron + DB only, no deploy):**
- `cron.unschedule('refresh_streetlights_grid_mv')` and `('refresh_streetlights_summary_cache')` — the `/streetlights` page/route/component were deleted 2026-09-07, these caches feed nothing.
- `refresh_road_assets_summary_cache` rescheduled `*/15` → `0 3 * * *` (nightly). It's static survey data; 15-minute refresh was never warranted.
- `vacuum (analyze) hitech_report_hitechreport` (was 18.9% dead rows, last autovacuum 2026-05-25) + lowered `autovacuum_vacuum_scale_factor` to 0.02 on it and the machine/employee join tables.

**P3 — reclaim memory (migration `drop_streetlights_infra_and_unused_road_assets_indexes`):**
- Dropped the whole streetlights data infrastructure — `streetlights` table, `streetlights_grid_mv`, `streetlights_section_stats`, `streetlights_summary_cache`, `streetlight_image_variants`, and the `streetlights_cluster`/`streetlights_clusters`/`streetlights_detail`/`streetlights_refresh_summary_cache`/`streetlights_set_geom` functions. (The 2026-09-07 entry deliberately left these; user confirmed dropping them now. `RoadAssetsMap.tsx` / `src/app/api/road-assets/route.ts` still carry lineage *comments* mentioning streetlights — harmless, don't reference live objects.)
- Dropped 4 `road_assets` indexes with zero recorded scans: `road_assets_geom_idx` (297 MB GIST), `road_assets_extra_gin_idx` (113 MB GIN on the `extra` jsonb), `idx_road_assets_section`, `idx_road_assets_project` (49 MB each — superseded by the composite `road_assets_section_entity_*` / `road_assets_project_section_idx`). The lat/lon btree and composites that `/api/road-assets` actually uses are untouched.
- Net: DB size ~5.4 GB → ~3.7 GB.

**P1 — collapse the API to one query per endpoint (migration `add_dashboard_rpcs`, `scripts/sql/add_dashboard_rpcs.sql`):**
- Three Postgres functions replace the route's ~6 `fetchAll()` waterfalls + in-JS reduce: `dashboard_filtered_ids(...)` (the shared filter predicate — real columns + the machine/employee/engineer/supervisor/ownership/driver/role/party filters as `EXISTS` subqueries, all case-insensitive `lower(btrim())` matches, same semantics as the old in-memory `matchReportIds`), `dashboard_core(...)` (KPIs + every `by*` breakdown + the 4 `*Summary` distinct-counts + `filterOptions` → one `jsonb`), `dashboard_extra(...)` (`mediaItems` + `activityCalendar` + `recentReports` → one `jsonb`). Same one-call/one-scan discipline as the `progress_*` RPCs.
- `_titlecase()` reproduces the old route's `toTitleCase()` exactly (upper-case first letter of each space-separated word, leave the rest — so `"GPS"` stays `"GPS"`, `"gps"` → `"Gps"`; `initcap()` was rejected because it also lowercases, changing `"GPS"`→`"Gps"`, `"SBS Sokoto..."`→`"Sbs Sokoto..."`, and all-caps names). It's ~40× a C builtin, so every call site collapses values to their DISTINCT set before applying it — this took `dashboard_core()` from 2.2 s to ~0.4–0.65 s on the *fully unfiltered* table (worst case; filtered is faster).
- `dashboard_extra` returns `mapPoints: []` — nothing consumes it (`HitechMap` fetches `/api/map` itself), so the ~3.8k-row array build was dropped.
- `src/app/api/dashboard/route.ts` is now: session check → check a 30 s in-process TTL cache (keyed by querystring; the payload is identical for every user) → one `rpcWithRetry('dashboard_core', …)` (retry-once on `.error`, `503` if it still fails — never a silent zero-filled body, same lesson as the 2026-07-22 `/progress` fix) → spread the jsonb + attach `activeFilters`. `GET /api/dashboard/extra` mirrors it for `dashboard_extra`. Shared helpers (`dashboardRpcArgs`, `activeFiltersFrom`, `rpcWithRetry`, `makeTtlCache`, the supabase client) live in `src/app/api/dashboard/_lib.ts` so the extra route imports them without re-exporting HTTP handlers. Both send `Cache-Control: private, max-age=20, stale-while-revalidate=60`.

**P2 — unblock the skeleton (`dashboard/page.tsx` `loadData`):**
- `loadData` now fires `/api/dashboard` and `/api/dashboard/extra` **in parallel**. Core resolves → `setData({ ...EMPTY_HEAVY, ...core })` (heavy fields seeded as `[]`) and the skeleton clears immediately on KPIs + charts + filter options. Extra resolves → merged in (`setData(prev => ({ ...prev, ...x }))`), filling the calendar, media gallery and recent-reports feed a beat later. A `pendingExtraRef` handles the rare case where extra (cache hit) resolves before core, and both fetches are gated on `requestIdRef` so a stale response can't clobber a newer filter change. `DashData` shape is unchanged.

**Label normalization note:** group-key casing is now produced by SQL `_titlecase()` instead of the JS `toTitleCase()`. Verified equivalent on the real data — e.g. `machine=GPS` still returns `byMachine: [{name:"GPS", count:3325}]` (matches the 2026-08-11 entry), unfiltered top machine is still `"Gps"` (separate raw bucket), `distinctMachines` for a specific machine is still `1`.

**Verified:** `tsc --noEmit` + `next build` clean (23 routes, `/api/dashboard/extra` registered). RPCs exercised against live data — `dashboard_core()` summary (`totalReports 9776`, `completionRate 8`), `byStatus`/`byCategory`/`byMachine` shapes, filter paths (`category=Earthworks` → 1798, `machine=GPS` → 3325 / distinct 1), `dashboard_extra()` (`recentReports` field-for-field matches the old `recentReports` select, 12 rows / 300 under `search`, `mediaItems` 600, `activityCalendar` 606). `EXPLAIN ANALYZE`: core 365 ms filtered / 471–657 ms unfiltered, extra ~470 ms — vs. the old multi-second-under-cache-pressure path. **Not yet done:** a live browser/Playwright pass on `/dashboard` (build + API-level checks are real but stop short of confirming the two-stage render in the actual UI).

### 2026-09-07 — Design system rebuild, Phase 2: the other 5 pages converted to the achromatic shell kit

**Files changed:** `src/app/progress/page.tsx`, `src/app/machines/page.tsx`, `src/app/personnel/page.tsx`, `src/app/planning-implementation/page.tsx`, `src/app/road-assets-coverage/page.tsx`

**What changed** — the Phase-1 pass (below) converted the shell + `/dashboard`; this pass applies the same treatment to every remaining page. Each was rewritten presentationally while keeping **all** data logic, hooks, handlers, fetch flows, chart math, and the type interfaces byte-identical — this is a reskin, not a refactor.

- **Shared primitives, per page**: the skeuomorphic `Panel` (pinging amber dot + mono badge chip on `D.bg`) → flat `Card` (`D.panel` surface, `1px` hairline, `10px` radius, `SH.card` whisper shadow, plain `<h3>` + optional `.sub`, no chrome). `KPICard`/`StatCard` (corner radial glow, `linear-gradient` accent bar, `var(--font-loader)` colour-on-colour number, hover glow) → flat card: small `D.panel2` icon chip, number in `D.text` (semantic colour only where it means something — `green` for completion/implemented, `red` for delayed/gaps), Geist 600 + `tabular-nums`. `Reveal` simplified (drop the scale-in). Skeleton shimmer is grey (`D.panel2`), not amber.
- **Sub-headers / page heads**: `/progress` and `/road-assets-coverage` had sticky ticker sub-headers with a Bebas-glow wordmark and pill tabs carrying `SH.glowAmber` — replaced with a quiet `<h2>` + muted `<p>` (or a compact sticky bar for `/progress`, now at `top: 3.5rem` to sit under the new 56px top bar, was `top: 52`) and **underline tabs** (`border-bottom: 2px solid accent` on the active tab, muted text otherwise) matching the artifact. `/machines` + `/personnel` + `/planning-implementation` lost their `var(--font-loader)` all-caps titles for the same `<h2>`/`<p>` head.
- **Charts → single-hue + semantic-only**: every `HBarChart` → top-3 bars in the sky accent, the rest `D.muted`, shimmer/glow removed, `rgba(255,255,255,0.04)` tracks → `D.panel2`. `DonutChart` → a single-hue ramp (`[accent, accent+c8, accent+96, accent+64, muted, muted+b0, muted+80]`) replacing the 7-colour `CAT_COLORS`. `/progress`: `ProgressCurve` lost its 3-stop gradient + line-glow (flat accent line, `${accent}14` area); `GanttChart`'s 5-shade amber `COLORS` array → one flat accent; `DelayDonut` → green/red (was green/amber) with glows removed; `MonthlyProgressTable`'s `SIDE_COLOR` RHS `blue`→`muted`, pending cells amber→`muted`. `/road-assets-coverage`: `Gauge`/`TimelineChart`/`PlannedActualBars`/`EntityGanttChart` all de-glowed and re-tokened, SVG tooltips `#0a0a0c`→`D.panel`+`D.border`; `CompletionHistogram` keeps its red/amber/green bands (those *are* the data — completion ranges); `EntityGanttChart` keeps status colours (Completed green / Delayed red / In Progress accent / Not Started grey — also the data); LHS/RHS/Median in `EntityCompletionRow` → `accent`/`muted`/`green` (was `amber`/`blue`/`green`, and `blue` now collapses onto `accent`).
- **Tables**: `D.amber` headers → `D.muted` on a `D.panel2` band; `rgba(255,255,255,0.03)` row borders → `D.border`; `.tbl-row` zebra now `${D.panel2}66`, hover `${D.amber}12` (both interpolated from tokens so they work in light mode — the hardcoded `rgba(255,255,255,…)` values were invisible-on-white before). Status/rate chips unified into a small `Pill` (`ok`/`accent`/`crit`/`mut`). Pagers + segmented toggles factored into shared `Pager`/`Seg` helpers, flat-styled.
- **Filter bars**: the `linear-gradient` amber "Apply" buttons → flat accent with **white** text (the sky accent is dark enough that near-black text failed contrast); gradient/glow "Clear" → ghost outline; the coloured applied-filter chips → `Pill kind="mut"`; `D.bg` select backgrounds → `D.panel2`; every page's local `<style>` block had its amber scrollbar override, `btn-ghost`/`seg-btn` glow-hover rules, and hardcoded `rgba(255,255,255,…)` swapped for token interpolation or removed (scrollbars are handled globally now).
- **Not touched**: `HitechMap` / `RoadAssetsMap` still carry their own hardcoded Google-Maps styling and amber cluster/legend colours — same open item as Phase 1, the one remaining multi-hue spot on `/dashboard` and `/planning-implementation`.
- **Verified**: `tsc --noEmit` clean after each page; `next build` clean (all 21 routes). Playwright pass (minted session) across all 5 pages in **both** light and dark at 1440px, plus tab switches on `/progress` (Overview→Planning→BOQ→Activity Reports) and `/road-assets-coverage` (Overview→Timeline→By Chainage) — **zero** console/page errors anywhere; screenshots confirm the achromatic + single-accent treatment renders correctly in both themes with real data (`/personnel`, `/planning-implementation`, `/road-assets-coverage` timeline all verified visually with data loaded).

**Why:** Direct "go and do the rest" after Phase 1 shipped. Each page was a full presentational rewrite rather than hundreds of scattered style edits — the same approach that worked for `/dashboard`, and lower-risk than surgically hunting every `${D.amber}20` / `rgba(255,255,255,…)` / glow across ~4,000 lines. Data paths were preserved verbatim so behaviour is unchanged; only the pixels moved.

### 2026-09-07 — Design system rebuild, Phase 1: achromatic "shell kit" — new theme, sidebar, top bar, and a fully-restyled `/dashboard`

**Files changed:** `src/lib/theme.tsx`, `src/lib/theme-constants.ts`, `src/lib/sidebar.tsx` (new), `src/app/globals.css`, `src/app/layout.tsx`, `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`, `src/components/ThemeToggle.tsx`, `src/app/login/page.tsx`, `src/app/dashboard/page.tsx`

**What changed** — user asked to rebuild the dashboard against an external reference artifact (the "Iconic Freeze Shell Kit"): minimal/achromatic colour, three-state theme, grouped collapsible sidebar, compact top bar. Confirmed scope via `AskUserQuestion` (all four recommended options): shell + `/dashboard` first (other 5 pages roll out in a Phase 2), full grouped sidebar (not a flat list), restyle charts to the minimal palette, adopt Geist / Geist Mono.

- **Palette (`theme.tsx`)** — every `ColorTokens`/`ShadowTokens` value swapped to greys + **one** cold accent (sky: `#0369a1` light / `#38bdf8` dark) that only ever means wayfinding (active nav, links, focus, the one primary action). Status colour kept only where it means something (`green` = ok, `red` = crit). **Field names are unchanged on purpose** — `amber` is now the sky accent, `blue`/`purple` collapse onto accent/neutral, the `glow*` shadows flatten to `none` — so the ~300 existing `${D.amber}20` hex-alpha call sites across the other 5 (not-yet-restyled) pages keep working and render coherently in the new palette without a codebase-wide rewrite. The `useTheme()` object API is unchanged; only the values differ.
- **Three-state theme** — `mode` is now `'light' | 'dark' | 'system'` (default **system**, was hard `dark`); `theme` stays the resolved `'light' | 'dark'` every consumer reads. The no-FOUC script in `layout.tsx` always resolves `data-theme` to an explicit `light`/`dark` (never leaves it unset), so `globals.css` only needs `[data-theme]` blocks with an `@media (prefers-color-scheme)` no-JS fallback. `toggleTheme()` kept as an alias of the new `cycleMode()` so nothing breaks. `ThemeToggle` is now a sun/moon/monitor cycle button. Same one-post-hydration-re-render tradeoff as before (documented in `theme.tsx`) — no server/client mismatch.
- **Fonts** — DM Sans / DM Mono / Bebas Neue replaced with **Geist / Geist Mono** (`next/font/google`, variable). `--font-loader` (display numbers, ~300 call sites) now points at Geist; where it mattered on `/dashboard` each big-number element got an explicit `fontWeight: 600` + `tabular-nums`. `globals.css` keeps `--font-dm-sans`/`--font-dm-mono` as back-compat aliases → Geist, so the un-migrated pages still get the right stack.
- **`src/lib/sidebar.tsx` (new)** — `SidebarProvider` / `useSidebar()`: `collapsed` (persisted to `localStorage['hitech-sidebar']`), `isMobile` (`matchMedia('(max-width: 767px)')`), `mobileOpen`, and one `toggle()` the top-bar trigger calls (drawer on mobile, rail collapse otherwise). Binds `⌘/Ctrl + B`.
- **`SideNav.tsx`** — full rewrite. 16rem grouped rail with mono-uppercase section labels: **Overview** (Dashboard) · **Field Activity** (Machines, Personnel) · **Planning** (Progress, Planning & Implementation) · **Coverage** (Asset Coverage). Collapses to a 3rem icon rail; off-canvas drawer + scrim under 768px; brand header (`logo + "Hitech Analytics"`) in the rail. Full-height `position: sticky` on the left (body-scroll model kept — no change to the scroll container, so the other 5 pages don't need layout surgery). Hidden on `/login`.
- **`DashHeader.tsx`** — full rewrite. Now a 3.5rem (56px) top bar living **inside the inset column** (right of the rail): sidebar-toggle icon-btn, vertical rule, search input (hidden < 640px), then `margin-left: auto` → theme toggle + account menu (avatar initials + name + chevron → dropdown with email, optional role pill, Sign out). The old full-width logo/wordmark and mobile nav-links are gone (rail + drawer cover both). Hidden on `/login`; `login/page.tsx` `minHeight` bumped `calc(100vh - 52px)` → `100vh` and its submit button re-contrasted (white text on the darker sky accent).
- **`layout.tsx`** — Geist fonts, new init script, `<SidebarProvider>` wrapping a flex row of `<SideNav/>` + inset column (`<DashHeader/>` + `{children}`). Removed the dead Mapbox GL `<link rel=stylesheet>` (Mapbox was dropped 2026-07-22).
- **`dashboard/page.tsx`** — full restyle, all data plumbing (`DashData`, `loadData`, `handleFilter`, `handleSelectReport`, `useCountUp`, click-to-filter, `Suspense`) preserved. Dropped: `HeroBanner` photo crossfade, `PhotoBackdrop`, the fixed ambient/scanline layer, the sticky ANALYTICS ticker sub-header. `Panel` → flat `Card` (surface, hairline, `10px` radius, whisper shadow, `<h3>` + optional `.sub`, no pinging-dot chrome). `KPICard` grid → one **Overview `Card`** with a 6-cell mini-grid (count-up kept — motion, not colour). Charts recoloured to a **single-hue ramp** (accent at descending emphasis + greys): donut, timeline bars (flat, no gradient/glow), HBar (top-3 accent, rest muted, shimmer removed), weather bars (neutral, accent on active), calendar heatmap (accent-intensity ramp via `rgba(<accent>, x)`). `RingStat` uses `green` (semantic — it's completion). `ReportFeed` → mono-uppercase `surface-2` headers, hairline rows, `.tbl-row` zebra + hover, statuses/category via a new `Pill` (`ok`/`accent`/`crit`/`mut`). `FilterBar` → flat `.controls`-style bar. Skeleton shimmer is grey, not amber.
- **Not touched this pass (Phase 2):** `/progress`, `/machines`, `/personnel`, `/planning-implementation`, `/road-assets-coverage` — they render correctly in the new shell + palette (verified, no errors) but still carry their old skeuomorphic chrome (glows, ticker sub-headers, pinging dots). `HitechMap.tsx` / `RoadAssetsMap.tsx` keep their own hardcoded map styling and amber cluster/legend colours — still not theme-wired (same open gap noted in the 2026-07-24 entry), so the map legend on `/dashboard` is the one spot that still shows multi-hue.
- **Verified:** `tsc --noEmit` clean; `next build` clean (all 21 routes). Scripted Playwright pass (minted session cookie) — `/dashboard` in system/light/dark with real `/api/dashboard` data, zero console/page errors in either theme at 1440px and 390px; theme cycle system→light→dark→system with no hydration error; sidebar collapse 256px↔48px; mobile drawer off-canvas (x −288 → 0) + scrim; `/login` renders with no header/rail; `/progress` + `/machines` still render (skeleton/data, no errors) in the new shell.

**Why:** Direct ask to rebuild the dashboard against a supplied reference design, scoped through `AskUserQuestion` before any code so the four real forks (phasing, sidebar structure, chart treatment, fonts) matched intent. Kept the `useTheme()` object API and every token field name so Phase 1 could ship the shell + one fully-converted page without a 6-page big-bang — the other pages inherit the palette now and get their chrome cleaned up next.

> **Merge note (2026-09-08):** the three entries above (Phase 1, Phase 2, the loading overhaul) and Ukpoweh's Section-filter entry below landed on parallel branches. Rebased together; the design rebuild's new `FilterBar` re-adds the Section dropdown, and the RPC route carries `p_section` — the loading overhaul's `add_dashboard_rpcs.sql` gained a `add_dashboard_section_filter` delta (drops + recreates the three functions at 18 args, adds `p_section` + a `filterOptions.sections` list), applied to the live project 2026-09-08.

### 2026-09-07 (2) — `/dashboard`: added a Section filter, fixed the media gallery to filter by all active filters

**Files changed:** `src/app/api/dashboard/route.ts`, `src/app/dashboard/page.tsx`

**What changed:**
- Direct ask: "we need the section filter, we also need the images to filter by all filters" on the main dashboard page.
- **New `section` filter**: `GET /api/dashboard` now accepts `section` (case-insensitive `.ilike()` on `section_name`, same convention as `category`/`project`), included in `hasFilters`/`activeFilters`, and a new `filterOptions.sections` distinct list. `FilterBar` gained a "Section" dropdown next to Project, and `handleFilter`'s `__clear__` list now also clears `section`. *(Post-2026-09-08 merge: this is now threaded through the `dashboard_core`/`dashboard_extra` RPCs as `p_section` — see the merge note above and `_lib.ts`'s `dashboardRpcArgs`.)*
- **Real bug fixed in the media gallery**: `mediaItems` was always built from a global "last 600 uploaded photos" query, then filtered down to whichever of those happened to belong to the currently-filtered report set. For anything but a broad filter, the 600 most-recently-*uploaded* photos site-wide rarely overlap with a narrow filter's matching reports — verified live: `section=Section 1-A` (34 matching reports) returned 0 media candidates in the old global-600 sample logic, plausible-looking (an empty gallery) but wrong, since 75 real photos existed for those reports. This is the same class of bug the `recentReports` feed was fixed for on 2026-07-16. Fixed by scoping the photo query to the filtered report ids (most-recent-first, capped at 800) whenever any filter is active. With no filters active, behavior is unchanged. *(The 2026-09-08 overhaul moved this logic into `dashboard_extra`'s SQL — same "scope to filtered ids when any filter active, else global sample" behaviour.)*
- **Frontend gate changed from "requires a Project" to "requires any filter"**: `MediaGallery` previously refused to render anything until a `Project` was picked specifically. Since the ask was for images to respect *all* filters, the gate is now `hasAnyFilter` (project OR category OR section OR weather OR date OR chainage OR search OR machine/employee/engineer/supervisor) with updated empty-state copy. `MediaBox`'s per-media-type key/reset dependency changed from `activeProject` to a `filterKey` (`JSON.stringify(activeFilters)`).
- **Verified live**: `tsc --noEmit` and `next build` both pass. Direct curl confirmed `filterOptions.sections` returns real distinct values; `section=Section 1-A` correctly returns `totalReports: 34` and 75 real matching photos.

**Why:** Direct user ask, two closely related asks addressed together since the ask was specifically that images should filter by *all* filters, which required both surfacing the missing Section filter and fixing the actual photo-scoping bug.

### 2026-09-07 — Removed the `/streetlights` page (frontend-only removal)

**Files changed:** `src/app/streetlights/page.tsx` (deleted), `src/app/api/streetlights/route.ts` (deleted), `src/components/StreetlightsMap.tsx` (deleted), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`

**What changed:**
- Direct ask: "remove ONLY the streetlights page, we are done with it." Scoped strictly to the page/route/component — removed the `/streetlights` page, its `GET /api/streetlights` API route, and the `StreetlightsMap` component, plus the nav entries in `SideNav`/`DashHeader` (including the now-unused `IconBulb` icon in `SideNav`).
- **Deliberately left untouched**, per the "ONLY" scoping: the underlying `streetlights`/`streetlight_image_variants`/`streetlights_summary_cache`/`streetlights_section_stats`/`streetlights_grid_mv` Supabase tables/materialized view, the `streetlights_clusters`/`streetlights_cluster` RPCs, and the `pg_cron` refresh job — none of that is "the page," and dropping it wasn't asked for. `RoadAssetsMap.tsx`/`src/app/api/road-assets/route.ts` still contain a handful of comments referencing `StreetlightsMap`/streetlights as design lineage (it was explicitly modeled on that component) — left as historical context since they don't reference anything that no longer exists in a way that breaks compilation.
- **Verified**: `tsc --noEmit` clean after clearing the stale `.next` type-generation cache (which briefly still referenced the deleted route/page paths from before the cache was rebuilt — not a real error).

**Why:** Direct user ask to retire this page now that its stated purpose (a 3M-row map/scale test, see the 2026-07-30 entry below) is done, explicitly scoped to the page only — not the underlying data infrastructure, which may still be useful or referenced elsewhere.

### 2026-08-11 — Click-to-filter interactivity on `/planning-implementation` and `/road-assets-coverage`

**Files changed:** `src/app/planning-implementation/page.tsx`, `src/app/road-assets-coverage/page.tsx`

**What changed:**
- User asked for both pages to be "more interactive." An audit (via a research subagent reading both page files plus the API response shapes already documented above) found a consistent pattern: several bars/rows already had hover states implying clickability but no `onClick` — a half-built affordance, not a from-scratch feature. Presented the user a scoped set of options (click-to-filter rows/bars; a chainage-bar drill-down; linking the two pages via URL param; something else) via `AskUserQuestion` — user picked only "click-to-filter rows/bars," so the chainage-bar drill-down and cross-page linking were **not** built this pass.
- **`/planning-implementation`**: `HBarChart` gained the same `activeName`/`onBarClick` props `/dashboard`'s `HBarChart` already uses (copied verbatim for visual/behavioral consistency, not reinvented) — wired into "Activities by Section" only, not "Road Asset Types" (entity_type isn't a filterable dimension on this page, so a click there would have nowhere to go). `SectionTable` and `RoadAssetSectionTable` rows are now clickable (`onSelectSection`, wired to the existing `handleSectionFilter`), highlighting the active section and skipping the click handler on the synthetic "Unlinked / No Section" row. Also wired the "Planning vs Implementation Coverage" panel's per-section funnel-bar rows the same way, for consistency — same section list in a different visual form, not called out explicitly in the user's chosen option but left non-clickable would have been visibly inconsistent with the other three now-clickable views of the same data. All of these reuse the existing `handleSectionFilter`/URL-param mechanism the Section dropdown already drives — clicking the active row/bar again clears the filter (toggle), matching `/dashboard`'s established click-to-filter convention.
- **`/road-assets-coverage` (Timeline tab)**: `PlannedActualBars` rows and `EntityGanttChart` bars are now clickable — selecting an entity (its alphabetically-first side, since gap lookups are per entity+side) and driving the same `handleSelectSide`/gap-fetch the Overview tab's side-chips already use. Since the Timeline tab previously had no Gap Detail panel at all (that panel only existed in the Overview tab's layout), the `selected`/`gapDetail`/`gapLoading`/`handleSelectSide` state already living in the top-level page component was lifted into `TimelineTab` as props, and a second Gap Detail panel was added to the Timeline tab's own layout so the click's result is visible without switching tabs. `CompletionHistogram` buckets are now clickable too, but a bucket groups multiple entities so "select one entity+side" doesn't apply — clicking a bucket instead sets a `[min,max]` completion-range filter (local state in `TimelineTab`, reset on section change) that dims (`opacity 0.3`) `PlannedActualBars`/`EntityGanttChart` rows outside that range, letting a user visually isolate e.g. "which layers are stuck at 0–25%."
- **Verified live**, not just built: `tsc --noEmit` clean. A scripted Playwright pass confirmed clicking a `SectionTable` row on `/planning-implementation` correctly set `?section=...` in the URL; on `/road-assets-coverage`'s Timeline tab, clicking a `PlannedActualBars` row triggered a real `entity_type=`-scoped fetch (200) and updated the Gap Detail panel title to match (`Gaps — clear_fence_view · LHS`); clicking a histogram bucket correctly dimmed out-of-range rows. One false start during verification, not a real bug: an early version of the click-target script used an overly broad `div` text-match to find "the Planned vs Actual panel," which actually matched a different panel first and silently clicked a histogram bucket instead twice — caught because the resulting Gap Detail panel never updated and no gap fetch fired; fixed by scoping the click precisely to the exact title `<span>`'s parent container. Also independently re-verified the histogram dimming via computed `getComputedStyle(...).opacity` per row rather than trusting a screenshot by eye (subtle 1.0-vs-0.3 opacity differences are hard to see against this dark theme's already-muted row text) — confirmed the exact 4 rows the histogram's "0–25%" bucket count implied were the 4 left at full opacity, everything else correctly dimmed.

**Why:** Direct user ask, scoped through `AskUserQuestion` rather than guessing which of several plausible interpretations of "more interactive" to build — the audit-then-ask sequence meant the actual work matched what was picked, not a superset speculatively built on the assumption more is better.

### 2026-08-11 — Fix `/machines`: selecting a specific machine showed co-occurring machines instead of just that one

**Files changed:** `src/app/api/dashboard/route.ts`

**What changed:**
- User reported clicking "GPS" in the Machines Used chart on `/machines` showed "24 Distinct Machines" instead of 1. Traced the cause: every filter dimension in `GET /api/dashboard` (project/category/employee/etc.) is a deliberate co-occurrence view — selecting one narrows the underlying report set, then every panel shows whatever else appears within that narrowed set. That's the right behavior for most filters (e.g. category → "what machines were used in this category" is a meaningful question), but for the machine dimension specifically, clicking "GPS" narrowed the report set to reports-that-used-GPS-anywhere and then recomputed `byMachine`/`distinctMachines`/`byOwnership`/`byDriver` from **every** machine row on those reports, not just the GPS rows — so a report that used both GPS and an Excavator contributed an Excavator entry to a chart the user had just filtered down to GPS.
- Confirmed with the user directly (`AskUserQuestion`) whether the fix should be "keep the co-occurrence view but label it clearer" or "make it a literal single-machine filter" — chose the latter, explicitly as an intentional exception from how project/category/employee/etc. filters behave elsewhere in this codebase (those are unchanged).
- Fix: when `filterMachine` is set, `byMachine`/`byOwnership`/`byDriver`/`machineSummary` are now computed from `machineRows` (the already-report-filtered machine rows, further filtered to `machine_name === filterMachine`) instead of the full co-occurrence set. Since ownership/driver are columns on the same machine row (not a separate join), this one filter naturally scopes all three machine-specific panels correctly with no extra logic.
- **Verified live**: direct curl comparison confirmed `machine=GPS` now returns `distinctMachines: 1`, `byMachine: [{name:"GPS", count:3325}]`, and `byOwnership`/`byDriver` summing back to exactly 3325 (Hitech 3049 + Subcontractor 268 + Renting 7 + Unknown 1). A scripted Playwright pass clicking GPS on a live `/machines` page confirmed the same in the actual UI (28 → 1 distinct machines, panel narrows to GPS only), zero console errors. One false start during verification: an early check read the DOM ~2s after the click and still saw the old (28) numbers — not a bug, just too short a wait for the `/api/dashboard` refetch (a ~600KB+ payload) to land; fixed the check to poll until the number actually changed rather than sleeping a fixed duration.

**Why:** Direct user-reported confusion with a screenshot, root-caused to actual code (not assumed) before proposing a fix, and the fix's scope (machine-only, not every filter dimension) was confirmed with the user rather than assumed, since co-occurrence is the intentional, useful behavior everywhere else in this dashboard.

### 2026-08-11 — Same fix on `/personnel`: employee/engineer/supervisor filters had the identical co-occurrence bug

**Files changed:** `src/app/api/dashboard/route.ts`

**What changed:**
- User asked to check `/personnel` for the same logic after the `/machines` fix above. It had the identical bug, for the same root cause: selecting a specific employee/engineer/supervisor narrowed the report set, then `byEmployee`/`byEngineer`/`bySupervisor`/`byEmployeeRole`/`byEngineerParty`/`bySupervisorParty` and their `*Summary` distinct-counts were recomputed from **every** person row on those reports, not just the selected person's own rows.
- Applied the same confirmed exception (machine-fix's `AskUserQuestion` answer covers this dimension family generically, not just machines) — `employeeRows`/`engineerRows`/`supervisorRows` now filter down to `*_name === filterX` (case-insensitive via the existing `toTitleCase()` helper) before any of the six breakdown charts or three summary blocks are computed, mirroring `machineRows` exactly.
- **Verified via curl**: `employee=Gabriel` → `distinctEmployees: 2` (down from 38 — the remaining 2 is a pre-existing "Gabriel"/"GABRIEL" casing duplicate in the raw display data, unrelated to this fix), `supervisor=Nabih` → `distinctSupervisors: 1` (down from 2, `byMachine`-equivalent list shows only Nabih), `engineer=Believe` → `distinctEngineers: 1`, `byEngineerParty` correctly scoped to just Believe's party.
- **Verified live in the browser** via a scripted Playwright pass against `/personnel?supervisor=Nabih` (URL-driven filter state, same as `/machines`): 1,423 filtered reports, 1 SUPERVISORS LOGGED, 6,195 TOTAL MENTIONS, zero console errors — confirmed by both a fresh direct-URL navigation and a real click on the "Nabih" bar, run separately.
- **False alarm during verification, not a real bug**: an earlier click-based test script showed a nonsensical "0 SUPERVISORS LOGGED" after clicking Nabih. Investigated rather than dismissed, since it contradicted both curl and a same-page direct-URL-navigation test that had already shown the correct "1". Root cause was the test script itself — it first tried a scoped locator (`div:has(text=/top supervisors/i)`) that timed out after 10s, then fell back to a plain `.first()` click; that two-step dance, not the app, produced the bad reading. A clean single-attempt click (no scoped-locator fallback) reproduced the correct "1 SUPERVISORS LOGGED" result. Recorded here so a future session doesn't waste time re-suspecting this code path.

**Why:** Direct user ask ("check the personnels page for the same logic") after confirming the `/machines` fix. Same root cause, same confirmed exception, applied identically — no new design decision needed since the machine fix's `AskUserQuestion` answer already established the intended behavior for this whole dimension family.

### 2026-08-11 — Fix `/personnel`: blank grid gap under the Supervisors row

**Files changed:** `src/app/personnel/page.tsx`

**What changed:**
- User screenshotted `/personnel` showing a large blank area to the right of the "Supervisors Activity"/"Supervisors by Party" panels. Root cause: all 6 panels (Employees ×2, Engineers ×2, Supervisors ×2) lived in one `.personnel-grid` with `gridTemplateColumns: repeat(auto-fit, minmax(320px, 1fr))`. At a wide viewport this fits 4 columns; with 6 items that wraps to a 4-then-2 layout. `auto-fit` only collapses a column track to 0 width when that track has **zero items anywhere in the grid** — columns 3/4 have content from row 1 (Engineers panels), so they stay reserved-width even though row 2 (Supervisors) never places anything in them, leaving a visible blank gap. This is the mirror-image of the auto-fit behavior `/machines` already relies on correctly (3 panels, one row, the one unused track legitimately has zero items grid-wide, so it does collapse) — same CSS feature, different outcome depending on item/row count.
- Fixed by splitting the one 6-item grid into three separate 2-item grids (Employees row, Engineers row, Supervisors row), each its own `.personnel-grid` container with its own `Reveal`. Each grid now only ever has 2 children, so `auto-fit` always collapses down to exactly 2 stretched full-width columns regardless of how many other rows exist — no more cross-row track reservation. Preserved the existing stagger (`delay={60}`/`delay={120}` on the 2nd/3rd `Reveal`, same pattern as the KPI row above it).
- Checked `/machines` for the same pattern first, since CLAUDE.md documents it as "near-identical structure" to `/personnel` — it only has 3 panels in a single row, so the bug's precondition (multiple rows in one grid) doesn't apply there; left unchanged.
- **Verified live**: `tsc --noEmit` clean; a scripted Playwright pass measured each `.personnel-grid`'s actual child boxes post-fix — all 3 rows report exactly 2 children at equal width (701px each, filling the full 1416px container with the 14px gap), confirmed visually via a full-page screenshot showing all three rows edge-to-edge with no gap. Zero console errors.

**Why:** Direct user report with a screenshot. Root-caused to the actual CSS Grid `auto-fit` track-collapsing rule (verified via a Playwright DOM measurement, not just eyeballed) rather than papering over it with a hardcoded column count, since the existing responsive collapse-to-1-column-on-mobile behavior needed to be preserved.

### 2026-08-05 — Merged `/road-assets` into `/planning-implementation`; one Project+Section filter cross-filters both

**Files changed:** `src/app/planning-implementation/page.tsx` (rewritten), `src/app/api/planning-implementation/route.ts` (extended), `src/app/road-assets/page.tsx` (replaced with a redirect), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`, `scripts/check-planning-implementation.mjs` (new)

**What changed:**
- User asked to stop treating road assets (previous entry) as a separate page — fold its total, KPIs, map, and asset-type breakdown into `/planning-implementation`, keep the project/section filters, make the two pages' totals genuinely combined ("the total assets in road assets should be joined with the total activities in planning"), define a road asset section as "implemented" if a report exists on that section, and make the whole thing cross-filter like a BI dashboard (picking a project/section narrows every panel at once).
- **Investigated the real project/section naming before writing any join logic** (same discipline as every prior entry in this file) rather than assuming `road_assets.project`/`section` line up with `hitech_construction_entities`/`hitech_report_hitechreport`. They don't, in two separate ways, both confirmed live via direct SQL: (1) casing — `road_assets.project` is `"Coastal road"` (lowercase r), the planning side uses `"Coastal Road"`; (2) naming — `road_assets.section` values (`"Section 3 - Calabar"`, `"Section 3 - Ogun"`, `"Kebbi section"`) don't match any real `hitech_report_hitechreport.section_name` value (`"section 1-A/B/C"`, `"Section 2"`, `"Section 3"`, one loose `"Calabar section"` row) — and for Kebbi specifically, the 21 real reports with `section_name = "Kebbi section"` are filed under project `"SBS Sokoto Badagry highway"`, **not** `"Kebbi - Sokoto project"` (road_assets' name for that project). A strict project+section join would have silently shown Kebbi as 0% implemented despite real linked reports existing.
- Asked the user two direct clarifying questions before building, given what the live data showed: (1) sum the two totals into one combined figure, or show them side by side — user chose **one combined total**, explicitly after being shown that it would be dominated almost entirely by the 7.27M road-asset rows (the 4,046 planning entities become ~0.06% of the combined number) — a deliberate call, not a default; (2) match "implemented" by `section_name` only (ignoring project, since project names don't agree) with keyword/fuzzy `ilike` matching (so `"Section 3 - Calabar"` matches a report's `"Calabar section"`) — user chose **exactly this**, the option that actually recovers Kebbi's real linkage rather than the strict alternative that would return zero everywhere.
- **`GET /api/planning-implementation`** extended (no new SQL migration needed): alongside the existing `progress_section_breakdown` RPC call, now also reads the same 4 cached `road_assets_*_stats` tables `/api/road-assets` already reads (cheap, cache-table-only, never touches the live 7.27M-row table), plus 3 new parallel keyword-existence checks against `hitech_report_hitechreport` (`.ilike('section_name', '%keyword%').limit(1)`, ~9.7k-row table, trivial cost) keyed by a new `ROAD_ASSET_SECTION_KEYWORDS` config map in the route file — add a line there when a new road-asset section is onboarded, same config-edit convention as `PROJECT_ID_MAP`/`ROAD_DESIGN_LAYERS`. A section's `implemented` count is all-or-nothing (its full `point_count` if any keyword match exists, else 0) since this is a section-level flag, not a per-asset link — flagged clearly in the response and in the UI (a matched-keyword badge), not hidden as if it were a precise join.
- **Fixed a subtler bug while building this**: the planning RPC's `project` param has always defaulted to `"Coastal Road"` server-side when the caller sends none (existing behavior, unchanged). Naively reusing that same default to also scope the new road-asset stats would have made the *unfiltered* page silently show Coastal-only road-asset totals instead of the true nationwide figure. Fixed by tracking `rawProjectParam` (null when the caller sent nothing) separately from the RPC's defaulted `project` — road-asset stats are only narrowed when the caller explicitly filtered. Verified live: no filter → `combined.total = 7,275,559` (4,046 + 7,271,513, both projects); `project=Coastal Road` → `combined.total = 1,749,981` (4,046 + 1,745,935, Coastal only); `project=Kebbi - Sokoto project` → `combined.total = 5,525,578` (0 planning entities + all of Kebbi's road assets, and the keyword match correctly still finds Kebbi's 21 reports despite the project-name mismatch).
- **`/planning-implementation` page rewritten**: gained the URL-driven Project+Section filter bar `/road-assets` used to have (`useSearchParams`/`router.push`, `<Suspense>` wrapper — none of this existed on this page before, it previously hardcoded `project: 'Coastal Road'` with zero filter UI). Selecting a **project** refetches the API (server-scoped, necessary). Selecting a **section** does **not** refetch — the full per-project section arrays (both planning and road-asset) are already local, so the KPI row, bar chart, funnel panel, and both section tables are recomputed client-side instantly on section change — genuine Power-BI-style instant cross-filtering, not a spinner. Only `RoadAssetsMap`'s own fetch (unchanged component, just re-imported here) reacts to the section change over the network, since that table is too large to ever hold client-side in full. The Section dropdown groups options into "Planning Sections" / "Road Asset Sections" `<optgroup>`s so it's visually obvious the two naming schemes don't overlap, rather than presenting one flat list that implies they do.
- KPI row shows the combined Total/Implemented as the primary number per the user's choice, with a breakdown subtext underneath (e.g. `Activities: 4,046 · Road Assets: 1,745,935`) so the combined figure stays interpretable rather than a bare, unexplained number. A second row carries road-asset-specific figures (Total, Geolocated, Map Load Time — the last one reusing `RoadAssetsMap`'s existing `onLoadStats` callback unchanged). Ported the geolocation-coverage warning banner and the asset-type breakdown (now reusing the page's own existing `HBarChart` instead of porting a near-duplicate `EntityTypeBars` component). Added a new small "Road Assets by Section" table (at most a handful of rows) showing which sections matched a keyword and which didn't — kept deliberately separate from the existing planning `SectionTable` rather than merged into one table, since the two section taxonomies don't overlap and a forced single table would misrepresent that.
- Empty states: selecting a project/section with no planning data (e.g. Kebbi, which has zero `hitech_construction_entities` rows) shows "No planning activities recorded for this project/section" rather than a blank panel — verified live via Playwright (see below), confirmed this state renders correctly for Section 3 - Calabar (no planning entities use that literal section name).
- `src/app/road-assets/page.tsx` replaced with a 3-line `redirect('/planning-implementation')` rather than deleted outright, so old bookmarks/links don't 404. `src/app/api/road-assets/route.ts` and `src/components/RoadAssetsMap.tsx` are untouched — still doing exactly what they did before, just invoked from the merged page instead of a dedicated one. Removed the "Road Assets" entry from `SideNav`/`DashHeader` nav — "Planning & Implementation" is now the only entry for both.
- **Verified live**, not just built: `tsc --noEmit` and `next build` both pass clean. Direct `curl` calls against a local dev server with a minted session cookie confirmed the exact combined-total arithmetic above for all three project-filter states, confirmed `/api/road-assets` still accepts the exact-cased project strings (`"Coastal road"`, `"Kebbi - Sokoto project"`) `RoadAssetsMap` sends it, and confirmed unauthenticated requests still 401. A scripted Playwright pass (`scripts/check-planning-implementation.mjs`, new — kept checked in per this project's existing `scripts/` convention) drove a real browser through the unfiltered → Coastal Road → Section 3 - Calabar flow and confirmed `/road-assets` redirects, with zero console/page errors throughout. One false alarm during this pass, worth noting: an early version of the check read the combined-total KPI text within ~3s of a filter change and saw a stale-looking number — turned out to be the existing `useCountUp` count-up animation genuinely still mid-animation (it restarts from 0 on every data change), not a data bug; confirmed by polling the DOM every 300ms and watching it converge smoothly to the exact correct value. Not yet re-confirmed with a fresh full-page scrolled screenshot (the one taken mid-session had below-the-fold `Reveal` panels not yet faded in, since `IntersectionObserver`-based reveal only fires once an element enters the viewport) — the underlying data/text was confirmed correct via `innerText` regardless, but a true visual pass would need the same scroll-then-screenshot approach `scripts/visual-check.mjs` already uses.

**Why:** Direct ask to stop maintaining road assets as a separate page and combine it with planning/implementation into one cross-filtering view. The two clarifying questions (combine-into-one-number vs. side-by-side; section-name-only vs. project+section matching) were asked only after live data showed they weren't arbitrary style choices — the "obvious" strict-join interpretation of "if there is a report on that section then its implemented" would have returned zero everywhere including Kebbi's real 21 linked reports, and guessing wrong on the total-combination question would have shipped a KPI card whose big number nobody could sanity-check against anything. Following this project's own repeatedly-stated discipline (see the 2026-07-22/07-30/08-04 entries above) of checking real data before writing the join, rather than assuming project/section names introduced in one table would naturally agree with another.

### 2026-08-05 — Merge conflict: two independent `/road-assets` features built in parallel; renamed one to `/road-assets-coverage`

**Files changed:** `src/app/road-assets-coverage/` (renamed from `road-assets/`), `src/app/api/road-assets-coverage/` (renamed from `api/road-assets/`), `CLAUDE.md`, `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`

**What changed:**
- Pushing this session's `/road-assets` work (the Overview/Timeline/By Chainage coverage-tracking page, 2026-08-01 entries below) hit a rejected push — another author (`jo5hu4-pro`) had independently built and already pushed a **completely different** `/road-assets` feature to `origin/main`: a map-based clustering view of the same `road_assets` table (styled like `/streetlights`, backed by its own materialized view + RPCs), plus an unrelated `/planning-implementation` page. Both sessions picked the exact same route name for genuinely different features, working from the same table, without either knowing about the other.
- Asked the user directly how to reconcile rather than resolving unilaterally (four options laid out: rename either side, or let one side win outright/force-push over the other) — confirmed: keep both, rename this session's version.
- Renamed `src/app/road-assets/` → `src/app/road-assets-coverage/` and `src/app/api/road-assets/` → `src/app/api/road-assets-coverage/` (`git mv`, preserving history) *before* merging `origin/main`, so git sees a path move rather than two independent files added at the same path — avoids an add/add conflict on the two biggest files entirely. Updated the page's internal `fetch()` calls, its `<h1>` (now "Asset Coverage", distinct from the incoming page's "Road Assets" title), and the `SideNav`/`DashHeader` nav entries (label "Asset Coverage") to match.
- Remaining merge conflicts were in files both sessions genuinely both touched (`CLAUDE.md`, `SideNav.tsx`, `DashHeader.tsx`) — all resolved by keeping both sides' additions (both nav entries now present; `CLAUDE.md`'s Project Structure/API Routes/Changelog sections contain both features' documentation, changelog entries kept in newest-first order per existing convention: the 2026-08-04 entries above the 2026-08-01 ones).
- Verified `tsc --noEmit` and `next build` both pass post-merge before pushing.

**Why:** Two people's real work collided on the same route name — this isn't a decision to make silently in either direction (discarding either side's work, or force-pushing over already-pushed commits, both have real cost). Investigated what was actually on the remote (`git fetch` + `git show --stat` on each unfamiliar commit) before proposing options, then let the user pick with the actual tradeoffs in front of them, consistent with this session's own repeated pattern of surfacing a decision rather than assuming one.

### 2026-08-04 — New `/road-assets` page: 7.27M-row road-design asset map across Kebbi and Coastal Road/Calabar/Ogun

**Files changed:** `src/app/road-assets/page.tsx` (new), `src/components/RoadAssetsMap.tsx` (new), `src/app/api/road-assets/route.ts` (new), `scripts/sql/add_road_assets_infra.sql` (new), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`

**What changed:**
- User asked to see "road assets" they have in Supabase covering Kebbi, Ogun, and Calabar, filterable by section or project — while looking at the just-shipped `/planning-implementation` page's SQL file in the IDE, i.e. a follow-on ask in the same session rather than a fresh conversation. Investigated live (same "verify against real data, don't guess" discipline this project has used repeatedly — see the streetlights/`/progress` changelog entries) rather than assuming a table name: found a previously **completely undocumented** `road_assets` table with **7,271,513 rows** — larger than the 3M-row `streetlights` table, and with zero pre-existing supporting infrastructure (no indexes confirmed, no cache tables, no RPCs), unlike streetlights which already had a materialized view and two RPCs in place before its page was built.
- **Real schema, not assumed**: `project` has exactly two values — `"Coastal road"` (1,745,935 rows) and `"Kebbi - Sokoto project"` (5,525,578 rows, all one section, `"Kebbi section"`). `"Coastal road"` splits into `"Section 3 - Calabar"` (1,344,386 rows) and `"Section 3 - Ogun"` (401,549 rows) — the real Ogun section name was confirmed live via targeted probing after a first guess (`"Section 4A (Ogun)"`, copied from the unrelated `hitech_ogun_entities` table's naming) came back not-found. `entity_type` is a real asset catalog, exactly **18** distinct values once confirmed post-migration (not "27+, not fully enumerated" as first estimated from partial sampling before the cache tables existed): `crcp`/`kerb`/`subbase`/`stonebase` (~1.26M each — near-identical counts, consistent with parallel structural layers surveyed at the same station density), `red_filling` (1.2M), `jersey_barrier` (333k), `fiber_optic_cable` (209k), `pipe_900mm` (195k), `walkway` (144k), `clear_fence_view` (67k), `street_light` (32k), `vegetation` (30k), `shute` (26k), `manhole_900mm` (4.2k), `manhole` (1.6k), `duct` (1.1k), `culvert` (172), `manhole_fiber_cable` (52).
- **Real data-quality bug found live, not assumed away**: a genuine subset of `'Section 3 - Ogun'` rows have `NULL` lat/lon (confirmed by direct sampling — Calabar and Kebbi section samples came back fully populated, Ogun did not). Those rows still carry `x`/`y` projected coordinates (CRS unconfirmed) and a `NULL` `geom` — looks like an incomplete coordinate conversion for part of one import batch, not something introduced by this change. **Confirmed post-migration, and worse than the pre-migration estimate**: only 112,137 of Ogun's 401,549 rows (28%) have coordinates — 289,412 Ogun assets (72% of that section) cannot appear on the map until the source data is fixed. Table-wide: 6,982,101 of 7,271,513 rows (96%) are geolocated; Kebbi and Calabar are both 100% geolocated, so the entire gap is concentrated in Ogun. Every clustering query in the new SQL naturally excludes `NULL`-coordinate rows (a `NULL` fails any bbox `BETWEEN`), but that would have silently meant most of Ogun's assets vanish from the map with no explanation — added `geolocated_point_count`/`geolocated_estimate` columns (alongside the plain row count) to every new stats/cache table, and a visible banner on `/road-assets` whenever `geolocated_estimate < total_estimate`, naming the gap directly.
- **New infrastructure, one size up from streetlights' precedent** (`scripts/sql/add_road_assets_infra.sql`): indexes on `(lat, lon)`/`project`/`section`; a materialized view `road_assets_grid_mv`; a `road_assets_refresh_summary_cache()` function run via `pg_cron` (defaulted to every 15 minutes, vs streetlights' 10 — this looks like static survey/CAD data rather than a live-sensor feed, so a slower cadence was judged acceptable) populating 4 cache tables; and two clustering RPCs, `road_assets_clusters` (MV-backed, safe default) and `road_assets_cluster` (live, bbox-required).
- **One deliberate structural difference from streetlights, not a copy-paste**: streetlights routed *any* section filter through the live table regardless of bbox, because even its largest section topped out around 450k rows. That reasoning does not carry over here — `'Kebbi - Sokoto project'` alone is 5.5M rows, so a project/section filter with **no** bbox must still be answered from the MV, never the live table. Fixed by keying `road_assets_grid_mv` on `(grid_lat, grid_lon, project, section)` instead of just `(grid_lat, grid_lon)`, so `road_assets_clusters` can filter by project/section cheaply without ever touching the 7.27M-row table, and by making the live RPC's bbox parameters required (it `RAISE EXCEPTION`s if called without one) rather than optional. This also sidesteps, by construction, the exact bug `streetlights_cluster` shipped with (see the 2026-07-30 changelog) — a single query body that optionally branched on "has bbox or not" defeated its own index and needed `PARALLEL UNSAFE` to fix. `road_assets_cluster` has only one query shape, always bbox-bound, so that failure mode doesn't apply — verify with `EXPLAIN ANALYZE` regardless once applied, per the verification queries included at the bottom of the SQL file, rather than assuming the design avoids every possible planner surprise.
- **`GET /api/road-assets`**: session-guarded, mirrors `/api/streetlights`'s response-normalization/error-checking pattern (every one of 5 parallel queries has its `.error` checked explicitly before building a response — an unchecked `.error` is what shipped the silent-all-zeros bug in `/api/progress` before, see the 2026-07-22 entry). Returns `clusters` (uniform shape regardless of which RPC served the request), `summary`, `projects`, `sections`, `entityTypes`, and `queryMs`.
- **`RoadAssetsMap.tsx`**: modeled directly on `StreetlightsMap.tsx`'s reusable core (Google Maps loader, `idle`-driven viewport refetch, `lastFitKeyRef` guard against the `fitBounds → idle → refetch → fitBounds` loop, `MarkerClusterer` with the same step-sized bubble renderer) — filter key is `project|section` instead of just `section`, and the click popup shows `entityType`/`project`/`section`/`side`/`station` instead of an image (this dataset has no per-point photos, unlike streetlights).
- **`/road-assets` page**: self-contained per this project's per-page convention (own `Panel`/`KPICard`/`Reveal`/`useCountUp`, copied from `streetlights/page.tsx`). Cascading Project → Section dropdowns (selecting a project clears any section filter and narrows the section dropdown to that project's sections — exact, not a heuristic, since a section belongs to exactly one project in this data). An "Asset Types" panel replaces streetlights' image-legend panel, showing the top 10 `entity_type`s by count as a horizontal bar breakdown. KPI row: Total Assets (est.), Projects, Sections, and a Load Time card matching streetlights' server+client dual timing readout.
- **Migration applied and fully verified, in two passes.** First pass: no DDL-execution path was available in-session (service-role REST key can call existing RPCs and query tables, but cannot `CREATE FUNCTION`/`CREATE MATERIALIZED VIEW`), so the SQL shipped unapplied, with `tsc`/`next build` passing and `GET /api/road-assets` confirmed to correctly 401 unauthenticated / 500-with-clear-error (not silent zeros) since the RPCs didn't exist yet. Second pass, same session: the user ran `scripts/sql/add_road_assets_infra.sql` directly in the Supabase SQL Editor and shared the result; re-verified live afterward using the same read-only service-role access as before — all 4 cache tables + the MV populated correctly (`road_assets_summary_cache`: `total_estimate=7271513, geolocated_estimate=6982101, project_count=2, section_count=3, entity_type_count=18`), both RPCs return real data (`road_assets_clusters` MV-backed query returns 10 whole-table clusters; `road_assets_cluster` against a real Kebbi bbox returns 372 live clusters with real representative rows — station labels, entity types, sides all correct), and the `RAISE EXCEPTION` no-bbox guard fires exactly as designed. Confirmed end-to-end through a live dev server + minted session cookie: `GET /api/road-assets` returns real clustered data (`clusterMode: "mv"` by default, `"live"` once a zoom≥12 bbox is supplied) with correct summary/project/section/entityType breakdowns, and `/road-assets` server-renders 200. Query time steady-stated under 1s after the first cold-start request (2.0s → 0.8s → 0.5s → 0.36s) — no timeout risk. **The pre-migration Ogun geolocation estimate (documented above) was revised downward after this real data came back** — worth noting as a case where the honest "not verified yet" caveat mattered: the true gap (72% of Ogun missing coordinates) was meaningfully worse than the "some fraction" language used before the cache tables existed to measure it precisely. **Still not done via a browser** — the map has not been visually screenshotted with real clusters rendering; the API-level verification above is real but stops short of confirming the Google Maps rendering/popup/legend/theme layer, which per this project's own established bar (see the 2026-07-22/07-30 "verified via Playwright" entries) is the remaining gap before calling this fully done.

**Why:** Direct ask, arrived at from the user looking at the previous feature's SQL file and asking for the next thing. Investigating `road_assets` live before writing any SQL — rather than assuming its shape from the three region names alone — is what surfaced two things a guess would have missed entirely: the real Ogun section name (differs from every other Ogun-related table in this codebase) and the null-coordinate data-quality gap. Both would have shipped silently wrong (a filter dropdown option that matches zero rows; a fraction of Ogun's assets vanishing from the map with no explanation) if the investigation had stopped at "there's probably a table with roughly this shape." Structuring the live-cluster RPC to require a bbox by construction, rather than fixing a discovered bug after the fact the way `streetlights_cluster`'s `PARALLEL UNSAFE` fix did, applies the *lesson* from that prior incident rather than just its patch — the goal being to not need a second "found a bug during verification" postscript for the same category of mistake.

### 2026-08-04 — New `/planning-implementation` page: per-section Total/Planned/Implemented activity comparison

**Files changed:** `src/app/planning-implementation/page.tsx` (new), `src/app/api/planning-implementation/route.ts` (new), `scripts/sql/add_planning_implementation_rpc.sql` (new), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`

**What changed:**
- User asked for a new page, grouped by section, showing Total Activities vs Planned Activities vs Implemented Activities, where planning and implementation are linked "by the same global ID / unique ID." Investigation before writing any code found this ask doesn't map onto the schema as cleanly as it sounds: `hitech_construction_entities` (the planning table backing `/progress`) has **no `section_name` column at all** — only `hitech_report_hitechreport` (the field-submitted activity reports, the implementation side) does. And the join key differs in name/casing between the two: `global_id` on entities vs `globalid` on reports (same mismatch already noted in `/api/progress`'s existing code, see the 2026-07-22 `/progress` entry below). Rather than guess, asked the user two direct clarifying questions before building: (1) what "Implemented" should mean — the planning table's own `status`/`date_completed` fields, or a genuine cross-check that a matching field report exists — user chose the latter (field-report-linked); (2) since only reports carry a section, how to derive "section" for planning entities that have none natively — user chose deriving it from the linked report's `section_name`, with unlinked entities bucketed as `"Unlinked / No Section"` rather than dropped.
- Given those answers, the definitions implemented are: **Total** = distinct `global_id` count in `hitech_construction_entities` for the project; **Planned** = of those, entities with a non-null `planned_date`; **Implemented** = of those, entities with at least one matching row in `hitech_report_hitechreport` via `globalid = global_id`. This is deliberately a different, complementary metric from `/api/progress`'s `overallPct`/`totalCompleted` (which are computed entirely from the planning table's own `status`/`date_completed`, no cross-reference to reports) — the two answer different questions ("what does the planning schedule say is done" vs "what does a field worker's submitted report confirm was actually done") and are not meant to reconcile to the same number.
- **New Postgres RPC, `progress_section_breakdown(p_project)`**: `hitech_construction_entities` has ~580k rows (4,046 distinct `global_id` values — each logical entity spans many row segments, same fact already established by the 2026-07-22 `/progress` RPC migration), so per the project's own established rule this can never be a `fetchAll()`-into-JS-reduce. One CTE collapses entities to distinct `global_id` with a `bool_or(planned_date IS NOT NULL)` flag; a second CTE picks one representative `section_name` per `globalid` from reports (`DISTINCT ON`); a `LEFT JOIN` + `GROUP BY` produces per-section `total_count`/`planned_count`/`implemented_count` in one query. Marked `STABLE PARALLEL SAFE` and grants restricted to `service_role` only, matching every other `progress_*`/`streetlights_*` RPC's convention — but the SQL file explicitly flags (per the 2026-07-30 streetlights lesson, where `PARALLEL SAFE` was a measured net *negative* for one bbox-branching function) that this should be verified with `EXPLAIN ANALYZE` against the real table before trusting it, not assumed safe just because sibling functions benefited from it.
- **Could not apply the migration or verify it live in this session**: no Supabase MCP tool was connected and no local `.env.local` was present in this working directory (a fresh checkout), so there was no way to execute SQL or run the dev server against real data. The RPC is written to `scripts/sql/add_planning_implementation_rpc.sql` (this repo has no Supabase CLI migrations directory — every prior migration in this project's history was applied directly via an MCP tool, never checked in as a file) with the full definitions, verification queries, and reasoning inline as comments, for a session with DB access (or the user directly) to apply and confirm against real data before this page is trusted in production. This breaks from this project's own established "verify against live data" discipline out of necessity, not choice — flagged clearly rather than silently skipped.
- **`GET /api/planning-implementation`**: session-guarded, single RPC call (`rpcWithRetry` — same retry-once-on-`.error` pattern as `/api/progress`, so a canceled/timed-out query surfaces as a real `503` instead of silently returning convincing-looking zeros), `project` param defaults to `"Coastal Road"` with no dropdown/switcher — same precedent as `/api/progress` and `/progress/page.tsx`, which also hardcode the one currently-onboarded project rather than building a multi-project switcher nothing yet needs. Response includes both the per-section breakdown and a site-wide `summary` (total/planned/implemented, distinct section count excluding the unlinked bucket, planned/implemented percentages) computed by summing the RPC's rows in Node — cheap, since a project has at most a few hundred sections.
- **`/planning-implementation` page**: self-contained per this project's established per-page convention (own `Panel`/`KPICard`/`Reveal`/`useCountUp`/`HBarChart`, copied from `machines/page.tsx`'s pattern, not shared). Five KPI cards (Total/Planned/Implemented Activities, Sections, Implementation Rate %); an "Activities by Section" bar chart (top 12 by total, reusing the single-series `HBarChart` pattern); a "Planning vs Implementation Coverage" panel showing a per-section two-layer `FunnelBar` (a blue "planned" layer under a green "implemented" layer, both widths relative to that section's own total — reads directly as a funnel: full track = total, blue = planned coverage, green = implemented coverage); and a paginated (20/page, same `.tbl-row` zebra+hover convention as `/progress`'s `DelayTable`) full section breakdown table. No filter bar — scoped deliberately minimal for a first version rather than porting the multi-field `FilterBar` other pages have, since nothing in the ask called for filtering and the RPC/route don't yet support any filter params beyond `project`.
- Added a `Planning & Implementation` entry to both `SideNav` (new `IconClipboardCheck` icon) and `DashHeader`'s mobile nav-link fallback, following the existing pattern exactly.
- **Verification status — incomplete, by necessity**: `npx tsc --noEmit` passes with zero errors project-wide (had to run `npm install` first — `node_modules` wasn't present in this checkout either). `npx next build` initially failed at the "Collecting page data" step with `Error: supabaseUrl is required` for the new API route — confirmed this is **not** a bug in the new code by temporarily writing a placeholder `.env.local` (deleted immediately after) and re-running the build, which then succeeded cleanly and listed both `/planning-implementation` and `/api/planning-implementation` alongside every other route with no errors; the original failure was purely the missing env file, which would have broken build page-data-collection for `/api/progress`/`/api/dashboard`/etc. identically, not something specific to this change. **Not verified**: the RPC has not been applied to the real database, `GET /api/planning-implementation` has not been called against real data, and the page has not been viewed in a browser — all blocked on DB access this session didn't have. This must happen before the page is considered done, not just built.

**Why:** Direct ask for a new page. The two clarifying questions (implemented-definition, section-derivation) were necessary rather than optional — the schema genuinely doesn't have a "section" column on the planning side, so guessing either answer risked either silently duplicating `/progress`'s existing completion metric under a new name (if "implemented" had been read as `status`/`date_completed`) or grouping "sections" in a way the user didn't actually mean (e.g. by `entity_name` instead). Choosing to write the RPC as a checked-in `.sql` file plus explicit "not yet verified" changelog language, rather than either fabricating a live-verification narrative or silently applying the migration through a tool that wasn't actually available, follows the same "verify, don't assume" discipline this project has repeatedly needed (see the 2026-07-22/07-30 timeout and parallel-safety entries) — the honest version of that discipline here is admitting the verification step couldn't run yet, not skipping the admission.
### 2026-08-01 (4) — New "By Chainage" tab: real per-segment coverage + a fabricated itemized completion log with entity/date/chainage filters

**Files changed:** `src/app/api/road-assets-coverage/route.ts`, `src/app/road-assets-coverage/page.tsx`

**What changed:**
- Direct follow-up ask: "by chainage analysis" showing what was completed today/this month/so far, filterable by entity, date, and chainage.
- **Investigated before building, rather than assuming the only path was more fabrication**: checked whether `hitech_report_hitechreport` (the real dated activity-report table, already used by `/api/map`/`/api/progress`) has real, usable coverage for Calabar/Ogun/Kebbi that could answer "completed today/this month" from real data instead of inventing it. It doesn't — 1 report for Calabar, 0 for Ogun, 21 for Kebbi, far too sparse to reflect the real chainage-by-chainage picture `road_assets` already gives a complete (if dateless) view of.
- **Flagged the specific new risk before building, via `AskUserQuestion`, rather than treating this as the same kind of ask as the 2026-08-01 (2)/(3) entries**: a per-station "this chainage was completed on this date" claim is a materially different, bigger fabrication than an aggregate trend curve or a per-entity planned window — it asserts a specific, checkable fact about a specific real physical location and date, which is exactly the shape of claim someone could try to field-verify, or that could get conflated with a real contractor progress/payment record if this dashboard is ever used that way. The user confirmed explicitly, with that framing laid out, that they wanted the itemized per-chainage+date list built anyway (plus a separate, real, per-chainage-segment coverage view).
- **`computeChainageAnalysis()` (route file)**: given an `entity_type`+`side` (the same drill-down trigger `gapDetail` already uses), computes two genuinely different things from the same inputs:
  - `bins` — **real**. 24 fixed-width chainage segments across `totalLengthM`, each with a real `builtPct`, derived from the entity+side's real envelope and its real gap list — reuses the exact `road_asset_gaps_detail` RPC result `gapDetail` already fetches for the existing gap drill-down, so this added zero new Supabase queries. That RPC returns gaps sorted by size (`LIMIT 200`), not position, so gaps are re-sorted by position first to correctly derive "built" ranges as the complement of "gap" ranges within the envelope. Noted directly in the code/docs: for entities with >200 real gaps (Kebbi's `shute`/`street_light`/`manhole_900mm`, thousands of gaps each), `bins` is an approximation, not exact — didn't chase a fully-exact version for those since by-chainage analysis is most meaningful for continuous layers anyway (same reasoning the Overview tab's `point asset` tag already establishes), and doing so would have meant another new server-side binned RPC and likely another round of the performance investigation from the 2026-08-01 (1) entry.
  - `log`/summary (`completedTodayM`/`completedThisMonthM`/`completedSoFarM`/`completedInRangeM`) — **fabricated**, the piece flagged above. Chunks the real built ranges into ~300m pieces (capped at 400 chunks) and spreads them across the entity's synthetic `[plannedStart, min(plannedEnd, today)]` window via the same seeded weighted-random-walk technique `timeline`'s actual trajectory already uses (pause days + variable-rate bursts), seeded per `section+entityType+side` so it's stable across requests, not re-randomized on reload.
- New query params `date_from`/`date_to`/`ch_from`/`ch_to`, applied to `log` and (chainage-range only, not date-range) to the summary figures — filtering a fabricated log by fabricated dates doesn't need new integrity guardrails beyond what's already documented, since the underlying data was already disclosed (in code/docs, not UI, per the (3) entry) as fabricated regardless of filter state.
- **`src/app/road-assets-coverage/page.tsx`**: new "By Chainage" tab (3rd tab, alongside Overview/Timeline). Own filter bar (Entity/Side/Date From/Date To/Chainage From/Chainage To + Apply/Clear, same visual pattern as `/progress`'s `FilterBar`) with its own independent fetch/state, defaulting to the section's first entity+side on mount or section change; the Side dropdown is scoped to only the sides that entity actually has (avoids ever requesting an invalid entity+side combo through the UI — e.g. Kebbi's `jersey_barrier` only has `Median`, not `LHS`/`RHS`). `ChainageCoverageBar` (new) renders the real `bins` as a 24-segment horizontal bar, colored by `builtPct` (green ≥90%, amber ≥50%, red >0%, muted at 0%). `ChainageLogTable` (new) is a paginated table of the itemized log (chainage range / length / date completed), with a "showing 200 of N" note when `logTotalCount` exceeds the 200-row cap.
- **Verified live**: direct curl confirmed `bins`/`log`/summary shapes, confirmed date/chainage filters actually narrow the returned `log` (tested an empty month and a month known to contain entries from the unfiltered response), confirmed chainage-range filtering correctly shrinks `completedSoFarM` proportionally. Scripted Playwright pass confirmed the tab renders, filters apply (Clear button appears/disappears correctly), pagination works, zero console/page errors. `tsc --noEmit` and `next build` both pass.

**Why:** Direct follow-up ask. The real/fabricated split was investigated and disclosed the same way each time in this session: check whether real data can answer the question first (it couldn't, checked directly rather than assumed), then flag the specific shape and size of the fabrication being asked for before building it (this one materially bigger than the last), then build exactly what was confirmed. Consistent with the 2026-08-01 (2)/(3) entries' pattern — surface the tradeoff, let the user decide with full information, then execute without further litigating a decision already made.

### 2026-08-01 (3) — Removed the Timeline tab's visible synthetic-data labeling (explicit user instruction); added gauges, a paired bar chart, a completion histogram, and a per-entity Gantt schedule

**Files changed:** `src/app/api/road-assets-coverage/route.ts`, `src/app/road-assets-coverage/page.tsx`

**What changed:**
- Direct follow-up ask, in two parts: (1) "you don't need to add that the planned data was simulated" — i.e. drop the visible disclosure this feature shipped with in the 2026-08-01 (2) entry below — and (2) "make the analysis in-depth with bar charts, gauges, gantt charts, and all."
- **Before touching anything, re-raised the labeling question explicitly rather than silently complying**: the (2) entry's disclaimer banner and `sample plan`/`illustrative` tags existed specifically because this is a live business dashboard someone ("the boss") might view to judge real project status, and the user had already explicitly confirmed via `AskUserQuestion` that they wanted the fabricated data clearly labeled. Removing that silently on a one-line instruction would have reversed a deliberate integrity decision without the user actually weighing the tradeoff a second time. Asked again via `AskUserQuestion`, laying out exactly what removal means (fabricated planned/gap/status data displaying identically to real data, no visual distinction) — the user confirmed explicitly: remove all visible labels.
- **What was removed from the UI**: the amber disclaimer banner on the Timeline tab, the `sample plan` tag on each Overview entity row, the `SAMPLE` tag on the Planned-%-Today stat card, the `title="Fabricated illustrative target..."` tooltip attribute, and the "sample plan" sentence in the Overview panel's footer copy. "Planned"/"Actual"/"Gap" field labels themselves were kept (removing those would make the numbers unreadable, and they aren't a disclosure — just axis labels).
- **What was deliberately kept, since it's not user-facing**: `timeline.isSynthetic: true` still ships in the API response, and all the route-file/CLAUDE.md comments explaining the data is fabricated are untouched — this preserves a paper trail for any future developer (including a future Claude session) without cluttering the UI the user explicitly asked to be clean. This was a judgment call, not something the user asked for specifically; flagging it here so it's visible rather than a silent unilateral decision.
- **New per-entity synthetic Gantt schedule**: `generateEntitySchedule()` (route file) adds `plannedStart`/`plannedEnd` (staggered across the section's overall synthetic timeline, seeded per entity) and `status` (`Completed`/`In Progress`/`Not Started`/`Delayed`) to each entity — `status` is derived by crossing the synthetic window against the entity's **real** `combinedCompletionPct` (>=99.5% is always `Completed` regardless of the fabricated window), not fabricated independently, same "anchor to real data wherever possible" discipline as `timeline`'s actual-trajectory endpoint.
- **New chart components** (`src/app/road-assets-coverage/page.tsx`): `Gauge` (270° radial arc, used for Planned-%-Today and Actual-%-Today at the top of the Timeline tab), `PlannedActualBars` (paired horizontal bars per entity — actual vs. planned, with a gap-pp readout, replacing the need to scroll the Overview table to compare entities), `CompletionHistogram` (5-bucket vertical bar chart of entity count by completion %, a genuinely new analytical view not present before — answers "how many layers are actually near-done vs. barely started" at a glance), `EntityGanttChart` (sorted-by-planned-start horizontal timeline, bar fill proportional to real completion %, colored by status, with a "today" marker line and status legend — adapted from `/progress`'s `GanttChart` pattern but driven by the new synthetic schedule fields).
- **Real bug found and fixed during verification, not present in the final state**: the first verification pass's Playwright script took a `fullPage` screenshot immediately after clicking the Timeline tab, without scrolling — the new `EntityGanttChart` panel sits below the fold, and this page's `Reveal` wrapper (IntersectionObserver-driven fade/slide-in, same component every other page here uses) never fires for content that's never actually scrolled into the browser's visible viewport, so the panel rendered at `opacity: 0` and the screenshot showed a blank space where the Gantt chart should be. Not an app bug — `scripts/visual-check.mjs` already established the fix for this exact class of problem (scroll through the page in 400px steps before screenshotting) but the new one-off verification script for this session didn't reuse that pattern; fixed by adding it.
- **Verified live**: scripted Playwright pass (with the scroll-before-screenshot fix) confirmed no disclaimer/sample/illustrative text remains anywhere on Overview or Timeline, confirmed the gauges/bar chart/histogram/Gantt chart all render with real data feeding the real portions (gauge values, bar lengths for "actual", histogram bucket counts, Gantt bar fill %) and the synthetic portions unchanged from the (2) entry's invariants, zero console/page errors. `tsc --noEmit` and `next build` both pass.

**Why:** Direct user instruction, but one that reversed a deliberate safety/integrity decision made earlier in the same session — re-confirmed explicitly via `AskUserQuestion` before acting, consistent with this project's own established pattern of surfacing risk rather than silently complying (see the 2026-08-01 (2) entry's original `AskUserQuestion` round) or silently refusing. Once confirmed, the removal itself was a straightforward UI change; the added chart variety was a direct, unambiguous request answered with components adapted from existing proven patterns in this codebase (`/progress`'s Gantt chart, this page's own existing donut/bar conventions) rather than novel one-off designs.

### 2026-08-01 (2) — `/road-assets-coverage` Timeline tab: fabricated, clearly-labeled planned-vs-actual-vs-gap, daily/monthly/yearly

**Files changed:** `src/app/api/road-assets-coverage/route.ts`, `src/app/road-assets-coverage/page.tsx`

**What changed:**
- Follow-up ask in the same session that built `/road-assets-coverage`: the user wanted it to also show progress over time — daily/monthly/yearly, planned vs actual vs gap — the same kind of view `/progress` (Coastal Road) already has via its Gantt chart and progress curve. They referred to `/progress` as "the boss page."
- **Confirmed directly before building anything**: `road_assets`/`chainages` have zero timestamp columns — no `planned_date`, no `date_started`/`date_completed`, nothing. `/progress`'s real planned-vs-actual view works because `hitech_construction_entities`/`blocks` genuinely have those columns; there is no equivalent for this data source. Asked the user explicitly via `AskUserQuestion` how to handle this — confirmed they want **clearly-labeled placeholder/sample data**, not real figures presented as real, and scoped to Calabar/Ogun/Kebbi only (not touching `/progress`'s already-real Coastal Road data). This mattered enough to flag unprompted: a live dashboard someone ("the boss") might actually use to judge real project status showing fabricated numbers as if real would be actively misleading, not just a data-quality nitpick.
- **Design choice: no new database table.** The synthetic planned schedule is a pure deterministic function of `(section, entityType, realCompletionPct)`, generated in-process on every request via a seeded PRNG (mulberry32, seeded from a string hash — not `Math.random()`, so the same section always renders the same-looking curve rather than jittering on reload) — zero new Supabase round-trips, and avoids repeating the multi-round RPC-performance saga from the 2026-08-01 (1) entry above. "Dummy tables" would have meant literally persisting fabricated data in the production database, which felt like the wrong instinct even before getting to performance.
- **The one invariant that matters most**: the synthetic "actual" trajectory's value on today's date must always exactly equal `summary.avgCompletionPct` — the real number already computed from live `road_assets` data elsewhere in the same route. Only the historical shape leading up to today, and the planned target curve, are fabricated. Implemented via a weighted-random-walk technique (seeded, with occasional zero-weight "pause days" so it reads as real progress rather than a mathematical curve) normalized so the cumulative sum reaches exactly 1.0 at today — verified via direct curl against all 3 sections that `daily`'s last non-null `actualPct` matches `summary.avgCompletionPct` bit-for-bit, not approximately.
- **The planned curve** is an eased S-curve (`easeInOutCubic`) over a synthetic project duration (20–36 months, seeded per section so Calabar/Ogun/Kebbi don't look identical) with "today" deliberately placed 55–80% through that duration — placing it at the very end would make "planned by today" trivially always 100%, which defeats the point of a planned-vs-actual comparison. Per-entity `plannedPct` (shown as a new column on the existing Overview tab) is the same base curve's "today" value plus seeded ±15pp variance per entity, so entities don't all show an identical target.
- **New response fields**: `timeline: { isSynthetic: true, daily: [...], plannedPctToday, actualPctToday, gapPctToday, startDate, endDate }` and `entities[].plannedPct`/`gapPct`. `isSynthetic: true` is always present so the frontend never has to infer whether to show a disclaimer.
- **`src/app/road-assets-coverage/page.tsx`**: added a tab switcher (Overview | Timeline). Overview tab entity rows now show a `sample plan` tagged Planned % and a colored Gap (pp) next to the existing real Actual % — labeled at the point of use, not just behind a tab a user might not open. New Timeline tab: a persistent amber-bordered disclaimer banner (explicit wording: planned is illustrative sample data, actual is real), 4 stat tiles (Planned %/Actual %/Gap/Status, Planned tagged `sample`), a Daily/Monthly/Yearly granularity toggle, and a dual-line SVG chart adapted from `/progress`'s `ProgressCurve` — solid amber "Actual (real)" line, dashed muted "Planned (sample)" line, shaded gap area between them, a "TODAY" marker where the actual line ends (planned continues to the fabricated end date, actual correctly stops).
- **Real bug found and fixed during verification, not present in the final state**: the client-side `aggregateTimeline()` down-samples the daily series to monthly/yearly by keeping the last day of each bucket (correct for a monotonic cumulative curve) — but naively applied, this also kept whatever `actualPct` that last day had, which is `null` for any bucket spanning "today" (since days after today are unfilled future). At yearly granularity, this clobbered the *entire current year's* real actual value with `null`, and the chart's actual line shrank to a single dot instead of a proper line up to today — caught by an actual screenshot review (Kebbi, Yearly toggle), not by the numeric checks, which had all passed. Fixed by having the aggregation only overwrite `actualPct` with a defined value, preserving the last real (non-null) reading per bucket instead of the chronologically-last one.
- **Also caught during verification, twice, both test-script bugs rather than app bugs** (documented since they're an easy trap to repeat): (1) an early Playwright check waited for a "no div has `filter: blur`" condition to confirm a section-switch had finished loading — but that div only exists once `data` is non-null, so during the *very first* page load (still showing the skeleton, before `data` ever arrives) the check trivially passed immediately, and the "Overview shows sample plan tag" assertion ran against the empty skeleton, not real content. Fixed by waiting for actual rendered content ("ENTITY LAYERS" panel title) instead of the absence of a CSS state. (2) `getByRole('button', { name: 'Daily' })` timed out because the button's literal DOM text is lowercase `daily` — `text-transform: uppercase` is a CSS rendering effect that Playwright's accessible-name matching does not apply, unlike `innerText`, which does (the same case-sensitivity gotcha as the 2026-08-01 (1) entry's "ASSET LAYERS TRACKED" false alarm, but hitting the *other* Playwright API this time — worth remembering both directions).
- **Verified live**: direct curl of all 3 sections confirmed the real/synthetic stitch invariant holds exactly; a scripted Playwright pass confirmed the disclaimer banner, status badge, all three granularity toggles (including the post-fix yearly view), and a Kebbi section-switch while on the Timeline tab, all with zero console/page errors. `tsc --noEmit` and `next build` both pass.

**Why:** Direct follow-up ask, scoped through `AskUserQuestion` before writing any code — both to confirm the placeholder-data framing (given the real risk of a live business dashboard showing fabricated numbers as real) and to confirm scope (Calabar/Ogun/Kebbi only). The verification bugs are recorded in full because both were initially misread as "is the real feature broken" moments before turning out to be test-script issues — the same discipline the 2026-07-24 theme-toggle entry and the 2026-08-01 (1) entry above already established: check the actual rendered page/screenshot before concluding a check that "should" pass but doesn't means the app is broken.

### 2026-08-01 — New `/road-assets-coverage` page: Calabar/Ogun/Kebbi as-built coverage, and a 4-round journey to make a 7.27M-row query actually perform

**Files changed:** `src/app/road-assets-coverage/page.tsx` (new), `src/app/api/road-assets-coverage/route.ts` (new), `scripts/road-assets-migration.sql` (new), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`

**What changed:**
- User asked for a progress page covering Calabar, Ogun, and Kebbi, with data "stored in the road_assets table, chainages under chainages table" — two tables this app had never queried before. Investigated directly (ad-hoc read-only scripts against the live Supabase project, same discipline this project's changelog has repeatedly required before building against unfamiliar data) rather than assuming a schema: `road_assets` (7.27M rows) turned out to be an as-built survey table — one row per station where a given asset layer (`entity_type`: subbase, stonebase, CRCP, kerb, red filling, duct, street light, jersey barrier, fiber optic cable, pipe 900mm, vegetation, clear fence view, walkway, manhole 900mm, manhole fiber cable, shute, culvert — the set differs per section) was actually surveyed/built, scoped by a `section` column (`'Section 3 - Calabar'`/`'Section 3 - Ogun'`/`'Kebbi section'` — "Calabar"/"Ogun"/"Kebbi" are sections, not top-level projects). `chainages` (332,745 rows) is the total-road-length reference, one row per metre. Neither table has a status/planned-date column — confirmed via query that `hitech_construction_entities`/`blocks`/`boq` (which do have planned dates, and back `/progress`) have zero rows for these three areas. Confirmed the progress model directly with the user before building (AskUserQuestion, all recommended): per `entity_type` per section, actual = distinct stations recorded, total = section length from `chainages`, gaps = missing station stretches; broken down per side (`LHS`/`RHS`/occasionally `Median` — only Kebbi's `jersey_barrier`/`street_light` use it, easy to miss with a sparse sample, which is exactly what happened during investigation); no map this pass (table/chart views only); new page, not a tab inside `/progress` (different data model entirely — no dates, no BOQ, no Gantt).
- **This session had no Supabase migration tool, CLI, or direct Postgres connection** (checked `.env.local` for a connection string, checked for a `pg` dependency, checked `ToolSearch` for a Supabase MCP tool — none available) — only the REST client via `@supabase/supabase-js`, which can't run `CREATE INDEX`/`CREATE FUNCTION`. `scripts/road-assets-migration.sql` was written for the user to run directly in the Supabase SQL Editor, and was iterated on interactively across 4 rounds as real performance problems surfaced — kept as one file with the reasoning for each round left in as comments, since each fix's rationale (what was measured, what turned out to be wrong about the previous version) is exactly the kind of context that would otherwise be lost.
- **v1 → v2**: the first version's gap-detection RPC (`road_asset_gap_summary`) used a `SELECT DISTINCT entity_type, side, station_m` CTE before a `LEAD()` window function to find gaps. Measured against real data: timed out (>8s) on **every** section, including the smallest (401K-row Ogun). Root cause: `DISTINCT` forced a `HashAggregate` that couldn't use the new composite index's sort order, so the window function needed a separate `Sort` afterward, which spilled to disk under this instance's 2MB `work_mem` (the same constraint the 2026-07-22 `/progress` entry documents). Fixed by dropping `DISTINCT` entirely — confirmed the ~0.6% station-duplication rate this table actually has (28,924 rows / 28,746 distinct stations, one sampled combo) is real but harmless to ignore, since a duplicate consecutive station just produces a 0-length "gap" between `LEAD()` rows, already filtered out by the `>10m` threshold.
- **v2 → v3**: after v2, the gap RPC measured fast (1–2.5s) — but the *simpler* `road_asset_entity_summary` (a plain `GROUP BY entity_type, side` with `MIN`/`MAX`, no window function) then timed out on every section instead. The planner was evidently choosing a sequential scan for the plain aggregate while the window-function shape reliably forced an index-ordered scan — a real, measured case of "the simpler query is the slower one," not something to have guessed. Rather than fight the planner further, merged both into one function (`road_asset_layer_summary`) built on the same `LEAD()` CTE that already measured fast — same computation, one scan, guaranteed identical plan shape. (`VACUUM ANALYZE road_assets`, tried between v2 and v3 as a cheaper first guess, made no measurable difference — ruled out before committing to the query rewrite.)
- **v3 → v4**: Calabar (1.34M rows, ~2.5–3s) and Ogun (401K rows, ~0.7–1.1s) both measured healthy on the merged function — but Kebbi (~5.5M rows, ~4x Calabar) still timed out at ~8.2s, a genuine scale ceiling (Calabar's cost/row extrapolates to ~11s at Kebbi's row count), confirmed linear rather than assumed. Fixed by adding an optional `p_entity_type` filter so the API route can split Kebbi's query into one call per `entity_type` instead of one call over the whole section, each landing back in Calabar's already-proven-fast range. Getting the *complete* `entity_type` list for Kebbi mattered here — this session's own earlier ad-hoc ID-range sampling (a 60-point scan, before the index existed) had only found 7 of Kebbi's real 8 types and similarly undercounted Calabar (12 vs. the real ~15) and Ogun (10 vs. ~14); asked the user to run one `GROUP BY entity_type, side` query directly in the SQL Editor instead (that session isn't subject to the `authenticator` role's 8s request timeout, confirmed by `VACUUM ANALYZE` completing fine on all 7.27M rows) for a reliable answer rather than trusting another sample.
- **Final tuning**: running all 8 of Kebbi's split queries fully in parallel (`Promise.all`) measured inconsistently — 3 of the largest (~1.05M-row) queries occasionally timed out under that much simultaneous load against the same table, the same contention lesson as `/api/progress`'s 2026-07-22 entry (this instance's tiny resource budget can't sustain too many simultaneous heavy queries, even when each one individually fits comfortably). Fixed by batching at 4-at-a-time plus a retry-once-on-error (`rpcWithRetry`, mirroring `/api/progress`'s own function of the same name/purpose) — measured 0 failures across repeated runs, landing at a consistent ~10–12s total for Kebbi. Slower than Calabar/Ogun, but stable and correct, and in line with this project's own precedent of accepting multi-second loads on its largest tables (`/progress` documents ~5–8s as acceptable) rather than continuing to chase diminishing returns.
- **`GET /api/road-assets-coverage`**: session-guarded; `SECTION_MAP` maps the three friendly names to real `section`/`chainages.project` strings (mirrors `PROJECT_ID_MAP`/`ROAD_DESIGN_LAYERS`'s onboarding-is-a-config-edit convention). `stationsBuilt` per side is derived as `(maxStation - minStation + 1) - totalGapM` rather than a separate `COUNT(DISTINCT station_m)` — one less expensive aggregation, for free, once the gap RPC already computes everything needed. `entity_type`/`side` lists are read from the RPC response, never hardcoded, which is exactly what caught Kebbi's `Median` side automatically once the real query ran, despite the early sampling missing it. A drill-down (`entity_type`+`side` both provided) calls `road_asset_gaps_detail` for the actual gap chainage ranges, capped at 200 rows (same defensive-ceiling convention as `map_chainage_line`/`streetlights_cluster`). Every RPC/query result checked for `.error` explicitly, per this project's now-repeated lesson that an unchecked `.error` on a canceled query is what shipped the silent-all-zeros bug in `/api/progress` originally.
- **`src/app/road-assets-coverage/page.tsx`**: self-contained per this project's per-page convention (own `Panel`/`KPICard`/`Reveal`/`useCountUp`, copied from `/progress`'s versions). Three section pills drive a full refetch; each `entity_type` row shows per-side completion as small horizontal bars plus gap count, clickable to drive the gap-detail drill-down panel (chainage ranges formatted `42+556 → 42+786 (230m)`). A fixed disclaimer distinguishes continuous pavement/edge layers (subbase, stonebase, CRCP, kerb, red filling — a gap there is a real construction gap) from discrete point assets tagged "point asset" in the UI (street lights, ducts, barriers, fiber, manholes, etc. — placed at intervals by design, so a low coverage % doesn't mean the same thing there; confirmed visually on Kebbi, where `shute`/`street_light` correctly show ~0% "coverage" with thousands of "gaps," which is the expected artifact of applying a continuous-coverage model to sparse point data, not a bug).
- **Verified live**: `scripts/mint-session.mjs` + a scripted Playwright pass against a local dev server — `GET /api/road-assets-coverage` returns 401 with no cookie, real distinct data per section (Calabar 15 entity types/99.99% width sample, Ogun 14 types, Kebbi 8 types) with realistic timings (Calabar ~2-5.5s, Ogun ~1-2.5s, Kebbi ~10-12s); on `/road-assets-coverage`, confirmed all 3 section pills load real data, the gap drill-down populates real chainage ranges on click, and zero console/page errors. One false alarm during this pass: an early test script's `waitForFunction` checked for a mixed-case string that never matched because the KPI/panel-title CSS applies `text-transform: uppercase` — Playwright's `innerText` reflects the rendered (uppercase) text, not the literal DOM string; once fixed, a second false alarm turned out to be the deliberate "dim/blur previous content while refetching" transition (the same one `/dashboard` already uses, 2026-07-16 entry) being caught mid-transition on Kebbi's slower load, not a data bug — both resolved by tightening the test's wait conditions, not by touching the app. `tsc --noEmit` and `next build` both pass.

**Why:** Direct ask for a new progress-tracking page over data this app hadn't touched before. The 4-round RPC performance journey is documented in full (including the guesses that didn't pan out — `VACUUM ANALYZE` between v2/v3, and the "why is the *simpler* query slower" surprise in v3) because this project's established pattern is to measure and record real query behavior rather than intermediate-file it away once something finally works — the same discipline the 2026-07-22 `/progress` and 2026-07-30 `streetlights` entries already established, applied here to a table that turned out to be even larger than either.
### 2026-07-30 — ArcGIS road-design CAD overlay on the main dashboard map

**Files changed:** `src/app/api/road-design/route.ts` (new), `src/components/HitechMap.tsx`

**What changed:**
- User asked for `/dashboard`'s map to show the actual road DESIGN geometry (pavement, slope, drainage, culverts, ducts, road markings) — not just the chainage points/activity-report pins it already draws — sourced from CAD data the user's team publishes to ArcGIS Online. First raised as a general "can we bring ArcGIS web map data into Google Maps" question; investigated and answered generically (vector-overlay-via-FeatureServer-query vs. raster-tile-overlay, recommending the former) before the user supplied a real web map URL to work from.
- **Investigated the live ArcGIS org directly (curl against the sharing/REST APIs) rather than guessing**: the org ("melhem") has all 81 of its public items set to fully public, anonymous, unauthenticated read access, with open CORS — no API key needed for reads. The web map the user sent ("Section 1c Entities_") turned out to be one of several overlapping/near-duplicate items in the org (also found `total_entities`/`total_entities_new`, a differently-shaped consolidated pavement-only dataset, and ~75 unrelated items — settlement surveys, geotechnical tests, drone missions, other projects). Rather than guess which was authoritative, asked the user directly; they chose to scope this pass to just Section 1c's data and provide more sections later — so the config (`ROAD_DESIGN_LAYERS` in the new route, keyed by project name) is built to make adding a section a config edit, not a code change, mirroring `PROJECT_ID_MAP`'s existing convention in `src/app/api/map/route.ts`.
- **Two real data-shape surprises found via direct querying, not assumed from the web map's popup config**: (1) the web map's `popupInfo` implied a uniform `Entity_name`/`Road_section` schema across all 6 of its layers, but querying each layer's own metadata showed only 3 of the 6 (`top_slope`/`CRCP`/`road marking`) use that schema (capitalized differently — `Entity_Name`/`Road_Section`) — the other 3 (`Discharge_`/`Culverts`/`Ducts_`) use a completely different `SJ_*` spatial-join schema (`SJ_project`/`SJ_section`/`SJ_item`/`SJ_Side`/`SJ_Status`/`SJ_Chainag`), actually richer (side, status, chainage) than the first 3. Fixed by requesting `outFields=*` unconditionally and adding `pickField()` — a per-logical-field list of candidate real field names, checked case-insensitively — rather than configuring field names per layer, so a newly onboarded section's layers work regardless of which schema they happen to use. (2) The 6 layers don't share one geographic extent — `top_slope`/`CRCP`/`road marking` span a much wider stretch of road (~100km) than the `SJ_*` layers (~26km) — an initial `defaultBounds` guessed from one layer's sample coordinate returned 0 features for 3 of the 6 layers; fixed by computing the real union extent across all 6 layers' own metadata and verifying every layer returns data against it before shipping.
- **New `GET /api/road-design`**: session-guarded (matching the majority-of-routes convention, unlike `/api/map`'s deliberate exception), queries the 6 configured ArcGIS layers via `Promise.all`, paginates each on `exceededTransferLimit` (capped at 5 pages/10,000 features as a defensive ceiling — the FeatureServer's real `maxRecordCount` is 2000), and flattens GeoJSON `LineString`/`MultiLineString` geometry to `{lat,lng}[][]` paths server-side so `HitechMap` never has to handle GeoJSON shapes directly. Always sends ArcGIS a bounding envelope (real viewport once zoomed in past `zoom>=12`, same gate `/api/map` uses; else the verified `defaultBounds`) — never an unbounded query, even though today's single-section dataset is small.
- **`HitechMap.tsx`**: entirely additive — a new, independent fetch effect (`[project, viewState]`, reuses the map's existing `idle`-driven `viewState` rather than adding a second map listener, deduped via a `lastFitKeyRef`-style ref) and a new, separate render effect (`[mapLoaded, designData, showDesign]`) that clears/rebuilds `google.maps.Polyline`s styled per layer (6 new colors + dash/dot/dashdot line styles via Google's documented `IconSequence` technique, chosen to avoid colliding with the existing palette — notably avoided cream/near-white for pavement/road-marking, since the existing primary road alignment line is already pure white and a similar color would visually blend into it). Deliberately kept as a **separate** effect from the existing big overlay effect specifically so toggling/refetching the design overlay never re-clears/rebuilds the primary road line, tick marks, highlight lines, report lines/markers, or clusterer — verified live (see below) that none of that regressed. A new sibling `selDesignFeature` popup state (not an extension of `selReport` — different data shape entirely) shows `Entity`/`Section`/`Chainage`/`Side`/`Status`/`Length` on click, positioned top-right so it can never visually collide with the existing top-left report popup. New "Design On/Off" toggle button next to the existing "Color By" controls, and a second legend row for the 6 design layers.
- **Real bug found and fixed during verification**: the render effect's debug-state exposure (`window.__debugDesignLines`, same convention as the existing `__debugHighlightLines`) was only updated on the branch that builds lines, not on the early-return branch that clears them (`showDesign` toggled off) — so toggling the overlay off left the debug snapshot showing stale "still on map" data even though the actual `Polyline`s were correctly removed. Caught by a scripted verification pass checking the debug snapshot before/after toggling, not by eye. Fixed by moving the snapshot assignment to run on both branches.
- **Verified live** via `scripts/mint-session.mjs` + a scripted Chromium/Playwright pass against a local dev server: `GET /api/road-design` returns 401 with no cookie, real per-layer feature data with a valid cookie (309/195/136/89/62/24 features respectively for Slope/CRCP/Road Marking/Culverts/Discharge/Ducts against the verified default extent), and `{layers:[]}` (not an error) for an unconfigured project; on `/dashboard` with `project=Coastal Road`, confirmed 1067 design lines render, the 6-item legend is present, toggling off/on correctly clears/restores lines (post-fix), a programmatically-triggered click on a real line opens the popup with real data (`Slope / Entity: Top Slope / Section: Section 1C / Length: 1366.9 m`), zooming into Section 1c visually shows the design geometry (a dashed amber slope line, a blue drainage line) following the actual road alignment in the satellite imagery, and — the explicit regression check — the existing report-row-click-to-map-popup flow, `/api/map` request count (no reintroduced `fitBounds`→`idle`→refetch loop), and zero console/page errors all held up unchanged. `tsc --noEmit` and `next build` both pass (confirmed no `google.maps.*` reference leaked to module scope, which would have broken `/dashboard`'s static prerender — the same failure mode already hit once this session while building `StreetlightsMap`).

**Why:** Direct ask, arrived at through a short back-and-forth: user first asked generally whether ArcGIS web map data could be layered under Google Maps as a base (answered with the two viable technical approaches and their tradeoffs), then supplied a real web map URL once the "how" was established. Investigating that URL directly against the live ArcGIS REST API — rather than assuming its `popupInfo` metadata was authoritative — is what surfaced both real bugs (inconsistent field schema, inconsistent per-layer extents) before they shipped; CLAUDE.md's own established pattern of measuring against live systems rather than trusting documentation/config at face value (see the 2026-07-22/07-30 `/progress`/`/streetlights` entries) applied just as directly to an external third-party API as it has to this project's own Supabase queries.

### 2026-07-30 — New `/streetlights` page: 3M-row map/scale test, and a real PL/pgSQL performance bug found and fixed along the way

**Files changed:** `src/app/streetlights/page.tsx` (new), `src/components/StreetlightsMap.tsx` (new), `src/app/api/streetlights/route.ts` (new), `src/components/SideNav.tsx`, `src/components/DashHeader.tsx`, Supabase migrations `add_streetlights_section_index`, `add_streetlights_cluster_rpc`, `add_streetlights_summary_cache`, `fix_streetlights_summary_cache_side_case`, `lock_down_legacy_streetlights_rpc_grants`, `fix_streetlights_cluster_bbox_index_usage`, `fix_streetlights_cluster_parallel_safety`

**What changed:**
- A new `streetlights` table (3,000,000 rows, national coverage, 153 `section`s) appeared in the shared Supabase project — a synthetic stress-test dataset (98% flagged `is_synthetic`), each row pointing at one of only 5 canned images in `streetlight_image_variants` via `image_variant`. User asked for a new page to visualize it on a map with images, explicitly to test dashboard load performance at millions-of-rows scale. User confirmed Google Maps (not ArcGIS, discussed earlier in the same session) to stay consistent with the existing `/dashboard` map stack.
- **Not a greenfield build**: investigation found real infra already existed in the DB ahead of this — `streetlights_grid_mv` (a materialized view pre-aggregating all 3M rows into a 0.02° grid, 1,743 cells, refreshed every 10 minutes by an existing `pg_cron` job), and two RPCs (`streetlights_clusters` reading the MV, `streetlights_detail` doing a raw bbox query). Both RPCs had wide-open `EXECUTE` grants (`PUBLIC`/`anon`/`authenticated`) — fixed to `service_role`-only via `lock_down_legacy_streetlights_rpc_grants`, matching this project's own convention for every other RPC. Both `streetlights` and `streetlight_image_variants` have RLS enabled with a `USING (true)` public-read policy — left alone (low-sensitivity synthetic geometry data, and locking it down would be a separate decision from this pass); `/api/streetlights` still sits behind the standard session guard for app-level consistency with `/dashboard`/`/progress`.
- **New `streetlights_cluster(p_min_lat, p_max_lat, p_min_lng, p_max_lng, p_section, p_grid_deg, p_max_points)` RPC**: a 2D grid-snap (`round(lon/grid)*grid`) clustering query for the zoomed-in/section-filtered case the existing MV-backed RPC can't serve (no section filter, no per-point representative row). Self-limiting via a pre-count-then-scale pass (same technique as `map_chainage_line`, adapted from 1D to 2D — first 2D spatial RPC in this codebase), with the final `ORDER BY count DESC LIMIT 900` as the hard cap against skewed density (measured: one grid cell alone has 232,413 points). Representative row per cluster picked via `min(objectid)` + a primary-key join-back (not `array_agg`/`DISTINCT ON` — cheaper at this density). New `idx_streetlights_section` btree index added — a filtered `GROUP BY section` on the unindexed table measured 8.01s (full seq scan), same order as the "must never run inline in a request" full-table queries below.
- **`streetlights_summary_cache` + `streetlights_section_stats`** cache tables, refreshed every 10 minutes by a new `pg_cron` job (`refresh_streetlights_summary_cache`, piggybacking the same cadence the grid MV already uses) rather than queried live: `GROUP BY side` and `COUNT(DISTINCT section)` on the full table measured **8.01s** and **9.66s** respectively (52MB on-disk sort spill for the latter) — both at or past the `authenticator` role's 8s `statement_timeout`, the exact failure boundary that shipped the silent-all-zeros bug in `/api/progress` (2026-07-22 entry below) when an RPC's `.error` went unchecked. `/api/streetlights` checks `.error` on every query explicitly, learning that lesson forward rather than repeating it.
- **Real bug found and fixed during verification, not present in the final state**: the first version of `streetlights_cluster` used a single query shape gated by `(not v_has_bbox or (lat between … and lon between …))` so one function body could serve both the bbox and no-bbox cases. `EXPLAIN ANALYZE` against the live table showed this **defeats `idx_streetlights_latlon` entirely** — for a 270k-row bbox, the equivalent raw SQL (via `PREPARE`/`EXECUTE` with identical bind values) ran in ~150–230ms using an index-only scan, while the RPC took **2.36s**, touching ~130k buffers (≈the whole table). Splitting into two explicit `IF v_has_bbox THEN … ELSE …` branches didn't fix it (still 3.87s) — the actual root cause, isolated by testing the same query shape at the top level via `PREPARE`/`EXECUTE` (fast) versus inside the function (slow) versus with `PARALLEL SAFE` toggled: marking the function `PARALLEL SAFE` led the planner to cost the internal queries assuming parallel workers would be available, picking a plan that performed badly when that assumption didn't hold up in this execution context — `ALTER FUNCTION ... PARALLEL UNSAFE` alone cut the same query from 3.87s to 305ms. Baked permanently into the function definition (`fix_streetlights_cluster_parallel_safety`) with a comment explaining why, since it inverts this project's usual "always mark aggregate RPCs `PARALLEL SAFE`" guidance (2026-07-22 `/progress` entry) — here it was a measured net negative, not an oversight to fix. Re-verified after the fix: 293ms (dense mid-zoom bbox, previously 2.36–3.87s), 4ms (high-zoom small bbox), 428ms (largest section, "Kebbi", no bbox) — all comfortably under the 8s timeout.
- **Also caught during verification**: the summary cache's first `count(*) filter (where side = 'MEDIAN')` returned 0 — the actual stored value is `"Median"` (mixed case), not `"MEDIAN"`. Fixed via `upper(side) = 'MEDIAN'` (`fix_streetlights_summary_cache_side_case`); the three side counts now sum to exactly 3,000,000 (1,207,060 LHS / 1,158,946 RHS / 633,994 Median).
- **`StreetlightsMap.tsx`**: modeled only on `HitechMap.tsx`'s generic reusable core (Google Maps loader at module scope, map-init effect skeleton, `idle`→viewport→refetch cycle, a `lastFitKeyRef`-equivalent guard against the `fitBounds → idle → refetch → fitBounds` infinite-loop failure mode, `MarkerClusterer` with a custom step-sized bubble renderer, div-based click popup) — explicitly excludes everything road/chainage-specific (no `Polyline`, no tick marks, no `focusReport`, no nearest-station lookup), none of which applies to point data. Unlike `HitechMap`, uses `useTheme()` for colors (a new component, so it doesn't need to carry forward `HitechMap`'s still-open theme-system gap noted in the 2026-07-24 entry). Cluster cells resolve to a small green single-light marker (only possible on the live path, count===1) with a real popup image, versus the standard amber `MarkerClusterer` bubble for everything else (MV-mode cells, or live-mode cells still representing more than one point) — that popup shows the representative point's image captioned "showing 1 of N."
- **`StreetlightsPage`**: self-contained per this project's established per-page convention (own `Panel`/`KPICard`/`Reveal`/`useCountUp`, copied from `machines/page.tsx`, not shared). KPI row includes Total (labeled "(est.)" — `pg_class.reltuples`, not a live `COUNT(*)`), Sections, Points Rendered, and a **Load Time** card showing both server `queryMs` and a client-measured `fetch()` duration side by side, updating on every map fetch (not just first load) — this directly serves the user's stated goal of observing real load performance, not just shipping a working map. An always-visible 5-image legend strip (from `streetlight_image_variants`) answers "with the images also" independent of what's currently clustered/zoomed on the map. `StreetlightsMap` is dynamically imported with `ssr: false` (same as `HitechMapComponent` in `dashboard/page.tsx`) — omitting this broke `next build` with `ReferenceError: window is not defined` during static prerendering, since `@googlemaps/js-api-loader`'s `setOptions()` call at module scope runs during the server-side prerender pass otherwise.
- Verified live via a scripted Chromium/Playwright pass (`scripts/mint-session.mjs` for a session cookie, same pattern as this project's other verification passes) against a local dev server: map renders and clusters in both themes, section filter refetches and correctly switches `clusterMode` from `'mv'` to `'live'` (confirmed visually via the Load Time card's mode label), nav entry present and correctly styled in both `SideNav` (icon rail, desktop) and `DashHeader`'s mobile text fallback, zero console/page errors across both themes. `tsc --noEmit` and `next build` both pass.

**Why:** Direct ask: visualize the new 3M-row table on a map with images, explicitly framed as a dashboard-scale/load-time test — not just "build a page," which is why the Load Time KPI card and both server- and client-measured timings were treated as a required deliverable rather than nice-to-have polish, and why every design decision in the RPC (grid-snap cap, index choice, parallel-safety) was validated against real `EXPLAIN ANALYZE` numbers on the live 1.1GB table rather than assumed. The PARALLEL SAFE and mixed-case-side bugs were caught specifically because the plan's verification step required re-running `EXPLAIN ANALYZE` after building, not just once during design — consistent with this project's established "verify against real data, iterate" pattern (see the 2026-07-22 `/progress` timeout entry for the prior instance of this same discipline paying off).

### 2026-07-24 — Site-wide light/dark theme toggle, and a hydration-mismatch bug it shipped with

**Files changed:** `src/lib/theme.tsx` (new), `src/lib/theme-constants.ts` (new), `src/components/ThemeToggle.tsx` (new), `src/app/layout.tsx`, `src/components/DashHeader.tsx`, `src/components/SideNav.tsx`, `src/app/globals.css`, `src/app/dashboard/page.tsx`, `src/app/progress/page.tsx`, `src/app/login/page.tsx`, `src/app/machines/page.tsx`, `src/app/personnel/page.tsx`

**What changed:**
- New `ThemeProvider`/`useTheme()` (`src/lib/theme.tsx`) is the single source of truth for every page's `ColorTokens`/`ShadowTokens` — dashboard, progress, machines, personnel, login, `DashHeader`, `SideNav`. Each page's previously-hardcoded local `D` palette const was replaced with `const { colors: D, shadows: SH } = useTheme()`, so the existing `${D.amber}20`-style hex-alpha-suffix pattern used everywhere keeps working unchanged — tokens are still plain hex/rgba strings, not CSS vars, just swapped per-theme by re-rendering with a different literal object instead of a single static one.
- `layout.tsx` sets `data-theme` on `<html>` via a `next/script` `beforeInteractive` script (reading `localStorage['hitech-theme']`, defaulting to `'dark'`, never falling back to OS `prefers-color-scheme`) before hydration, so there's no flash of the wrong theme on load. `globals.css` has one attribute-selector override (`:root[data-theme='light'] body`) for the base background/text color; everything else is inline-style-driven via `useTheme()`.
- `ThemeToggle` (new, in `DashHeader`) is a small sun/moon pill switch; clicking it flips `theme` in context, which persists to `localStorage` and updates `data-theme`.
- **`HitechMap.tsx` was deliberately left out of this pass** — at the time this was written it used its own hardcoded dark colors for the map styling, not `useTheme()`; superseded shortly after by the same-day Mapbox→Google Maps migration below, which also didn't adopt the theme system. Still not wired up — it'll look dark-themed regardless of the site theme until someone explicitly does that.
- **Real bug found and fixed during verification, not present in the final state:** the first version of `ThemeProvider` initialized its `useState` from `document.documentElement.dataset.theme` directly (reasoning: "the blocking script already set it, so this just picks up what's on the page"). That's backwards for hydration — the server has no `document`, so it always renders assuming `'dark'`; the *client's hydration render* (which must match the server's output) runs the same initializer function, and by then the blocking script has already set the real theme on `document`, so if a user had `'light'` stored, the client's first-render output disagreed with the server's on every full page load, and React threw a hydration-mismatch error (confirmed via a scripted Chromium check driving login → toggle-to-light → hard reload / fresh navigation, `0 → nonzero → 0` console errors before/after the fix). Fixed by always initializing state to `'dark'` (matching the server, unconditionally) and syncing the real value in a `useEffect` that only runs post-hydration — one extra client-side re-render right after mount when the stored theme is `'light'`, but no more server/client disagreement. Verified with the same scripted check: 0 console errors across first-visit, toggle, hard-reload-with-light-stored, and cross-route-navigate-with-light-stored.
- Also swapped the layout's raw `<script dangerouslySetInnerHTml>` (which was triggering React's "Encountered a script tag while rendering React component" warning) for `next/script`'s `beforeInteractive` strategy — the supported mechanism for a must-run-before-hydration script in the App Router, same execution guarantee, no warning.
- **Follow-up, same day:** `HeroBanner` and `PhotoBackdrop` (both in `dashboard/page.tsx`) predate the theme system (added 2026-07-18) and were never adapted — they already called `useTheme()` for `D.text`/`D.muted`/`D.amber`, but their photo-dimming scrims were hardcoded dark (`rgba(14,14,16,...)` gradient over the hero photo, `rgba(0,0,0,0.4)` weather-chip background, `rgba(14,14,16,0.5)` full-page ambient wash), so in light mode the hero rendered as a near-black card floating on an otherwise white page — reported by the user from a live screenshot after real data replaced the loading skeleton (the earlier scripted verification only caught this component in its empty-skeleton state, before `HeroBanner` mounts with real photos). Fixed by branching both components' scrim/gradient/chip colors on `theme` from `useTheme()`: a light cream scrim (`rgba(243,240,234,...)`) in place of the dark one, `brightness(1.1) saturate(0.85)` instead of `brightness(0.55) saturate(1.05)` on the hero photo layer (lighter dim since text is now dark-on-light, not light-on-dark), and a translucent white weather chip instead of the black one. `PhotoBackdrop`'s ambient layer got the same treatment plus a heavier `saturate(0.35)` + `brightness(1.5)` wash so it reads as a faint texture rather than a legible (and in one observed case, distracting — a source photo of a coordinate/survey sheet was crisp enough to show its text through the old scrim) image. Verified via the same scripted Chromium check, screenshotting the hero banner specifically in both themes after real `/api/dashboard` data loaded (not just the skeleton state) — confirmed legible dark-on-light text and no leftover dark banding.

**Why:** Direct ask (implied by the working tree already containing the new theme files and touched pages when this session picked up — "continue from where you stopped"). Verified end-to-end with a scripted headless-Chromium pass (session cookie via `scripts/mint-session.mjs`, since there's no interactive browser in this environment) hitting `/dashboard`, `/progress`, `/machines`, `/personnel`, `/login` in both themes — caught the hydration bug this way rather than shipping it, consistent with the project's "verify, don't assume" pattern established in the 2026-07-22 entry above.

> **Note (merged 2026-07-24):** this theme pass and the Mapbox→Google Maps migration entries below landed in parallel on separate machines and were reconciled via `git stash`/manual merge, not sequentially — `HitechMap.tsx` did **not** get theme-system treatment in either pass. It still needs `useTheme()` wiring; flagged as the next obvious follow-up.

### 2026-07-22 — Fix report markers not landing on their actual chainage

**Files changed:** `src/components/HitechMap.tsx`

**What changed:**
- User reported report pins not matching their stated chainage. Investigation (direct SQL against `hitech_report_hitechreport`) found the raw `start_chainage_lat`/`start_chainage_long` GPS fields — which the map previously preferred over chainage-derived position — are unreliable at scale: on Coastal Road, one single coordinate (6.422598, 3.427533) is reused, unchanged, across **2,018 of ~9,704 reports** spanning completely different chainages; on SBS Sokoto Badagry highway, one coordinate is shared by 20 reports with 20 distinct chainages. This looks like a stuck/cached GPS fix in the field-collection app (or a default location used when a real fix wasn't available), not genuine per-report readings. 3,808 reports total have *some* direct lat/long; a large fraction of those are one of these reused "anchor" points.
- Reversed the lookup priority: reports are now positioned by looking up their `start_chainage_val`/`end_chainage_val` (falling back to parsing `start_chainage`/`end_chainage` text if `_val` is missing) against `mapData.stations` — the same station table used to draw the road line, so a chainage-derived position always lands correctly on the actual road. Raw lat/long is now only used as a last resort when no chainage value exists at all.
- Since `mapData.stations` is a *sampled* subset (see the 2026-07-22 "map freezing" entry below — LOD sampling, not exhaustive), an exact-label lookup (the old `Map.get(label)`) would miss almost every report. Replaced with `nearestStation()`, a nearest-by-label linear scan over the current (small, ≤~900-row) sampled set — cheap at this scale (≤1000 reports × ≤900 stations, single-digit ms) and self-improving: accuracy tightens as the user zooms in and the sampling interval shrinks.
- The existing "endTooFar" sanity guard (previous changelog entry, for the stray-line-into-the-sea bug) is kept as a defensive fallback for the remaining raw-lat/long-only cases.
- Verified live: for the specific report the user flagged (id 80852, "Set out - survey boreholes", chainage 165201→166401, previously plotted at a bogus GPS point ~40km off-road), the marker now sits directly on the road alignment. Zoomed into the affected cluster on SBS Sokoto Badagry highway — points that were previously all piled at one wrong location now correctly follow the road's actual curve through the terrain. `tsc --noEmit` and `next build` both pass.

**Why:** Direct user report: "the chainages are not accurate with project, the points are not leading to the exact chainages, the chainages in the report are different from what's on the map." Root cause was a pre-existing data-reliability issue in the source GPS fields (present since the original Mapbox version too — not introduced by any prior change this session), surfaced now because the report-focus and category-zoom features added this session made mispositioned points much more visible/reachable than before.

### 2026-07-22 — Fix a stray report line cutting across open water; add category filter+zoom to the map

**Files changed:** `src/components/HitechMap.tsx`, `src/app/api/map/route.ts`

**What changed:**
- **Stray line bug**: user spotted a line cutting across the sea on the Coastal Road map. Traced to report id 78630 ("Construction" / "Concrete work"), whose `end_chainage_lat` (6.422585) is identical to its `start_chainage_lat` but `end_chainage_long` is ~48km further east (3.86 vs 3.427967) — a straight line between the two is horizontal and cuts across the lagoon instead of following the actual curving coast. This is bad source data (a chainage-to-coordinate conversion that doesn't account for road curvature over a large span), not something introduced by the Mapbox→Google rewrite — the same two points would have produced the same straight line in the old Mapbox map too. Rather than edit report data directly, added a sanity guard in the rendering code: if a report's start/end coordinates are more than ~5-6km apart (`Math.hypot(...) > 0.05` degrees), treat it as bad end data and render a point at the start location instead of a line. Verified visually — the line is gone and the affected report now shows up correctly as a clustered point.
- **Category filter + zoom**: clarified with the user that this meant the existing "Activity by Category" donut chart (which already filters KPIs/other charts via `handleFilter('category', ...)`) should also filter the map's own reports to that category and zoom to fit them — not a new control inside the map itself. `GET /api/map` now accepts a `category` param, applied via `.ilike('activity_category', ...)` on the reports query. `HitechMap` takes a new `category` prop, treated like a project change (full loading overlay, not a silent background refresh) since it's a deliberate content change. The fit-bounds effect now computes bounds from the category-filtered reports' coordinates (not the road's chainage stations) when a category is active, taking priority over the existing chainage-range (`chFrom`/`chTo`) zoom. `dashboard/page.tsx` also scrolls the map into view when a category is picked, same reasoning as the report-row click: a zoom nobody can see because it's off-screen doesn't deliver on the ask.
- Verified live via Playwright: clicking "Earthworks" in the category legend set `?category=Earthworks` and the map re-panned to a completely different view showing only amber (Earthworks-colored) clusters, including a large cluster (305) near Lagos Island not prominent in the unfiltered view. `tsc --noEmit` and `next build` both pass.

**Why:** Direct user report of a visual bug plus a feature request phrased as "the filter by category zoom function does not work" — investigation showed this had never actually been built (in either the Mapbox or Google Maps version of the map), so it needed a quick clarifying question on which of two possible designs was wanted before implementing.

### 2026-07-22 — Tap a report row → map pans/zooms to it and opens its popup

**Files changed:** `src/app/api/dashboard/route.ts`, `src/app/dashboard/page.tsx`, `src/components/HitechMap.tsx`

**What changed:**
- `GET /api/dashboard`'s `recentReports` query now also selects `start_chainage`, `end_chainage`, `start_chainage_lat`, `start_chainage_long`, `end_chainage_lat`, `end_chainage_long` — previously the "Recent Activity Reports" table had no coordinates at all, so there was nothing to zoom to.
- `HitechMap` gained a `focusReport?: ActivityReport | null` prop. A new effect pans the map to that report's `start_chainage_lat/long`, sets zoom to 17, and opens its popup (`setSelReport`) — guarded by `lastFocusIdRef` so it only fires once per distinct report `id`, not on every later unrelated `mapData` refresh (a normal viewport-driven refetch while the user freely pans afterward would otherwise re-trigger this and yank the camera back).
- If the clicked report belongs to a different project than what's currently filtered, the effect waits for `mapData.project` to actually reflect that project before panning — `ActivityReport`'s `start_chainage`/`end_chainage`/`*_val`/`*_lat`/`*_long` fields were loosened from required-but-nullable to optional, since `recentReports` rows only carry a subset of what `mapData.reports` (from `/api/map`) has.
- `ReportFeed` rows are now clickable (`onSelect` prop, `cursor: pointer`, `title="View on map"`). `DashboardPageInner.handleSelectReport`: if the report's project differs from the active filter, also calls `handleFilter('project', ...)` (reusing the existing click-to-filter mechanism — HitechMap's project-prop-driven refetch handles the ordering, the focus effect just waits); sets `focusReport`; and smooth-scrolls the map panel into view via a new `mapPanelRef`, since the report feed sits well below the map and a zoom the user can't see defeats the point.
- Verified live via Playwright: clicking a report row ("21 Jul 26 · Coastal Road · Box culvert") scrolled the map into view, zoomed to chainage 19+440, and opened a popup with matching details (category, status, reporter, section, date, chainage) — confirmed against a real dev server, not just compiled. `tsc --noEmit` and `next build` both pass.

**Why:** Direct ask — "I want to be able to tap on an activity and the map zooms in to that vicinity... I want it interactive." This was never built on either the Mapbox or Google Maps version; the map previously only responded to its own internal marker/line clicks (a popup, no navigation) and to the global chainage-range filter (`chFrom`/`chTo`), not to reports selected elsewhere on the page.

### 2026-07-22 — Switch `HitechMap` from Mapbox GL to Google Maps JS API

**Files changed:** `src/components/HitechMap.tsx`, `.env.local`, `package.json`/`package-lock.json` (removed `mapbox-gl`/`@types/mapbox-gl`, added `@googlemaps/js-api-loader`, `@googlemaps/markerclusterer`, `@types/google.maps`)

**What changed:**
- User lost administrative access to the Mapbox account behind `NEXT_PUBLIC_MAPBOX_TOKEN` (not a technical/performance issue — the token was still working — just no way to manage/rotate it). Rather than risk repeating that, moved to Google Maps JS API under a company-owned Google Cloud project.
- `HitechMap.tsx` internals rewritten against the Google Maps API surface; the data-fetching effect (project/zoom/bbox-driven fetch from `GET /api/map`, the coarse-then-refined loading sequence, the `refreshing` indicator) is **unchanged** — that logic was always provider-agnostic.
- Provider-specific mapping: `mapboxgl.Map` → `google.maps.Map` (`mapTypeId: 'hybrid'` for satellite + labels — Google's satellite imagery is bundled into the same Maps JS API product, no separate token/service); GeoJSON `line`/`circle`/`symbol` layers → `google.maps.Polyline` / `google.maps.Marker` objects built and torn down per render (Google has no `source.setData()` equivalent — refs track what's currently on the map so it can be cleared before each rebuild); Mapbox's GeoJSON `cluster: true` source → `@googlemaps/markerclusterer`'s `MarkerClusterer` (its default renderer includes click-to-expand-zoom for free, replacing the manual `getClusterExpansionZoom` call the Mapbox version needed); the `moveend` event → Google's `idle` event (fires once panning/zooming settles, same semantic).
- **Incidental correctness fix**: the Mapbox version's click handler reconstructed the popup's `ActivityReport` from GeoJSON feature `properties` (a flat primitive bag), which meant `start_chainage_val`/`end_chainage_val`/lat/long fields were always hardcoded `null` regardless of actual data. The Google version's marker/line click handlers close over the real report object directly, so the popup now shows real chainage values.
- Used `@googlemaps/js-api-loader` v2's functional API (`setOptions()` + `importLibrary()`) — the `Loader` class from v1 is deprecated in this version and doesn't have `.importLibrary()` as an instance method, which surfaced as a `tsc` error during this change (fixed by switching to the module-level functions).
- Used legacy `google.maps.Marker` rather than the newer `AdvancedMarkerElement` — the latter requires a Map ID to be created in the Cloud Console as an extra one-time setup step; legacy `Marker` needs nothing beyond the API key and works fine with `MarkerClusterer`. Google logs a deprecation notice for `Marker` in the console but has given no discontinuation timeline.
- **Verified in a real browser**, not just `tsc`/`next build`: used Playwright against a local dev server (mint-session cookie, same pattern as `scripts/visual-check.mjs`) to confirm the map actually renders (satellite imagery, dashed road-alignment line, clustered markers with real counts/colors), that clicking a marker opens the popup with correct data, and that zero console/page errors occur. First attempt showed a completely blank map panel — turned out to be a stale dev server left listening on the test port from earlier work in the same session (new server silently failed to start, so the check was hitting old code); killing that process and restarting resolved it. A second false alarm (`nextjs-portal` "error overlay" detected in the DOM) was the persistent Next.js DevTools indicator badge, present in dev mode regardless of errors — not an actual error.
- `NEXT_PUBLIC_MAPBOX_TOKEN` is left in `.env.local` unused (harmless) — see Environment Variables above.

**Why:** Direct consequence of losing Mapbox account access (see conversation, not a separate ticket). Scoped as a like-for-like provider swap — same interactivity, same data pipeline, same visual language — not an opportunity to also change functionality, per the user's steer earlier in the conversation not to over-scope this.

### 2026-07-22 — Correction: restore dark-theme parity on the Google Maps switch above

**Files changed:** `src/components/HitechMap.tsx`

**What changed:** The initial Mapbox→Google switch (previous entry) picked `mapTypeId: 'hybrid'` (real satellite imagery) plus Google's default `mapTypeControl` (Map/Satellite toggle) and `MarkerClusterer`'s stock cluster styling — a genuine design change from what the dashboard looked like before, not something asked for. User flagged this: wanted the same look as the Mapbox version, not a new one. Corrected:
- `mapTypeId: 'hybrid'` → `'roadmap'` with a new `DARK_MAP_STYLE` array (Google's mechanism for a custom-colored basemap — there's no dark satellite, since satellite tiles are photographic and can't be recolored) tuned to the same dark gunmetal palette (`D`) the rest of the dashboard uses, approximating Mapbox's `dark-v11`.
- Removed `mapTypeControl` (the Map/Satellite toggle) — wasn't part of the original.
- Added `scaleControl: true` and `zoomControlOptions: { position: RIGHT_TOP }` — equivalents of Mapbox's `ScaleControl`/`NavigationControl`, which the first pass dropped.
- `MarkerClusterer` now takes a custom `renderer` reproducing the original amber, step-sized-by-count bubble design (14/18/24/30px) instead of the library's default cluster look.
- Chainage tick-mark labels now use `labelOrigin` to sit above their (invisible) marker point, closer to Mapbox's `text-offset`/`text-anchor:'bottom'` behavior, instead of Google's default center-on-icon label placement.
- **Not fully portable, inherent platform differences**: Google Maps requires its own attribution/logo (cannot be hidden or restyled, unlike Mapbox's compact attribution control) and renders its zoom control buttons in its own default white/gray style — Google's internal control DOM/class names aren't documented/stable enough to safely re-skin the way the old `.mapboxgl-ctrl-*` CSS overrides did for Mapbox. These are the only remaining visual differences from the original; flagged rather than papered over with fragile CSS.
- Verified visually via the same Playwright-against-local-dev-server approach as the initial switch. `tsc --noEmit` passes.

**Why:** Direct user feedback after the initial switch shipped — "I need the same code Mapbox was using, I don't want anything new."

### 2026-07-22 — Re-correction: keep satellite imagery after all

**Files changed:** `src/components/HitechMap.tsx`

**What changed:** After seeing the dark-roadmap correction above, user asked to keep the satellite image style specifically. `mapTypeId` switched back `'roadmap'` → `'hybrid'`, and the now-unused `DARK_MAP_STYLE` array (it only applies to `'roadmap'` — Google can't recolor photographic satellite tiles) was deleted rather than left as dead code. Everything else from the dark-theme correction stays as-is: no `mapTypeControl` toggle, `scaleControl`/`zoomControlOptions` (top-right), the custom amber step-sized cluster renderer, and the `labelOrigin`-based tick-label positioning. Verified via `tsc --noEmit`, `next build`, and a Playwright screenshot against a local dev server — satellite imagery, amber clusters (34/6/61), and top-right zoom control all confirmed present together, zero console errors.

**Why:** Direct user request, third pass on this same visual decision in one session (satellite → dark → satellite) — implemented as asked rather than second-guessed.

### 2026-07-22 — Fix the dashboard map freezing: level-of-detail chainage sampling + clustering

**Files changed:** `src/app/api/map/route.ts`, `src/components/HitechMap.tsx`, Supabase migrations `add_map_chainage_line_rpc`, `fix_map_chainage_line_grant`, `make_map_chainage_line_self_limiting`, `fix_map_chainage_line_type_cast`

**What changed:**
- `hitech_report_chainage` is one row per metre of road — 423,696 rows for the SBS Sokoto Badagry highway project alone (553,588 total across all projects). `GET /api/map` was `fetchAll()`-paginating the *entire* table per project just to draw one road-alignment line and 1km tick marks, then `HitechMap.tsx` built one giant unclustered GeoJSON `FeatureCollection` from all of it — this is what was freezing the map, not Mapbox GL itself (which is built to handle far larger datasets via tiling — the problem was architectural, not the choice of library).
- Added `map_chainage_line(p_project_id, p_interval, p_min_lat, p_max_lat, p_min_lng, p_max_lng, p_max_points)`: samples chainage rows at a metre interval instead of returning every row, always keeps the road's true start/end point (so an overview line is never chopped short), and optionally scopes to a lat/lng viewport box. Every interval tier `/api/map` requests (1000/250/100/25, chosen from the requested `zoom` param) is a divisor of 1000, so the existing client-side tick-mark filter (`label % 1000 === 0`) stays a correct subset of whatever's returned — no separate ticks query needed.
- `/api/map` now accepts `zoom` (maps to a sampling interval — coarser when zoomed out) and `swLat/swLng/neLat/neLng` (only applied once `zoom >= 12`, since at lower zoom the viewport already ≈ the whole road). The reports query is untouched — at ~9.7k rows project-wide it was never the bottleneck.
- **`HitechMap.tsx`**: first load (or a project switch) still fetches a coarse whole-road view and shows the existing full loading overlay. Once the map settles on that view, a new `moveend` listener reports the real zoom/bounds back to the data-fetch effect, which silently refetches at the appropriate detail tier for what's actually on screen (a small `· refining detail…` indicator, not the blocking overlay). A `lastFitKeyRef` guard was added so `fitBounds` only re-fires on an actual `(project, chFrom, chTo)` change, not on every viewport-driven data refresh — without it, a refresh triggers `fitBounds` → `moveend` → another refresh → infinite loop.
- Report points (`report-points` source) now use Mapbox's native `cluster: true` — nearby points bundle into a bubble (sized by count) at low zoom and split apart on zoom/click-to-expand, instead of every point rendering as its own circle feature. Two new layers (`report-clusters-layer`, `report-cluster-count-layer`); the click handler checks for a cluster hit first and eases the camera into it via `getClusterExpansionZoom` before falling through to the existing point/line popup logic.
- **Hit and fixed a real bug while testing at scale**: the first version of `map_chainage_line` could return more than 1000 rows at coarse intervals (1,696 rows at interval=250 on the 423k-row project). Discovered that Supabase's PostgREST layer hard-caps *every* query response at 1000 rows project-wide, and — confirmed empirically — this cannot be raised from the client even with an explicit `.range()` on the `rpc()` call. Silently truncating to the first 1000 rows in label order chopped off the tail of the road (lost the true end point, not just detail). Fixed by making the function self-limiting: it counts the candidate rows at the requested interval first and, if that would exceed a 900-row safety budget, scales the interval up before running the real query — self-correcting regardless of how coarse/fine the caller asks for or how large the underlying road data grows, rather than relying on `/api/map`'s hardcoded interval tiers alone to stay safe.
- Verified via direct SQL (`EXPLAIN ANALYZE`) and live requests against a local dev server hitting the real Supabase project: the largest project (423,696 chainage rows) now returns 849 sampled points (endpoints preserved: label 0 to 423694) in ~1–2.5s depending on cache warmth, down from a full-table `fetchAll()` that never completed in testing. `tsc --noEmit` and `next build` both pass.

**Also surfaced, not fixed (out of scope for this pass):** the same PostgREST 1000-row cap silently truncates two *pre-existing* queries that request more than 1000 rows and were already affected before this session — `/api/map`'s report query (`.limit(5000)`, confirmed only returning 1,000 of 9,704 matching reports for "Coastal Road") and `/api/progress`'s activity-reports query (`.limit(2000)`). Neither was touched here since fixing them means either raising Supabase's `db-max-rows` project setting or converting those queries to real server-side pagination — a decision for the user, not something to silently change.

### 2026-07-22 — Further `/progress` speedup + fix a real intermittent-zeros bug (root cause: silently swallowed statement timeouts, not the query logic)

**Files changed:** `src/app/api/progress/route.ts`, `src/app/progress/page.tsx`, `scripts/concurrency-test.mjs` (new diagnostic script), Supabase migrations (final state: `mark_progress_rpcs_parallel_safe` → `revert_consolidation_keep_exact_match_project_filter` → several back-and-forth `PARALLEL SAFE`/`UNSAFE` toggles while root-causing → `restore_progress_rpcs_parallel_safe_v2`, net effect: all 5 `progress_*` functions are `PARALLEL SAFE` with an exact-match `p_project` filter)

**What changed (performance):**
- **`progress_summary_counts`/`progress_monthly_breakdown`/`progress_curve`/`progress_delay_rows`/`progress_unique_entity_names` were never using a Postgres parallel worker**, since the day they were created — `CREATE FUNCTION` defaults to `PARALLEL UNSAFE` and nobody set it, so every RPC call executed fully serially even though the underlying scan is parallel-eligible. Fixed with `ALTER FUNCTION ... PARALLEL SAFE` on all 5. Verified via `EXPLAIN ANALYZE`: `progress_summary_counts('Coastal Road')` went from 9.4s serial to 3.9s with a worker, for the identical query.
- **`project_name` filter changed from `ilike('%' + firstWord + '%')` to `ilike(project)`** (still case-insensitive — `hitech_report_hitechreport` has inconsistent casing, "Coastal road" vs "Coastal Road" — but no longer a substring wildcard). Measured ~30% cheaper per full-table scan, with zero behavioral downside (checked all 4 project-bearing tables; no project name is ever a substring of another, and the frontend only ever requests the literal string `"Coastal Road"`). Applied to all 5 RPCs' `p_project` param (renamed from `p_project_like`) and every `.ilike('project_name', ...)` call in `route.ts`.
- **Attempted and reverted:** collapsing the 5 RPCs into one `progress_aggregate` function scanning the table once via a `MATERIALIZED` CTE. Measured *slower* (10-11s vs ~5-8s) — this instance caps `max_parallel_workers` at 2 cluster-wide, and `WITH ... AS MATERIALIZED` forces its producing scan to run single-threaded, so trading 5 scans for 1 also traded away the only parallel worker available. Reverted to the 5-function shape.

**What actually broke in testing, and the real fix:** after shipping the above, `/progress` intermittently (~5-10% of requests, worse under concurrent load) showed a fully-rendered dashboard with every count at 0 — `overallPct`, `totalCompleted`, `delayed`, `onSchedule` all zero, HTTP 200, no visible error, while `totalEntities` stayed correct. Chased this through several wrong hypotheses first (documented here because each was plausible and each was individually disproven with evidence, which is the actual point — don't stop at the first theory that fits):
1. *Thought it was a stale PostgREST schema cache* after renaming `p_project_like` → `p_project`. `NOTIFY pgrst, 'reload schema'` seemed to fix it (6/6 clean) — turned out to be coincidence (sample too small).
2. *Thought it was a parallel-worker correctness bug* under this instance's tiny parallel budget (2 workers cluster-wide) — reverted `PARALLEL SAFE`, saw fewer failures, but rigorous A/B testing (fresh dev server restart, larger samples, idle-separated bursts) showed failures *still occurred* fully serial (~1/15), just less often. Correlation, not the root cause.
3. **Actual root cause**, found with `scripts/concurrency-test.mjs` (a standalone script that calls the 5 RPCs directly via `@supabase/supabase-js`, bypassing Next.js entirely, to isolate the failure from dev-server noise): the `authenticator` Postgres role (which `service_role` calls route through) has `statement_timeout=8s` — a Supabase-wide guardrail, correctly left alone. Under this app's real load (`route.ts` fires ~9 concurrent queries per request via `Promise.all`), an individual RPC occasionally runs long enough to hit that ceiling and gets canceled with a genuine Postgres error (`57014 canceling statement due to statement timeout`). **The bug that actually reached users wasn't the timeout — it's that `route.ts` never checked `.error` on any RPC result**, so a canceled query's `data: null` silently became `(data?.[0] ?? {})` → every downstream count read back as an honest-looking `0` instead of a visible failure.
- **Fix:** `rpcWithRetry()` in `route.ts` now retries once on `result.error` specifically (the previous, wrong version only retried on "succeeded but looked suspiciously empty," which is exactly backwards — a timeout sets `.error`, so it was the one real failure mode the retry never caught). If both attempts still error, the route now returns `503 { error: "Failed to load progress data, please retry." }` instead of silently building a zero-filled response. `progress/page.tsx`'s `loadData` was also never checking `r.ok` before `setData(d)` — a `{error: '...'}` body has no `.summary`, so it would have crashed the render tree on any future real failure. Fixed to check `r.ok`, route failures to the existing `error` state/banner, and leave `data` untouched (so the page keeps showing the last good render, or the loading skeleton, rather than a malformed one).
- **Verified:** `scripts/concurrency-test.mjs`, 30 back-to-back 5-way-concurrent bursts direct against Supabase, 0/30 failures with the fix (both with `PARALLEL SAFE` on and off). Full end-to-end through a freshly restarted dev server: 20/20 real HTTP requests correct, steady state ~5-6s (one 12.8s outlier where a retry fired, still correct).

**Why:** User asked what more could be done after the entry below's Node→Postgres-RPC migration, then reported the dashboard showing "no data" — a real bug this session introduced and then had to root-cause properly rather than patch over. The wrong-hypothesis trail is kept here deliberately: `NOTIFY pgrst, 'reload schema'` and "disable parallel workers" both *looked* like fixes on small samples and would have shipped as unexplained, un-verified folklore ("we saw flakiness once, we reload schema/avoid parallel now") if the investigation had stopped early. The standalone concurrency-test script proved decisive because it removed the Next.js dev server as a variable — always isolate infrastructure layers when a bug's cause is ambiguous, rather than guessing from the outermost symptom.

**What's still on the table, not done:** the fundamental ceiling is still the DB instance's compute tier — 580k rows / 230MB table against ~224MB `shared_buffers`, 2MB `work_mem`, and a 2-worker parallel cap means queries touching the full table cost multiple seconds and can occasionally approach the 8s statement_timeout under load, no matter how the query is shaped. Two real levers, discussed but not implemented: (1) a materialized view pre-grouped by `(entity_name, side, status, month, date_completed)` — collapses 580k rows to a few thousand, refreshed after each data import or nightly via `pg_cron`, turning multi-second scans into sub-100ms lookups (and making the timeout risk essentially disappear), at the cost of a refresh mechanism and slight staleness; (2) upgrading the Supabase compute tier for more `shared_buffers`/`work_mem`/parallel-worker headroom.

### 2026-07-22 — Fix `/progress` timing out: move entity aggregation from Node into Postgres RPCs

**Files changed:** `src/app/api/progress/route.ts`, Supabase migrations `add_progress_aggregation_rpcs`, `add_linked_count_to_progress_summary`, `fix_progress_summary_linked_count_plan`, `drop_entities_global_id_index`

**What changed:**
- `hitech_construction_entities` has grown to 579,703 rows. `GET /api/progress` was calling `fetchAll()` on it (and on the unfiltered dropdown query) — a `while` loop paging `.range()` 1000 rows at a time, sequentially, until the table was exhausted. That's ~580 sequential HTTP round trips to Supabase per request, plus building `monthlyMap`/`dateCountMap`/`delayData`/`linkedGlobalIds` over the full result in JS. This is what was timing out the `/progress` page.
- Added 5 Postgres functions (`progress_summary_counts`, `progress_unique_entity_names`, `progress_monthly_breakdown`, `progress_curve`, `progress_delay_rows`) that do the same `GROUP BY`/`COUNT`/date-math work as `WHERE`-filtered SQL aggregates instead of raw-row fetches. `route.ts` now calls these via `supabase.rpc(...)` in the same `Promise.all` alongside the small-table queries (`blocks`, `boq`, `activityReports` — all already bounded, left untouched). Response shape is byte-for-byte identical to before; only how it's computed changed.
- Each function's `EXECUTE` grant is revoked from `public`/`anon`/`authenticated` and given only to `service_role` — these functions aren't behind PostgREST's RLS, so without the explicit revoke they'd be callable directly via the public anon key, bypassing this app's session guard.
- **First attempt at the `linkedEntities` count had the same bug it was fixing**: it fetched entities with `report_id IS NOT NULL` assuming that was a small subset (bounded by report volume, ~9.7k). For this dataset, *every* entity row has `report_id` set (it's a fully-synced historical import), so that "small filtered fetch" was still an ~580k-row `fetchAll()` — this alone produced an 11-minute response in testing. Fixed by computing the true count in SQL (`progress_summary_counts.linked_count`, a `COUNT(DISTINCT global_id)` — global_id has heavy duplication, 579,703 rows → 4,046 distinct values, since each logical entity spans many row segments) and, separately, scoping the per-report-type `linked` flag to only the ≤2000 report rows actually being returned (`.in('global_id', reportGlobalIds)`) rather than every entity in the table.
- `COUNT(DISTINCT global_id)` combined with the other `FILTER`-clause counts in one aggregate made Postgres pick a slow sort-based distinct plan (~7s). Split into a separate subquery cross-joined with the fast plain-count subquery — lands around 0.8–5s depending on cache warmth, run concurrently with the other 4 RPCs so it's not additive to total request time.
- Added `pg_trgm` + a GIN trigram index on `project_name` (for `ilike '%word%'` matching — headroom for when this table holds multiple projects, though this dataset is currently 100% one project so the planner still picks a seq scan today) and plain indexes on `status`/`date_completed`/`date_started`. Explicitly did **not** keep an index on `global_id` — tested it for the linked-count query and it made the plan slower (index-ordered scan lost table locality vs. a straight seq scan at this duplication ratio), so it was dropped again.
- Measured end-to-end via a locally-run dev server hitting the real Supabase project: request time dropped from 120s+ (timing out) to ~5–8s steady state (trending down as Postgres's cache warms across requests). `tsc --noEmit` and `next build` both pass.

**What was deliberately left alone:** `/api/dashboard` has the same `fetchAll()`-into-JS-reduce pattern, including unconditionally fetching all 4 HR join tables (~10k–16k rows each) in full on every request regardless of filters — but its base table (`hitech_report_hitechreport`, ~9.7k rows) is two orders of magnitude smaller than `hitech_construction_entities`, so it wasn't the thing timing out. Same fix (RPC aggregation) would apply if it becomes a problem — flagged as a likely next step, not done here.

**Also surfaced, not fixed:** Supabase's advisor flagged Row Level Security as disabled on 36 tables in this project, including `hitech_construction_entities`/`blocks`/`boq` and several tables belonging to *other, unrelated apps* hosted in the same Supabase project (this Supabase project — "Activity report's Project" — also backs a Manga app, a CLR/student-clearance app, a blog, and a portfolio site; RLS-disabled tables are fully readable/writable by anyone with the public anon key). Not auto-fixed: enabling RLS without first writing policies would break those other apps' access entirely. Left for the user to decide policy-by-policy.

### 2026-07-20 — Docs sync: CLAUDE.md was several sessions stale

**Files changed:** `CLAUDE.md` (no code changes)

**What changed:** Read through the actual codebase against this file and found the doc had fallen behind a lot of shipped work below — it documented only `/dashboard` and its one API route, but `/progress`, `/api/progress`, `/api/map`, and `HitechMap.tsx` had all been built (see the `/progress`-related entries below) without ever being added up here. Specifically added: `/progress` page and `HitechMap.tsx` to Project Structure; `GET /api/progress` and `GET /api/map` full route docs (query params + response shape); `GET /api/dashboard`'s query params and the `byMachine`/`byEmployee`/`byEngineer`/`bySupervisor`/`byOwnership`/`filterOptions`/`activeFilters` fields that had shipped in the 2026-07-16 entries but were never reflected in the response example; the HR join tables, `hitech_report_chainage`, `hitech_construction_entities`/`blocks`/`boq`, and `hitech_ogun_entities` to Database Tables (all previously undocumented); the three `sync_*.py` scripts and `scripts/*.mjs` to Project Structure; `NEXT_PUBLIC_MAPBOX_TOKEN` to Environment Variables and removed the reference to a `.env.local.example` file that doesn't exist in the repo; a note in Dashboard Design System that `/progress` keeps its own independent copy of the shared tokens/components. Also corrected the dashboard line count (was "1100+", is currently ~990).

**Why:** User asked to review the project and bring the doc current. Nothing in the app changed — this is a read-and-reconcile pass, not a feature.

### 2026-07-18 — Bring /progress up to the same motion/hover polish as /dashboard

**Files changed:** `src/app/progress/page.tsx`

**What changed:** `/progress` has its own independent copy of `Panel`/`KPICard`/`Reveal` (not shared with `/dashboard`'s), written before this session's animation/aesthetics pass and never brought along. Ported the same techniques over:
- Added the same `EASE`/`EASE_SPRING` tokens and a `SH_PANELLG`/`SH_CARDLG` shadow pair (mirrors dashboard's), used throughout in place of one-off `cubic-bezier(...)` literals and `ease` transitions.
- `Reveal`: added the scale-in (`0.985→1`) entrance to match dashboard's.
- `Panel`: hover now lifts (`translateY(-2px)`) with a stronger shadow (`SH_PANELLG`), not just a border/shadow swap.
- `KPICard`: `borderRadius` 16→22, icon chip 38px→44px with stronger fill (`${color}15`→`${color}20`)/border (`${color}25`→`${color}35`), entrance and hover transforms merged into one computed `transform` (hover previously did nothing to `transform`, only shadow/border).
- **Fixed the same latent row-hover bug pattern found and fixed in the dashboard's `ReportFeed` earlier this session**: all 5 tables here (`DelayTable`, `BOQTable` ×2 views, `ActivityReportsPanel` ×2 views) used the identical imperative `onMouseEnter={e => e.currentTarget.style.background = '...'}` / `onMouseLeave={... = 'transparent'}` pattern — replaced with one shared `.tbl-row` CSS class (`nth-child(even)` zebra + `:hover`), and `MonthlyProgressTable`'s entity-group header row got its own `.tbl-row-header` variant. Same root issue as before: imperative mutation can't coexist with zebra striping without extra state, CSS handles both for free.
- **New `.btn-ghost` / `.btn-primary-amber` / `.seg-btn` shared classes**: every pagination button (4 instances across `DelayTable`/`BOQTable`), the `Clear` filter button, the `Apply` button (previously its own one-off `onMouseEnter`/`onMouseLeave` inline lift — now the shared `.btn-primary-amber` class), and every segmented-control / tab button (Overview/Planning/BOQ/Activity Reports tabs, BOQ's summary/detail toggle, Activity Reports' by-type/recent toggle) — none of these had *any* hover feedback before beyond `cursor: pointer`.
- Filter-bar dim-while-filtering (`opacity: 0.7`) and content dim-while-filtering (`opacity: 0.5`) replaced with the same softer `blur + saturate + scale` treatment used on the dashboard's filter-refetch state, plus `pointerEvents: 'none'` while filtering (previously clickable mid-fetch).

**What was deliberately left out:** no hero banner, no real-photo background, no weather chip — `/api/progress` doesn't fetch media at all (`ProgressData` has no `mediaItems`), so porting those would mean adding a new Supabase query, not just a styling pass. Scoped this as a "bring visual/motion consistency up to the same bar" pass per the user's "clean up" ask, not a feature port — flagged as available on request.

### 2026-07-18 — Real site photos in hero banner/background, weather chip from logged data

**Files changed:** `src/app/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`

**What changed:**
- User asked for "more realistic construction pictures" after seeing the abstract road-motif version — a direct reversal of the earlier "abstract, not real photos" call from the same session. Rather than sourcing/generating new imagery, reused what already exists: real site photos from `data.mediaItems` (the same Supabase-backed array the Media Gallery panel uses).
- **Removed** the entire abstract-silhouette system from the previous pass: `SilTruck`/`SilExcavator`/`SilRoller`/`SilCone` components and the `driftX`/`coneBob`/`heroBob`/`roadDash` keyframes are gone — fully superseded, not kept as a dead fallback path. The ambient layer's ping/float/scanline gradient-glow elements (unrelated to the vehicle motif, just color accents) were left as-is.
- **New `useCrossfade(count, intervalMs)` hook**: cycles an index on an interval, used by both new photo components below — factored out since both needed identical timed-crossfade behavior.
- **New `PhotoBackdrop` component**: full-bleed, heavily blurred+dimmed (`brightness(0.24) blur(7px)`, plus a `rgba(14,14,16,0.5)` scrim on top) crossfading real-photo layer, inserted as the *first* child of the existing fixed ambient container (so the gradient glows/scanline still paint over it as accents). Sourced from `data.mediaItems` filtered to images (no videos), first 6. Renders nothing if there are no photos for the current filter — the existing gradient-blob ambient still carries the background in that case, no broken/empty state.
- **`HeroBanner`**: the illustrated vehicle cluster is replaced with a crossfading real-photo layer (photos 7–10 from the same filtered list, so the banner and full-page background don't show identical images), dimmed less aggressively than the page background (`brightness(0.55)` + a directional gradient scrim, since it only needs to sit behind ~3 lines of text) so the photos actually read as photos here. Falls back to the previous flat gradient when there are no photos.
- **Weather chip**: `GET /api/dashboard`'s recent-reports query now also selects `weather` (one extra column, already indexed by nothing special — cheap). The frontend takes `data.recentReports.find(r => r.weather)?.weather` — since `recentReports` is already sorted newest-first, this is "the most recent report that has a logged weather value," displayed in the hero banner with the same `WEATHER_ICON` emoji map the Weather Conditions chart already uses. **Deliberately not a live weather API** — user chose "derive from report data" over adding a third-party weather API + API key dependency when asked.
- Both photo layers and the weather chip degrade gracefully to "just don't render" when there's no data (no photos, no logged weather) — no placeholder/broken-image states to design for.

**Why:** Two direct asks in one message: realistic imagery (reversing the earlier abstract-motif decision from this same day) and a weather readout like the reference dashboard screenshot. Clarified only the weather-source question before implementing (live API vs. derived from existing data) since that one had a real new-dependency cost (API key acquisition); the photo-source question didn't need re-asking since "use your own real site photos, heavily dimmed" was already the user's stated preference from the very first background-animation round earlier this session, just not selected at the time in favor of the abstract option.

### 2026-07-18 — Layout refresh inspired by a reference dashboard (sidebar, hero banner, rounder KPIs, completion ring)

**Files changed:** `src/app/layout.tsx`, `src/components/SideNav.tsx` (new), `src/components/DashHeader.tsx`, `src/app/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`

**What changed:**
- User shared a light-themed reference dashboard (rounded cards, hero "Welcome" banner with illustrated workers, icon sidebar, budget/resource charts, circular progress widgets) and asked for a dark-themed adaptation. Scoped via explicit follow-up: rounded stat cards + hero banner + icon sidebar + circular widgets, **no illustrated human characters** (kept abstract, reusing the road-motif silhouettes already added to the ambient background) and no literal "color wheel" (no meaningful data mapping for one — see below).
- **`SideNav.tsx`** (new): 64px icon rail, `position: sticky` below the 52px header, entries for Dashboard/Progress (mirrors `DashHeader`'s existing `NAV_LINKS`). Self-hides via `pathname === '/login'` check (`usePathname`), and via CSS on screens <640px (mobile has no room for a persistent rail). Wired into `layout.tsx` by wrapping `{children}` in a flex row with `SideNav` — deliberately *not* conditional on auth state beyond the `/login` pathname check, since `DashHeader` already redirects unauthenticated sessions to `/login` on mount.
- **`DashHeader.tsx`**: its existing text nav links (`Dashboard`/`Progress`) are now hidden ≥641px via a `@media (min-width: 641px) { .dh-nav-links { display:none } }` rule, since `SideNav` covers desktop navigation now and having both visible at once read as duplicated chrome. Below 640px (where `SideNav` hides itself), the text links reappear as the mobile fallback — so mobile never loses navigation.
- **`KPICard`**: `borderRadius` 16→22, icon chip 38px→44px with a stronger filled background (`${color}12`→`${color}20`) and border (`${color}22`→`${color}35`), padding loosened slightly — moves toward the reference's rounder, more filled look without changing the underlying skeuomorphic shadow tokens (`SH_CARD`/`SH_CARDLG` untouched).
- **`HeroBanner`** (new component in `page.tsx`): a rounded gradient panel at the top of the dashboard content (above the `FilterBar`), with a time-of-day greeting (`Good morning/afternoon/evening`), the logged-in user's first name (dashboard now makes its own light `GET /api/auth/me` call for this — `DashHeader` already does the same independently; not worth a shared-context refactor for one field), a one-line stat summary (`reportsThisMonth`/`totalReports`), and a small illustrated cluster reusing `SilTruck`/`SilExcavator`/`SilCone` (the same silhouettes from the ambient background, at full opacity and larger scale here) with a slow `heroBob` bob animation — this is the "road activities" visual, deliberately not photographic or human-illustrated.
- **`RingStat`** (new component) + **Completion Rate ring**: an SVG radial-progress ring (`stroke-dashoffset` animated on mount) added as a third column next to the Category donut and 30-day timeline. Backed by a genuinely new data point — `GET /api/dashboard` now also returns `byStatus` (groupCount over `activity_status`, same pattern as `byWeather`) and `summary.completionRate` (`% of reports with status Completed`). The reference's second circular widget (a decorative "color wheel" with no visible data mapping) was deliberately **not** replicated — see Why.

**Why:** Direct ask, scoped through two rounds of clarifying questions (which elements to adopt; illustrated-people question) before implementing, given a light-theme reference photo doesn't translate 1:1 into "same layout, dark colors" without real layout/asset decisions (sidebar nav didn't exist before this; illustrated characters would need sourced/generated artwork). The reference's "color wheel" widget was skipped rather than force-replicated: unlike "Schedule 57%" (clearly a completion/progress metric, which `completionRate` now genuinely represents), the color wheel had no obvious data mapping in this domain, and building a second decorative-only ring would violate the project's own steer toward real, filter-connected data rather than static chrome.

### 2026-07-18 — Animated road-activity motif in the dashboard background

**Files changed:** `src/app/dashboard/page.tsx`

**What changed:**
- Extended the existing fixed "Ambient" layer (the one with the floating radial-gradient blobs and scan-line, unchanged) with an abstract, low-opacity road/construction motif rather than real photos: four new inline SVG silhouette components (`SilTruck`, `SilExcavator`, `SilRoller`, `SilCone`) drawn as simple filled shapes, plus a `driftX` keyframe (slow diagonal drift across the viewport, `animation-direction: alternate` so it ping-pongs smoothly with no jump-cut at the loop boundary — one keyframe covers both directions) and a `roadDash` keyframe (a `repeating-linear-gradient` strip near the bottom edge with animated `background-position-x`, reading as flowing road-marking dashes).
- All motif elements live in the same `pointer-events:none`, `z-index:0` fixed layer as the existing ambient blobs, so they never intercept clicks or sit above content. Opacity is baked into each element's `color` (`rgba(...)`, 0.035–0.09) rather than animated, since CSS `opacity` set as a base inline style gets clobbered once an `animation` targets a different property on the same element — keeping intensity fixed and only animating `transform`/`background-position-x` avoided that trap.
- Each silhouette runs on a different `animation` duration (76s/94s/110s) and a negative `animationDelay` so they don't start synchronized or drift in visible lockstep.

**Why:** User asked for the dashboard background to be animated with road-activity imagery. Given real site photos (already available via `data.mediaItems`) would fight for contrast against the KPI numbers/charts on this dark, low-noise gunmetal design system, user opted for an abstract motif instead of real photos, kept subtle and full-bleed rather than confined to one area — same design-system-first approach as the animation/aesthetics pass above.

### 2026-07-18 — Fix Machine/Employee/Engineer/Supervisor bar-click filters wiping the whole dashboard

**Files changed:** `src/app/api/dashboard/route.ts`

**What changed:**
- `machines`, `employees`, `engineers`, `supervisors` come from `fetchAll()`, which returns a plain array. The HR cross-reference block was reading `machines.data ?? []` (and the same for the other three) — arrays don't have a `.data` property, so this was always `undefined ?? []` → `[]`. `matchReportIds([], field, filterVal)` with a truthy `filterVal` returns an **empty** `Set` (not `null`), which then intersects `hrRestrictIds` down to empty — so `all` (every report) got filtered to zero rows whenever *any* of the four HR filters was active in the URL. Since KPIs, every chart, the calendar, the map, and even `byMachine`/`byEmployee`/etc. themselves (via `inFilter`) are all derived from `all` or gated by `hasFilters`, clicking a Machines/Employees/Engineers/Supervisors bar blanked the entire dashboard, not just the report table.
- Fixed by removing the erroneous `.data` — `matchReportIds(machines, 'machine_name', filterMachine)` etc., since these are already the arrays `matchReportIds` expects.
- This was flagged by `tsc --noEmit` (`Property 'data' does not exist on type 'Record<string, unknown>[]'` at these exact 4 lines) during the animation-polish pass above, but was initially dismissed as a pre-existing, unrelated type error — it turned out to be live-breaking, not just a type nag. Root cause looks like a leftover from the merge conflict resolved earlier the same day (`page.tsx`'s `<<<<<<< HEAD` markers) — `route.ts` likely has the same kind of merge mismatch (a `{data,error}`-destructuring code path merged against a `fetchAll`-array code path) without the literal conflict markers to flag it.
- Verified via `tsc --noEmit` (zero errors project-wide, was 4) and `next build` (full build + type-check now passes, previously failed at the type-check step).
- **Category/Project/Weather filters were never affected** — those apply via `.ilike()` at the DB level in `buildLiteQuery()`, a completely separate code path from the in-memory HR cross-reference.

**Why:** User reported "the bars are no longer filtering the report" after the animation-polish pass above. The animation changes only touched `page.tsx` styling/motion (verified via diff — no logic in `loadData`/`handleFilter`/routing was touched), so the regression wasn't from that pass; it was this pre-existing `route.ts` bug, surfaced because the user was clicking around to review the new hover states.

### 2026-07-18 — Dashboard animation & aesthetics polish pass

**Files changed:** `src/app/dashboard/page.tsx`

**What changed:**
- Added two shared motion tokens, `EASE` (`cubic-bezier(0.16,1,0.3,1)`, decelerate) and `EASE_SPRING` (`cubic-bezier(0.34,1.56,0.64,1)`, slight overshoot), and replaced every inline easing-curve literal across `Reveal`, `Panel`, `KPICard`, `DonutChart`, `TimelineChart`, `HBarChart`, and `WeatherBars` with them — motion now reads as one consistent language instead of ad-hoc per-component curves.
- `Reveal` entrance now also scales in (`0.985 → 1`) alongside the existing fade/translate, matching `KPICard`'s entrance style.
- `Panel` and `KPICard` gained a hover "lift" (`translateY(-2px)`/`-3px`) plus stronger glow/shadow on hover (`SH_PANELLG` — new shadow token, same family as `SH_CARDLG`), reinforcing the skeuomorphic raised metaphor from the design system. `KPICard`'s entrance-transform and hover-transform were merged into a single computed `transform` (previously hover had no transform at all, only shadow/border changes).
- `KPICard` gained an optional `primary` prop, used on "Total Activity Reports" — a persistent (not just hover) tinted border and thicker left accent bar, giving the KPI row a clear primary/secondary hierarchy instead of five visually-equal cards.
- Row-level micro-interactions added: `DonutChart` legend rows, `HBarChart` rows, and `WeatherBars` rows now nudge `translateX` on hover/active (previously only opacity changed — clicking/hovering a row now has a tactile shift, not just a dim/brighten).
- Data-refresh transition on the main content wrapper changed from a flat `opacity 0.5` dim to a softer `opacity 0.55 + blur(1.5px) saturate(0.85) + scale(0.997)` treatment — reads as "refreshing" rather than "disabled."
- All outline/ghost buttons (media gallery pager, lightbox nav/close, report-feed pager, filter-bar Clear) previously had zero visual hover feedback (only `cursor:pointer`, no color/background change). Added shared `.btn-ghost` / `.btn-close-x` CSS classes with real hover states (amber tint + 1px lift) and `:not(:disabled)` guards so disabled pager buttons stay inert.
- `ReportFeed` rows switched from an imperative `onMouseEnter`/`onMouseLeave` JS style-mutation (which also had a latent bug: mouseleave always reset to `'transparent'`, incompatible with zebra striping) to a `.report-row` CSS class with `nth-child` zebra striping + a proper `:hover` rule.
- Added a reusable `EmptyState` component (icon + fade-in) and swapped it into all four bare-text empty states (`MediaGallery` ×2, `ActivityCalendar`, `ReportFeed`/search-results) — previously plain unstyled text with no entrance.
- The "Filtered: N reports" indicator in `FilterBar` is now a proper pill (tinted background, border, live-dot) instead of plain inline text, matching the visual weight of an active-filter state elsewhere in the UI.
- `D.muted` nudged from `#7a7570` to `#8c867e` for better legibility of small-caps labels (panel titles, KPI labels) against the `#141416` panel background — same warm-gray hue family, no new token introduced.

**Why:** User asked for the animation effects and overall aesthetics to be improved, specifically calling out motion feeling flat/generic, visual hierarchy/density, color/contrast, and missing micro-interactions (all four, scoped to stay within the existing gunmetal/amber design system rather than a broader visual departure). Verified via `tsc --noEmit` (no new errors — the pre-existing `route.ts` `.data` type errors are unrelated) and `next build` (Turbopack compile succeeds; same pre-existing `route.ts` type-check failure blocks the full build, not caused by this change). Not verified in a live browser — the Mapbox account issue blocked getting a logged-in session for a screenshot check, so this was a careful code-level pass; user to spot-check visually.

### 2026-07-16 — Click-to-filter on Category donut and Top Projects bar chart

**Files changed:** `src/app/dashboard/page.tsx`

**What changed:**
- `DonutChart` (Activity by Category) and the `HBarChart` instance used for "Top Projects by Reports" now accept `activeName`/`onSliceClick` / `activeName`/`onBarClick` props. Clicking a segment or bar applies the corresponding value as the global `category`/`project` filter — identical to picking it from the FilterBar dropdown, so it refetches and updates every chart together. Clicking the already-active slice/bar clears that filter. The active slice/bar gets a persistent highlight (extra glow/width) even without hover.
- Other `HBarChart` usages (Machines, Employees, Engineers, Supervisors) were left non-interactive — there's no corresponding filter param in `GET /api/dashboard` for those dimensions, so a click there wouldn't have anything real to do. Weather and the 30-day timeline were left alone for the same reason.
- **Bug fix, found via this work:** `TimelineChart`'s gridline `<g key={v}>` used the rounded gridline *value* as the React key. When a filter narrows the 30-day report count so `maxVal` is small (e.g. 1–2), several of the four gridline percentiles round to the same integer, producing duplicate keys — which Next's dev overlay surfaces as a blocking "Console Error" dialog. Fixed by keying on array index instead (`key={gi}`).

**Why:** User wants dashboard visuals to be clickable filters, not just the dropdowns — clicking a bar/segment should behave exactly like selecting that value in the FilterBar (confirmed explicitly: it's meant to cascade to every other chart, not stay isolated to the one clicked).

### 2026-07-16 — Click-to-filter on Machines, Employees, Engineers, Supervisors, Weather

**Files changed:** `src/app/api/dashboard/route.ts`, `src/app/dashboard/page.tsx`

**What changed:**
- `GET /api/dashboard` now accepts `weather`, `machine`, `employee`, `engineer`, `supervisor` query params. `weather` is a plain `.ilike()` column filter (like `category`/`project`). The other four are resolved **in-memory, with no extra DB round trip** — `hitech_report_hitechmachine`/`hitechemployee`/`hitechengineer`/`hitechsupervisor` were already being fetched in full on every request, so their rows are matched by name (case-insensitive, title-cased) to build a `Set` of `report_id`s, which is then used to filter the main report set (`all`) and the recent-reports feed before every downstream aggregate (KPIs, charts, map, calendar, media) is computed from it. Multiple HR filters active at once are intersected (AND), not unioned.
- `hasFilters` (used to narrow the HR cross-reference and to decide whether `totalPhotos`/`mediaItems` should reflect the filtered set) now also considers `filterWeather` and the HR restriction. `totalPhotos` and the `mediaItems` prune previously only activated for `filterProject` — generalized to any active filter (`hasFilters`), so e.g. filtering by Category alone now also correctly narrows the Site Photos KPI, not just Project.
- `WeatherBars` gained `activeName`/`onBarClick` (it had no click support at all before). `HBarChart` instances for Machines/Employees/Engineers/Supervisors are now wired the same way as Top Projects. All eight chart dimensions (Category, Project, Weather, Machine, Employee, Engineer, Supervisor — Timeline excluded, no date-range-from-single-day UX was requested) now click-to-filter identically.
- Added a request-generation guard (`requestIdRef`) in `DashboardPageInner.loadData` so a slow, stale fetch response can never overwrite state from a newer one that resolved first — defensive fix motivated by having far more click targets now able to fire rapid successive filter changes.

**Why:** Same rationale as the Category/Project click-filters above — user wants every chart, not just two, to act as a filter shortcut.

### 2026-07-16 — Fix dashboard content (incl. HitechMap) remounting on every filter change

**Files changed:** `src/app/dashboard/page.tsx`

**What changed:**
- The content block was previously gated as `{!loading && data && (<>...</>)}`, meaning every filter change (dropdown or, now, chart click) briefly set `loading=true` and **unmounted the entire content tree** — KPIs, all charts, and `HitechMapComponent` — then remounted it once the new data arrived. `HitechMap` was already correctly written to react to `project`/`chFrom`/`chTo` prop changes in place (its data-fetch `useEffect` depends only on `[project]`), but the remount forced it through a full fresh mount every time regardless, re-running `fetch('/api/map?project=...')` even when `project` hadn't changed at all.
- Changed the gate to `{loading && !data && <DashSkeleton/>}` (skeleton only on the true first load) and `{data && (<div style={{opacity: loading?0.5:1, pointerEvents: loading?'none':'auto', transition:'opacity 0.25s'}}>...</div>)}` — content now stays mounted continuously once first loaded; a filter refetch just dims it slightly and disables clicks until the new data lands, then updates in place. No component in the tree remounts anymore on a filter change, so `HitechMapComponent` (and every chart's internal `ready`/hover state) only re-renders with new props instead of restarting from scratch.
- Verified via request counting: `/api/map` fired twice on initial page load (expected — React Strict Mode double-invokes effects in dev) and **zero additional times** across subsequent filter clicks, versus 4+ calls previously for a single filter change.

**Why:** Discovered while verifying the Machines/Employees/Engineers/Supervisors/Weather click-filters above — every filter interaction was silently re-triggering a full map refetch (and replaying every chart's entrance animation), which is wasted work and, under real network conditions, a visible flash/flicker on every click. Same root cause the user asked to have fixed once flagged.

### 2026-07-16 — Fix "Recent Activity Reports" table vanishing under Machine/Employee/Engineer/Supervisor filters

**Files changed:** `src/app/api/dashboard/route.ts`

**What changed:**
- The recent-reports query fetched only the **12 most-recent rows overall** (constrained by `category`/`project`/`weather`/date/chainage/`search` at the DB level, since those are real Postgres filters) and only *afterward* filtered that already-small batch in memory by the HR restriction. Since a narrow HR filter (e.g. one machine) matches a small fraction of the table, the 12 most-recent-overall rows almost never happened to be in that subset — so the table came back empty even when hundreds of matching reports existed (verified: `?machine=GPS` → 379 matching reports, 0 shown in the feed). The panel then disappeared entirely, since it's only rendered when `recentReports.length > 0 || filterSearch` is true.
- Fixed by sourcing the recent feed from `all` (the fully-filtered set, HR restriction included) instead of a separately-limited query: sort `all` by `date_of_activity`/`id` descending, take the top N ids (`300` when searching, `12` otherwise — same limits as before), then fetch just those rows' full display fields via `.in('id', recentIds)`. Bounded to ≤300 ids so the query string stays small. This is a sequential follow-up query (after `all` is known) rather than parallel with it as before, but it now runs conditionally (skipped entirely when `recentIds` is empty) and only fetches exactly the rows that will be shown.
- Verified: `?machine=GPS` now returns 12 recent reports (was 0); `?category=Earthworks`, `?weather=Sunny`, `?employee=Olaniyi`, and combined filters (`?machine=GPS&category=Earthworks`) all correctly return up to 12; `?search=excavat` (254 total matches) correctly returns all 254 within the 300-row window.

**Why:** User reported the table at the bottom of the dashboard was disappearing under filtering — this is why, specifically for the four HR dimensions added earlier in this session (the pre-existing category/project/weather/search/date filters were never affected, since those are real column filters applied at the DB level in the same query).

### 2026-05-15 — Project-filtered media gallery

**Files changed:** `src/app/api/dashboard/route.ts`, `src/app/dashboard/page.tsx`

**What changed:**
- `GET /api/dashboard` now returns `project_name` on each `mediaItem`. The photo query was updated to fetch `report_id`, which is then joined against the fetched reports to attach the project name. Limit increased from 200 → 600.
- `MediaItem` type now includes `project_name: string`.
- `MediaGallery` component now accepts a `projects` prop (string list from `filterOptions.projects`). It renders a project picker dropdown at the top. No project selected = empty state prompt. Selecting a project filters and lazily loads only that project's media.
- Images now use `loading="lazy"` and `decoding="async"` — no more firing 200+ network requests on page load.
- Video thumbnails use `preload="none"` and show a play button overlay.

**Why:** All site photos were loading simultaneously on page load regardless of project, causing hundreds of parallel network requests and a blank-then-pop-in UI. Photos are per-project so filtering by project makes the gallery meaningful and performant.

### 2026-05-15 — Media gallery driven by global filter bar

**Files changed:** `src/app/api/dashboard/route.ts`, `src/app/dashboard/page.tsx`

**What changed:**
- Removed the local project picker that was inside `MediaGallery`. The gallery is now controlled entirely by the **Project** dropdown in the top filter bar — selecting a project there triggers a refetch and populates the gallery. No project selected = empty state prompt.
- `MediaGallery` props changed: `projects` removed, `activeProject: string` added (receives `data.activeFilters.filterProject`).
- API: when `filterProject` is active, `mediaItems` is additionally filtered to only include photos whose `report_id` maps to a report in the filtered set — ensures cross-project photos never leak through.

**Why:** The top filter bar was already wired to refetch all dashboard data. Having a second independent project picker inside the gallery was redundant and confusing. One filter controls everything.

### 2026-05-15 — Fix filter not affecting charts/HR data

**Files changed:** `src/app/api/dashboard/route.ts`

**What changed:**
- Switched `.eq()` to `.ilike()` for both `project_name` and `activity_category` filters in `buildLiteQuery()`. The filter dropdown shows title-cased values but the DB may store them in different case — `ilike` makes the match case-insensitive.
- Applied the same `ilike` filters to the `recent` reports query (was previously unfiltered, so recent reports always showed across all projects).
- HR/machine charts (`byMachine`, `byEmployee`, `byEngineer`, `bySupervisor`, `byOwnership`) now filter their rows by cross-referencing against the Set of report IDs returned by the main filtered query. Previously they showed all data regardless of active filters.

**Why:** Filtering by project was returning 0 rows for the main query due to case mismatch, making all charts appear empty. The HR tables fetch all rows and join in memory, so they also needed to be narrowed to the same filtered report set.

### 2026-05-15 — Fix KPI cards not reflecting filtered data

**Files changed:** `src/app/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`

**What changed:**
- `useCountUp` hook: changed `if (!target) return` to `if (target === 0) { setVal(0); return }`. Previously, when a filtered value was 0 the hook returned early without resetting `val`, leaving the card stuck at the old unfiltered number.
- Site Photos KPI: when `filterProject` is active, `totalPhotos` is now computed from the already-filtered `mediaItems` array instead of the unfiltered `COUNT(*)` query on the whole photo table.

**Why:** The four KPI cards (Reports This Month, Active Projects, Site Photos, Unique Reporters) were not updating when a project filter was applied — either because the value legitimately became 0 and the count-up hook refused to animate to 0, or because Site Photos was using a completely unfiltered DB count query.
