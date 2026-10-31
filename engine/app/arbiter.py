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


class Week:
    """Occupancy of the Spectra week: base timetable + overrides + approved bookings."""

    def __init__(self, ctx: Ctx, assign: Assign):
        self.ctx = ctx
        self.assign = dict(assign)
        self.overrides: dict[str, tuple[str, int, str, str]] = {}
        self._rebuild()
        self.booked: dict[tuple[str, str, int], str] = {}

    def _rebuild(self) -> None:
        self.room_sessions: dict[tuple[str, str, int], str] = {}
        for sid, (d, st, r) in self.assign.items():
            s = self.ctx.sessions.get(sid)
            if s:
                for p in block(st, s["duration"]):
                    self.room_sessions[(r, d, p)] = sid
        self.grp = group_occupancy(self.ctx, self.assign)

    def blockers(self, req: dict, room: str, day: str, start: int) -> dict[str, list]:
        out = {"bookings": [], "sessions": [], "groups": [], "maintenance": []}
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
        return {k: sorted(set(v)) for k, v in out.items()}

    def book(self, req_id: str, room: str, day: str, start: int, dur: int) -> None:
        for p in block(start, dur):
            self.booked[(room, day, p)] = req_id

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


def _find_session_move(ctx: Ctx, week: Week, sid: str, avoid: set[tuple[str, str, int]]) -> tuple[str, int, str] | None:
    """Nearest valid new placement for a session displaced by an institute event."""
    s = ctx.sessions[sid]
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


def decide_bookings(ctx: Ctx, assign: Assign, locked: dict[str, dict] | None = None) -> dict[str, Any]:
    """Decide every Spectra-week request. Returns fest_week (validator format) + explanations.

    `locked` holds decisions an approver already confirmed; they keep their room and time
    and are booked before anything else is decided."""
    order = ctx.data["priority_order"]
    week = Week(ctx, assign)
    decisions: dict[str, dict] = {}
    explain: dict[str, dict] = {}
    for rid, dec in (locked or {}).items():
        if rid in ctx.cancelled or rid not in ctx.requests:
            continue
        decisions[rid] = dec
        explain[rid] = {"notes": ["Confirmed by an approver; kept as decided"], "locked": True}
        if dec.get("status") in ("approved", "alternative_offered"):
            req = ctx.requests[rid]
            if not any(week.blockers(req, dec["room_id"], dec["day"], dec["start_period"]).values()):
                week.book(rid, dec["room_id"], dec["day"], dec["start_period"], req["duration_periods"])
            else:
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

        # institute events may move regular sessions (Week 7 only)
        moved = []
        if chosen is None and order.index(eff) <= order.index("institute_event"):
            for (room, d, st, b) in lost_to:
                if b["bookings"] or b["maintenance"] or b["groups"]:
                    continue
                avoid = {(room, d, p) for p in block(st, req["duration_periods"])}
                plan = []
                saved = (dict(week.assign), dict(week.overrides))
                ok = True
                for sid in b["sessions"]:
                    to = _find_session_move(ctx, week, sid, avoid)
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
            week.book(rid, room, d, st, req["duration_periods"])
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
            if moved:
                reason += ". Moved for Week 7 only: " + ", ".join(f"{sid} to {to[0]} P{to[1]} {to[2]}" for sid, to in moved)
            decisions[rid] = {"request_id": rid, "status": "approved", "day": d, "start_period": st,
                              "end_period": end, "room_id": room, "reason": reason}
            explain[rid] = {"rank": rank, "category": eff, "notes": notes, "moved_sessions": [m[0] for m in moved]}
            continue

        # why it failed inside the window
        why = []
        for (room, d, st, b) in lost_to[:50]:
            if b["bookings"]:
                other = ctx.requests[b["bookings"][0]]
                why.append(f"{room} is taken by {other['requester']} ({other['id']}, {CATEGORY_LABEL[ctx.effective_category(other)]}, higher or earlier)")
            elif b["groups"]:
                g, sid, p = b["groups"][0]
                why.append(f"{g} has {sid} at {d} P{p}, and attendance is compulsory")
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
            week.book(rid, room, d, st, req["duration_periods"])
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
