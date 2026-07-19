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
    DashHeader.tsx          # Sticky 52px header — logo, title, user name, logout button. Text nav links are mobile-only fallback (hidden ≥641px, SideNav covers desktop)
    SideNav.tsx             # 64px icon rail (Dashboard/Progress), sticky below header, hidden on /login and <640px
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
    "uniqueReporters": 14,
    "completionRate": 74
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
  "byStatus": [
    { "name": "Completed", "count": 310 }
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
      "comment_activity": "Completed 50m of cut",
      "weather": "Sunny"
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
