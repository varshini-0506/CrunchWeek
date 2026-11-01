"""The quantum-inspired verifier: always passes a clean week, always catches a clash,
and always agrees with our deterministic checker."""
import copy
import random

import pytest

from app import main
from app.checker import check_timetable
from app.qverify import certificate, build_week, verify

CLASH_RULES = {"H2", "H3", "H4", "H7", "H8"}


@pytest.fixture(scope="module", autouse=True)
def seeded():
    main.seed_or_generate("test")
    yield


def test_clean_week_and_spectra_week_pass():
    S = main.STATE
    r = verify(S.ctx, S.assign)
    assert r["clash_free"] and r["local_ok"] and r["rounds_passed"] == r["rounds"]
    assert r["error_bound"] < 1e-100
    r2 = verify(S.ctx, S.assign, S.fest)
    assert r2["clash_free"], r2["clashes"]


def _clashing(S, kind):
    ctx, a = S.ctx, dict(S.assign)
    sids = list(a)
    if kind == "room":
        s1, s2 = sids[0], next(x for x in sids[1:] if ctx.sessions[x]["duration"] == ctx.sessions[sids[0]]["duration"])
        a[s2] = (a[s1][0], a[s1][1], a[s1][2])
    elif kind == "teacher":
        f = ctx.sessions[sids[0]]["faculty_id"]
        s2 = next(x for x in sids[1:] if ctx.sessions[x]["faculty_id"] == f and a[x][:2] != a[sids[0]][:2])
        a[s2] = (a[sids[0]][0], a[sids[0]][1], a[s2][2])
    return a


@pytest.mark.parametrize("kind", ["room", "teacher"])
def test_planted_clash_is_caught_and_located(kind):
    S = main.STATE
    r = verify(S.ctx, _clashing(S, kind))
    assert not r["clash_free"] and r["clashes"]
    assert any(c["kind"] in ("room", "teacher", "section") for c in r["clashes"])


def test_a_dishonest_certificate_is_rejected():
    S = main.STATE
    a = _clashing(S, "room")
    tokens, _ = build_week(S.ctx, a)
    honest = certificate(tokens)
    # hide the clash by listing the repeated token twice: fails the ordering check
    dup = sorted(honest + [honest[0]])
    assert not verify(S.ctx, a, cert=dup)["clash_free"]
    # or by dropping a token: fails the polynomial identity
    assert not verify(S.ctx, S.assign, cert=certificate(build_week(S.ctx, S.assign)[0])[1:])["clash_free"]


def test_agrees_with_checker_on_300_random_moves():
    S = main.STATE
    ctx = S.ctx
    rng = random.Random(7)
    rooms = list(ctx.rooms)
    agree = 0
    for _ in range(300):
        a = copy.deepcopy(S.assign)
        for _k in range(rng.choice([1, 1, 2])):
            sid = rng.choice(list(a))
            s = ctx.sessions[sid]
            a[sid] = (rng.choice(ctx.days), rng.randint(1, 10 - s["duration"]), rng.choice(rooms))
        truth = any(v["rule"] in CLASH_RULES for v in check_timetable(ctx, a))
        r = verify(ctx, a, rounds=4)
        assert (not r["clash_free"]) == truth
        agree += 1
    assert agree == 300
