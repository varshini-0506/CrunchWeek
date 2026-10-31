"""Rule-based parser for venue requests in English and Hinglish.

This is the always-on parser: it works with no LLM at all, so the booking form
never depends on an API. When an LLM is configured, its output is merged with
this one and both go through the same validation. Nothing here decides whether a
booking is valid; it only drafts a form the user checks and edits.
"""
from __future__ import annotations

import re
from typing import Any

DAYS = ["MON", "TUE", "WED", "THU", "FRI"]
DAY_WORDS = {
    "monday": "MON", "mon": "MON", "somvar": "MON", "somwar": "MON",
    "tuesday": "TUE", "tue": "TUE", "tues": "TUE", "mangalvar": "TUE", "mangalwar": "TUE",
    "wednesday": "WED", "wed": "WED", "budhvar": "WED", "budhwar": "WED",
    "thursday": "THU", "thu": "THU", "thur": "THU", "thurs": "THU", "guruvar": "THU", "guruwar": "THU",
    "friday": "FRI", "fri": "FRI", "shukravar": "FRI", "shukrawar": "FRI",
    "saturday": "SAT", "sat": "SAT", "sunday": "SUN", "sun": "SUN",
}
NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
             "nine": 9, "ten": 10, "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5}
PEOPLE = r"(?:people|persons|log|logon|students|participants|attendees|audience|visitors|dancers|spectators|members|guests|seats|janta)"

ROOM_ALIASES = {
    r"\b(?:main\s+)?auditorium\b|\baud\b": "auditorium",
    r"\bseminar\s*hall\b|\bseminar\b": "seminar_hall",
    r"\bopen[\s-]*air(?:\s*theatre|\s*theater)?\b|\boat\b|\bamphitheatre\b": "outdoor",
    r"\blecture\s*hall\b|\blhc?\b": "lecture_hall",
    r"\bclass\s*room\b|\bclassroom\b|\bsmall room\b|\bany room\b": "classroom",
    r"\bcomputer lab\b|\blab with computers\b|\bcomputing lab\b|\bcs lab\b|\bcomputers?\b": "lab_cs",
    r"\belec(?:tronics)? lab\b|\belectronics\b": "lab_elec",
    r"\bworkshop\b": "workshop",
    r"\bcivil lab\b": "lab_civil",
}
NEEDS = {
    r"\bprojector\b|\bscreen\b|\bppt\b|\bslides\b": "projector",
    r"\bmic\b|\bmike\b|\bmicrophone\b|\bsound\b|\bsound system\b|\bpa\b|\baudio\b": "pa_system",
    r"\bstage\b|\bmanch\b": "stage",
    r"\bwheel\s*chair\b|\baccessible\b|\bramp\b|\bdivyang\b": "accessible",
    r"\bcomputers?\b|\bpcs?\b|\blaptops? provided\b": "computers",
    r"\bpower (?:points|benches|sockets)\b|\bbenches\b": "power_benches",
    r"\b(?:ac|air[\s-]?condition(?:ed|ing)?)\b": "ac",
}
BRANCHES = {"cse": "CSE", "computer science": "CSE", "ece": "ECE", "electronics": "ECE", "ee": "EE",
            "electrical": "EE", "me": "ME", "mech": "ME", "mechanical": "ME", "ce": "CE", "civil": "CE"}
YEARS = {"first": 1, "1st": 1, "second": 2, "2nd": 2, "third": 3, "3rd": 3}
PRIORITY_CLAIMS = r"(?:give (?:it|us) priority|high priority|top priority|mark it (?:as )?institute|institute[- ]level|" \
                  r"official (?:spectra )?event|urgent|vip|dean (?:said|approved)|ignore (?:the )?rules|override|" \
                  r"bypass|jaldi|zaroori hai)"


def hour_to_period(h: int) -> int | None:
    """Clock hour (24h) at which a period starts -> period number. 13:00 is lunch."""
    if 8 <= h <= 12:
        return h - 7
    if 14 <= h <= 21:
        return h - 8
    return None


def _num(tok: str) -> int | None:
    tok = tok.lower()
    if tok.isdigit():
        return int(tok)
    return NUM_WORDS.get(tok)


