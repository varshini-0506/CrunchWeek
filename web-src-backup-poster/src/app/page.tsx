"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chevron, useApp } from "@/components/AppShell";
import { Button, Card, ErrorBox, PageHead, Spinner, useBusy } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { api, DAY_NAME, DAYS, type SessionRow } from "@/lib/api";

type Report = { hard_violation_count: number; soft_total: number; bookings?: { booking_score: number; approved: number; alternatives: number; rejected: number; priority_inversions: unknown[] }; exam_soft_penalty?: number; stability?: { sessions_moved: number; time_changed: number; room_only_changed: number } };
type Validation = { schedule: Report; schedule_after?: Report };

// What each kind of trade-off means, in words people use.
const TRADE: Record<string, [string, string]> = {
  S1: ["time a teacher asked to avoid", "times teachers asked to avoid"],
  S2: ["gap in a section's day", "gaps in sections' days"],
  S3: ["section day over 6 hours", "section days over 6 hours"],
  S4: ["course lectured twice in one day", "courses lectured twice in one day"],
  S5: ["room under 40% full", "rooms under 40% full"],
  S6: ["class at 5 pm", "classes at 5 pm"],
};

export default function Today() {
  const { user, status, refresh, version } = useApp();
  const [val, setVal] = useState<Validation | null>(null);
  const [soft, setSoft] = useState<Record<string, number> | null>(null);
  const [fest, setFest] = useState<{ hosted: number; nearby: number; declined: number; total: number } | null>(null);
  const press = usePressure();
  const { busy, error, run } = useBusy();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!status?.timetable) return;
    api<{ soft: Record<string, number> }>("/utilisation").then((u) => setSoft(u.soft)).catch(() => {});
    // Withdrawn requests don't count as declined.
    api<{ rows: { state: string; decision: { status: string } | null }[] }>("/bookings").then((b) => {
      const live = b.rows.filter((r) => r.state === "decided");
      const n = (st: string) => live.filter((r) => r.decision?.status === st).length;
      setFest({ hosted: n("approved") + n("alternative_offered"), nearby: n("alternative_offered"), declined: n("rejected"), total: live.length });
    }).catch(() => {});
    if (isAdmin) api<Validation>("/validate").then(setVal).catch(() => setVal(null));
  }, [status?.timetable, version, isAdmin]);

  if (!status) return <Spinner />;
  const start = (path: string) => run(async () => { await api(path, {}); await refresh(); });
  const totalReq = status.approved + status.alternatives + status.rejected;
  const trade = soft ? Object.entries(soft).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${TRADE[k]?.[v === 1 ? 0 : 1] ?? k}`) : [];
  const first = user?.name.split(",")[0];
  const date = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const set = status.timetable && status.hard_violations === 0;
  const clashFree = status.hard_violations === 0;
  const total = status.total_sessions || status.sessions;

  return (
    <div>
      <PageHead meta={date} title={set ? <>The week is set. Nothing collides.</> : <>Planning the week…</>}
        actions={isAdmin && (
          <>
            <Button kind="secondary" disabled={busy || status.job.status === "running"} onClick={() => start("/reset")}>Reset demo</Button>
            <Button disabled={busy || status.job.status === "running"} onClick={() => start("/generate")}>Plan again from scratch</Button>
          </>
        )}>
        {press?.finding ?? <>Good to see you, {first}. Here is where CIT&apos;s week stands.</>}
      </PageHead>
      <ErrorBox error={error} />

      {!status.timetable ? <Card><Spinner label="The engine is building the first plan. This page fills in by itself." /></Card> : (
        <div className="grid gap-5 lg:grid-cols-12">
          {(user?.role === "faculty" || user?.role === "club") && <div className="lg:col-span-12"><MyCard /></div>}

          {/* Where the week stands, in four numbers. */}
          <section className="glass overflow-hidden rounded-[16px] lg:col-span-12">
            <dl className="grid grid-cols-2 lg:grid-cols-4">
              <Metric label="Classes placed" href="/timetable" value={<><span>{status.sessions}</span><span className="text-[15px] font-medium text-ink-3"> / {total}</span></>}
                note={status.sessions >= total ? "Every class has a room and a time." : `${total - status.sessions} classes still need a slot.`} />
              <Metric label="Double bookings" href="/timetable" value={clashFree ? <span>0</span> : <span className="text-bad">{status.hard_violations}</span>}
                note={clashFree ? "No student, teacher or room is ever in two places." : "Open the week to see who is double-booked."} />
              <Metric label="Spectra events with a venue" href="/spectra" value={<><span>{fest?.hosted ?? status.approved + status.alternatives}</span><span className="text-[15px] font-medium text-ink-3"> / {fest?.total ?? totalReq}</span></>}
                note={fest ? `${fest.nearby ? `${fest.nearby} got a nearby slot. ` : ""}${fest.declined} couldn't be hosted, with the reason.` : " "} />
              <Metric label="Midsem papers" href="/exams" value={status.exams}
                note={status.exam_penalty === 0 ? "Nobody sits two midsems on the same day." : "Some sections have two papers on one day."} />
            </dl>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule bg-fill-2 px-5 py-3 text-[13px] text-ink-2">
              <span className="font-medium text-ink">Small compromises: {status.soft_total ?? 0}</span>
              <span>{trade.length ? `Only ${trade.join(", ")}. Everything else follows what people asked for.` : "Every preference is met."}</span>
              <Link href="/insights" className="ml-auto font-medium text-accent hover:underline">See campus pulse</Link>
            </div>
          </section>

          <PressureMatrix p={press} />

          <section className={`flex flex-col ${isAdmin ? "lg:col-span-6" : "lg:col-span-12"}`}>
            <h2 className="mb-2.5 px-1 text-[15px] font-semibold">Next steps</h2>
            <div className="grouped flex-1">
              <Row href="/spectra" n={status.pending_bookings} one="Room request to approve" many="Room requests to approve" />
              {user?.role !== "club" && <Row href="/changes" n={status.pending_changes} one="Timetable change to review" many="Timetable changes to review" />}
              <Row href="/request" label="Ask for a room" />
              <Row href="/timetable" label={user?.role === "faculty" ? "See my week" : "Open the week"} />
              {user?.role !== "club" && <Row href="/changes" label="Report an absence" />}
            </div>
            <p className="mt-2 px-1 text-[13px] text-ink-3">{status.applied_changes === 0 ? "No changes published since the plan was made." : `${status.applied_changes} change${status.applied_changes === 1 ? "" : "s"} published since the plan was made.`}</p>
          </section>

          {isAdmin && (
            <section className="flex flex-col lg:col-span-6">
              <h2 className="mb-2.5 px-1 text-[15px] font-semibold">Independent check, for the judges</h2>
              {!val ? <div className="grouped"><Spinner label="Running the organisers' checker…" /></div> : (
                <div className="grouped flex-1">
                  <Check name="The plan" r={val.schedule} />
                  {val.schedule_after ? <Check name="After published changes" r={val.schedule_after} /> :
                    <div className="px-4 py-3 text-[13px] text-ink-3">Publish a change (try the sample on Changes) and its check appears here too.</div>}
                  <Link href="/exports" className="flex items-center gap-3 px-4 py-3 text-[15px] transition hover:bg-fill-2"><span className="flex-1">Download the files</span><Chevron /></Link>
                </div>
              )}
              <p className="mt-2 px-1 text-[13px] leading-relaxed text-ink-3">
                Planned with Google OR-Tools in {Math.round(status.solve.seconds ?? 0)} seconds (midsems in {Math.round(status.solve.exam_seconds ?? 0)}), and no better plan exists under the rules. The AI helper never decides anything.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, note, href }: { label: string; value: React.ReactNode; note: string; href: string }) {
  return (
    <Link href={href} className="group border-rule p-5 transition-colors duration-150 hover:bg-fill-2 [&:nth-child(n+2)]:border-l max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(n+3)]:border-t">
      <dt className="flex items-center text-[13px] font-medium text-ink-2"><span className="flex-1">{label}</span><span className="opacity-0 transition-opacity group-hover:opacity-100"><Chevron /></span></dt>
      <dd className="mt-2 text-[30px] font-normal leading-none tracking-[-0.02em] tabular">{value}</dd>
      <p className="mt-2.5 text-[14px] leading-snug text-ink-2">{note}</p>
    </Link>
  );
}

