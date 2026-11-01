"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, Spinner, useBusy, PageHead } from "@/components/ui";
import { api, DAY_NAME, DAYS, fmtHour, periodHour, type SessionRow, type Violation } from "@/lib/api";

type Slot = { day: string; start_period: number; room_id: string };
type Moved = { session_id: string; kind: "time" | "room"; from: Slot; to: Slot; course_id: string; groups: string[]; faculty_id: string };
type Change = {
  id: string; kind: string; by: string; at: string; note?: string; status: string; changes: Record<string, unknown>[];
  diff?: { moved: Moved[]; added: { session_id: string; to: Slot }[]; removed: { session_id: string }[]; sessions_moved: number; time_changed: number; room_only_changed: number };
  broken_before_fix?: Violation[]; conflicts?: string[]; errors?: string[]; soft_before?: number; soft_after?: number;
  solver?: { status: string; seconds: number }; approved_by?: string; exam_issues?: string[];
};
type ChangeDraft = { changes: { type: string; faculty_id: string; days: string[]; periods: number[]; reason: string }[]; follow_up: string[]; parser: string };

export default function ChangesPage() {
  const { user, meta, version, refresh, status } = useApp();
  const [list, setList] = useState<{ pending: Change[]; applied: Change[] } | null>(null);
  const [text, setText] = useState("");
  const [fid, setFid] = useState(user?.faculty_id ?? "F07");
  const [draft, setDraft] = useState<ChangeDraft | null>(null);
  const [json, setJson] = useState("");
  const [sent, setSent] = useState<{ before: string[]; summary: string } | null>(null);
  const { busy, error, run, setError } = useBusy();
  const isAdmin = user?.role === "admin";
  const running = status?.job.status === "running";
  // Which control started the repair, so that button keeps spinning after the request returns.
  const [hold, setHold] = useState<"form" | "typed" | "file" | null>(null);
  useEffect(() => { if (!running) setHold(null); }, [running]);

  useEffect(() => { api<{ pending: Change[]; applied: Change[] }>("/changes").then(setList).catch(() => {}); }, [version]);

  // The change this person just sent: the first pending one that wasn't there before they pressed the button.
  const mine = sent && list ? list.pending.find((c) => !sent.before.includes(c.id)) ?? null : null;
  useEffect(() => { if (mine) document.getElementById(`change-${mine.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [mine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const parse = () => run(async () => setDraft(await api<ChangeDraft>("/changes/parse", { text, faculty_id: fid })));
  const preview = (changes: unknown[], note: string, summary?: string) => run(async () => {
    setSent({ before: [...(list?.pending ?? []), ...(list?.applied ?? [])].map((c) => c.id), summary: summary ?? note });
    await api("/changes/preview", { changes, note });
    await refresh();
  });
  const previewJson = () => {
    try {
      const parsed = JSON.parse(json);
      setHold("file");
      return preview(Array.isArray(parsed) ? parsed : parsed.changes ?? [], parsed.description ?? "Uploaded change file");
    } catch { setError(new Error("That is not valid JSON")); }
  };
  const loadSample = () => run(async () => setJson(JSON.stringify(await api("/samples/disruption"), null, 2)));
  const act = (path: string) => run(async () => { await api(path, {}); await refresh(); });

  return (
    <div className="space-y-4">
      <PageHead title={<>The week bends, it doesn&apos;t break.</>}>
        Plans change. Tell us who or which room can&apos;t make it, and when. The planner moves as few classes as it can and shows you every move before anything is published.
      </PageHead>
      <ErrorBox error={error} />

      <ChangeForm busy={busy || !!running} loading={hold === "form" && !!running} onSubmit={(changes, note, summary) => { setHold("form"); return preview(changes, note, summary); }} />

      {sent && <Feedback sent={sent} running={!!running && status?.job.kind === "repair"} mine={mine} onClear={() => setSent(null)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <details className="glass group rounded-[8px] p-5 sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span><span className="font-poster block text-[22px] uppercase leading-none">Or just type it</span><span className="mt-1 block text-[13px] text-ink-3">Describe an absence in English or Hinglish and the assistant fills the form for you.</span></span>
            <span aria-hidden className="text-[20px] text-ink-3 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-4 space-y-2 text-sm">
            {user?.role !== "faculty" && (
              <select aria-label="Teacher" value={fid} onChange={(e) => setFid(e.target.value)} className="w-full rounded-[10px] px-3 py-2">
                {meta?.faculty.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.id}</option>)}
              </select>
            )}
            <textarea aria-label="Describe the absence" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. I can't take Tuesday mornings next week / Monday poora din conference hai"
              className="w-full rounded-[10px] p-3" />
            <Button onClick={parse} disabled={busy || !text.trim()}>Read it</Button>
            {draft && (draft.changes.length === 0 ? <p className="text-lake">{draft.follow_up.join(" ")}</p> : draft.changes.map((c, i) => (
              <div key={i} className="rounded-[12px] bg-fill-2 p-3">
                <div className="mb-1 font-medium">{facultyName(meta, c.faculty_id)} can&apos;t teach</div>
                <div className="flex flex-wrap gap-1">{DAYS.map((d) => <Toggle key={d} on={c.days.includes(d)} onClick={() => setDraft({ ...draft, changes: [{ ...c, days: c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d] }] })}>{DAY_NAME[d].slice(0, 3)}</Toggle>)}</div>
                <div className="mt-1 flex flex-wrap gap-1">{PERIODS.map((p) => <Toggle key={p} on={c.periods.includes(p)} onClick={() => setDraft({ ...draft, changes: [{ ...c, periods: c.periods.includes(p) ? c.periods.filter((x) => x !== p) : [...c.periods, p].sort((a, b) => a - b) }] })}>{fmtHour(periodHour(p))}</Toggle>)}</div>
                <div className="mt-2"><Button disabled={busy || running || !c.days.length || !c.periods.length} loading={hold === "typed" && !!running} onClick={() => { setHold("typed"); return preview(draft.changes, text); }}>See what would move</Button></div>
              </div>
            )))}
          </div>
        </details>
        {(isAdmin || user?.role === "department_coordinator") && (
          <details className="glass group rounded-[8px] p-5 sm:p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span><span className="font-poster block text-[22px] uppercase leading-none">Upload a change file</span><span className="mt-1 block text-[13px] text-ink-3">For the organisers&apos; JSON format: bulk changes and added classes.</span></span>
              <span aria-hidden className="text-[20px] text-ink-3 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4">
              <div className="mb-2 text-right"><Button small kind="ghost" onClick={loadSample}>Use the sample</Button></div>
              <textarea aria-label="Change file" value={json} onChange={(e) => setJson(e.target.value)} rows={7} placeholder='{"changes": [{"type": "room_unavailable", ...}]}' className="w-full rounded-[10px] p-3 font-mono text-[13px]" />
              <div className="mt-2"><Button disabled={busy || running || !json.trim()} loading={hold === "file" && !!running} onClick={previewJson}>Find the gentlest fix</Button></div>
            </div>
          </details>
        )}
      </div>

      <h2 id="pending" className="font-poster px-1 pt-4 text-[26px] uppercase leading-none">Waiting for sign-off</h2>
      {!list ? <Spinner /> : list.pending.length === 0 ? <Empty title="Nothing waiting for sign-off">Report a change above. The planner works out the smallest fix, and it waits here until an admin publishes it.</Empty> : list.pending.map((c) => (
        <ChangeCard key={c.id} c={c} highlight={c.id === mine?.id} actions={isAdmin && (
          <>
            {c.status === "proposed" && <Button disabled={busy} onClick={() => act(`/changes/${c.id}/approve`)}>Sign off and publish</Button>}
            <Button kind="secondary" disabled={busy} onClick={() => act(`/changes/${c.id}/reject`)}>{c.status === "proposed" ? "Reject" : "Dismiss"}</Button>
          </>
        )} />
      ))}

      {list && list.applied.length > 0 && <>
        <h2 className="font-poster px-1 pt-4 text-[26px] uppercase leading-none">Published</h2>
        {[...list.applied].reverse().map((c) => <ChangeCard key={c.id} c={c} />)}
      </>}
    </div>
  );
}

/* ───────────── The manual form: what changed → who or which room → when → send ───────────── */

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
type Kind = "teacher" | "room";
const key = (d: string, p: number) => `${d}-${p}`;

function facultyName(meta: ReturnType<typeof useApp>["meta"], id: string) {
  return meta?.faculty.find((f) => f.id === id)?.name ?? id;
}

/** "8 am to 1 pm" style ranges from a list of periods. */
function hoursText(periods: number[]) {
  const ps = [...periods].sort((a, b) => a - b);
  if (ps.length === PERIODS.length) return "all day";
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    let j = i;
    while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1 && ps[j] !== 5) j++;
    out.push(`${fmtHour(periodHour(ps[i]))} to ${fmtHour(periodHour(ps[j]) + 1)}`);
    i = j;
  }
  return out.join(", ");
}

function whenText(sel: Set<string>) {
  const byDay = DAYS.map((d) => [d, PERIODS.filter((p) => sel.has(key(d, p)))] as const).filter(([, ps]) => ps.length);
  return byDay.map(([d, ps]) => `${DAY_NAME[d]} ${hoursText(ps)}`).join("; ");
}

function ChangeForm({ busy, loading, onSubmit }: { busy: boolean; loading?: boolean; onSubmit: (changes: unknown[], note: string, summary: string) => void | Promise<unknown> }) {
  const { user, meta } = useApp();
  const isFaculty = user?.role === "faculty";
  const [kind, setKind] = useState<Kind>("teacher");
  const [who, setWho] = useState(user?.faculty_id ?? "");
  const [room, setRoom] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const drag = useRef<null | boolean>(null);

  useEffect(() => { api<{ sessions: SessionRow[] }>("/timetable").then((t) => setRows(t.sessions)).catch(() => setRows([])); }, []);
  useEffect(() => { const up = () => { drag.current = null; }; window.addEventListener("pointerup", up); return () => window.removeEventListener("pointerup", up); }, []);

  const target = kind === "teacher" ? who : room;
  const theirs = useMemo(() => (rows ?? []).filter((s) => (kind === "teacher" ? s.faculty_id === who : s.room_id === room)), [rows, kind, who, room]);
  // Which hour of the week each of their classes covers.
  const at = useMemo(() => {
    const m = new Map<string, SessionRow>();
    for (const s of theirs) for (let k = 0; k < s.duration; k++) m.set(key(s.day, s.start_period + k), s);
    return m;
  }, [theirs]);
  const hit = useMemo(() => theirs.filter((s) => Array.from({ length: s.duration }, (_, k) => sel.has(key(s.day, s.start_period + k))).some(Boolean)), [theirs, sel]);

  const name = kind === "teacher" ? facultyName(meta, who) : meta?.rooms.find((r) => r.id === room)?.name ?? room;
  const set = (cells: string[], on: boolean) => setSel((prev) => { const n = new Set(prev); cells.forEach((c) => (on ? n.add(c) : n.delete(c))); return n; });
  const toggleGroup = (cells: string[]) => set(cells, !cells.every((c) => sel.has(c)));
  const preset = (ps: number[]) => set(DAYS.flatMap((d) => ps.map((p) => key(d, p))), true);

  const ready = !!target && sel.size > 0;
  const send = () => {
    // One change per distinct set of hours, so each day keeps exactly the hours that were picked.
    const groups = new Map<string, { days: string[]; periods: number[] }>();
    for (const d of DAYS) {
      const ps = PERIODS.filter((p) => sel.has(key(d, p)));
      if (!ps.length) continue;
      const g = groups.get(ps.join(",")) ?? { days: [], periods: ps };
      g.days.push(d); groups.set(ps.join(","), g);
    }
    const why = reason.trim();
    const changes = [...groups.values()].map((g) => kind === "teacher"
      ? { type: "faculty_unavailable", faculty_id: who, days: g.days, periods: g.periods, ...(why && { reason: why }) }
      : { type: "room_unavailable", room_id: room, days: g.days, periods: g.periods, ...(why && { reason: why }) });
    const summary = `${name} ${kind === "teacher" ? "can't teach" : "is closed"}: ${whenText(sel)}`;
    return onSubmit(changes, why || summary, summary);
  };

  return (
    <section className="glass rounded-[8px] p-5 sm:p-7" aria-labelledby="form-h">
      <h2 id="form-h" className="font-poster text-[32px] uppercase leading-none">Report a change</h2>
      <p className="mt-1 text-[14px] text-ink-2">Four steps. As you pick, you&apos;ll see straight away which classes are affected.</p>

      <div className="mt-6">
        <Step n={1} title="What changed?" done>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["teacher", "A teacher can't come", "Leave, travel, a conference or illness", "👩‍🏫"], ["room", "A room can't be used", "Repairs, a leak, an event, no power", "🚪"]] as const).map(([k, t, sub, icon]) => {
              const off = k === "room" && isFaculty;
              return (
                <button key={k} type="button" disabled={off} onClick={() => { setKind(k); setSel(new Set()); }}
                  className={`flex items-center gap-4 rounded-[8px] border-2 p-4 text-left transition ${kind === k ? "border-accent bg-accent-soft" : "border-[var(--edge)] hover:border-ink-3"} disabled:cursor-not-allowed disabled:opacity-50`}>
                  <span aria-hidden className="text-[30px] leading-none">{icon}</span>
                  <span><span className="block text-[16px] font-semibold">{t}</span><span className="block text-[13px] text-ink-2">{off ? "Only admins and coordinators can close a room" : sub}</span></span>
                </button>
              );
            })}
          </div>
        </Step>

        <Step n={2} title={kind === "teacher" ? "Which teacher?" : "Which room?"} done={!!target}>
          {kind === "teacher" ? (
            isFaculty ? <p className="text-[15px]">You: <b>{facultyName(meta, who)}</b></p> : (
              <select aria-label="Teacher" value={who} onChange={(e) => { setWho(e.target.value); setSel(new Set()); }} className="w-full max-w-[460px] rounded-[10px] px-3 py-2.5 text-[15px]">
                <option value="">Choose a teacher…</option>
                {meta?.faculty.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.department}</option>)}
              </select>
            )
          ) : (
            <select aria-label="Room" value={room} onChange={(e) => { setRoom(e.target.value); setSel(new Set()); }} className="w-full max-w-[460px] rounded-[10px] px-3 py-2.5 text-[15px]">
              <option value="">Choose a room…</option>
              {meta?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.capacity} seats · {r.building}</option>)}
            </select>
          )}
          {target && rows && <p className="mt-2 text-[13px] text-ink-2">{name} has <b className="text-ink">{theirs.length} class{theirs.length === 1 ? "" : "es"}</b> this week. They show in blue on the week below.</p>}
        </Step>

        <Step n={3} title="When?" done={sel.size > 0}>
          {!target ? <p className="text-[14px] text-ink-3">Pick {kind === "teacher" ? "a teacher" : "a room"} first, and their week appears here.</p> : <>
            <p className="mb-3 text-[14px] text-ink-2">Click the hours {kind === "teacher" ? "they can't teach" : "the room is closed"}. Drag to mark several at once, or click a day or a time to mark the whole row.</p>
            <div className="mb-3 flex flex-wrap gap-2">
              <Chip onClick={() => preset([1, 2, 3, 4, 5])}>All mornings</Chip>
              <Chip onClick={() => preset([6, 7, 8, 9])}>All afternoons</Chip>
              <Chip onClick={() => preset(PERIODS)}>The whole week</Chip>
              {sel.size > 0 && <Chip onClick={() => setSel(new Set())}>Clear</Chip>}
            </div>
            <div className="overflow-x-auto">
              <table onPointerMove={(e) => { if (drag.current === null) return; const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-k]"); if (el?.dataset.k) set([el.dataset.k], drag.current); }} className="w-full min-w-[560px] table-fixed border-separate border-spacing-1 select-none text-[13px]">
                <thead>
                  <tr>
                    <th className="w-[64px]" />
                    {DAYS.map((d) => <th key={d}><button type="button" onClick={() => toggleGroup(PERIODS.map((p) => key(d, p)))} className="w-full rounded-[6px] py-1.5 font-semibold hover:bg-fill">{DAY_NAME[d].slice(0, 3)}</button></th>)}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map((p) => (
                    <Fragment key={p}>
                      {p === 6 && <tr><td colSpan={6} className="py-0.5 text-center text-[12px] text-ink-3">Lunch · 1 to 2 pm</td></tr>}
                      <tr>
                        <th scope="row"><button type="button" onClick={() => toggleGroup(DAYS.map((d) => key(d, p)))} className="w-full rounded-[6px] py-2 text-right font-normal text-ink-2 hover:bg-fill">{fmtHour(periodHour(p))}</button></th>
                        {DAYS.map((d) => {
                          const k = key(d, p), on = sel.has(k), cls = at.get(k);
                          return (
                            <td key={d} className="p-0">
                              <button type="button" aria-pressed={on} aria-label={`${DAY_NAME[d]} ${fmtHour(periodHour(p))}${cls ? `, ${cls.course_id}` : ""}`}
                                onPointerDown={(e) => { e.preventDefault(); const v = !on; drag.current = v; set([k], v); }}
                                data-k={k} onPointerEnter={() => { if (drag.current !== null) set([k], drag.current); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set([k], !on); } }}
                                className={`flex h-11 w-full items-center justify-center gap-1 rounded-[6px] px-1 text-[12px] font-semibold transition-colors ${
                                  on ? "bg-[#c0330f] text-white" : cls ? "bg-[#23788a] text-white hover:brightness-110" : "bg-fill-2 text-ink-3 hover:bg-fill"}`}>
                                {on && <span aria-hidden>✕</span>}
                                <span className={`truncate ${on && cls ? "line-through decoration-2" : ""}`}>{cls ? cls.course_id : on ? (kind === "teacher" ? "Away" : "Closed") : ""}</span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
              <span className="flex items-center gap-1.5"><i className="h-3 w-4 rounded-[3px] bg-[#23788a]" />Has a class</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-4 rounded-[3px] bg-[#c0330f]" />{kind === "teacher" ? "Can't teach" : "Closed"}</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-4 rounded-[3px] bg-fill-2" />Free</span>
            </div>
          </>}
        </Step>

        <Step n={4} title="Check and send" done={false}>
          <label className="block text-[13px] text-ink-2" htmlFor="why">Reason (optional, the admin sees it)</label>
          <input id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "teacher" ? "e.g. Conference in Delhi" : "e.g. Water leak, ceiling repair"} className="mt-1 w-full max-w-[460px] rounded-[10px] px-3 py-2.5 text-[15px]" />
          <div className={`mt-4 rounded-[8px] border-l-4 p-4 ${ready ? "border-accent bg-accent-soft" : "border-[var(--edge)] bg-fill-2"}`}>
            {!ready ? <p className="text-[14px] text-ink-3">Your summary will appear here once you&apos;ve picked {!target ? (kind === "teacher" ? "a teacher" : "a room") : "some hours"}.</p> : <>
              <p className="text-[16px] font-semibold">{name} {kind === "teacher" ? "can't teach" : "is closed"} on {whenText(sel)}.</p>
              <p className="mt-1 text-[14px] text-ink-2">
                {hit.length === 0 ? "No classes fall in those hours, so nothing has to move." : <>{hit.length} class{hit.length === 1 ? "" : "es"} will need a new {kind === "teacher" ? "time" : "room or time"}: {hit.map((s) => `${s.course_id} (${DAY_NAME[s.day].slice(0, 3)} ${fmtHour(periodHour(s.start_period))})`).join(", ")}.</>}
              </p>
            </>}
            <div className="mt-3"><Button disabled={!ready || busy} loading={loading} onClick={send}>Find the smallest fix<IconArrowRight /></Button></div>
          </div>
        </Step>
      </div>
    </section>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[36px_1fr] gap-x-4">
      <span className={`grid h-9 w-9 place-items-center rounded-full text-[15px] font-semibold ${done ? "bg-ok text-white" : "bg-ink text-paper"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 pb-7">
        <h3 className="font-poster pt-1 text-[22px] uppercase leading-none">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="rounded-full border border-[var(--edge)] bg-sheet px-3 py-1 text-[13px] font-medium hover:bg-fill">{children}</button>;
}

function IconArrowRight() {
  return <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

/** What happened after pressing send: working → result, with a jump to the full before-and-after. */
function Feedback({ sent, running, mine, onClear }: { sent: { summary: string }; running: boolean; mine: Change | null; onClear: () => void }) {
  const state = mine ? mine.status : running ? "working" : "waiting";
  const tone = state === "proposed" ? "border-ok" : state === "infeasible" ? "border-bad" : "border-accent";
  return (
    <div role="status" className={`glass flex flex-wrap items-center gap-4 rounded-[8px] border-l-4 p-4 ${tone}`}>
      {(state === "working" || state === "waiting") && <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-ink-3/25 border-t-accent" />}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">
          {state === "proposed" ? `Done. ${mine?.diff?.sessions_moved ?? 0} class${mine?.diff?.sessions_moved === 1 ? "" : "es"} move to fix this.`
            : state === "infeasible" ? "This change can't be fixed without breaking a rule."
            : "Working out the smallest fix…"}
        </p>
        <p className="text-[13px] text-ink-2">{sent.summary}{state === "proposed" ? ". It's waiting below for an admin to sign off." : state === "infeasible" ? ". See why below." : ""}</p>
      </div>
      {mine && <a href={`#change-${mine.id}`} className="text-[14px] font-medium text-link hover:underline">See the moves</a>}
      <button type="button" onClick={onClear} aria-label="Dismiss" className="text-ink-3 hover:text-ink">✕</button>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1 text-[13px] font-medium transition ${on ? "bg-bad text-white" : "bg-fill text-ink"}`}>{children}</button>;
}

function slot(s: Slot) {
  return `${DAY_NAME[s.day]?.slice(0, 3)} ${fmtHour(periodHour(s.start_period))} · ${s.room_id}`;
}

function ChangeCard({ c, actions, highlight }: { c: Change; actions?: React.ReactNode; highlight?: boolean }) {
  const { meta } = useApp();
  return (
    <div id={`change-${c.id}`} className={`scroll-mt-28 rounded-[10px] ${highlight ? "outline-[3px] outline-offset-2 outline-[var(--blue)]" : ""}`}>
    <Card title={<span className="flex flex-wrap items-center gap-2">{c.note ?? c.kind.replace("_", " ")} <Badge s={c.status} /></span>} actions={actions}>
      <div className="space-y-2 text-sm">
        <div className="text-[13px] text-ink-3">by {c.by} · {new Date(c.at).toLocaleString()}{c.approved_by && ` · approved by ${c.approved_by}`}{c.solver && ` · worked out in ${c.solver.seconds}s${c.solver.status === "OPTIMAL" ? " (proven fewest moves)" : ""}`}</div>
        {c.changes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-2 marker:text-ink-3">{c.changes.map((ch, i) => <li key={i}>{describe(ch, meta)}</li>)}</ul>}
        {c.broken_before_fix && c.broken_before_fix.length > 0 && (
          <details className="text-[13px]"><summary className="cursor-pointer text-warn">{c.broken_before_fix.length} clashes this would cause if we did nothing</summary>
            <ul className="mt-1 text-ink-2">{c.broken_before_fix.slice(0, 12).map((v, i) => <li key={i}>[{v.rule}] {v.detail}</li>)}</ul>
          </details>
        )}
        {c.status === "infeasible" && (
          <div className="rounded-xl bg-bad-soft p-2 text-bad"><b>No valid timetable exists with this change.</b> Why:
            <ul className="list-disc pl-5">{c.conflicts?.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {c.errors && <div className="rounded-xl bg-bad-soft p-2 text-bad">{c.errors.map((e) => <div key={e}>{e}</div>)}</div>}
        {c.diff && (
          <>
            <div className="flex flex-wrap gap-3">
              <span className="font-medium">{c.diff.sessions_moved} classes move</span>
              <span className="text-ink-2">{c.diff.time_changed} change time · {c.diff.room_only_changed} only change room</span>
              {c.soft_before !== undefined && <span className="text-ink-2">compromises {c.soft_before} before, {c.soft_after} after</span>}
            </div>
            {c.diff.moved.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-ink-3"><tr><th className="py-1.5 font-medium">Class</th><th className="font-medium">Section · teacher</th><th className="font-medium">Was</th><th className="w-6" /><th className="font-medium">Now</th><th className="font-medium">What changed</th></tr></thead>
                  <tbody>{c.diff.moved.map((m) => (
                    <tr key={m.session_id} className="border-t border-rule">
                      <td className="py-2 font-semibold">{m.course_id}</td><td className="text-ink-2">{m.groups.join(", ")} · {facultyName(meta, m.faculty_id)}</td>
                      <td className="text-ink-3 line-through decoration-bad/60">{slot(m.from)}</td><td aria-hidden className="text-ink-3">→</td><td className="font-medium text-ok">{slot(m.to)}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${m.kind === "room" ? "bg-fill text-ink-2" : "bg-accent-soft text-accent"}`}>{m.kind === "room" ? "Same time, new room" : "New time"}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {c.diff.added.length > 0 && <div className="text-[13px]">Added: {c.diff.added.map((a) => `${a.session_id} at ${slot(a.to)}`).join(", ")}</div>}
            {c.diff.removed.length > 0 && <div className="text-[13px]">Removed: {c.diff.removed.map((a) => a.session_id).join(", ")}</div>}
          </>
        )}
        {c.exam_issues && c.exam_issues.length > 0 && <div className="text-[13px] text-warn">Exam issues: {c.exam_issues.join("; ")}</div>}
      </div>
    </Card>
    </div>
  );
}

function describe(ch: Record<string, unknown>, meta: ReturnType<typeof useApp>["meta"]): string {
  const t = ch.type as string;
  const ps = (ch.periods as number[] | undefined) ?? [];
  const days = ((ch.days as string[] | undefined) ?? []).map((d) => DAY_NAME[d]?.slice(0, 3) ?? d).join(", ");
  const why = ch.reason ? ` (${ch.reason})` : "";
  if (t === "faculty_unavailable") return `${facultyName(meta, ch.faculty_id as string)} can't teach ${days}, ${hoursText(ps)}${why}`;
  if (t === "room_unavailable") return `${meta?.rooms.find((r) => r.id === ch.room_id)?.name ?? ch.room_id} closed ${days}, ${hoursText(ps)}${why}`;
  if (t === "add_session") return `New class added: ${(ch.session as { course_id?: string; id: string })?.course_id ?? (ch.session as { id: string })?.id}`;
  if (t === "remove_session") return `Class removed: ${ch.session_id}`;
  if (t === "add_faculty") return `New teacher: ${(ch.faculty as { id: string; name: string })?.name}`;
  return t.replaceAll("_", " ");
}
