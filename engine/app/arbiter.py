"""Spectra-week booking arbiter.

Deterministic, priority-first: requests are processed by effective category
(capped by the requester's role), then by submission time. Each takes the best
free placement inside its windows; an approved institute event may move a regular
session for Week 7 only (the moved session must still satisfy every hard rule).
If nothing fits, the arbiter offers the nearest valid alternative, or rejects with
a specific reason. The LLM never takes part in these decisions.
"""
from __future__ import annotations

from typing import Any

from .checker import Assign, check_timetable, group_occupancy
from .model import CAT_WEIGHT, LAST_TEACHING, MAX_PERIOD, Ctx, block

CATEGORY_LABEL = {
    "exam": "Exam", "regular_session": "Regular class", "institute_event": "Institute event",
    "guest_lecture": "Guest lecture", "department_event": "Department event", "club_event": "Club event",
}
ROLE_LABEL = {"admin": "Admin", "department_coordinator": "Department coordinator",
              "faculty": "Faculty", "club": "Club"}


def period_hour(p: int, lunch_after: int = 5) -> int:
    """Clock hour at which period p starts (P1 08:00; one-hour lunch after P5)."""
    return 7 + p if p <= lunch_after else 8 + p


def fmt_slot(day: str, a: int, b: int) -> str:
    def h(x: int) -> str:
        return f"{x - 12} pm" if x > 12 else ("12 pm" if x == 12 else f"{x} am")
    return f"{day.title()} {h(period_hour(a))} to {h(period_hour(b) + 1)} (P{a}-P{b})"


def attending_faculty(req: dict) -> list[str]:
    return list(req.get("attending_faculty") or [])


def participants(req: dict) -> list[str]:
    """Everyone whose own timetable an event takes over: the sections and teachers who attend it."""
    return list(req.get("mandatory_for_groups") or []) + attending_faculty(req)


def clash_sessions(b: dict) -> list[str]:
    """Regular classes in the way of a placement: in the room, or taught to / by people who must attend."""
    return sorted({*b["sessions"], *(x[1] for x in b["groups"]), *(x[1] for x in b["faculty"])})


class Week:
    """Occupancy of the Spectra week: base timetable + overrides + approved bookings."""

    def __init__(self, ctx: Ctx, assign: Assign):
        self.ctx = ctx
        self.assign = dict(assign)
        self.overrides: dict[str, tuple[str, int, str, str]] = {}
        self._rebuild()
        self.booked: dict[tuple[str, str, int], str] = {}
        self.people: dict[tuple[str, str, int], str] = {}   # (section or teacher, day, period) -> event they attend

    def _rebuild(self) -> None:
        self.room_sessions: dict[tuple[str, str, int], str] = {}
        for sid, (d, st, r) in self.assign.items():
            s = self.ctx.sessions.get(sid)
            if s:
                for p in block(st, s["duration"]):
                    self.room_sessions[(r, d, p)] = sid
        self.grp = group_occupancy(self.ctx, self.assign)
        self.fac: dict[tuple[str, str, int], list[str]] = {}
        for sid, (d, st, _r) in self.assign.items():
            s = self.ctx.sessions.get(sid)
            if s:
                for p in block(st, s["duration"]):
                    self.fac.setdefault((s["faculty_id"], d, p), []).append(sid)

    def blockers(self, req: dict, room: str, day: str, start: int) -> dict[str, list]:
        out = {"bookings": [], "sessions": [], "groups": [], "faculty": [], "people": [], "maintenance": []}
        for p in block(start, req["duration_periods"]):
            if (day, p) in self.ctx.room_unavail[room]:
                out["maintenance"].append(p)
            if (room, day, p) in self.booked:
                out["bookings"].append(self.booked[(room, day, p)])
            if (room, day, p) in self.room_sessions:
                out["sessions"].append(self.room_sessions[(room, day, p)])
            for g in req["mandatory_for_groups"]:
                for sid in self.grp.get((g, day, p), ()):
                    out["groups"].append((g, sid, p))
            for f in attending_faculty(req):
                for sid in self.fac.get((f, day, p), ()):
                    out["faculty"].append((f, sid, p))
            for who in participants(req):
                if (who, day, p) in self.people:
                    out["people"].append((who, self.people[(who, day, p)], p))
        return {k: sorted(set(v)) for k, v in out.items()}

    def book(self, req_id: str, room: str, day: str, start: int, dur: int, req: dict | None = None) -> None:
        for p in block(start, dur):
            self.booked[(room, day, p)] = req_id
            for who in participants(req or {}):
                self.people[(who, day, p)] = req_id

    def move_session(self, sid: str, to: tuple[str, int, str], by: str) -> None:
        self.assign[sid] = to
        self.overrides[sid] = (*to, by)
        self._rebuild()


