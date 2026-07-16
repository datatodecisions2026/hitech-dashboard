"""
sync_ogun.py — append-only sync with retry logic
Reads Excel, checks DB row count, inserts only new rows.
Safe to run multiple times — will never duplicate existing data.
"""

import os, math, time
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

FILE_PATH  = "Ogun - Total entities.xlsx"
TABLE_NAME = "hitech_ogun_entities"
BATCH_SIZE = 500
MAX_RETRY  = 5
RETRY_WAIT = 3

def safe_float(v):
    if v is None: return None
    try:
        f = float(v); return None if math.isnan(f) else f
    except: return None

def safe_int(v):
    if v is None: return None
    try:
        f = float(v); return None if math.isnan(f) else int(f)
    except: return None

def safe_str(v):
    if v is None: return None
    s = str(v).strip()
    return s if s and s.lower() not in ('nan', 'none', '') else None

def insert_with_retry(batch, batch_num, total_batches):
    for attempt in range(1, MAX_RETRY + 1):
        try:
            client = create_client(SUPABASE_URL, SUPABASE_KEY)
            client.table(TABLE_NAME).insert(batch).execute()
            return True
        except Exception as e:
            if attempt < MAX_RETRY:
                print(f"    ⚠ Batch {batch_num}/{total_batches} attempt {attempt} failed: {str(e)[:80]}")
                print(f"    Retrying in {RETRY_WAIT * attempt}s...")
                time.sleep(RETRY_WAIT * attempt)
            else:
                print(f"    ✗ Batch {batch_num}/{total_batches} failed after {MAX_RETRY} attempts")
                raise
    return False

def main():
    print("=" * 60)
    print("  Hitech — Ogun Section 4A Sync (append-only)")
    print("  New rows will be inserted. Existing rows untouched.")
    print("=" * 60)

    if not os.path.exists(FILE_PATH):
        print(f"\n  ✗ File not found: {FILE_PATH}")
        print("  Make sure the Excel file is in C:\\hitech-dashboard\\")
        return

    # ── Load Excel ────────────────────────────────────────────
    print(f"\n  Loading {FILE_PATH}...")
    df = pd.read_excel(FILE_PATH, sheet_name="Sheet1")
    excel_total = len(df)
    print(f"  Excel rows:  {excel_total:,}")

    # ── Check DB count ────────────────────────────────────────
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    try:
        # Try exact count first
        result   = sb.table(TABLE_NAME).select("id", count="exact", head=True).execute()
        db_total = result.count or 0
        # If count returns 0 but we suspect data exists, verify with a row fetch
        if db_total == 0:
            check = sb.table(TABLE_NAME).select("id").order("id", desc=True).limit(1).execute()
            if check.data:
                # Table has data — get max id as approximate count
                db_total = check.data[0]["id"]
                print(f"  ⚠ Count query returned 0 but table has data. Using max id: {db_total:,}")
    except Exception as e:
        print(f"  ⚠ Count query failed: {e}")
        # Fallback: get max id
        check    = sb.table(TABLE_NAME).select("id").order("id", desc=True).limit(1).execute()
        db_total = check.data[0]["id"] if check.data else 0
    print(f"  DB rows:     {db_total:,}")

    if db_total >= excel_total:
        print(f"\n  ✓ Nothing to do — DB already has {db_total:,} rows.")
        return

    new_count = excel_total - db_total
    print(f"  New rows:    {new_count:,} (rows {db_total + 1} to {excel_total})")

    # ── Build only new rows (skip rows already in DB) ─────────
    df_new = df.iloc[db_total:]
    print(f"\n  Building {new_count:,} rows...")
    rows = []
    for _, r in df_new.iterrows():
        rows.append({
            "fid":          safe_int  (r.get("FID")),
            "station":      safe_str  (r.get("Station")),
            "station_num":  safe_float(r.get("Station_1")),
            "project_name": safe_str  (r.get("Project_na")) or "Coastal Road",
            "section_name": safe_str  (r.get("Section_na")) or "Section 4A (Ogun)",
            "side":         safe_str  (r.get("side")),
            "pipe_elev":    safe_float(r.get("PipeElev")),
            "x":            safe_float(r.get("x")),
            "y":            safe_float(r.get("y")),
            "lon":          safe_float(r.get("lon")),
            "lat":          safe_float(r.get("lat")),
            "item":         safe_str  (r.get("Item")),
        })

    # ── Insert in batches ─────────────────────────────────────
    total         = len(rows)
    total_batches = math.ceil(total / BATCH_SIZE)
    print(f"  Inserting in {total_batches} batches of {BATCH_SIZE}...\n")

    start = time.time()
    for i in range(0, total, BATCH_SIZE):
        batch     = rows[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        inserted  = min(i + BATCH_SIZE, total)
        pct       = round(inserted / total * 100)

        insert_with_retry(batch, batch_num, total_batches)

        elapsed = time.time() - start
        rate    = inserted / elapsed if elapsed > 0 else 0
        eta     = (total - inserted) / rate if rate > 0 else 0
        print(f"  [{pct:3d}%] {inserted:>7,}/{total:,}  |  {rate:.0f} rows/s  |  ETA {eta/60:.1f} min")

    elapsed = time.time() - start
    print(f"\n  ✓ Done! {total:,} new rows inserted in {elapsed/60:.1f} minutes")
    print(f"  DB now has {db_total + total:,} total rows")
    print("=" * 60)

if __name__ == "__main__":
    main()