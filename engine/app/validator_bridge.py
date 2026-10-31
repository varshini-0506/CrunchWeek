"""Runs the organisers' validator.py (unmodified, in engine/) in-process."""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

_PATH = Path(__file__).resolve().parents[1] / "validator.py"
_spec = importlib.util.spec_from_file_location("official_validator", _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def run(data: dict, schedule: dict, baseline: dict | None = None, disruption: dict | None = None) -> dict[str, Any]:
    if disruption and disruption.get("changes"):
        data = _mod.apply_disruption(data, disruption)
    return _mod.run(data, schedule, baseline)
