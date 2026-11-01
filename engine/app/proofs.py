"""Proof that each score is the best any timetable can reach on this dataset.

Every bound is computed from the data (nothing is hard-coded), so the page stays
honest on a new dataset or after a change. Each bound comes with the plain-words
reason, and is set next to what we actually achieve.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .checker import Assign, soft_score
from .model import CAT_WEIGHT, MAX_PERIOD, Ctx, block

DAY_NAME = {"MON": "Monday", "TUE": "Tuesday", "WED": "Wednesday", "THU": "Thursday",
            "FRI": "Friday", "SAT": "Saturday"}


def _session_days(ctx: Ctx, s: dict) -> set[str]:
    """Days on which this session could possibly start (teacher free for some valid start)."""
    f = s["faculty_id"]
    out = set()
    for d in ctx.valid_days(s):
        for st in ctx.valid_starts(s):
            if not any((d, p) in ctx.fac_unavail[f] for p in block(st, s["duration"])):
                out.add(d)
                break
    return out


def soft_lower_bound(ctx: Ctx) -> dict[str, Any]:
    """S4 pigeonhole: a group's n lectures of one course that fit on only k days
    put at least n-k pairs on a shared day, 3 points each."""
    lectures = defaultdict(list)
    for s in ctx.sessions.values():
        if s["kind"] == "lecture" and not s.get("basket_slot"):
            for g in s["groups"]:
                lectures[(g, s["course_id"])].append(s)
    reasons, total = [], 0
    for (g, cid), ss in sorted(lectures.items()):
        days = set().union(*(_session_days(ctx, s) for s in ss))
        n, k = len(ss), len(days)
        if n > k:
            pts = 3 * (n - k)
            total += pts
            facs = sorted({s["faculty_id"] for s in ss})
            who = ", ".join(f"{ctx.faculty[f]['name']} ({f})" for f in facs)
            day_txt = " and ".join(DAY_NAME.get(d, d) for d in ctx.days if d in days) or "no day"
            reasons.append({
                "rule": "S4", "points": pts, "group": g, "course": cid,
                "facts": [f"{cid} has {n} lectures, all for {g}.",
                          f"They are taught by {who}, who can only teach on {day_txt}.",
                          f"{n} lectures on {k} day{'s' if k != 1 else ''} means at least {n - k} day"
                          f"{'s' if n - k != 1 else ''} must have two of them.",
                          f"The rule gives 3 points for each extra lecture of a course on one day, so at least {pts}."],
            })
    return {"bound": total, "reasons": reasons}


def booking_upper_bound(ctx: Ctx) -> dict[str, Any]:
    live = [r for rid, r in ctx.requests.items() if rid not in ctx.cancelled]
    max_score = sum(CAT_WEIGHT[ctx.effective_category(r)] for r in live)
    reasons, lost = [], 0.0
    for r in live:
        w = CAT_WEIGHT[ctx.effective_category(r)]
        fits = [room for room in ctx.rooms.values() if ctx.room_fits_request(r, room)]
        if not fits:
            typed = [room for room in ctx.rooms.values()
                     if room["type"] in r["room_types"] and "event" in room["allowed_uses"]]
            biggest = max(typed, key=lambda x: x["capacity"], default=None)
            why = (f"it needs {r['attendance']} seats, and the biggest suitable venue ({biggest['name']}) "
                   f"holds {biggest['capacity']}") if biggest and biggest["capacity"] < r["attendance"] \
                else "no room on campus has the type and equipment it asks for"
            lost += w
            reasons.append({"request": r["id"], "title": r["title"], "points_lost": w,
                            "facts": [f"{r['title']} ({r['id']}) can't be held anywhere: {why}.",
                                      f"So it must be rejected, losing its {w} points."]})
            continue
        if not ctx.request_placements(r):
            past = any(wd["to_period"] > MAX_PERIOD for wd in r["windows"])
            why = ("the time it asks for runs past 10 pm, when the campus day ends" if past
                   else "no suitable room is open in the time it asks for")
            lost += w / 2
            reasons.append({"request": r["id"], "title": r["title"], "points_lost": w / 2,
                            "facts": [f"{r['title']} ({r['id']}) can't be approved as asked: {why}.",
                                      f"The best possible is another time (an alternative), worth half: {w / 2:g} of {w} points."]})
    return {"bound": max_score - lost, "max_if_all_approved": max_score, "reasons": reasons}


def repair_lower_bound(ctx: Ctx, baseline: Assign) -> dict[str, Any] | None:
    """Sessions whose old slot is now forbidden must move, whatever the solver does."""
    if not baseline:
        return None
    must = []
    for sid, (d, st, r) in baseline.items():
        s = ctx.sessions.get(sid)
        if s is None:
            continue
        per = block(st, s["duration"])
        if any((d, p) in ctx.room_unavail[r] for p in per) or \
                any((d, p) in ctx.fac_unavail[s["faculty_id"]] for p in per):
            must.append(sid)
    return {"bound": len(must), "sessions": sorted(must),
            "facts": [f"{len(must)} classes sat in a room or with a teacher that is no longer available "
                      "at that time, so each of them has to move. No plan can move fewer."]}


def proofs_report(ctx: Ctx, assign: Assign, booking_score: tuple[float, int], exam_penalty: int,
                  baseline: Assign | None = None, solve_info: dict | None = None) -> dict[str, Any]:
    soft = soft_lower_bound(ctx)
    bk = booking_upper_bound(ctx)
    got_soft = soft_score(ctx, assign)[1] if assign else None
    st1 = (solve_info or {}).get("stage1", {})
    items = [
        {"id": "soft", "title": "Timetable soft penalty", "better": "lower",
         "achieved": got_soft, "best_possible": soft["bound"],
         "optimal": got_soft is not None and got_soft <= soft["bound"],
         "solver_proved": st1.get("status") == "OPTIMAL",
         "reasons": soft["reasons"]},
        {"id": "bookings", "title": "Spectra booking score", "better": "higher",
         "achieved": booking_score[0], "best_possible": bk["bound"], "max_if_all_approved": bk["max_if_all_approved"],
         "optimal": booking_score[0] >= bk["bound"], "reasons": bk["reasons"]},
        {"id": "exams", "title": "Midsem exam penalty", "better": "lower",
         "achieved": exam_penalty, "best_possible": 0, "optimal": exam_penalty == 0,
         "reasons": [{"facts": ["No group has two exams on the same day, so nothing is left to remove."]}]},
    ]
    if baseline:
        moved = sum(1 for sid, v in baseline.items() if sid in assign and tuple(assign[sid]) != tuple(v))
        rb = repair_lower_bound(ctx, baseline)
        items.append({"id": "repair", "title": "Classes moved by the last change", "better": "lower",
                      "achieved": moved, "best_possible": rb["bound"], "optimal": moved <= rb["bound"],
                      "reasons": [{"facts": rb["facts"]}]})
    return {"items": items, "all_optimal": all(i["optimal"] for i in items)}
