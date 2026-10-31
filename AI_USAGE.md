# AI usage declaration

Kept up to date throughout the hackathon.

## 1. Models and APIs the product calls

| Model / API | Where | What it does |
| --- | --- | --- |
| Anthropic Claude API (Messages API, structured JSON output) | `web/` AI assistant (from Phase 4) | Reads plain-English and Hinglish venue requests and fills an editable booking form; asks follow-up questions when something essential is missing; turns faculty requests into a proposed change; words explanations from the engine's own decision records |

No other model or AI API is called by the product.

## 2. What the LLM is NOT allowed to decide

- Whether a timetable, exam schedule, booking or change is valid. Only the engine's constraint checker (`engine/app`) decides that.
- A request's priority category. It is capped by the requester's role in code (`role_category_cap`).
- Whether a booking is approved, rejected or offered an alternative. The booking arbiter in code decides.
- Anything that writes data. Every LLM output is a draft the user reviews and edits; the checker validates it before it is saved.

If the LLM is unavailable or `AI_MODE=off`, the manual booking form and all scheduling features keep working.

## 3. Where the prompts are kept

`web/src/lib/ai/prompts/` (added in Phase 4), versioned in git.

## 4. AI tools used to build the project

| Tool | Used for |
| --- | --- |
| Claude Code (Anthropic) | Problem and dataset analysis, project plan, scaffolding the Next.js app and FastAPI engine, code, tests and documentation |
