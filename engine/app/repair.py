"""Disruptions: apply a change file, re-solve with the fewest moves, describe the diff,
and explain infeasibility when no valid fix exists."""
from __future__ import annotations

import copy
from collections import defaultdict
from typing import Any

from .checker import Assign, check_timetable
from .model import LAST_TEACHING, Ctx, block
from .solver import solve_timetable

CHANGE_TYPES = {"faculty_unavailable", "room_unavailable", "add_faculty", "add_session", "remove_session"}


class ChangeError(ValueError):
    pass


def validate_changes(data: dict, dis: dict) -> list[str]:
    """Return problems with a change file before it is applied (unknown ids, bad types)."""
    errs = []
    fac = {f["id"] for f in data["faculty"]}
    rooms = {r["id"] for r in data["rooms"]}
    sessions = {s["id"] for s in data["sessions"]}
    days = set(data["calendar"]["days"])
    for i, ch in enumerate(dis.get("changes", [])):
        t = ch.get("type")
        where = f"change {i + 1} ({t})"
        if t not in CHANGE_TYPES:
            errs.append(f"{where}: unknown change type")
            continue
        if t == "faculty_unavailable":
            if ch.get("faculty_id") not in fac:
                errs.append(f"{where}: unknown faculty {ch.get('faculty_id')}")
        if t == "room_unavailable" and ch.get("room_id") not in rooms:
            errs.append(f"{where}: unknown room {ch.get('room_id')}")
        if t in ("faculty_unavailable", "room_unavailable"):
            bad = [d for d in ch.get("days", []) if d not in days]
            if bad:
                errs.append(f"{where}: unknown days {bad}")
        if t == "add_faculty":
            fac.add(ch.get("faculty", {}).get("id"))
        if t == "add_session":
            s = ch.get("session", {})
            if s.get("id") in sessions:
                errs.append(f"{where}: session {s.get('id')} already exists")
            if s.get("faculty_id") not in fac:
                errs.append(f"{where}: unknown faculty {s.get('faculty_id')}")
            sessions.add(s.get("id"))
        if t == "remove_session" and ch.get("session_id") not in sessions:
            errs.append(f"{where}: unknown session {ch.get('session_id')}")
    return errs


def apply_changes(data: dict, dis: dict) -> dict:
    """Same semantics as the official validator's apply_disruption. Changes are permanent."""
    d = copy.deepcopy(data)
    fac = {f["id"]: f for f in d["faculty"]}
    for ch in dis.get("changes", []):
        t = ch["type"]
        if t == "faculty_unavailable":
            for day in ch["days"]:
                fac[ch["faculty_id"]].setdefault("unavailable", []).append(
                    {"day": day, "periods": ch["periods"], "reason": ch.get("reason", "")})
        elif t == "room_unavailable":
            for day in ch["days"]:
                d["room_unavailability"].append(
                    {"room_id": ch["room_id"], "day": day, "periods": ch["periods"], "reason": ch.get("reason", "")})
        elif t == "add_faculty":
            d["faculty"].append(ch["faculty"])
            fac[ch["faculty"]["id"]] = ch["faculty"]
        elif t == "add_session":
            d["sessions"].append(ch["session"])
        elif t == "remove_session":
            d["sessions"] = [s for s in d["sessions"] if s["id"] != ch["session_id"]]
        else:
            raise ChangeError(f"Unknown change type: {t}")
    return d


def describe_diff(ctx: Ctx, before: Assign, after: Assign) -> dict[str, Any]:
    moved, added, removed = [], [], []
    for sid, new in sorted(after.items()):
        old = before.get(sid)
        if old is None:
            added.append({"session_id": sid, "to": _slot(new)})
        elif tuple(old) != tuple(new):
            kind = "room" if tuple(old[:2]) == tuple(new[:2]) else "time"
            moved.append({"session_id": sid, "kind": kind, "from": _slot(old), "to": _slot(new),
                          "course_id": ctx.sessions[sid]["course_id"], "groups": ctx.sessions[sid]["groups"],
                          "faculty_id": ctx.sessions[sid]["faculty_id"]})
    for sid in sorted(before):
        if sid not in after:
            removed.append({"session_id": sid, "from": _slot(before[sid])})
    return {"moved": moved, "added": added, "removed": removed,
            "sessions_moved": len(moved), "time_changed": sum(1 for m in moved if m["kind"] == "time"),
            "room_only_changed": sum(1 for m in moved if m["kind"] == "room")}


