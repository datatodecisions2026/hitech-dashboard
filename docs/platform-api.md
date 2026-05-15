# Hitech Portal — Full Platform API Reference

These are all API routes that exist in the main **hitech-portal** (`https://hitech-portal.vercel.app`).

> **For the dashboard project:** You have the same Supabase `SUPABASE_SERVICE_ROLE_KEY`, so you can query any table directly without going through the portal's API. Add a new route under `src/app/api/` that queries Supabase directly — that is the preferred pattern in this codebase. The portal API routes are documented here so you know what data is available and how it's shaped.

All routes require a valid session cookie unless noted. All `401` responses mean unauthenticated; `403` means authenticated but wrong role.

---

## Auth

### `POST /api/auth/login`
```
Body:  { identifier: string, password: string }
200:   { ok: true }
400:   { error: "Email and password are required." }
401:   { error: "Invalid credentials." }
```
Sets `hitech-session` cookie. Verifies Django pbkdf2_sha256 hash from `auth_user` table.

### `POST /api/auth/logout`
```
200: { ok: true }
```
Destroys session cookie.

### `GET /api/auth/me`
```
200: { user: { id, first_name, last_name, email, is_staff, is_superuser, role: "admin"|"worker" } }
401: { user: null }
```

### `POST /api/auth/signup`
```
Body:  { first_name, last_name, email, password, jobRole }
200:   { ok: true }
```
Creates a new user in `auth_user`. No email verification.

---

## Reports

### `GET /api/reports`

Paginated list of activity reports. Page size: 20.

```
Query params:
  search   — full-text search on reporter_name, project_name, activity_type
  project  — exact match on project_name
  category — exact match on activity_category
  page     — 0-indexed page number (default: 0)

200: {
  reports: Report[],
  total: number        // total matching rows for pagination
}
```

**Report object:**
```ts
{
  id: number
  date_of_activity: string          // "YYYY-MM-DD"
  reporter_name: string
  project_name: string
  section_name: string
  activity_category: string         // Earthworks, Drainage, Concrete, etc.
  activity_type: string
  activity_status: string           // Completed | In Progress | Pending
  comment_activity: string
  weather: string
  start_chainage: string            // e.g. "1+500"
  end_chainage: string
  start_chainage_lat: string        // numeric as string
  start_chainage_long: string
  end_chainage_lat: string
  end_chainage_long: string
  start_chainage_val: number        // normalised numeric (metres)
  end_chainage_val: number
  submitted_at: string              // ISO timestamp
  submitted_by_id: number
}
```

### `GET /api/reports/[id]/detail`

Full detail for one report including attached media, personnel, and machines.

```
200: {
  photos:      Array<{ file: string, media_type: "image"|"video" }>
  employees:   Array<{ employee_name, employee_role, employee_missing_name }>
  supervisors: Array<{ supervisor_name, party, subcontractor_name, supervisor_missing_name }>
  engineers:   Array<{ engineer_name, party, subcontractor_name, engineer_missing_name }>
  machines:    Array<{ ownership, machine_name, plate_number, driver_name, fleet_number }>
}
```

### `GET /api/reports/filters`

Returns all distinct project names and activity categories for building filter dropdowns.

```
200: {
  projects:   string[]   // e.g. ["Ring Road Phase 2", "N1 Highway"]
  categories: string[]   // e.g. ["Earthworks", "Drainage"]
}
```

### `GET /api/reports/chainage`

Search chainages for autocomplete in the report submission form.

```
Query params:
  project  — required
  section  — optional
  q        — search string
  page     — 1-indexed (default: 1), page size 10

200: {
  results:  Array<{ chainage, name, label, section_name }>
  has_more: boolean
}
```

### `POST /api/reports/submit`

Submit a new activity report. Checks for chainage overlap before inserting.

```
Body: {
  project_name, section_name, activity_category, activity_type,
  activity_status, date_of_activity, weather, comment_activity,
  start_chainage, end_chainage,
  start_chainage_lat, start_chainage_long,
  end_chainage_lat, end_chainage_long,
  employees: PersonRow[],
  supervisors: PersonRow[],
  engineers: PersonRow[],
  machines: MachineRow[],
  photos: Array<{ file: string, media_type: string }>
}

201: { id: number }   // ID of created report
409: { error: "Submission denied: range overlaps existing report…" }
```

### `POST /api/reports/upload`

Upload a photo/video. Returns the public Supabase Storage URL.

```
Body: multipart/form-data with field "file"
200:  { url: string }
```

---

## Employees

### `GET /api/employees`

All employees from `surveycollection_employee`, ordered by name.

```
200: Employee[]
```

