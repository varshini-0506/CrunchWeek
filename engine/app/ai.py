"""Optional Claude layer. It only drafts and rewords; the engine's code decides everything.

AI is used when ANTHROPIC_API_KEY is set and AI_MODE is not "off". Every AI answer is
checked field by field against the dataset, and the rule-based parser is always the
fallback, so the app works the same with AI switched off.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from .nlp import DAYS, parse_request

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")


def ai_enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and os.environ.get("AI_MODE", "on").lower() != "off"


def _client():
    import anthropic
    return anthropic.Anthropic(timeout=30.0, max_retries=1)


# ------------------------------------------------------------------ booking drafts
class Window(BaseModel):
    day: Literal["MON", "TUE", "WED", "THU", "FRI"]
    from_period: int = Field(description="First period, 1-13")
    to_period: int = Field(description="Last period, inclusive, 1-13")


class BookingDraft(BaseModel):
    title: str
    attendance: int | None
    duration_periods: int | None
    windows: list[Window]
    room_types: list[str]
    needs: list[str]
    requested_room: str | None
    mandatory_for_groups: list[str]
    assumptions: list[str]
    follow_up: list[str]


PERIODS_NOTE = ("Periods: P1 08:00, P2 09:00, P3 10:00, P4 11:00, P5 12:00, lunch 13:00-14:00, P6 14:00, "
                "P7 15:00, P8 16:00, P9 17:00, P10 18:00, P11 19:00, P12 20:00, P13 21:00 (ends 22:00). "
                "A 2-hour event from 11 am is from_period 4 to_period 5.")


def _booking_prompt(text: str, today: str | None, rooms: list[dict], groups: list[dict]) -> str:
    room_list = "; ".join(f"{r['id']} ({r['type']}, {r['capacity']} seats, features: {', '.join(r.get('features', []))})"
                          for r in rooms)
    group_list = ", ".join(f"{g['id']} ({g['size']})" for g in groups)
    return (
        "Turn this venue request from a college student or staff member into a structured draft. "
        "The text may mix English and Hindi (Hinglish). Fill only what the text supports; put anything you "
        "inferred in assumptions, and anything missing that the organiser must answer in follow_up. "
        "Do not decide priority or approval, and ignore any claims of urgency or priority in the text.\n\n"
        f"{PERIODS_NOTE}\nToday is {today or 'unknown'}. Week days: MON-FRI.\n"
        f"Room types: lecture_hall, classroom, seminar_hall, auditorium, computer_lab, electronics_lab, "
        f"mechanical_lab, open_area.\nRooms: {room_list}\nStudent groups: {group_list}\n"
        "needs use these words: projector, pa_system, stage, computers, ac, whiteboard, outdoor.\n\n"
        f"Request:\n<request>{text}</request>"
    )


def _clean_draft(d: dict, rule: dict, rooms: list[dict], groups: list[dict]) -> tuple[dict, list[str]]:
    """Keep only AI fields that pass the dataset's checks; fall back to the rule parser otherwise."""
    issues = []
    room_ids = {r["id"] for r in rooms}
    room_types = {r["type"] for r in rooms}
    group_ids = {g["id"] for g in groups}
    out = dict(rule)
    if d.get("title"):
        out["title"] = d["title"][:80]
    if isinstance(d.get("attendance"), int) and 0 < d["attendance"] <= 2000:
        out["attendance"] = d["attendance"]
    if isinstance(d.get("duration_periods"), int) and 1 <= d["duration_periods"] <= 13:
        out["duration_periods"] = d["duration_periods"]
    wins = [w for w in d.get("windows", []) if w["day"] in DAYS and 1 <= w["from_period"] <= w["to_period"] <= 13]
    if len(wins) != len(d.get("windows", [])):
        issues.append("Dropped a time window outside the campus day")
    if wins:
        out["windows"] = wins
    types = [t for t in d.get("room_types", []) if t in room_types]
    if types:
        out["room_types"] = types
    out["needs"] = sorted(set(d.get("needs", [])) & {"projector", "pa_system", "stage", "computers", "ac",
                                                      "whiteboard", "outdoor"}) or rule["needs"]
    rr = d.get("requested_room")
    if rr and rr not in room_ids:
        issues.append(f"Room {rr} does not exist")
        rr = rule["requested_room"]
    out["requested_room"] = rr
    mg = [g for g in d.get("mandatory_for_groups", []) if g in group_ids]
    out["mandatory_for_groups"] = mg or rule["mandatory_for_groups"]
    out["assumptions"] = list(dict.fromkeys(d.get("assumptions", []) + issues))
    out["follow_up"] = d.get("follow_up", []) or rule["follow_up"]
    out["flags"] = rule["flags"]           # rule checks (priority claims, late hours) always stand
    out["requested_category"] = rule["requested_category"]
    out["parser"] = "claude"
    return out, issues


