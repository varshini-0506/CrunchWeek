import importlib.util
import random
from pathlib import Path

import pytest

from app.checker import check_timetable, soft_score
from app.data import load_dataset
from app.model import Ctx
from app.solver import solve_timetable

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("official_validator", ROOT / "validator.py")
official = importlib.util.module_from_spec(spec)
spec.loader.exec_module(official)


@pytest.fixture(scope="module")
def ctx():
    return Ctx(load_dataset())


@pytest.fixture(scope="module")
def solved(ctx):
    res = solve_timetable(ctx, time_limit=60)
    assert res.assign, res.status
    return res


def _official(ctx, assign):
    vctx = official.Ctx(ctx.data)
    v, _ = official.check_timetable(vctx, assign, "timetable")
    _, soft = official.soft_score(vctx, assign)
    return v, soft


def test_solver_has_zero_hard_violations(ctx, solved):
    assert check_timetable(ctx, solved.assign) == []
    v, _ = _official(ctx, solved.assign)
    assert v == []


def test_soft_score_matches_official(ctx, solved):
    _, ours = soft_score(ctx, solved.assign)
    _, theirs = _official(ctx, solved.assign)
    assert ours == theirs


def test_checker_agrees_with_official_on_broken_timetables(ctx, solved):
    """Randomly break the timetable; our checker must flag it whenever the official one does."""
    rng = random.Random(1)
    sids = list(ctx.sessions)
    rooms = list(ctx.rooms)
    for _ in range(200):
        a = dict(solved.assign)
        for sid in rng.sample(sids, 3):
            a[sid] = (rng.choice(ctx.days), rng.randint(1, 9), rng.choice(rooms))
        theirs, _ = _official(ctx, a)
        ours = check_timetable(ctx, a, strict=False)
        assert {(x["rule"], x["detail"].split(":")[0]) for x in theirs} or not ours
        assert bool(theirs) == bool(ours)
        assert sorted(x["rule"] for x in theirs) == sorted(x["rule"] for x in ours)


def test_reserves_spectra_slots(solved):
    # every live request that touches teaching hours got a slot held open
    assert {"BR-01", "BR-03", "BR-08", "BR-19", "BR-20"} <= set(solved.reserved)
