"""
sync_to_supabase.py
────────────────────────────────────────────────────────────────────
Pulls data from Google Drive Excel files, applies all Power BI
M-code transformations, then inserts into Supabase tables:

  • hitech_report_hitechreport      ← Main_Survey_Data (new + old)
  • hitech_report_hitechphoto       ← PowerBI_Photo_Links (linked via globalid)
  • hitech_report_hitechemployee    ← name sheet
  • hitech_report_hitechsupervisor  ← site_supervisor_gr sheet
  • hitech_report_hitechengineer    ← site_engineers sheet
  • hitech_report_hitechmachine     ← machine_1 sheet

SAFE: Does NOT delete or modify any existing rows.

Requirements:
    pip install pandas openpyxl requests python-dotenv
    pip install supabase==2.10.0

Usage:
    cd C:\hitech-dashboard
    python sync_to_supabase.py
"""

import io
import os
import datetime
import requests
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(".env.local")

SUPABASE_URL  = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

NEW_REPORT_ID = "1w6fUkiZ_8vtPNoa1EXfk_NAmjjCrXO3V"
OLD_REPORT_ID = "1M1L5xk3Yv0ecMhtWO2RBfKnvS1LhNKkb"

BATCH_SIZE = 200


# ─── M-code transformation tables ────────────────────────────────────────────

ACTIVITY_TYPE_REPLACEMENTS = [
    ("Kerb installation",                         "Kerb"),
    ("Installation CRCP",                         "CRCP"),
    ("installation of jersey separation barrier", "Jersey barrier"),
    ("Installation stoneBase",                    "Stone Base installation"),
    ("Installation subBase",                      "Subbase installation"),
    ("Clearing elevations",                       "Clearing"),
    ("Cut elevations",                            "Cut"),
    ("Fill elevations",                           "Fill"),
    ("Dredging elevations",                       "Dredging"),
    ("CPT test test",                             "CPT test"),
    ("CPT",                                       "CPT test"),
    ("Set out + survey boreholes",                "Set out - survey boreholes"),
    ("Ducts for electrical cables",               "Ducts"),
    ("apply_asphalte_concrete",                   "Concrete work"),
    ("compact_asphalte_concrete",                 "Concrete work"),
    ("Barrier base",                              "Jersey barrier"),
    ("sidewalks_shoulders_construct",             "Walkways"),
    ("Excavate for pipe 600mm",                   "Pipe 600mm"),
    ("Excavate for culvert 150*150",              "Box culvert"),
    ("Blinding culvert 150*150",                  "Box culvert"),
    ("Base culvert 150*150",                      "Box culvert"),
    ("Excavate for culvert 200*200",              "Box culvert"),
    ("Blinding for culvert 200*200",              "Box culvert"),
    ("Base for culvert 200*200",                  "Box culvert"),
    ("culvert_crossdrainage",                     "Box culvert"),
    ("complete_drainage",                         "Box culvert"),
    ("Blinding for discharge 1200mm",             "Discharge"),
    ("Blinding for discharge 900mm",              "Discharge"),
    ("Excavate for discharge 1200mm",             "Discharge"),
    ("Excavate for discharge 900mm",              "Discharge"),
    ("Blinding for pipe 600mm",                   "Pipe 600mm"),
    ("entrance_slab",                             "Manholes"),
    ("excavate_drainage",                         "Box culvert"),
    ("line_drainage",                             "Box culvert"),
    ("Pipe 600mmm",                               "Pipe 600mm"),
    ("Pipe 600m",                                 "Pipe 600mm"),
    ("compact_subbase",                           "Subbase installation"),
    ("Installation soil cement",                  "Stone Base cement stabilization"),
    ("soil cement_stabilization",                 "Stone Base cement stabilization"),
    ("soil_cement_stabilization",                 "Stone Base cement stabilization"),
    ("clearing_obstacles",                        "Clearing"),
    ("lay_layer_basecourse",                      "Subbase installation"),
    ("compact_basecourse",                        "Subbase installation"),
    ("grade_prepare_road",                        "Clearing"),
    ("lay_layer_subbase",                         "Subbase installation"),
    ("compaction_subgrade",                       "Subbase installation"),
    ("excavate_road_width",                       "Subbase installation"),
    ("excavate_unsuitable_materials",             "Cut unsuitable materials"),
    ("Top of subBase",                            "Setting out top of subBase"),
    ("Top of stoneBase",                          "Setting out top of stoneBase"),
    ("Toe",                                       "Setting out toe"),
    ("Road requirements boundary",                "Setting out ETW"),
    ("create_road_design_plans",                  "Setting out ETW"),
    ("conduct_a_survey",                          "Setting out ETW"),
    ("Top of CRCP",                               "Setting out top slop"),
]

