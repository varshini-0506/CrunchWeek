"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Button, ErrorBox, PageHead, useBusy } from "@/components/ui";
import { plain, roomNames } from "@/lib/plain";
import { api, DAY_NAME, DAYS, fmtHour, periodHour, type Decision, type SessionRow } from "@/lib/api";

type Draft = {
  title: string; attendance: number | null; duration_periods: number | null;
  windows: { day: string; from_period: number; to_period: number }[];
  room_types: string[]; needs: string[]; requested_room: string | null; mandatory_for_groups: string[];
  attending_faculty?: string[]; requested_category: string; raw_text?: string;
};
type Move = { session_id: string; from: [string, number, string]; to: [string, number, string] };
type WeekEvent = { request_id: string; title: string; day: string; start_period: number; end_period: number; groups?: string[]; faculty?: string[] };
type Parsed = Draft & { assumptions: string[]; follow_up: string[]; flags: string[]; parser: string };
type Preview = { ok: boolean; errors?: string[]; decision?: Decision; when?: string; category_label?: string; explain?: { notes?: string[]; blocked_by?: string[] } };

const EXAMPLES = [
  "kal shaam 6 se 8 baje robotics demo, 120 log, projector chahiye",
  "Guest lecture on chip design this Thursday 3 to 5 pm for about 150 students, need projector and mic",
  "Dance practice on Friday night 8 to 10, 60 people, open area is fine",
];
const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1);
const NEEDS: [string, string, string][] = [
  ["projector", "Projector", "📽️"], ["pa_system", "Sound / mic", "🎤"], ["stage", "Stage", "🎭"],
  ["computers", "Computers", "💻"], ["ac", "Air conditioning", "❄️"], ["whiteboard", "Whiteboard", "🧑‍🏫"],
];
const CATEGORY_NOTE: Record<string, string> = {
  institute_event: "Run by the institute for the whole fest",
  guest_lecture: "A talk by a visiting speaker",
  department_event: "Run by a department",
  club_event: "Run by a student club",
};
const PEOPLE = [30, 60, 100, 150, 300, 500];
const HOURS = [1, 2, 3, 4];
const ROOM_TYPE: Record<string, string> = { classroom: "Classroom", lecture_hall: "Lecture hall", seminar_hall: "Seminar hall", auditorium: "Auditorium", open_area: "Open air", outdoor: "Open air", lab: "Lab", lab_cs: "Computer lab", lab_elec: "Electronics lab", lab_phy: "Physics lab", lab_civil: "Civil lab", workshop: "Workshop" };
const key = (d: string, p: number) => `${d}-${p}`;
const noCodes = (s?: string) => s?.replace(/\s*\(P\d+(-P\d+)?\)/g, "");

/** Consecutive marked hours on each day become one "could happen between" window. */
function toWindows(sel: Set<string>) {
  const out: Draft["windows"] = [];
  for (const d of DAYS) {
    let start: number | null = null;
    for (const p of [...PERIODS, PERIODS.length + 1]) {
      if (sel.has(key(d, p))) { if (start === null) start = p; }
      else if (start !== null) { out.push({ day: d, from_period: start, to_period: p - 1 }); start = null; }
    }
  }
  return out;
}
const span = (w: { day: string; from_period: number; to_period: number }) => `${DAY_NAME[w.day]} ${fmtHour(periodHour(w.from_period))} to ${fmtHour(periodHour(w.to_period) + 1)}`;

