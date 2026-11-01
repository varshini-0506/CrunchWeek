"""Surprise check: how well does the current timetable absorb a disruption?

We try every single-room closure (the room is shut all week) and every
faculty-day absence (a teacher can't come on one day they teach). For each one we
count the sessions that *must* move (a hard lower bound on the repair) and try a
quick greedy fix:

* room closure: give each affected session another free, suitable room at the same
  time (a room-only move, the gentlest fix);
* faculty absence: move each affected session to another time that week where the
  teacher, every group and some suitable room are free.

The greedy fix is conservative: if it succeeds, the full repair solver will too,
with at most that many moves; if it fails, the solver may still find a fix by
moving other sessions. Nothing here changes the timetable.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .checker import Assign
from .model import Ctx, block


def _occupancy(ctx: Ctx, assign: Assign):
    room = {}
    fac = {}
    grp = {}
    fac_hours = defaultdict(int)
    for sid, (d, st, r) in assign.items():
        s = ctx.sessions[sid]
        key = s.get("basket_slot") or sid
        for p in block(st, s["duration"]):
            room[(r, d, p)] = sid
            fac[(s["faculty_id"], d, p)] = sid
            for g in s["groups"]:
                grp[(g, d, p)] = key
        fac_hours[(s["faculty_id"], d)] += s["duration"]
    return room, fac, grp, fac_hours


def _room_closure(ctx: Ctx, assign: Assign, rid: str) -> dict[str, Any]:
    room, _, _, _ = _occupancy(ctx, assign)
    hit = sorted(sid for sid, (d, st, r) in assign.items() if r == rid)
    taken = dict(room)
    fixed = 0
    for sid in hit:
        d, st, _ = assign[sid]
        s = ctx.sessions[sid]
        per = block(st, s["duration"])
        for r in ctx.candidate_rooms(s):
            if r == rid:
                continue
            if any((d, p) in ctx.room_unavail[r] or (r, d, p) in taken for p in per):
                continue
            for p in per:
                taken[(r, d, p)] = sid
            fixed += 1
            break
    only_room = all(ctx.candidate_rooms(ctx.sessions[sid]) == [rid] for sid in hit)
    return {"kind": "room_closed", "what": rid, "must_move": len(hit), "room_only_fix": fixed,
            "fully_fixed": fixed == len(hit), "only_room_of_its_kind": only_room}


def _faculty_day(ctx: Ctx, assign: Assign, fid: str, day: str) -> dict[str, Any]:
    room, fac, grp, fac_hours = _occupancy(ctx, assign)
    hit = sorted(sid for sid, (d, st, r) in assign.items()
                 if d == day and ctx.sessions[sid]["faculty_id"] == fid)
    # free the moved sessions' old places
    for sid in hit:
        d, st, r = assign[sid]
        s = ctx.sessions[sid]
        for p in block(st, s["duration"]):
            room.pop((r, d, p), None)
            fac.pop((fid, d, p), None)
            for g in s["groups"]:
                if grp.get((g, d, p)) == (s.get("basket_slot") or sid):
                    grp.pop((g, d, p), None)
        fac_hours[(fid, d)] -= s["duration"]
    mx = ctx.faculty[fid].get("max_hours_per_day", 4)
    fixed = 0
    for sid in hit:
        s = ctx.sessions[sid]
        if s.get("basket_slot") or s.get("fixed_slot"):
            continue          # needs the whole basket or is pinned: leave it to the solver
        done = False
        for d in ctx.days:
            if d == day or fac_hours[(fid, d)] + s["duration"] > mx:
                continue
            for st in ctx.valid_starts(s):
                per = block(st, s["duration"])
                if any((d, p) in ctx.fac_unavail[fid] or (fid, d, p) in fac for p in per):
                    continue
                if any((g, d, p) in grp for g in s["groups"] for p in per):
                    continue
                for r in ctx.candidate_rooms(s):
                    if any((d, p) in ctx.room_unavail[r] or (r, d, p) in room for p in per):
                        continue
                    for p in per:
                        room[(r, d, p)] = sid
                        fac[(fid, d, p)] = sid
                        for g in s["groups"]:
                            grp[(g, d, p)] = sid
                    fac_hours[(fid, d)] += s["duration"]
                    done = True
                    break
                if done:
                    break
            if done:
                break
        fixed += done
    return {"kind": "faculty_absent", "what": f"{fid} {day}", "must_move": len(hit),
            "quick_fix": fixed, "fully_fixed": fixed == len(hit)}


def resilience_report(ctx: Ctx, assign: Assign) -> dict[str, Any]:
    if not assign:
        return {"available": False}
    rooms = [_room_closure(ctx, assign, rid) for rid in ctx.rooms
             if any(r == rid for (_, _, r) in assign.values())]
    teach_days = sorted({(ctx.sessions[sid]["faculty_id"], d) for sid, (d, _, _) in assign.items()})
    facs = [_faculty_day(ctx, assign, f, d) for f, d in teach_days]

    def summary(rows: list[dict], fix_key: str) -> dict[str, Any]:
        n = len(rows)
        must = sum(r["must_move"] for r in rows)
        return {"scenarios": n,
                "fully_fixed": sum(r["fully_fixed"] for r in rows),
                "fully_fixed_pct": round(100 * sum(r["fully_fixed"] for r in rows) / n, 1) if n else 100.0,
                "avg_must_move": round(must / n, 2) if n else 0.0,
                "sessions_fixed_pct": round(100 * sum(r[fix_key] for r in rows) / must, 1) if must else 100.0,
                "worst": sorted((r for r in rows if not r["fully_fixed"]),
                                key=lambda r: r[fix_key] - r["must_move"])[:5]}

    room_s = summary(rooms, "room_only_fix")
    room_s["only_room_of_its_kind"] = sorted(r["what"] for r in rooms if r["only_room_of_its_kind"])
    fac_s = summary(facs, "quick_fix")
    total = room_s["scenarios"] + fac_s["scenarios"]
    ok = room_s["fully_fixed"] + fac_s["fully_fixed"]
    return {"available": True,
            "scenarios": total,
            "fully_fixed": ok,
            "fully_fixed_pct": round(100 * ok / total, 1) if total else 100.0,
            "room_closures": room_s,
            "faculty_absences": fac_s,
            "method": "Every single-room closure and every teacher-day absence, fixed greedily "
                      "without moving anything else. A conservative estimate: the repair solver "
                      "can only do as well or better."}


def week_quality(ctx: Ctx, assign: Assign) -> dict[str, Any]:
    """Things students feel that the validator doesn't score."""
    from .solver import building_of
    early = sum(1 for sid, (d, st, r) in assign.items() if st == 1)
    where = defaultdict(dict)
    for sid, (d, st, r) in assign.items():
        s = ctx.sessions[sid]
        if s.get("basket_slot"):
            continue
        for p in block(st, s["duration"]):
            for g in s["groups"]:
                where[(g, d)][p] = building_of(ctx.rooms[r])
    walks = sum(1 for m in where.values() for p in m
                if p != ctx.lunch_after and p + 1 in m and m[p + 1] != m[p])
    return {"eight_am_classes": early, "building_changes": walks}