CATEGORY_REPLACEMENTS = [
    ("ducts",                    "Drainage Channels - Utilities"),
    ("sidewalks_shoulders",      "Construction"),
    ("quality_control",          "Quality Control and Inspection"),
    ("road_markings_signage",    "Road Markings and Signage"),
    ("soil cement",              "Earthworks"),
    ("setting_out_points",       "Surveying and Geospatial Services"),
    ("survey_and_design",        "Surveying and Geospatial Services"),
    ("clearing_grading",         "Earthworks"),
    ("subbase_installation",     "Earthworks"),
    ("base_course_installation", "Earthworks"),
    ("soil_cement",              "Earthworks"),
    ("excavation_earthwork",     "Earthworks"),
    ("paving",                   "Construction"),
    ("vegetation_landscaping",   "Vegetation and Landscaping"),
    ("drainage_channels",        "Drainage Channels - Utilities"),
    ("Pavement layers",          "Construction"),
]

EARTHWORKS_TYPES = {
    "Subbase installation", "Stone Base installation",
    "Installation soil cement", "Stone Base cement stabilization",
    "Fill", "Cut", "Dredging", "Clearing",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def gdrive_url(file_id):
    return f"https://drive.google.com/uc?export=download&id={file_id}"


def fetch_excel_file(file_id: str, label: str) -> bytes:
    print(f"  Downloading {label} ({file_id[:8]}…)")
    session = requests.Session()

    # First request — may get a confirmation page for large files
    r = session.get(gdrive_url(file_id), timeout=120)
    r.raise_for_status()

    # Check if Google returned a virus-scan warning page instead of the file
    if b"confirm=" in r.content or b"download_warning" in r.content:
        print("  Large file — confirming download…")
        # Extract confirm token
        import re
        match = re.search(rb"confirm=([0-9A-Za-z_\-]+)", r.content)
        if match:
            token = match.group(1).decode()
            url = gdrive_url(file_id) + f"&confirm={token}"
        else:
            # Newer Drive uses a different confirmation URL
            url = f"https://drive.google.com/uc?export=download&id={file_id}&confirm=t"
        r = session.get(url, timeout=180)
        r.raise_for_status()

    # Verify we got an actual Excel file
    if r.content[:2] not in (b'PK', b'\xd0\xcf'):
        # Try the direct export URL as fallback
        print("  Retrying with direct export URL…")
        url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
        r = session.get(url, timeout=180)
        r.raise_for_status()

    print(f"  ✓ Downloaded {len(r.content) / 1024 / 1024:.1f} MB")
    return r.content


def read_sheet(content: bytes, sheet_name: str) -> pd.DataFrame:
    return pd.read_excel(io.BytesIO(content), sheet_name=sheet_name, header=0)


def apply_replacements(series, pairs):
    for old, new in pairs:
        series = series.str.replace(old, new, regex=False)
    return series


def epoch_ms_to_date_str(series):
    converted = pd.to_datetime(series, unit="ms", utc=True, errors="coerce").dt.date
    return converted.astype(str).replace("NaT", "2024-01-01")


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, float) and v != v:
        return None
    s = str(v).strip()
    if s in ("", "nan", "NaT", "None", "null"):
        return None
    return v