def _slot(t) -> dict:
    return {"day": t[0], "start_period": t[1], "room_id": t[2]}


def affected_sessions(ctx: Ctx, assign: Assign) -> list[dict]:
    """Sessions that break a rule under the new data, with the rule each one breaks."""
    out = []
    for v in check_timetable(ctx, {k: v for k, v in assign.items() if k in ctx.sessions}):
        out.append(v)
    return out


def diagnose_infeasible(ctx: Ctx) -> list[str]:
    """Plain-language reasons why no valid timetable exists after a change."""
    reasons = []
    for sid, s in ctx.sessions.items():
        rooms = ctx.candidate_rooms(s)
        if not rooms:
            reasons.append(f"{sid} needs a {', '.join(s['room_types'])} for {s['size']} students"
                           f"{' with step-free access' if ctx.needs_accessible(s) else ''}, and no room qualifies")
            continue
        ok = False
        for d in ctx.valid_days(s):
            for st in ctx.valid_starts(s):
                per = block(st, s["duration"])
                if any((d, p) in ctx.fac_unavail[s["faculty_id"]] for p in per):
                    continue
                if any(all((d, p) not in ctx.room_unavail[r] for p in per) for r in rooms):
                    ok = True
                    break
            if ok:
                break
        if not ok:
            reasons.append(f"{sid}: {s['faculty_id']}'s unavailability and closures of "
                           f"{', '.join(rooms)} leave no allowed slot")
    # faculty load against their available periods
    need = defaultdict(int)
    for s in ctx.sessions.values():
        need[s["faculty_id"]] += s["duration"]
    for f, h in need.items():
        cap = sum(min(ctx.faculty[f].get("max_hours_per_day", 4),
                      sum(1 for p in range(1, LAST_TEACHING + 1) if (d, p) not in ctx.fac_unavail[f]))
                  for d in ctx.days)
        if h > cap:
            reasons.append(f"{f} must teach {h} hours but daily limits and unavailability allow only {cap}")
    # room-type supply against demand
    demand = defaultdict(int)
    for s in ctx.sessions.values():
        if s["kind"] == "lab":
            demand[tuple(sorted(s["room_types"]))] += 1
    for types, n in demand.items():
        slots = 0
        for r in ctx.rooms.values():
            if r["type"] in types:
                for d in ctx.days:
                    for st in sorted(ctx.lab_starts):
                        if all((d, p) not in ctx.room_unavail[r["id"]] for p in block(st, 3)):
                            slots += 1
        if n > slots:
            reasons.append(f"{n} lab blocks need {', '.join(types)} but only {slots} lab slots remain open")
    # group load
    load = defaultdict(int)
    seen = set()
    for s in ctx.sessions.values():
        for g in s["groups"]:
            if s.get("basket_slot"):
                if (g, s["basket_slot"]) in seen:
                    continue
                seen.add((g, s["basket_slot"]))
            load[g] += s["duration"]
    for g, h in load.items():
        if h > len(ctx.days) * LAST_TEACHING:
            reasons.append(f"Group {g} needs {h} hours, more than the {len(ctx.days) * LAST_TEACHING} periods in a week")
    return reasons or ["The remaining rules conflict in combination (no single cause); try relaxing one change"]


def propose_repair(data: dict, baseline: Assign, dis: dict, time_limit: float = 60.0) -> dict[str, Any]:
    errs = validate_changes(data, dis)
    if errs:
        return {"status": "invalid_change_file", "errors": errs}
    new_data = apply_changes(data, dis)
    ctx = Ctx(new_data)
    base = {k: v for k, v in baseline.items() if k in ctx.sessions}
    broken = affected_sessions(ctx, base | {})
    res = solve_timetable(ctx, time_limit=time_limit, baseline=base)
    if not res.assign:
        return {"status": "infeasible", "conflicts": res.conflicts or diagnose_infeasible(ctx),
                "broken_before_fix": broken, "data": new_data}
    violations = check_timetable(ctx, res.assign)
    return {"status": "proposed" if not violations else "invalid", "assign": res.assign,
            "diff": describe_diff(ctx, baseline, res.assign), "violations": violations,
            "broken_before_fix": broken, "solver": {"status": res.status, "seconds": round(res.seconds, 2)},
            "data": new_data}