def _rank_placements(ctx: Ctx, req: dict, places: list[tuple[str, str, int]]) -> list[tuple[str, str, int]]:
    """Requested room first, then the tightest room that fits, then earliest time."""
    want = req.get("requested_room")
    def key(p):
        r = ctx.rooms[p[0]]
        return (0 if p[0] == want else 1, r["capacity"], p[2], ctx.days.index(p[1]) if p[1] in ctx.days else 9)
    return sorted(places, key=key)


def _find_session_move(ctx: Ctx, week: Week, sid: str, avoid: set[tuple[str, str, int]],
                       busy_people: set[tuple[str, str, int]] = frozenset()) -> tuple[str, int, str] | None:
    """Nearest valid new placement for a session displaced by an institute event.
    The class may not land where its section or teacher is attending an event."""
    s = ctx.sessions[sid]
    who = [*s["groups"], s["faculty_id"]]
    d0, st0, r0 = week.assign[sid]
    base = {k: v for k, v in week.assign.items()}
    base_v = {(v["rule"], v["detail"]) for v in check_timetable(ctx, base)}
    cands = []
    for d in ctx.valid_days(s):
        for st in ctx.valid_starts(s):
            for r in ctx.candidate_rooms(s):
                if (d, st, r) == (d0, st0, r0):
                    continue
                if any((r, d, p) in avoid or (r, d, p) in week.booked for p in block(st, s["duration"])):
                    continue
                if any((x, d, p) in week.people or (x, d, p) in busy_people for x in who for p in block(st, s["duration"])):
                    continue
                cost = (0 if d == d0 else 1, 0 if st == st0 else abs(st - st0), r)
                cands.append((cost, (d, st, r)))
    for _, to in sorted(cands):
        trial = dict(base)
        trial[sid] = to
        new = [v for v in check_timetable(ctx, trial) if (v["rule"], v["detail"]) not in base_v]
        if not new:
            return to
    return None


def _alternative(ctx: Ctx, week: Week, req: dict) -> tuple[str, str, int] | None:
    """Nearest valid slot outside the requested windows (same day first, then nearby days)."""
    dur = req["duration_periods"]
    rooms = [r for r in ctx.rooms.values() if ctx.room_fits_request(req, r)]
    if not rooms:
        return None
    wins = req["windows"]
    best = None
    for r in sorted(rooms, key=lambda x: x["capacity"]):
        for d in ctx.days:
            for st in range(1, MAX_PERIOD - dur + 2):
                if st <= ctx.lunch_after < st + dur - 1:
                    continue  # an offered slot never runs through lunch
                b = week.blockers(req, r["id"], d, st)
                if any(b.values()):
                    continue
                cost = min(
                    (0 if d == w["day"] else 10 + abs(ctx.days.index(d) - ctx.days.index(w["day"])) * 10)
                    + abs(st - w["from_period"]) + (0 if st > LAST_TEACHING or w["from_period"] <= LAST_TEACHING else 3)
                    for w in wins if w["day"] in ctx.days
                ) if any(w["day"] in ctx.days for w in wins) else st
                cand = (cost, 0 if r["id"] == req.get("requested_room") else 1, r["capacity"], r["id"], d, st)
                if best is None or cand < best:
                    best = cand
    if best is None:
        return None
    return best[3], best[4], best[5]


def _fit_problems(ctx: Ctx, req: dict) -> str | None:
    """Why no room on campus can ever host this request (capacity, type, features)."""
    typed = [r for r in ctx.rooms.values() if r["type"] in req["room_types"] and "event" in r["allowed_uses"]]
    if not typed:
        return f"No venue of type {', '.join(req['room_types'])} can host events"
    big = [r for r in typed if r["capacity"] >= req["attendance"]]
    if not big:
        largest = max(ctx.rooms.values(), key=lambda r: r["capacity"])
        return (f"No venue seats {req['attendance']:,} (largest suitable is "
                f"{max(typed, key=lambda r: r['capacity'])['id']} at {max(r['capacity'] for r in typed):,}; "
                f"largest on campus is {largest['name']} at {largest['capacity']:,})")
    feats = [r for r in big if not set(req["needs"]) - ctx.room_features(r)]
    if not feats:
        miss = sorted(set(req["needs"]) - ctx.room_features(big[0]))
        return f"No venue that seats {req['attendance']} has {', '.join(miss)}"
    return None