def _to24(h: int, mer: str | None, context_pm: bool) -> int:
    if h >= 13:
        return h
    if mer in ("am",):
        return 0 if h == 12 else h
    if mer in ("pm",):
        return h if h == 12 else h + 12
    if h == 12:
        return 12
    # no am/pm: event language defaults small hours to the evening / afternoon
    if context_pm or 1 <= h <= 7:
        return h + 12 if h < 12 else h
    return h


def parse_request(text: str, today: str | None = None, rooms: list[dict] | None = None,
                  groups: list[dict] | None = None) -> dict[str, Any]:
    """Draft a structured booking from free text. Returns fields, assumptions, follow-up questions and flags."""
    raw = text.strip()
    t = " " + raw.lower().replace("–", "-").replace("—", "-") + " "
    t = re.sub(r"\bmidnight\b", "24", t)
    t = re.sub(r"\bnoon\b", "12 pm", t)
    assumptions: list[str] = []
    follow: list[str] = []
    flags: list[str] = []

    # ---------------- days
    days: list[str] = []
    for m in re.finditer(r"\b[a-z]+\b", t):
        w = m.group(0)
        if w in DAY_WORDS and not (w in ("sat", "sun") and "saturday" not in t and "sunday" not in t and w != m.group(0)):
            d = DAY_WORDS[w]
            if d not in days:
                days.append(d)
    rel = None
    if re.search(r"\b(kal|tomorrow|tmrw|tmr)\b", t):
        rel = 1
    if re.search(r"\b(parso|parson|day after tomorrow)\b", t):
        rel = 2
    if re.search(r"\b(aaj|today|tonight|aaj raat)\b", t):
        rel = 0
    if rel is not None and today:
        base = DAYS.index(today) if today in DAYS else None
        if base is not None:
            idx = base + rel
            if idx < len(DAYS):
                days = [DAYS[idx]]
                word = {0: "today", 1: "tomorrow (kal)", 2: "the day after tomorrow"}[rel]
                assumptions.append(f"Read '{word}' as {DAYS[idx]}, counted from {today}")
            else:
                flags.append("The relative day falls on a weekend; venues are booked Monday to Friday")
    if re.search(r"\b(daily|every ?day|all (?:of )?(?:the )?(?:fest )?week|roz|rozana|har din)\b", t):
        days = list(DAYS)
        assumptions.append("Read 'daily / all week' as Monday to Friday, one booking per day")
    weekend = [d for d in days if d in ("SAT", "SUN")]
    if weekend:
        flags.append("Weekend days are outside the booking week (Monday to Friday)")
        days = [d for d in days if d in DAYS]
    if not days:
        follow.append("Which day do you need it?")

    # ---------------- time
    context_pm = bool(re.search(r"\b(pm|evening|shaam|sham|night|raat)\b", t))
    windows_periods: tuple[int, int] | None = None
    duration: int | None = None
    rng = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|se|till|until|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", t)
    single = re.search(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|o'?clock)\b", t)
    if rng:
        h1, m1, mer1, h2, m2, mer2 = rng.groups()
        mer_end = mer2 or mer1
        a24 = _to24(int(h1), mer1 or (mer_end if int(h1) <= int(h2) else None), context_pm)
        b24 = _to24(int(h2), mer_end, context_pm)
        if b24 <= a24:
            b24 += 12 if b24 + 12 <= 24 else 0
        def per(h: int) -> int | None:
            return None if h == 13 or h < 8 else (h - 7 if h <= 12 else h - 8)
        def per_end(h: int) -> int | None:
            return None if h < 9 else (h - 7 if h <= 13 else h - 8)
        pa, pb = per(a24), per_end(b24)
        if pa is None and a24 == 13:
            pa = 6
            assumptions.append("13:00 is lunch; started the window at 2 pm (P6)")
        if pa is not None and pb is not None:
            windows_periods = (pa, pb - 1)
        if m1 or m2:
            assumptions.append("Rounded to whole one-hour periods")
    elif single:
        h, mm, mer, _ = single.groups()[0], single.group(2), single.group(3), None
        mer = mer if mer in ("am", "pm") else None
        h24 = _to24(int(h), mer, context_pm)
        p = hour_to_period(h24)
        if p:
            windows_periods = (p, p)
    else:
        if re.search(r"\bafter lunch\b|\blunch ke baad\b", t):
            windows_periods = (6, 9)
            assumptions.append("Read 'after lunch' as 2 pm to 6 pm (P6-P9)")
        elif re.search(r"\bafternoon\b|\bdopahar\b|\bdopehar\b", t):
            windows_periods = (6, 9)
            assumptions.append("Read 'afternoon' as 2 pm to 6 pm (P6-P9)")
        elif re.search(r"\bmorning\b|\bsubah\b", t):
            windows_periods = (1, 5)
            assumptions.append("Read 'morning' as 8 am to 1 pm (P1-P5)")
        elif re.search(r"\bevening\b|\bshaam\b|\bsham\b", t):
            windows_periods = (10, 13)
            assumptions.append("Read 'evening' as 6 pm to 10 pm (P10-P13)")
        elif re.search(r"\bnight\b|\braat\b", t):
            windows_periods = (10, 13)
            assumptions.append("Read 'night' as 6 pm to 10 pm (P10-P13), the latest the campus allows")

    # ---------------- duration
    dm = re.search(r"\b(\d+|one|two|three|four|five|six|seven|eight|ek|do|teen|char|chaar)\s*[- ]?\s*(?:straight\s+)?"
                   r"(?:hours?|hrs?|hr|ghante?|ghanta|ghanton)\b", t)
    if dm:
        duration = _num(dm.group(1))
    elif re.search(r"\b(all day|full day|pura din|poora din)\b", t):
        windows_periods = windows_periods or (1, 9)
        duration = 9
        assumptions.append("Read 'all day' as 8 am to 6 pm (P1-P9)")
    if windows_periods and single and not rng and duration:
        windows_periods = (windows_periods[0], windows_periods[0] + duration - 1)
    if windows_periods and duration is None and single and not rng:
        duration = 1
        assumptions.append("No length given; assumed 1 hour")
    if windows_periods and duration is None:
        duration = windows_periods[1] - windows_periods[0] + 1
        if duration > 3 and not rng:
            duration = 2
            assumptions.append("No length given; assumed 2 hours inside the window")
    if windows_periods and duration and windows_periods[1] - windows_periods[0] + 1 < duration:
        windows_periods = (windows_periods[0], windows_periods[0] + duration - 1)
    if not windows_periods:
        follow.append("What time should it start and end?")
    if duration is None:
        follow.append("How many hours do you need?")

    # ---------------- attendance
    att = None
    am = re.search(r"\b(?:around|about|approx\.?|approximately|~|nearly|roughly|lagbhag|takriban)?\s*(\d{1,5})\s*\+?\s*" + PEOPLE, t)
    if not am:
        am = re.search(PEOPLE + r"\s*(?:of\s*)?(?:around|about)?\s*(\d{1,5})\b", t)
    if am:
        att = int(am.group(1))
    elif re.search(r"\b(?:expecting|for)\s+(\d{2,5})\b", t):
        att = int(re.search(r"\b(?:expecting|for)\s+(\d{2,5})\b", t).group(1))
    if re.search(r"\b(maybe|around|about|approx|roughly|lagbhag)\b", t) and att:
        assumptions.append(f"Attendance is approximate; booked for {att}")
    if att is None:
        follow.append("About how many people will attend?")

    # ---------------- rooms and needs
    room_types: list[str] = []
    for pat, typ in ROOM_ALIASES.items():
        if re.search(pat, t) and typ not in room_types:
            room_types.append(typ)
    if "lab_cs" in room_types and "computers" not in t and "computer lab" not in t and "cs lab" not in t \
            and "computing lab" not in t:
        room_types.remove("lab_cs")
    needs: list[str] = []
    for pat, need in NEEDS.items():
        if re.search(pat, t) and need not in needs:
            needs.append(need)
    if "lab_cs" in room_types and "computers" not in needs:
        needs.append("computers")
    requested_room = None
    room_ids = {r["id"].lower(): r["id"] for r in (rooms or [])}
    for m in re.finditer(r"\b([a-z]{2,6}(?:-[a-z]+)?-?\d{0,3})\b", t):
        tok = m.group(1)
        if tok in room_ids and tok not in ("aud",) or tok in ("oat",):
            requested_room = room_ids.get(tok, requested_room)
            break
        if re.fullmatch(r"(?:lhc?|sh|cr)-?\d{1,3}", tok):
            norm = re.sub(r"^lhc", "lh", tok)
            norm = re.sub(r"^([a-z]+)-?(\d+)$", r"\1-\2", norm).upper()
            requested_room = norm if norm in room_ids.values() else tok.upper()
            if norm.lower() != tok:
                assumptions.append(f"Read room '{tok.upper()}' as {norm}")
            break
    if re.search(r"\bauditorium\b|\baud\b", t) and not requested_room:
        requested_room = "AUD" if "AUD" in room_ids.values() else None
    if requested_room and rooms:
        r = next((x for x in rooms if x["id"] == requested_room), None)
        if r is None:
            flags.append(f"Room {requested_room} does not exist")
        else:
            if r["type"] not in room_types:
                room_types.append(r["type"])
            feats = set(r["features"]) | ({"accessible"} if r["accessible"] else set())
            missing = [n for n in needs if n != "accessible" and n not in feats]
            if missing:
                flags.append(f"{requested_room} has no {', '.join(missing).replace('_', ' ')}")
            if "accessible" in needs and not r["accessible"]:
                alt = next((x["id"] for x in rooms if x["type"] == r["type"] and x["accessible"]), None)
                flags.append(f"{requested_room} is not wheelchair accessible" + (f"; {alt} is" if alt else ""))
    if not room_types:
        if att and att > 200:
            room_types = ["auditorium", "outdoor"]
        elif att and att > 120:
            room_types = ["lecture_hall", "seminar_hall", "auditorium"]
        else:
            room_types = ["classroom", "lecture_hall", "seminar_hall"]
        assumptions.append(f"No venue type named; suggested {', '.join(room_types)} for the size")

    # ---------------- mandatory groups
    mandatory: list[str] = []
    gids = {g["id"] for g in (groups or [])}
    if re.search(r"\b(compulsory|mandatory|must attend|zaroori|compulsary|required for)\b", t):
        for m in re.finditer(r"\b(cse|ece|ee|me|ce|mech|mechanical|civil|electrical|electronics|computer science)"
                             r"[\s-]*(?:(first|second|third|1st|2nd|3rd)\s*years?|([123]))?\b", t):
            br = BRANCHES[m.group(1)]
            yr = YEARS.get(m.group(2) or "", None) or (int(m.group(3)) if m.group(3) else None)
            if yr is None:
                ym = re.search(r"\b(first|second|third|1st|2nd|3rd)\s*years?\b", t)
                yr = YEARS[ym.group(1)] if ym else None
            if yr:
                gid = f"{br}-{yr}"
                if (not gids or gid in gids) and gid not in mandatory:
                    mandatory.append(gid)
        if not mandatory:
            follow.append("Which student group is the event compulsory for?")

    if att is None and mandatory and groups:
        att = sum(g["size"] for g in groups if g["id"] in mandatory)
        assumptions.append(f"Attendance set to the size of {', '.join(mandatory)} ({att})")
        follow[:] = [f for f in follow if not f.startswith("About how many")]

    # ---------------- category hints and abuse
    category = "club_event"
    if re.search(r"\b(guest lecture|guest talk|industry (?:talk|speaker)|invited talk|expert lecture|speaker)\b", t):
        category = "guest_lecture"
    if re.search(r"\b(department|dept)\b", t):
        category = "department_event" if category == "club_event" else category
    if re.search(r"\b(inauguration|convocation|closing ceremony|institute event|spectra main)\b", t):
        category = "institute_event"
    if re.search(PRIORITY_CLAIMS, t):
        flags.append("Priority claims in the message are ignored: priority comes from your role and the rules")

    title = raw.split(".")[0][:80]
    windows = [{"day": d, "from_period": windows_periods[0], "to_period": windows_periods[1]}
               for d in days] if windows_periods and days else []
    if windows_periods and windows_periods[1] > 13:
        flags.append("The campus day ends at 10 pm (P13); a later time can't be booked")
    return {
        "title": title, "attendance": att, "duration_periods": duration, "windows": windows,
        "room_types": room_types, "needs": [n for n in needs if n != "ac" or "ac" in t.split()],
        "requested_room": requested_room, "mandatory_for_groups": mandatory, "requested_category": category,
        "assumptions": assumptions, "follow_up": follow, "flags": flags, "raw_text": raw, "parser": "rules",
    }