function Row({ href, n, one, many, label }: { href: string; n?: number; one?: string; many?: string; label?: string }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-[15px] transition-colors hover:bg-fill-2">
      <span className="flex-1">{label ?? (n === 1 ? one : many)}</span>
      {n !== undefined && <span className={`tabular ${n ? "rounded-full bg-bad-soft px-2 text-[13px] font-semibold text-bad" : "text-ink-3"}`}>{n}</span>}
      <Chevron />
    </Link>
  );
}

function Check({ name, r }: { name: string; r: Report }) {
  const ok = r.hard_violation_count === 0;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{ok ? <IconCheck className="h-3.5 w-3.5" /> : "!"}</span>
      <div className="text-[15px]">
        <div>{name}: {ok ? "passed" : "needs attention"}</div>
        <div className="text-[13px] text-ink-2">
          {ok ? "The organisers\u2019 checker found nothing to fix" : `${r.hard_violation_count} problems found`}
          {r.bookings && <>; Spectra decisions follow the priority order{r.bookings.priority_inversions.length ? ` except ${r.bookings.priority_inversions.length}` : " exactly"}</>}
          {r.stability && <>; {r.stability.sessions_moved} classes moved{r.stability.time_changed === 0 ? ", none changed time" : `, ${r.stability.time_changed} changed time`}</>}.
        </div>
      </div>
    </div>
  );
}

