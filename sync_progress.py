"""
sync_progress.py
────────────────────────────────────────────────────────────────
Uploads construction progress data to Supabase:
  1. hitech_construction_blocks   ← Construction_Summary_Blocks.csv
  2. hitech_construction_entities ← Final_Joined_Entity_Data.csv
  3. hitech_construction_boq      ← Coastal Road Quantity.xlsx

Usage:
    python sync_progress.py

Put this script in C:\\hitech-dashboard\\ alongside the data files.
Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""

import os
import math
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# ── File paths — update these if your files are in a different location ──────
BLOCKS_FILE   = "Construction_Summary_Blocks.csv"
ENTITIES_FILE = "Final_Joined_Entity_Data.csv"
BOQ_FILE      = "COASTAL ROAD - Section 1b&c_27.5km_Quantity.xlsx"

PROJECT_NAME  = "Coastal Road"
BATCH_SIZE    = 500

def safe_date(val):
    """Convert date value to ISO string or None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    try:
        return pd.to_datetime(val).strftime("%Y-%m-%d")
    except Exception:
        return None

def safe_float(val):
    """Convert to float or None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    try:
        return float(val)
    except Exception:
        return None

def safe_int(val):
    """Convert to int or None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    try:
        return int(val)
    except Exception:
        return None

def safe_str(val):
    """Convert to string or None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    return str(val).strip() or None

def insert_batches(sb, table: str, rows: list):
    """Insert rows in batches, print progress."""
    total = len(rows)
    print(f"  Inserting {total} rows into {table}...")
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        sb.table(table).insert(batch).execute()
        print(f"    {min(i + BATCH_SIZE, total)}/{total}")
    print(f"  ✓ Done — {total} rows inserted")

def sync_blocks(sb):
    print("\n── Construction Blocks ──────────────────────────────────")
    df = pd.read_csv(BLOCKS_FILE, encoding="latin1")
    print(f"  Loaded {len(df)} rows | Columns: {list(df.columns)}")

    # Clear existing
    sb.table("hitech_construction_blocks").delete().eq("project_name", PROJECT_NAME).execute()
    print("  Cleared existing rows")

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "entity_name":           safe_str(r.get("Entity_Name")),
            "side":                  safe_str(r.get("Side")),
            "date_started":          safe_date(r.get("Date_Started")),
            "date_completed":        safe_date(r.get("Date_Completed")),
            "block_start":           safe_int(r.get("Block_Start")),
            "block_end":             safe_int(r.get("Block_End")),
            "total_segments":        safe_int(r.get("Total_Segments")),
            "completion_global_id":  safe_str(r.get("Completion_Global_ID")),
            "planned_start":         safe_date(r.get("Planned_Start")),
            "project_name":          PROJECT_NAME,
        })

    insert_batches(sb, "hitech_construction_blocks", rows)

def sync_entities(sb):
    print("\n── Construction Entities ────────────────────────────────")
    df = pd.read_csv(ENTITIES_FILE, encoding="latin1")
    print(f"  Loaded {len(df)} rows | Columns: {list(df.columns)}")

    # Clear existing
    sb.table("hitech_construction_entities").delete().eq("project_name", PROJECT_NAME).execute()
    print("  Cleared existing rows")

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "label":          safe_int(r.get("label")),
            "side":           safe_str(r.get("Side")),
            "status":         safe_str(r.get("Status")),
            "date_started":   safe_date(r.get("Date_Started")),
            "date_completed": safe_date(r.get("Date_Completed")),
            "planned_date":   safe_date(r.get("planned_date")),
            "global_id":      safe_str(r.get("Global_ID")),
            "entity_name":    safe_str(r.get("Entity_Name")),
            "project_name":   PROJECT_NAME,
        })

    insert_batches(sb, "hitech_construction_entities", rows)

def sync_boq(sb):
    print("\n── BOQ (Bill of Quantities) ─────────────────────────────")
    df = pd.read_excel(BOQ_FILE, sheet_name="Sheet1", header=0)
    print(f"  Loaded {len(df)} rows | Columns: {list(df.columns)}")

    # Clear existing
    sb.table("hitech_construction_boq").delete().eq("project_name", PROJECT_NAME).execute()
    print("  Cleared existing rows")

    rows = []
    for _, r in df.iterrows():
        desc = safe_str(r.get("Description"))
        if not desc:
            continue  # skip empty rows
        rows.append({
            "description":       desc,
            "activity_category": safe_str(r.get("Activity category")),
            "activity_type":     safe_str(r.get("Activity type")),
            "qty":               safe_float(r.get("Qty")),
            "unit":              safe_str(r.get("Unit")),
            "rate":              safe_float(r.get("Rate")),
            "amount":            safe_float(r.get("AMOUNT")),
            "project_name":      PROJECT_NAME,
        })

    insert_batches(sb, "hitech_construction_boq", rows)

def main():
    print("=" * 60)
    print("  Hitech Construction Progress — Supabase Sync")
    print("=" * 60)

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("\n  ✓ Connected to Supabase")

    # Check which files exist
    missing = []
    for f in [BLOCKS_FILE, ENTITIES_FILE, BOQ_FILE]:
        if not os.path.exists(f):
            missing.append(f)

    if missing:
        print("\n  ⚠ Missing files:")
        for f in missing:
            print(f"    - {f}")
        print("\n  Please copy these files to C:\\hitech-dashboard\\ and run again.")
        return

    sync_blocks(sb)
    sync_entities(sb)
    sync_boq(sb)

    print("\n" + "=" * 60)
    print("  ✓ All data synced successfully!")
    print("=" * 60)

if __name__ == "__main__":
    main()
