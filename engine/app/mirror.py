"""Turns the engine's working state into rows for the Supabase tables
(see supabase/migrations/0002_engine_store.sql). Pure Python, no I/O."""
from __future__ import annotations

import hashlib
from typing import Any

from .model import block

HELD = ("approved", "alternative_offered")


def _week_assign(state) -> dict:
    a = dict(state.assign)
    for o in state.fest.get("session_overrides", []):
        a[o["session_id"]] = (o["day"], o["start_period"], o["room_id"])
    return a


def build(state) -> dict[str, list[dict[str, Any]]]:
    ctx, data = state.ctx, state.data
    out: dict[str, list[dict[str, Any]]] = {}

    # ---------------------------------------------------------------- reference data
    out["rooms"] = [{"id": r["id"], "name": r["name"], "building": r.get("building"), "type": r["type"],
                     "capacity": r["capacity"], "features": list(r.get("features", [])),
                     "accessible": bool(r.get("accessible")), "allowed_uses": list(r.get("allowed_uses", []))}
                    for r in data["rooms"]]
    seen: dict[tuple, dict] = {}
    for u in data.get("room_unavailability", []):
        for p in u["periods"]:
            seen.setdefault((u["room_id"], u["day"], p),
                            {"room_id": u["room_id"], "day": u["day"], "period": p, "reason": u.get("reason")})
    out["room_unavailability"] = list(seen.values())
    out["faculty"] = [{"id": f["id"], "name": f["name"], "department": f.get("department"),
                       "max_hours_per_day": f.get("max_hours_per_day", 4),
                       "needs_accessible": bool(f.get("needs_accessible")),
                       "unavailable": f.get("unavailable", []), "preferences": f.get("preferences", [])}
                      for f in data["faculty"]]
    out["student_groups"] = [{"id": g["id"], "name": g["name"], "year": g.get("year"),
                              "department": g.get("department"), "size": g["size"],
                              "needs_accessible": bool(g.get("needs_accessible"))} for g in data["student_groups"]]
    out["courses"] = [{"id": c["id"], "title": c["title"], "department": c.get("department"), "year": c.get("year"),
                       "lecture_hours": c.get("lecture_hours", 0), "tutorial_hours": c.get("tutorial_hours", 0),
                       "lab_blocks": c.get("lab_blocks", 0)} for c in data["courses"]]
    out["class_sessions"] = [{"id": s["id"], "course_id": s["course_id"], "kind": s["kind"],
                              "groups": list(s["groups"]), "faculty_id": s["faculty_id"], "size": s["size"],
                              "duration": s["duration"], "room_types": list(s["room_types"]),
                              "needs_accessible": bool(s.get("needs_accessible")),
                              "basket_slot": s.get("basket_slot"), "fixed_slot": s.get("fixed_slot")}
                             for s in data["sessions"]]

    # ---------------------------------------------------------------- timetable + clash locks
    slots, room_occ, fac_occ, grp_occ = [], {}, {}, {}
    overrides = {o["session_id"]: o for o in state.fest.get("session_overrides", [])}
    for week, assign in (("regular", state.assign), ("spectra", _week_assign(state))):
        for sid, (day, start, rid) in sorted(assign.items()):
            s = ctx.sessions.get(sid)
            if s is None:
                continue
            per = block(start, s["duration"])
            slots.append({"week": week, "session_id": sid, "day": day, "start_period": start, "end_period": per[-1],
                          "room_id": rid,
                          "moved_for": overrides[sid].get("displaced_by") if week == "spectra" and sid in overrides
                          else None})
            key = s.get("basket_slot") or sid
            for p in per:
                room_occ[(week, rid, day, p)] = {"week": week, "room_id": rid, "day": day, "period": p,
                                                 "occupant_type": "class", "occupant_id": sid,
                                                 "_dup": (week, rid, day, p) in room_occ}
                fac_occ[(week, s["faculty_id"], day, p)] = {"week": week, "faculty_id": s["faculty_id"], "day": day,
                                                            "period": p, "session_id": sid,
                                                            "_dup": (week, s["faculty_id"], day, p) in fac_occ}
                for g in s["groups"]:
                    prev = grp_occ.get((week, g, day, p))
                    grp_occ[(week, g, day, p)] = {"week": week, "group_id": g, "day": day, "period": p,
                                                  "occupant_key": key,
                                                  "_dup": bool(prev and prev["occupant_key"] != key)}
    held = [b for b in state.fest.get("bookings", []) if b.get("status") in HELD and b.get("day")]
    for b in held:
        req = ctx.requests.get(b["request_id"], {})
        for p in range(b["start_period"], b["end_period"] + 1):
            k = ("spectra", b["room_id"], b["day"], p)
            room_occ[k] = {"week": "spectra", "room_id": b["room_id"], "day": b["day"], "period": p,
                           "occupant_type": "booking", "occupant_id": b["request_id"], "_dup": k in room_occ}
            for g in req.get("mandatory_for_groups", []) or []:
                gk = ("spectra", g, b["day"], p)
                grp_occ[gk] = {"week": "spectra", "group_id": g, "day": b["day"], "period": p,
                               "occupant_key": b["request_id"], "_dup": gk in grp_occ}
    out["timetable_slots"] = slots
    # A clash the engine let through (it should never happen) is written twice on purpose,
    # so the database's primary key refuses it and engine_state.mirror_error says where.
    out["room_occupancy"] = _with_dups(room_occ)
    out["faculty_occupancy"] = _with_dups(fac_occ)
    out["group_occupancy"] = _with_dups(grp_occ)

    # ---------------------------------------------------------------- venue requests and bookings
    original = set(state.original_request_ids)
    decisions = {b["request_id"]: b for b in state.fest.get("bookings", [])}
    reqs: list[dict] = []

    def add(req: dict, st: str, dec: dict | None) -> None:
        conf = state.confirmations.get(req["id"]) or {}
        reqs.append({
            "id": req["id"], "source": "dataset" if req["id"] in original else "app", "state": st,
            "submitted_at": req["submitted_at"], "requester": req["requester"],
            "requester_username": state.requesters.get(req["id"]), "role": req["role"],
            "department": req.get("department"), "requested_category": req["requested_category"],
            "effective_category": ctx.effective_category(req), "title": req["title"],
            "attendance": req["attendance"], "duration_periods": req["duration_periods"],
            "windows": req["windows"], "room_types": list(req.get("room_types", [])),
            "needs": list(req.get("needs", [])), "requested_room": req.get("requested_room"),
            "mandatory_for_groups": list(req.get("mandatory_for_groups") or []),
            "series_id": req.get("series_id"), "raw_text": req.get("raw_text"),
            "decision_status": dec.get("status") if dec else None, "decision": dec,
            "explain": state.booking_explain.get(req["id"], {}),
            "confirmed_by": conf.get("by"), "confirmed_at": conf.get("at"),
        })

    for rid, req in ctx.requests.items():
        add(req, "cancelled" if rid in ctx.cancelled else "decided", decisions.get(rid))
    for p in state.pending_bookings.values():
        add(p["request"], "pending", p.get("proposal"))
    known = {r["id"] for r in reqs}
    for c in state.closed_bookings:
        if c["request"]["id"] not in known:
            add(c["request"], "turned_down", c.get("decision"))
    out["venue_requests"] = reqs
    out["venue_bookings"] = [{"request_id": b["request_id"], "status": b["status"], "room_id": b["room_id"],
                              "day": b["day"], "start_period": b["start_period"], "end_period": b["end_period"],
                              "reason": b.get("reason"), "confirmed": b["request_id"] in state.locked}
                             for b in held if b["request_id"] in known]

    # ---------------------------------------------------------------- exams
    exams = {e["id"]: e for e in data["exams"]}
    out["exam_placements"], out["exam_room_slots"] = [], []
    for p in state.exams:
        e = exams.get(p["exam_id"])
        if not e:
            continue
        out["exam_placements"].append({"exam_id": p["exam_id"], "course_ids": list(e["course_ids"]),
                                       "groups": list(e["groups"]), "size": e["size"],
                                       "duration_hours": e["duration_hours"], "day": p["day"],
                                       "session": p["session"], "rooms": list(p["rooms"])})
        for r in p["rooms"]:
            out["exam_room_slots"].append({"day": p["day"], "session": p["session"], "room_id": r,
                                           "exam_id": p["exam_id"]})

    # ---------------------------------------------------------------- change requests
    changes = {c["id"]: c for c in state.applied_changes}
    changes.update(state.pending_changes)
    skip = {"id", "kind", "status", "by", "at", "approved_by", "approved_at", "note", "changes", "diff",
            "assign", "data"}
    out["change_requests"] = [{"id": c["id"], "kind": c.get("kind", "disruption"), "status": c.get("status", ""),
                               "requested_by": c.get("by"), "requested_at": c.get("at"),
                               "approved_by": c.get("approved_by"), "approved_at": c.get("approved_at"),
                               "note": c.get("note"), "changes": c.get("changes", []), "diff": c.get("diff"),
                               "details": {k: v for k, v in c.items() if k not in skip}}
                              for c in changes.values()]

    # ---------------------------------------------------------------- audit (append-only)
    out["audit_log"] = []
    for a in state.audit:
        extra = {k: v for k, v in a.items() if k not in ("at", "actor", "action", "detail")}
        fp = hashlib.sha1(f"{a['at']}|{a['actor']}|{a['action']}|{a['detail']}".encode()).hexdigest()
        out["audit_log"].append({"fingerprint": fp, "at": a["at"], "actor": a["actor"], "action": a["action"],
                                 "detail": a["detail"], "extra": extra})
    return out


def _with_dups(d: dict) -> list[dict]:
    rows = []
    for r in d.values():
        dup = r.pop("_dup")
        rows.append(r)
        if dup:
            rows.append(dict(r))
    return rows


def clashes(mirror: dict) -> list[str]:
    """Clash keys present in a mirror (for tests and the health check)."""
    out = []
    for t, key in (("room_occupancy", ("week", "room_id", "day", "period")),
                   ("faculty_occupancy", ("week", "faculty_id", "day", "period")),
                   ("group_occupancy", ("week", "group_id", "day", "period"))):
        seen = set()
        for r in mirror[t]:
            k = tuple(r[c] for c in key)
            if k in seen:
                out.append(f"{t}: {k}")
            seen.add(k)
    return out
