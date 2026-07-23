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
    api/
      auth/
        login/route.ts      # POST — authenticate against Supabase auth_user table
        logout/route.ts     # POST — destroy iron-session cookie
        me/route.ts         # GET  — return session user or 401
      dashboard/route.ts    # GET  — aggregate all dashboard data from Supabase (session-guarded)
      progress/route.ts     # GET  — aggregate construction-progress data from Supabase (session-guarded)
      map/route.ts          # GET  — chainage stations + geotagged reports for HitechMap (no session guard)
  components/
    DashHeader.tsx          # Sticky 52px header — logo, title, user name, logout button. Text nav links are mobile-only fallback (hidden ≥641px, SideNav covers desktop)
    SideNav.tsx             # 64px icon rail (Dashboard/Progress), sticky below header, hidden on /login and <640px
    HitechMap.tsx           # Google Maps JS API map (hybrid/satellite) — chainage stations + report points, used on /dashboard. Was Mapbox GL until 2026-07-22 — see changelog
  lib/
    session.ts              # iron-session config (cookie: hitech-dashboard-session)
scripts/                    # Node maintenance/verification scripts (run manually, not part of the app) — backfill-chainage.mjs, check-ranges.mjs, click-filter-check.mjs, mint-session.mjs, verify-hr-filters.mjs, visual-check.mjs
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
category, project, weather   — case-insensitive .ilike() match on the report columns
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
    "projects": ["Ring Road Phase 2", "N1 Highway"]
  },
  "activeFilters": {
    "filterCategory": "", "filterProject": "", "filterDateFrom": "", "filterDateTo": "",
    "filterChFrom": "", "filterChTo": "", "filterSearch": "",
    "filterWeather": "", "filterMachine": "", "filterEmployee": "", "filterEngineer": "", "filterSupervisor": ""
  }
}
```

`byMachine`/`byEmployee`/`byEngineer`/`bySupervisor`/`byOwnership` are computed by cross-referencing the HR join tables (fetched in full every request, joined in-memory via `report_id`) against whichever reports match the active filters — see the 2026-07-16/2026-07-18 changelog entries below for the filtering/remount bugs this shape was built to fix.

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
Populated by `sync_ogun.py` (append-only, checks row count before inserting). Not currently read by any route in this app — data-ingestion-only as of this writing; confirm before assuming it's dead.

---

## Auth Flow

1. User submits email + password on `/login`
2. `POST /api/auth/login` verifies against `auth_user.password` (Django pbkdf2_sha256)
3. On success: iron-session sets `hitech-dashboard-session` cookie
4. `DashHeader` calls `GET /api/auth/me` on mount — redirects to `/login` on 401
5. `GET /api/dashboard` and `GET /api/progress` also guard with a session check — return 401 if unauthenticated. `GET /api/map` does **not** guard — it's fetched client-side by `HitechMap` and returns no user-identifying data, but keep that in mind if its response shape ever changes
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
