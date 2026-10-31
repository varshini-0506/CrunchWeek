"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, PageHead, Spinner, useBusy } from "@/components/ui";
import { api, type BookingRow } from "@/lib/api";

type Bookings = { rows: BookingRow[]; score: number; max_score: number; overrides: { session_id: string; day: string; start_period: number; room_id: string; displaced_by: string }[]; priority_order: string[] };
type Filter = "all" | "mine" | "pending" | "approved" | "alternative_offered" | "rejected";
const FILTERS: [Filter, string][] = [["all", "Everything"], ["mine", "Mine"], ["pending", "Awaiting"], ["approved", "Confirmed"], ["alternative_offered", "Other slot"], ["rejected", "Declined"]];
const CAT_GRAD: Record<string, string> = {
  institute_event: "from-[#2b8cff] to-[#0064e0]", guest_lecture: "from-[#3ec4dc] to-[#119bb5]", department_event: "from-[#c86cf5] to-[#a346d8]", club_event: "from-[#ffad33] to-[#f58300]",
};

export default function SpectraPage() {
  const { user, version, refresh, meta } = useApp();
  const [data, setData] = useState<Bookings | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const { busy, error, run } = useBusy();

  const load = () => api<Bookings>("/bookings").then(setData);
  useEffect(() => { load().catch(() => {}); }, [version]);

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => {
    if (filter === "all") return true;
    if (filter === "mine") return r.mine;
    if (filter === "pending") return r.state === "pending";
    return r.decision?.status === filter && r.state !== "pending";
  }), [data, filter]);

  if (!data) return <Spinner />;
  const act = (path: string, body: object = {}) => run(async () => { await api(path, body); await load(); await refresh(); });
  const count = (s: string) => data.rows.filter((r) => r.decision?.status === s && r.state !== "pending").length;
  const isAdmin = user?.role === "admin";
  const decided = data.rows.filter((r) => r.state === "decided").length;

  return (
    <div>
      <PageHead no="03" kicker="Spectra '27 · fest week" title={<>{count("approved")} of {decided} events <span className="gradient-text">have their venue.</span></>}
        actions={isAdmin && (
          <>
            <Button kind="secondary" disabled={busy} onClick={() => act("/bookings/redecide")}>Decide again</Button>
            <Button disabled={busy} onClick={() => act("/bookings/confirm-all")}>Confirm every decision</Button>
          </>
        )}>
        Rooms go first to {data.priority_order.filter((p) => p !== "exam" && p !== "regular_session").map((p) => (meta?.category_label[p] ?? p).toLowerCase() + "s").join(", then ")}; within a tier, whoever asked first. Nobody can promote their own request.
      </PageHead>
      <ErrorBox error={error} />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <span className="glass-thin flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4"><span className="grid h-8 min-w-8 place-items-center rounded-full bg-ok px-2 font-display font-semibold text-white">{count("approved")}</span>confirmed</span>
        <span className="glass-thin flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4"><span className="grid h-8 min-w-8 place-items-center rounded-full bg-[#ff9f0a] px-2 font-display font-semibold text-white">{count("alternative_offered")}</span>offered a nearby slot</span>
        <span className="glass-thin flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4"><span className="grid h-8 min-w-8 place-items-center rounded-full bg-bad px-2 font-display font-semibold text-white">{count("rejected")}</span>declined, each with the reason</span>
        <div className="seg ml-auto max-w-full overflow-x-auto">
          {FILTERS.map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} className={`whitespace-nowrap ${filter === f ? "bg-accent" : ""}`}>
              {label}{f === "pending" ? ` · ${data.rows.filter((r) => r.state === "pending").length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? <Empty>Nothing in this drawer.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((r) => {
            const d = r.decision;
            const id = r.request.id;
            const status = r.state === "pending" ? "pending" : r.state === "cancelled" ? "cancelled" : r.state === "turned_down" ? "turned_down" : d?.status ?? "pending";
            return (
              <article key={id} className={`glass lift grid grid-cols-[96px_1fr] overflow-hidden rounded-[18px] ${r.state === "pending" ? "ring-2 ring-accent" : ""}`}>
                <div className={`flex flex-col justify-between bg-gradient-to-b p-3 text-white ${CAT_GRAD[r.effective_category] ?? "from-[#2b8cff] to-[#0064e0]"}`}>
                  <div>
                    <div className="font-mono text-[11px] text-white/70">{id}</div>
                    <div className="mt-2 text-[11px] font-semibold leading-tight">{r.category_label}</div>
                  </div>
                  <div className="font-display font-semibold text-2xl leading-none">{r.request.attendance}<span className="block font-sans text-[10px] font-medium text-white/75">people</span></div>
                </div>
                <div className="relative p-4">
                  <div className="absolute right-3 top-3"><Badge s={status} /></div>
                  <h3 className="pr-24 font-display font-semibold text-xl leading-tight">{r.request.title}</h3>
                  <div className="mt-0.5 text-xs text-ink-3">{r.request.requester} · {r.request.duration_periods} h
                    {r.effective_category !== r.request.requested_category && <span className="text-warn"> · asked to be treated as {(meta?.category_label[r.request.requested_category] ?? r.request.requested_category).toLowerCase()}</span>}
                    {r.confirmed && <span className="text-ok"> · confirmed by an approver</span>}
                  </div>
                  {r.when && d?.room_id && <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-fill-2 px-3 py-1.5 text-sm"><span className="text-ink-2">{r.when}</span><b className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] text-sheet">{d.room_id}</b></div>}
                  {d && <p className="mt-2 text-sm leading-snug text-ink-2">{r.state === "pending" ? <span className="italic">If approved: </span> : null}{d.reason}</p>}
                  {plain[id] && <p className="mt-2 rounded-2xl bg-plum-soft p-3 text-sm text-plum">{plain[id]}</p>}

                  {open === id && (
                    <dl className="mt-3 grid gap-x-4 gap-y-1 border-t border-rule pt-3 text-xs text-ink-2 sm:grid-cols-[auto_1fr]">
                      <dt className="smallcaps text-ink-3">Windows</dt><dd>{r.request.windows.map((w) => `${w.day} P${w.from_period}–P${w.to_period}`).join(", ")}</dd>
                      <dt className="smallcaps text-ink-3">Venue</dt><dd>{r.request.room_types.map((t) => t.replaceAll("_", " ")).join(", ")}{r.request.requested_room && ` · asked for ${r.request.requested_room}`}</dd>
                      <dt className="smallcaps text-ink-3">Needs</dt><dd>{r.request.needs.join(", ").replaceAll("_", " ") || "nothing special"}</dd>
                      {r.request.mandatory_for_groups.length > 0 && <><dt className="smallcaps text-ink-3">Compulsory</dt><dd>{r.request.mandatory_for_groups.join(", ")}</dd></>}
                      {r.explain.rank && <><dt className="smallcaps text-ink-3">Order</dt><dd>handled #{r.explain.rank} in the priority queue</dd></>}
                      {(r.explain.notes ?? []).concat(r.explain.blocked_by ?? []).map((n) => <dd key={n} className="sm:col-start-2">• {n}</dd>)}
                      {r.request.raw_text && <dd className="mt-1 sm:col-span-2">“{r.request.raw_text}”</dd>}
                    </dl>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button small kind="ghost" onClick={() => setOpen(open === id ? null : id)}>{open === id ? "Less" : "The full story"}</Button>
                    {meta?.ai && d && !plain[id] && <Button small kind="ghost" disabled={busy} onClick={() => run(async () => { const x = await api<{ plain: { text: string } }>(`/bookings/${id}/explain?ai_words=true`); setPlain((p) => ({ ...p, [id]: x.plain.text })); })}>Say it simply</Button>}
                    <span className="ml-auto flex gap-2">
                      {r.can_approve && r.state === "pending" && <>
                        <Button small disabled={busy} onClick={() => act(`/bookings/${id}/approve`)}>Approve</Button>
                        <Button small kind="danger" disabled={busy} onClick={() => act(`/bookings/${id}/reject`, { note: "Not suitable this week" })}>Decline</Button>
                      </>}
                      {r.can_approve && r.state === "decided" && !r.confirmed && <Button small kind="secondary" disabled={busy} onClick={() => act(`/bookings/${id}/approve`)}>Confirm</Button>}
                      {r.can_cancel && <Button small kind="secondary" disabled={busy} onClick={() => act(`/bookings/${id}/cancel`)}>Withdraw</Button>}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data.overrides.length > 0 && (
        <Card kicker="Fest week only" title="Classes that step aside" className="mt-6">
          <ul className="text-sm">{data.overrides.map((o) => <li key={o.session_id}>{o.session_id} moves to {o.day} P{o.start_period}, {o.room_id}, for {o.displaced_by}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
