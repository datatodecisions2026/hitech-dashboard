# Hitech Analytics Dashboard — Claude Code Context

Standalone analytics dashboard for Hitech Construction Ltd. Built with Next.js 16.2.6 (App Router, Turbopack), Supabase, and iron-session auth.

> **Next.js version note:** This uses Next.js 16.2.6 which may have APIs that differ from your training data. Read `node_modules/next/dist/docs/` before writing any Next.js-specific code. Heed deprecation notices.

---

## Project Structure

```
src/
  app/
    layout.tsx              # Root layout — mounts DashHeader, loads fonts
    page.tsx                # Redirects / → /dashboard
    globals.css             # Minimal CSS reset + keyframes
    login/page.tsx          # Login page (amber theme, dark card)
    dashboard/page.tsx      # Main dashboard (skeuomorphic, 1100+ lines, self-contained)
    api/
      auth/
        login/route.ts      # POST — authenticate against Supabase auth_user table
        logout/route.ts     # POST — destroy iron-session cookie
        me/route.ts         # GET  — return session user or 401
      dashboard/route.ts    # GET  — aggregate all dashboard data from Supabase
  components/
    DashHeader.tsx          # Sticky 52px header — logo, title, user name, logout button
  lib/
    session.ts              # iron-session config (cookie: hitech-dashboard-session)
```

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

**Response (200):**
```json
{
  "summary": {
    "totalReports": 420,
    "reportsThisMonth": 38,
    "activeProjects": 5,
    "totalPhotos": 812,
    "uniqueReporters": 14
  },
  "byCategory": [
    { "name": "Earthworks", "count": 120 }
  ],
  "byProject": [
    { "name": "Ring Road Phase 2", "count": 85 }
  ],
  "byDay": [
    { "date": "2026-04-16", "count": 4 }
  ],
  "byWeather": [
    { "name": "Sunny", "count": 210 }
  ],
  "mediaItems": [
    { "file": "https://…/photo.jpg", "media_type": "image" }
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
      "comment_activity": "Completed 50m of cut"
    }
  ]
}
```

---

## Database Tables (Supabase / PostgreSQL)

The dashboard reads from two tables:

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

---

## Auth Flow

1. User submits email + password on `/login`
2. `POST /api/auth/login` verifies against `auth_user.password` (Django pbkdf2_sha256)
3. On success: iron-session sets `hitech-dashboard-session` cookie
4. `DashHeader` calls `GET /api/auth/me` on mount — redirects to `/login` on 401
5. `GET /api/dashboard` also guards with session check — returns 401 if unauthenticated
6. Logout: `POST /api/auth/logout` destroys the cookie, redirect to `/login`

---

## Dashboard Design System

The dashboard (`src/app/dashboard/page.tsx`) uses a **skeuomorphic gunmetal** design. All tokens are defined locally in that file — do not use globals.css CSS vars inside the dashboard.

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

Copy `.env.local.example` to `.env.local` and fill in values to run locally.

---

## Changelog

> Keep this section up to date. Every time a feature, fix, or endpoint is added/changed, log it here so the next person (or Claude) knows what's been done and why.

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
