"""Vercel loads this file. The FastAPI app itself lives in engine.app.main."""
from engine.app.main import app

__all__ = ["app"]
