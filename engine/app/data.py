"""Dataset loading. The dataset and change files are always read from JSON in the
starter-pack format; nothing from them is hard-coded."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_DATASET = Path(
    os.environ.get("DATASET_PATH", Path(__file__).resolve().parents[2] / "data" / "cit_public.json")
)

REQUIRED_KEYS = (
    "dataset_id", "calendar", "priority_order", "role_category_cap", "rooms",
    "room_unavailability", "faculty", "student_groups", "courses", "sessions",
    "booking_requests", "cancellations", "exams",
)


class DatasetError(ValueError):
    pass


def validate_shape(data: dict[str, Any]) -> None:
    missing = [k for k in REQUIRED_KEYS if k not in data]
    if missing:
        raise DatasetError(f"Dataset is missing keys: {', '.join(missing)}")


def load_dataset(path: Path | str = DEFAULT_DATASET) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    validate_shape(data)
    return data


def summarize(data: dict[str, Any]) -> dict[str, Any]:
    sessions = data["sessions"]
    return {
        "dataset_id": data["dataset_id"],
        "institute": data.get("institute"),
        "rooms": len(data["rooms"]),
        "faculty": len(data["faculty"]),
        "student_groups": len(data["student_groups"]),
        "courses": len(data["courses"]),
        "sessions": len(sessions),
        "teaching_hours": sum(s["duration"] for s in sessions),
        "booking_requests": len(data["booking_requests"]),
        "cancelled_requests": len(data["cancellations"]),
        "exams": len(data["exams"]),
    }
