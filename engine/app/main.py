"""CrunchWeek engine: constraint checker, solvers and arbiter live behind this API."""
from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .data import DatasetError, load_dataset, summarize, validate_shape

app = FastAPI(title="CrunchWeek Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory working copy of the dataset. Phase 1 moves state into Postgres.
STATE: dict[str, Any] = {"data": load_dataset()}


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        import ortools  # noqa: F401
        solver = f"ortools {ortools.__version__}"
    except Exception:  # pragma: no cover
        solver = "unavailable"
    return {"status": "ok", "solver": solver, "dataset_id": STATE["data"]["dataset_id"]}


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
    STATE["data"] = payload
    return summarize(payload)


@app.post("/dataset/reset")
def reset_dataset() -> dict[str, Any]:
    STATE["data"] = load_dataset()
    return summarize(STATE["data"])
