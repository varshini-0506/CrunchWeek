"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chevron, useApp } from "@/components/AppShell";
import { Button, Card, ErrorBox, PageHead, Spinner, useBusy } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { api } from "@/lib/api";

type Report = { hard_violation_count: number; soft_total: number; bookings?: { booking_score: number; approved: number; alternatives: number; rejected: number; priority_inversions: unknown[] }; exam_soft_penalty?: number; stability?: { sessions_moved: number; time_changed: number; room_only_changed: number } };
type Validation = { schedule: Report; schedule_after?: Report };

// What each kind of trade-off means, in words people use.
const TRADE: Record<string, [string, string]> = {
  S1: ["time a teacher asked to avoid", "times teachers asked to avoid"],
  S2: ["gap in a section's day", "gaps in sections' days"],
  S3: ["room much bigger than the class", "rooms much bigger than the class"],
  S4: ["class at 5 pm", "classes at 5 pm"],
  S5: ["unusually long day", "unusually long days"],
  S6: ["course twice in one day", "courses twice in one day"],
};

export default function Today() {
  const { user, status, refresh, version } = useApp();
  const [val, setVal] = useState<Validation | null>(null);
  const [soft, setSoft] = useState<Record<string, number> | null>(null);
  const [fest, setFest] = useState<{ hosted: number; nearby: number; declined: number; total: number } | null>(null);
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
        Good to see you, {first}. Here is where CIT&apos;s week stands.
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
              <Metric label="Double bookings" href="/timetable" value={clashFree ? <span className="text-ok">0</span> : <span className="text-bad">{status.hard_violations}</span>}
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

          <section className={isAdmin ? "lg:col-span-6" : "lg:col-span-12"}>
            <h2 className="mb-2.5 px-1 text-[15px] font-semibold">Next steps</h2>
            <div className="grouped">
              <Row href="/spectra" n={status.pending_bookings} one="Room request to approve" many="Room requests to approve" />
              {user?.role !== "club" && <Row href="/changes" n={status.pending_changes} one="Timetable change to review" many="Timetable changes to review" />}
              <Row href="/request" label="Ask for a room" />
              <Row href="/timetable" label={user?.role === "faculty" ? "See my week" : "Open the week"} />
              {user?.role !== "club" && <Row href="/changes" label="Report an absence" />}
            </div>
            <p className="mt-2 px-1 text-[12px] text-ink-3">{status.applied_changes === 0 ? "No changes published since the plan was made." : `${status.applied_changes} change${status.applied_changes === 1 ? "" : "s"} published since the plan was made.`}</p>
          </section>

          {isAdmin && (
            <section className="lg:col-span-6">
              <h2 className="mb-2.5 px-1 text-[15px] font-semibold">Independent check, for the judges</h2>
              {!val ? <div className="grouped"><Spinner label="Running the organisers' checker…" /></div> : (
                <div className="grouped">
                  <Check name="The plan" r={val.schedule} />
                  {val.schedule_after ? <Check name="After published changes" r={val.schedule_after} /> :
                    <div className="px-4 py-3 text-[13px] text-ink-3">Publish a change (try the sample on Changes) and its check appears here too.</div>}
                  <Link href="/exports" className="flex items-center gap-3 px-4 py-3 text-[15px] transition hover:bg-fill-2"><span className="flex-1">Download the files</span><Chevron /></Link>
                </div>
              )}
              <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink-3">
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
      <dd className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular">{value}</dd>
      <p className="mt-2.5 text-[13px] leading-snug text-ink-2">{note}</p>
    </Link>
  );
}

function Row({ href, n, one, many, label }: { href: string; n?: number; one?: string; many?: string; label?: string }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-2.5 text-[15px] transition-colors hover:bg-fill-2">
      <span className="flex-1">{label ?? (n === 1 ? one : many)}</span>
      {n !== undefined && <span className={`tabular ${n ? "rounded-full bg-bad px-2 text-[13px] font-semibold text-white" : "text-ink-3"}`}>{n}</span>}
      <Chevron />
    </Link>
  );
}

function Check({ name, r }: { name: string; r: Report }) {
  const ok = r.hard_violation_count === 0;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-white ${ok ? "bg-ok" : "bg-bad"}`}>{ok ? <IconCheck className="h-3.5 w-3.5" /> : "!"}</span>
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
