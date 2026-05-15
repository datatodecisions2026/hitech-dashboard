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
