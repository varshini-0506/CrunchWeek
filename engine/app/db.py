"""Supabase (Postgres) storage for the engine.

Turned on by DATABASE_URL. Without it the engine keeps working from the JSON file
exactly as before (tests and CI run that way).

Two things are written:
  * engine_state: the full snapshot, so a restart or redeploy picks up where it left off.
  * the mirror tables (rooms, timetable_slots, room_occupancy, venue_bookings, ...),
    so the schedule is queryable and Postgres itself refuses any double booking.

Writes happen on a background thread so API calls never wait on the network. Only
the newest snapshot is written when several saves arrive close together.
"""
from __future__ import annotations

import atexit
import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

log = logging.getLogger("crunchweek.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
STATE_ID = os.environ.get("DB_STATE_ID", "current")

_lock = threading.Condition()
_pending: tuple[dict, dict] | None = None
_worker: threading.Thread | None = None
_last_hash: dict[str, str] = {}
_status: dict[str, Any] = {"enabled": bool(DATABASE_URL), "last_sync": None, "last_error": None}


def enabled() -> bool:
    return bool(DATABASE_URL)


def status() -> dict[str, Any]:
    return dict(_status)


def _connect():
    import psycopg  # imported lazily so the engine runs without it when DATABASE_URL is unset
    # prepare_threshold=None keeps it working through Supabase's transaction pooler too.
    return psycopg.connect(DATABASE_URL, autocommit=True, prepare_threshold=None, connect_timeout=10)


# ------------------------------------------------------------------ load
def load_snapshot() -> dict | None:
    if not enabled():
        return None
    try:
        with _connect() as conn, conn.cursor() as cur:
            cur.execute("select snapshot from public.engine_state where id = %s", (STATE_ID,))
            row = cur.fetchone()
            _status["last_error"] = None
            return row[0] if row else None
    except Exception as e:  # noqa: BLE001 - fall back to the file, but say why
        _status["last_error"] = f"load: {type(e).__name__}: {e}"
        log.warning("Could not load state from Supabase, using the local file: %s", e)
        return None


# ------------------------------------------------------------------ save (async)
def save_async(snapshot: dict, mirror: dict) -> None:
    """Queue the latest snapshot and mirror rows for writing."""
    global _pending, _worker
    if not enabled():
        return
    with _lock:
        _pending = (snapshot, mirror)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="supabase-sync", daemon=True)
            _worker.start()
        _lock.notify()


def flush(timeout: float = 15.0) -> bool:
    """Wait until queued writes are done (used at shutdown and in tests)."""
    end = time.time() + timeout
    with _lock:
        while (_pending is not None or _status.get("busy")) and time.time() < end:
            _lock.wait(0.2)
        return _pending is None and not _status.get("busy")


atexit.register(flush)


def _run() -> None:
    global _pending
    while True:
        with _lock:
            while _pending is None:
                if not _lock.wait(30):
                    return  # idle: let the thread end; the next save starts a new one
            snapshot, mirror = _pending
            _pending = None
            _status["busy"] = True
        try:
            write(snapshot, mirror)
        finally:
            with _lock:
                _status["busy"] = False
                _lock.notify_all()


def _h(obj: Any) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def write(snapshot: dict, mirror: dict) -> None:
    """Write the snapshot, then refresh the mirror tables. Synchronous."""
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        _status["last_error"] = f"connect: {type(e).__name__}: {e}"
        log.warning("Supabase not reachable: %s", e)
        return
    try:
        from psycopg.types.json import Jsonb
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """insert into public.engine_state (id, dataset_id, snapshot, saved_at)
                       values (%s, %s, %s, now())
                       on conflict (id) do update set dataset_id = excluded.dataset_id, snapshot = excluded.snapshot,
                         revision = public.engine_state.revision + 1, saved_at = now()""",
                    (STATE_ID, snapshot["data"]["dataset_id"], Jsonb(snapshot)))
        err = None
        try:
            with conn.transaction():
                with conn.cursor() as cur:
                    _write_mirror(cur, mirror)
        except Exception as e:  # noqa: BLE001 - a clash the database refused, or a schema problem
            err = f"{type(e).__name__}: {e}".strip()[:2000]
            _last_hash.clear()
            log.warning("Supabase refused the mirror update: %s", err)
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("update public.engine_state set mirror_ok = %s, mirror_error = %s, mirrored_at = now() "
                            "where id = %s", (err is None, err, STATE_ID))
        _status["last_sync"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _status["last_error"] = f"mirror: {err}" if err else None
    except Exception as e:  # noqa: BLE001
        _status["last_error"] = f"save: {type(e).__name__}: {e}"
        log.warning("Could not save state to Supabase: %s", e)
    finally:
        conn.close()


# Tables in dependency order: children first for deletes, parents first for inserts.
SECTIONS: list[tuple[str, list[str]]] = [
    ("reference", ["rooms", "room_unavailability", "faculty", "student_groups", "courses", "class_sessions"]),
    ("timetable", ["timetable_slots", "room_occupancy", "faculty_occupancy", "group_occupancy"]),
    ("venues", ["venue_requests", "venue_bookings"]),
    ("exams", ["exam_placements", "exam_room_slots"]),
    ("changes", ["change_requests"]),
]
_DEPENDS = {"timetable": {"reference", "venues"}, "venues": {"reference"}, "exams": {"reference"}}


def _write_mirror(cur, mirror: dict) -> None:
    from psycopg.types.json import Jsonb

    hashes = {name: _h({t: mirror[t] for t in tables}) for name, tables in SECTIONS}
    dirty = {name for name in hashes if _last_hash.get(name) != hashes[name]}
    # a rewritten parent table forces its dependants to be rewritten too
    changed = True
    while changed:
        changed = False
        for name, deps in _DEPENDS.items():
            if name not in dirty and deps & dirty:
                dirty.add(name)
                changed = True
    order = [t for name, tables in SECTIONS if name in dirty for t in tables]
    # room_occupancy references bookings by id only, but delete it before venues all the same
    for t in reversed(_delete_order(order)):
        cur.execute(f"delete from public.{t}")
    for t in order:
        rows = mirror[t]
        if not rows:
            continue
        cols = list(rows[0].keys())
        sql = (f"insert into public.{t} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})")
        js = _JSON_COLS.get(t, ())
        cur.executemany(sql, [tuple(Jsonb(r[c]) if c in js and r[c] is not None else r[c] for c in cols)
                              for r in rows])
    for r in mirror["audit_log"]:
        cur.execute("insert into public.audit_log (fingerprint, at, actor, action, detail, extra) "
                    "values (%s, %s, %s, %s, %s, %s) on conflict (fingerprint) do nothing",
                    (r["fingerprint"], r["at"], r["actor"], r["action"], r["detail"], Jsonb(r["extra"])))
    _last_hash.update(hashes)


def _delete_order(order: list[str]) -> list[str]:
    # parents first, so reversed() deletes children first; timetable rows also hang off venues/rooms
    prio = ["rooms", "faculty", "student_groups", "courses", "room_unavailability", "class_sessions",
            "venue_requests", "venue_bookings", "timetable_slots", "room_occupancy", "faculty_occupancy",
            "group_occupancy", "exam_placements", "exam_room_slots", "change_requests"]
    return sorted(order, key=prio.index)


_JSON_COLS = {
    "faculty": ("unavailable", "preferences"),
    "class_sessions": ("fixed_slot",),
    "venue_requests": ("windows", "decision", "explain"),
    "change_requests": ("changes", "diff", "details"),
}
