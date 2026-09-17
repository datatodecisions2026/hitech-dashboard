"""
sync_road_corridors.py — one-time ingestion of the road-corridor survey
shapefiles (Calabar, Ogun, Kebbi) into the road_corridors Supabase table.

Source files (already unzipped from Downloads/shapefiles/{region}.zip):
  CALABAR_SHP / OGUN_SHP / KEBBI_SHP below — override via env vars if your
  local paths differ.

Each source file is NOT a single clean corridor line — every one of them is
hundreds of thousands to millions of tiny line fragments (median fragment is
just 2 points), almost certainly a CAD-export artifact (one continuous
alignment polyline exploded into a separate feature per vertex-to-vertex
span, with no ordering/connectivity preserved). Confirmed live before writing
this: Calabar_All.shp reports 1 "record" but that one record has 1,080,386
parts; Ogun_All.shp has 490,034 parts; Kebbi_ready.shp has 3,303,045 separate
records. See scripts/sql/add_road_corridors_infra.sql and the 2026-09-17
CLAUDE.md changelog entry for the full reasoning.

All three files use WGS_1984_Web_Mercator_Auxiliary_Sphere (EPSG:3857) per
their .prj — confirmed by reprojecting each file's bbox center and checking
it lands on the already-known region coordinates (REGION_CAMERA in
UnifiedMap.tsx): Calabar ~4.97/8.20, Ogun ~6.37/4.47, Kebbi ~11.83/4.47 —
all matched within the expected margin, so the plain closed-form Web
Mercator -> WGS84 formula below is used, no proj4/GDAL dependency needed.

One cleaning rule, applied uniformly to all three regions (not a per-region
special case): a 2-point segment longer than JUMP_ARTIFACT_M is dropped, not
ingested. Confirmed live these exist and are real artifacts, not real road
geometry — Kebbi alone has ~14 such segments ranging 20km-116km, i.e. dead-
straight lines cutting across most of the state, which is not a real single
tangent section on this road. The threshold (5km) is deliberately generous —
comfortably above any plausible real straight highway tangent (confirmed
none of Calabar/Ogun's legitimate long segments exceed ~1.8km) so it only
ever removes the clearly-anomalous jump lines, never real geometry.

Run AFTER applying scripts/sql/add_road_corridors_infra.sql — this script
only inserts rows, it has no DDL/table-creation step.
"""

import os
import math
import time
import shapefile
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

CALABAR_SHP = os.environ.get("CALABAR_SHP", r"C:\Users\Ukpoweh Gift\Downloads\shapefiles\Calabar_shapefile\Calabar_All.shp")
OGUN_SHP    = os.environ.get("OGUN_SHP",    r"C:\Users\Ukpoweh Gift\Downloads\shapefiles\Ogun_shapefile\Ogun_All.shp")
KEBBI_SHP   = os.environ.get("KEBBI_SHP",   r"C:\Users\Ukpoweh Gift\Downloads\shapefiles\Kebbi\Kebbi\Kebbi_ready.shp")

TABLE_NAME = "road_corridors"
BATCH_SIZE = 1000
MAX_RETRY = 5
RETRY_WAIT = 3
JUMP_ARTIFACT_M = 5000  # see module docstring


def webmerc_to_wgs84(x, y):
    lng = x / 20037508.34 * 180
    lat = 180 / math.pi * (2 * math.atan(math.exp(y / 20037508.34 * math.pi)) - math.pi / 2)
    return lng, lat


def seg_length(points):
    return sum(
        math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
        for i in range(len(points) - 1)
    )


def region_segments(region, path, is_multipart_single_record):
    """Yield (length_m, npoints, wgs84_points) for every real (non-artifact) segment."""
    sf = shapefile.Reader(path)
    if is_multipart_single_record:
        shp = sf.shape(0)
        all_points = shp.points
        bounds = list(shp.parts) + [len(all_points)]
        # NB: the loop variable below must NOT be named `pts` — this generator
        # expression's body re-evaluates `all_points[bounds[i]:bounds[i+1]]`
        # lazily on each pull, closing over the enclosing scope by reference.
        # An earlier version named the loop variable `pts`, which shadowed
        # this same name in the enclosing scope: after the first outer
        # iteration reassigned `pts`, every subsequent slice silently sliced
        # the *previous 2-point result* instead of the real full point list,
        # collapsing ~all of 1M+ parts down to near-nothing. Caught by a dry
        # run before the real ingestion, not assumed correct.
        raw_segments = (all_points[bounds[i]:bounds[i + 1]] for i in range(len(bounds) - 1))
    else:
        raw_segments = (shp.points for shp in sf.iterShapes())

    for seg_pts in raw_segments:
        if len(seg_pts) < 2:
            continue
        length = seg_length(seg_pts)
        if len(seg_pts) == 2 and length > JUMP_ARTIFACT_M:
            continue  # dead-straight multi-km "jump" artifact, not real geometry
        wgs84 = [webmerc_to_wgs84(x, y) for x, y in seg_pts]
        yield length, len(seg_pts), wgs84


def to_wkt(wgs84_points):
    coords = ", ".join(f"{lng} {lat}" for lng, lat in wgs84_points)
    return f"SRID=4326;LINESTRING({coords})"


def insert_batch(client, batch, region, batch_num, total_estimate):
    for attempt in range(1, MAX_RETRY + 1):
        try:
            client.table(TABLE_NAME).insert(batch).execute()
            return True
        except Exception as e:
            if attempt < MAX_RETRY:
                print(f"    [{region}] batch {batch_num} attempt {attempt} failed: {str(e)[:100]} — retrying in {RETRY_WAIT * attempt}s")
                time.sleep(RETRY_WAIT * attempt)
            else:
                print(f"    [{region}] batch {batch_num} FAILED after {MAX_RETRY} attempts: {str(e)[:200]}")
                return False


def ingest_region(client, region, path, is_multipart_single_record):
    print(f"\n=== {region} ({path}) ===")
    t0 = time.time()
    batch = []
    total_inserted = 0
    total_seen = 0
    total_dropped_artifacts = 0
    batch_num = 0

    for length, npoints, wgs84 in region_segments(region, path, is_multipart_single_record):
        total_seen += 1
        batch.append({
            "region": region,
            "geom": to_wkt(wgs84),
            "length_m": round(length, 3),
            "npoints": npoints,
        })
        if len(batch) >= BATCH_SIZE:
            batch_num += 1
            if insert_batch(client, batch, region, batch_num, None):
                total_inserted += len(batch)
            batch = []
            if batch_num % 50 == 0:
                elapsed = time.time() - t0
                print(f"    [{region}] {total_inserted} inserted so far, {elapsed:.0f}s elapsed")

    if batch:
        batch_num += 1
        if insert_batch(client, batch, region, batch_num, None):
            total_inserted += len(batch)

    print(f"  {region}: {total_inserted} inserted, {time.time() - t0:.0f}s total")
    return total_inserted


def main():
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    grand_total = 0
    grand_total += ingest_region(client, "calabar", CALABAR_SHP, True)
    grand_total += ingest_region(client, "ogun",    OGUN_SHP,    True)
    grand_total += ingest_region(client, "kebbi",   KEBBI_SHP,   False)
    print(f"\nDone. {grand_total} total segments inserted across all 3 regions.")
    print("Verify with: select * from road_corridor_summary();")


if __name__ == "__main__":
    main()
