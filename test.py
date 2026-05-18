from dotenv import load_dotenv
from supabase import create_client
import os

load_dotenv(".env.local")
sb = create_client(os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# Try all likely table names
candidates = [
    # hitech_report prefix
    "hitech_report_hitechreport",
    "hitech_report_hitechphoto",
    "hitech_report_hitechemployee",
    "hitech_report_hitechsupervisor",
    "hitech_report_hitechengineer",
    "hitech_report_hitechmachine",
    "hitech_report_hitechstation",
    "hitech_report_hitechchainage",
    "hitech_report_hitechchainage",
    "hitech_report_chainage",
    "hitech_report_station",
    # surveycollection prefix
    "surveycollection_employee",
    "surveycollection_planningtable",
    "surveycollection_machinestatusreport",
    "surveycollection_project",
    "surveycollection_section",
    "surveycollection_chainage",
    "surveycollection_station",
    "surveycollection_chainagepoint",
    "surveycollection_roadstation",
    # auth
    "auth_user",
]

print(f"{'TABLE NAME':<45} {'ROWS':<8} COLUMNS")
print("-" * 100)

found = []
for name in candidates:
    try:
        res = sb.table(name).select("*").limit(1).execute()
        cols = list(res.data[0].keys()) if res.data else []
        # get count
        try:
            cnt = sb.table(name).select("id").range(0, 999).execute()
            row_count = str(len(cnt.data)) + "+"
        except:
            row_count = "?"
        print(f"{name:<45} {row_count:<8} {cols}")
        found.append(name)
    except Exception as e:
        pass

print()
print(f"Found {len(found)} tables.")