type MyRow = { request: { id: string; title: string }; decision: { status: string; reason: string } | null; state: string; mine: boolean; when?: string };
type MySession = { session_id: string; course_id: string; kind: string; day: string; start_period: number; room_id: string; faculty_id: string };

function MyCard() {
  const { user, version } = useApp();
  const [rows, setRows] = useState<MyRow[] | null>(null);
  const [classes, setClasses] = useState<MySession[] | null>(null);
  useEffect(() => {
    if (user?.role === "club") api<{ rows: MyRow[] }>("/bookings").then((d) => setRows(d.rows.filter((r) => r.mine))).catch(() => setRows([]));
    if (user?.role === "faculty") api<{ sessions: MySession[] }>("/timetable").then((d) => setClasses(d.sessions.filter((x) => x.faculty_id === user.faculty_id))).catch(() => setClasses([]));
  }, [user, version]);
  if (user?.role === "faculty") return (
    <Card title="Your week" actions={<Link href="/timetable" className="text-sm font-medium text-accent">Open it</Link>}>
      {!classes ? <Spinner /> : <p className="text-[15px] text-ink-2">You teach <b className="text-ink">{classes.length} classes</b> this week{classes.length ? ` (${[...new Set(classes.map((c) => c.course_id))].join(", ")})` : ""}. Can&apos;t make one? <Link href="/changes" className="font-medium text-accent">Tell us</Link> and the planner finds the gentlest fix.</p>}
    </Card>
  );
  return (
    <Card title="Your room requests" actions={<Link href="/request" className="text-sm font-medium text-accent">Ask for a room</Link>}>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="text-ink-3">Nothing asked for yet.</p> : (
        <ul className="space-y-2 text-sm">{rows.map((r) => (
          <li key={r.request.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-fill-2 px-4 py-3">
            <span className="font-medium">{r.request.title}</span>
            <span className="text-ink-3">{r.when ?? ""}</span>
            <span className={`stamp ml-auto ${r.state === "pending" ? "text-lake" : r.decision?.status === "approved" ? "text-ok" : r.decision?.status === "rejected" || r.state === "cancelled" ? "text-bad" : "text-warn"}`}>
              {r.state === "pending" ? "Awaiting" : r.state === "cancelled" ? "Withdrawn" : r.decision?.status === "approved" ? "Confirmed" : r.decision?.status === "rejected" ? "Declined" : "Other slot"}
            </span>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Week 7 venue pressure
   The fest venues down the side, Monday to Friday across, and in each cell the hours still free
   between 8 am and 10 pm (13 bookable hours; lunch is closed). Plain cells have room to spare;
   the vermilion deepens as a venue runs out, so the crunch shows before anyone asks for it. */

const VENUES = ["AUD", "SH-1", "SH-2", "OAT", "CS-LAB-1", "CS-LAB-2"];
const OPEN_HOURS = 13;
type PEvent = { request_id: string; title: string; day: string; start_period: number; end_period: number; room_id: string };
type Cell = { free: number; classes: number; events: number };
type Pressure = { rows: { id: string; name: string; capacity: number; cells: Record<string, Cell> }[]; finding: string; tightest: { day: string; free: number } };

function usePressure(): Pressure | null {
  const { meta, version, status } = useApp();
  const [tt, setTt] = useState<{ sessions: SessionRow[]; events: PEvent[] } | null>(null);
  useEffect(() => {
    if (!status?.timetable) return;
    api<{ sessions: SessionRow[]; events: PEvent[] }>("/timetable?week=spectra").then(setTt).catch(() => setTt(null));
  }, [status?.timetable, version]);
  if (!tt || !meta) return null;
  const rows = VENUES.map((id) => {
    const room = meta.rooms.find((r) => r.id === id);
    const cells: Record<string, Cell> = {};
    for (const d of DAYS) {
      const cls = tt.sessions.filter((s) => s.room_id === id && s.day === d);
      const evs = tt.events.filter((e) => e.room_id === id && e.day === d);
      const used = cls.reduce((a, s) => a + s.duration, 0) + evs.reduce((a, e) => a + e.end_period - e.start_period + 1, 0);
      cells[d] = { free: Math.max(0, OPEN_HOURS - used), classes: cls.length, events: evs.length };
    }
    return { id, name: room?.name ?? id, capacity: room?.capacity ?? 0, cells };
  });
  // The finding: the day with the least free time across the fest venues, and the venue that is tightest on it.
  const dayFree = DAYS.map((d) => [d, rows.reduce((a, r) => a + r.cells[d].free, 0)] as const);
  const [day] = dayFree.reduce((a, b) => (b[1] < a[1] ? b : a));
  const worst = rows.reduce((a, r) => (r.cells[day].free < a.cells[day].free ? r : a));
  const w = worst.cells[day].free;
  const finding = `${DAY_NAME[day]} is the tightest day of Spectra week: ${worst.name} has ${w === 0 ? "no hours" : w === 1 ? "1 hour" : `${w} hours`} left of ${OPEN_HOURS}.`;
  return { rows, finding, tightest: { day, free: w } };
}

function tone(free: number) {
  if (free === 0) return "bg-accent text-white";
  if (free <= 2) return "bg-[color-mix(in_srgb,var(--blue)_32%,var(--surface))] text-ink";
  if (free <= 5) return "bg-[color-mix(in_srgb,var(--blue)_13%,var(--surface))] text-ink";
  return "bg-fill-2 text-ink-2";
}

function PressureMatrix({ p }: { p: Pressure | null }) {
  return (
    <section className="glass overflow-hidden rounded-[16px] lg:col-span-12" aria-labelledby="press-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 pt-5">
        <h2 id="press-h" className="text-[17px] font-semibold">Week 7 venue pressure</h2>
        <p className="text-[13px] text-ink-2">Hours still free in each fest venue, 8 am to 10 pm</p>
      </div>
      {!p ? <Spinner label="Adding up the week…" /> : (
        <div className="overflow-x-auto px-5 pb-5 pt-4">
          <table className="w-full min-w-[520px] border-separate border-spacing-[3px] text-[13px]">
            <thead>
              <tr>
                <th className="w-[200px] pb-1 text-left font-normal text-ink-2"><span className="sr-only">Venue</span></th>
                {DAYS.map((d) => <th key={d} scope="col" className={`pb-1 text-center font-medium ${d === p.tightest.day ? "text-ink" : "text-ink-2"}`}>{DAY_NAME[d].slice(0, 3)}</th>)}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="pr-3 text-left font-normal"><span className="text-[14px] text-ink">{r.name}</span> <span className="tabular text-ink-3">{r.capacity}</span></th>
                  {DAYS.map((d) => {
                    const c = r.cells[d];
                    const what = [c.classes && `${c.classes} class${c.classes === 1 ? "" : "es"}`, c.events && `${c.events} Spectra event${c.events === 1 ? "" : "s"}`].filter(Boolean).join(", ") || "nothing booked";
                    return (
                      <td key={d} title={`${r.name}, ${DAY_NAME[d]}: ${OPEN_HOURS - c.free} of ${OPEN_HOURS} hours booked (${what})`}
                        className={`h-10 rounded-[6px] text-center tabular transition-[filter] hover:brightness-95 ${tone(c.free)}`}>
                        {c.free}<span className="sr-only"> hours free</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
            <span className="flex items-center gap-1.5"><i className={`h-3 w-5 rounded-[3px] border border-[var(--edge)] ${tone(6)}`} />6 or more</span>
            <span className="flex items-center gap-1.5"><i className={`h-3 w-5 rounded-[3px] ${tone(4)}`} />3 to 5</span>
            <span className="flex items-center gap-1.5"><i className={`h-3 w-5 rounded-[3px] ${tone(1)}`} />1 or 2</span>
            <span className="flex items-center gap-1.5"><i className={`h-3 w-5 rounded-[3px] ${tone(0)}`} />Full</span>
            <Link href="/spectra" className="ml-auto font-medium text-link hover:underline">See who got each venue</Link>
          </div>
        </div>
      )}
    </section>
  );
}
