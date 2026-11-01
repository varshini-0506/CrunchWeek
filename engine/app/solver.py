"""Timetable solver (OR-Tools CP-SAT).

One boolean per feasible (session, day, start, room). Hard rules are constraints;
the validator's soft penalties S1-S6 are the objective. The model is also
"Spectra-aware": for every live booking request that touches teaching hours, it
may reserve one placement (room free, mandatory groups free), rewarded by the
request's priority weight, so the weekly timetable leaves room for Week 7.

The same model does minimum-move repair: pass a baseline and every session that
leaves its baseline slot costs a large penalty.

A fresh solve is lexicographic (three stages, each locks the ones before):
  1. minimise the validator's soft penalty (proved optimal), keeping as many
     Spectra venue slots free as possible as the tie-break;
  2. spread classes over rooms, so closing any one room forces few moves;
  3. avoid 8 am starts, building changes between back-to-back classes, and hours
     where every suitable room is taken.
Stages 2 and 3 can never cost a single validator point.
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from .checker import Assign
from .model import CAT_WEIGHT, LAST_TEACHING, Ctx, block

# Objective weights. Soft-penalty weights equal the validator's points so the
# objective is the validator's soft total, scaled by SOFT.
SOFT = 1
RESERVE_WEIGHT = 100     # per priority point of a request kept possible
MOVE_WEIGHT = 10_000     # per session moved away from the baseline (repair)
TIME_MOVE_EXTRA = 2_000  # a time change is worse than a room-only change
EARLY_WEIGHT = 2         # stage 2: a class starting at 8 am (P1)
WALK_WEIGHT = 3          # stage 2: a group changes building between back-to-back periods
SPARE_WEIGHT = 2         # stage 2: every room a session could use is busy (no room-only fix if one closes)


def building_of(room: dict) -> str:
    """'Library Building (1st floor, no lift)' and 'Library Building' are one walk."""
    return room.get("building", room["id"]).split(" (")[0].strip()


@dataclass
class SolveResult:
    status: str
    assign: Assign
    reserved: dict[str, tuple[str, str, int]] = field(default_factory=dict)
    objective: float | None = None
    seconds: float = 0.0
    trace: dict[str, Any] = field(default_factory=dict)
    conflicts: list[str] = field(default_factory=list)


def _reservable_requests(ctx: Ctx) -> list[dict]:
    """Live requests whose windows touch teaching periods: only those depend on the timetable."""
    out = []
    for rid, req in ctx.requests.items():
        if rid in ctx.cancelled:
            continue
        if any(w["from_period"] <= LAST_TEACHING for w in req["windows"]):
            out.append(req)
    return out


def solve_timetable(
    ctx: Ctx,
    time_limit: float = 60.0,
    workers: int = 8,
    baseline: Assign | None = None,
    reserve_bookings: bool = True,
    seed: int = 7,
    two_stage: bool | None = None,
) -> SolveResult:
    """two_stage defaults to True for a fresh solve and False for a repair.
    In two-stage mode, stage 1 gets up to time_limit, stage 2 up to 0.3x and stage 3 up to 0.75x."""
    if two_stage is None:
        two_stage = not baseline
    t0 = time.time()
    m = cp_model.CpModel()
    days = ctx.days
    P = range(1, LAST_TEACHING + 1)

    x: dict[tuple[str, str, int, str], cp_model.IntVar] = {}
    by_session = defaultdict(list)
    room_cover = defaultdict(list)    # (room, day, p) -> vars
    fac_cover = defaultdict(list)     # (fac, day, p) -> vars
    time_var = {}                     # (sid, day, start) -> bool (session starts then)
    grp_terms = defaultdict(list)     # (group, day, p) -> vars (non-basket) / basket time bools
    fac_day_hours = defaultdict(list)
    soft_terms = []                   # the validator's S1-S6 points, exactly
    extra_terms = []                  # everything else (reservations, quality, moves)
    grp_bld = defaultdict(list)       # (group, day, p, building) -> x vars (non-basket)

    for sid, s in ctx.sessions.items():
        f = s["faculty_id"]
        rooms = ctx.candidate_rooms(s)
        if not rooms:
            return SolveResult("INFEASIBLE", {}, conflicts=[f"{sid}: no room has type {s['room_types']}, "
                                                          f"capacity {s['size']} and the needed access"])
        any_slot = False
        for d in ctx.valid_days(s):
            for st in ctx.valid_starts(s):
                per = block(st, s["duration"])
                if any((d, p) in ctx.fac_unavail[f] for p in per):
                    continue
                tv = m.NewBoolVar(f"t[{sid},{d},{st}]")
                time_var[(sid, d, st)] = tv
                rv = []
                for r in rooms:
                    if any((d, p) in ctx.room_unavail[r] for p in per):
                        continue
                    v = m.NewBoolVar(f"x[{sid},{d},{st},{r}]")
                    x[(sid, d, st, r)] = v
                    rv.append(v)
                    by_session[sid].append(v)
                    for p in per:
                        room_cover[(r, d, p)].append(v)
                        if not s.get("basket_slot"):
                            for g in s["groups"]:
                                grp_bld[(g, d, p, building_of(ctx.rooms[r]))].append(v)
                    # S5: room under 40% full
                    if ctx.rooms[r]["capacity"] and s["size"] / ctx.rooms[r]["capacity"] < 0.4:
                        soft_terms.append((1 * SOFT, v))
                if not rv:
                    m.Add(tv == 0)
                    continue
                any_slot = True
                m.Add(sum(rv) == tv)
                for p in per:
                    fac_cover[(f, d, p)].append(tv)
                fac_day_hours[(f, d)].append((s["duration"], tv))
                # S1 faculty avoid preferences, S6 P9
                s1 = 0
                for pref in ctx.faculty[f].get("preferences", []):
                    if pref.get("type") == "avoid" and d in pref.get("days", days):
                        s1 += 2 * sum(1 for p in per if p in pref["periods"])
                if s1:
                    soft_terms.append((s1 * SOFT, tv))
                if LAST_TEACHING in per:
                    soft_terms.append((1 * SOFT, tv))
                if two_stage and st == 1:
                    extra_terms.append((EARLY_WEIGHT, tv))
        if not any_slot:
            return SolveResult("INFEASIBLE", {}, conflicts=[f"{sid}: no day/period/room is allowed for it"])
        m.AddExactlyOne(by_session[sid])

    # session-level time indicator per (sid, day, start) is already exclusive via room sums
    # Room: at most one thing per period
    for vs in room_cover.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)
    # Faculty: one place at a time
    for vs in fac_cover.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)
    # Faculty daily limit
    for (f, d), terms in fac_day_hours.items():
        mx = ctx.faculty[f].get("max_hours_per_day", 4)
        m.Add(sum(h * v for h, v in terms) <= mx)

    # Elective baskets: all sessions in a basket share (day, start); groups see the basket once
    baskets = defaultdict(list)
    for sid, s in ctx.sessions.items():
        if s.get("basket_slot"):
            baskets[s["basket_slot"]].append(sid)
    basket_time = {}
    for b, sids in baskets.items():
        lead = sids[0]
        slots = {(d, st) for (sid, d, st) in time_var if sid == lead}
        for other in sids[1:]:
            slots &= {(d, st) for (sid, d, st) in time_var if sid == other}
        for (sid, d, st), tv in list(time_var.items()):
            if sid in sids and (d, st) not in slots:
                m.Add(tv == 0)
        for d, st in slots:
            bt = m.NewBoolVar(f"b[{b},{d},{st}]")
            basket_time[(b, d, st)] = bt
            for sid in sids:
                m.Add(time_var[(sid, d, st)] == bt)

    # Group occupancy
    occ = {}
    for (sid, d, st), tv in time_var.items():
        s = ctx.sessions[sid]
        if s.get("basket_slot"):
            continue
        for p in block(st, s["duration"]):
            for g in s["groups"]:
                grp_terms[(g, d, p)].append(tv)
    for (b, d, st), bt in basket_time.items():
        s = ctx.sessions[baskets[b][0]]
        for p in block(st, s["duration"]):
            for g in s["groups"]:
                grp_terms[(g, d, p)].append(bt)
    for g in ctx.groups:
        for d in days:
            for p in P:
                terms = grp_terms.get((g, d, p), [])
                o = m.NewBoolVar(f"o[{g},{d},{p}]")
                if terms:
                    m.Add(sum(terms) == o)  # also enforces at most one
                else:
                    m.Add(o == 0)
                occ[(g, d, p)] = o

    # S2 gaps: an empty period with class before and after it on the same day
    for g in ctx.groups:
        for d in days:
            before = {}
            after = {}
            for p in P:
                b = m.NewBoolVar("")
                if p == 1:
                    m.Add(b == 0)
                else:
                    m.AddMaxEquality(b, [occ[(g, d, q)] for q in range(1, p)])
                before[p] = b
                a = m.NewBoolVar("")
                if p == LAST_TEACHING:
                    m.Add(a == 0)
                else:
                    m.AddMaxEquality(a, [occ[(g, d, q)] for q in range(p + 1, LAST_TEACHING + 1)])
                after[p] = a
            for p in P:
                gap = m.NewBoolVar("")
                m.Add(gap >= before[p] + after[p] - 1 - occ[(g, d, p)])
                soft_terms.append((1 * SOFT, gap))

    # S3: more than 6 hours in a day (basket counted once)
    for g in ctx.groups:
        for d in days:
            hours = sum(occ[(g, d, p)] for p in P)
            over = m.NewIntVar(0, LAST_TEACHING, "")
            m.Add(over >= hours - 6)
            soft_terms.append((3 * SOFT, over))

    # S4: same course lecture twice in a day for a group
    lect = defaultdict(list)
    for (sid, d, st), tv in time_var.items():
        s = ctx.sessions[sid]
        if s["kind"] == "lecture" and not s.get("basket_slot"):
            for g in s["groups"]:
                lect[(g, d, s["course_id"])].append(tv)
        if s.get("basket_slot"):
            lect[("__basket__", d, s["course_id"])].append(tv)
    for terms in lect.values():
        if len(terms) > 1:
            over = m.NewIntVar(0, len(terms), "")
            m.Add(over >= sum(terms) - 1)
            soft_terms.append((3 * SOFT, over))

    # Spectra-aware reservations
    reserve_vars = {}
    if reserve_bookings:
        req_room_cover = defaultdict(list)
        for req in _reservable_requests(ctx):
            places = ctx.request_placements(req)
            if not places:
                continue
            w = CAT_WEIGHT[ctx.effective_category(req)]
            opts = []
            for (r, d, st) in places:
                per = block(st, req["duration_periods"])
                y = m.NewBoolVar(f"y[{req['id']},{r},{d},{st}]")
                opts.append(y)
                reserve_vars[(req["id"], r, d, st)] = y
                for p in per:
                    if p <= LAST_TEACHING:
                        for v in room_cover.get((r, d, p), []):
                            m.AddImplication(y, v.Not())
                        for g in req["mandatory_for_groups"]:
                            if (g, d, p) in occ:
                                m.AddImplication(y, occ[(g, d, p)].Not())
                    req_room_cover[(r, d, p)].append(y)
            served = m.NewBoolVar(f"served[{req['id']}]")
            m.Add(sum(opts) == served)
            extra_terms.append((-RESERVE_WEIGHT * w, served))
        for vs in req_room_cover.values():
            if len(vs) > 1:
                m.AddAtMostOne(vs)

    # Minimum-move repair
    if baseline:
        for sid, (bd, bst, br) in baseline.items():
            if sid not in ctx.sessions:
                continue
            same = x.get((sid, bd, bst, br))
            same_time = time_var.get((sid, bd, bst))
            moved = m.NewBoolVar(f"moved[{sid}]")
            if same is None:
                m.Add(moved == 1)
            else:
                m.Add(moved == 1 - same)
            extra_terms.append((MOVE_WEIGHT, moved))
            if same_time is None:
                extra_terms.append((TIME_MOVE_EXTRA, moved))
            else:
                tm = m.NewBoolVar("")
                m.Add(tm == 1 - same_time)
                extra_terms.append((TIME_MOVE_EXTRA, tm))
            if same is not None:
                m.AddHint(same, 1)
    # Stage-2 quality: building changes between back-to-back classes of a group
    walk_vars = []
    if two_stage:
        blds = sorted({building_of(r) for r in ctx.rooms.values()})
        for g in ctx.groups:
            for d in days:
                for p in range(1, LAST_TEACHING):
                    if p == ctx.lunch_after:
                        continue          # lunch break gives time to walk
                    for b in blds:
                        here = grp_bld.get((g, d, p, b))
                        if not here:
                            continue
                        nxt_same = grp_bld.get((g, d, p + 1, b), [])
                        w = m.NewBoolVar("")
                        # in b at p, in class at p+1, but not in b at p+1  ->  walk
                        m.Add(w >= sum(here) + occ[(g, d, p + 1)] - sum(nxt_same) - 1)
                        walk_vars.append(w)
                        extra_terms.append((WALK_WEIGHT, w))

    # Stage-2 resilience: keep a spare suitable room at each teaching hour, so a room
    # closure can be fixed by moving only the room, never the time
    spare_vars = []
    if two_stage:
        sets = {tuple(sorted(ctx.candidate_rooms(s))) for s in ctx.sessions.values()}
        for rs in sets:
            if len(rs) < 2 or len(rs) > 6:
                continue          # one room: nothing to spare; many rooms: never all full
            for d in days:
                for p in P:
                    used = [v for r in rs for v in room_cover.get((r, d, p), [])]
                    if len(used) < len(rs):
                        continue
                    full = m.NewBoolVar("")
                    m.Add(full >= sum(used) - (len(rs) - 1))
                    spare_vars.append(full)
                    extra_terms.append((SPARE_WEIGHT, full))

    soft_expr = sum(c * v for c, v in soft_terms)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = workers
    solver.parameters.random_seed = seed
    trace: dict[str, Any] = {"variables": len(x)}
    if two_stage:
        # Stage 1: soft penalty first, Spectra reservations only as a tie-break.
        # LEX_WEIGHT is larger than every reservation reward together, so one soft
        # point always outweighs all reservations: the optimum is lexicographic.
        reserve_sum = sum(-c * v for c, v in extra_terms if c < 0)
        reserve_max = sum(-c for c, _ in extra_terms if c < 0)
        lex = reserve_max + 1
        m.Minimize(lex * soft_expr - reserve_sum)
        solver.parameters.max_time_in_seconds = time_limit
        st1 = solver.Solve(m)
        if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolveResult(solver.StatusName(st1), {}, seconds=time.time() - t0)
        best = sum(c * solver.Value(v) for c, v in soft_terms)
        best_reserve = sum(-c * solver.Value(v) for c, v in extra_terms if c < 0)
        bound = solver.BestObjectiveBound()
        trace["stage1"] = {"status": solver.StatusName(st1), "soft": best,
                           "soft_lower_bound": max(0, int(-(-(round(bound) + reserve_max) // lex))),
                           "reserved_weight": best_reserve, "seconds": round(time.time() - t0, 1)}
        m.Add(soft_expr <= best)
        if reserve_max:
            m.Add(reserve_sum >= best_reserve)

        def rehint() -> None:
            m.ClearHints()
            for v in x.values():
                m.AddHint(v, solver.Value(v))

        # Stage 2 (resilience): spread classes over rooms, so closing any one room
        # forces as few moves as possible. Rooms that are the only one of their kind
        # are left out, since their load can't change.
        per_room = defaultdict(list)
        for (sid, d, st, r), v in x.items():
            if len(ctx.candidate_rooms(ctx.sessions[sid])) > 1:
                per_room[r].append(v)
        if per_room:
            max_load = m.NewIntVar(0, len(ctx.sessions), "max_load")
            for vs in per_room.values():
                m.Add(max_load >= sum(vs))
            rehint()
            m.Minimize(max_load)
            solver = cp_model.CpSolver()
            solver.parameters.num_search_workers = workers
            solver.parameters.random_seed = seed
            solver.parameters.max_time_in_seconds = max(5.0, time_limit * 0.3)
            st2 = solver.Solve(m)
            if st2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                load = solver.Value(max_load)
                m.Add(max_load <= load)
                trace["stage2"] = {"status": solver.StatusName(st2), "busiest_room_classes": load,
                                   "seconds": round(time.time() - t0, 1)}
        # Stage 3 (students' week and spare rooms), everything above locked
        rehint()
        m.Minimize(sum(c * v for c, v in extra_terms if c > 0))
        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = workers
        solver.parameters.random_seed = seed
        solver.parameters.max_time_in_seconds = max(5.0, time_limit * 0.75)
    else:
        m.Minimize(soft_expr + sum(c * v for c, v in extra_terms))
        solver.parameters.max_time_in_seconds = time_limit
    st = solver.Solve(m)
    name = solver.StatusName(st)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResult(name, {}, seconds=time.time() - t0)
    if two_stage:
        trace["stage3"] = {"status": name, "objective": solver.ObjectiveValue(),
                           "building_changes": sum(solver.Value(w) for w in walk_vars),
                           "hours_without_spare_room": sum(solver.Value(f) for f in spare_vars),
                           "eight_am_classes": sum(1 for (sid, d, st), tv in time_var.items()
                                                   if st == 1 and solver.Value(tv))}
        # Report the stage-1 status as the timetable's status: it is what the soft score depends on
        name = trace["stage1"]["status"]
    assign: Assign = {}
    for (sid, d, s0, r), v in x.items():
        if solver.Value(v):
            assign[sid] = (d, s0, r)
    reserved = {}
    for (rq, r, d, s0), y in reserve_vars.items():
        if solver.Value(y):
            reserved[rq] = (r, d, s0)
    trace["best_bound"] = solver.BestObjectiveBound()
    return SolveResult(name, assign, reserved, solver.ObjectiveValue(), time.time() - t0, trace=trace)
