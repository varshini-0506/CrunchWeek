"""End-to-end flow through the API, checked by the official validator."""
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app

ROOT = Path(__file__).resolve().parents[2]
client = TestClient(app)


def H(u):
    return {"X-User": u}


def wait_job():
    while main.STATE.job.get("status") == "running":
        time.sleep(0.5)
    return main.STATE.job


@pytest.fixture(scope="module", autouse=True)
def seeded():
    main.seed_or_generate("test")
    yield


def test_generated_schedule_passes_validator():
    rep = client.get("/validate").json()["schedule"]
    assert rep["hard_violation_count"] == 0
    assert rep["exam_soft_penalty"] == 0
    assert rep["bookings"]["priority_inversions"] == []


def test_booking_flow_and_no_self_approval():
    p = client.post("/bookings/parse", json={"text": "kal shaam 6 se 8 baje robotics demo, 120 log, projector chahiye",
                                             "today": "TUE"}, headers=H("club.robotics")).json()
    assert p["windows"] == [{"day": "WED", "from_period": 10, "to_period": 11}]
    draft = {k: p[k] for k in ("title", "attendance", "duration_periods", "windows", "room_types", "needs",
                               "requested_room", "mandatory_for_groups", "requested_category")}
    r = client.post("/bookings", json=draft, headers=H("club.robotics")).json()
    assert client.post(f"/bookings/{r['id']}/approve", headers=H("club.robotics")).status_code == 403
    assert client.post(f"/bookings/{r['id']}/approve", headers=H("F01")).status_code == 403
    ok = client.post(f"/bookings/{r['id']}/approve", headers=H("coord.cse"))
    assert ok.status_code == 200
    # still valid for the judges' validator (new requests are not part of the dataset export)
    assert client.get("/validate").json()["schedule"]["hard_violation_count"] == 0


def test_priority_claim_does_not_raise_priority():
    draft = {"title": "URGENT VC orders", "attendance": 50, "duration_periods": 1,
             "windows": [{"day": "MON", "from_period": 10, "to_period": 10}], "requested_category": "institute_event"}
    r = client.post("/bookings/preview", json=draft, headers=H("club.robotics")).json()
    assert r["effective_category"] == "club_event"


def test_disruption_repair_needs_admin_and_moves_few_sessions():
    dis = json.loads((ROOT / "data" / "samples" / "sample_disruption.json").read_text())
    assert client.post("/changes/preview", json={"changes": dis["changes"]}, headers=H("club.robotics")).status_code == 403
    client.post("/changes/preview", json={"changes": dis["changes"]}, headers=H("admin"))
    job = wait_job()
    assert job["status"] == "done" and job["result"]["status"] == "proposed"
    cid = job["result"]["id"]
    assert client.post(f"/changes/{cid}/approve", headers=H("coord.cse")).status_code == 403
    applied = client.post(f"/changes/{cid}/approve", headers=H("admin")).json()
    # Fewest moves: exactly the classes whose old room or teacher is now unavailable
    proof = {i["id"]: i for i in client.get("/proofs").json()["items"]}["repair"]
    assert applied["diff"]["sessions_moved"] == proof["best_possible"] == proof["achieved"]
    rep = client.get("/validate").json()["schedule_after"]
    assert rep["hard_violation_count"] == 0
    assert rep["stability"]["sessions_moved"] == applied["diff"]["sessions_moved"]


def test_faculty_change_parser():
    r = client.post("/changes/parse", json={"text": "I can't take Tuesday mornings"}, headers=H("F01")).json()
    assert r["changes"][0]["days"] == ["TUE"] and r["changes"][0]["periods"] == [1, 2, 3, 4, 5]
