"""Explanations from the engine's own records (the LLM may only reword these)."""
from __future__ import annotations

from collections import Counter
from typing import Any

from .checker import Assign, check_timetable, soft_score
from .model import LAST_TEACHING, Ctx, block


def _soft_cost(ctx: Ctx, s: dict, day: str, start: int, room: str) -> list[str]:
    out = []
    per = block(start, s["duration"])
    for pref in ctx.faculty.get(s["faculty_id"], {}).get("preferences", []):
        if pref.get("type") == "avoid" and day in pref.get("days", ctx.days) and set(per) & set(pref["periods"]):
            out.append(f"{s['faculty_id']} prefers to avoid this time ({pref.get('note', 'preference')})")
    r = ctx.rooms[room]
    if s["size"] / r["capacity"] < 0.4:
        out.append(f"{room} would be under 40% full")
    if LAST_TEACHING in per:
        out.append("uses the 5 pm period (P9)")
    return out


def session_options(ctx: Ctx, assign: Assign, sid: str, limit: int = 12) -> list[dict[str, Any]]:
    """Every valid alternative placement for one session, best first, with what each costs."""
    s = ctx.sessions[sid]
    base_v = {(v["rule"], v["detail"]) for v in check_timetable(ctx, assign)}
    _, base_soft = soft_score(ctx, assign)
    cur = assign.get(sid)
    opts = []
    for d in ctx.valid_days(s):
        for st in ctx.valid_starts(s):
            for r in ctx.candidate_rooms(s):
                if cur and (d, st, r) == tuple(cur):
                    continue
                trial = dict(assign)
                trial[sid] = (d, st, r)
                new = [v for v in check_timetable(ctx, trial) if (v["rule"], v["detail"]) not in base_v]
                if new:
                    continue
                _, soft = soft_score(ctx, trial)
                same_time = cur is not None and (d, st) == tuple(cur[:2])
                opts.append({"day": d, "start_period": st, "room_id": r, "soft_delta": soft - base_soft,
                             "room_only": same_time, "notes": _soft_cost(ctx, s, d, st, r)})
    opts.sort(key=lambda o: (not o["room_only"], o["soft_delta"], ctx.days.index(o["day"]), o["start_period"]))
    return opts[:limit]


def explain_session(ctx: Ctx, assign: Assign, sid: str) -> dict[str, Any]:
    """Why a session sits where it does: what rules out every other time, and what this slot costs."""
    s = ctx.sessions[sid]
    d0, st0, r0 = assign[sid]
    others = {k: v for k, v in assign.items() if k != sid}
    occ_fac, occ_grp, occ_room = set(), {}, set()
    for k, (d, st, r) in others.items():
        o = ctx.sessions[k]
        for p in block(st, o["duration"]):
            occ_room.add((r, d, p))
            if o["faculty_id"] == s["faculty_id"]:
                occ_fac.add((d, p))
            for g in o["groups"]:
                if g in s["groups"] and not (s.get("basket_slot") and o.get("basket_slot") == s.get("basket_slot")):
                    occ_grp[(d, p)] = (g, k)
    blocked = Counter()
    examples: dict[str, str] = {}
    free_times = []
    rooms = ctx.candidate_rooms(s)
    for d in ctx.days:
        for st in range(1, LAST_TEACHING - s["duration"] + 2):
            if (d, st) == (d0, st0):
                continue
            per = block(st, s["duration"])
            reason = None
            if per[0] <= ctx.lunch_after < per[-1]:
                reason = "would run across lunch"
            elif s["kind"] == "lab" and st not in ctx.lab_starts:
                reason = "labs start only at P2 or P6"
            elif s.get("fixed_slot"):
                reason = "the session has a fixed slot"
            elif any((d, p) in ctx.fac_unavail[s["faculty_id"]] for p in per):
                reason = f"{s['faculty_id']} is unavailable"
            elif any((d, p) in occ_fac for p in per):
                reason = f"{s['faculty_id']} teaches another class then"
            elif any((d, p) in occ_grp for p in per):
                g, k = next(occ_grp[(d, p)] for p in per if (d, p) in occ_grp)
                reason = f"group {g} already has a class"
                examples.setdefault(reason, f"{d} P{st}: {g} has {k}")
            elif not any(all((r, d, p) not in occ_room and (d, p) not in ctx.room_unavail[r] for p in per) for r in rooms):
                reason = "no suitable room is free"
            if reason:
                blocked[reason] += 1
            else:
                free_times.append(f"{d} P{st}")
    _, total = soft_score(ctx, assign)
    return {
        "session_id": sid, "slot": {"day": d0, "start_period": st0, "room_id": r0},
        "room_reason": f"{r0} ({ctx.rooms[r0]['type'].replace('_', ' ')}, {ctx.rooms[r0]['capacity']} seats) fits "
                       f"{s['size']} students{' and is step-free' if ctx.needs_accessible(s) else ''}",
        "ruled_out": [{"reason": k, "times": v, "example": examples.get(k)} for k, v in blocked.most_common()],
        "other_valid_times": free_times[:10],
        "costs_here": _soft_cost(ctx, s, d0, st0, r0),
        "summary": (f"{sid} is at {d0} P{st0} in {r0}. "
                    + (f"{sum(blocked.values())} other start times would cause a clash"
                       + (f" (mostly: {blocked.most_common(1)[0][0]})" if blocked else "") + ". ")
                    + (f"{len(free_times)} other times were free, but this one leaves the whole week with the "
                       f"fewest compromises ({total} in total)."
                       if free_times else "No other time works.")),
    }


def utilisation(ctx: Ctx, assign: Assign) -> list[dict[str, Any]]:
    periods = len(ctx.days) * LAST_TEACHING
    used = Counter()
    seats = Counter()
    for sid, (d, st, r) in assign.items():
        s = ctx.sessions[sid]
        used[r] += s["duration"]
        seats[r] += s["size"] * s["duration"]
    out = []
    for rid, r in ctx.rooms.items():
        out.append({"room_id": rid, "name": r["name"], "type": r["type"], "capacity": r["capacity"],
                    "hours_used": used[rid], "utilisation": round(used[rid] / periods, 3),
                    "avg_fill": round(seats[rid] / (used[rid] * r["capacity"]), 3) if used[rid] else None})
    return sorted(out, key=lambda x: -x["utilisation"])
