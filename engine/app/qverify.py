"""Quantum-inspired verifier.

Proves in one pass that a finished week is clash-free, without comparing any two
classes against each other.

How it works
1. Occupancy tokens. Every hour that a room, teacher or section is busy becomes one
   token, e.g. ("room", "LH-1", "MON", 3). Hours a room is closed or a teacher is
   unavailable are added as tokens too, so a class placed there collides with them.
   Sections share one token per elective basket, because parallel basket classes
   are allowed.
2. Certificate. The planner hands over its claim: the same tokens, sorted, with no
   repeats. The verifier checks the order in one linear pass, so the claim can't
   hide a repeat.
3. Equation. "The week is clash-free" becomes "the token multiset equals the
   certificate". Each side is encoded as a polynomial over the field of the
   Mersenne prime 2^61-1,
       A(x) = prod (x - h(token))   for every token in the week,
       B(x) = prod (x - h(token))   for every token in the certificate,
   and the two are evaluated at independent sample points. Equal multisets give
   equal polynomials, so a clash-free week always passes. If anything collides,
   A and B are different polynomials of degree n, they agree on at most n of the
   2^61-1 points, so each round lets a wrong week through with probability at most
   n / (2^61-1), and k rounds with at most (n / (2^61-1))^k.
4. Local rules (capacity, room type, labs at P2/P6, no class over lunch, teaching
   window, fixed slots, daily hour limits, basket alignment) are per-class facts
   and are checked directly in the same pass.
5. Localise. When the equation fails, the same check runs on each resource-and-day
   slice to say where the clash is.

Everything here is our own code and runs in milliseconds. The official validator
remains the judge of record; tests check that both always agree.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from collections import defaultdict
from typing import Any

from .model import Ctx

P = (1 << 61) - 1  # Mersenne prime field
LAST_TEACHING = 9
MAX_PERIOD = 13
Token = tuple[str, str, str, int]


def _h(tok: Token) -> int:
    d = hashlib.blake2b("|".join(map(str, tok)).encode(), digest_size=8).digest()
    return int.from_bytes(d, "big") % P


def _poly_at(hashes: list[int], x: int) -> int:
    acc = 1
    for v in hashes:
        acc = acc * ((x - v) % P) % P
    return acc


def build_week(ctx: Ctx, assign: dict, fest: dict | None = None) -> tuple[list[Token], list[dict]]:
    """Occupancy tokens for a week, plus every local-rule problem found on the way."""
    tokens: list[Token] = []
    local: list[dict] = []
    place = dict(assign)
    if fest:
        for o in fest.get("session_overrides", []):
            place[o["session_id"]] = (o["day"], o["start_period"], o["room_id"])
    fac_day: dict[tuple[str, str], int] = defaultdict(int)
    basket_time: dict[str, set] = defaultdict(set)
    group_seen: set[tuple[str, str, int, str]] = set()
    for sid, s in ctx.sessions.items():
        if sid not in place:
            local.append({"rule": "placed", "detail": f"{sid} has no slot"})
            continue
        day, start, rid = place[sid]
        r = ctx.rooms.get(rid)
        per = list(range(start, start + s["duration"]))
        if r is None or day not in ctx.days:
            local.append({"rule": "exists", "detail": f"{sid}: unknown room or day"})
            continue
        if per[0] < 1 or per[-1] > LAST_TEACHING:
            local.append({"rule": "teaching window", "detail": f"{sid} runs outside 8 am to 5 pm"})
        if per[0] <= ctx.lunch_after < per[-1]:
            local.append({"rule": "lunch", "detail": f"{sid} runs through lunch"})
        if s["kind"] == "lab" and start not in ctx.lab_starts:
            local.append({"rule": "lab start", "detail": f"{sid} lab starts at P{start}"})
        if r["capacity"] < s["size"]:
            local.append({"rule": "capacity", "detail": f"{sid}: {s['size']} students, {rid} seats {r['capacity']}"})
        if r["type"] not in s["room_types"]:
            local.append({"rule": "room type", "detail": f"{sid} can't use a {r['type']}"})
        if ctx.needs_accessible(s) and not r["accessible"]:
            local.append({"rule": "accessible", "detail": f"{sid} needs an accessible room"})
        fx = s.get("fixed_slot")
        if fx and not fest and (fx["day"], fx["start_period"]) != (day, start):
            local.append({"rule": "fixed slot", "detail": f"{sid} is fixed elsewhere"})
        fac_day[(s["faculty_id"], day)] += s["duration"]
        key = s.get("basket_slot") or sid
        if s.get("basket_slot") and not fest:
            basket_time[s["basket_slot"]].add((day, start))
        for p in per:
            tokens.append(("room", rid, day, p))
            tokens.append(("teacher", s["faculty_id"], day, p))
            for g in s["groups"]:
                if s.get("basket_slot"):
                    if (g, day, p, key) in group_seen:
                        continue
                    group_seen.add((g, day, p, key))
                tokens.append(("section", g, day, p))
    for (f, day), hrs in fac_day.items():
        if hrs > ctx.faculty.get(f, {}).get("max_hours_per_day", 4):
            local.append({"rule": "daily hours", "detail": f"{f} teaches {hrs} hours on {day}"})
    for b, times in basket_time.items():
        if len(times) > 1:
            local.append({"rule": "basket", "detail": f"basket {b} is split across times"})
    # closed rooms and unavailable teachers are occupied hours too
    for rid, slots in ctx.room_unavail.items():
        for day, p in slots:
            tokens.append(("room", rid, day, p))
    for f, slots in ctx.fac_unavail.items():
        for day, p in slots:
            tokens.append(("teacher", f, day, p))
    # Spectra events hold their room and everyone attending
    if fest:
        for b in fest.get("bookings", []):
            if b.get("status") not in ("approved", "alternative_offered") or not b.get("room_id"):
                continue
            req = ctx.requests.get(b["request_id"], {})
            who = [("section", g) for g in req.get("mandatory_for_groups", [])] + [("teacher", f) for f in req.get("attending_faculty", [])]
            for p in range(b["start_period"], b["end_period"] + 1):
                if p > MAX_PERIOD:
                    local.append({"rule": "event window", "detail": f"{b['request_id']} runs past 10 pm"})
                tokens.append(("room", b["room_id"], b["day"], p))
                for kind, x in who:
                    tokens.append((kind, x, b["day"], p))
    return tokens, local


def certificate(tokens: list[Token]) -> list[Token]:
    """What the planner claims: every busy hour once, in order."""
    return sorted(set(tokens))


def verify(ctx: Ctx, assign: dict, fest: dict | None = None, rounds: int = 8,
           cert: list[Token] | None = None) -> dict[str, Any]:
    t0 = time.perf_counter()
    tokens, local = build_week(ctx, assign, fest)
    cert = certificate(tokens) if cert is None else cert
    ordered = all(cert[i] < cert[i + 1] for i in range(len(cert) - 1))
    ha, hb = [_h(t) for t in tokens], [_h(t) for t in cert]
    points = [secrets.randbelow(P) for _ in range(rounds)]
    passed = [ordered and _poly_at(ha, x) == _poly_at(hb, x) for x in points]
    clash_free = all(passed)
    where: list[dict] = []
    if not clash_free:
        # localise: rerun the same identity on each resource-and-day slice
        by = defaultdict(list)
        for t in tokens:
            by[(t[0], t[2])].append(t)
        x = points[0]
        for (kind, day), ts in sorted(by.items()):
            c = certificate(ts)
            if _poly_at([_h(t) for t in ts], x) != _poly_at([_h(t) for t in c], x):
                seen, dup = set(), set()
                for t in ts:
                    (dup if t in seen else seen).add(t)
                where += [{"kind": k, "who": w, "day": d, "period": p} for (k, w, d, p) in sorted(dup)]
    n = len(tokens)
    per_round = n / P
    return {
        "verdict": "clash-free" if clash_free and not local else "problems found",
        "clash_free": clash_free,
        "local_ok": not local,
        "tokens": n,
        "distinct": len(cert),
        "rounds": rounds,
        "rounds_passed": sum(passed),
        "field": "2^61 - 1",
        "error_bound": per_round ** rounds if clash_free else None,
        "error_bound_per_round": per_round,
        "clashes": where[:50],
        "local_problems": local[:50],
        "counts": {
            "classes": len(ctx.sessions),
            "rooms": len({t[1] for t in tokens if t[0] == "room"}),
            "teachers": len({t[1] for t in tokens if t[0] == "teacher"}),
            "sections": len({t[1] for t in tokens if t[0] == "section"}),
        },
        "ms": round((time.perf_counter() - t0) * 1000, 2),
    }
