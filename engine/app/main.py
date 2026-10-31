"""CrunchWeek engine: constraint checker, solvers and arbiter live behind this API."""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .checker import RULE_TEXT, check_move, check_timetable, soft_score
from .data import DatasetError, load_dataset, summarize, validate_shape
from .export import build_schedule
from .model import Ctx
from .solver import solve_timetable

app = FastAPI(title="CrunchWeek Engine", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory working state. Phase 3 moves it into Postgres.
STATE: dict[str, Any] = {}


def _reset(data: dict[str, Any]) -> None:
    STATE.clear()
    STATE.update({"data": data, "ctx": Ctx(data), "assign": {}, "reserved": {}, "solve": None})


_reset(load_dataset())


def _ctx() -> Ctx:
    return STATE["ctx"]


@app.get("/health")
def health() -> dict[str, Any]:
    import ortools
    return {"status": "ok", "solver": f"ortools {ortools.__version__}", "dataset_id": STATE["data"]["dataset_id"]}


@app.get("/rules")
def rules() -> dict[str, str]:
    return RULE_TEXT


# ---------------------------------------------------------------- dataset
@app.get("/dataset/summary")
def dataset_summary() -> dict[str, Any]:
    return summarize(STATE["data"])


@app.post("/dataset")
def replace_dataset(payload: dict[str, Any]) -> dict[str, Any]:
    """Admin uploads a dataset in the starter-pack format."""
    try:
        validate_shape(payload)
    except DatasetError as e:
        raise HTTPException(status_code=422, detail=str(e))
    _reset(payload)
    return summarize(payload)


@app.post("/dataset/reset")
def reset_dataset() -> dict[str, Any]:
    _reset(load_dataset())
    return summarize(STATE["data"])


# ---------------------------------------------------------------- timetable
class GenerateIn(BaseModel):
    time_limit: float = 60.0
    reserve_bookings: bool = True


def _report() -> dict[str, Any]:
    ctx, assign = _ctx(), STATE["assign"]
    violations = check_timetable(ctx, assign)
    soft, total = soft_score(ctx, assign)
    return {"scheduled": len(assign), "total_sessions": len(ctx.sessions),
            "hard_violations": violations, "hard_violation_count": len(violations),
            "soft_penalties": soft, "soft_total": total}


@app.post("/timetable/generate")
def generate(body: GenerateIn = GenerateIn()) -> dict[str, Any]:
    res = solve_timetable(_ctx(), time_limit=body.time_limit, reserve_bookings=body.reserve_bookings)
    if not res.assign:
        raise HTTPException(status_code=409, detail={"status": res.status, "conflicts": res.conflicts})
    STATE["assign"], STATE["reserved"] = res.assign, res.reserved
    STATE["solve"] = {"status": res.status, "seconds": round(res.seconds, 2), "objective": res.objective,
                      "reserved_for_bookings": res.reserved, **res.trace}
    return {"solve": STATE["solve"], **_report()}


@app.get("/timetable")
def timetable() -> dict[str, Any]:
    ctx = _ctx()
    rows = []
    for sid, (d, p, r) in sorted(STATE["assign"].items()):
        s = ctx.sessions[sid]
        rows.append({"session_id": sid, "course_id": s["course_id"], "kind": s["kind"], "groups": s["groups"],
                     "faculty_id": s["faculty_id"], "size": s["size"], "duration": s["duration"],
                     "day": d, "start_period": p, "room_id": r, "basket_slot": s.get("basket_slot")})
    return {"sessions": rows, "solve": STATE["solve"], **_report()}


class MoveIn(BaseModel):
    session_id: str
    day: str
    start_period: int
    room_id: str


@app.post("/timetable/check-move")
def check_move_ep(body: MoveIn) -> dict[str, Any]:
    """Live preview: which rules a proposed placement would break. Changes nothing."""
    if body.session_id not in _ctx().sessions:
        raise HTTPException(status_code=404, detail=f"Unknown session {body.session_id}")
    v = check_move(_ctx(), STATE["assign"], body.session_id, body.day, body.start_period, body.room_id)
    return {"ok": not v, "violations": v}


@app.get("/export/schedule.json")
def export_schedule() -> dict[str, Any]:
    if not STATE["assign"]:
        raise HTTPException(status_code=409, detail="Generate the timetable first")
    return build_schedule(STATE["data"]["dataset_id"], STATE["assign"])