**Employee object:**
```ts
{
  id: number
  name: string
  role: string          // Engineer | Supervisor | Operator | Labourer | Driver | etc.
  phone_number: string
  project_name: string
  section_name: string
  status: string        // Active | Inactive
  email: string
  notes: string
  user_id: number | null
}
```

### `POST /api/employees`  *(admin only)*

```
Body: { name, role, phone_number, project_name, section_name, status, email, notes }
201:  Employee
```

### `PATCH /api/employees/[id]`  *(admin only)*

```
Body: { name, role, phone_number, project_name, section_name, status, email, notes }
200:  Employee
```

### `DELETE /api/employees/[id]`  *(admin only)*

Nulls out FK references in report tables before deleting.

```
200: { ok: true }
```

---

## Equipment

### `GET /api/equipment`

All machines from `surveycollection_planningtable`, ordered by fleet number.

```
200: Machine[]
```

**Machine object:**
```ts
{
  id: number
  fleet_number: string
  machine_type: string
  machine_belonging: string       // Hitech | Subcontractor | Rented
  deployment_status: string       // in_store | deployed_to_site | in_transit_back
  health_status: string           // Operational | Breakdown | Standby
  project_name: string
  section_name: string
  assigned_to: string | null      // employee name
}
```

### `POST /api/equipment`  *(admin only)*

```
Body: { fleet_number, machine_type, machine_belonging, health_status, project_name, section_name, assigned_to }
201:  Machine
```
`deployment_status` is auto-set: `"deployed_to_site"` if `assigned_to` is provided, else `"in_store"`.

### `PATCH /api/equipment/[id]`  *(admin only)*

```
Body: same as POST
200:  Machine
```

### `POST /api/equipment/[id]/receive`  *(admin only)*

Marks a machine as received back at head office. Machine must have `deployment_status = "in_transit_back"`.

```
200: { ok: true }
409: { error: "Machine is not in transit — current status is '…'." }
```
Also logs a `"Received at head office"` entry in `surveycollection_machinestatusreport`.

---

## Projects & Sections

### `GET /api/projects`

All project names. **No auth required.**

```
200: Array<{ name: string }>
```

### `GET /api/sections`

All sections with their project name. **No auth required.**

```
200: Array<{ name: string, project_name: string }>
```

---

## Users

### `GET /api/users`  *(admin only)*

All active users from `auth_user`.

```
200: Array<{ id, username, email, is_staff, is_superuser }>
```

---

## Equipment History

### `GET /api/history`

Paginated machine status log from `surveycollection_machinestatusreport`. Page size: 30.

```
Query params:
  fleet   — filter by fleet_number
  action  — filter by deployment_state
  search  — search fleet_number, reporter_name, assigned_to, machine_type
  page    — 0-indexed

200: {
  entries: HistoryEntry[],
  total: number,
  fleets: string[],    // distinct fleet numbers for filter dropdown
  actions: string[]    // distinct deployment_state values
}
```

**HistoryEntry object:**
```ts
{
  id: number
  date_time: string          // ISO timestamp
  fleet_number: string
  machine_type: string
  machine_belonging: string
  deployment_state: string   // Deployed | Received at head office | In Transit | etc.
  machine_status: string     // health status at time of event
  breakdown_issue: string
  assigned_to: string
  reporter_name: string
  registry_item_id: number   // FK to surveycollection_planningtable.id
}
```

---

## Worker — Machines

### `GET /api/worker/machines`

Returns the machines assigned to the currently logged-in worker's project/section.

```
200: {
  machines: Machine[],
  employee: { id, name, role } | null
}
```

### `POST /api/worker/machines/update`

Worker updates deployment state of one of their assigned machines.

```
Body: { machine_id: number, deployment_state: string, breakdown_issue?: string }
200:  { ok: true }
```

---

## Supabase Tables Summary

| Table | Used by | Notes |
|---|---|---|
| `auth_user` | auth routes, users API | Django user table |
| `hitech_report_hitechreport` | reports, dashboard | Main activity reports |
| `hitech_report_hitechphoto` | report detail, dashboard | Photos & videos |
| `hitech_report_hitechemployee` | report detail, submit | Employees on a report |
| `hitech_report_hitechsupervisor` | report detail, submit | Supervisors on a report |
| `hitech_report_hitechengineer` | report detail, submit | Engineers on a report |
| `hitech_report_hitechmachine` | report detail, submit | Machines on a report |
| `surveycollection_employee` | employees API, worker | Staff profiles |
| `surveycollection_planningtable` | equipment API | Machine registry |
| `surveycollection_machinestatusreport` | history API | Machine movement log |
| `surveycollection_project` | projects API, chainage | Project list |
| `surveycollection_section` | sections API | Section list |
