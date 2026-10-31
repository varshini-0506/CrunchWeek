"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, DAY_NAME } from "@/lib/api";
import { ROLE_LABEL, USERS } from "@/lib/users";

/* Landing page. One idea: show the real plan on the first screen.
   Left: what CrunchWeek is, and the way in. Right: the live Week 7 venue board from the engine. */

type Period = { id: number; start: string; end: string };
type Room = { id: string; name: string; capacity: number };
type Session = { session_id: string; course_id: string; title: string; kind: string; groups: string[]; faculty_name: string; day: string; start_period: number; duration: number; room_id: string };
type Event = { request_id: string; status: string; day: string; start_period: number; end_period: number; room_id: string; reason: string; title: string; requester: string; category: string };
type Row = { request: { id: string; title: string; requester: string; attendance: number }; decision: { status: string; reason: string; room_id?: string } | null; state: string; category_label: string; when?: string };
type Status = { sessions: number; total_sessions: number; hard_violations: number | null; approved: number; alternatives: number; rejected: number; exams: number; solve: { seconds?: number; exam_seconds?: number } };

type Data = { periods: Period[]; rooms: Record<string, Room>; sessions: Session[]; events: Event[]; rows: Row[]; status: Status };

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const SHORT: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri" };
const VENUES = ["AUD", "SH-1", "SH-2", "OAT", "CS-LAB-1", "CS-LAB-2"];

/** Engine reasons carry internal codes like "(P4-P5)", "BR-16" and "OAT". Turn them into plain sentences,
    and drop the "X free Mon 11 am to 1 pm" sentence, since the venue and time are shown next to it. */
const NAMES: { rooms: Record<string, string>; ends: Record<number, string> } = { rooms: {}, ends: {} };
function plain(reason: string) {
  const out = reason
    .replace(/\s*\((?:P\d+(?:-P\d+)?|BR-[\w]+)\)/g, "")
    .replace(/\bP(\d+)\b/g, (m, n: string) => NAMES.ends[+n] ? hm(NAMES.ends[+n]) : m)
    .replace(/\b(?:Room )?([A-Z]{2,}(?:-[A-Z0-9]+)*(?:-\d+)?)\b/g, (m, c: string) => NAMES.rooms[c] ?? m)
    .replace(/priority rank (\d+)/g, "number $1 in the priority order")
    .replace(/who has priority or asked first/g, "who comes earlier in the priority order")
    .replace(/(\b[\w ]+?) meets every need/g, "so it got $1 instead, which has everything it needs")
    .replace(/;\s*(\w)/g, (_, c: string) => `. ${c.toUpperCase()}`)
    .split(/(?<=\.)\s+/)
    .filter((x) => !/ free (Mon|Tue|Wed|Thu|Fri|Sat) /.test(x))
    .join(" ");
  return out.replace(/\.?$/, ".");
}
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };

const isSpectra = (e: Event) => e.category === "institute_event";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ calendar: { periods: (Period & { id: number })[] }; rooms: Room[] }>("/meta"),
      api<{ sessions: Session[]; events: Event[] }>("/timetable?week=spectra"),
      api<{ rows: Row[] }>("/bookings"),
      api<Status>("/status"),
    ]).then(([m, t, b, s]) => {
      NAMES.rooms = Object.fromEntries(m.rooms.map((r) => [r.id, r.name]));
      NAMES.ends = Object.fromEntries(m.calendar.periods.map((p) => [p.id, p.end]));
      setData({
      periods: m.calendar.periods.filter((p) => p.id <= 13),
      rooms: Object.fromEntries(m.rooms.map((r) => [r.id, r])),
      sessions: t.sessions, events: t.events, rows: b.rows, status: s,
      });
    }).catch(() => setDown(true));
  }, []);

  const signIn = async (username: string) => {
    setBusy(username);
    await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-paper">
      <Header />

      <main className="mx-auto max-w-[1280px] px-5 lg:px-8">
        <section className="grid gap-8 pb-16 pt-8 lg:grid-cols-12 lg:gap-10 lg:pt-12">
          {/* Left: what it is, and the way in. */}
          <div className="min-w-0 lg:col-span-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-sheet px-3 py-1 text-[13px] font-medium text-ink-2 shadow-[var(--shadow-card)]">
              <span className="h-1.5 w-1.5 rounded-full bg-jade" /> Spectra &apos;27 · Week 7 is planned
            </span>
            <h1 className="mt-5 text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]">
              Classes, midsems and fest events. One plan, no clashes.
            </h1>
            <p className="mt-4 text-[16px] leading-[1.6] text-ink-2">
              CrunchWeek builds CIT&apos;s timetable, schedules the midsems and decides Spectra venue requests by the institute&apos;s
              priority order. If a room is taken, you get the reason and the nearest free option.
            </p>

            <div id="desks" className="mt-8 scroll-mt-20">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">Sign in</h2>
                <span className="text-[13px] text-ink-3">Demo accounts, no password</span>
              </div>
              <ul className="mt-3 overflow-hidden rounded-[14px] bg-sheet shadow-[var(--shadow-card)]">
                {USERS.map((u, i) => (
                  <li key={u.username} className={i ? "border-t border-rule" : ""}>
                    <button onClick={() => signIn(u.username)} disabled={busy !== null}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-fill-2 disabled:opacity-60">
                      <Avatar name={u.name} i={i} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[15px] font-medium"><span className="truncate">{u.name}</span>
                          <span className="shrink-0 whitespace-nowrap rounded-full bg-fill px-2 py-px text-[11px] font-medium text-ink-2">{ROLE_LABEL[u.role]}</span>
                        </span>
                        <span className="block truncate text-[13px] text-ink-3">{u.blurb}</span>
                      </span>
                      {busy === u.username
                        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3/30 border-t-accent" />
                        : <svg viewBox="0 0 16 16" className="h-4 w-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 3 5 5-5 5" /></svg>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: the live board. */}
          <div className="min-w-0 lg:col-span-8">
            <VenueBoard data={data} down={down} />
          </div>
        </section>

        <HowItWorks data={data} />
        <Decisions data={data} />
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-ink-3 lg:px-8">
          <span>CrunchWeek · Chilika Institute of Technology</span>
          <span>Timetable and venues planned with Google OR-Tools</span>
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── Header ───────────────────────────── */

function Header() {
  const [flip, setFlip] = useState(0);
  const dark = useSyncExternalStore(
    (cb) => { const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => { void flip; const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; },
    () => false,
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("cw-theme", next ? "dark" : "light"); } catch {}
    setFlip((x) => x + 1);
  };
  return (
    <header className="material sticky top-0 z-30 border-b border-rule">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-5 lg:px-8">
        <Logo />
        <span className="text-[16px] font-semibold tracking-[-0.01em]">CrunchWeek</span>
        <span className="hidden text-[13px] text-ink-3 sm:inline">Chilika Institute of Technology</span>
        <nav className="ml-auto flex items-center gap-1 text-[14px]">
          <a href="#how" className="hidden rounded-full px-3 py-1.5 text-ink-2 transition-colors hover:bg-fill hover:text-ink sm:block">How it works</a>
          <a href="#decisions" className="hidden rounded-full px-3 py-1.5 text-ink-2 transition-colors hover:bg-fill hover:text-ink sm:block">Spectra requests</a>
          <button onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="grid h-9 w-9 place-items-center rounded-full text-ink-2 transition-colors hover:bg-fill hover:text-ink">
            {dark
              ? <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="3.5" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" /></svg>
              : <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z" /></svg>}
          </button>
          <a href="#desks" className="ml-1 rounded-full bg-accent px-4 py-1.5 font-medium text-white transition hover:brightness-110 lg:hidden">Sign in</a>
        </nav>
      </div>
    </header>
  );
}

/** Two rounded squares, the second offset: a booking that found its own slot. */
function Logo() {
  return (
    <span className="relative block h-6 w-6" aria-hidden>
      <span className="absolute left-0 top-0 h-4 w-4 rounded-[4px] border-[1.5px] border-ink" />
      <span className="absolute bottom-0 right-0 h-4 w-4 rounded-[4px] bg-accent" />
    </span>
  );
}

const AVATAR = ["bg-accent", "bg-brass", "bg-jade", "bg-dusk", "bg-lake"];
function Avatar({ name, i }: { name: string; i: number }) {
  const ini = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white ${AVATAR[i % 5]}`}>{ini}</span>;
}

/* ───────────────────────────── Venue board ───────────────────────────── */

type Block = { key: string; kind: "class" | "spectra" | "event"; title: string; sub: string; start: number; span: number; room: string; day: string; moved: boolean; reason?: string; who?: string };

function VenueBoard({ data, down }: { data: Data | null; down: boolean }) {
  const [day, setDay] = useState("FRI");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<Block | null>(null);

  const blocks = useMemo<Block[]>(() => {
    if (!data) return [];
    const ev: Block[] = data.events.map((e) => ({
      key: e.request_id, kind: isSpectra(e) ? "spectra" : "event", title: e.title, sub: e.requester, start: e.start_period,
      span: e.end_period - e.start_period + 1, room: e.room_id, day: e.day, reason: plain(e.reason), who: e.requester,
      moved: e.status === "alternative_offered" || /went to|does not exist|Nearest free/.test(e.reason),
    }));
    const cl: Block[] = data.sessions.map((s) => ({
      key: s.session_id, kind: "class", title: s.course_id, sub: `${s.title} · ${s.groups.join(", ")}`, start: s.start_period,
      span: s.duration, room: s.room_id, day: s.day, moved: false, who: s.faculty_name,
    }));
    return [...ev, ...cl];
  }, [data]);

  const rooms = useMemo(() => {
    if (!data) return VENUES;
    const extra = [...new Set(data.events.map((e) => e.room_id))].filter((r) => !VENUES.includes(r)).sort();
    return [...VENUES, ...extra];
  }, [data]);

  const today = blocks.filter((b) => b.day === day && rooms.includes(b.room));
  const counts = Object.fromEntries(DAYS.map((d) => [d, blocks.filter((b) => b.day === d && b.kind !== "class").length]));
  // Default to the most telling example on the day: an event that was moved, else the first event.
  const fallback = today.find((b) => b.moved) ?? today.find((b) => b.kind !== "class") ?? today[0];
  const picked = today.find((b) => b.key === sel) ?? fallback;
  const n = data?.periods.length ?? 13;
  const s = data?.status;
  const live = (data?.rows ?? []).filter((r) => r.state !== "cancelled");

  return (
    <section aria-label="Week 7 venue board" className="overflow-hidden rounded-[18px] bg-sheet shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Week 7 venue board</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${down ? "bg-bad" : "bg-jade"}`} />
            {down ? "The planner isn't running right now" : "Live from the planner · Spectra week"}
          </p>
        </div>
        <Legend />
      </div>

      {/* Headline numbers. */}
      <dl className="mt-5 grid grid-cols-2 border-y border-rule sm:grid-cols-4">
        <Stat label="Classes placed" value={s ? s.sessions : null} of={s?.total_sessions} />
        <Stat label="Double bookings" value={s ? s.hard_violations ?? 0 : null} good={s?.hard_violations === 0} />
        <Stat label="Fest requests given a venue" value={data ? live.filter((r) => r.decision?.status !== "rejected").length : null} of={data ? live.length : undefined} />
        <Stat label="Midsems scheduled" value={s ? s.exams : null} />
      </dl>

      {/* Day picker. */}
      <div className="flex items-center gap-1 overflow-x-auto px-5 pt-4" role="tablist" aria-label="Day">
        {DAYS.map((d) => (
          <button key={d} role="tab" aria-selected={d === day} onClick={() => { setDay(d); setSel(null); }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${d === day ? "bg-ink text-paper" : "text-ink-2 hover:bg-fill"}`}>
            {SHORT[d]}
            {data && <span className={`tabular rounded-full px-1.5 text-[11px] ${d === day ? "bg-paper/20" : "bg-fill"}`}>{counts[d]}</span>}
          </button>
        ))}
        <span className="ml-auto hidden whitespace-nowrap pl-3 text-[12px] text-ink-3 sm:block">Room size shown next to each venue · count = fest events that day</span>
      </div>

      {/* The grid: venues down, hours across. */}
      <div className="mt-3 overflow-x-auto px-5 pb-1">
        <div className="min-w-[760px]" onPointerLeave={() => setHover(null)}>
          <div className="grid" style={{ gridTemplateColumns: `150px repeat(${n}, minmax(0, 1fr))` }}>
            <span />
            {(data?.periods ?? Array.from({ length: 13 }, (_, i) => ({ id: i + 1, start: `${i < 5 ? 8 + i : 9 + i}:00` }))).map((p) => (
              <span key={p.id} className={`pb-1.5 pl-1 text-[11px] tabular transition-colors ${hover && p.id >= hover.start && p.id < hover.start + hover.span ? "font-semibold text-ink" : "text-ink-3"}`}>{hm(p.start)}</span>
            ))}
          </div>
          {rooms.map((r) => {
            const inRow = today.filter((b) => b.room === r);
            const lit = hover?.room === r;
            return (
              <div key={r} className="grid border-t border-rule" style={{ gridTemplateColumns: `150px repeat(${n}, minmax(0, 1fr))` }}>
                <div className={`flex min-w-0 items-baseline gap-1.5 self-center pr-2 transition-colors ${lit ? "text-accent" : ""}`}>
                  <span className="truncate text-[13px] font-medium">{data?.rooms[r]?.name.replace("Classroom ", "Room ") ?? r}</span>
                  <span className="shrink-0 text-[11px] tabular text-ink-3">{data?.rooms[r]?.capacity ?? ""}</span>
                </div>
                <div className="relative col-span-full col-start-2 grid min-h-[42px] py-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                  {/* Hour guides, and the hovered block's time band. */}
                  {Array.from({ length: n }, (_, i) => (
                    <span key={i} className={`row-start-1 h-full border-l border-dashed border-rule transition-colors ${hover && i + 1 >= hover.start && i + 1 < hover.start + hover.span ? "bg-accent/[0.06]" : ""}`} style={{ gridColumn: i + 1 }} />
                  ))}
                  {inRow.map((b) => (
                    <Cell key={b.key} b={b} on={picked?.key === b.key} onPick={() => setSel(b.key)} onHover={setHover} />
                  ))}
                  {!data && !down && <span className="row-start-1 my-0.5 h-9 animate-pulse rounded-md bg-fill" style={{ gridColumn: `${2 + (r.length % 5)} / span 3` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* What the selected block is, and why it is there. */}
      <div className="border-t border-rule bg-fill-2 px-5 py-4">
        {picked && data ? <Detail b={picked} data={data} /> : (
          <p className="text-[14px] text-ink-3">{down ? "Start the engine (uvicorn app.main:app) to see the live plan." : "Loading the plan…"}</p>
        )}
      </div>
    </section>
  );
}

function Cell({ b, on, onPick, onHover }: { b: Block; on: boolean; onPick: () => void; onHover: (b: Block | null) => void }) {
  const tone = b.kind === "class"
    ? "bg-fill text-ink-2 border-ink-3/50"
    : b.kind === "spectra" ? "bg-dusk-soft text-ink border-dusk" : "bg-lake-soft text-ink border-lake";
  return (
    <button onClick={onPick} onPointerEnter={() => onHover(b)} onFocus={() => onHover(b)} onBlur={() => onHover(null)}
      aria-label={`${b.title}, ${b.sub}`}
      className={`relative z-10 row-start-1 mx-[2px] my-0.5 flex min-w-0 flex-col justify-center overflow-hidden rounded-[6px] border-l-[3px] px-1.5 py-1 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-px ${tone} ${on ? "shadow-[0_0_0_2px_var(--blue)]" : "hover:shadow-[var(--shadow-pop)]"}`}
      style={{ gridColumn: `${b.start} / span ${b.span}` }}>
      <span className="truncate text-[12px] font-semibold leading-tight">{b.title}</span>
      {b.span > 1 && <span className="truncate text-[11px] leading-tight text-ink-3">{b.kind === "class" ? b.sub.split(" · ")[0] : b.sub}</span>}
      {b.moved && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brass" />}
    </button>
  );
}

function Detail({ b, data }: { b: Block; data: Data }) {
  const p = data.periods;
  const from = p.find((x) => x.id === b.start), to = p.find((x) => x.id === b.start + b.span - 1);
  const when = `${DAY_NAME[b.day]}, ${from ? hm(from.start) : ""} to ${to ? hm(to.end) : ""}`;
  const room = data.rooms[b.room]?.name ?? b.room;
  return (
    <div key={b.key} className="pop flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{b.kind === "class" ? `${b.title} · ${b.sub.split(" · ")[0]}` : b.title}</span>
          <Tag kind={b.kind} moved={b.moved} />
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">{room} · {when} · {b.kind === "class" ? `${b.who}, ${b.sub.split(" · ")[1]}` : b.who}</div>
      </div>
      <p className="max-w-[440px] text-[13px] leading-relaxed text-ink-2">
        {b.kind === "class" ? "A regular class. The planner kept it here so no student, teacher or room is double-booked, even with Spectra running." : b.reason}
      </p>
    </div>
  );
}

function Tag({ kind, moved }: { kind: Block["kind"]; moved: boolean }) {
  if (moved) return <span className="rounded-full bg-brass/15 px-2 py-0.5 text-[11px] font-medium text-brass">Moved to a free venue</span>;
  if (kind === "class") return <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-medium text-ink-2">Class</span>;
  return <span className="rounded-full bg-jade/15 px-2 py-0.5 text-[11px] font-medium text-jade">Confirmed</span>;
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
      <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] border-l-2 border-ink-3/50 bg-fill" />Class</li>
      <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] border-l-2 border-dusk bg-dusk-soft" />Spectra</li>
      <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] border-l-2 border-lake bg-lake-soft" />Club or department</li>
      <li className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-brass" />Moved</li>
    </ul>
  );
}

function Stat({ label, value, of, good }: { label: string; value: number | null; of?: number; good?: boolean }) {
  return (
    <div className="border-rule px-5 py-4 [&:nth-child(n+2)]:border-l max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={`mt-1 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular ${good ? "text-jade" : ""}`}>
        {value === null ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-fill align-middle" /> : <Count to={value} />}
        {of !== undefined && value !== null && <span className="text-[15px] font-medium text-ink-3"> / {of}</span>}
      </dd>
    </div>
  );
}

function Count({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 700); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}

/* ───────────────────────────── How it works ───────────────────────────── */

function HowItWorks({ data }: { data: Data | null }) {
  const moved = data?.rows.find((r) => r.decision?.status === "approved" && /went to/.test(r.decision.reason));
  const declined = data?.rows.find((r) => r.state !== "cancelled" && r.decision?.status === "rejected");
  const s = data?.status;
  const items = [
    {
      n: "1", t: "It plans the whole week", d: "Every class gets a room and a time. No student group, teacher or room is ever booked twice.",
      ex: s ? `${s.sessions} classes placed in ${Math.round(s.solve.seconds ?? 0)} seconds, and ${s.exams} midsems spaced so nobody sits two on one day.` : null,
    },
    {
      n: "2", t: "It decides room requests fairly", d: "Requests follow the institute's priority order: institute events, then guest lectures, departments and clubs.",
      ex: moved ? `${moved.request.requester} asked for "${moved.request.title}". ${plain(moved.decision!.reason).split(". ").slice(1).join(". ")}` : null,
    },
    {
      n: "3", t: "It says no clearly", d: "When nothing fits, the request is declined with a plain reason, so nobody is left waiting on a phone call.",
      ex: declined ? `${declined.request.requester}, "${declined.request.title}": ${plain(declined.decision!.reason)}` : null,
    },
  ];
  return (
    <section id="how" className="scroll-mt-20 border-t border-rule py-16">
      <h2 className="text-[26px] font-semibold tracking-[-0.02em]">How it works</h2>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {items.map((it) => (
          <article key={it.n} className="flex flex-col rounded-[16px] bg-sheet p-6 shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-pop)]">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{it.n}</span>
            <h3 className="mt-4 text-[17px] font-semibold">{it.t}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{it.d}</p>
            <div className="mt-5 rounded-[10px] bg-fill-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              <span className="mb-1 block text-[11px] font-semibold text-ink-3">From this week&apos;s plan</span>
              {it.ex ?? <span className="text-ink-3">Loading…</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── Every Spectra decision ───────────────────────────── */

const FILTERS = [
  { id: "all", label: "All" },
  { id: "approved", label: "Confirmed" },
  { id: "alternative_offered", label: "Other slot offered" },
  { id: "rejected", label: "Declined" },
] as const;

function Decisions({ data }: { data: Data | null }) {
  const [f, setF] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [all, setAll] = useState(false);
  const rows = (data?.rows ?? []).filter((r) => r.state !== "cancelled");
  const match = rows.filter((r) => f === "all" || r.decision?.status === f);
  const shown = all ? match : match.slice(0, 8);
  const count = (id: string) => rows.filter((r) => id === "all" || r.decision?.status === id).length;
  return (
    <section id="decisions" className="scroll-mt-20 border-t border-rule py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold tracking-[-0.02em]">Every Spectra request, decided</h2>
          <p className="mt-1 text-[15px] text-ink-2">Each one shows where it landed and why. Sign in as a club to make your own.</p>
        </div>
        <div className="seg max-w-full overflow-x-auto" role="tablist">
          {FILTERS.map((x) => (
            <button key={x.id} role="tab" aria-selected={f === x.id} onClick={() => { setF(x.id); setAll(false); }} className={f === x.id ? "bg-accent" : ""}>
              {x.label} <span className="tabular text-ink-3">{data ? count(x.id) : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-[16px] bg-sheet shadow-[var(--shadow-card)]">
        <div className="hidden grid-cols-[1.4fr_1fr_1.1fr_2fr] gap-4 border-b border-rule px-5 py-2.5 text-[12px] font-medium text-ink-3 md:grid">
          <span>Event</span><span>Venue</span><span>When</span><span>Why</span>
        </div>
        {!data ? <div className="px-5 py-6 text-[14px] text-ink-3">Loading…</div> : shown.map((r) => {
          const st = r.decision?.status;
          return (
            <div key={r.request.id} className="grid gap-x-4 gap-y-1 border-b border-rule px-5 py-3.5 transition-colors duration-150 last:border-0 hover:bg-fill-2 md:grid-cols-[1.4fr_1fr_1.1fr_2fr]">
              <div>
                <div className="text-[14px] font-medium">{r.request.title}</div>
                <div className="text-[12px] text-ink-3">{r.request.requester} · {r.category_label}</div>
              </div>
              <div className="text-[14px]">{r.decision?.room_id ? data.rooms[r.decision.room_id]?.name ?? r.decision.room_id : <span className="text-ink-3">None</span>}</div>
              <div className="text-[14px] text-ink-2">
                <span className={`mr-2 inline-block rounded-full px-2 py-px text-[11px] font-medium ${st === "approved" ? "bg-jade/15 text-jade" : st === "rejected" ? "bg-bad/15 text-bad" : "bg-brass/15 text-brass"}`}>
                  {st === "approved" ? "Confirmed" : st === "rejected" ? "Declined" : "Other slot"}
                </span>
                {r.when?.replace(/\s*\(P\d+(?:-P\d+)?\)/, "") ?? ""}
              </div>
              <div className="text-[13px] leading-relaxed text-ink-2">{r.decision ? plain(r.decision.reason) : ""}</div>
            </div>
          );
        })}
        {data && match.length > 8 && (
          <button onClick={() => setAll(!all)} className="w-full border-t border-rule px-5 py-3 text-center text-[14px] font-medium text-accent transition-colors hover:bg-fill-2">
            {all ? "Show fewer" : `Show all ${match.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