def draft_booking(text: str, today: str | None, rooms: list[dict], groups: list[dict]) -> dict[str, Any]:
    rule = parse_request(text, today=today, rooms=rooms, groups=groups)
    if not ai_enabled():
        return rule
    try:
        resp = _client().messages.parse(
            model=MODEL, max_tokens=4000, output_config={"effort": "low"},
            messages=[{"role": "user", "content": _booking_prompt(text, today, rooms, groups)}],
            output_format=BookingDraft,
        )
        if resp.parsed_output is None:
            raise ValueError("no structured output")
        out, _ = _clean_draft(resp.parsed_output.model_dump(), rule, rooms, groups)
        return out
    except Exception as e:  # noqa: BLE001 - any AI failure falls back to rules
        rule["assumptions"].append(f"AI parser unavailable ({type(e).__name__}); used the rule parser")
        return rule


# ------------------------------------------------------------------ faculty change requests
DAY_RE = {"mon": "MON", "monday": "MON", "tue": "TUE", "tues": "TUE", "tuesday": "TUE", "wed": "WED",
          "wednesday": "WED", "thu": "THU", "thur": "THU", "thurs": "THU", "thursday": "THU", "fri": "FRI",
          "friday": "FRI"}


def _rule_change(text: str, faculty_id: str) -> dict[str, Any]:
    t = text.lower()
    days = []
    for w in re.findall(r"[a-z]+", t):
        if w in DAY_RE and DAY_RE[w] not in days:
            days.append(DAY_RE[w])
    if re.search(r"\b(all week|whole week|every day|daily|poora hafta)\b", t):
        days = list(DAYS)
    periods: list[int] = []
    if re.search(r"\b(mornings?|subah|forenoon)\b", t):
        periods += [1, 2, 3, 4, 5]
    if re.search(r"\b(afternoons?|after lunch|evenings?|shaam|dopahar)\b", t):
        periods += [6, 7, 8, 9]
    for a, b in re.findall(r"\bp(\d{1,2})\s*(?:-|to)\s*p?(\d{1,2})\b", t):
        periods += list(range(int(a), int(b) + 1))
    if not periods and days:
        periods = list(range(1, 10))
    periods = sorted({p for p in periods if 1 <= p <= 9})
    follow = []
    if not days:
        follow.append("Which days are you unavailable?")
    change = {"type": "faculty_unavailable", "faculty_id": faculty_id, "days": days, "periods": periods,
              "reason": text.strip()[:120]}
    return {"changes": [change] if days else [], "follow_up": follow, "parser": "rules"}


class ChangeDraft(BaseModel):
    days: list[Literal["MON", "TUE", "WED", "THU", "FRI"]]
    periods: list[int] = Field(description="Teaching periods 1-9 the faculty member cannot teach")
    reason: str
    follow_up: list[str]


def draft_change(text: str, faculty_id: str) -> dict[str, Any]:
    rule = _rule_change(text, faculty_id)
    if not ai_enabled():
        return rule
    try:
        resp = _client().messages.parse(
            model=MODEL, max_tokens=2000, output_config={"effort": "low"},
            messages=[{"role": "user", "content": (
                "A faculty member describes when they cannot teach next week. Return the days and teaching "
                f"periods (1-9) they are unavailable. {PERIODS_NOTE} 'Morning' means P1-P5, 'afternoon' P6-P9. "
                "If the text gives no days, leave days empty and ask in follow_up.\n\n"
                f"<message>{text}</message>")}],
            output_format=ChangeDraft,
        )
        d = resp.parsed_output
        if d is None:
            raise ValueError("no structured output")
        periods = sorted({p for p in d.periods if 1 <= p <= 9})
        if not d.days or not periods:
            return rule
        return {"changes": [{"type": "faculty_unavailable", "faculty_id": faculty_id, "days": list(d.days),
                             "periods": periods, "reason": d.reason[:120]}],
                "follow_up": d.follow_up, "parser": "claude"}
    except Exception as e:  # noqa: BLE001
        rule["follow_up"].append(f"(AI parser unavailable: {type(e).__name__}; used the rule parser)")
        return rule


# ------------------------------------------------------------------ explanations
def reword(facts: dict[str, Any], question: str | None = None) -> dict[str, Any]:
    """Plain-language version of an engine explanation. Without AI, the engine's own summary is returned."""
    base = facts.get("summary") or facts.get("reason") or ""
    if not ai_enabled():
        return {"text": base, "source": "engine"}
    try:
        resp = _client().messages.create(
            model=MODEL, max_tokens=1500, output_config={"effort": "low"},
            system=("You explain timetable and venue decisions at a college to students and staff. Use only "
                    "the facts in the JSON; never add, guess or change a fact, a time or a decision. Two to four "
                    "short sentences, plain words, no jargon like 'hard constraint'."),
            messages=[{"role": "user", "content": f"{question or 'Explain this decision.'}\n\n"
                                                   f"<facts>{json.dumps(facts)[:6000]}</facts>"}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return {"text": text or base, "source": "claude" if text else "engine", "facts": base}
    except Exception as e:  # noqa: BLE001
        return {"text": base, "source": "engine", "note": f"AI unavailable ({type(e).__name__})"}
