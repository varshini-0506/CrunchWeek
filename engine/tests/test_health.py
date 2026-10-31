from fastapi.testclient import TestClient

from app.data import load_dataset, summarize
from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_summary_matches_problem_statement():
    assert client.get("/meta").status_code == 200
    s = summarize(load_dataset())
    assert s["rooms"] == 27
    assert s["faculty"] == 40
    assert s["student_groups"] == 14
    assert s["courses"] == 62
    assert s["sessions"] == 189
    assert s["teaching_hours"] == 243
    assert s["booking_requests"] == 25
    assert s["exams"] == 41


def test_dataset_upload_needs_admin_and_valid_shape():
    assert client.post("/dataset", json={"dataset_id": "x"}).status_code == 403
    r = client.post("/dataset", json={"dataset_id": "x"}, headers={"X-User": "admin"})
    assert r.status_code == 422
