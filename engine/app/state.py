"""Working state of the engine: dataset, active timetable, exams, bookings, pending
changes and the audit log. Snapshotted to a JSON file so a restart keeps it."""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .checker import Assign
from .data import load_dataset
from .model import Ctx

STATE_FILE = Path(os.environ.get("STATE_FILE", Path(__file__).resolve().parents[1] / ".state.json"))
LOCK = threading.RLock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class State:
    def __init__(self) -> None:
        self.job: dict[str, Any] = {"status": "idle"}
        self.reset(load_dataset())

    # ------------------------------------------------------------------ lifecycle
    def reset(self, data: dict[str, Any]) -> None:
        self.original = data                 # dataset as loaded
        self.data = json.loads(json.dumps(data))  # dataset with applied changes
        self.ctx = Ctx(self.data)
        self.assign: Assign = {}
        self.baseline: Assign = {}           # timetable before the last applied change
        self.exams: list[dict] = []
        self.exam_penalty = 0
        self.fest: dict[str, Any] = {"bookings": [], "session_overrides": []}
        self.booking_explain: dict[str, Any] = {}
        self.booking_score = (0.0, 0)
        self.locked: dict[str, dict] = {}    # booking decisions confirmed by an approver
        self.confirmations: dict[str, dict] = {}
        self.requesters: dict[str, str] = {}  # request id -> username that submitted it
        self.pending_changes: dict[str, dict] = {}
        self.applied_changes: list[dict] = []
        self.audit: list[dict] = []
        self.solve_info: dict[str, Any] = {}
        self.pending_bookings: dict[str, dict] = {}   # new requests waiting for an approver
        self.closed_bookings: list[dict] = []          # new requests an approver turned down
        self.first_schedule: dict[str, Any] | None = None  # schedule.json before any change
        self.original_request_ids: list[str] = [r["id"] for r in data["booking_requests"]]
        self.seq = 0

    def set_data(self, data: dict[str, Any]) -> None:
        self.data = data
        self.ctx = Ctx(data)

    def next_id(self, prefix: str) -> str:
        self.seq += 1
        return f"{prefix}-{self.seq:03d}"

    def log(self, actor: str | None, action: str, detail: str, **extra: Any) -> None:
        self.audit.insert(0, {"at": now(), "actor": actor or "system", "action": action, "detail": detail, **extra})
        del self.audit[300:]

    # ------------------------------------------------------------------ persistence
    def save(self, path: Path | None = None) -> None:
        snap = {k: getattr(self, k) for k in (
            "original", "data", "baseline", "exams", "exam_penalty", "fest", "booking_explain", "booking_score",
            "locked", "confirmations", "requesters", "pending_changes", "applied_changes", "audit", "solve_info", "seq",
            "pending_bookings", "closed_bookings", "first_schedule", "original_request_ids")}
        snap["assign"] = {k: list(v) for k, v in self.assign.items()}
        snap["baseline"] = {k: list(v) for k, v in self.baseline.items()}
        for c in snap["pending_changes"].values():
            if "assign" in c:
                c["assign"] = {k: list(v) for k, v in c["assign"].items()}
        try:
            target = path or STATE_FILE
            tmp = target.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap))
            tmp.replace(target)
        except OSError:
            pass

    def load(self, path: Path | None = None) -> bool:
        src = path or STATE_FILE
        if not src.exists():
            return False
        try:
            snap = json.loads(src.read_text())
        except (OSError, ValueError):
            return False
        for k, v in snap.items():
            setattr(self, k, v)
        self.assign = {k: tuple(v) for k, v in snap.get("assign", {}).items()}
        self.baseline = {k: tuple(v) for k, v in snap.get("baseline", {}).items()}
        for c in self.pending_changes.values():
            if "assign" in c:
                c["assign"] = {k: tuple(v) for k, v in c["assign"].items()}
        self.booking_score = tuple(self.booking_score)
        self.ctx = Ctx(self.data)
        return True


SEED_FILE = Path(os.environ.get("SEED_FILE", Path(__file__).resolve().parents[1] / "seed_state.json"))

STATE = State()
STATE.load()
