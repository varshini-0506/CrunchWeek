"""CrunchWeek engine package."""
from __future__ import annotations

import os
from pathlib import Path


def _load_env_file() -> None:
    """Read KEY=value lines from engine/.env (then the repo-root .env) into the environment.
    Values already set in the real environment win. No extra dependency needed."""
    here = Path(__file__).resolve().parents[1]
    for f in (here / ".env", here.parent / ".env"):
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip().removeprefix("export ").strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                v = v[1:-1]
            if k and k not in os.environ:
                os.environ[k] = v


if os.environ.get("CRUNCHWEEK_SKIP_DOTENV") != "1":
    _load_env_file()
