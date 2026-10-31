"""Midsem exam scheduler (OR-Tools CP-SAT).

Each exam gets one (day, session) slot and a set of rooms whose half capacities
cover its size. Hard rules: a group sits at most one exam per slot, a room hosts
at most one exam per slot, rooms must allow exams, groups that need access get
accessible rooms. Soft: no group sits two papers on the same day (5 points each,
as the validator scores it), then use as few rooms as possible.
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from .model import Ctx

# Exam sessions mapped onto teaching periods, so room maintenance windows are respected.
SESSION_PERIODS = {"AM": [2, 3, 4], "PM": [6, 7]}


@dataclass
class ExamResult:
    status: str
    placements: list[dict[str, Any]] = field(default_factory=list)
    penalty: int = 0
    seconds: float = 0.0
    conflicts: list[str] = field(default_factory=list)


def exam_room_ok(ctx: Ctx, exam: dict, room: dict) -> bool:
    if "exam" not in room["allowed_uses"]:
        return False
    if any(ctx.groups.get(g, {}).get("needs_accessible") for g in exam["groups"]) and not room["accessible"]:
        return False
    return True


def check_exams(ctx: Ctx, placements: list[dict]) -> tuple[list[dict], int]:
    """Validator-equivalent exam check plus the accessibility rule. Returns (violations, penalty)."""
    cal = ctx.data["calendar"]["exam_week"]
    sess_ids = {s["id"] for s in cal["sessions"]}
    exams = {e["id"]: e for e in ctx.data.get("exams", [])}
    V, pen = [], 0
    room_use, grp_use, grp_day = defaultdict(list), defaultdict(list), defaultdict(set)
    seen = set()
    for p in placements:
        eid = p["exam_id"]
        e = exams.get(eid)
        if e is None:
            V.append({"rule": "E1", "detail": f"Unknown exam {eid}"}); continue
        if eid in seen:
            V.append({"rule": "E1", "detail": f"{eid} scheduled twice"})
        seen.add(eid)
        if p["day"] not in cal["days"] or p["session"] not in sess_ids:
            V.append({"rule": "E1", "detail": f"{eid}: invalid slot"}); continue
        seats = 0
        for rid in p["rooms"]:
            r = ctx.rooms.get(rid)
            if r is None or "exam" not in r["allowed_uses"]:
                V.append({"rule": "E2", "detail": f"{eid}: {rid} cannot host exams"}); continue
            if not exam_room_ok(ctx, e, r):
                V.append({"rule": "H10", "detail": f"{eid}: {rid} is not accessible"})
            seats += r["capacity"] // 2
            room_use[(rid, p["day"], p["session"])].append(eid)
        if seats < e["size"]:
            V.append({"rule": "H5", "detail": f"{eid}: {seats} seats at half capacity for {e['size']} students"})
        for g in e["groups"]:
            grp_use[(g, p["day"], p["session"])].append(eid)
            grp_day[(g, p["day"])].add(eid)
    for eid in exams:
        if eid not in seen:
            V.append({"rule": "E1", "detail": f"{eid} not scheduled"})
    for k, v in room_use.items():
        if len(v) > 1:
            V.append({"rule": "H4", "detail": f"{k[0]} has {', '.join(v)} in {k[1]} {k[2]}"})
    for k, v in grp_use.items():
        if len(v) > 1:
            V.append({"rule": "H3", "detail": f"Group {k[0]} has {', '.join(v)} in {k[1]} {k[2]}"})
    for v in grp_day.values():
        if len(v) > 1:
            pen += 5 * (len(v) - 1)
    return V, pen


def schedule_exams(ctx: Ctx, time_limit: float = 20.0, workers: int = 8) -> ExamResult:
    t0 = time.time()
    cal = ctx.data["calendar"]["exam_week"]
    days = cal["days"]
    sessions = [s["id"] for s in cal["sessions"]]
    slots = [(d, s) for d in days for s in sessions]
    exams = ctx.data.get("exams", [])
    rooms = [r for r in ctx.rooms.values() if "exam" in r["allowed_uses"]]
    total_half = sum(r["capacity"] // 2 for r in rooms)

    for e in exams:
        if sum(r["capacity"] // 2 for r in rooms if exam_room_ok(ctx, e, r)) < e["size"]:
            return ExamResult("INFEASIBLE", conflicts=[f"{e['id']}: {e['size']} students but only "
                                                       f"{total_half} exam seats at half capacity"])

    m = cp_model.CpModel()
    at = {}
    use = {}
    by_room_slot = defaultdict(list)
    for e in exams:
        for (d, s) in slots:
            at[(e["id"], d, s)] = m.NewBoolVar("")
            seats = []
            for r in rooms:
                if not exam_room_ok(ctx, e, r):
                    continue
                if any((d, p) in ctx.room_unavail[r["id"]] for p in SESSION_PERIODS.get(s, [])):
                    continue
                u = m.NewBoolVar("")
                use[(e["id"], d, s, r["id"])] = u
                by_room_slot[(d, s, r["id"])].append(u)
                m.AddImplication(u, at[(e["id"], d, s)])
                seats.append((r["capacity"] // 2, u))
            m.Add(sum(c * u for c, u in seats) >= e["size"] * at[(e["id"], d, s)])
        m.AddExactlyOne(at[(e["id"], d, s)] for (d, s) in slots)

    # one exam per room per slot
    for vs in by_room_slot.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)
    # one exam per group per slot; penalty for two on the same day
    by_group = defaultdict(list)
    for e in exams:
        for g in e["groups"]:
            by_group[g].append(e["id"])
    obj = []
    for g, eids in by_group.items():
        for (d, s) in slots:
            m.AddAtMostOne(at[(eid, d, s)] for eid in eids)
        for d in days:
            n = sum(at[(eid, d, s)] for eid in eids for s in sessions)
            over = m.NewIntVar(0, len(sessions), "")
            m.Add(over >= n - 1)
            obj.append(5000 * over)
    # fewer rooms, and spread papers so each group has breathing room
    obj.append(sum(use.values()))
    m.Minimize(sum(obj))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = workers
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ExamResult(solver.StatusName(st), seconds=time.time() - t0,
                          conflicts=["No exam timetable satisfies every rule"])
    out = []
    for e in exams:
        for (d, s) in slots:
            if solver.Value(at[(e["id"], d, s)]):
                rms = [r["id"] for r in rooms if (e["id"], d, s, r["id"]) in use
                       and solver.Value(use[(e["id"], d, s, r["id"])])]
                out.append({"exam_id": e["id"], "day": d, "session": s, "rooms": rms})
    _, pen = check_exams(ctx, out)
    return ExamResult(solver.StatusName(st), out, pen, time.time() - t0)