export default function RequestPage() {
  const { user, meta, refresh } = useApp();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(defaultCategory(user?.role));
  const [people, setPeople] = useState<number | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [needs, setNeeds] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [room, setRoom] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [fac, setFac] = useState<string[]>([]);
  const [week7, setWeek7] = useState<{ sessions: SessionRow[]; events: WeekEvent[] } | null>(null);
  const drag = useRef<null | boolean>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ id: string; proposal: Decision; when?: string } | null>(null);
  const { busy, error, run } = useBusy();

  // Optional: type it, and the form fills itself in.
  const [text, setText] = useState("");
  const [today, setToday] = useState("TUE");
  const [parsed, setParsed] = useState<Parsed | null>(null);

  // Week 7 as it stands, so the grid can show when the people attending are already busy.
  useEffect(() => { api<{ sessions: SessionRow[]; events: WeekEvent[] }>("/timetable?week=spectra").then(setWeek7).catch(() => setWeek7(null)); }, [done]);
  useEffect(() => { const up = () => { drag.current = null; }; window.addEventListener("pointerup", up); return () => window.removeEventListener("pointerup", up); }, []);

  const roomTypes = useMemo(() => [...new Set(meta?.rooms.map((r) => r.type) ?? [])], [meta]);
  const windows = useMemo(() => toWindows(sel), [sel]);
  const short = hours ? windows.filter((w) => w.to_period - w.from_period + 1 < hours) : [];
  const draft: Draft = useMemo(() => ({
    title, attendance: people, duration_periods: hours, windows: windows.filter((w) => !hours || w.to_period - w.from_period + 1 >= hours),
    room_types: types, needs, requested_room: room, mandatory_for_groups: groups, attending_faculty: fac, requested_category: category,
  }), [title, people, hours, windows, types, needs, room, groups, fac, category]);

  // Who is busy when: classes of the attending sections and teachers, and events they already attend.
  const busyAt = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (k: string, what: string) => m.set(k, [...(m.get(k) ?? []), what]);
    for (const s of week7?.sessions ?? []) {
      const who = [...s.groups.filter((g) => groups.includes(g)), ...(fac.includes(s.faculty_id) ? [s.faculty_name] : [])];
      if (who.length) for (let k = 0; k < s.duration; k++) add(key(s.day, s.start_period + k), `${who.join(", ")}: ${s.course_id}`);
    }
    for (const e of week7?.events ?? []) {
      const who = [...(e.groups ?? []).filter((g) => groups.includes(g)), ...(e.faculty ?? []).filter((f) => fac.includes(f))];
      if (who.length) for (let p = e.start_period; p <= e.end_period; p++) add(key(e.day, p), `${who.join(", ")}: ${e.title}`);
    }
    return m;
  }, [week7, groups, fac]);

  const missing = [
    !title.trim() && "a name for the event",
    !people && "how many people are coming",
    !hours && "how long it runs",
    !draft.windows.length && (windows.length ? `a time slot at least ${hours} hours long` : "when it could happen"),
  ].filter(Boolean) as string[];

  // Live answer: what the planner would decide right now. Nothing is booked until "Send".
  useEffect(() => {
    if (missing.length) return;
    const t = setTimeout(() => {
      api<Preview>("/bookings/preview", { ...draft, raw_text: text }).then(setPreview).catch((e) => setPreview({ ok: false, errors: [String(e.message)] }));
    }, 350);
    return () => clearTimeout(t);
  }, [draft, text, missing.length]);

  const read = () => run(async () => {
    const p = await api<Parsed>("/bookings/parse", { text, today });
    setParsed(p); setDone(null);
    setTitle(p.title ?? ""); setPeople(p.attendance); setHours(p.duration_periods);
    setSel(new Set(p.windows.flatMap((w) => PERIODS.filter((x) => x >= w.from_period && x <= w.to_period).map((x) => key(w.day, x)))));
    setNeeds(p.needs); setTypes(p.room_types); setRoom(p.requested_room); setGroups(p.mandatory_for_groups); setFac([]);
    setCategory(defaultCategory(user?.role, p.requested_category));
    document.getElementById("ask-form")?.scrollIntoView({ behavior: "smooth" });
  });

  const submit = () => run(async () => {
    const r = await api<{ id: string; proposal: Decision }>("/bookings", { ...draft, raw_text: text });
    setDone({ ...r, when: noCodes(preview?.when) });
    await refresh();
  });
  const again = () => { setDone(null); setTitle(""); setSel(new Set()); setPreview(null); setGroups([]); setFac([]); };

  const setCells = (cells: string[], on: boolean) => setSel((prev) => { const n = new Set(prev); cells.forEach((c) => (on ? n.add(c) : n.delete(c))); return n; });
  const toggleGroup = (cells: string[]) => setCells(cells, !cells.every((c) => sel.has(c)));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const dec = preview?.ok ? preview.decision : undefined;
  const yours = new Set(dec?.day && dec.start_period ? PERIODS.filter((p) => p >= dec.start_period! && p <= (dec.end_period ?? dec.start_period!)).map((p) => key(dec.day!, p)) : []);
  const roomName = (id?: string) => meta?.rooms.find((r) => r.id === id)?.name ?? id;
  const cats = meta?.priority_order.filter((c) => c !== "exam" && c !== "regular_session") ?? [];

  return (
    <div className="space-y-4">
      <PageHead title={<>Ask for a room in a minute.</>}>
        Fill in six short steps. As you go, the planner tells you which room you would get and when, before anything is sent.
      </PageHead>
      <ErrorBox error={error} />

      {parsed && (parsed.assumptions.length > 0 || parsed.follow_up.length > 0) && (
        <div className="glass rounded-[8px] border-l-4 border-lake p-4 text-[14px]">
          <p className="font-semibold">I filled in the form from your message. Check the steps below.</p>
          <ul className="mt-1 space-y-0.5 text-ink-2">{[...parsed.assumptions, ...parsed.follow_up].map((a) => <li key={a}>· {a}</li>)}</ul>
        </div>
      )}

      {done ? (
        <section className="glass rounded-[8px] border-l-4 border-ok p-6 sm:p-8" role="status">
          <h2 className="font-poster text-[34px] uppercase leading-none">Sent! 🎉</h2>
          <p className="mt-3 text-[17px]"><b>{title}</b> was sent as request <b>{done.id}</b>.</p>
          <p className="mt-1 text-[15px] text-ink-2">
            {done.proposal.status === "rejected" ? "The planner couldn't find a room for it, but an approver will still look at it."
              : <>The planner suggests <b className="text-ink">{roomName(done.proposal.room_id)}</b>{done.when ? <>, <b className="text-ink">{done.when}</b></> : ""}. </>}
            {" "}A {user?.role === "club" || user?.role === "faculty" ? "department coordinator or admin" : "different admin"} confirms it next.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/spectra" className="inline-flex items-center rounded-[6px] bg-accent px-4 py-2 text-[14px] font-semibold text-white">Track it on Spectra</Link>
            <Button kind="secondary" onClick={again}>Ask for another room</Button>
          </div>
        </section>
      ) : (
        <section id="ask-form" className="glass scroll-mt-28 rounded-[8px] p-5 sm:p-7" aria-labelledby="ask-h">
          <h2 id="ask-h" className="font-poster text-[32px] uppercase leading-none">Ask for a room</h2>
          <p className="mt-1 text-[14px] text-ink-2">Six steps. The answer at the bottom updates as you fill it in.</p>

          <div className="mt-6">
            <Step n={1} title="What's the event?" done={!!title.trim()}>
              <input aria-label="Event name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Robotics demo, Guest talk on chip design"
                className="w-full max-w-[560px] rounded-[10px] px-3 py-2.5 text-[16px]" />
              <p className="mb-2 mt-4 text-[14px] font-medium">Who is running it?</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {cats.map((c, i) => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className={`rounded-[8px] border-2 p-3 text-left transition ${category === c ? "border-accent bg-accent-soft" : "border-[var(--edge)] hover:border-ink-3"}`}>
                    <span className="block text-[15px] font-semibold">{meta?.category_label[c] ?? c}</span>
                    <span className="block text-[12px] text-ink-2">{CATEGORY_NOTE[c] ?? ""}</span>
                    <span className="mt-1 block text-[12px] text-ink-3">Priority {i + 1} of {cats.length}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink-3">When two events want the same room, the higher priority gets it. A club can&apos;t raise its own priority.</p>
            </Step>

            <Step n={2} title="How many people, and for how long?" done={!!people && !!hours}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-20 text-[14px] text-ink-2">People</span>
                {PEOPLE.map((n) => <Pick key={n} on={people === n} onClick={() => setPeople(n)}>{n}</Pick>)}
                <input aria-label="Exact number of people" type="number" min={1} value={people ?? ""} onChange={(e) => setPeople(e.target.value ? +e.target.value : null)} placeholder="Other"
                  className="w-24 rounded-[10px] px-3 py-1.5 text-[14px]" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="w-20 text-[14px] text-ink-2">Hours</span>
                {HOURS.map((n) => <Pick key={n} on={hours === n} onClick={() => setHours(n)}>{n} hour{n > 1 ? "s" : ""}</Pick>)}
                <input aria-label="Exact number of hours" type="number" min={1} max={13} value={hours ?? ""} onChange={(e) => setHours(e.target.value ? +e.target.value : null)} placeholder="Other"
                  className="w-24 rounded-[10px] px-3 py-1.5 text-[14px]" />
              </div>
            </Step>

            <Step n={3} title="Who is attending?" done={groups.length > 0 || fac.length > 0}>
              <p className="mb-3 text-[14px] text-ink-2">
                Pick the sections and teachers who will be there. Their timetables count: the planner only picks a time when all of them are free, so nobody misses a class.
                {category === "institute_event" ? " If they are never all free, an institute event may move the fewest possible classes, for Week 7 only." : ""}
              </p>
              <p className="mb-1.5 text-[13px] font-medium">Sections (students)</p>
              <div className="flex flex-wrap gap-1.5">{meta?.groups.map((g) => <Pick key={g.id} on={groups.includes(g.id)} onClick={() => setGroups(toggle(groups, g.id))}><span title={g.name}>{g.id}</span></Pick>)}</div>
              <p className="mb-1.5 mt-4 text-[13px] font-medium">Teachers</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {fac.map((f) => (
                  <span key={f} className="inline-flex items-center gap-1 rounded-full border-2 border-accent bg-accent px-3 py-1 text-[14px] font-medium text-white">
                    {meta?.faculty.find((x) => x.id === f)?.name ?? f}
                    <button type="button" aria-label={`Remove ${f}`} onClick={() => setFac(fac.filter((x) => x !== f))} className="ml-1 opacity-80 hover:opacity-100">✕</button>
                  </span>
                ))}
                <select aria-label="Add a teacher" value="" onChange={(e) => e.target.value && setFac([...fac, e.target.value])} className="rounded-[10px] px-3 py-1.5 text-[14px]">
                  <option value="">+ Add a teacher…</option>
                  {meta?.faculty.filter((f) => !fac.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name} · {f.department}</option>)}
                </select>
              </div>
              {(groups.length > 0 || fac.length > 0) && <p className="mt-3 text-[13px] text-ink-2">Their busy hours now show in grey on the week below.</p>}
              {groups.length === 0 && fac.length === 0 && <p className="mt-3 text-[13px] text-ink-3">Open to everyone? Leave this empty.</p>}
            </Step>

            <Step n={4} title="When could it happen?" done={draft.windows.length > 0}>
              <p className="mb-3 text-[14px] text-ink-2">
                Click or drag over every hour that would work for you, in Spectra week. Mark more than you need: {hours ? <b>the event needs {hours} hour{hours > 1 ? "s" : ""} in a row</b> : "the planner picks the best slot inside them"}, and more options mean a better chance.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                <Chip onClick={() => setCells(DAYS.flatMap((d) => [10, 11, 12, 13].map((p) => key(d, p))), true)}>Every evening (6 to 10 pm)</Chip>
                <Chip onClick={() => setCells(DAYS.flatMap((d) => [6, 7, 8, 9].map((p) => key(d, p))), true)}>Every afternoon (2 to 6 pm)</Chip>
                {sel.size > 0 && <Chip onClick={() => setSel(new Set())}>Clear</Chip>}
              </div>
              <div className="overflow-x-auto">
                <table onPointerMove={(e) => { if (drag.current === null) return; const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-k]"); if (el?.dataset.k) setCells([el.dataset.k], drag.current); }} className="w-full min-w-[560px] table-fixed border-separate border-spacing-1 select-none text-[13px]">
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
                          <th scope="row"><button type="button" onClick={() => toggleGroup(DAYS.map((d) => key(d, p)))} className="w-full rounded-[6px] py-1.5 text-right font-normal text-ink-2 hover:bg-fill">{fmtHour(periodHour(p))}</button></th>
                          {DAYS.map((d) => {
                            const k = key(d, p), on = sel.has(k), got = yours.has(k), b = busyAt.get(k);
                            return (
                              <td key={d} className="p-0">
                                <button type="button" aria-pressed={on} title={b ? `Busy: ${b.join("; ")}` : undefined} aria-label={`${DAY_NAME[d]} ${fmtHour(periodHour(p))}${got ? ", the planner's pick" : ""}${b ? `, busy: ${b.join("; ")}` : ""}`}
                                  data-k={k} onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); const v = !on; drag.current = v; setCells([k], v); }}
                                  onPointerEnter={() => { if (drag.current !== null) setCells([k], drag.current); }}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCells([k], !on); } }}
                                  className={`flex h-9 w-full min-w-0 items-center justify-center gap-1 rounded-[6px] px-1 text-[11px] font-semibold transition-colors ${
                                    got ? "bg-[#146547] text-white" : on && b ? "busy-on text-[#0e1a1d]" : on ? "bg-[#5fd3a8] text-[#0e1a1d]" : b ? "busy text-ink-2" : "bg-fill-2 text-ink-3 hover:bg-fill"}`}>
                                  {got ? "★ Yours" : <span className="truncate">{on && !b ? "✓" : b ? b[0].split(": ")[1] : ""}</span>}
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
                <span className="flex items-center gap-1.5"><i className="h-3 w-4 rounded-[3px] bg-[#5fd3a8]" />Works for you</span>
                <span className="flex items-center gap-1.5"><i className="h-3 w-4 rounded-[3px] bg-[#146547]" />The slot the planner would give you</span>
                {busyAt.size > 0 && <span className="flex items-center gap-1.5"><i className="busy h-3 w-4 rounded-[3px]" />Someone attending is busy (hover to see who)</span>}
              </div>
              {windows.length > 0 && <p className="mt-2 text-[13px] text-ink-2">You picked: {windows.map(span).join("; ")}.</p>}
              {short.length > 0 && <p className="mt-1 text-[13px] font-medium text-bad">Too short for a {hours}-hour event, so it will be skipped: {short.map(span).join("; ")}.</p>}
            </Step>

            <Step n={5} title="What do you need?" done={needs.length > 0 || types.length > 0}>
              <p className="mb-2 text-[14px] text-ink-2">Tap anything the room must have. Skip it if you don&apos;t mind.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {NEEDS.map(([k, label, icon]) => (
                  <button key={k} type="button" aria-pressed={needs.includes(k)} onClick={() => setNeeds(toggle(needs, k))}
                    className={`flex flex-col items-center gap-1 rounded-[8px] border-2 px-2 py-3 text-[13px] font-medium transition ${needs.includes(k) ? "border-accent bg-accent-soft" : "border-[var(--edge)] hover:border-ink-3"}`}>
                    <span aria-hidden className="text-[24px] leading-none">{icon}</span>{label}
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-[14px] text-ink-2">What kind of place? <span className="text-ink-3">(leave empty for any)</span></p>
              <div className="flex flex-wrap gap-2">{roomTypes.map((t) => <Pick key={t} on={types.includes(t)} onClick={() => setTypes(toggle(types, t))}>{ROOM_TYPE[t] ?? t.replaceAll("_", " ")}</Pick>)}</div>
              <details className="mt-4 text-[14px]">
                <summary className="cursor-pointer font-medium text-link">More options: a specific room</summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-ink-2">A specific room you&apos;d like
                    <select value={room ?? ""} onChange={(e) => setRoom(e.target.value || null)} className="mt-1 block w-full max-w-[460px] rounded-[10px] px-3 py-2 text-ink">
                      <option value="">Any suitable room</option>
                      {meta?.rooms.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.capacity} seats</option>)}
                    </select>
                  </label>
                </div>
              </details>
            </Step>

            <Step n={6} title="Your answer" done={false}>
              <Answer missing={missing} preview={preview} roomName={roomName} people={people} meta={meta} attendees={groups.length + fac.length} />
              <div className="mt-4"><Button onClick={submit} disabled={busy || !!missing.length || !preview?.ok}>Send it to an approver<ArrowRight /></Button></div>
            </Step>
          </div>
        </section>
      )}

      <details className="glass group rounded-[8px] p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span><span className="font-poster block text-[22px] uppercase leading-none">Or just type it</span><span className="mt-1 block text-[13px] text-ink-3">Write it like a text message, in English or Hinglish, and the form above fills itself in.</span></span>
          <span aria-hidden className="text-[20px] text-ink-3 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4">
          <textarea aria-label="Your message" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. kal shaam 6 se 8 baje robotics demo, 120 log, projector chahiye" className="w-full rounded-[10px] p-3 text-[15px]" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={read} disabled={busy || !text.trim()}>Fill the form</Button>
            <label className="text-[13px] text-ink-3">“Kal” means the day after
              <select value={today} onChange={(e) => setToday(e.target.value)} className="ml-1 rounded-[10px] px-1 py-0.5">{DAYS.map((d) => <option key={d} value={d}>{DAY_NAME[d]}</option>)}</select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setText(e)} className="rounded-full bg-fill px-3 py-1 text-left text-[12px] text-ink-2 hover:text-ink">{e}</button>)}</div>
        </div>
      </details>
    </div>
  );
}

