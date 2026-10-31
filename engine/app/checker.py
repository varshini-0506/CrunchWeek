"""The constraint checker: the single source of truth for validity.

Rules mirror the official validator (H1-H14, S1-S6) and add a few defensive
checks it does not make (room allowed_uses, accessibility derived from groups and
faculty). Every violation is structured so the UI and the AI layer can explain it.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from .model import LAST_TEACHING, Ctx, block

Assign = dict[str, tuple[str, int, str]]  # session_id -> (day, start_period, room_id)

RULE_TEXT = {
    "H1": "Every session is scheduled exactly once",
    "H2": "A faculty member can't be in two places at once",
    "H3": "A student group can't be in two places at once",
    "H4": "A room can't hold two things at once",
    "H5": "Room capacity must cover the session size",
    "H6": "Room type must match what the session needs",
    "H7": "Faculty unavailability must be respected",
    "H8": "Room unavailability must be respected",
    "H9": "Sessions stay inside P1-P9, don't cross lunch; labs start at P2 or P6",
    "H10": "Sessions that need an accessible room get one",
    "H11": "Sessions in the same elective basket run at the same time",
    "H12": "Faculty daily teaching limit",
    "H13": "Approved bookings can't overlap sessions, other bookings or mandatory groups",
    "H14": "A session with a fixed slot stays in that slot",
    "X1": "Room must allow this kind of use",
}


def _v(rule: str, detail: str, sessions: Iterable[str] = (), **extra: Any) -> dict[str, Any]:
    return {"rule": rule, "title": RULE_TEXT.get(rule, rule), "detail": detail,
            "sessions": sorted(set(sessions)), **extra}


def check_timetable(ctx: Ctx, assign: Assign, strict: bool = True) -> list[dict[str, Any]]:
    """Return every hard violation. strict=True adds the defensive checks."""
    V: list[dict[str, Any]] = []
    room_occ = defaultdict(list)
    fac_occ = defaultdict(list)
    grp_occ = defaultdict(lambda: defaultdict(list))
    fac_day = defaultdict(int)
    basket_time = defaultdict(set)

    for sid in ctx.sessions:
        if sid not in assign:
            V.append(_v("H1", f"Session {sid} is not scheduled", [sid]))
    for sid, (day, start, rid) in assign.items():
        s = ctx.sessions.get(sid)
        if s is None:
            V.append(_v("H1", f"Unknown session id {sid}", [sid]))
            continue
        if day not in ctx.days:
            V.append(_v("H1", f"{sid}: invalid day {day}", [sid]))
            continue
        if not isinstance(start, int) or start < 1 or start + s["duration"] - 1 > LAST_TEACHING:
            V.append(_v("H9", f"{sid}: P{start} with duration {s['duration']} runs outside P1-P9", [sid]))
            continue
        r = ctx.rooms.get(rid)
        if r is None:
            V.append(_v("H1", f"{sid}: unknown room {rid}", [sid]))
            continue
        per = block(start, s["duration"])
        if per[0] <= ctx.lunch_after < per[-1]:
            V.append(_v("H9", f"{sid} crosses lunch ({day} P{per[0]}-P{per[-1]})", [sid]))
        if s["kind"] == "lab" and start not in ctx.lab_starts:
            V.append(_v("H9", f"{sid}: lab must start at P2 or P6, starts at P{start}", [sid]))
        fx = s.get("fixed_slot")
        if fx and (fx["day"] != day or fx["start_period"] != start):
            V.append(_v("H14", f"{sid} is fixed at {fx['day']} P{fx['start_period']}, placed at {day} P{start}", [sid]))
        if r["capacity"] < s["size"]:
            V.append(_v("H5", f"{sid} has {s['size']} students, {rid} seats {r['capacity']}", [sid], room=rid))
        if r["type"] not in s["room_types"]:
            V.append(_v("H6", f"{sid} needs {', '.join(s['room_types'])}; {rid} is a {r['type']}", [sid], room=rid))
        needs_acc = ctx.needs_accessible(s) if strict else s.get("needs_accessible")
        if needs_acc and not r["accessible"]:
            V.append(_v("H10", f"{sid} needs an accessible room; {rid} is not accessible", [sid], room=rid))
        if strict and s["kind"] not in r.get("allowed_uses", [s["kind"]]):
            V.append(_v("X1", f"{rid} does not take {s['kind']}s", [sid], room=rid))
        f = s["faculty_id"]
        key = s.get("basket_slot") or sid
        for p in per:
            room_occ[(rid, day, p)].append(sid)
            fac_occ[(f, day, p)].append(sid)
            for g in s["groups"]:
                grp_occ[(g, day, p)][key].append(sid)
            if (day, p) in ctx.fac_unavail[f]:
                V.append(_v("H7", f"{sid}: {f} is unavailable {day} P{p}", [sid], faculty=f))
            if (day, p) in ctx.room_unavail[rid]:
                V.append(_v("H8", f"{sid}: {rid} is unavailable {day} P{p}", [sid], room=rid))
        fac_day[(f, day)] += s["duration"]
        if s.get("basket_slot"):
            basket_time[s["basket_slot"]].add((day, start))

    for (rid, day, p), sids in room_occ.items():
        if len(sids) > 1:
            V.append(_v("H4", f"{rid} double-booked {day} P{p}: {', '.join(sorted(sids))}", sids, room=rid))
    for (f, day, p), sids in fac_occ.items():
        if len(sids) > 1:
            V.append(_v("H2", f"{f} double-booked {day} P{p}: {', '.join(sorted(sids))}", sids, faculty=f))
    for (g, day, p), keys in grp_occ.items():
        if len(keys) > 1:
            sids = [x for v in keys.values() for x in v]
            V.append(_v("H3", f"Group {g} double-booked {day} P{p}: {', '.join(sorted(keys))}", sids, group=g))
    for b, times in basket_time.items():
        if len(times) > 1:
            V.append(_v("H11", f"Basket {b} sessions are not at the same time: {sorted(times)}", []))
    for (f, day), h in fac_day.items():
        mx = ctx.faculty.get(f, {}).get("max_hours_per_day", 4)
        if h > mx:
            V.append(_v("H12", f"{f} teaches {h} hours on {day} (max {mx})", [], faculty=f))
    return V


def group_occupancy(ctx: Ctx, assign: Assign) -> dict[tuple[str, str, int], set[str]]:
    occ: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    for sid, (day, start, _rid) in assign.items():
        s = ctx.sessions.get(sid)
        if not s:
            continue
        for p in block(start, s["duration"]):
            for g in s["groups"]:
                occ[(g, day, p)].add(sid)
    return occ


def soft_score(ctx: Ctx, assign: Assign) -> tuple[dict[str, int], int]:
    """Soft penalties S1-S6, computed exactly as the official validator does."""
    pen: dict[str, int] = defaultdict(int)
    grp_day = defaultdict(set)
    grp_hours = defaultdict(int)
    grp_course = defaultdict(int)
    seen_basket = set()
    for sid, (day, start, rid) in assign.items():
        s, r = ctx.sessions.get(sid), ctx.rooms.get(rid)
        if s is None or r is None:
            continue
        per = block(start, s["duration"])
        for pref in ctx.faculty.get(s["faculty_id"], {}).get("preferences", []):
            if pref.get("type") == "avoid" and day in pref.get("days", ctx.days):
                pen["S1"] += 2 * sum(1 for p in per if p in pref["periods"])
        if r["capacity"] and s["size"] / r["capacity"] < 0.4:
            pen["S5"] += 1
        if LAST_TEACHING in per:
            pen["S6"] += 1
        for g in s["groups"]:
            for p in per:
                grp_day[(g, day)].add(p)
            if s.get("basket_slot"):
                if (g, s["basket_slot"]) in seen_basket:
                    continue
                seen_basket.add((g, s["basket_slot"]))
            grp_hours[(g, day)] += s["duration"]
            if s["kind"] == "lecture" and not s.get("basket_slot"):
                grp_course[(g, day, s["course_id"])] += 1
    for ps in grp_day.values():
        pen["S2"] += sum(1 for p in range(min(ps), max(ps) + 1) if p not in ps)
    for h in grp_hours.values():
        if h > 6:
            pen["S3"] += 3 * (h - 6)
    for c in grp_course.values():
        if c > 1:
            pen["S4"] += 3 * (c - 1)
    bc = defaultdict(int)
    for sid, (day, _start, _rid) in assign.items():
        s = ctx.sessions.get(sid)
        if s and s.get("basket_slot"):
            bc[(s["course_id"], day)] += 1
    for c in bc.values():
        if c > 1:
            pen["S4"] += 3 * (c - 1)
    out = {k: pen.get(k, 0) for k in ("S1", "S2", "S3", "S4", "S5", "S6")}
    return out, sum(out.values())


def check_move(ctx: Ctx, assign: Assign, session_id: str, day: str, start: int, room_id: str) -> list[dict[str, Any]]:
    """Violations that a single proposed placement would introduce (for live previews
    and manual scheduling). Compares against the current assignment."""
    before = {(v["rule"], v["detail"]) for v in check_timetable(ctx, assign)}
    trial = dict(assign)
    trial[session_id] = (day, start, room_id)
    return [v for v in check_timetable(ctx, trial) if (v["rule"], v["detail"]) not in before]
