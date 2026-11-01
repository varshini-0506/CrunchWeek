"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, Spinner, useBusy } from "@/components/ui";
import { api, DAY_NAME, DAYS, fmtHour, periodHour, type SessionRow } from "@/lib/api";

type Event = { request_id: string; title: string; requester: string; day: string; start_period: number; end_period: number; room_id: string; status: string; category: string };
type TT = { sessions: SessionRow[]; events: Event[]; hard_violation_count: number; soft_total: number };
type Mode = "group" | "faculty" | "room";

const KIND_STYLE: Record<string, string> = {
  lecture: "blk blk-lecture",
  tutorial: "blk blk-tutorial",
  lab: "blk blk-lab",
};

export default function TimetablePage() {
  const { user, meta, version } = useApp();
  const [week, setWeek] = useState<"regular" | "spectra">("regular");
  const [mode, setMode] = useState<Mode>(user?.role === "faculty" ? "faculty" : "group");
  const [key, setKey] = useState<string>(user?.faculty_id ?? "Y1-A");
  const [tt, setTt] = useState<TT | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    api<TT>(`/timetable?week=${week}`).then((d) => { setTt(d); setErr(null); }).catch(setErr);
  }, [week, version]);

  const choices = useMemo(() => {
    if (!meta) return [];
    if (mode === "group") return meta.groups.map((g) => ({ id: g.id, label: `${g.id} · ${g.name}` }));
    if (mode === "faculty") return meta.faculty.map((f) => ({ id: f.id, label: `${f.id} · ${f.name}` }));
    return meta.rooms.map((r) => ({ id: r.id, label: `${r.id} · ${r.name} (${r.capacity})` }));
  }, [meta, mode]);

  const setModeAndKey = (m: Mode) => {
    setMode(m);
    setKey(m === "group" ? "Y1-A" : m === "faculty" ? (user?.faculty_id ?? "F01") : "AUD");
  };

  const visible = useMemo(() => (tt?.sessions ?? []).filter((s) =>
    mode === "group" ? s.groups.includes(key) : mode === "faculty" ? s.faculty_id === key : s.room_id === key), [tt, mode, key]);
  const events = useMemo(() => (tt?.events ?? []).filter((e) => mode === "room" && e.room_id === key), [tt, mode, key]);
  const lastPeriod = week === "spectra" ? 13 : 9;
  const row = (p: number) => (p <= 5 ? p + 1 : p + 2);

  if (err) return <ErrorBox error={err} />;
  if (!tt || !meta) return <Spinner />;

  const hours = visible.reduce((a, s) => a + s.duration, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 border-b border-rule pb-6">
        <div className="mr-auto">
          <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[32px]">{tt.hard_violation_count === 0 ? "Nobody is in two places." : `${tt.hard_violation_count} double bookings to fix`}</h1>
          <p className="mt-2 text-[16px] text-ink">{tt.sessions.length} classes placed for {meta.groups.length} sections, {meta.faculty.length} teachers and {meta.rooms.length} rooms{week === "spectra" ? ", with Spectra events in the evenings" : ""}.</p>
        </div>
        <div className="seg">
          {(["regular", "spectra"] as const).map((w) => (
            <button key={w} onClick={() => setWeek(w)} className={`px-3 py-1.5 ${week === w ? "bg-accent" : "text-ink-2"}`}>
              {w === "regular" ? "Regular week" : "Spectra week (7)"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {(["group", "faculty", "room"] as const).map((m) => (
            <button key={m} onClick={() => setModeAndKey(m)} className={`px-3 py-1.5 capitalize ${mode === m ? "bg-accent" : "text-ink-2"}`}>{m === "group" ? "Section" : m === "faculty" ? "Teacher" : "Room"}</button>
          ))}
        </div>
        <select value={key} onChange={(e) => setKey(e.target.value)} className="min-w-0 max-w-full rounded-[10px] px-3 py-1.5 text-sm">
          {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <span className="text-sm text-ink-3">{visible.length} sessions · {hours} hours</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="glass overflow-x-auto rounded-[16px] p-2">
          <div className="grid min-w-[760px] text-[13px] [&>div]:border-rule" style={{ gridTemplateColumns: "64px repeat(5, minmax(120px, 1fr))", gridTemplateRows: `36px repeat(5, minmax(56px, auto)) 24px repeat(${lastPeriod - 5}, minmax(56px, auto))` }}>
            <div className="border-b-2 border-r border-b-rule bg-paper-2" style={{ gridRow: 1, gridColumn: 1 }} />
            {DAYS.map((d, i) => <div key={d} className="border-b border-b-rule bg-paper-2 p-2.5 text-[13px] font-medium text-ink" style={{ gridRow: 1, gridColumn: i + 2 }}>{DAY_NAME[d]}</div>)}
            {Array.from({ length: lastPeriod }, (_, i) => i + 1).map((p) => (
              <div key={p} className={`border-r border-t p-1 text-ink-3 ${p >= 10 ? "bg-plum-soft" : ""}`} style={{ gridRow: row(p), gridColumn: 1 }}>
                <div className="font-medium tabular">{fmtHour(periodHour(p))}</div>
              </div>
            ))}
            <div className="border-t bg-fill-2 text-center text-[13px] leading-6 text-ink-3" style={{ gridRow: 7, gridColumn: "1 / span 6" }}>Lunch · 1 to 2 pm</div>
            {DAYS.map((d, i) => Array.from({ length: lastPeriod }, (_, k) => k + 1).map((p) => (
              <div key={`${d}${p}`} className={`border-t ${i ? "border-l" : ""} ${p >= 10 ? "bg-plum-soft" : ""}`} style={{ gridRow: row(p), gridColumn: i + 2 }} />
            )))}
            {groupCells(visible).map(({ day, start, dur, items }) => (
              <div key={`${day}${start}`} className="z-10 flex flex-col gap-1 p-1" style={{ gridRow: `${row(start)} / span ${dur}`, gridColumn: DAYS.indexOf(day as typeof DAYS[number]) + 2 }}>
                {items.map((s) => (
                  <button key={s.session_id} onClick={() => setSel(s.session_id)}
                    className={`h-full rounded-[8px] p-2 text-left text-ink transition-[transform,filter] duration-150 hover:-translate-y-px hover:brightness-[0.97] ${KIND_STYLE[s.kind] ?? "blk"} ${sel === s.session_id ? "outline-2 outline-accent" : ""} ${s.recently_moved ? "outline-2 outline-dashed outline-warn" : ""}`}>
                    <div className="text-[13px] font-semibold">{s.course_id} <span className="font-normal text-ink-3">{s.kind}</span></div>
                    <div className="truncate text-ink-2">{s.title}</div>
                    <div className="text-ink-3">{mode === "room" ? s.groups.join(", ") : s.room_id}{mode !== "faculty" && ` · ${s.faculty_id}`}</div>
                    {s.basket_slot && <div className="opacity-70">Elective basket {s.basket_slot}</div>}
                    {s.override_by && <div className="font-medium text-plum">Moved this week for {s.override_by}</div>}
                    {s.recently_moved && <div className="font-medium text-warn">Moved by the last change</div>}
                  </button>
                ))}
              </div>
            ))}
            {events.map((e) => (
              <div key={e.request_id} className="z-10 p-1" style={{ gridRow: `${row(e.start_period)} / span ${e.end_period - e.start_period + 1}`, gridColumn: DAYS.indexOf(e.day as typeof DAYS[number]) + 2 }}>
                <div className="blk blk-event h-full rounded-[8px] p-2 text-ink">
                  <div className="mb-1"><Badge s={e.status} /></div>
                  <div className="font-semibold">{e.title}</div><div className="text-ink-3">{e.requester}</div>
                </div>
              </div>
            ))}
          </div>
          {visible.length === 0 && events.length === 0 && <div className="p-4"><Empty>Nothing scheduled here this week.</Empty></div>}
        </div>
        <SessionPanel key={sel ?? "none"} sid={sel} row={tt.sessions.find((s) => s.session_id === sel)} onClose={() => setSel(null)} visible={visible} label={choices.find((c) => c.id === key)?.label ?? key} />
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
        <li className="flex items-center gap-1.5"><i className="blk blk-lecture h-3 w-3 rounded-[3px]" />Lecture</li>
        <li className="flex items-center gap-1.5"><i className="blk blk-tutorial h-3 w-3 rounded-[3px]" />Tutorial</li>
        <li className="flex items-center gap-1.5"><i className="blk blk-lab h-3 w-3 rounded-[3px]" />Lab</li>
        <li className="flex items-center gap-1.5"><i className="blk blk-event h-3 w-3 rounded-[3px]" />Spectra event</li>
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[3px] outline-1 outline-dashed outline-warn" />Moved by the latest change</li>
      </ul>
    </div>
  );
}

function groupCells(rows: SessionRow[]) {
  const map = new Map<string, { day: string; start: number; dur: number; items: SessionRow[] }>();
  for (const s of rows) {
    const k = `${s.day}-${s.start_period}`;
    const c = map.get(k) ?? { day: s.day, start: s.start_period, dur: s.duration, items: [] };
    c.dur = Math.max(c.dur, s.duration);
    c.items.push(s);
    map.set(k, c);
  }
  return [...map.values()];
}

type Explain = { summary: string; room_reason: string; ruled_out: { reason: string; times: number; example?: string }[]; costs_here: string[]; other_valid_times: string[]; plain?: { text: string; source: string } };
type Option = { day: string; start_period: number; room_id: string; soft_delta: number; room_only: boolean; notes: string[] };

function SessionPanel({ sid, row, onClose, visible, label }: { sid: string | null; row?: SessionRow; onClose: () => void; visible: SessionRow[]; label: string }) {
  const { user, meta, refresh } = useApp();
  const [ex, setEx] = useState<Explain | null>(null);
  const [opts, setOpts] = useState<Option[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run, setError } = useBusy();

  useEffect(() => {
    if (!sid) return;
    api<Explain>(`/timetable/explain/${sid}`).then(setEx).catch(setError);
    api<{ options: Option[] }>(`/timetable/options/${sid}`).then((d) => setOpts(d.options)).catch(() => {});
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sid || !row) return <WeekSummary rows={visible} label={label} />;
  const canMove = user?.role === "admin" || user?.role === "department_coordinator";
  const simple = () => run(async () => setEx(await api<Explain>(`/timetable/explain/${sid}?ai_words=true`)));
  const move = (o: Option) => run(async () => {
    const r = await api<{ status: string; diff?: { sessions_moved: number } }>("/timetable/move", { session_id: sid, day: o.day, start_period: o.start_period, room_id: o.room_id, note: `Manual move of ${sid}` });
    setMsg(r.status === "applied" ? `Moved. The timetable still has no rule breaks.` : "Sent to an admin for approval.");
    await refresh();
  });

  return (
    <Card title={<span>{row.course_id} {row.kind}</span>} actions={<button onClick={onClose} className="text-sm text-ink-3">Close</button>} className="lg:sticky lg:top-24 lg:self-start">
      <div className="space-y-3 text-sm">
        <div className="text-ink-2">
          <div>{row.title}</div>
          <div>{row.faculty_name} ({row.faculty_id})</div>
          <div>Groups {row.groups.join(", ")} · {row.size} students · {row.duration} h</div>
          <div className="font-medium text-ink">{DAY_NAME[row.day]} {fmtHour(periodHour(row.start_period))}, {row.room_id} ({meta?.rooms.find((r) => r.id === row.room_id)?.name})</div>
        </div>
        <ErrorBox error={error} />
        {msg && <div className="rounded-[10px] bg-ok-soft p-3 text-ok">{msg}</div>}
        {!ex ? <Spinner label="Working out why…" /> : (
          <div className="space-y-2">
            <h3 className="text-[15px] font-semibold">Why here?</h3>
            {ex.plain ? <p className="rounded-[10px] bg-plum-soft p-3 text-plum">{ex.plain.text} <span className="block text-[13px] opacity-60">({ex.plain.source === "claude" ? "reworded by AI from the engine's facts" : "engine summary"})</span></p> : <p>{ex.summary}</p>}
            <p className="text-ink-2">{ex.room_reason}.</p>
            {ex.ruled_out.length > 0 && (
              <ul className="list-disc pl-5 text-ink-2">
                {ex.ruled_out.slice(0, 4).map((r) => <li key={r.reason}>{r.times} start times: {r.reason}{r.example ? ` (e.g. ${r.example})` : ""}</li>)}
              </ul>
            )}
            {ex.costs_here.length > 0 && <p className="text-warn">The compromise here: {ex.costs_here.join("; ")}</p>}
            {meta?.ai && !ex.plain && <Button small kind="ghost" onClick={simple} disabled={busy}>Say it simply (AI)</Button>}
          </div>
        )}
        <div>
          <h3 className="text-[15px] font-semibold">Where else it could go</h3>
          {!opts ? <Spinner label="Checking every slot against the rules…" /> : opts.length === 0 ? <p className="text-ink-3">No other placement keeps every rule.</p> : (
            <ul className="mt-2 space-y-1.5">
              {opts.slice(0, 8).map((o) => (
                <li key={`${o.day}${o.start_period}${o.room_id}`} className="flex items-center gap-2 rounded-[10px] bg-fill-2 p-2.5">
                  <div className="flex-1">
                    <div>{DAY_NAME[o.day]} {fmtHour(periodHour(o.start_period))} · {o.room_id}{o.room_only && <span className="ml-1 text-[13px] text-ok">same time</span>}</div>
                    <div className="text-[13px] text-ink-3">{o.soft_delta === 0 ? "just as good" : o.soft_delta > 0 ? `${o.soft_delta} more compromise${o.soft_delta === 1 ? "" : "s"}` : `${-o.soft_delta} fewer compromise${o.soft_delta === -1 ? "" : "s"}`}{o.notes.length ? ` · ${o.notes.join("; ")}` : ""}</div>
                  </div>
                  {canMove && <Button small kind="secondary" disabled={busy || row.fixed} onClick={() => move(o)}>{user?.role === "admin" ? "Move" : "Propose"}</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}


/** Shown beside the grid until a class is picked: this view's week in numbers, so the column is never empty. */
function WeekSummary({ rows, label }: { rows: SessionRow[]; label: string }) {
  const kinds = (["lecture", "tutorial", "lab"] as const).map((k) => [k, rows.filter((r) => r.kind === k).length] as const);
  const perDay = DAYS.map((d) => [d, rows.filter((r) => r.day === d).reduce((a, r) => a + r.duration, 0)] as const);
  const max = Math.max(1, ...perDay.map(([, h]) => h));
  const busiest = perDay.reduce((a, b) => (b[1] > a[1] ? b : a), perDay[0]);
  const late = rows.filter((r) => periodHour(r.start_period + r.duration - 1) >= 17).length;
  return (
    <Card title={label} note="Pick any class on the grid to see why it sits there and where else it could go." className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[10px] bg-[var(--edge)] text-[13px]">
        {kinds.map(([k, n]) => (
          <div key={k} className="bg-sheet p-3"><dt className="capitalize text-ink-2">{k}s</dt><dd className={`mt-1 text-[22px] leading-none tabular ${n ? "text-ink" : "text-ink-3"}`}>{n}</dd></div>
        ))}
      </dl>
      <h3 className="mb-2 mt-5 text-[14px] font-semibold">Hours each day</h3>
      <ul className="space-y-1.5 text-[13px]">
        {perDay.map(([d, h]) => (
          <li key={d} className="grid grid-cols-[84px_1fr_32px] items-center gap-2">
            <span className="text-ink-2">{DAY_NAME[d]}</span>
            <span className="h-2 rounded-full bg-fill"><span className={`block h-2 rounded-full ${d === busiest[0] && h > 0 ? "bg-lake" : "bg-ink-3/60"}`} style={{ width: `${(h / max) * 100}%` }} /></span>
            <span className={`text-right tabular ${h ? "" : "text-ink-3"}`}>{h || "–"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[14px] text-ink">{busiest[1] > 0 ? `${DAY_NAME[busiest[0]]} is the longest day, at ${busiest[1]} hours.` : "Nothing scheduled this week."}{late ? ` ${late} class${late === 1 ? " runs" : "es run"} to 5 pm or later.` : ""}</p>
    </Card>
  );
}