function Answer({ missing, preview, roomName, people, meta, attendees }: { missing: string[]; preview: Preview | null; roomName: (id?: string) => string | undefined; people: number | null; meta: ReturnType<typeof useApp>["meta"]; attendees: number }) {
  if (missing.length) return (
    <div className="rounded-[8px] border-l-4 border-[var(--edge)] bg-fill-2 p-4 text-[14px]">
      <p className="font-medium">Almost there. Still needed:</p>
      <ul className="mt-1 space-y-0.5 text-ink-2">{missing.map((m) => <li key={m}>○ {m}</li>)}</ul>
    </div>
  );
  if (!preview) return <div className="rounded-[8px] bg-fill-2 p-4 text-[14px] text-ink-3">Asking the planner…</div>;
  if (!preview.ok) return <div className="rounded-[8px] border-l-4 border-bad bg-bad-soft p-4 text-[14px] text-bad"><p className="font-medium">Something needs fixing:</p><ul>{preview.errors?.map((e) => <li key={e}>· {e}</li>)}</ul></div>;
  const d = preview.decision!;
  const tone = d.status === "approved" ? "border-ok bg-ok-soft" : d.status === "rejected" ? "border-bad bg-bad-soft" : "border-warn bg-warn-soft";
  const head = d.status === "approved" ? "✅ You would get it" : d.status === "rejected" ? "❌ No room is free for this" : "🔁 Not possible in the hours you marked. The nearest time that works:";
  const cap = meta?.rooms.find((r) => r.id === d.room_id)?.capacity;
  const moves = ((d as Decision & { moves?: Move[] }).moves ?? []);
  const slot = (x: [string, number, string]) => `${DAY_NAME[x[0]]?.slice(0, 3)} ${fmtHour(periodHour(x[1]))}, ${meta?.rooms.find((r) => r.id === x[2])?.name ?? x[2]}`;
  return (
    <div className={`rounded-[8px] border-l-4 p-4 ${tone}`} role="status">
      <p className="text-[17px] font-semibold">{head}</p>
      {d.room_id && <p className="mt-2 text-[22px] font-semibold leading-tight">{roomName(d.room_id)}{preview.when && <span className="block text-[16px] font-medium text-ink-2">{noCodes(preview.when)}</span>}</p>}
      {cap && people ? <p className="mt-1 text-[13px] text-ink-2">{cap} seats for your {people} people. Shown as ★ Yours on the week above.</p> : null}
      {d.status !== "rejected" && attendees > 0 && (moves.length === 0
        ? <p className="mt-2 text-[14px] font-medium text-ok">Everyone attending is free then. No class has to move.</p>
        : <div className="mt-2 text-[14px]"><p className="font-medium">{moves.length} class{moves.length === 1 ? "" : "es"} move for Week 7 only (the fewest possible):</p>
            <ul className="mt-1 space-y-0.5 text-ink-2">{moves.map((m) => <li key={m.session_id}><b className="text-ink">{m.session_id.split("-")[0]}</b> {slot(m.from)} <span aria-hidden>→</span> <b className="text-ok">{slot(m.to)}</b></li>)}</ul></div>)}
      <p className="mt-2 text-[14px] text-ink-2">{noCodes(plain(d.reason.split(". Moved for Week 7 only")[0], roomNames(meta?.rooms), false))}</p>
      {preview.explain?.notes?.map((n) => <p key={n} className="mt-1 text-[13px] text-warn">{n}</p>)}
      <p className="mt-2 text-[12px] text-ink-3">Nothing is booked yet. This is what the planner would decide if you sent it now.</p>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[36px_1fr] gap-x-4">
      <span className={`grid h-9 w-9 place-items-center rounded-full text-[15px] font-semibold ${done ? "bg-ok text-white" : "bg-ink text-paper"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 pb-8">
        <h3 className="font-poster pt-1 text-[22px] uppercase leading-none">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full border-2 px-3.5 py-1 text-[14px] font-medium transition ${on ? "border-accent bg-accent text-white" : "border-[var(--edge)] hover:border-ink-3"}`}>{children}</button>;
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="rounded-full border border-[var(--edge)] bg-sheet px-3 py-1 text-[13px] font-medium hover:bg-fill">{children}</button>;
}

function ArrowRight() {
  return <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function defaultCategory(role?: string, parsed?: string): string {
  if (parsed && parsed !== "club_event") return parsed;
  return { admin: "institute_event", department_coordinator: "department_event", faculty: "guest_lecture", club: "club_event" }[role ?? "club"] ?? "club_event";
}