def decide_bookings(ctx: Ctx, assign: Assign, locked: dict[str, dict] | None = None,
                    prior_overrides: list[dict] | None = None) -> dict[str, Any]:
    """Decide every Spectra-week request. Returns fest_week (validator format) + explanations.

    `locked` holds decisions an approver already confirmed; they keep their room and time
    and are booked before anything else is decided."""
    order = ctx.data["priority_order"]
    week = Week(ctx, assign)
    base_assign = dict(assign)
    decisions: dict[str, dict] = {}
    explain: dict[str, dict] = {}
    for rid, dec in (locked or {}).items():
        if rid in ctx.cancelled or rid not in ctx.requests:
            continue
        decisions[rid] = dec
        explain[rid] = {"notes": ["Confirmed by an approver; kept exactly as confirmed"], "locked": True}
        if dec.get("status") in ("approved", "alternative_offered"):
            req = ctx.requests[rid]
            # Classes this booking already moved for Week 7 move again first, so the booking keeps its slot.
            moves = dec.get("moves") or [{"session_id": o["session_id"], "to": [o["day"], o["start_period"], o["room_id"]]}
                                         for o in (prior_overrides or []) if o.get("displaced_by") == rid]
            saved = (dict(week.assign), dict(week.overrides))
            for m in moves:
                if m["session_id"] in week.assign:
                    week.move_session(m["session_id"], tuple(m["to"]), rid)
            if not any(week.blockers(req, dec["room_id"], dec["day"], dec["start_period"]).values()):
                week.book(rid, dec["room_id"], dec["day"], dec["start_period"], req["duration_periods"], req)
                explain[rid]["moved_sessions"] = [m["session_id"] for m in moves]
            else:
                week.assign, week.overrides = saved
                week._rebuild()
                decisions.pop(rid)
                explain[rid] = {"notes": ["A confirmed booking no longer fits after a timetable change; re-decided"]}

    def prio(req):
        return (order.index(ctx.effective_category(req)), req["submitted_at"], req["id"])

    live = sorted((r for r in ctx.requests.values() if r["id"] not in ctx.cancelled and r["id"] not in decisions),
                  key=prio)
    for rid in ctx.cancelled:
        if rid in ctx.requests:
            decisions[rid] = {"request_id": rid, "status": "rejected",
                              "reason": "Withdrawn by the requester before the decision"}
            explain[rid] = {"notes": ["Listed in cancellations; never approved"]}

    for rank, req in enumerate(live, 1):
        rid = req["id"]
        eff = ctx.effective_category(req)
        notes = []
        if eff != req["requested_category"]:
            notes.append(f"Asked for {CATEGORY_LABEL.get(req['requested_category'])} priority, but a "
                         f"{ROLE_LABEL.get(req['role'], req['role'])} request is capped at {CATEGORY_LABEL[eff]}")
        rr = req.get("requested_room")
        if rr and rr not in ctx.rooms:
            notes.append(f"Room {rr} does not exist")
        elif rr and not ctx.room_fits_request(req, ctx.rooms[rr]):
            r = ctx.rooms[rr]
            why = []
            if r["capacity"] < req["attendance"]:
                why.append(f"seats {r['capacity']}")
            miss = set(req["needs"]) - ctx.room_features(r)
            if miss:
                why.append(f"lacks {', '.join(sorted(miss))}")
            if r["type"] not in req["room_types"]:
                why.append(f"is a {r['type'].replace('_', ' ')}")
            notes.append(f"Requested {rr} {' and '.join(why) or 'does not fit'}")
        for w in req["windows"]:
            if w["to_period"] > MAX_PERIOD:
                notes.append(f"Requested time runs past 10 pm (P{w['to_period']}); the campus day ends at P{MAX_PERIOD}")

        hard = _fit_problems(ctx, req)
        if hard:
            decisions[rid] = {"request_id": rid, "status": "rejected", "reason": hard}
            explain[rid] = {"rank": rank, "category": eff, "notes": notes}
            continue

        places = _rank_placements(ctx, req, ctx.request_placements(req))
        chosen, lost_to = None, []
        for (room, d, st) in places:
            b = week.blockers(req, room, d, st)
            if not any(b.values()):
                chosen = (room, d, st)
                break
            lost_to.append((room, d, st, b))

        # Institute events may move regular classes for Week 7 only, and move as few as possible:
        # placements are tried in order of how many classes they would disturb.
        moved = []
        if chosen is None and order.index(eff) <= order.index("institute_event"):
            movable = [(len(clash_sessions(b)), i, room, d, st, b) for i, (room, d, st, b) in enumerate(lost_to)
                       if not (b["bookings"] or b["maintenance"] or b["people"])]
            for _n, _i, room, d, st, b in sorted(movable)[:60]:
                per = block(st, req["duration_periods"])
                avoid = {(room, d, p) for p in per}
                busy = {(w, d, p) for w in participants(req) for p in per}
                plan = []
                saved = (dict(week.assign), dict(week.overrides))
                ok = True
                for sid in clash_sessions(b):
                    to = _find_session_move(ctx, week, sid, avoid, busy)
                    if to is None:
                        ok = False
                        break
                    week.move_session(sid, to, rid)
                    plan.append((sid, to))
                if ok:
                    chosen, moved = (room, d, st), plan
                    break
                week.assign, week.overrides = saved
                week._rebuild()

        if chosen:
            room, d, st = chosen
            end = st + req["duration_periods"] - 1
            week.book(rid, room, d, st, req["duration_periods"], req)
            reason = f"{CATEGORY_LABEL[eff]}, handled #{rank} in priority order; {ctx.rooms[room]['name']} is free {fmt_slot(d, st, end)}"
            if rr and rr != room:
                if rr in ctx.rooms and ctx.room_fits_request(req, ctx.rooms[rr]):
                    taken = week.blockers(req, rr, d, st)
                    if taken["bookings"]:
                        o = ctx.requests[taken["bookings"][0]]
                        why_rr = f"{rr} went to {o['requester']} ({o['id']}), who has priority or asked first"
                    else:
                        why_rr = f"{rr} is not free then"
                else:
                    why_rr = next((n for n in notes if n.startswith(("Requested", "Room"))), f"{rr} does not fit")
                reason += f". {why_rr}; {ctx.rooms[room]['name']} meets every need"
            if participants(req) and not moved:
                reason += ". Everyone attending is free then, so no class moves"
            if moved:
                reason += ". Moved for Week 7 only: " + ", ".join(f"{sid} to {to[0]} P{to[1]} {to[2]}" for sid, to in moved)
            decisions[rid] = {"request_id": rid, "status": "approved", "day": d, "start_period": st,
                              "end_period": end, "room_id": room, "reason": reason}
            if moved:
                decisions[rid]["moves"] = [{"session_id": sid, "from": list(base_assign[sid]), "to": list(to)} for sid, to in moved]
            explain[rid] = {"rank": rank, "category": eff, "notes": notes, "moved_sessions": [m[0] for m in moved]}
            continue

        # why it failed inside the window
        why = []
        for (room, d, st, b) in lost_to[:50]:
            if b["bookings"]:
                other = ctx.requests[b["bookings"][0]]
                why.append(f"{room} is taken by {other['requester']} ({other['id']}, {CATEGORY_LABEL[ctx.effective_category(other)]}, higher or earlier)")
            elif b["people"]:
                w, other, p = b["people"][0]
                why.append(f"{ctx.faculty[w]['name'] if w in ctx.faculty else w} is already at {ctx.requests[other]['title'] if other in ctx.requests else other} at {d} P{p}")
            elif b["groups"]:
                g, sid, p = b["groups"][0]
                why.append(f"{g} has {sid} at {d} P{p}, and attendance is compulsory")
            elif b["faculty"]:
                f, sid, p = b["faculty"][0]
                why.append(f"{ctx.faculty[f]['name']} teaches {sid} at {d} P{p}, and is attending")
            elif b["sessions"]:
                why.append(f"{room} has a regular class ({b['sessions'][0]}); only institute events may move classes")
            elif b["maintenance"]:
                why.append(f"{room} is closed for maintenance")
        if not places:
            why.append(notes[-1] if notes else "No valid time inside the requested window")
        main = why[0] if why else "No free venue in the requested window"
        alt = _alternative(ctx, week, req)
        if alt:
            room, d, st = alt
            end = st + req["duration_periods"] - 1
            week.book(rid, room, d, st, req["duration_periods"], req)
            decisions[rid] = {"request_id": rid, "status": "alternative_offered", "day": d, "start_period": st,
                              "end_period": end, "room_id": room,
                              "reason": f"{main}. Nearest free option: {ctx.rooms[room]['name']}, {fmt_slot(d, st, end)}"}
        else:
            decisions[rid] = {"request_id": rid, "status": "rejected", "reason": main}
        explain[rid] = {"rank": rank, "category": eff, "notes": notes, "blocked_by": why[:5]}

    ordered = [decisions[r] for r in ctx.requests if r in decisions]
    overrides = [{"session_id": sid, "day": d, "start_period": st, "room_id": r, "displaced_by": by}
                 for sid, (d, st, r, by) in week.overrides.items()]
    score = sum(CAT_WEIGHT[ctx.effective_category(ctx.requests[x["request_id"]])] *
                (1 if x["status"] == "approved" else 0.5 if x["status"] == "alternative_offered" else 0)
                for x in ordered if x["request_id"] not in ctx.cancelled)
    max_score = sum(CAT_WEIGHT[ctx.effective_category(r)] for r in ctx.requests.values() if r["id"] not in ctx.cancelled)
    return {"fest_week": {"bookings": ordered, "session_overrides": overrides},
            "explain": explain, "score": score, "max_score": max_score}
