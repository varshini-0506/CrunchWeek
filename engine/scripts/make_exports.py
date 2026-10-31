"""Generate exports/schedule.json and exports/schedule_after.json with the app's own engine,
then check both with the official validator.

    python scripts/make_exports.py            # uses the seeded timetable if present
    python scripts/make_exports.py --fresh    # solves everything from scratch
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
sys.path.insert(0, str(ENGINE))

from app import main  # noqa: E402
from app.repair import propose_repair  # noqa: E402

DATA = ROOT / "data" / "cit_public.json"
DIS = ROOT / "data" / "samples" / "sample_disruption.json"
OUT = ROOT / "exports"


def main_() -> None:
    OUT.mkdir(exist_ok=True)
    if "--fresh" in sys.argv and main.SEED_FILE.exists():
        main.SEED_FILE.unlink()
    print(main.seed_or_generate("export-script"))
    st = main.STATE
    first = main.export_current()
    (OUT / "schedule.json").write_text(json.dumps(first, indent=1))

    dis = json.loads(DIS.read_text())
    r = propose_repair(st.data, st.assign, dis, time_limit=main.REPAIR_SECONDS)
    assert r["status"] == "proposed", r
    st.baseline, st.assign = dict(st.assign), r["assign"]
    st.set_data(r["data"])
    main.redecide("export-script", "after sample disruption")
    after = main.export_current()
    (OUT / "schedule_after.json").write_text(json.dumps(after, indent=1))
    print(f"Moved {r['diff']['sessions_moved']} sessions")

    v = [sys.executable, str(ENGINE / "validator.py"), "--data", str(DATA)]
    for name, extra in (("schedule", []),
                        ("schedule_after", ["--disruption", str(DIS), "--baseline", str(OUT / "schedule.json")])):
        res = subprocess.run(v + ["--schedule", str(OUT / f"{name}.json"), *extra,
                                  "--json", str(OUT / f"validator_{name}.json")], capture_output=True, text=True)
        (OUT / f"validator_{name}.txt").write_text(res.stdout)
        print(res.stdout)


if __name__ == "__main__":
    main_()
