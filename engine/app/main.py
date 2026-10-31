"""CrunchWeek engine API. The web app calls it through its own server routes, which
pass the signed-in user in X-User (and the shared ENGINE_TOKEN when one is set).

Every decision here is made by code: the solvers, the checker and the arbiter.
The optional Claude layer (ai.py) only drafts requests and rewords explanations."""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import ai
from .arbiter import CATEGORY_LABEL, Week, decide_bookings, fmt_slot
from .checker import RULE_TEXT, check_move, check_timetable, soft_score
from .data import DatasetError, load_dataset, summarize, validate_shape
from .exams import check_exams, schedule_exams
from .explain import explain_session, session_options, utilisation
from .export import build_schedule
from .model import LAST_TEACHING, MAX_PERIOD, Ctx
from .repair import CHANGE_TYPES, describe_diff, propose_repair
from .solver import solve_timetable
from .state import LOCK, SEED_FILE, STATE, State

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not STATE.assign and os.environ.get("AUTO_GENERATE", "1") != "0":
        run_job("generate", lambda: seed_or_generate("system"), "system")
    yield


app = FastAPI(title="CrunchWeek Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)

ENGINE_TOKEN = os.environ.get("ENGINE_TOKEN", "")
SOLVE_SECONDS = float(os.environ.get("SOLVE_SECONDS", "60"))
REPAIR_SECONDS = float(os.environ.get("REPAIR_SECONDS", "45"))

# Demo accounts. Faculty F01 and the Robotics Club match people in the dataset.
USERS: dict[str, dict[str, Any]] = {
    "admin": {"username": "admin", "name": "Registrar's Office", "role": "admin", "department": None},
    "dean": {"username": "dean", "name": "Dean, Student Affairs", "role": "admin", "department": None},
    "coord.cse": {"username": "coord.cse", "name": "CSE Department Coordinator", "role": "department_coordinator",
                  "department": "CSE"},
    "F01": {"username": "F01", "name": "Dr. Ananya Mishra", "role": "faculty", "department": "CSE",
            "faculty_id": "F01"},
    "club.robotics": {"username": "club.robotics", "name": "Robotics Club", "role": "club", "department": None},
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def current_user(x_user: str | None = Header(default=None), x_engine_token: str | None = Header(default=None)) -> dict:
    if ENGINE_TOKEN and x_engine_token != ENGINE_TOKEN:
        raise HTTPException(401, "Missing or wrong engine token")
    if x_user and x_user in USERS:
        return USERS[x_user]
    return {"username": "guest", "name": "Guest", "role": "guest", "department": None}


def need(user: dict, *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(403, f"This needs one of: {', '.join(roles)}")


def need_timetable() -> None:
    if not STATE.assign:
        raise HTTPException(409, "No timetable yet. An admin needs to generate it first.")


# ------------------------------------------------------------------ background jobs
def run_job(kind: str, fn, actor: str) -> dict:
    with LOCK:
        if STATE.job.get("status") == "running":
            raise HTTPException(409, f"Busy: {STATE.job['kind']} is still running")
        STATE.job = {"kind": kind, "status": "running", "started": now(), "by": actor}

    def work():
        t0 = time.time()
        try:
            result = fn()
            with LOCK:
                STATE.job = {"kind": kind, "status": "done", "finished": now(), "seconds": round(time.time() - t0, 1),
                             "result": result, "by": actor}
                STATE.save()
        except Exception as e:  # noqa: BLE001 - surface any failure to the UI
            with LOCK:
                STATE.job = {"kind": kind, "status": "failed", "error": f"{type(e).__name__}: {e}", "by": actor}

    threading.Thread(target=work, daemon=True).start()
    return STATE.job


# ------------------------------------------------------------------ core operations
def week_assign() -> dict:
    """Base timetable with Spectra-week overrides applied."""
    a = dict(STATE.assign)
    for o in STATE.fest.get("session_overrides", []):
        a[o["session_id"]] = (o["day"], o["start_period"], o["room_id"])
    return a


def full_generate(time_limit: float, actor: str) -> dict:
    ctx = STATE.ctx
    res = solve_timetable(ctx, time_limit=time_limit)
    if not res.assign:
        STATE.log(actor, "generate_failed", f"No timetable: {res.status}", conflicts=res.conflicts)
        return {"status": res.status, "conflicts": res.conflicts}
    ex = schedule_exams(ctx)
    b = decide_bookings(ctx, res.assign)
    with LOCK:
        STATE.assign = res.assign
        STATE.baseline = {}
        STATE.exams, STATE.exam_penalty = ex.placements, ex.penalty
        STATE.fest, STATE.booking_explain = b["fest_week"], b["explain"]
        STATE.booking_score = (b["score"], b["max_score"])
        STATE.locked = {}
        STATE.solve_info = {"status": res.status, "seconds": round(res.seconds, 1), "objective": res.objective,
                            "reserved_for_bookings": res.reserved, "exam_status": ex.status,
                            "exam_seconds": round(ex.seconds, 1), **res.trace}
        STATE.first_schedule = export_current()
        STATE.applied_changes = []
        STATE.log(actor, "generate", f"Timetable {res.status} in {res.seconds:.0f}s; exams {ex.status}; "
                  f"{sum(1 for x in b['fest_week']['bookings'] if x['status'] == 'approved')} bookings approved")
    return {"status": res.status, "seconds": round(res.seconds, 1)}


def redecide(actor: str, note: str) -> None:
    """Re-run the arbiter, keeping every confirmed decision as it is."""
    b = decide_bookings(STATE.ctx, STATE.assign, locked=STATE.locked)
    STATE.fest, STATE.booking_explain = b["fest_week"], b["explain"]
    STATE.booking_score = (b["score"], b["max_score"])
    STATE.log(actor, "bookings_redecided", note)


def export_current() -> dict:
    """schedule.json for the current state, in the validator's format, dataset requests only."""
    orig = set(STATE.original_request_ids)
    fest = {"bookings": [b for b in STATE.fest["bookings"] if b["request_id"] in orig],
            "session_overrides": [o for o in STATE.fest["session_overrides"] if o["displaced_by"] in orig]}
    return build_schedule(STATE.data["dataset_id"], STATE.assign, fest, STATE.exams)


def report(ctx: Ctx, assign: dict) -> dict:
    v = check_timetable(ctx, assign)
    soft, total = soft_score(ctx, assign)
    return {"scheduled": len(assign), "total_sessions": len(ctx.sessions), "hard_violations": v,
            "hard_violation_count": len(v), "soft_penalties": soft, "soft_total": total}


def seed_or_generate(actor: str) -> dict:
    if SEED_FILE.exists():
        fresh = State.__new__(State)
        fresh.reset(load_dataset())
        if fresh.load(SEED_FILE):
            with LOCK:
                for k, v in vars(fresh).items():
                    if k != "job":
                        setattr(STATE, k, v)
                STATE.log(actor, "reset", "Demo reset to the seeded timetable")
                STATE.save()
            return {"status": "seeded"}
    with LOCK:
        STATE.reset(load_dataset())
    out = full_generate(SOLVE_SECONDS, actor)
    if STATE.assign:
        STATE.save(SEED_FILE)
    return out




# ------------------------------------------------------------------ basics
@app.get("/health")
def health() -> dict:
    import ortools
    return {"status": "ok", "solver": f"ortools {ortools.__version__}", "dataset_id": STATE.data["dataset_id"],
            "timetable": bool(STATE.assign), "job": {k: v for k, v in STATE.job.items() if k != "result"},
            "ai": ai.ai_enabled()}


@app.get("/rules")
def rules() -> dict:
    return RULE_TEXT


@app.get("/users")
def users() -> list[dict]:
    return list(USERS.values())


@app.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user


@app.get("/meta")
def meta() -> dict:
    d = STATE.data
    return {"dataset": summarize(d), "calendar": d["calendar"], "priority_order": d["priority_order"],
            "role_category_cap": d["role_category_cap"], "category_label": CATEGORY_LABEL,
            "rooms": d["rooms"], "faculty": [{k: f[k] for k in ("id", "name", "department")} for f in d["faculty"]],
            "groups": d["student_groups"], "courses": d["courses"], "rules": RULE_TEXT,
            "room_unavailability": d["room_unavailability"], "ai": ai.ai_enabled()}


@app.get("/status")
def status() -> dict:
    s, m = STATE.booking_score
    bk = STATE.fest.get("bookings", [])
    return {"job": STATE.job, "timetable": bool(STATE.assign), "solve": STATE.solve_info,
            "sessions": len(STATE.assign), "total_sessions": len(STATE.ctx.sessions),
            "hard_violations": len(check_timetable(STATE.ctx, STATE.assign)) if STATE.assign else None,
            "soft_total": soft_score(STATE.ctx, STATE.assign)[1] if STATE.assign else None,
            "booking_score": s, "booking_max": m,
            "approved": sum(1 for b in bk if b["status"] == "approved"),
            "alternatives": sum(1 for b in bk if b["status"] == "alternative_offered"),
            "rejected": sum(1 for b in bk if b["status"] == "rejected"),
            "pending_bookings": len(STATE.pending_bookings), "pending_changes": len(STATE.pending_changes),
            "applied_changes": len(STATE.applied_changes), "exam_penalty": STATE.exam_penalty,
            "exams": len(STATE.exams), "ai": ai.ai_enabled()}


# ------------------------------------------------------------------ dataset and demo control
@app.post("/dataset")
def replace_dataset(payload: dict[str, Any], user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    try:
        validate_shape(payload)
        Ctx(payload)
    except (DatasetError, KeyError, TypeError) as e:
        raise HTTPException(422, f"Dataset rejected: {e}")
    with LOCK:
        STATE.reset(payload)
        STATE.log(user["username"], "dataset_uploaded", f"Loaded {payload['dataset_id']}")
    return run_job("generate", lambda: full_generate(SOLVE_SECONDS, user["username"]), user["username"])


@app.post("/reset")
def reset_demo(user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    return run_job("reset", lambda: seed_or_generate(user["username"]), user["username"])


class GenerateIn(BaseModel):
    time_limit: float = SOLVE_SECONDS


@app.post("/generate")
def generate(body: GenerateIn = GenerateIn(), user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    return run_job("generate", lambda: full_generate(min(body.time_limit, 120), user["username"]), user["username"])


@app.get("/job")
def job() -> dict:
    return STATE.job


# ------------------------------------------------------------------ timetable
@app.get("/timetable")
def timetable(week: str = "regular") -> dict:
    need_timetable()
    ctx = STATE.ctx
    assign = week_assign() if week == "spectra" else STATE.assign
    over = {o["session_id"]: o for o in STATE.fest.get("session_overrides", [])} if week == "spectra" else {}
    courses = {c["id"]: c for c in STATE.data["courses"]}
    moved = {m["session_id"] for m in (STATE.applied_changes[-1]["diff"]["moved"] if STATE.applied_changes else [])}
    rows = []
    for sid, (d, p, r) in sorted(assign.items()):
        s = ctx.sessions[sid]
        rows.append({"session_id": sid, "course_id": s["course_id"], "title": courses.get(s["course_id"], {}).get("title"),
                     "kind": s["kind"], "groups": s["groups"], "faculty_id": s["faculty_id"],
                     "faculty_name": ctx.faculty[s["faculty_id"]]["name"], "size": s["size"], "duration": s["duration"],
                     "day": d, "start_period": p, "room_id": r, "basket_slot": s.get("basket_slot"),
                     "fixed": bool(s.get("fixed_slot")), "override_by": over.get(sid, {}).get("displaced_by"),
                     "recently_moved": sid in moved})
    events = []
    if week == "spectra":
        for b in STATE.fest["bookings"]:
            if b["status"] in ("approved", "alternative_offered"):
                req = ctx.requests.get(b["request_id"])
                if req:
                    events.append({**b, "title": req["title"], "requester": req["requester"],
                                   "category": ctx.effective_category(req)})
    return {"week": week, "sessions": rows, "events": events, "solve": STATE.solve_info, **report(ctx, assign)}


@app.get("/timetable/explain/{sid}")
def explain(sid: str, ai_words: bool = False) -> dict:
    need_timetable()
    if sid not in STATE.assign:
        raise HTTPException(404, f"Unknown session {sid}")
    facts = explain_session(STATE.ctx, STATE.assign, sid)
    if ai_words:
        facts["plain"] = ai.reword(facts, f"Why is {sid} at this time and in this room?")
    return facts


@app.get("/timetable/options/{sid}")
def options(sid: str) -> dict:
    need_timetable()
    if sid not in STATE.assign:
        raise HTTPException(404, f"Unknown session {sid}")
    return {"session_id": sid, "current": STATE.assign[sid], "options": session_options(STATE.ctx, STATE.assign, sid)}


class MoveIn(BaseModel):
    session_id: str
    day: str
    start_period: int
    room_id: str
    note: str | None = None


@app.post("/timetable/check-move")
def check_move_ep(body: MoveIn) -> dict:
    need_timetable()
    if body.session_id not in STATE.ctx.sessions:
        raise HTTPException(404, f"Unknown session {body.session_id}")
    v = check_move(STATE.ctx, STATE.assign, body.session_id, body.day, body.start_period, body.room_id)
    trial = dict(STATE.assign)
    trial[body.session_id] = (body.day, body.start_period, body.room_id)
    return {"ok": not v, "violations": v,
            "soft_delta": soft_score(STATE.ctx, trial)[1] - soft_score(STATE.ctx, STATE.assign)[1]}


@app.post("/timetable/move")
def move(body: MoveIn, user: dict = Depends(current_user)) -> dict:
    """A manual edit. Admin edits apply at once; a coordinator's edit waits for an admin."""
    need(user, "admin", "department_coordinator")
    need_timetable()
    s = STATE.ctx.sessions.get(body.session_id)
    if not s:
        raise HTTPException(404, f"Unknown session {body.session_id}")
    if user["role"] == "department_coordinator":
        dept = STATE.ctx.faculty[s["faculty_id"]].get("department")
        if dept != user["department"]:
            raise HTTPException(403, f"{body.session_id} belongs to {dept}; coordinators can move their own department's classes")
    v = check_move(STATE.ctx, STATE.assign, body.session_id, body.day, body.start_period, body.room_id)
    if v:
        raise HTTPException(422, {"message": "That move breaks a rule", "violations": v})
    new = dict(STATE.assign)
    new[body.session_id] = (body.day, body.start_period, body.room_id)
    change = {"id": STATE.next_id("CH"), "kind": "manual_move", "by": user["username"], "at": now(),
              "note": body.note or f"Move {body.session_id}", "changes": [], "assign": new,
              "diff": describe_diff(STATE.ctx, STATE.assign, new), "status": "proposed"}
    with LOCK:
        STATE.pending_changes[change["id"]] = change
        STATE.log(user["username"], "move_proposed", f"{body.session_id} to {body.day} P{body.start_period} {body.room_id}")
    if user["role"] == "admin":
        return approve_change(change["id"], user)
    STATE.save()
    return public_change(change)


# ------------------------------------------------------------------ bookings
def can_approve(user: dict, req: dict, requester: str | None) -> bool:
    if requester == user["username"]:
        return False                      # nobody approves their own request
    if user["role"] == "admin":
        return True
    if user["role"] == "department_coordinator":
        return req["role"] in ("club", "faculty") and req.get("department") in (None, user["department"])
    return False


def _booking_row(req: dict, dec: dict | None, user: dict, state: str) -> dict:
    ctx = STATE.ctx
    requester = STATE.requesters.get(req["id"])
    mine = requester == user["username"] or req["requester"] == user["name"]
    eff = ctx.effective_category(req)
    row = {"request": req, "decision": dec, "state": state, "effective_category": eff,
           "category_label": CATEGORY_LABEL.get(eff, eff), "mine": mine,
           "explain": STATE.booking_explain.get(req["id"], {}),
           "confirmed": req["id"] in STATE.locked,
           "can_approve": state in ("pending", "decided") and can_approve(user, req, requester),
           "can_cancel": mine and state in ("pending", "decided") and req["id"] not in ctx.cancelled}
    if dec and dec.get("day"):
        row["when"] = fmt_slot(dec["day"], dec["start_period"], dec["end_period"])
    return row


@app.get("/bookings")
def bookings(user: dict = Depends(current_user)) -> dict:
    need_timetable()
    ctx = STATE.ctx
    dec = {b["request_id"]: b for b in STATE.fest["bookings"]}
    rows = []
    for rid, req in ctx.requests.items():
        st = "cancelled" if rid in ctx.cancelled else "decided"
        rows.append(_booking_row(req, dec.get(rid), user, st))
    for p in STATE.pending_bookings.values():
        rows.append(_booking_row(p["request"], p["proposal"], user, "pending"))
    for c in STATE.closed_bookings:
        rows.append(_booking_row(c["request"], c["decision"], user, "turned_down"))
    order = STATE.data["priority_order"]
    rows.sort(key=lambda r: (r["state"] != "pending", order.index(r["effective_category"]), r["request"]["submitted_at"]))
    s, m = STATE.booking_score
    return {"rows": rows, "score": s, "max_score": m, "overrides": STATE.fest["session_overrides"],
            "priority_order": order}


class ParseIn(BaseModel):
    text: str
    today: str | None = None


@app.post("/bookings/parse")
def parse_booking(body: ParseIn, user: dict = Depends(current_user)) -> dict:
    if not body.text.strip():
        raise HTTPException(422, "Write what you need first")
    d = STATE.data
    return ai.draft_booking(body.text[:2000], body.today, d["rooms"], d["student_groups"])


class DraftIn(BaseModel):
    title: str
    attendance: int
    duration_periods: int
    windows: list[dict]
    room_types: list[str] = []
    needs: list[str] = []
    requested_room: str | None = None
    mandatory_for_groups: list[str] = []
    requested_category: str = "club_event"
    raw_text: str | None = None


def _draft_problems(body: DraftIn) -> list[str]:
    ctx = STATE.ctx
    errs = []
    if not body.title.strip():
        errs.append("Give the event a title")
    if body.attendance < 1:
        errs.append("Attendance must be at least 1")
    if not 1 <= body.duration_periods <= MAX_PERIOD:
        errs.append("Duration must be between 1 and 13 hours")
    if not body.windows:
        errs.append("Choose at least one day and time window")
    for w in body.windows:
        if w.get("day") not in ctx.days:
            errs.append(f"Unknown day {w.get('day')}")
        elif not (1 <= int(w.get("from_period", 0)) <= int(w.get("to_period", 0)) <= MAX_PERIOD):
            errs.append(f"{w['day']}: the window must be inside P1-P13 (8 am to 10 pm)")
        elif int(w["to_period"]) - int(w["from_period"]) + 1 < body.duration_periods:
            errs.append(f"{w['day']}: the window is shorter than the event")
    if body.requested_room and body.requested_room not in ctx.rooms:
        errs.append(f"Room {body.requested_room} does not exist")
    bad = [g for g in body.mandatory_for_groups if g not in ctx.groups]
    if bad:
        errs.append(f"Unknown groups: {', '.join(bad)}")
    if body.requested_category not in STATE.data["priority_order"]:
        errs.append("Unknown category")
    return errs


def _to_request(body: DraftIn, user: dict, rid: str) -> dict:
    types = body.room_types or ["seminar_hall", "lecture_hall", "auditorium", "classroom", "open_area"]
    return {"id": rid, "submitted_at": now(), "requester": user["name"], "role": user["role"],
            "department": user["department"], "requested_category": body.requested_category,
            "title": body.title.strip()[:120], "attendance": body.attendance, "duration_periods": body.duration_periods,
            "windows": [{"day": w["day"], "from_period": int(w["from_period"]), "to_period": int(w["to_period"])}
                        for w in body.windows], "room_types": types, "needs": body.needs,
            "requested_room": body.requested_room, "mandatory_for_groups": body.mandatory_for_groups,
            "series_id": None, "raw_text": body.raw_text or ""}


def _decide_new(req: dict) -> tuple[dict, dict, list]:
    """Decide one new request against everything already decided (published decisions stay put)."""
    data = copy.deepcopy(STATE.data)
    data["booking_requests"].append(req)
    ctx = Ctx(data)
    locked = {b["request_id"]: b for b in STATE.fest["bookings"]}
    b = decide_bookings(ctx, week_assign(), locked=locked)
    dec = next(x for x in b["fest_week"]["bookings"] if x["request_id"] == req["id"])
    return dec, b["explain"].get(req["id"], {}), b["fest_week"]["session_overrides"]


@app.post("/bookings/preview")
def preview_booking(body: DraftIn, user: dict = Depends(current_user)) -> dict:
    """Live answer for the request form: what the arbiter would decide right now. Changes nothing."""
    need_timetable()
    errs = _draft_problems(body)
    if errs:
        return {"ok": False, "errors": errs}
    req = _to_request(body, user, "PREVIEW")
    dec, exp, _ = _decide_new(req)
    eff = STATE.ctx.effective_category(req)
    out = {"ok": True, "decision": dec, "explain": exp, "effective_category": eff,
           "category_label": CATEGORY_LABEL[eff]}
    if dec.get("day"):
        out["when"] = fmt_slot(dec["day"], dec["start_period"], dec["end_period"])
    return out


@app.post("/bookings")
def submit_booking(body: DraftIn, user: dict = Depends(current_user)) -> dict:
    need(user, "admin", "department_coordinator", "faculty", "club")
    need_timetable()
    errs = _draft_problems(body)
    if errs:
        raise HTTPException(422, {"message": "Fix the request first", "errors": errs})
    with LOCK:
        rid = STATE.next_id("NR")
        req = _to_request(body, user, rid)
        dec, exp, overrides = _decide_new(req)
        STATE.pending_bookings[rid] = {"request": req, "proposal": dec, "explain": exp, "overrides": overrides}
        STATE.requesters[rid] = user["username"]
        STATE.booking_explain[rid] = exp
        STATE.log(user["username"], "booking_submitted", f"{rid} {req['title']}: engine proposes {dec['status']}")
        STATE.save()
    return {"id": rid, "proposal": dec}


class NoteIn(BaseModel):
    note: str | None = None


@app.post("/bookings/{rid}/approve")
def approve_booking(rid: str, body: NoteIn = NoteIn(), user: dict = Depends(current_user)) -> dict:
    with LOCK:
        if rid in STATE.pending_bookings:
            p = STATE.pending_bookings[rid]
            req = p["request"]
            if not can_approve(user, req, STATE.requesters.get(rid)):
                raise HTTPException(403, "You can't approve this request (your own, or outside your area)")
            dec, exp, overrides = _decide_new(req)    # re-check: the week may have changed since submission
            STATE.data["booking_requests"].append(req)
            STATE.ctx = Ctx(STATE.data)
            STATE.fest["bookings"].append(dec)
            STATE.fest["session_overrides"] = overrides
            STATE.locked[rid] = dec
            STATE.booking_explain[rid] = exp
            STATE.confirmations[rid] = {"by": user["username"], "at": now(), "note": body.note}
            del STATE.pending_bookings[rid]
            STATE.log(user["username"], "booking_confirmed", f"{rid}: {dec['status']} - {dec.get('reason', '')}")
            STATE.save()
            return {"id": rid, "decision": dec}
        req = STATE.ctx.requests.get(rid)
        if not req:
            raise HTTPException(404, f"Unknown request {rid}")
        if not can_approve(user, req, STATE.requesters.get(rid)):
            raise HTTPException(403, "You can't confirm this request (your own, or outside your area)")
        dec = next((b for b in STATE.fest["bookings"] if b["request_id"] == rid), None)
        if not dec:
            raise HTTPException(409, "No decision yet")
        STATE.locked[rid] = dec
        STATE.confirmations[rid] = {"by": user["username"], "at": now(), "note": body.note}
        STATE.log(user["username"], "booking_confirmed", f"{rid}: {dec['status']}")
        STATE.save()
        return {"id": rid, "decision": dec}


@app.post("/bookings/confirm-all")
def confirm_all(user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    with LOCK:
        n = 0
        for b in STATE.fest["bookings"]:
            req = STATE.ctx.requests[b["request_id"]]
            if b["request_id"] not in STATE.locked and can_approve(user, req, STATE.requesters.get(b["request_id"])):
                STATE.locked[b["request_id"]] = b
                STATE.confirmations[b["request_id"]] = {"by": user["username"], "at": now(), "note": "confirmed in bulk"}
                n += 1
        STATE.log(user["username"], "bookings_confirmed", f"Confirmed {n} engine decisions")
        STATE.save()
    return {"confirmed": n}


@app.post("/bookings/{rid}/reject")
def reject_booking(rid: str, body: NoteIn = NoteIn(), user: dict = Depends(current_user)) -> dict:
    with LOCK:
        p = STATE.pending_bookings.get(rid)
        if not p:
            raise HTTPException(409, "Only new requests waiting for approval can be turned down here")
        if not can_approve(user, p["request"], STATE.requesters.get(rid)):
            raise HTTPException(403, "You can't decide this request")
        dec = {"request_id": rid, "status": "rejected",
               "reason": f"Turned down by {user['name']}" + (f": {body.note}" if body.note else "")}
        STATE.closed_bookings.append({"request": p["request"], "decision": dec})
        del STATE.pending_bookings[rid]
        STATE.log(user["username"], "booking_turned_down", f"{rid}: {dec['reason']}")
        STATE.save()
    return {"id": rid, "decision": dec}


@app.post("/bookings/{rid}/cancel")
def cancel_booking(rid: str, user: dict = Depends(current_user)) -> dict:
    with LOCK:
        if rid in STATE.pending_bookings:
            if STATE.requesters.get(rid) != user["username"] and user["role"] != "admin":
                raise HTTPException(403, "Only the requester can withdraw this")
            p = STATE.pending_bookings.pop(rid)
            STATE.closed_bookings.append({"request": p["request"], "decision": {
                "request_id": rid, "status": "rejected", "reason": "Withdrawn by the requester"}})
            STATE.log(user["username"], "booking_withdrawn", rid)
            STATE.save()
            return {"id": rid, "status": "withdrawn"}
        req = STATE.ctx.requests.get(rid)
        if not req:
            raise HTTPException(404, f"Unknown request {rid}")
        mine = STATE.requesters.get(rid) == user["username"] or req["requester"] == user["name"]
        if not mine and user["role"] != "admin":
            raise HTTPException(403, "Only the requester can withdraw this")
        STATE.data["cancellations"].append({"request_id": rid, "cancelled_at": now(), "by": user["name"],
                                            "note": "Withdrawn in CrunchWeek"})
        STATE.ctx = Ctx(STATE.data)
        STATE.locked.pop(rid, None)
        redecide(user["username"], f"{rid} withdrawn; its room is free again")
        STATE.save()
    return {"id": rid, "status": "withdrawn"}


@app.post("/bookings/redecide")
def redecide_ep(user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    with LOCK:
        redecide(user["username"], "Re-ran the arbiter; confirmed decisions kept")
        STATE.save()
    return status()


@app.get("/bookings/{rid}/explain")
def booking_explain(rid: str, ai_words: bool = False) -> dict:
    dec = next((b for b in STATE.fest["bookings"] if b["request_id"] == rid), None)
    if not dec and rid in STATE.pending_bookings:
        dec = STATE.pending_bookings[rid]["proposal"]
    if not dec:
        raise HTTPException(404, f"No decision for {rid}")
    facts = {"decision": dec, "details": STATE.booking_explain.get(rid, {}), "reason": dec.get("reason")}
    if ai_words:
        facts["plain"] = ai.reword(facts, "Explain this venue decision to the person who asked for it.")
    return facts


# ------------------------------------------------------------------ disruptions and change requests
def public_change(c: dict) -> dict:
    return {k: v for k, v in c.items() if k not in ("assign", "data")}


class ChangeParseIn(BaseModel):
    text: str
    faculty_id: str | None = None


@app.post("/changes/parse")
def parse_change(body: ChangeParseIn, user: dict = Depends(current_user)) -> dict:
    fid = user.get("faculty_id") or body.faculty_id
    if not fid or fid not in STATE.ctx.faculty:
        raise HTTPException(422, "Say which faculty member this is for")
    return ai.draft_change(body.text[:1000], fid)


class ChangeIn(BaseModel):
    changes: list[dict]
    note: str | None = None


@app.post("/changes/preview")
def preview_change(body: ChangeIn, user: dict = Depends(current_user)) -> dict:
    """Apply a change file to a copy, re-solve with the fewest moves, and store the proposal for approval."""
    need(user, "admin", "department_coordinator", "faculty")
    need_timetable()
    if not body.changes:
        raise HTTPException(422, "No changes given")
    for ch in body.changes:
        if ch.get("type") not in CHANGE_TYPES:
            raise HTTPException(422, f"Unknown change type {ch.get('type')}")
        if user["role"] == "faculty" and (ch["type"] != "faculty_unavailable" or ch.get("faculty_id") != user.get("faculty_id")):
            raise HTTPException(403, "Faculty can report only their own unavailability")
    dis = {"changes": body.changes}
    data, base = copy.deepcopy(STATE.data), dict(STATE.assign)

    def work():
        r = propose_repair(data, base, dis, time_limit=REPAIR_SECONDS)
        cid = STATE.next_id("CH")
        change = {"id": cid, "kind": "disruption", "by": user["username"], "at": now(), "note": body.note,
                  "changes": body.changes, "status": r["status"]}
        if r["status"] == "proposed":
            change.update(assign=r["assign"], data=r["data"], diff=r["diff"], solver=r["solver"],
                          broken_before_fix=r["broken_before_fix"],
                          soft_before=soft_score(STATE.ctx, base)[1], soft_after=soft_score(Ctx(r["data"]), r["assign"])[1])
        elif r["status"] == "infeasible":
            change.update(conflicts=r["conflicts"], broken_before_fix=r["broken_before_fix"])
        else:
            change.update(errors=r.get("errors") or [v["detail"] for v in r.get("violations", [])])
        with LOCK:
            STATE.pending_changes[cid] = change
            STATE.log(user["username"], "change_previewed", f"{cid}: {r['status']}"
                      + (f", {r['diff']['sessions_moved']} sessions would move" if r["status"] == "proposed" else ""))
        return public_change(change)

    return run_job("repair", work, user["username"])


@app.get("/changes")
def changes() -> dict:
    return {"pending": [public_change(c) for c in STATE.pending_changes.values()],
            "applied": [public_change(c) for c in STATE.applied_changes]}


@app.post("/changes/{cid}/approve")
def approve_change(cid: str, user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    with LOCK:
        c = STATE.pending_changes.get(cid)
        if not c:
            raise HTTPException(404, f"Unknown change {cid}")
        if c["status"] != "proposed":
            raise HTTPException(409, "Only a valid proposal can be approved")
        if c["kind"] == "manual_move" and c["by"] != user["username"] and \
                any(tuple(STATE.assign.get(m["session_id"], ())) != (m["from"]["day"], m["from"]["start_period"], m["from"]["room_id"])
                    for m in c["diff"]["moved"]):
            raise HTTPException(409, "The timetable changed since this was proposed; propose it again")
        STATE.baseline = dict(STATE.assign)
        if c.get("data"):
            STATE.set_data(c["data"])
        STATE.assign = {k: tuple(v) for k, v in c["assign"].items()}
        ev, pen = check_exams(STATE.ctx, STATE.exams)
        STATE.exam_penalty = pen
        redecide(user["username"], f"Bookings re-checked after {cid}")
        c["status"] = "applied"
        c["approved_by"], c["approved_at"] = user["username"], now()
        c["exam_issues"] = [v["detail"] for v in ev]
        STATE.applied_changes.append(public_change(c))
        del STATE.pending_changes[cid]
        STATE.log(user["username"], "change_applied", f"{cid}: {c['diff']['sessions_moved']} sessions moved")
        STATE.save()
    return public_change(c)


@app.post("/changes/{cid}/reject")
def reject_change(cid: str, body: NoteIn = NoteIn(), user: dict = Depends(current_user)) -> dict:
    need(user, "admin")
    with LOCK:
        c = STATE.pending_changes.pop(cid, None)
        if not c:
            raise HTTPException(404, f"Unknown change {cid}")
        STATE.log(user["username"], "change_rejected", f"{cid}" + (f": {body.note}" if body.note else ""))
        STATE.save()
    return {"id": cid, "status": "rejected"}


# ------------------------------------------------------------------ exams, analytics, audit
@app.get("/exams")
def exams() -> dict:
    v, pen = check_exams(STATE.ctx, STATE.exams)
    ex = {e["id"]: e for e in STATE.data["exams"]}
    rows = []
    for p in STATE.exams:
        e = ex[p["exam_id"]]
        seats = sum(STATE.ctx.rooms[r]["capacity"] // 2 for r in p["rooms"])
        rows.append({**p, "size": e["size"], "groups": e["groups"], "course_ids": e["course_ids"],
                     "duration_hours": e["duration_hours"], "seats": seats})
    return {"placements": rows, "violations": v, "penalty": pen, "calendar": STATE.data["calendar"]["exam_week"]}


@app.get("/utilisation")
def util() -> dict:
    need_timetable()
    ctx = STATE.ctx
    by_day = {d: 0 for d in ctx.days}
    by_period = {p: 0 for p in range(1, LAST_TEACHING + 1)}
    for sid, (d, st, r) in STATE.assign.items():
        for p in range(st, st + ctx.sessions[sid]["duration"]):
            by_day[d] += 1
            by_period[p] += 1
    fac = []
    for f in ctx.faculty.values():
        hours = sum(ctx.sessions[s]["duration"] for s in STATE.assign if ctx.sessions[s]["faculty_id"] == f["id"])
        fac.append({"faculty_id": f["id"], "name": f["name"], "hours": hours})
    return {"rooms": utilisation(ctx, STATE.assign), "by_day": by_day, "by_period": by_period,
            "faculty_load": sorted(fac, key=lambda x: -x["hours"]), "soft": soft_score(ctx, STATE.assign)[0]}


@app.get("/audit")
def audit(limit: int = 100) -> list[dict]:
    return STATE.audit[:limit]


# ------------------------------------------------------------------ exports and the official validator
def _combined_disruption() -> dict:
    out = []
    for c in STATE.applied_changes:
        out += c.get("changes", [])
    return {"changes": out}


@app.get("/export/schedule.json")
def export_schedule() -> dict:
    need_timetable()
    return STATE.first_schedule or export_current()


@app.get("/export/schedule_after.json")
def export_after() -> dict:
    need_timetable()
    if not STATE.applied_changes:
        raise HTTPException(409, "No change has been approved yet")
    return export_current()


@app.get("/export/disruption.json")
def export_disruption() -> dict:
    return _combined_disruption()


@app.get("/validate")
def validate() -> dict:
    """Run the official validator on what we export, exactly as the judges would."""
    need_timetable()
    from . import validator_bridge
    first = STATE.first_schedule or export_current()
    out = {"schedule": validator_bridge.run(load_original(), first)}
    if STATE.applied_changes:
        out["schedule_after"] = validator_bridge.run(load_original(), export_current(),
                                                     baseline=first, disruption=_combined_disruption())
    return out


def load_original() -> dict:
    d = copy.deepcopy(STATE.original)
    d["booking_requests"] = [r for r in d["booking_requests"] if r["id"] in set(STATE.original_request_ids)]
    return d


@app.get("/samples/disruption")
def sample_disruption() -> dict:
    from pathlib import Path
    p = Path(__file__).resolve().parents[2] / "data" / "samples" / "sample_disruption.json"
    return json.loads(p.read_text()) if p.exists() else {"changes": []}
