# Product

<!-- impeccable:product-schema 1 -->

<!-- Written from the project brief and README, not from an interview. Facts marked (inferred) need a quick check by the team. -->

## Platform

web

## Users

- **Registrar's Office and the Dean (admins):** generate the week's timetable and midsems, approve changes, confirm Spectra venue decisions. Desk use, usually during office hours, often under time pressure in Week 7.
- **Department coordinators:** approve club and faculty requests for their department, propose class moves.
- **Faculty:** read their own week, report when they can't teach, book rooms for guest lectures. Often on a phone between classes (inferred).
- **Club reps:** ask for venues for fest and club events, in English or Hinglish, mostly from a phone (inferred).
- **Hackathon judges:** evaluate the product in a short demo, using the one-click demo accounts.

## Product Purpose

Chilika Institute of Technology (about 1,000 students, three years, five branches) runs its timetable in spreadsheets and books rooms over calls and WhatsApp. That breaks when two people want the same room, and most clashes happen in Week 7, when regular classes, the run-up to midsems and Spectra (the annual tech fest) all need the auditorium, seminar halls, open-air theatre and labs.

CrunchWeek makes one clash-proof plan: the weekly timetable, the midsem schedule and every Spectra venue decision, and it repairs the plan with the fewest moves when something changes. Success is zero double bookings, every request answered with a reason, and nobody needing a phone call to find out where they stand.

## Positioning

Every decision is made by code (OR-Tools CP-SAT and a deterministic priority arbiter) and checked by the organisers' own `validator.py`. The AI only drafts requests from plain English or Hinglish and rewords explanations; it never decides. Every outcome explains itself: who got the room, why, and the nearest free option.

## Operating Context

- Priority order for venues: institute events, then guest lectures, then department events, then club events; within a tier, whoever asked first. Nobody can promote their own request.
- Approval routing with no self-approval: club and faculty requests go to a department coordinator or admin; admin requests need a different admin.
- Week 7 is the crunch week; the Spectra week view and the fest venue board are the centre of the demo.
- Demo build: one-click sign-in, Reset demo restores the seeded plan.

## Capabilities and Constraints

- Next.js web app (this folder) in front of a FastAPI + OR-Tools engine; the engine must be running for any data to show.
- Pages: Today, Week (timetable), Midsems, Spectra, Ask (plain-language room request), Changes (absences and change files), Pulse (utilisation), Files (exports + validator), Logbook (audit).
- Light and dark themes, phone and desktop.

## Brand Commitments

- Name: CrunchWeek, for Chilika Institute of Technology. Fest name: Spectra '27.
- Palette "Lagoon & Vermilion" is binding: lagoon ink, bone paper, vermilion as the single action colour, brass, jade, dusk.
- Navigation is the top menu row that magnifies under the cursor like a Mac dock. No sidebar, no dropdown menus.
- The redesigned landing page and app pages are approved; work refines them rather than replacing them.
- Voice: plain, short, human sentences. Must not read as AI-made.

## Evidence on Hand

- Real dataset `data/cit_public.json` and engine exports in `exports/` with the organisers' validator output.
- No testimonials, users or deployment claims exist; never invent them.

## Product Principles

1. The plan is the product: show the answer first (where, when, clash or not), then the reason.
2. Every "no" comes with a reason and the nearest alternative.
3. Code decides, people approve, AI only helps people type.
4. Week 7 must be readable at a glance, on a phone as well as a desk.

## Accessibility & Inclusion

- WCAG AA contrast in both themes, visible keyboard focus, reduced-motion respected (inferred as the target standard).
- Hinglish input is a first-class path, not a fallback.
