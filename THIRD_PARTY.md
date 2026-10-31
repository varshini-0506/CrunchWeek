# Third-party software

All open-source libraries and services this project uses. Versions are pinned in `web/package.json` and `engine/requirements.txt`.

| Library / service | Licence | Used for |
| --- | --- | --- |
| [Next.js](https://nextjs.org) | MIT | Web app, routing, API route handlers |
| [React](https://react.dev) | MIT | UI |
| [Tailwind CSS](https://tailwindcss.com) | MIT | Styling |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Type checking |
| [ESLint](https://eslint.org) + eslint-config-next | MIT | Linting |
| [FastAPI](https://fastapi.tiangolo.com) | MIT | Engine HTTP API |
| [Uvicorn](https://www.uvicorn.org) | BSD-3-Clause | Engine ASGI server |
| [Pydantic](https://docs.pydantic.dev) | MIT | Request and response models |
| [Google OR-Tools](https://developers.google.com/optimization) (CP-SAT) | Apache-2.0 | Timetable, exam and repair solving |
| [pytest](https://pytest.org), [HTTPX](https://www.python-httpx.org) | MIT, BSD-3-Clause | Engine tests |
| [Playwright](https://playwright.dev) | Apache-2.0 | UI smoke tests and screenshots |
| `validator.py` (Crunch Week organisers) | Provided by organisers | Official scoring check, run unmodified in CI |
| [Supabase](https://supabase.com) | Hosted service (Apache-2.0 client libraries) | PostgreSQL database, realtime updates |
| Vercel, Render | Hosted services | Hosting for web and engine |

Starter-pack data (`data/cit_public.json`, `data/samples/`) is provided by the organisers.