def clean_row(row: dict) -> dict:
    return {k: clean_val(v) for k, v in row.items()}


def insert_batched(supabase: Client, table: str, rows: list) -> list:
    """Insert rows in batches. Returns all inserted rows (with Supabase-assigned id)."""
    total = len(rows)
    if total == 0:
        print(f"  No rows for {table} — skipping.")
        return []
    inserted = []
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        result = supabase.table(table).insert(batch).execute()
        if result.data:
            inserted.extend(result.data)
        print(f"    {min(i + BATCH_SIZE, total)}/{total} inserted into {table}…")
    print(f"  ✓ {total} rows → {table}")
    return inserted


# ─── Load + transform ─────────────────────────────────────────────────────────

def load_combined(new_content: bytes, old_content: bytes) -> pd.DataFrame:
    print("\n[LOAD 1/6] Main_Survey_Data (new + old)…")
    new_df = read_sheet(new_content, "Main_Survey_Data")
    old_df = read_sheet(old_content, "Main_Survey_Data")
    df = pd.concat([new_df, old_df], ignore_index=True)
    print(f"  Raw rows: {len(df)}")

    # Date conversion
    df["date_of_activity"] = epoch_ms_to_date_str(df["date_of_activity"])

    # Text columns
    for col in ["activity_type", "activity_category", "reporter_name",
                "project_name", "comment_activity", "weather", "activity_status"]:
        if col in df.columns:
            df[col] = df[col].fillna("").astype(str)

    df["project_section"] = df["project_section"].fillna("").astype(str) \
        if "project_section" in df.columns else ""
    df["activity_status"] = df["activity_status"].replace("", "Pending")
    df["globalid"] = df["globalid"].fillna("").astype(str)

    # M-code replacements
    df["activity_type"] = apply_replacements(df["activity_type"], ACTIVITY_TYPE_REPLACEMENTS)
    df["activity_category"] = df.apply(
        lambda r: "Earthworks" if r["activity_type"] in EARTHWORKS_TYPES
                  else r["activity_category"],
        axis=1,
    )
    df["activity_category"] = apply_replacements(df["activity_category"], CATEGORY_REPLACEMENTS)

    # GPS
    for col in ["start_chainage_lat", "start_chainage_long",
                "end_chainage_lat",   "end_chainage_long"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    print(f"  Transformed: {len(df)} rows")
    return df


def load_images(df: pd.DataFrame) -> pd.DataFrame:
    """
    Returns a DataFrame with columns:
      file, media_type, uploaded_at, globalid
    globalid is used later to look up the report_id after insert.
    """
    print("\n[LOAD 2/6] Photo links…")
    if "PowerBI_Photo_Links" not in df.columns:
        print("  No photo links found.")
        return pd.DataFrame()

    img = df[["globalid", "PowerBI_Photo_Links", "date_of_activity"]].dropna(
        subset=["PowerBI_Photo_Links"]
    )
    img = img.assign(
        PowerBI_Photo_Links=img["PowerBI_Photo_Links"].str.split(";")
    ).explode("PowerBI_Photo_Links")
    img["PowerBI_Photo_Links"] = img["PowerBI_Photo_Links"].str.strip()
    img = img[img["PowerBI_Photo_Links"] != ""]

    img["file"] = (
        img["PowerBI_Photo_Links"]
        .str.replace("uc?export=view&id=", "thumbnail?id=", regex=False)
        + "&sz=w1000"
    )
    img["media_type"]  = "image"
    img["uploaded_at"] = img["date_of_activity"].fillna("2024-01-01")

    img = img[["globalid", "file", "media_type", "uploaded_at"]].drop_duplicates(
        subset=["file"]
    )
    print(f"  Photos: {len(img)}")
    return img


def load_sheet(content: bytes, sheet_name: str, label: str) -> pd.DataFrame:
    print(f"\n[LOAD] {label} ({sheet_name})…")
    df = read_sheet(content, sheet_name)
    df["parentglobalid"] = df["parentglobalid"].fillna("").astype(str)
    print(f"  Rows: {len(df)}")
    return df


# ─── Supabase sync ────────────────────────────────────────────────────────────

def sync_reports(supabase: Client, df: pd.DataFrame) -> dict:
    """
    Insert all reports.
    Returns { excel_globalid → supabase_report_id } map for child tables.
    """
    print("\n[SYNC 1/6] Reports → hitech_report_hitechreport…")

    rows      = []
    globalids = []

    for _, r in df.iterrows():
        date_val = str(r.get("date_of_activity", "2024-01-01"))
        if not date_val or date_val in ("nan", "NaT", "None", ""):
            date_val = "2024-01-01"

        row = clean_row({
            "date_of_activity":    date_val,
            "submitted_at":        date_val,
            "reporter_name":       r.get("reporter_name", ""),
            "project_name":        r.get("project_name", ""),
            "section_name":        r.get("project_section", ""),
            "activity_category":   r.get("activity_category", ""),
            "activity_type":       r.get("activity_type", ""),
            "activity_status":     r.get("activity_status", "Pending") or "Pending",
            "comment_activity":    r.get("comment_activity", ""),
            "weather":             r.get("weather", ""),
            "start_chainage_lat":  r.get("start_chainage_lat"),
            "start_chainage_long": r.get("start_chainage_long"),
            "end_chainage_lat":    r.get("end_chainage_lat"),
            "end_chainage_long":   r.get("end_chainage_long"),
        })
        if not row.get("submitted_at"):
            row["submitted_at"] = "2024-01-01"

        rows.append(row)
        globalids.append(str(r.get("globalid", "")))

    inserted = insert_batched(supabase, "hitech_report_hitechreport", rows)

    # Build globalid → supabase id map
    globalid_map = {}
    for i, record in enumerate(inserted):
        if i < len(globalids) and globalids[i]:
            globalid_map[globalids[i]] = record["id"]

    print(f"  Mapped {len(globalid_map)} globalids → report ids")
    return globalid_map


def sync_photos(supabase: Client, img_df: pd.DataFrame, globalid_map: dict):
    print("\n[SYNC 2/6] Photos → hitech_report_hitechphoto…")
    if img_df.empty:
        print("  No photos.")
        return

    rows    = []
    skipped = 0
    for _, r in img_df.iterrows():
        gid       = str(r.get("globalid", "")).strip()
        report_id = globalid_map.get(gid)
        if not report_id:
            skipped += 1
            continue
        row = clean_row({
            "file":        r.get("file", ""),
            "media_type":  r.get("media_type", "image"),
            "uploaded_at": r.get("uploaded_at", "2024-01-01"),
            "report_id":   report_id,
        })
        rows.append(row)

    print(f"  Matched: {len(rows)} | Skipped (no parent): {skipped}")
    insert_batched(supabase, "hitech_report_hitechphoto", rows)


def sync_employees(supabase: Client, df: pd.DataFrame, globalid_map: dict):
    print("\n[SYNC 3/6] Employees → hitech_report_hitechemployee…")
    rows    = []
    skipped = 0
    for _, r in df.iterrows():
        report_id = globalid_map.get(str(r.get("parentglobalid", "")).strip())
        if not report_id:
            skipped += 1
            continue
        rows.append(clean_row({
            "employee_name":         r.get("fullname_1", ""),
            "employee_role":         r.get("employee_role_1", ""),
            "employee_missing_name": r.get("employees_missing", ""),
            "report_id":             report_id,
        }))
    print(f"  Matched: {len(rows)} | Skipped: {skipped}")
    insert_batched(supabase, "hitech_report_hitechemployee", rows)


def sync_supervisors(supabase: Client, df: pd.DataFrame, globalid_map: dict):
    print("\n[SYNC 4/6] Supervisors → hitech_report_hitechsupervisor…")
    rows    = []
    skipped = 0
    for _, r in df.iterrows():
        report_id = globalid_map.get(str(r.get("parentglobalid", "")).strip())
        if not report_id:
            skipped += 1
            continue
        rows.append(clean_row({
            "supervisor_name":         r.get("site_supervisor", ""),
            "subcontractor_name":      r.get("site_supervisor_sub", ""),
            "party":                   r.get("employee_supervisor", ""),
            "supervisor_missing_name": None,
            "report_id":               report_id,
        }))
    print(f"  Matched: {len(rows)} | Skipped: {skipped}")
    insert_batched(supabase, "hitech_report_hitechsupervisor", rows)


def sync_engineers(supabase: Client, df: pd.DataFrame, globalid_map: dict):
    print("\n[SYNC 5/6] Engineers → hitech_report_hitechengineer…")
    rows    = []
    skipped = 0
    for _, r in df.iterrows():
        report_id = globalid_map.get(str(r.get("parentglobalid", "")).strip())
        if not report_id:
            skipped += 1
            continue
        rows.append(clean_row({
            "engineer_name":         r.get("site_engineer", ""),
            "subcontractor_name":    r.get("employee_engineer_sub", ""),
            "party":                 r.get("employee_engineer", ""),
            "engineer_missing_name": None,
            "report_id":             report_id,
        }))
    print(f"  Matched: {len(rows)} | Skipped: {skipped}")
    insert_batched(supabase, "hitech_report_hitechengineer", rows)


def sync_machines(supabase: Client, df: pd.DataFrame, globalid_map: dict):
    print("\n[SYNC 6/6] Machines → hitech_report_hitechmachine…")
    rows    = []
    skipped = 0
    for _, r in df.iterrows():
        report_id = globalid_map.get(str(r.get("parentglobalid", "")).strip())
        if not report_id:
            skipped += 1
            continue
        plate = clean_val(r.get("machn_plt_nmbr_1", "")) or ""
        rows.append(clean_row({
            "ownership":    r.get("machine_fund_sorc_1", ""),
            "machine_name": r.get("machinery_1", ""),
            "plate_number": plate,
            "driver_name":  r.get("machine_driver_1", ""),
            "fleet_number": plate or "N/A",  # NOT NULL — use plate as fallback
            "report_id":    report_id,
        }))
    print(f"  Matched: {len(rows)} | Skipped: {skipped}")
    insert_batched(supabase, "hitech_report_hitechmachine", rows)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Hitech Google Drive → Supabase Full Sync")
    print(f"  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("  Tables: reports, photos, employees, supervisors,")
    print("          engineers, machines")
    print("  NOTE: Insert only — no existing rows deleted.")
    print("=" * 60)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"\n  ✓ Connected to Supabase")

    # Download both Excel files once each
    print("\nDownloading Excel files from Google Drive…")
    new_content = fetch_excel_file(NEW_REPORT_ID, "new_report")
    old_content = fetch_excel_file(OLD_REPORT_ID, "old_report")
    print("  ✓ Both files downloaded")

    # Load all sheets
    combined    = load_combined(new_content, old_content)
    images      = load_images(combined)
    employees   = load_sheet(new_content, "name",               "Employees")
    supervisors = load_sheet(new_content, "site_supervisor_gr", "Supervisors")
    engineers   = load_sheet(new_content, "site_engineers",     "Engineers")
    machines    = load_sheet(new_content, "machine_1",          "Machines")

    # Insert reports first — get globalid → id map back
    globalid_map = sync_reports(supabase, combined)

    # Insert all child tables using the map
    sync_photos(supabase, images, globalid_map)
    sync_employees(supabase, employees, globalid_map)
    sync_supervisors(supabase, supervisors, globalid_map)
    sync_engineers(supabase, engineers, globalid_map)
    sync_machines(supabase, machines, globalid_map)

    print("\n" + "=" * 60)
    print("  ✓ Full sync complete!")
    print(f"  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("  Refresh http://localhost:3000/dashboard")
    print("=" * 60)


if __name__ == "__main__":
    main()
