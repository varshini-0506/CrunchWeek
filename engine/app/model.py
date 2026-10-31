"""Shared, read-only view of a dataset: lookups and helpers used by the checker,
the solvers and the arbiter. Built from the JSON every time; nothing is hard-coded."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

LAST_TEACHING = 9
MAX_PERIOD = 13
CAT_WEIGHT = {"institute_event": 5, "guest_lecture": 4, "department_event": 3, "club_event": 2}


@dataclass
class Ctx:
    data: dict[str, Any]
    days: list[str] = field(init=False)
    lab_starts: set[int] = field(init=False)
    lunch_after: int = field(init=False)
    rooms: dict[str, dict] = field(init=False)
    faculty: dict[str, dict] = field(init=False)
    groups: dict[str, dict] = field(init=False)
    sessions: dict[str, dict] = field(init=False)
    requests: dict[str, dict] = field(init=False)
    cancelled: set[str] = field(init=False)
    fac_unavail: dict[str, set] = field(init=False)
    room_unavail: dict[str, set] = field(init=False)

    def __post_init__(self) -> None:
        d = self.data
        cal = d["calendar"]
        self.days = list(cal["days"])
        self.lab_starts = set(cal["lab_start_periods"])
        self.lunch_after = cal["lunch"]["after_period"]
        self.rooms = {r["id"]: r for r in d["rooms"]}
        self.faculty = {f["id"]: f for f in d["faculty"]}
        self.groups = {g["id"]: g for g in d["student_groups"]}
        self.sessions = {s["id"]: s for s in d["sessions"]}
        self.requests = {b["id"]: b for b in d["booking_requests"]}
        self.cancelled = {c["request_id"] for c in d.get("cancellations", [])}
        self.fac_unavail = defaultdict(set)
        for f in d["faculty"]:
            for u in f.get("unavailable", []):
                for p in u["periods"]:
                    self.fac_unavail[f["id"]].add((u["day"], p))
        self.room_unavail = defaultdict(set)
        for u in d.get("room_unavailability", []):
            for p in u["periods"]:
                self.room_unavail[u["room_id"]].add((u["day"], p))

    # ------------------------------------------------------------ sessions
    def needs_accessible(self, s: dict) -> bool:
        """A session needs an accessible room if flagged, or if any of its groups
        or its faculty member needs one (defensive for added sessions)."""
        if s.get("needs_accessible"):
            return True
        if any(self.groups.get(g, {}).get("needs_accessible") for g in s["groups"]):
            return True
        return bool(self.faculty.get(s["faculty_id"], {}).get("needs_accessible"))

    def valid_starts(self, s: dict) -> list[int]:
        """Start periods that keep the session inside P1-P9, off lunch, and labs at P2/P6."""
        dur = s["duration"]
        out = []
        for p in range(1, LAST_TEACHING - dur + 2):
            per = range(p, p + dur)
            if per[0] <= self.lunch_after < per[-1]:
                continue
            if s["kind"] == "lab" and p not in self.lab_starts:
                continue
            out.append(p)
        fx = s.get("fixed_slot")
        if fx:
            out = [p for p in out if p == fx["start_period"]]
        return out

    def valid_days(self, s: dict) -> list[str]:
        fx = s.get("fixed_slot")
        return [fx["day"]] if fx else list(self.days)

    def room_fits_session(self, s: dict, r: dict) -> bool:
        if r["type"] not in s["room_types"]:
            return False
        if r["capacity"] < s["size"]:
            return False
        if self.needs_accessible(s) and not r["accessible"]:
            return False
        if s["kind"] not in r.get("allowed_uses", [s["kind"]]):
            return False
        return True

    def candidate_rooms(self, s: dict) -> list[str]:
        return [rid for rid, r in self.rooms.items() if self.room_fits_session(s, r)]

    # ------------------------------------------------------------ bookings
    def effective_category(self, req: dict) -> str:
        order = self.data["priority_order"]
        cap = self.data["role_category_cap"].get(req["role"], "club_event")
        a = order.index(req["requested_category"]) if req["requested_category"] in order else len(order) - 1
        return order[max(a, order.index(cap))]

    def room_features(self, r: dict) -> set[str]:
        return set(r["features"]) | ({"accessible"} if r["accessible"] else set())

    def room_fits_request(self, req: dict, r: dict) -> bool:
        return (
            "event" in r["allowed_uses"]
            and r["type"] in req["room_types"]
            and r["capacity"] >= req["attendance"]
            and not set(req["needs"]) - self.room_features(r)
        )

    def request_placements(self, req: dict, within_windows: bool = True):
        """Every (room, day, start) that would satisfy a request inside its windows,
        ignoring other occupants. Periods are clipped to P1-P13."""
        dur = req["duration_periods"]
        rooms = [r for r in self.rooms.values() if self.room_fits_request(req, r)]
        out = []
        for w in req["windows"]:
            lo, hi = max(1, w["from_period"]), min(MAX_PERIOD, w["to_period"])
            for start in range(lo, hi - dur + 2):
                per = list(range(start, start + dur))
                for r in rooms:
                    if any((w["day"], p) in self.room_unavail[r["id"]] for p in per):
                        continue
                    out.append((r["id"], w["day"], start))
        return out


def block(start: int, dur: int) -> list[int]:
    return list(range(start, start + dur))
