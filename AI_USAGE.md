# AI usage declaration

Kept up to date throughout the hackathon.

## 1. Models and APIs the product calls

| Model / API | Where | What it does |
| --- | --- | --- |
| Anthropic Claude API (`claude-opus-5-5`, Messages API, structured output via the `anthropic` Python SDK) | `engine/app/ai.py`, only when `ANTHROPIC_API_KEY` is set | Reads plain-English and Hinglish venue requests and fills an editable booking form; asks follow-up questions when something essential is missing; turns faculty requests into a proposed change; words explanations from the engine's own decision records |

No other model or AI API is called by the product.

## 2. What the LLM is NOT allowed to decide

- Whether a timetable, exam schedule, booking or change is valid. Only the engine's constraint checker (`engine/app`) decides that.
- A request's priority category. It is capped by the requester's role in code (`role_category_cap`).
- Whether a booking is approved, rejected or offered an alternative. The booking arbiter in code decides.
- Whether a week is clash-free. The quantum-inspired verifier (`engine/app/qverify.py`) is our own code and uses no LLM.
- Anything that writes data. Every LLM output is a draft the user reviews and edits; the checker validates it before it is saved.

If the LLM is unavailable or `AI_MODE=off`, the manual booking form and all scheduling features keep working.

## 3. Where the prompts are kept

In `engine/app/ai.py` (`_booking_prompt`, the change-request prompt in `draft_change`, and the system prompt in `reword`), versioned in git. Every AI field is re-checked in `_clean_draft` against the dataset (rooms, groups, periods, days); invalid fields fall back to the rule parser in `engine/app/nlp.py`. Priority flags and category always come from code.

## 4. AI tools used to build the project

| Tool | Used for |
| --- | --- |
| Claude Code (Anthropic) | Problem and dataset analysis, project plan, scaffolding the Next.js app and FastAPI engine, code, tests and documentation |
| Kokoro TTS (open-source, `kokoro-onnx`, run locally) | Voice-over for the feature video only; not part of the product |
