"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, PageHead, Spinner, useBusy } from "@/components/ui";
import { api, type BookingRow } from "@/lib/api";
import { periodStart, plain, roomNames, when } from "@/lib/plain";

type Bookings = { rows: BookingRow[]; score: number; max_score: number; overrides: { session_id: string; day: string; start_period: number; room_id: string; displaced_by: string }[]; priority_order: string[] };
type Filter = "all" | "mine" | "pending" | "approved" | "alternative_offered" | "rejected";
const FILTERS: [Filter, string][] = [["all", "Everything"], ["mine", "Mine"], ["pending", "Awaiting"], ["approved", "Confirmed"], ["alternative_offered", "Other slot"], ["rejected", "Declined"]];
const CAT_TONE: Record<string, string> = { institute_event: "blk-event", guest_lecture: "blk-tutorial", department_event: "blk-club", club_event: "blk-lab" };

export default function SpectraPage() {
  const { user, version, refresh, meta } = useApp();
  const [data, setData] = useState<Bookings | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [plainAi, setPlainAi] = useState<Record<string, string>>({});
  const { busy, error, run } = useBusy();

  const load = () => api<Bookings>("/bookings").then(setData);
  useEffect(() => { load().catch(() => {}); }, [version]);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => {
    if (filter === "all") return true;
    if (filter === "mine") return r.mine;
    if (filter === "pending") return r.state === "pending";
    return r.decision?.status === filter && r.state !== "pending";
  }), [data, filter]);

  const names = useMemo(() => roomNames(meta?.rooms), [meta]);
  if (!data) return <Spinner />;
  const act = (path: string, body: object = {}) => run(async () => { await api(path, body); await load(); await refresh(); });
  const count = (s: string) => data.rows.filter((r) => r.decision?.status === s && r.state !== "pending").length;
  const isAdmin = user?.role === "admin";
  const decided = data.rows.filter((r) => r.state === "decided").length;

  return (
    <div>
      <PageHead meta="Spectra '27 · Week 7" title={<>{count("approved")} of {decided} events have their venue.</>}
        actions={isAdmin && (
          <>
            <Button kind="secondary" disabled={busy} onClick={() => act("/bookings/redecide")}>Decide again</Button>
            <Button disabled={busy} onClick={() => act("/bookings/confirm-all")}>Confirm every decision</Button>
          </>
        )}>
        Rooms go first to {data.priority_order.filter((p) => p !== "exam" && p !== "regular_session").map((p) => (meta?.category_label[p] ?? p).toLowerCase() + "s").join(", then ")}; within a tier, whoever asked first. Nobody can promote their own request.
      </PageHead>
      <ErrorBox error={error} />

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-2">
          <li className="flex items-baseline gap-2"><b className="text-[24px] font-normal text-ok tabular">{count("approved")}</b>confirmed</li>
          <li className="flex items-baseline gap-2"><b className="text-[24px] font-normal text-warn tabular">{count("alternative_offered")}</b>offered a nearby slot</li>
          <li className="flex items-baseline gap-2"><b className="text-[24px] font-normal text-bad tabular">{data.rows.filter((r) => r.state === "decided" && r.decision?.status === "rejected").length}</b>declined, each with the reason</li>
        </ul>
        <div className="seg ml-auto max-w-full overflow-x-auto">
          {FILTERS.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} className={`whitespace-nowrap ${filter === f ? "bg-accent" : ""}`}>
              {label}{f === "pending" ? ` · ${data.rows.filter((r) => r.state === "pending").length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? <Empty title={filter === "pending" ? "Nothing waiting for approval" : filter === "mine" ? "You haven't asked for a venue yet" : "No requests match this filter"}>{filter === "mine" ? "Ask for a room in plain English or Hinglish and it shows up here with its decision." : "Pick Everything to see every Spectra request and where it landed."}</Empty> : (
        <div className="glass overflow-hidden rounded-[16px]">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.8fr)_auto] gap-4 border-b border-rule px-5 py-2.5 text-[13px] font-medium text-ink-3 lg:grid">
            <span>Event</span><span>Venue and time</span><span>Why</span><span className="w-[150px] text-right">Action</span>
          </div>
          {rows.map((r) => {
            const d = r.decision;
            const id = r.request.id;
            const status = r.state === "pending" ? "pending" : r.state === "cancelled" ? "cancelled" : r.state === "turned_down" ? "turned_down" : d?.status ?? "pending";
            return (
              <article key={id} className={`border-b border-rule px-5 py-4 transition-colors duration-150 last:border-0 hover:bg-fill-2 ${r.state === "pending" ? "bg-accent-soft" : ""}`}>
                <div className="grid gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.8fr)_auto]">
                  <div className="flex min-w-0 gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold leading-snug">{r.request.title}</h3>
                      <div className="mt-0.5 text-[13px] text-ink-3"><span className={`blk-tag mr-1.5 ${CAT_TONE[r.effective_category] ?? ""}`} aria-hidden />{r.category_label} · {r.request.requester} · {r.request.attendance} people</div>
                      {r.effective_category !== r.request.requested_category && <div className="mt-0.5 text-[13px] text-warn">Asked to be treated as {(meta?.category_label[r.request.requested_category] ?? r.request.requested_category).toLowerCase()}</div>}
                    </div>
                  </div>
                  <div className="text-[14px]">
                    <div className="mb-1"><Badge s={status} />{r.confirmed && <span className="ml-2 text-[13px] text-ok">approver confirmed</span>}</div>
                    {d?.room_id ? <><div className="font-medium">{names[d.room_id] ?? d.room_id}</div><div className="text-[13px] text-ink-2">{when(r.when)}</div></> : <div className="text-[13px] text-ink-3">No venue</div>}
                  </div>
                  <div className="text-[13px] leading-relaxed text-ink-2">
                    {d && <>{r.state === "pending" ? <span className="font-medium text-ink">If approved: </span> : null}{plain(d.reason, names)}</>}
                    {plainAi[id] && <p className="mt-2 rounded-[10px] bg-plum-soft p-3 text-plum">{plainAi[id]}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-3">
                      <button onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} className="text-[13px] font-medium text-ink-2 underline decoration-rule hover:text-ink hover:decoration-current">{open === id ? "Hide details" : "Details"}</button>
                      {meta?.ai && d && !plainAi[id] && <button disabled={busy} className="text-[13px] font-medium text-ink-2 underline decoration-rule hover:text-ink hover:decoration-current" onClick={() => run(async () => { const x = await api<{ plain: { text: string } }>(`/bookings/${id}/explain?ai_words=true`); setPlainAi((p) => ({ ...p, [id]: x.plain.text })); })}>Say it simply</button>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 lg:w-[150px] lg:justify-end">
                    {r.can_approve && r.state === "pending" && <>
                      <Button small disabled={busy} onClick={() => act(`/bookings/${id}/approve`)}>Approve</Button>
                      <Button small kind="danger" disabled={busy} onClick={() => act(`/bookings/${id}/reject`, { note: "Not suitable this week" })}>Decline</Button>
                    </>}
                    {r.can_approve && r.state === "decided" && !r.confirmed && <Button small kind="secondary" disabled={busy} onClick={() => act(`/bookings/${id}/approve`)}>Confirm</Button>}
                    {r.can_cancel && <Button small kind="secondary" disabled={busy} onClick={() => act(`/bookings/${id}/cancel`)}>Withdraw</Button>}
                  </div>
                </div>
                {open === id && (
                  <dl className="pop mt-3 grid gap-x-6 gap-y-1.5 rounded-[12px] bg-fill-2 p-4 text-[13px] text-ink-2 sm:grid-cols-[120px_1fr]">
                    <dt className="text-ink-3">Asked for</dt><dd>{r.request.windows.map((w) => `${w.day.slice(0, 1)}${w.day.slice(1).toLowerCase()} ${periodStart(w.from_period)} to ${periodStart(w.to_period + 1)}`).join(", ")}</dd>
                    <dt className="text-ink-3">Kind of venue</dt><dd>{r.request.room_types.map((t) => t.replaceAll("_", " ")).join(", ")}{r.request.requested_room && ` · asked for ${names[r.request.requested_room] ?? r.request.requested_room}`}</dd>
                    <dt className="text-ink-3">Needs</dt><dd>{r.request.needs.join(", ").replaceAll("_", " ") || "Nothing special"}</dd>
                    {r.request.mandatory_for_groups.length > 0 && <><dt className="text-ink-3">Compulsory for</dt><dd>{r.request.mandatory_for_groups.join(", ")}</dd></>}
                    {r.explain.rank && <><dt className="text-ink-3">Place in queue</dt><dd>Number {r.explain.rank} in the priority order</dd></>}
                    {(r.explain.notes ?? []).concat(r.explain.blocked_by ?? []).map((n) => <dd key={n} className="sm:col-start-2">{plain(n, names, false)}</dd>)}
                    {r.request.raw_text && <><dt className="text-ink-3">Original message</dt><dd className="italic">&ldquo;{r.request.raw_text}&rdquo;</dd></>}
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
      {data.overrides.length > 0 && (
        <Card title="Classes that step aside" note="Fest week only. Each class moves back the week after." className="mt-6">
          <ul className="text-sm">{data.overrides.map((o) => <li key={o.session_id}>{o.session_id} moves to {o.day} {periodStart(o.start_period)}, {names[o.room_id] ?? o.room_id}, for {o.displaced_by}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
