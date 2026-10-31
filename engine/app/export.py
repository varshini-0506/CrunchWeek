"""Builds schedule.json in the exact format the official validator reads."""
from __future__ import annotations

from typing import Any

from .checker import Assign

TEAM_NAME = "CrunchWeek"


def build_schedule(dataset_id: str, assign: Assign, fest_week: dict | None = None,
                   exams: list[dict] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "team": TEAM_NAME,
        "dataset_id": dataset_id,
        "sessions": [
            {"session_id": sid, "day": d, "start_period": p, "room_id": r}
            for sid, (d, p, r) in sorted(assign.items())
        ],
    }
    if fest_week is not None:
        out["fest_week"] = fest_week
    if exams is not None:
        out["exams"] = exams
    return out
